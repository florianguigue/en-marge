import { normal } from "./utils.js";
import { getLanguage, t } from "./i18n.js";

// Compatibility parser for historical Open Library fixtures. No network requests.
export function editionFor(document, language = getLanguage()) {
  const code = language === "en" ? "eng" : "fre";
  return document.editions?.docs?.find((edition) =>
    edition.language?.includes(code),
  );
}

export function parseBook(document, language = getLanguage()) {
  const preferredEdition = editionFor(document, language);
  const edition = preferredEdition || document.editions?.docs?.[0];
  const languages = edition ? edition.language : document.language;
  const contentLanguage = preferredEdition
    ? language
    : languages?.includes("eng")
      ? "en"
      : languages?.includes("fre")
        ? "fr"
        : null;
  const subjects = Array.isArray(document.subject) ? document.subject : [];
  const text = normal(subjects.join(" "));
  const genre =
    text.includes("science fiction") ||
    text.includes("fantasy") ||
    text.includes("fantastique")
      ? "Imaginaire"
      : text.includes("poetry") || text.includes("poesie")
        ? "Poésie"
        : text.includes("philosoph") ||
            text.includes("essay") ||
            text.includes("essai")
          ? "Essai"
          : text.includes("fiction") || text.includes("roman")
            ? "Roman"
            : subjects[0] || "À découvrir";
  const metadata = edition || document;
  const isbns = Array.isArray(metadata.isbn) ? metadata.isbn : [];
  const book = {
    id: document.key,
    workKey: document.key,
    editionKey: edition?.key || null,
    language: contentLanguage,
    title: metadata.title || document.title || t("untitled"),
    author: document.author_name?.join(", ") || t("unknownAuthor"),
    isbn: isbns.find((isbn) => isbn.length === 13) || isbns[0] || "",
    coverId: metadata.cover_i || null,
    pages: edition
      ? edition.number_of_pages || null
      : document.number_of_pages_median || null,
    year: document.first_publish_year || null,
    publisher: metadata.publisher?.[0] || "",
    tags: [
      genre,
      ...subjects.filter((tag) => normal(tag) !== normal(genre)).slice(0, 3),
    ],
    description: "",
    color: "#557260",
  };
  if (edition && contentLanguage) {
    const { title, editionKey, isbn, coverId, pages, publisher } = book;
    book.translations = {
      [contentLanguage]: {
        title,
        editionKey,
        isbn,
        coverId,
        pages,
        publisher,
        language: contentLanguage,
        description: "",
      },
    };
  }
  return book;
}
