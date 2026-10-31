// Fournisseur OAuth 2.1 (Authorization Code + PKCE, Dynamic Client Registration RFC 7591)
// pour le serveur MCP distant. L'identité des rédacteurs est vérifiée via le login ADMIN
// Strapi existant (/admin/login) — ce sont les mêmes comptes que ceux utilisés pour gérer
// Strapi au quotidien, aucun nouveau compte à créer.
//
// Important : ce fournisseur ne sert QU'À authentifier qui peut appeler les outils MCP. Se
// connecter ne donne PAS un accès admin à travers le MCP — les appels à Strapi pour créer/lire
// des articles utilisent toujours le token de service restreint (STRAPI_ARTICLE_MCP_TOKEN),
// jamais le compte admin du rédacteur. Le login admin est réutilisé uniquement comme preuve
// d'identité ("cette personne est une admin OkoolTrip connue"), pas comme moyen d'accès.

import { randomBytes, randomUUID } from "node:crypto";
import {
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { OAuthStore } from "./oauth-store.js";
import { getStrapiConfig } from "./tools.js";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h
const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 min

function randomToken() {
  return randomBytes(32).toString("base64url");
}

async function strapiLogin(email, password) {
  const { STRAPI_URL } = getStrapiConfig();
  const res = await fetch(`${STRAPI_URL}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message || "Identifiants invalides";
    throw new Error(message);
  }
  return body.data.user; // { id, firstname, lastname, email, ... }
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

function renderLoginPage({ client, params, error }) {
  const hidden = (name, value) =>
    value === undefined ? "" : `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Connexion — OkoolTrip rédaction</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; background: #f5f6f8; display: flex; align-items: center;
         justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08);
          width: 320px; }
  h1 { font-size: 1.1rem; margin: 0 0 1rem; }
  label { display: block; font-size: .85rem; margin-bottom: .25rem; color: #333; }
  input[type=email], input[type=password] { width: 100%; padding: .5rem; margin-bottom: 1rem;
          border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
  button { width: 100%; padding: .6rem; background: #145C73; color: #fff; border: none;
           border-radius: 6px; font-size: 1rem; cursor: pointer; }
  .error { color: #b00020; font-size: .85rem; margin-bottom: 1rem; }
  .app-name { color: #555; font-size: .8rem; margin-bottom: 1.5rem; }
</style>
</head>
<body>
  <div class="card">
    <h1>Connexion — rédaction d'articles OkoolTrip</h1>
    <div class="app-name">Application demandant l'accès : ${escapeHtml(client.client_name || client.client_id)}</div>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <form method="POST" action="/authorize">
      ${hidden("client_id", client.client_id)}
      ${hidden("redirect_uri", params.redirectUri)}
      ${hidden("response_type", "code")}
      ${hidden("code_challenge", params.codeChallenge)}
      ${hidden("code_challenge_method", "S256")}
      ${hidden("state", params.state)}
      ${hidden("scope", params.scopes?.join(" "))}
      ${hidden("resource", params.resource?.href)}
      <label for="email">Identifiant Strapi (email)</label>
      <input type="email" id="email" name="email" required autofocus>
      <label for="password">Mot de passe</label>
      <input type="password" id="password" name="password" required>
      <button type="submit">Se connecter</button>
    </form>
  </div>
</body>
</html>`;
}

export class OkoolTripOAuthProvider {
  constructor() {
    this.store = new OAuthStore();
    this._authCodes = new Map(); // courte durée de vie, en mémoire uniquement

    this.clientsStore = {
      getClient: (clientId) => this.store.getClient(clientId),
      registerClient: (clientMetadata) => {
        const client_id = randomUUID();
        const full = {
          ...clientMetadata,
          client_id,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          token_endpoint_auth_method: clientMetadata.token_endpoint_auth_method || "none",
        };
        return this.store.saveClient(full);
      },
    };
  }

  async authorize(client, params, res) {
    const req = res.req;
    if (req.method !== "POST") {
      res.set("Content-Type", "text/html");
      res.send(renderLoginPage({ client, params }));
      return;
    }

    const email = req.body?.email;
    const password = req.body?.password;
    try {
      const user = await strapiLogin(email, password);
      const code = randomToken();
      this._authCodes.set(code, {
        clientId: client.client_id,
        userId: user.id,
        email: user.email,
        scopes: params.scopes || [],
        codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri,
        resource: params.resource?.href,
        expiresAt: Date.now() + AUTH_CODE_TTL_MS,
      });
      const redirectUrl = new URL(params.redirectUri);
      redirectUrl.searchParams.set("code", code);
      if (params.state) redirectUrl.searchParams.set("state", params.state);
      res.redirect(302, redirectUrl.href);
    } catch (error) {
      res.set("Content-Type", "text/html");
      res.status(401).send(renderLoginPage({ client, params, error: error.message }));
    }
  }

  async challengeForAuthorizationCode(client, authorizationCode) {
    const entry = this._authCodes.get(authorizationCode);
    if (!entry || entry.clientId !== client.client_id || entry.expiresAt < Date.now()) {
      throw new InvalidGrantError("Code d'autorisation invalide ou expiré");
    }
    return entry.codeChallenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri) {
    const entry = this._authCodes.get(authorizationCode);
    if (!entry || entry.clientId !== client.client_id || entry.expiresAt < Date.now()) {
      throw new InvalidGrantError("Code d'autorisation invalide ou expiré");
    }
    if (redirectUri && entry.redirectUri !== redirectUri) {
      throw new InvalidGrantError("redirect_uri ne correspond pas à la demande initiale");
    }
    this._authCodes.delete(authorizationCode); // usage unique

    const accessToken = randomToken();
    const refreshToken = randomToken();
    const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
    const record = {
      clientId: client.client_id,
      userId: entry.userId,
      email: entry.email,
      scopes: entry.scopes,
      expiresAt,
    };
    this.store.saveAccessToken(accessToken, record);
    this.store.saveRefreshToken(refreshToken, {
      clientId: client.client_id,
      userId: entry.userId,
      email: entry.email,
      scopes: entry.scopes,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: entry.scopes.join(" "),
    };
  }

  async exchangeRefreshToken(client, refreshToken, scopes) {
    const entry = this.store.getRefreshToken(refreshToken);
    if (!entry || entry.clientId !== client.client_id) {
      throw new InvalidGrantError("Refresh token invalide");
    }
    const accessToken = randomToken();
    const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
    const finalScopes = scopes && scopes.length ? scopes : entry.scopes;
    this.store.saveAccessToken(accessToken, {
      clientId: client.client_id,
      userId: entry.userId,
      email: entry.email,
      scopes: finalScopes,
      expiresAt,
    });
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: finalScopes.join(" "),
    };
  }

  async verifyAccessToken(token) {
    const entry = this.store.getAccessToken(token);
    if (!entry) {
      throw new InvalidTokenError("Token inconnu ou révoqué");
    }
    return {
      token,
      clientId: entry.clientId,
      scopes: entry.scopes,
      expiresAt: entry.expiresAt,
      extra: { email: entry.email, userId: entry.userId },
    };
  }

  async revokeToken(client, request) {
    const entry = this.store.getAccessToken(request.token);
    if (entry && entry.clientId === client.client_id) {
      this.store.deleteAccessToken(request.token);
      return;
    }
    const refreshEntry = this.store.getRefreshToken(request.token);
    if (refreshEntry && refreshEntry.clientId === client.client_id) {
      this.store.deleteRefreshToken(request.token);
    }
  }
}
