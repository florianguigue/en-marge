import { metadata, normalizeIsbn, strings } from "../model.js";
import { ProviderError } from "../http.js";

export function normalizeGoogleVolume(volume) {
  if (!volume?.id || !volume.volumeInfo?.title) return null;
  const info = volume.volumeInfo;
  const images = info.imageLinks || {};
  return metadata("google-books", volume.id, {
    editionId: `google-books:${volume.id}`,
    title: info.title,
    author: strings(info.authors).join(", "),
    description: info.description,
    language: info.language || null,
    isbns: (info.industryIdentifiers || [])
      .filter((id) => ["ISBN_10", "ISBN_13"].includes(id.type))
      .map((id) => id.identifier),
    coverUrl:
      images.extraLarge ||
      images.large ||
      images.medium ||
      images.small ||
      images.thumbnail ||
      images.smallThumbnail,
    pages: info.pageCount || null,
    year: Number(info.publishedDate?.slice(0, 4)) || null,
    publishedDate: info.publishedDate || null,
    publisher: info.publisher || "",
    tags: strings(info.categories),
    sourceUrl: `https://books.google.com/books?id=${encodeURIComponent(volume.id)}`,
  });
}

export function createGoogleBooks({ request, apiKey = "" }) {
  const get = (path, params = {}) => {
    const url = new URL(`https://www.googleapis.com/books/v1/${path}`);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    if (apiKey) url.searchParams.set("key", apiKey);
    return request(url);
  };
  const search = async ({
    query,
    page = 1,
    language,
    limit = 24,
    strictLanguage = false,
  }) => {
    const isbn = normalizeIsbn(query.replace(/^isbn:/i, ""));
    const data = await get("volumes", {
      q: isbn ? `isbn:${isbn}` : query,
      startIndex: String((page - 1) * limit),
      maxResults: String(limit),
      printType: "books",
      ...(strictLanguage ? { langRestrict: language } : {}),
    });
    if (
      data.kind !== "books#volumes" &&
      !Array.isArray(data.items) &&
      data.totalItems !== 0
    )
      throw new ProviderError("invalid_response");
    const items = data.items || [];
    return {
      books: items.map(normalizeGoogleVolume).filter(Boolean),
      total: data.totalItems || 0,
      hasMore: items.length === limit && page * limit < data.totalItems,
    };
  };
  return {
    id: "google-books",
    enabled: true,
    search,
    async findByIsbn(isbn, language) {
      return (await search({ query: `isbn:${isbn}`, language })).books.filter(
        (book) => book.isbns.includes(isbn),
      );
    },
    async findByExternalId(id) {
      try {
        return normalizeGoogleVolume(
          await get(`volumes/${encodeURIComponent(id)}`),
        );
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },
  };
}
