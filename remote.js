#!/usr/bin/env node
// Serveur MCP distant (HTTP + OAuth) — pour les rédacteurs via Claude Desktop / Claude.ai.
// Déployé sur redaction.okooltrip.sn (derrière nginx/CloudPanel, en local sur PORT).
//
// Mêmes garde-fous que la version locale (index.js) : aucun outil de publication n'existe
// (voir tools.js), et le contrôleur Strapi force publishedAt à null sur toute écriture
// publique, quel que soit le chemin d'appel.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createArticleMcpServer } from "./tools.js";
import { OkoolTripOAuthProvider } from "./oauth-provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../.env") });
loadEnv({ path: path.resolve(__dirname, ".env") }); // overrides locaux au service distant

const PORT = Number(process.env.MCP_REMOTE_PORT || 4100);
const PUBLIC_URL = process.env.MCP_REMOTE_PUBLIC_URL; // ex: https://redaction.okooltrip.sn

if (!PUBLIC_URL) {
  console.error("[remote] MCP_REMOTE_PUBLIC_URL manquant — obligatoire pour l'émission OAuth.");
  process.exit(1);
}

const publicUrl = new URL(PUBLIC_URL);
const provider = new OkoolTripOAuthProvider();

const app = createMcpExpressApp({ host: "127.0.0.1", allowedHosts: [publicUrl.hostname] });
app.set("trust proxy", 1); // derrière nginx — requis pour que express-rate-limit lise X-Forwarded-For

app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: publicUrl,
    resourceServerUrl: new URL("/mcp", publicUrl),
    scopesSupported: ["articles:draft"],
    resourceName: "OkoolTrip — rédaction d'articles",
  })
);

// --- Endpoint MCP, protégé par le token d'accès émis par le flux OAuth ci-dessus ---
const IDLE_MS = 30 * 60_000;
const sessions = new Map();

setInterval(() => {
  const cutoff = Date.now() - IDLE_MS;
  for (const [sid, session] of sessions) {
    if (session.lastActive < cutoff) {
      session.transport.close().catch(() => {});
      sessions.delete(sid);
    }
  }
}, 60_000).unref();

const bearerAuth = requireBearerAuth({
  verifier: provider,
  resourceMetadataUrl: new URL("/.well-known/oauth-protected-resource/mcp", publicUrl).href,
});

app.post("/mcp", bearerAuth, async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (session) {
      session.lastActive = Date.now();
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if ((!sessionId || !session) && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          sessions.set(sid, { transport, lastActive: Date.now() });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      const mcpServer = createArticleMcpServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Session MCP absente ou expirée — initialiser une nouvelle session" },
      id: null,
    });
  } catch (error) {
    console.error("[remote] Erreur requête MCP:", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

app.get("/mcp", bearerAuth, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session) {
    res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
    return;
  }
  session.lastActive = Date.now();
  await session.transport.handleRequest(req, res);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[remote] Serveur MCP distant OkoolTrip — écoute sur 127.0.0.1:${PORT}, public: ${PUBLIC_URL}`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
