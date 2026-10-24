import { legacyBooks } from "./legacy-editions.js";
import { loadBookMetadata } from "./metadata.js";

const editions = new Map();
const cacheKey = (workKey, language) => `${workKey}:${language}`;
const workKeyFor = (book) => book.workKey || book.id;
const legacyBook = (book) =>
  legacyBooks.find(
    (item) => item.id === book.id || item.workKey === workKeyFor(book),
  );

function variantFor(book, language) {
  return (
    legacyBook(book)?.translations?.[language] ||
    book.translations?.[language] ||
    editions.get(cacheKey(workKeyFor(book), language))
  );
}

const editionMetadata = (book) =>
  Object.fromEntries(
    [
      "title",
      "description",
      "editionKey",
      "editionId",
      "isbn",
      "isbns",
      "coverId",
      "coverUrl",
      "pages",
      "publisher",
      "year",
      "publishedDate",
      "format",
      "language",
      "provider",
      "externalId",
      "externalIds",
      "sourceUrl",
      "sources",
      "provenance",
      "imageCredits",
    ].map((key) => [key, book[key]]),
  );

export function localizeBook(book, language) {
  if (book.manual) return book;
  const variant = variantFor(book, language);
  if (!variant) {
    if (book.language === language) return book;
    return { ...book, description: "", originalEdition: true };
  }
  // Only edition metadata changes. Identity, reading status and personal tags stay intact.
  return {
    ...book,
    ...editionMetadata(variant),
    description: variant.description || "",
    language,
    id: book.id,
    workKey: book.workKey,
    status: book.status,
    tags: book.tags,
    series: book.series?.length ? book.series : variant.series || [],
    translations: {
      ...(book.language ? { [book.language]: editionMetadata(book) } : {}),
      ...book.translations,
      ...legacyBook(book)?.translations,
      [language]: variant,
    },
    originalEdition: false,
  };
}

export async function loadBookEditions(books, language, signal) {
  const candidates = books.filter(
    (book) =>
      !book.manual &&
      (book.provider || book.isbn) &&
      book.language !== language &&
      !variantFor(book, language) &&
      !editions.has(cacheKey(workKeyFor(book), language)),
  );
  let changed = false;
  // Resolve explicit work/edition relationships; never guess translations from a title.
  for (const book of candidates) {
    signal?.throwIfAborted();
    try {
      const data = await loadBookMetadata(book, language, signal);
      const variant =
        data?.book?.editions?.find(
          (edition) => edition.language === language,
        ) || (data?.book?.language === language ? data.book : null);
      if (variant) {
        editions.set(cacheKey(workKeyFor(book), language), variant);
        changed = true;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return changed;
}
