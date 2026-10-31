// Stockage persistant (fichier JSON) pour les clients OAuth enregistrés et les tokens émis.
// Volume attendu très faible (quelques rédacteurs, quelques clients) — un fichier JSON avec
// écriture synchrone est largement suffisant, pas besoin d'une base de données pour ça.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// import.meta.dirname nécessite Node 20+ ; ce service doit rester compatible Node 18
// (version installée sur le serveur de production au moment du déploiement).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORE_PATH = path.resolve(__dirname, "remote-data", "store.json");

function emptyStore() {
  return { clients: {}, tokens: {}, refreshTokens: {} };
}

export class OAuthStore {
  constructor(storePath = DEFAULT_STORE_PATH) {
    this.storePath = storePath;
    this.data = this._load();
  }

  _load() {
    try {
      if (existsSync(this.storePath)) {
        return JSON.parse(readFileSync(this.storePath, "utf-8"));
      }
    } catch (error) {
      console.error(`[oauth-store] Lecture impossible (${this.storePath}), on repart à vide :`, error.message);
    }
    return emptyStore();
  }

  _save() {
    mkdirSync(path.dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  getClient(clientId) {
    return this.data.clients[clientId];
  }

  saveClient(client) {
    this.data.clients[client.client_id] = client;
    this._save();
    return client;
  }

  saveAccessToken(token, record) {
    this.data.tokens[token] = record;
    this._save();
  }

  getAccessToken(token) {
    return this.data.tokens[token];
  }

  deleteAccessToken(token) {
    delete this.data.tokens[token];
    this._save();
  }

  saveRefreshToken(token, record) {
    this.data.refreshTokens[token] = record;
    this._save();
  }

  getRefreshToken(token) {
    return this.data.refreshTokens[token];
  }

  deleteRefreshToken(token) {
    delete this.data.refreshTokens[token];
    this._save();
  }
}
