# OkoolTrip MCP Server

Serveur MCP sur mesure pour gérer le contenu OkoolTrip dans Strapi depuis Claude (articles,
circuits, hébergements, guides, pages SEO). Garde-fou absolu : **aucun outil de publication**
n'existe dans ce code — tout contenu créé reste en brouillon (`publishedAt: null` forcé).
La publication reste une action manuelle d'un responsable dans l'admin Strapi.

---

## Installation

```bash
npm install
```

## Configuration

Créer un fichier `.env` à la racine de ce dossier :

```env
STRAPI_ARTICLE_MCP_URL=https://api.okooltrip.sn
STRAPI_ARTICLE_MCP_TOKEN=<ton_token>
MCP_REMOTE_PUBLIC_URL=https://redaction.okooltrip.sn   # serveur distant uniquement
MCP_REMOTE_PORT=4100                                    # serveur distant uniquement
```

Le token se crée dans l'admin Strapi (`/admin` → Réglages → API Tokens) :
- Type **Custom**, durée **Unlimited**
- Permissions requises (voir détail ci-dessous)

### Permissions Strapi requises

| Content-type | Permissions |
|---|---|
| Article | `create`, `find`, `findOne`, `update`, `delete` |
| Category | `create`, `find`, `findOne`, `update` |
| Author | `create`, `find`, `findOne`, `update` |
| Tour | `create`, `find`, `findOne`, `update`, `delete` |
| Hotel | `create`, `find`, `findOne`, `update`, `delete` |
| Apartment | `create`, `find`, `findOne`, `update`, `delete` |
| Villa | `create`, `find`, `findOne`, `update`, `delete` |
| Room | `create`, `find`, `findOne`, `update`, `delete` |
| Guide | `create`, `find`, `findOne`, `update` |
| Circuit-general (et tous les circuit-*) | `find`, `findOne`, `update` |
| Hebergement (et tous les hebergement-*) | `find`, `findOne`, `update` |

---

## Outils disponibles (33 au total)

### Articles
| Outil | Description |
|---|---|
| `list_articles` | Liste les articles (brouillons inclus), filtre par titre/catégorie |
| `get_article_draft` | Lit un article complet par id (contenu + SEO) |
| `create_article_draft` | Crée un article en brouillon avec SEO auto |
| `update_article_draft` | Met à jour un article (SEO fusionné, slug auto) |
| `delete_article_draft` | Supprime un brouillon (bloqué si publié) |

### Catégories d'articles
| Outil | Description |
|---|---|
| `list_categories` | Liste les catégories (id, name, slug) |
| `create_category` | Crée une nouvelle catégorie |
| `update_category` | Modifie nom/slug/description |

### Auteurs
| Outil | Description |
|---|---|
| `list_authors` | Liste les auteurs (id, name, email) |
| `create_author` | Crée un nouvel auteur |
| `update_author` | Modifie nom/email/bio |

### Tours (circuits)
| Outil | Description |
|---|---|
| `list_tours` | Liste les circuits, filtre par type/guide |
| `get_tour` | Lit un circuit complet par id |
| `create_tour` | Crée un circuit en brouillon (tous les blocs de contenu, SEO, priceTiers) |
| `update_tour` | Met à jour un circuit (SEO fusionné, slug auto) |
| `delete_tour` | Supprime un circuit (bloqué si réservations liées) |

### Hébergements — Hotel / Apartment / Villa
| Outil | Description |
|---|---|
| `list_hebergements` | Liste par kind (hotel\|apartment\|villa), filtre par ville/statut |
| `get_hebergement` | Lit un hébergement complet par kind + id |
| `create_hotel` | Crée un hôtel (amenities, services, contact, policies, priceTiers) |
| `create_apartment` | Crée un appartement (price_per_night, capacity, apartment_type…) |
| `create_villa` | Crée une villa |
| `update_hebergement` | Met à jour hotel/apartment/villa (SEO fusionné, slug auto) |
| `delete_hebergement` | Supprime un hébergement |

### Chambres (Hotel)
| Outil | Description |
|---|---|
| `list_rooms` | Liste les chambres, filtre par hôtel |
| `create_room` | Crée une chambre et l'associe à un hôtel |
| `update_room` | Met à jour une chambre |
| `delete_room` | Supprime une chambre |

### Guides
| Outil | Description |
|---|---|
| `list_guides` | Liste les guides (id, name, email) |
| `create_guide` | Crée un guide (nom, email, bio, expériences, commission) |
| `update_guide` | Met à jour un guide |

### Pages SEO (singleType)
Pages éditoriales des sections circuits et hébergements (ContenuAvant, ContenuApres, FAQ, SEO).

| Outil | Description |
|---|---|
| `get_page` | Lit le contenu d'une page singleType |
| `update_page` | Met à jour ContenuAvant/Après, FAQ, SEO (fusionné) |

**Types disponibles :** `circuit-general`, `circuit-prive`, `circuit-demi-journee`, `circuit-4-4`,
`circuit-vtt-quad`, `circuit-nbre`, `circuits-senegal`, `hebergement`, `hebergement-1etoile`,
`hebergement-2etoiles`, `hebergement-3etoiles`, `hebergement-4etoiles`, `hebergement-5etoiles`

---

## Prompts disponibles (5 workflows guidés)

| Prompt | Description | Arguments |
|---|---|---|
| `rediger_article` | Workflow complet A→Z pour rédiger un article | `sujet`, `categorie?`, `langue?` |
| `creer_circuit` | Crée un circuit avec tous les blocs, FAQ, SEO | `titre`, `type?`, `ville?` |
| `creer_hebergement` | Crée hotel/apartment/villa + chambres | `nom`, `kind`, `ville` |
| `optimiser_seo_page` | Audite et réécrit le SEO d'une page singleType | `pageType` |
| `audit_contenu` | Liste tout le contenu brouillon et priorise | aucun |

---

## Démarrage

### Serveur local (stdio — pour Claude Code)
```bash
npm start
```

### Serveur distant (HTTP+OAuth — pour Claude Desktop / Claude.ai)
```bash
npm run start:remote
```

---

## Déploiement serveur (PM2)

```bash
pm2 restart redaction-mcp
pm2 logs redaction-mcp --lines 20 --nostream
```

Pour mettre à jour depuis GitHub :
```bash
git pull origin main && pm2 restart redaction-mcp
```

---

## Avant de créer un article : lire `CHECKLIST_EDITORIALE.md`

Règles de qualité éditoriale issues de l'analyse des articles publiés sur okooltrip.sn.
