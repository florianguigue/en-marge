import { getLanguage, t } from "./i18n.js";
import { normal } from "./utils.js";

export function safeMetadataUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

async function request(path, params, signal) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null) search.set(key, value);
  const response = await fetch(`/api/catalogue/${path}?${search}`, { signal });
  if (!response.ok) throw new Error("Catalogue unavailable");
  return response.json();
}

export function parseBook(book) {
  const subjects = Array.isArray(book.tags) ? book.tags : [];
  const text = normal(subjects.join(" "));
  const genre = /science fiction|fantasy|fantastique/.test(text)
    ? "Imaginaire"
    : /poetry|poesie/.test(text)
      ? "Poésie"
      : /philosoph|essay|essai/.test(text)
        ? "Essai"
        : /fiction|roman/.test(text)
          ? "Roman"
          : subjects[0] || "À découvrir";
  return {
    ...book,
    title: book.title || t("untitled"),
    author: book.author || t("unknownAuthor"),
    tags: [
      genre,
      ...subjects.filter((tag) => normal(tag) !== normal(genre)).slice(0, 3),
    ],
    coverUrl: safeMetadataUrl(book.coverUrl),
    color: "#557260",
  };
}

export async function searchBooks(
  query,
  page,
  signal,
  language = getLanguage(),
  provider,
) {
  const data = await request(
    "search",
    { q: query, page, language, provider },
    signal,
  );
  if (!Array.isArray(data.books)) throw new Error("Invalid catalogue response");
  return { ...data, books: data.books.map(parseBook) };
}

export async function loadBookMetadata(book, language = getLanguage(), signal) {
  if (book.manual) return null;
  const provider = book.provider;
  const externalId = book.externalId;
  let data;
  if (provider && externalId) {
    try {
      data = await request(
        "book",
        { provider, id: externalId, language },
        signal,
      );
    } catch (error) {
      if (!book.isbn || signal?.aborted) throw error;
    }
  }
  if (!data && book.isbn)
    data = await request("isbn", { isbn: book.isbn, language }, signal);
  return data?.book ? { ...data, book: parseBook(data.book) } : null;
}
