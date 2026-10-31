# MCP — automatisation des brouillons d'articles

Serveur MCP sur mesure pour créer/mettre à jour des **brouillons** d'articles OkoolTrip dans
Strapi depuis Claude. Garde-fou volontaire : il n'existe **aucun outil de publication** dans ce
code, et le contrôleur `src/api/article/controllers/article.js` force `publishedAt: null` sur
toute création/modification venant de la route publique — la publication reste une action
manuelle d'un responsable dans l'admin Strapi.

## Installation (une fois, par collaborateur)

```bash
cd mcp/article-mcp-server
npm install
```

## Configuration (une fois, par collaborateur)

Ajouter dans `okooltripBack/.env` (jamais committé) :

```
STRAPI_ARTICLE_MCP_URL=https://api.okooltrip.sn
STRAPI_ARTICLE_MCP_TOKEN=<ton_token>
```

Le token se crée dans l'admin Strapi de **production** (`/admin` → Réglages → API Tokens) :
- Type **Custom**, durée **Unlimited**
- Permissions : `Article` → `create`, `find`, `findOne`, `update` · `Category` → `find`,
  `findOne` · `Author` → `find`, `findOne`
- Rien d'autre coché (pas de `delete`, pas d'autre content-type)

Strapi n'affiche le token qu'une seule fois à la création — à copier immédiatement dans `.env`.

## Utilisation

Une fois configuré, relancer Claude Code dans `okooltripBack` (les serveurs MCP sont chargés au
démarrage de la session). Les outils disponibles :
- `list_categories` / `list_authors` — pour retrouver les id à utiliser
- `create_article_draft` — crée un article en brouillon, retourne un lien direct (`reviewUrl`)
  vers l'admin Strapi pour la relecture
- `update_article_draft` — modifie un brouillon existant
- `get_article_draft` — relit un article par id

Le brouillon n'est jamais visible sur le site public tant qu'un responsable ne l'a pas publié
manuellement depuis l'admin Strapi.

## Avant de créer un article : lire `CHECKLIST_EDITORIALE.md`

Ce fichier liste les règles de qualité (marque, FAQ, CTA, contenu concret…) issues de l'analyse
d'articles déjà publiés sur okooltrip.sn, pour ne pas reproduire les mêmes erreurs dans les
nouveaux brouillons créés via `create_article_draft`.
