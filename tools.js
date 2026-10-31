// Logique des outils MCP "articles OkoolTrip", partagée entre le serveur local (stdio,
// utilisé via Claude Code par les développeurs) et le serveur distant (HTTP+OAuth, utilisé via
// Claude Desktop/Claude.ai par les rédacteurs). Garde-fou volontaire : AUCUN outil de
// publication n'est défini ici — la publication reste une action manuelle dans l'admin Strapi.

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ─── Utilitaires (inlinés depuis strapi-utils.js) ──────────────────────────

export function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

export function getStrapiConfig() {
  const STRAPI_URL = (process.env.STRAPI_ARTICLE_MCP_URL || "https://api.okooltrip.sn").replace(/\/+$/, "");
  const STRAPI_TOKEN = process.env.STRAPI_ARTICLE_MCP_TOKEN;
  if (!STRAPI_TOKEN) {
    console.error("[article-mcp] STRAPI_ARTICLE_MCP_TOKEN manquant dans okooltripBack/.env — les outils échoueront.");
  }
  return { STRAPI_URL, STRAPI_TOKEN };
}

export async function strapiRequest(apiPath, options = {}) {
  const { STRAPI_URL, STRAPI_TOKEN } = getStrapiConfig();
  const res = await fetch(`${STRAPI_URL}${apiPath}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${STRAPI_TOKEN}`,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message || res.statusText;
    throw new Error(`Strapi ${res.status} sur ${apiPath} : ${message}`);
  }
  return body;
}

export function textNode(text) {
  return { type: "text", text: String(text ?? "") };
}

// --- Schéma inline pour le texte riche ---
export const inlineChildSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    code: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("link"),
    url: z.string().url(),
    children: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1),
  }),
]);

export function resolveChildren(block) {
  if (block.children?.length) return block.children;
  return [textNode(block.text ?? "")];
}

/** Convertit "HH:MM" en "HH:MM:ss.SSS" attendu par Strapi pour les champs time */
export function formatTime(t) {
  if (!t) return t;
  return /^\d{2}:\d{2}$/.test(t) ? `${t}:00.000` : t;
}

// --- Blocs de contenu (heading, paragraph, list, quote, code) ---
export const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    level: z.number().int().min(2).max(6).default(2),
    text: z.string().optional().describe("Shorthand — utiliser children pour du texte riche"),
    children: z.array(inlineChildSchema).optional(),
  }),
  z.object({
    type: z.literal("paragraph"),
    text: z.string().optional().describe("Shorthand — utiliser children pour du texte riche"),
    children: z.array(inlineChildSchema).optional(),
  }),
  z.object({
    type: z.literal("list"),
    style: z.enum(["ordered", "unordered"]).default("unordered"),
    items: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("quote"),
    text: z.string().optional(),
    children: z.array(inlineChildSchema).optional(),
  }),
  z.object({
    type: z.literal("code"),
    language: z.string().optional().describe("ex: javascript, python, bash, json"),
    text: z.string().min(1),
  }),
]);

export function convertContentBlocks(blocks = []) {
  return blocks.map((block) => {
    if (block.type === "heading") return { type: "heading", level: block.level ?? 2, children: resolveChildren(block) };
    if (block.type === "paragraph") return { type: "paragraph", children: resolveChildren(block) };
    if (block.type === "list") return {
      type: "list",
      format: block.style === "ordered" ? "ordered" : "unordered",
      children: (block.items || []).map((item) => ({ type: "list-item", children: [textNode(item)] })),
    };
    if (block.type === "quote") return { type: "quote", children: resolveChildren(block) };
    if (block.type === "code") return { type: "code", language: block.language ?? "text", children: [textNode(block.text)] };
    return { type: "paragraph", children: resolveChildren(block) };
  });
}

export const faqItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export function convertFaq(faq = []) {
  return faq.flatMap(({ question, answer }) => [
    { type: "heading", level: 3, children: [textNode(question)] },
    { type: "paragraph", children: [textNode(answer)] },
  ]);
}

export function jsonResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(error) {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
  };
}

// --- Schémas composants réutilisables ---

export const amenitySchema = z.object({
  name: z.string().min(1),
  icon: z.enum(["wifi","ac","tv","mini-bar","safe","hairdryer","kettle","iron","bathrobe","slippers","phone","desk","wardrobe","balcony","terrace","kitchen","washer","dryer","dishwasher","microwave","coffee-machine","garden","bbq","jacuzzi","fireplace","other"]).optional(),
  category: z.enum(["comfort","technology","bathroom","kitchen","outdoor","security","other"]).optional(),
});

export const serviceSchema = z.object({
  name: z.string().min(1),
  icon: z.enum(["pool","spa","gym","restaurant","bar","parking","airport-shuttle","wifi","laundry","concierge","room-service","business-center","beach-access","kids-club","excursion","security","ev-charging","bicycle","boat","other"]).optional(),
  description: z.string().optional(),
  included: z.boolean().optional().default(true),
  extra_cost: z.number().optional(),
});

export const tourPriceTierSchema = z.object({
  minPersonnes: z.number().int().min(1),
  maxPersonnes: z.number().int().min(1).optional(),
  reductionPourcentage: z.number().min(0).max(100),
});

export const hebergementPriceTierSchema = z.object({
  minNuits: z.number().int().min(1),
  maxNuits: z.number().int().min(1).optional(),
  reductionPourcentage: z.number().min(0).max(100),
});

// ─── Mapping pages singleType (depuis tools-content.js) ───────────────────

const PAGE_TYPE_MAP = {
  "circuit-general":          "/api/circuit-general",
  "circuit-prive":            "/api/circuit-prive",
  "circuit-demi-journee":     "/api/circuit-demi-journee",
  "circuit-4-4":              "/api/circuit-4-4",
  "circuit-vtt-quad":         "/api/circuit-vtt-quad",
  "circuit-nbre":             "/api/circuit-nbre",
  "circuits-senegal":         "/api/circuits-senegal",
  "hebergement":              "/api/hebergement",
  "hebergement-1etoile":      "/api/hebergement-1etoiles-senegal",
  "hebergement-2etoiles":     "/api/hebergement-2-etoiles-senegal",
  "hebergement-3etoiles":     "/api/hebergement-3-etoiles-senegal",
  "hebergement-4etoiles":     "/api/hebergement-4-etoiles-senegal",
  "hebergement-5etoiles":     "/api/hebergement-5-etoiles-senegal",
};

const pageTypeEnum = z.enum(Object.keys(PAGE_TYPE_MAP));

// ─── Mapping hébergements collectionType ───────────────────────────────────

const HEBERGEMENT_API = {
  hotel:     "/api/hotels",
  apartment: "/api/apartments",
  villa:     "/api/villas",
};

const hebergementKindEnum = z.enum(["hotel", "apartment", "villa"]);

// ─── Enum type tour ────────────────────────────────────────────────────────

const TOUR_TYPES = [
  "circuits privés", "circuits en 4x4", "circuit demi-journée", "croisières",
  "visites guidées", "visites bus", "circuits (5jours, 10 jours, 15 jours,30jours)",
  "circuits vtt et quad", "activités sportives", "en amoureux", "en famille",
  "excursions nature et découverte faune sauvage", "safaris", "parc djoudj",
  "réserve bandia", "lompoul", "marché kermel",
];

/**
 * Crée une instance McpServer avec tous les outils enregistrés. Appelée une fois
 * côté stdio (une seule instance pour tout le process), et une fois PAR REQUÊTE côté HTTP
 * (chaque session MCP distante a sa propre instance, pattern recommandé par le SDK).
 */
