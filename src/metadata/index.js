import { createHttpClient, ProviderError } from "./http.js";
import { createGoogleBooks } from "./providers/google-books.js";
import { createHardcover } from "./providers/hardcover.js";
import { deduplicate, mergeBooks, normalizeIsbn } from "./model.js";

export class CatalogueError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function createMetadataService({
  store,
  providers,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const disabled = new Set(
    (env.METADATA_DISABLED_PROVIDERS || "")
      .split(",")
      .map((value) => value.trim()),
  );
  providers ||= [
    createHardcover({
      request: createHttpClient({ fetchImpl }),
      token: env.HARDCOVER_API_TOKEN,
    }),
    createGoogleBooks({
      request: createHttpClient({ fetchImpl, intervalMs: 250 }),
      apiKey: env.GOOGLE_BOOKS_API_KEY,
    }),
  ];
  const active = providers.filter(
    (provider) => provider.enabled !== false && !disabled.has(provider.id),
  );
  const cachePrefix = `catalogue-v2:${active.map((provider) => provider.id).join(",")}:`;
  const pending = new Map();
  const cached = async (key, action, ttl = 3600000) => {
    const fullKey = cachePrefix + key;
    const value = store?.metadataCacheGet(fullKey);
    if (value) return structuredClone(value);
    if (pending.has(fullKey))
      return structuredClone(await pending.get(fullKey));
    if (pending.size >= 32)
      throw new CatalogueError("Catalogue occupé. Réessayez.", 503);
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new CatalogueError("Catalogue trop lent.", 503)),
        12000,
      );
    });
    const promise = Promise.race([action(), deadline]).then((result) => {
      // Degraded responses expire quickly, so a provider's recovery is visible.
      store?.metadataCacheSet(
        fullKey,
        result,
        result.warnings?.length ? 60000 : ttl,
      );
      return result;
    });
    pending.set(fullKey, promise);
    try {
      return structuredClone(await promise);
    } finally {
      clearTimeout(timeout);
      pending.delete(fullKey);
    }
  };
  const warning = (provider, error) => ({
    provider: provider.id,
    code: error instanceof ProviderError ? error.code : "unavailable",
  });
  const requireProvider = (id) => {
    const provider = active.find((provider) => provider.id === id);
    if (!provider)
      throw new CatalogueError("Fournisseur inconnu ou désactivé.");
    return provider;
  };
  const languageFor = (value = "fr") => {
    if (!["fr", "en"].includes(value))
      throw new CatalogueError("Langue invalide.");
    return value;
  };
  const enrich = async (book, language, warnings) => {
    const incomplete = ["description", "coverUrl", "pages", "publisher"].some(
      (field) => !book[field],
    );
    if (!book.isbn || !incomplete) return book;
    const others = active.filter((provider) => provider.id !== book.provider);
    const results = await Promise.allSettled(
      others.map((provider) => provider.findByIsbn(book.isbn, language)),
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected")
        warnings.push(warning(others[i], result.reason));
      else for (const match of result.value) book = mergeBooks(book, match);
    }
    return book;
  };
  const relatedEditions = async (book, language, warnings) => {
    if (book.language === language || book.editions.length) return book;
    const hardcover = active.find((provider) => provider.id === "hardcover");
    const id = book.externalIds.hardcover;
    if (hardcover && id && book.provider !== "hardcover") {
      try {
        const related = await hardcover.findByExternalId(id, language);
        if (related) book = { ...book, editions: related.editions };
      } catch (error) {
        warnings.push(warning(hardcover, error));
      }
    }
    return book;
  };
  return {
    providers() {
      return providers.map((provider) => ({
        id: provider.id,
        enabled: active.includes(provider),
      }));
    },
    async search({
      query,
      page = 1,
      language = "fr",
      provider: providerId,
    } = {}) {
      query = typeof query === "string" ? query.trim() : "";
      if (
        !query ||
        query.length > 300 ||
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > 100
      )
        throw new CatalogueError("Recherche ou page invalide.");
      language = languageFor(language);
      const candidates = providerId ? [requireProvider(providerId)] : active;
      return cached(
        JSON.stringify(["search", query, page, language, providerId]),
        async () => {
          const warnings = [];
          let successful = false;
          let emptyProvider = null;
          for (const provider of candidates) {
            try {
              const result = await provider.search({
                query,
                page,
                language,
                limit: 24,
              });
              successful = true;
              emptyProvider ||= provider.id;
              let books = deduplicate(result.books, language);
              if (!books.length) continue;
              return {
                books,
                total: Math.max(result.total || 0, books.length),
                page,
                hasMore: Boolean(result.hasMore),
                provider: provider.id,
                warnings,
              };
            } catch (error) {
              warnings.push(warning(provider, error));
            }
          }
          if (!successful)
            throw new CatalogueError("Catalogue indisponible.", 503);
          return {
            books: [],
            total: 0,
            page,
            hasMore: false,
            provider: emptyProvider,
            warnings,
          };
        },
      );
    },
    async book({ provider: providerId, id, language = "fr" } = {}) {
      const provider = requireProvider(providerId);
      if (
        typeof id !== "string" ||
        !id ||
        id.length > 100 ||
        !(provider.validId?.(id) ?? /^[\w-]+$/.test(id))
      )
        throw new CatalogueError("Identifiant invalide.");
      language = languageFor(language);
      return cached(
        JSON.stringify(["book", providerId, id, language]),
        async () => {
          const warnings = [];
          let book;
          try {
            book = await provider.findByExternalId(id, language);
          } catch {
            throw new CatalogueError("Fiche indisponible.", 503);
          }
          if (!book) throw new CatalogueError("Livre introuvable.", 404);
          book = await enrich(book, language, warnings);
          book = await relatedEditions(book, language, warnings);
          return { book, warnings };
        },
        86400000,
      );
    },
    async isbn({ isbn, language = "fr" } = {}) {
      isbn = normalizeIsbn(isbn);
      if (!isbn) throw new CatalogueError("ISBN invalide.");
      language = languageFor(language);
      return cached(
        JSON.stringify(["isbn", isbn, language]),
        async () => {
          const warnings = [];
          let book = null;
          let successful = false;
          for (const provider of active) {
            try {
              const matches = await provider.findByIsbn(isbn, language);
              successful = true;
              book = matches.find((match) => match.isbns.includes(isbn));
              if (book) break;
            } catch (error) {
              warnings.push(warning(provider, error));
            }
          }
          if (!book)
            throw new CatalogueError(
              successful ? "Livre introuvable." : "Catalogue indisponible.",
              successful ? 404 : 503,
            );
          book = await relatedEditions(book, language, warnings);
          return { book, warnings };
        },
        86400000,
      );
    },
  };
}
