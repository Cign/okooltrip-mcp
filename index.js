#!/usr/bin/env node
// Serveur MCP local (stdio) — pour les développeurs via Claude Code. Voir tools.js pour la
// logique des outils (partagée avec remote.js, la version HTTP+OAuth pour les rédacteurs).
//
// Garde-fou volontaire : AUCUN outil de publication n'est défini dans tools.js (pas de
// publish_article, pas d'option publishedAt exposée). La publication reste une action
// manuelle, faite par un responsable dans l'admin Strapi. Le contrôleur Strapi
// (src/api/article/controllers/article.js) force en plus publishedAt à null sur toute
// création/modification venant de la route publique /api/articles, donc même une
// mauvaise manipulation de ce serveur ne peut pas publier un article.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createArticleMcpServer } from "./tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../.env") });

const server = createArticleMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
