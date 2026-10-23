// The catalogue model is independent of external response shapes and personal data.
import { normalizeIsbn } from "../../public/js/isbn.js";
export { normalizeIsbn } from "../../public/js/isbn.js";

export function safeUrl(value, base) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value, base);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "";
    url.protocol = "https:";
    return url.href;
  } catch {
    return "";
  }
}

export const plainText = (value) =>
  typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim()
    : "";
export const strings = (value) =>
  Array.isArray(value)
    ? value.filter((v) => typeof v === "string" && v.trim())
    : [];

export function metadata(provider, externalId, fields, now = Date.now()) {
  const source = {
    provider,
    externalId: String(externalId),
    url: safeUrl(fields.sourceUrl),
    fetchedAt: new Date(now).toISOString(),
  };
  const book = {
    id: `${provider}:${externalId}`,
    provider,
    externalId: String(externalId),
    workId: null,
    editionId: null,
    title: "",
    author: "",
    description: "",
    language: null,
    isbn: "",
    isbns: [],
    coverUrl: "",
    pages: null,
    year: null,
    publisher: "",
    tags: [],
    series: [],
    editions: [],
    ...fields,
    sources: [source],
    provenance: {},
  };
  book.title = plainText(book.title);
  book.author = plainText(book.author);
  book.description = plainText(book.description);
  book.isbns = [
    ...new Set([book.isbn, ...book.isbns].map(normalizeIsbn).filter(Boolean)),
  ];
  book.isbn = book.isbns[0] || "";
  book.coverUrl = safeUrl(book.coverUrl);
  book.sourceUrl = source.url;
  book.externalIds = { [provider]: String(externalId) };
  for (const [key, value] of Object.entries(book)) {
    if (
      value &&
      (!Array.isArray(value) || value.length) &&
      !["sources", "provenance", "externalIds"].includes(key)
    )
      book.provenance[key] = source;
  }
  return book;
}

export function sameEdition(a, b) {
  return a.id === b.id || a.isbns?.some((isbn) => b.isbns?.includes(isbn));
}

export function mergeBooks(primary, secondary) {
  if (!sameEdition(primary, secondary)) return primary;
  const result = { ...primary, provenance: { ...primary.provenance } };
  // Primary edition metadata wins; Hardcover owns series relationships.
  for (const key of [
    "title",
    "author",
    "description",
    "language",
    "coverUrl",
    "pages",
    "year",
    "publisher",
    "publishedDate",
    "format",
    "workId",
    "series",
  ]) {
    const value = secondary[key];
    if (
      value &&
      (!Array.isArray(value) || value.length) &&
      (!result[key] ||
        (Array.isArray(result[key]) && !result[key].length) ||
        (key === "series" && secondary.provider === "hardcover"))
    ) {
      result[key] = value;
      result.provenance[key] = secondary.provenance[key];
      if (key === "coverUrl")
        result.imageCredits = secondary.imageCredits || null;
    }
  }
  result.isbns = [...new Set([...primary.isbns, ...secondary.isbns])];
  result.isbn = primary.isbn || secondary.isbn;
  result.tags = [...new Set([...primary.tags, ...secondary.tags])];
  result.externalIds = { ...secondary.externalIds, ...primary.externalIds };
  result.sources = [
    ...new Map(
      [...primary.sources, ...secondary.sources].map((s) => [
        `${s.provider}:${s.externalId}`,
        s,
      ]),
    ).values(),
  ];
  result.editions = [
    ...new Map(
      [...primary.editions, ...secondary.editions].map((e) => [e.id, e]),
    ).values(),
  ];
  return result;
}

export function deduplicate(books, language) {
  const result = [];
  for (const book of books) {
    if (!book?.title) continue;
    const index = result.findIndex((other) => sameEdition(other, book));
    if (index < 0) result.push(book);
    else result[index] = mergeBooks(result[index], book);
  }
  return result.sort(
    (a, b) => Number(b.language === language) - Number(a.language === language),
  );
}
