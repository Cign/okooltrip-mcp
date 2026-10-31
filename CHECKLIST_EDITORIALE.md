# Checklist éditoriale — automatisation des articles OkoolTrip

Issue de l'analyse de 4 articles déjà publiés sur okooltrip.sn (JOJ26 Diamniadio, JOJ26 Dakar,
Quand partir au Sénégal, Que faire au Sénégal). Objectif : que toute **nouvelle** création
d'article via `create_article_draft` respecte ces règles — pour ne pas reproduire les erreurs
trouvées en production.

## 🚨 Bugs trouvés sur les articles déjà publiés (à corriger manuellement, pas via le MCP)

1. **Mauvais nom de marque** — l'article "Que faire au Sénégal" répète 9 fois un CTA citant
   **"Indigo neo"** au lieu de **"OkoolTrip"**. Signe que ce contenu a été généré avec un prompt
   générique (réutilisé d'un autre projet) sans remplacer le nom de marque.
2. **Fuite de consignes de rédaction dans le texte publié** — des phrases comme *"Un safari
   doit être présenté comme une expérience d'observation…"* ou *"Il est préférable de ne pas
   présenter sa couleur comme constante"* sont visibles par les lecteurs : ce sont des
   instructions destinées à l'IA, jamais nettoyées avant publication.
3. **FAQ vide dans les 4 articles** — le titre "FAQ" existe mais aucune question-réponse n'a
   été rédigée.

⚠️ Ne pas corriger ces articles via `update_article_draft` : le contrôleur `article.js` force
`publishedAt: null` sur toute modification passant par l'API publique, donc l'outil
**dépublierait l'article par erreur**. Ces 3 corrections doivent passer par l'admin Strapi
directement.

## ⚠️ Publier impacte deux domaines à la fois

`okooltrip.sn` et `okooltrip.fr` consomment le **même** Strapi (`api.okooltrip.sn`) — il n'y a
qu'une seule source de contenu (pas de champ "site" ni de plugin i18n sur `article`). Cliquer
"Publier" rend l'article visible **simultanément** sur les deux domaines. Un responsable qui
relit un brouillon doit vérifier que le contenu convient aux deux audiences (Sénégal et
diaspora en France), pas seulement à l'une des deux.

## ✅ Règles à respecter pour toute nouvelle création automatisée

Ces règles doivent guider toute utilisation de `create_article_draft` (et de `update_article_draft`
sur un brouillon) :

1. **Toujours "OkoolTrip"**, jamais un autre nom de marque — vérifier le texte généré avant
   l'appel à l'outil, surtout si le contenu réutilise un prompt/brief externe.
2. **Ne jamais laisser de consigne de rédaction dans le texte final** — relire le contenu généré
   comme le ferait un lecteur, pas comme une note à soi-même.
3. **La FAQ (champ `faq` de l'outil) doit toujours contenir de vraies questions-réponses**,
   jamais un titre vide — c'est l'un des gains SEO les plus faciles identifiés sur les articles
   existants.
4. **Contenu concret, pas générique** : inclure des éléments spécifiques (noms de lieux, durées,
   fourchettes de prix si connues, distances) plutôt que des conseils qui s'appliqueraient à
   n'importe quelle destination.
5. **Varier les CTA** — ne pas répéter la même formulation de CTA plus de 2 fois dans un même
   article (un article existant le fait 9 fois).
6. **Cohérence H1 / méta-titre** — le titre de l'article (`title`) et son équivalent SEO doivent
   correspondre, pas deux formulations différentes.
7. **Ancres de liens internes cohérentes** — si un lien pointe vers "hôtels à Dakar", le texte de
   lien doit refléter cette destination, pas un sujet différent.
8. **Le corps de l'article va dans `contentBlocks` (champ Strapi `ContenuArticle`), jamais dans
   `description`** — `ContenuArticle` est le champ que le site affiche réellement (rendu via
   `renderRichText`, voir `okooltripFront/src/app/utils/rich-text-renderer.tsx`) ; `description`
   ne sert que de résumé/meta, et si `ContenuArticle` est vide le site retombe sur `description`
   affichée comme simple paragraphe — un article "cassé" visuellement. `create_article_draft`
   exige déjà `contentBlocks`, donc ce cas ne devrait jamais arriver en pratique.
9. **Le slug se génère automatiquement** à partir du titre (translittéré, sans accents) si non
   fourni — ne jamais laisser Strapi avec un slug vide (Strapi ne le génère pas tout seul via
   l'API, contrairement à l'admin).
10. **SEO et structure de données sont remplis automatiquement** par l'outil : `metaTitle`/
    `metaDescription` (composant `seo`, repli sur `title`/`description` si non précisés) et le
    JSON-LD `structuredData` (`schemaType: "Article"`, `headline`, et `articleSection`/
    `authorName` si `categoryName`/`authorName` sont fournis — à passer quand on les connaît déjà
    via `list_categories`/`list_authors`, pour une structure de données plus complète).
11. **Toujours donner 3 à 6 `keywords`** à `create_article_draft` quand on connaît le sujet
    exact ciblé par l'article — sans ça, le panneau d'analyse SEO de Strapi (plugin
    `@strapi/plugin-seo`) affiche "Aucun mot-clé" et ne peut pas calculer la densité.
12. **Donner `canonicalPath` dès qu'on connaît l'URL finale de l'article** (catégorie + slug,
    ex. `/guide-voyage/que-faire-au-senegal/mon-article`) — sans ça, le panneau SEO signale une
    URL canonique manquante. Si l'URL finale n'est pas encore connue au moment de la création
    (dépend parfois d'un routage décidé plus tard), on peut l'ajouter après coup via
    `update_article_draft`.
13. **Les Meta Social Tags (Facebook/Twitter) sont générés automatiquement** à partir du
    titre/description SEO — aucune action requise, mais vérifier que `metaDescription` reste
    lisible une fois tronquée à 65 caractères pour ces aperçus sociaux (plus court que la limite
    de 160 caractères de la meta description SEO classique).

⚠️ **Limite connue du plugin SEO Strapi (v1.9.8)** : son compteur de mots traite le corps de
l'article comme du Markdown texte brut, alors que `ContenuArticle` est du type "Blocks" (JSON
structuré) — il affichera donc toujours "Words: 0" même sur un article bien rempli. Ce n'est pas
un signe de contenu manquant, c'est une incompatibilité du plugin avec ce type de champ ; à
ignorer pour ce check précis.

## Pourquoi ce document existe

Avant cette analyse, il n'existait aucune trace écrite des règles de qualité éditoriale pour
OkoolTrip — les erreurs ci-dessus ont pu passer en production parce que rien ne les rendait
visibles avant publication. Ce fichier sert de référence courte à consulter (par un humain ou par
moi) avant chaque nouvelle création d'article via le MCP.