export function createArticleMcpServer() {
  const server = new McpServer({ name: "okooltrip-article-mcp", version: "2.0.0" });

  // ─── Catégories ────────────────────────────────────────────────────────────

  server.tool(
    "list_categories",
    "Liste les catégories d'articles existantes dans Strapi (id, name, slug). Utiliser l'id retourné comme categoryId dans create_article_draft.",
    { search: z.string().optional().describe("Filtre texte optionnel sur le nom de la catégorie") },
    async ({ search }) => {
      try {
        const query = search
          ? `?filters[name][$containsi]=${encodeURIComponent(search)}&pagination[pageSize]=50`
          : "?pagination[pageSize]=100";
        const body = await strapiRequest(`/api/categories${query}`);
        const categories = (body.data || []).map((c) => ({
          id: c.id,
          name: c.attributes?.name,
          slug: c.attributes?.slug,
          description: c.attributes?.description ?? null,
        }));
        return jsonResult(categories);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "create_category",
    "Crée une nouvelle catégorie d'articles dans Strapi. Retourne l'id créé.",
    {
      name: z.string().min(1).describe("Nom de la catégorie"),
      slug: z.string().optional().describe("Slug URL ; généré automatiquement à partir du nom si omis"),
      description: z.string().optional().describe("Description courte de la catégorie"),
    },
    async ({ name, slug, description }) => {
      try {
        const body = await strapiRequest("/api/categories", {
          method: "POST",
          body: JSON.stringify({
            data: {
              name,
              slug: slug?.trim() || slugify(name),
              ...(description ? { description } : {}),
            },
          }),
        });
        const id = body.data?.id;
        return jsonResult({
          status: "category_created",
          id,
          name: body.data?.attributes?.name,
          slug: body.data?.attributes?.slug,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "update_category",
    "Met à jour une catégorie existante par son id (nom, slug, description).",
    {
      id: z.number().int().describe("Id de la catégorie (obtenu via list_categories)"),
      name: z.string().min(1).optional().describe("Nouveau nom"),
      slug: z.string().optional().describe("Nouveau slug URL"),
      description: z.string().optional().describe("Nouvelle description"),
    },
    async ({ id, name, slug, description }) => {
      try {
        const data = {};
        if (name !== undefined) data.name = name;
        if (slug !== undefined) data.slug = slug;
        if (description !== undefined) data.description = description;

        const body = await strapiRequest(`/api/categories/${id}`, {
          method: "PUT",
          body: JSON.stringify({ data }),
        });
        return jsonResult({
          status: "category_updated",
          id: body.data?.id,
          name: body.data?.attributes?.name,
          slug: body.data?.attributes?.slug,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Auteurs ───────────────────────────────────────────────────────────────

  server.tool(
    "list_authors",
    "Liste les auteurs existants dans Strapi (id, name, email). Utiliser l'id retourné comme authorId dans create_article_draft.",
    { search: z.string().optional().describe("Filtre texte optionnel sur le nom de l'auteur") },
    async ({ search }) => {
      try {
        const query = search
          ? `?filters[name][$containsi]=${encodeURIComponent(search)}&pagination[pageSize]=50`
          : "?pagination[pageSize]=100";
        const body = await strapiRequest(`/api/authors${query}`);
        const authors = (body.data || []).map((a) => ({
          id: a.id,
          name: a.attributes?.name,
          email: a.attributes?.email,
          bio: a.attributes?.bio ?? null,
        }));
        return jsonResult(authors);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "create_author",
    "Crée un nouvel auteur dans Strapi. Retourne l'id créé.",
    {
      name: z.string().min(1).describe("Nom complet de l'auteur"),
      email: z.string().email().optional().describe("Adresse e-mail de l'auteur"),
      bio: z.string().optional().describe("Biographie courte"),
    },
    async ({ name, email, bio }) => {
      try {
        const body = await strapiRequest("/api/authors", {
          method: "POST",
          body: JSON.stringify({
            data: {
              name,
              ...(email ? { email } : {}),
              ...(bio ? { bio } : {}),
            },
          }),
        });
        const id = body.data?.id;
        return jsonResult({
          status: "author_created",
          id,
          name: body.data?.attributes?.name,
          email: body.data?.attributes?.email ?? null,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "update_author",
    "Met à jour un auteur existant par son id (nom, email, bio).",
    {
      id: z.number().int().describe("Id de l'auteur (obtenu via list_authors)"),
      name: z.string().min(1).optional().describe("Nouveau nom"),
      email: z.string().email().optional().describe("Nouvelle adresse e-mail"),
      bio: z.string().optional().describe("Nouvelle biographie"),
    },
    async ({ id, name, email, bio }) => {
      try {
        const data = {};
        if (name !== undefined) data.name = name;
        if (email !== undefined) data.email = email;
        if (bio !== undefined) data.bio = bio;

        const body = await strapiRequest(`/api/authors/${id}`, {
          method: "PUT",
          body: JSON.stringify({ data }),
        });
        return jsonResult({
          status: "author_updated",
          id: body.data?.id,
          name: body.data?.attributes?.name,
          email: body.data?.attributes?.email ?? null,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Articles ──────────────────────────────────────────────────────────────

  server.tool(
    "list_articles",
    "Liste les articles existants dans Strapi (brouillons inclus). Retourne id, titre, slug, statut (draft/published), catégorie et auteur. Utiliser l'id retourné avec get_article_draft ou update_article_draft.",
    {
      search: z.string().optional().describe("Filtre texte sur le titre de l'article"),
      categoryId: z.number().int().optional().describe("Filtrer par id de catégorie"),
      page: z.number().int().min(1).default(1).describe("Numéro de page (défaut : 1)"),
      pageSize: z.number().int().min(1).max(100).default(25).describe("Résultats par page (défaut : 25)"),
    },
    async ({ search, categoryId, page, pageSize }) => {
      try {
        const params = new URLSearchParams();
        params.set("publicationState", "preview");
        params.set("pagination[page]", String(page));
        params.set("pagination[pageSize]", String(pageSize));
        params.set("populate[category]", "true");
        params.set("populate[authorsBio]", "true");
        if (search) params.set("filters[title][$containsi]", search);
        if (categoryId) params.set("filters[category][id][$eq]", String(categoryId));

        const body = await strapiRequest(`/api/articles?${params.toString()}`);
        const articles = (body.data || []).map((a) => ({
          id: a.id,
          title: a.attributes?.title,
          slug: a.attributes?.slug,
          status: a.attributes?.publishedAt ? "published" : "draft",
          publishedAt: a.attributes?.publishedAt ?? null,
          category: a.attributes?.category?.data
            ? { id: a.attributes.category.data.id, name: a.attributes.category.data.attributes?.name }
            : null,
          author: a.attributes?.authorsBio?.data
            ? { id: a.attributes.authorsBio.data.id, name: a.attributes.authorsBio.data.attributes?.name }
            : null,
        }));
        return jsonResult({ articles, pagination: body.meta?.pagination });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_article_draft",
    "Relit un article complet par son id (titre, description, catégorie, auteur, contenu, SEO) pour vérification avant de le proposer aux responsables.",
    { id: z.number().int() },
    async ({ id }) => {
      try {
        // publicationState=preview est indispensable : un brouillon (publishedAt null)
        // n'est jamais retourné par /api/articles/:id sans ce paramètre.
        const body = await strapiRequest(
          `/api/articles/${id}?publicationState=preview&populate[category]=true&populate[authorsBio]=true&populate[seo]=true&populate[image]=true`
        );
        return jsonResult(body.data);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "create_article_draft",
    "Crée un nouvel article en BROUILLON dans Strapi, avec SEO (meta titre/description) et structure de données (JSON-LD Article) remplis automatiquement. Ne publie jamais — cet outil n'a pas la capacité de publier, quelle que soit la demande. Retourne l'id créé et le lien admin pour la relecture humaine.",
    {
      title: z.string().min(1),
      slug: z.string().optional().describe("Slug de l'URL ; généré automatiquement à partir du titre si omis"),
      description: z.string().min(1).describe("Résumé court / meta description de l'article"),
      categoryId: z.number().int().describe("Id obtenu via list_categories"),
      categoryName: z.string().optional().describe("Nom de la catégorie — utilisé pour la structure de données SEO (articleSection)"),
      authorId: z.number().int().optional().describe("Id obtenu via list_authors"),
      authorName: z.string().optional().describe("Nom de l'auteur — utilisé pour la structure de données SEO (authorName)"),
      coverId: z.number().int().optional().describe("Id d'une image existante dans la médiathèque Strapi à utiliser comme image de couverture"),
      contentBlocks: z
        .array(contentBlockSchema)
        .min(1)
        .describe(
          "Corps de l'article (champ ContenuArticle). Supporte heading, paragraph, list, quote, code. " +
          "Pour du texte riche (gras, italique, lien), utiliser le champ children avec des nœuds inline au lieu de text."
        ),
      faq: z.array(faqItemSchema).optional().describe("Questions/réponses optionnelles"),
      metaTitle: z.string().max(60).optional().describe("Titre SEO (balise <title>), 60 caractères max — reprend le titre si omis"),
      metaDescription: z.string().max(160).optional().describe("Meta description SEO, 160 caractères max — reprend description si omise"),
      keywords: z.array(z.string().min(1)).optional().describe("Mots-clés ciblés pour le référencement (3-6 recommandés)"),
      canonicalPath: z.string().optional().describe("Chemin relatif de la page finale, si connu — utilisé pour l'URL canonique"),
    },
    async ({ title, slug, description, categoryId, categoryName, authorId, authorName, coverId, contentBlocks, faq, metaTitle, metaDescription, keywords, canonicalPath }) => {
      try {
        const finalMetaTitle = (metaTitle || title).slice(0, 60);
        const finalMetaDescription = (metaDescription || description).slice(0, 160);
        const structuredData = {
          schemaType: "Article",
          headline: title,
          ...(categoryName ? { articleSection: categoryName } : {}),
          ...(authorName ? { authorName } : {}),
        };

        const payload = {
          data: {
            title,
            slug: slug?.trim() || slugify(title),
            publishedAt: null,
            description,
            category: categoryId,
            ...(authorId ? { authorsBio: authorId } : {}),
            ...(coverId ? { image: coverId } : {}),
            ContenuArticle: convertContentBlocks(contentBlocks),
            ...(faq?.length ? { Faq: convertFaq(faq) } : {}),
            seo: {
              metaTitle: finalMetaTitle,
              metaDescription: finalMetaDescription,
              ...(keywords?.length ? { keywords: keywords.join(", ") } : {}),
              ...(canonicalPath
                ? { canonicalURL: `https://okooltrip.sn${canonicalPath.startsWith("/") ? "" : "/"}${canonicalPath}` }
                : {}),
              structuredData,
              metaSocial: [
                { socialNetwork: "Facebook", title: finalMetaTitle, description: finalMetaDescription.slice(0, 65) },
                { socialNetwork: "Twitter", title: finalMetaTitle, description: finalMetaDescription.slice(0, 65) },
              ],
            },
            structuredData,
          },
        };
        const body = await strapiRequest("/api/articles", { method: "POST", body: JSON.stringify(payload) });
        const id = body.data?.id;
        const { STRAPI_URL } = getStrapiConfig();
        return jsonResult({
          status: "draft_created",
          id,
          title: body.data?.attributes?.title,
          reviewUrl: `${STRAPI_URL}/admin/content-manager/collection-types/api::article.article/${id}`,
          note: "Brouillon créé, non publié. Un responsable doit le relire et le publier manuellement dans l'admin Strapi.",
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "update_article_draft",
    "Met à jour un article existant par son id. Les champs SEO sont fusionnés avec l'existant (pas d'écrasement). " +
    "Si title est fourni sans slug, le slug est recalculé automatiquement. Ne publie jamais.",
    {
      id: z.number().int(),
      title: z.string().optional(),
      slug: z.string().optional().describe("Laisser vide pour recalculer automatiquement depuis le titre"),
      description: z.string().optional(),
      categoryId: z.number().int().optional(),
      categoryName: z.string().optional().describe("Met à jour articleSection dans structuredData SEO"),
      authorId: z.number().int().optional(),
      authorName: z.string().optional().describe("Met à jour authorName dans structuredData SEO"),
      coverId: z.number().int().optional().describe("Id médiathèque Strapi de la nouvelle image de couverture"),
      contentBlocks: z.array(contentBlockSchema).optional(),
      faq: z.array(faqItemSchema).optional(),
      metaTitle: z.string().max(60).optional(),
      metaDescription: z.string().max(160).optional(),
      keywords: z.array(z.string().min(1)).optional(),
      canonicalPath: z.string().optional(),
    },
    async ({ id, title, slug, description, categoryId, categoryName, authorId, authorName, coverId, contentBlocks, faq, metaTitle, metaDescription, keywords, canonicalPath }) => {
      try {
        const hasSeoUpdate = metaTitle !== undefined || metaDescription !== undefined ||
          keywords !== undefined || canonicalPath !== undefined ||
          title !== undefined || categoryName !== undefined || authorName !== undefined;

        const data = {};
        if (title !== undefined) data.title = title;
        if (slug !== undefined) data.slug = slug;
        else if (title !== undefined) data.slug = slugify(title);
        if (description !== undefined) data.description = description;
        if (categoryId !== undefined) data.category = categoryId;
        if (authorId !== undefined) data.authorsBio = authorId;
        if (coverId !== undefined) data.image = coverId;
        if (contentBlocks !== undefined) data.ContenuArticle = convertContentBlocks(contentBlocks);
        if (faq !== undefined) data.Faq = convertFaq(faq);

        if (hasSeoUpdate) {
          const current = await strapiRequest(`/api/articles/${id}?publicationState=preview&populate[seo]=true`);
          const currentAttrs = current.data?.attributes ?? {};
          const currentSeo = currentAttrs.seo ?? {};
          const currentStructuredData = currentAttrs.structuredData ?? {};

          const updatedStructuredData = {
            ...currentStructuredData,
            ...(title ? { headline: title } : {}),
            ...(categoryName ? { articleSection: categoryName } : {}),
            ...(authorName ? { authorName } : {}),
          };

          data.seo = {
            ...currentSeo,
            ...(metaTitle !== undefined ? { metaTitle: metaTitle.slice(0, 60) } : {}),
            ...(metaDescription !== undefined ? { metaDescription: metaDescription.slice(0, 160) } : {}),
            ...(keywords !== undefined ? { keywords: keywords.join(", ") } : {}),
            ...(canonicalPath !== undefined
              ? { canonicalURL: `https://okooltrip.sn${canonicalPath.startsWith("/") ? "" : "/"}${canonicalPath}` }
              : {}),
            structuredData: updatedStructuredData,
          };
          data.structuredData = updatedStructuredData;
        }

        const body = await strapiRequest(`/api/articles/${id}`, { method: "PUT", body: JSON.stringify({ data }) });
        return jsonResult({ status: "draft_updated", id: body.data?.id });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "delete_article_draft",
    "Supprime définitivement un brouillon par son id. Refuse la suppression si l'article est publié (publishedAt non null).",
    { id: z.number().int().describe("Id de l'article à supprimer") },
    async ({ id }) => {
      try {
        const check = await strapiRequest(
          `/api/articles/${id}?publicationState=preview&fields[0]=publishedAt&fields[1]=title`
        );
        const attrs = check.data?.attributes;
        if (!attrs) throw new Error(`Article ${id} introuvable.`);
        if (attrs.publishedAt) {
          return errorResult(
            `Refus : l'article "${attrs.title}" (id ${id}) est publié. ` +
            "Dépubliez-le d'abord depuis l'admin Strapi avant de le supprimer."
          );
        }

        await strapiRequest(`/api/articles/${id}`, { method: "DELETE" });
        return jsonResult({ status: "draft_deleted", id, title: attrs.title });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGES SINGLETYPE (circuits & hébergements — contenu SEO éditorial)
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "get_page",
    "Lit le contenu éditorial d'une page singleType Strapi (circuit ou hébergement) : ContenuAvant, ContenuApres, Faq et SEO. " +
    `Types disponibles : ${Object.keys(PAGE_TYPE_MAP).join(", ")}.`,
    { pageType: pageTypeEnum.describe("Type de page singleType à lire") },
    async ({ pageType }) => {
      try {
        const apiPath = PAGE_TYPE_MAP[pageType];
        const body = await strapiRequest(`${apiPath}?populate[Seo]=true`);
        return jsonResult(body.data);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "update_page",
    "Met à jour le contenu éditorial d'une page singleType Strapi (circuit ou hébergement). " +
    "Champs SEO fusionnés avec l'existant. Seuls les champs fournis sont modifiés.",
    {
      pageType: pageTypeEnum.describe("Type de page singleType à modifier"),
      contenuAvant: z.array(contentBlockSchema).optional().describe("Contenu affiché avant le tableau de données"),
      contenuApres: z.array(contentBlockSchema).optional().describe("Contenu affiché après le tableau de données"),
      faq: z.array(faqItemSchema).optional().describe("Questions / réponses de la FAQ"),
      metaTitle: z.string().max(60).optional(),
      metaDescription: z.string().max(160).optional(),
      keywords: z.array(z.string()).optional(),
      canonicalPath: z.string().optional().describe("Chemin relatif pour l'URL canonique"),
    },
    async ({ pageType, contenuAvant, contenuApres, faq, metaTitle, metaDescription, keywords, canonicalPath }) => {
      try {
        const apiPath = PAGE_TYPE_MAP[pageType];
        const hasSeo = metaTitle !== undefined || metaDescription !== undefined || keywords !== undefined || canonicalPath !== undefined;
        const data = {};

        if (contenuAvant !== undefined) data.ContenuAvant = convertContentBlocks(contenuAvant);
        if (contenuApres !== undefined) data.ContenuApres = convertContentBlocks(contenuApres);
        if (faq !== undefined) data.Faq = convertFaq(faq);

        if (hasSeo) {
          const current = await strapiRequest(`${apiPath}?populate[Seo]=true`);
          const currentSeo = current.data?.attributes?.Seo ?? {};
          data.Seo = {
            ...currentSeo,
            ...(metaTitle !== undefined ? { metaTitle } : {}),
            ...(metaDescription !== undefined ? { metaDescription } : {}),
            ...(keywords !== undefined ? { keywords: keywords.join(", ") } : {}),
            ...(canonicalPath !== undefined
              ? { canonicalURL: `https://okooltrip.sn${canonicalPath.startsWith("/") ? "" : "/"}${canonicalPath}` }
              : {}),
          };
        }

        await strapiRequest(apiPath, { method: "PUT", body: JSON.stringify({ data }) });
        return jsonResult({ status: "page_updated", pageType });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TOURS (circuits)
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "list_tours",
    "Liste les circuits (tours) existants dans Strapi. Retourne id, titre, type, prix, durée, statut de publication, guide.",
    {
      search: z.string().optional().describe("Filtre texte sur le titre"),
      type: z.enum(TOUR_TYPES).optional().describe("Filtrer par type de circuit"),
      guideId: z.number().int().optional().describe("Filtrer par id de guide"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
    },
    async ({ search, type, guideId, page, pageSize }) => {
      try {
        const params = new URLSearchParams();
        params.set("publicationState", "preview");
        params.set("pagination[page]", String(page));
        params.set("pagination[pageSize]", String(pageSize));
        params.set("populate[guide]", "true");
        params.set("populate[theme]", "true");
        if (search) params.set("filters[title][$containsi]", search);
        if (type) params.set("filters[type][$eq]", type);
        if (guideId) params.set("filters[guide][id][$eq]", String(guideId));

        const body = await strapiRequest(`/api/tours?${params}`);
        const tours = (body.data || []).map((t) => ({
          id: t.id,
          title: t.attributes?.title,
          slug: t.attributes?.slug,
          type: t.attributes?.type,
          price: t.attributes?.price,
          duration: t.attributes?.duration,
          status: t.attributes?.publishedAt ? "published" : "draft",
          is_private: t.attributes?.is_private,
          guide: t.attributes?.guide?.data
            ? { id: t.attributes.guide.data.id, name: t.attributes.guide.data.attributes?.name }
            : null,
        }));
        return jsonResult({ tours, pagination: body.meta?.pagination });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_tour",
    "Lit un circuit (tour) complet par son id (tous les champs, blocs de contenu, SEO, guide, priceTiers).",
    { id: z.number().int() },
    async ({ id }) => {
      try {
        const params = "publicationState=preview&populate[guide]=true&populate[theme]=true&populate[lieuses]=true&populate[priceTiers]=true&populate[seo]=true&populate[image]=true&populate[gallery]=true";
        const body = await strapiRequest(`/api/tours/${id}?${params}`);
        return jsonResult(body.data);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "create_tour",
    "Crée un nouveau circuit (tour) en brouillon dans Strapi. Ne publie jamais. Retourne l'id créé et le lien admin.",
    {
      title: z.string().min(1),
      slug: z.string().optional().describe("Généré automatiquement depuis le titre si omis"),
      resum: z.string().optional().describe("Résumé court affiché dans les cards"),
      type: z.enum(TOUR_TYPES).optional(),
      price: z.number().int().min(0).optional().describe("Prix en XOF"),
      duration: z.number().int().min(1).optional().describe("Durée en jours"),
      startDate: z.string().optional().describe("Date de début ISO 8601 (ex: 2026-12-01T08:00:00.000Z)"),
      endDate: z.string().optional().describe("Date de fin ISO 8601"),
      is_private: z.boolean().optional().default(false),
      min_participants: z.number().int().min(1).optional().default(1),
      max_participants: z.number().int().min(1).optional().default(20),
      guideId: z.number().int().optional().describe("Id obtenu via list_guides"),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      Adresse: z.string().optional(),
      promo: z.boolean().optional(),
      discountPercentage: z.number().min(0).max(100).optional(),
      // Blocs de contenu
      description: z.array(contentBlockSchema).optional().describe("Description principale du circuit"),
      Infos: z.array(contentBlockSchema).optional().describe("Informations pratiques clés"),
      A_propos: z.array(contentBlockSchema).optional().describe("À propos du circuit"),
      Inclus: z.array(contentBlockSchema).optional().describe("Ce qui est inclus dans le prix"),
      Ce_qui_est_exclus: z.array(contentBlockSchema).optional().describe("Ce qui n'est pas inclus"),
      Depart_et_Retour: z.array(contentBlockSchema).optional().describe("Informations départ / retour"),
      Accessibilite: z.array(contentBlockSchema).optional().describe("Accessibilité et conditions physiques"),
      Conditions_d_annulation: z.array(contentBlockSchema).optional().describe("Politique d'annulation"),
      Faq: z.array(faqItemSchema).optional().describe("Questions / réponses FAQ"),
      // Paliers tarifaires
      priceTiers: z.array(tourPriceTierSchema).optional().describe("Réductions selon le nombre de participants"),
      // SEO
      metaTitle: z.string().max(60).optional(),
      metaDescription: z.string().max(160).optional(),
      keywords: z.array(z.string()).optional(),
      canonicalPath: z.string().optional(),
    },
    async (params) => {
      try {
        const { title, slug, metaTitle, metaDescription, keywords, canonicalPath, Faq, priceTiers, guideId, ...rest } = params;
        const finalSlug = slug?.trim() || slugify(title);
        const finalMetaTitle = (metaTitle || title).slice(0, 60);
        const finalMetaDescription = (metaDescription || rest.resum || "").slice(0, 160);

        const data = {
          title,
          slug: finalSlug,
          publishedAt: null,
          ...(rest.resum !== undefined ? { resum: rest.resum } : {}),
          ...(rest.type !== undefined ? { type: rest.type } : {}),
          ...(rest.price !== undefined ? { price: rest.price } : {}),
          ...(rest.duration !== undefined ? { duration: rest.duration } : {}),
          ...(rest.startDate !== undefined ? { startDate: rest.startDate } : {}),
          ...(rest.endDate !== undefined ? { endDate: rest.endDate } : {}),
          ...(rest.is_private !== undefined ? { is_private: rest.is_private } : {}),
          ...(rest.min_participants !== undefined ? { min_participants: rest.min_participants } : {}),
          ...(rest.max_participants !== undefined ? { max_participants: rest.max_participants } : {}),
          ...(guideId ? { guide: guideId } : {}),
          ...(rest.latitude !== undefined ? { latitude: rest.latitude } : {}),
          ...(rest.longitude !== undefined ? { longitude: rest.longitude } : {}),
          ...(rest.Adresse !== undefined ? { Adresse: rest.Adresse } : {}),
          ...(rest.promo !== undefined ? { promo: rest.promo } : {}),
          ...(rest.discountPercentage !== undefined ? { discountPercentage: rest.discountPercentage } : {}),
          ...(rest.description !== undefined ? { description: convertContentBlocks(rest.description) } : {}),
          ...(rest.Infos !== undefined ? { Infos: convertContentBlocks(rest.Infos) } : {}),
          ...(rest.A_propos !== undefined ? { A_propos: convertContentBlocks(rest.A_propos) } : {}),
          ...(rest.Inclus !== undefined ? { Inclus: convertContentBlocks(rest.Inclus) } : {}),
          ...(rest.Ce_qui_est_exclus !== undefined ? { Ce_qui_est_exclus: convertContentBlocks(rest.Ce_qui_est_exclus) } : {}),
          ...(rest.Depart_et_Retour !== undefined ? { Depart_et_Retour: convertContentBlocks(rest.Depart_et_Retour) } : {}),
          ...(rest.Accessibilite !== undefined ? { Accessibilite: convertContentBlocks(rest.Accessibilite) } : {}),
          ...(rest.Conditions_d_annulation !== undefined ? { Conditions_d_annulation: convertContentBlocks(rest.Conditions_d_annulation) } : {}),
          ...(Faq?.length ? { Faq: convertFaq(Faq) } : {}),
          ...(priceTiers?.length ? { priceTiers } : {}),
          seo: {
            metaTitle: finalMetaTitle,
            metaDescription: finalMetaDescription,
            ...(keywords?.length ? { keywords: keywords.join(", ") } : {}),
            ...(canonicalPath ? { canonicalURL: `https://okooltrip.sn${canonicalPath.startsWith("/") ? "" : "/"}${canonicalPath}` } : {}),
          },
        };

        const body = await strapiRequest("/api/tours", { method: "POST", body: JSON.stringify({ data }) });
        const id = body.data?.id;
        const { STRAPI_URL } = getStrapiConfig();
        return jsonResult({
          status: "tour_created",
          id,
          title: body.data?.attributes?.title,
          reviewUrl: `${STRAPI_URL}/admin/content-manager/collection-types/api::tour.tour/${id}`,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "update_tour",
    "Met à jour un circuit existant par son id. Champs SEO fusionnés. Si title fourni sans slug, slug recalculé. Ne publie jamais.",
    {
      id: z.number().int(),
      title: z.string().optional(),
      slug: z.string().optional(),
      resum: z.string().optional(),
      type: z.enum(TOUR_TYPES).optional(),
      price: z.number().int().min(0).optional(),
      duration: z.number().int().min(1).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      is_private: z.boolean().optional(),
      min_participants: z.number().int().min(1).optional(),
      max_participants: z.number().int().min(1).optional(),
      guideId: z.number().int().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      Adresse: z.string().optional(),
      promo: z.boolean().optional(),
      discountPercentage: z.number().min(0).max(100).optional(),
      description: z.array(contentBlockSchema).optional(),
      Infos: z.array(contentBlockSchema).optional(),
      A_propos: z.array(contentBlockSchema).optional(),
      Inclus: z.array(contentBlockSchema).optional(),
      Ce_qui_est_exclus: z.array(contentBlockSchema).optional(),
      Depart_et_Retour: z.array(contentBlockSchema).optional(),
      Accessibilite: z.array(contentBlockSchema).optional(),
      Conditions_d_annulation: z.array(contentBlockSchema).optional(),
      Faq: z.array(faqItemSchema).optional(),
      priceTiers: z.array(tourPriceTierSchema).optional(),
      metaTitle: z.string().max(60).optional(),
      metaDescription: z.string().max(160).optional(),
      keywords: z.array(z.string()).optional(),
      canonicalPath: z.string().optional(),
    },
    async ({ id, title, slug, metaTitle, metaDescription, keywords, canonicalPath, Faq, priceTiers, guideId, ...rest }) => {
      try {
        const hasSeo = metaTitle !== undefined || metaDescription !== undefined || keywords !== undefined || canonicalPath !== undefined || title !== undefined;
        const data = {};

        if (title !== undefined) data.title = title;
        if (slug !== undefined) data.slug = slug;
        else if (title !== undefined) data.slug = slugify(title);
        if (rest.resum !== undefined) data.resum = rest.resum;
        if (rest.type !== undefined) data.type = rest.type;
        if (rest.price !== undefined) data.price = rest.price;
        if (rest.duration !== undefined) data.duration = rest.duration;
        if (rest.startDate !== undefined) data.startDate = rest.startDate;
        if (rest.endDate !== undefined) data.endDate = rest.endDate;
        if (rest.is_private !== undefined) data.is_private = rest.is_private;
        if (rest.min_participants !== undefined) data.min_participants = rest.min_participants;
        if (rest.max_participants !== undefined) data.max_participants = rest.max_participants;
        if (guideId !== undefined) data.guide = guideId;
        if (rest.latitude !== undefined) data.latitude = rest.latitude;
        if (rest.longitude !== undefined) data.longitude = rest.longitude;
        if (rest.Adresse !== undefined) data.Adresse = rest.Adresse;
        if (rest.promo !== undefined) data.promo = rest.promo;
        if (rest.discountPercentage !== undefined) data.discountPercentage = rest.discountPercentage;
        if (rest.description !== undefined) data.description = convertContentBlocks(rest.description);
        if (rest.Infos !== undefined) data.Infos = convertContentBlocks(rest.Infos);
        if (rest.A_propos !== undefined) data.A_propos = convertContentBlocks(rest.A_propos);
        if (rest.Inclus !== undefined) data.Inclus = convertContentBlocks(rest.Inclus);
        if (rest.Ce_qui_est_exclus !== undefined) data.Ce_qui_est_exclus = convertContentBlocks(rest.Ce_qui_est_exclus);
        if (rest.Depart_et_Retour !== undefined) data.Depart_et_Retour = convertContentBlocks(rest.Depart_et_Retour);
        if (rest.Accessibilite !== undefined) data.Accessibilite = convertContentBlocks(rest.Accessibilite);
        if (rest.Conditions_d_annulation !== undefined) data.Conditions_d_annulation = convertContentBlocks(rest.Conditions_d_annulation);
        if (Faq !== undefined) data.Faq = convertFaq(Faq);
        if (priceTiers !== undefined) data.priceTiers = priceTiers;

        if (hasSeo) {
          const current = await strapiRequest(`/api/tours/${id}?publicationState=preview&populate[seo]=true`);
          const currentSeo = current.data?.attributes?.seo ?? {};
          data.seo = {
            ...currentSeo,
            ...(metaTitle !== undefined ? { metaTitle: metaTitle.slice(0, 60) } : title !== undefined ? { metaTitle: title.slice(0, 60) } : {}),
            ...(metaDescription !== undefined ? { metaDescription: metaDescription.slice(0, 160) } : {}),
            ...(keywords !== undefined ? { keywords: keywords.join(", ") } : {}),
            ...(canonicalPath !== undefined ? { canonicalURL: `https://okooltrip.sn${canonicalPath.startsWith("/") ? "" : "/"}${canonicalPath}` } : {}),
          };
        }

        const body = await strapiRequest(`/api/tours/${id}`, { method: "PUT", body: JSON.stringify({ data }) });
        return jsonResult({ status: "tour_updated", id: body.data?.id });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "delete_tour",
    "Supprime définitivement un circuit par son id. Refuse si des réservations sont liées.",
    { id: z.number().int() },
    async ({ id }) => {
      try {
        const check = await strapiRequest(`/api/tours/${id}?publicationState=preview&fields[0]=title&populate[reservations][fields][0]=id`);
        const attrs = check.data?.attributes;
        if (!attrs) throw new Error(`Tour ${id} introuvable.`);

        const reservationCount = attrs.reservations?.data?.length ?? 0;
        if (reservationCount > 0) {
          return errorResult(`Refus : le circuit "${attrs.title}" (id ${id}) a ${reservationCount} réservation(s) liée(s). Annulez-les d'abord depuis l'admin Strapi.`);
        }

        await strapiRequest(`/api/tours/${id}`, { method: "DELETE" });
        return jsonResult({ status: "tour_deleted", id, title: attrs.title });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // HÉBERGEMENTS — Hotel / Apartment / Villa (collectionType)
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "list_hebergements",
    "Liste les hébergements existants dans Strapi. kind = hotel | apartment | villa.",
    {
      kind: hebergementKindEnum.describe("Type d'hébergement : hotel, apartment ou villa"),
      city: z.string().optional().describe("Filtrer par ville"),
      status: z.enum(["active", "inactive", "maintenance", "available", "booked"]).optional(),
      search: z.string().optional().describe("Filtre texte sur le nom"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
    },
    async ({ kind, city, status, search, page, pageSize }) => {
      try {
        const apiPath = HEBERGEMENT_API[kind];
        const params = new URLSearchParams();
        params.set("publicationState", "preview");
        params.set("pagination[page]", String(page));
        params.set("pagination[pageSize]", String(pageSize));
        if (city) params.set("filters[city][$containsi]", city);
        if (status) params.set("filters[status][$eq]", status);
        if (search) params.set("filters[name][$containsi]", search);

        const body = await strapiRequest(`${apiPath}?${params}`);
        const items = (body.data || []).map((h) => ({
          id: h.id,
          name: h.attributes?.name,
          slug: h.attributes?.slug,
          city: h.attributes?.city,
          status: h.attributes?.status,
          rating: h.attributes?.rating,
          publishedAt: h.attributes?.publishedAt ?? null,
          ...(kind === "apartment" || kind === "villa"
            ? { price_per_night: h.attributes?.price_per_night, apartment_type: h.attributes?.apartment_type }
            : {}),
        }));
        return jsonResult({ kind, items, pagination: body.meta?.pagination });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_hebergement",
    "Lit un hébergement complet par kind (hotel|apartment|villa) et id.",
    {
      kind: hebergementKindEnum,
      id: z.number().int(),
    },
    async ({ kind, id }) => {
      try {
        const apiPath = HEBERGEMENT_API[kind];
        // Utiliser populate= (virgules) compatible avec le controller custom hotel
        const params = "publicationState=preview&populate=amenities,services,priceTiers,Seo,images,contact,policies,rooms";
        const body = await strapiRequest(`${apiPath}/${id}?${params}`);
        return jsonResult(body.data);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "create_hotel",
    "Crée un nouvel hôtel dans Strapi. Ne publie jamais. Retourne l'id créé et le lien admin.",
    {
      name: z.string().min(1).max(255),
      description: z.string().min(1).describe("Description en markdown (richtext)"),
      address: z.string().min(1),
      city: z.string().min(1),
      country: z.string().default("Sénégal"),
      Adresse: z.string().optional().describe("Adresse courte affichée sur le site"),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      status: z.enum(["active", "inactive", "maintenance"]).optional().default("active"),
      featured: z.boolean().optional().default(false),
      check_in_time: z.string().optional().default("15:00").describe("Format HH:MM"),
      check_out_time: z.string().optional().default("11:00").describe("Format HH:MM"),
      pets_allowed: z.boolean().optional().default(false),
      children_allowed: z.boolean().optional().default(true),
      promo: z.boolean().optional(),
      discountPercentage: z.number().int().min(0).max(100).optional(),
      amenities: z.array(amenitySchema).optional(),
      services: z.array(serviceSchema).optional(),
      priceTiers: z.array(hebergementPriceTierSchema).optional(),
      contact: z.object({
        phone: z.string().optional(),
        email: z.string().email().optional(),
        website: z.string().optional(),
        manager_name: z.string().optional(),
        reception_hours: z.string().optional().default("24/7"),
      }).optional(),
      metaTitle: z.string().max(60).optional(),
      metaDescription: z.string().max(160).optional(),
      keywords: z.array(z.string()).optional(),
      canonicalPath: z.string().optional(),
    },
    async ({ name, description, address, city, country, metaTitle, metaDescription, keywords, canonicalPath, amenities, services, priceTiers, contact, check_in_time, check_out_time, ...rest }) => {
      try {
        const finalMetaTitle = (metaTitle || name).slice(0, 60);
        const finalMetaDescription = (metaDescription || description.slice(0, 160));
        const data = {
          name,
          slug: slugify(name),
          publishedAt: null,
          description,
          address,
          city,
          country: country || "Sénégal",
          ...(check_in_time !== undefined ? { check_in_time: formatTime(check_in_time) } : {}),
          ...(check_out_time !== undefined ? { check_out_time: formatTime(check_out_time) } : {}),
          ...rest,
          ...(amenities?.length ? { amenities } : {}),
          ...(services?.length ? { services } : {}),
          ...(priceTiers?.length ? { priceTiers } : {}),
          ...(contact ? { contact } : {}),
          Seo: {
            metaTitle: finalMetaTitle,
            metaDescription: finalMetaDescription,
            ...(keywords?.length ? { keywords: keywords.join(", ") } : {}),
            ...(canonicalPath ? { canonicalURL: `https://okooltrip.sn${canonicalPath.startsWith("/") ? "" : "/"}${canonicalPath}` } : {}),
          },
        };

        const body = await strapiRequest("/api/hotels", { method: "POST", body: JSON.stringify({ data }) });
        const id = body.data?.id;
        const { STRAPI_URL } = getStrapiConfig();
        return jsonResult({
          status: "hotel_created",
          id,
          name: body.data?.attributes?.name,
          reviewUrl: `${STRAPI_URL}/admin/content-manager/collection-types/api::hotel.hotel/${id}`,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "create_apartment",
    "Crée un nouvel appartement dans Strapi (apartment_type: studio|apartment|loft|duplex|penthouse|villa). Ne publie jamais.",
    {
      name: z.string().min(1).max(255),
      description: z.string().min(1).describe("Description en markdown (richtext)"),
      address: z.string().min(1),
      city: z.string().min(1),
      country: z.string().default("Sénégal"),
      price_per_night: z.number().min(0),
      capacity: z.number().int().min(1).max(20),
      bedrooms: z.number().int().min(0),
      bathrooms: z.number().int().min(1),
      apartment_type: z.enum(["studio", "apartment", "loft", "duplex", "penthouse", "villa"]),
      Adresse: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      size: z.number().min(0).optional().describe("Surface en m²"),
      status: z.enum(["available", "booked", "maintenance"]).optional().default("available"),
      featured: z.boolean().optional().default(false),
      floor: z.number().int().optional(),
      elevator: z.boolean().optional().default(false),
      balcony: z.boolean().optional().default(false),
      terrace: z.boolean().optional().default(false),
      parking: z.boolean().optional().default(false),
      pets_allowed: z.boolean().optional().default(false),
      children_allowed: z.boolean().optional().default(true),
      check_in_time: z.string().optional().default("15:00"),
      check_out_time: z.string().optional().default("11:00"),
      promo: z.boolean().optional(),
      discountPercentage: z.number().int().min(0).max(100).optional(),
      amenities: z.array(amenitySchema).optional(),
      services: z.array(serviceSchema).optional(),
      priceTiers: z.array(hebergementPriceTierSchema).optional(),
      contact: z.object({
        phone: z.string().optional(),
        email: z.string().email().optional(),
        owner_name: z.string().optional(),
        emergency_contact: z.string().optional(),
      }).optional(),
      metaTitle: z.string().max(60).optional(),
      metaDescription: z.string().max(160).optional(),
      keywords: z.array(z.string()).optional(),
      canonicalPath: z.string().optional(),
    },
    async ({ name, description, address, city, country, metaTitle, metaDescription, keywords, canonicalPath, amenities, services, priceTiers, contact, check_in_time, check_out_time, ...rest }) => {
      try {
        const finalMetaTitle = (metaTitle || name).slice(0, 60);
        const data = {
          name,
          slug: slugify(name),
          publishedAt: null,
          description,
          address,
          city,
          country: country || "Sénégal",
          ...(check_in_time !== undefined ? { check_in_time: formatTime(check_in_time) } : {}),
          ...(check_out_time !== undefined ? { check_out_time: formatTime(check_out_time) } : {}),
          ...rest,
          ...(amenities?.length ? { amenities } : {}),
          ...(services?.length ? { services } : {}),
          ...(priceTiers?.length ? { priceTiers } : {}),
          ...(contact ? { contact } : {}),
          Seo: {
            metaTitle: finalMetaTitle,
            metaDescription: (metaDescription || description).slice(0, 160),
            ...(keywords?.length ? { keywords: keywords.join(", ") } : {}),
            ...(canonicalPath ? { canonicalURL: `https://okooltrip.sn${canonicalPath.startsWith("/") ? "" : "/"}${canonicalPath}` } : {}),
          },
        };

        const body = await strapiRequest("/api/apartments", { method: "POST", body: JSON.stringify({ data }) });
        const id = body.data?.id;
        const { STRAPI_URL } = getStrapiConfig();
        return jsonResult({
          status: "apartment_created",
          id,
          name: body.data?.attributes?.name,
          reviewUrl: `${STRAPI_URL}/admin/content-manager/collection-types/api::apartment.apartment/${id}`,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "create_villa",
    "Crée une nouvelle villa dans Strapi (apartment_type doit être 'villa'). Ne publie jamais.",
    {
      name: z.string().min(1).max(255),
      description: z.string().min(1),
      address: z.string().min(1),
      city: z.string().min(1),
      country: z.string().default("Sénégal"),
      price_per_night: z.number().min(0),
      capacity: z.number().int().min(1).max(20),
      bedrooms: z.number().int().min(0),
      bathrooms: z.number().int().min(1),
      Adresse: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      size: z.number().min(0).optional(),
      status: z.enum(["available", "booked", "maintenance"]).optional().default("available"),
      featured: z.boolean().optional().default(false),
      balcony: z.boolean().optional().default(false),
      terrace: z.boolean().optional().default(false),
      parking: z.boolean().optional().default(false),
      pets_allowed: z.boolean().optional().default(false),
      children_allowed: z.boolean().optional().default(true),
      check_in_time: z.string().optional().default("15:00"),
      check_out_time: z.string().optional().default("11:00"),
      promo: z.boolean().optional(),
      discountPercentage: z.number().int().min(0).max(100).optional(),
      amenities: z.array(amenitySchema).optional(),
      services: z.array(serviceSchema).optional(),
      priceTiers: z.array(hebergementPriceTierSchema).optional(),
      contact: z.object({
        phone: z.string().optional(),
        email: z.string().email().optional(),
        owner_name: z.string().optional(),
        emergency_contact: z.string().optional(),
      }).optional(),
      metaTitle: z.string().max(60).optional(),
      metaDescription: z.string().max(160).optional(),
      keywords: z.array(z.string()).optional(),
      canonicalPath: z.string().optional(),
    },
    async ({ name, description, address, city, country, metaTitle, metaDescription, keywords, canonicalPath, amenities, services, priceTiers, contact, check_in_time, check_out_time, ...rest }) => {
      try {
        const data = {
          name,
          slug: slugify(name),
          publishedAt: null,
          description,
          address,
          city,
          country: country || "Sénégal",
          apartment_type: "villa",
          ...(check_in_time !== undefined ? { check_in_time: formatTime(check_in_time) } : {}),
          ...(check_out_time !== undefined ? { check_out_time: formatTime(check_out_time) } : {}),
          ...rest,
          ...(amenities?.length ? { amenities } : {}),
          ...(services?.length ? { services } : {}),
          ...(priceTiers?.length ? { priceTiers } : {}),
          ...(contact ? { contact } : {}),
          Seo: {
            metaTitle: (metaTitle || name).slice(0, 60),
            metaDescription: (metaDescription || description).slice(0, 160),
            ...(keywords?.length ? { keywords: keywords.join(", ") } : {}),
            ...(canonicalPath ? { canonicalURL: `https://okooltrip.sn${canonicalPath.startsWith("/") ? "" : "/"}${canonicalPath}` } : {}),
          },
        };

        const body = await strapiRequest("/api/villas", { method: "POST", body: JSON.stringify({ data }) });
        const id = body.data?.id;
        const { STRAPI_URL } = getStrapiConfig();
        return jsonResult({
          status: "villa_created",
          id,
          name: body.data?.attributes?.name,
          reviewUrl: `${STRAPI_URL}/admin/content-manager/collection-types/api::villa.villa/${id}`,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "update_hebergement",
    "Met à jour un hébergement existant (hotel|apartment|villa) par kind et id. Tous les champs optionnels. SEO fusionné. Slug recalculé si name change sans slug explicite.",
    {
      kind: hebergementKindEnum,
      id: z.number().int(),
      name: z.string().optional(),
      slug: z.string().optional(),
      description: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      Adresse: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      price_per_night: z.number().min(0).optional().describe("Apartment/Villa seulement"),
      capacity: z.number().int().optional(),
      bedrooms: z.number().int().optional(),
      bathrooms: z.number().int().optional(),
      size: z.number().optional(),
      status: z.enum(["active", "inactive", "maintenance", "available", "booked"]).optional(),
      featured: z.boolean().optional(),
      check_in_time: z.string().optional(),
      check_out_time: z.string().optional(),
      pets_allowed: z.boolean().optional(),
      children_allowed: z.boolean().optional(),
      promo: z.boolean().optional(),
      discountPercentage: z.number().int().min(0).max(100).optional(),
      amenities: z.array(amenitySchema).optional(),
      services: z.array(serviceSchema).optional(),
      priceTiers: z.array(hebergementPriceTierSchema).optional(),
      metaTitle: z.string().max(60).optional(),
      metaDescription: z.string().max(160).optional(),
      keywords: z.array(z.string()).optional(),
      canonicalPath: z.string().optional(),
    },
    async ({ kind, id, name, slug, metaTitle, metaDescription, keywords, canonicalPath, amenities, services, priceTiers, check_in_time, check_out_time, ...rest }) => {
      try {
        const apiPath = HEBERGEMENT_API[kind];
        if (check_in_time !== undefined) rest.check_in_time = formatTime(check_in_time);
        if (check_out_time !== undefined) rest.check_out_time = formatTime(check_out_time);
        const hasSeo = metaTitle !== undefined || metaDescription !== undefined || keywords !== undefined || canonicalPath !== undefined || name !== undefined;
        const data = {};

        if (name !== undefined) data.name = name;
        if (slug !== undefined) data.slug = slug;
        else if (name !== undefined) data.slug = slugify(name);
        Object.entries(rest).forEach(([k, v]) => { if (v !== undefined) data[k] = v; });
        if (amenities !== undefined) data.amenities = amenities;
        if (services !== undefined) data.services = services;
        if (priceTiers !== undefined) data.priceTiers = priceTiers;

        if (hasSeo) {
          const current = await strapiRequest(`${apiPath}/${id}?publicationState=preview&populate[Seo]=true`);
          const currentSeo = current.data?.attributes?.Seo ?? {};
          data.Seo = {
            ...currentSeo,
            ...(metaTitle !== undefined ? { metaTitle: metaTitle.slice(0, 60) } : name !== undefined ? { metaTitle: name.slice(0, 60) } : {}),
            ...(metaDescription !== undefined ? { metaDescription: metaDescription.slice(0, 160) } : {}),
            ...(keywords !== undefined ? { keywords: keywords.join(", ") } : {}),
            ...(canonicalPath !== undefined ? { canonicalURL: `https://okooltrip.sn${canonicalPath.startsWith("/") ? "" : "/"}${canonicalPath}` } : {}),
          };
        }

        const body = await strapiRequest(`${apiPath}/${id}`, { method: "PUT", body: JSON.stringify({ data }) });
        return jsonResult({ status: "hebergement_updated", kind, id: body.data?.id });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "delete_hebergement",
    "Supprime définitivement un hébergement (hotel|apartment|villa) par kind et id.",
    {
      kind: hebergementKindEnum,
      id: z.number().int(),
    },
    async ({ kind, id }) => {
      try {
        const apiPath = HEBERGEMENT_API[kind];
        const check = await strapiRequest(`${apiPath}/${id}?publicationState=preview&fields[0]=name`);
        if (!check.data) throw new Error(`${kind} ${id} introuvable.`);
        const name = check.data?.attributes?.name ?? check.data?.name ?? `${kind} #${id}`;

        await strapiRequest(`${apiPath}/${id}`, { method: "DELETE" });
        return jsonResult({ status: "hebergement_deleted", kind, id, name });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ROOMS (chambres d'hôtel)
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "list_rooms",
    "Liste les chambres existantes dans Strapi, avec filtre optionnel par hôtel.",
    {
      hotelId: z.number().int().optional().describe("Filtrer par id d'hôtel"),
      available: z.boolean().optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
    },
    async ({ hotelId, available, page, pageSize }) => {
      try {
        const params = new URLSearchParams();
        params.set("pagination[page]", String(page));
        params.set("pagination[pageSize]", String(pageSize));
        if (hotelId) params.set("filters[hotel][id][$eq]", String(hotelId));
        if (available !== undefined) params.set("filters[available][$eq]", String(available));

        const body = await strapiRequest(`/api/rooms?${params}`);
        const rooms = (body.data || []).map((r) => ({
          id: r.id,
          name: r.attributes?.name,
          room_type: r.attributes?.room_type,
          bed_type: r.attributes?.bed_type,
          price_per_night: r.attributes?.price_per_night,
          capacity: r.attributes?.capacity,
          available: r.attributes?.available,
          quantity: r.attributes?.quantity,
        }));
        return jsonResult({ rooms, pagination: body.meta?.pagination });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "create_room",
    "Crée une nouvelle chambre dans Strapi et l'associe à un hôtel.",
    {
      name: z.string().min(1).max(255),
      description: z.string().min(1),
      price_per_night: z.number().min(0),
      capacity: z.number().int().min(1).max(20),
      max_occupancy: z.number().int().min(1),
      room_type: z.enum(["single", "double", "twin", "triple", "quad", "suite", "deluxe", "standard"]),
      bed_type: z.enum(["single", "double", "queen", "king", "twin", "sofa_bed"]),
      hotelId: z.number().int().describe("Id de l'hôtel auquel associer la chambre"),
      bed_count: z.number().int().min(1).optional().default(1),
      room_size: z.number().min(0).optional().describe("Surface en m²"),
      room_number: z.string().optional(),
      floor: z.number().int().optional(),
      view: z.enum(["sea", "mountain", "city", "garden", "pool", "courtyard", "street"]).optional(),
      available: z.boolean().optional().default(true),
      quantity: z.number().int().min(1).optional().default(1),
      accessibility: z.boolean().optional().default(false),
      smoking_allowed: z.boolean().optional().default(false),
      amenities: z.array(amenitySchema).optional(),
    },
    async ({ hotelId, amenities, ...fields }) => {
      try {
        const data = {
          ...fields,
          publishedAt: null,
          ...(amenities?.length ? { amenities } : {}),
        };
        // Relation hotel via rooms (oneToMany depuis hotel)
        // On associe la room à l'hotel via le champ hotel sur Room si présent, sinon via hotel rooms
        // En Strapi v4, pour une oneToMany depuis hotel.rooms, on met le parent sur la room
        // Le champ n'est pas explicite dans le schema room, donc on update l'hotel après
        const body = await strapiRequest("/api/rooms", { method: "POST", body: JSON.stringify({ data }) });
        const id = body.data?.id;

        // Associer la room à l'hôtel en mettant à jour la relation rooms de l'hôtel
        if (hotelId && id) {
          const hotel = await strapiRequest(`/api/hotels/${hotelId}?publicationState=preview&populate[rooms][fields][0]=id`);
          const existingRoomIds = (hotel.data?.attributes?.rooms?.data || []).map((r) => r.id);
          await strapiRequest(`/api/hotels/${hotelId}`, {
            method: "PUT",
            body: JSON.stringify({ data: { rooms: [...existingRoomIds, id] } }),
          });
        }

        const { STRAPI_URL } = getStrapiConfig();
        return jsonResult({
          status: "room_created",
          id,
          name: body.data?.attributes?.name,
          hotelId,
          reviewUrl: `${STRAPI_URL}/admin/content-manager/collection-types/api::room.room/${id}`,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "update_room",
    "Met à jour une chambre existante par son id. Tous les champs sont optionnels.",
    {
      id: z.number().int(),
      name: z.string().optional(),
      description: z.string().optional(),
      price_per_night: z.number().min(0).optional(),
      capacity: z.number().int().optional(),
      max_occupancy: z.number().int().optional(),
      room_type: z.enum(["single", "double", "twin", "triple", "quad", "suite", "deluxe", "standard"]).optional(),
      bed_type: z.enum(["single", "double", "queen", "king", "twin", "sofa_bed"]).optional(),
      bed_count: z.number().int().min(1).optional(),
      room_size: z.number().optional(),
      room_number: z.string().optional(),
      floor: z.number().int().optional(),
      view: z.enum(["sea", "mountain", "city", "garden", "pool", "courtyard", "street"]).optional(),
      available: z.boolean().optional(),
      quantity: z.number().int().min(1).optional(),
      accessibility: z.boolean().optional(),
      smoking_allowed: z.boolean().optional(),
      amenities: z.array(amenitySchema).optional(),
    },
    async ({ id, amenities, ...fields }) => {
      try {
        const data = {};
        Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) data[k] = v; });
        if (amenities !== undefined) data.amenities = amenities;

        const body = await strapiRequest(`/api/rooms/${id}`, { method: "PUT", body: JSON.stringify({ data }) });
        return jsonResult({ status: "room_updated", id: body.data?.id });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "delete_room",
    "Supprime définitivement une chambre par son id.",
    { id: z.number().int() },
    async ({ id }) => {
      try {
        const check = await strapiRequest(`/api/rooms/${id}?fields[0]=name`);
        const name = check.data?.attributes?.name;
        if (!name) throw new Error(`Chambre ${id} introuvable.`);
        await strapiRequest(`/api/rooms/${id}`, { method: "DELETE" });
        return jsonResult({ status: "room_deleted", id, name });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // GUIDES
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "create_guide",
    "Crée un nouveau guide dans Strapi. Retourne l'id créé et le lien admin.",
    {
      name: z.string().min(1),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      bio: z.string().optional().describe("Biographie courte du guide"),
      Experiences: z.number().int().min(0).optional().describe("Années d'expérience"),
      commission_rate: z.number().min(0).max(100).optional().default(12).describe("Taux de commission en %"),
      metaTitle: z.string().max(60).optional(),
      metaDescription: z.string().max(160).optional(),
    },
    async ({ name, email, phone, bio, Experiences, commission_rate, metaTitle, metaDescription }) => {
      try {
        const data = {
          name,
          slug: slugify(name),
          publishedAt: null,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(bio ? { bio } : {}),
          ...(Experiences !== undefined ? { Experiences } : {}),
          ...(commission_rate !== undefined ? { commission_rate } : {}),
          Seo: {
            metaTitle: (metaTitle || name).slice(0, 60),
            ...(metaDescription ? { metaDescription: metaDescription.slice(0, 160) } : {}),
          },
        };

        const body = await strapiRequest("/api/guides", { method: "POST", body: JSON.stringify({ data }) });
        const id = body.data?.id;
        const { STRAPI_URL } = getStrapiConfig();
        return jsonResult({
          status: "guide_created",
          id,
          name: body.data?.attributes?.name,
          reviewUrl: `${STRAPI_URL}/admin/content-manager/collection-types/api::guide.guide/${id}`,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "update_guide",
    "Met à jour un guide existant par son id.",
    {
      id: z.number().int(),
      name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      bio: z.string().optional(),
      Experiences: z.number().int().min(0).optional(),
      commission_rate: z.number().min(0).max(100).optional(),
      metaTitle: z.string().max(60).optional(),
      metaDescription: z.string().max(160).optional(),
    },
    async ({ id, metaTitle, metaDescription, name, ...rest }) => {
      try {
        const hasSeo = metaTitle !== undefined || metaDescription !== undefined || name !== undefined;
        const data = {};
        if (name !== undefined) data.name = name;
        if (name !== undefined) data.slug = slugify(name);
        Object.entries(rest).forEach(([k, v]) => { if (v !== undefined) data[k] = v; });

        if (hasSeo) {
          const current = await strapiRequest(`/api/guides/${id}?populate[Seo]=true`);
          const currentSeo = current.data?.attributes?.Seo ?? {};
          data.Seo = {
            ...currentSeo,
            ...(metaTitle !== undefined ? { metaTitle: metaTitle.slice(0, 60) } : name !== undefined ? { metaTitle: name.slice(0, 60) } : {}),
            ...(metaDescription !== undefined ? { metaDescription: metaDescription.slice(0, 160) } : {}),
          };
        }

        const body = await strapiRequest(`/api/guides/${id}`, { method: "PUT", body: JSON.stringify({ data }) });
        return jsonResult({ status: "guide_updated", id: body.data?.id, name: body.data?.attributes?.name });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PROMPTS — workflows guidés multi-étapes
  // ═══════════════════════════════════════════════════════════════════════════

  server.prompt(
    "rediger_article",
    "Workflow complet pour rédiger un article OkoolTrip de A à Z : recherche de catégorie, choix d'auteur, rédaction du contenu avec blocs riches, FAQ et SEO optimisé.",
    {
      sujet: z.string().describe("Sujet ou titre approximatif de l'article à rédiger"),
      categorie: z.string().optional().describe("Nom ou mot-clé de la catégorie souhaitée (facultatif)"),
      langue: z.string().optional().describe("Langue de rédaction, ex: français, wolof (défaut: français)"),
    },
    async ({ sujet, categorie, langue }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Tu es un rédacteur web expert en voyage et tourisme au Sénégal pour OkoolTrip.

**Sujet de l'article :** ${sujet}
${categorie ? `**Catégorie souhaitée :** ${categorie}` : ""}
**Langue :** ${langue || "français"}

## Workflow à suivre OBLIGATOIREMENT dans cet ordre :

### Étape 1 — Préparation
1. Appelle \`list_categories\`${categorie ? ` avec search="${categorie}"` : ""} pour trouver la catégorie la plus adaptée. Note son \`id\` et son \`name\`.
2. Appelle \`list_authors\` pour choisir un auteur existant. Note son \`id\` et son \`name\`.

### Étape 2 — Rédaction du contenu
Rédige un article complet et optimisé SEO en suivant ces règles :
- **title** : accrocheur, avec le mot-clé principal, 60 car. max pour SEO
- **description** : résumé percutant de 150 car. max, incite à lire
- **contentBlocks** : minimum 8 blocs, varier les types (heading h2/h3, paragraph, list, quote). Utiliser \`children\` avec \`bold\` et \`italic\` pour mettre en valeur les infos clés. Minimum 800 mots au total.
- **faq** : 4 à 6 questions/réponses pertinentes sur le sujet
- **keywords** : 4 à 6 mots-clés longue traîne ciblés
- **metaTitle** : différent du title si possible, 60 car. max
- **metaDescription** : call-to-action implicite, 155 car. max
- **canonicalPath** : chemin logique ex \`/blog/nom-categorie/slug-article\`

### Étape 3 — Création
3. Appelle \`create_article_draft\` avec tout le contenu rédigé.
4. Retourne le lien \`reviewUrl\` pour que l'équipe puisse relire.

**Rappel absolu : ne jamais publier. L'article doit toujours rester en brouillon.**`,
        },
      }],
    })
  );

  server.prompt(
    "creer_circuit",
    "Workflow complet pour créer un circuit touristique (tour) OkoolTrip : choix du type, guide associé, tous les blocs de contenu, prix, FAQ et SEO.",
    {
      titre: z.string().describe("Titre du circuit à créer"),
      type: z.string().optional().describe("Type de circuit parmi : circuits privés, circuits en 4x4, circuit demi-journée, croisières, visites guidées, visites bus, circuits vtt et quad, activités sportives, safaris, etc."),
      ville: z.string().optional().describe("Ville ou région de départ du circuit"),
    },
    async ({ titre, type, ville }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Tu es un expert en tourisme au Sénégal pour OkoolTrip. Crée un circuit complet et attrayant.

**Titre du circuit :** ${titre}
${type ? `**Type :** ${type}` : ""}
${ville ? `**Ville/Région :** ${ville}` : ""}

## Workflow à suivre dans cet ordre :

### Étape 1 — Préparation
1. Appelle \`list_guides\` pour trouver un guide disponible adapté. Note son \`id\` et son \`name\`.

### Étape 2 — Construction du circuit
Prépare le contenu complet :
- **title** : nom commercial accrocheur du circuit
- **resum** : pitch court de 1-2 phrases pour les cards (max 160 car.)
- **type** : choisis parmi les valeurs disponibles du schéma
- **price** : prix en XOF (entier)
- **duration** : durée en jours (entier)
- **is_private** : true si circuit privatisable
- **min_participants** / **max_participants** : capacité groupe
- **Adresse** : point de départ
- **description** : présentation générale (2-3 blocs paragraph/heading)
- **Infos** : infos pratiques clés en liste (horaires, point rdv, équipement…)
- **Inclus** : ce qui est inclus dans le prix (liste unordered)
- **Ce_qui_est_exclus** : ce qui n'est pas inclus (liste unordered)
- **A_propos** : histoire, contexte, points d'intérêt (2-4 blocs)
- **Depart_et_Retour** : instructions départ et retour
- **Accessibilite** : niveau physique requis, accessibilité PMR
- **Conditions_d_annulation** : politique d'annulation
- **Faq** : 4-5 questions fréquentes sur ce circuit
- **priceTiers** : paliers de réduction selon nombre de participants (ex: 5+ pers → -10%, 10+ pers → -20%)
- **metaTitle**, **metaDescription**, **keywords**, **canonicalPath**

### Étape 3 — Création
2. Appelle \`create_tour\` avec tout le contenu.
3. Retourne le lien \`reviewUrl\`.

**Le circuit est créé en brouillon — publication manuelle obligatoire dans l'admin Strapi.**`,
        },
      }],
    })
  );

  server.prompt(
    "creer_hebergement",
    "Workflow complet pour créer un hébergement OkoolTrip (hôtel, appartement ou villa) avec chambres, services, amenities, paliers tarifaires et SEO.",
    {
      nom: z.string().describe("Nom de l'hébergement"),
      kind: z.string().describe("Type : hotel, apartment ou villa"),
      ville: z.string().describe("Ville où se situe l'hébergement"),
    },
    async ({ nom, kind, ville }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Tu es un expert en hébergement touristique au Sénégal pour OkoolTrip.

**Hébergement :** ${nom}
**Type :** ${kind}
**Ville :** ${ville}

## Workflow à suivre dans cet ordre :

### Étape 1 — Création de l'hébergement principal
${kind === "hotel" ? `Appelle \`create_hotel\` avec :
- **name**, **description** (markdown riche), **address**, **city** (${ville}), **country** (Sénégal)
- **check_in_time** / **check_out_time**
- **amenities** : liste des équipements avec \`name\`, \`icon\` (wifi, ac, pool, tv…) et \`category\`
- **services** : services proposés avec \`name\`, \`icon\`, \`description\`, \`included\`, \`extra_cost\`
- **contact** : phone, email, manager_name, reception_hours
- **priceTiers** : réductions longs séjours (ex: 7+ nuits → -10%, 28+ nuits → -20%)
- **featured** : true si hébergement mis en avant
- **metaTitle**, **metaDescription**, **keywords**, **canonicalPath**` : ""}
${kind === "apartment" ? `Appelle \`create_apartment\` avec :
- **name**, **description**, **address**, **city** (${ville})
- **price_per_night**, **capacity**, **bedrooms**, **bathrooms**
- **apartment_type** : studio | apartment | loft | duplex | penthouse | villa
- **size**, **floor**, **elevator**, **balcony**, **terrace**, **parking**
- **amenities**, **services**, **priceTiers**, **contact**
- **metaTitle**, **metaDescription**, **keywords**, **canonicalPath**` : ""}
${kind === "villa" ? `Appelle \`create_villa\` avec :
- **name**, **description**, **address**, **city** (${ville})
- **price_per_night**, **capacity**, **bedrooms**, **bathrooms**
- **size**, **balcony**, **terrace**, **parking**
- **amenities**, **services**, **priceTiers**, **contact**
- **metaTitle**, **metaDescription**, **keywords**, **canonicalPath**` : ""}

### Étape 2 — Chambres (hôtel uniquement)
${kind === "hotel" ? `Pour chaque type de chambre de l'hôtel, appelle \`create_room\` avec :
- **name**, **description**, **price_per_night**, **capacity**, **max_occupancy**
- **room_type** : single | double | twin | triple | quad | suite | deluxe | standard
- **bed_type** : single | double | queen | king | twin | sofa_bed
- **room_size**, **view** (sea | garden | city | pool…), **floor**
- **amenities** spécifiques à la chambre
- **hotelId** : l'id retourné à l'étape 1
Créer au minimum 2-3 types de chambres différents.` : "Pas de chambres pour ce type d'hébergement."}

### Étape 3 — Confirmation
Retourne un résumé avec tous les \`reviewUrl\` créés.

**Tout est créé en brouillon — publication manuelle dans l'admin Strapi.**`,
        },
      }],
    })
  );

  server.prompt(
    "optimiser_seo_page",
    "Workflow pour auditer et améliorer le SEO d'une page singleType OkoolTrip (circuit ou hébergement) : lecture de l'existant, analyse, réécriture optimisée.",
    {
      pageType: z.string().describe("Type de page : circuit-general | circuit-prive | circuit-demi-journee | circuit-4-4 | circuit-vtt-quad | circuit-nbre | circuits-senegal | hebergement | hebergement-1etoile | hebergement-2etoiles | hebergement-3etoiles | hebergement-4etoiles | hebergement-5etoiles"),
    },
    async ({ pageType }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Tu es un expert SEO spécialisé en tourisme sénégalais pour OkoolTrip.

**Page à optimiser :** ${pageType}

## Workflow à suivre :

### Étape 1 — Audit de l'existant
1. Appelle \`get_page\` avec \`pageType="${pageType}"\` pour lire le contenu actuel.
2. Analyse :
   - Le contenu existant (ContenuAvant, ContenuApres, Faq)
   - Le SEO actuel (metaTitle, metaDescription, keywords, canonicalURL)
   - Les points forts et les lacunes

### Étape 2 — Recommandations
Identifie :
- Les mots-clés manquants ou sous-exploités
- Les blocs de contenu à enrichir ou restructurer
- Le metaTitle / metaDescription à réécrire si < optimal
- Les questions FAQ à ajouter ou améliorer

### Étape 3 — Mise à jour
3. Appelle \`update_page\` avec les améliorations :
   - **contenuAvant** / **contenuApres** : contenu restructuré et enrichi (si nécessaire)
   - **faq** : FAQ améliorée avec les questions clés
   - **metaTitle** : 50-60 car., mot-clé principal en début
   - **metaDescription** : 150-160 car., call-to-action, différenciateur
   - **keywords** : 5-8 mots-clés longue traîne pertinents
   - **canonicalPath** : chemin canonique correct si absent

### Étape 4 — Rapport
Retourne un rapport avec :
- Ce qui a été changé et pourquoi
- Score SEO estimé avant/après (sur 10)
- Recommandations supplémentaires (images, backlinks…)`,
        },
      }],
    })
  );

  server.prompt(
    "audit_contenu",
    "Audit complet du contenu OkoolTrip en brouillon : liste tous les articles, tours et hébergements non publiés, identifie ceux qui sont incomplets ou prêts à publier.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Tu es un éditeur de contenu pour OkoolTrip. Effectue un audit complet de tout le contenu en brouillon.

## Workflow à suivre :

### Étape 1 — Collecte des données
Appelle en parallèle (ou séquentiellement) :
1. \`list_articles\` — tous les articles (pageSize: 100)
2. \`list_tours\` — tous les circuits (pageSize: 100)
3. \`list_hebergements\` avec kind="hotel" (pageSize: 100)
4. \`list_hebergements\` avec kind="apartment" (pageSize: 100)
5. \`list_hebergements\` avec kind="villa" (pageSize: 100)

### Étape 2 — Analyse par catégorie
Pour chaque type de contenu, classe les entrées en :
- ✅ **Prêt à publier** : contenu complet, SEO renseigné
- ⚠️ **Incomplet** : contenu partiel, SEO manquant ou slug absent
- 🔴 **À retravailler** : contenu très pauvre ou structure incorrecte

### Étape 3 — Rapport structuré
Présente un tableau récapitulatif :
| Type | Total | ✅ Prêt | ⚠️ Incomplet | 🔴 À retravailler |
|------|-------|---------|-------------|------------------|

Puis liste détaillée par catégorie avec :
- id, titre/nom, statut actuel
- Ce qui manque pour chaque entrée incomplète
- Priorité de traitement (haute / moyenne / basse)

### Étape 4 — Recommandations
Propose un plan d'action pour les 5 contenus les plus prioritaires à compléter.`,
        },
      }],
    })
  );

  return server;
}
