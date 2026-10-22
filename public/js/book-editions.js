import { catalogue } from "./catalogue.js";
import { editionFor, parseBook, searchBookEditions } from "./open-library.js";

const editions = new Map();
const cacheKey = (workKey, language) => `${workKey}:${language}`;
const workKeyFor = (book) => book.workKey || book.id;
const catalogueBook = (book) =>
  catalogue.find(
    (item) => item.id === book.id || item.workKey === workKeyFor(book),
  );

function variantFor(book, language) {
  return (
    catalogueBook(book)?.translations?.[language] ||
    book.translations?.[language] ||
    editions.get(cacheKey(workKeyFor(book), language))
  );
}

export function localizeBook(book, language) {
  if (book.manual) return book;
  const variant = variantFor(book, language);
  if (!variant) {
    if (book.language === language) return book;
    return { ...book, description: "", originalEdition: true };
  }
  // Only edition metadata changes. Identity, reading status and personal tags stay intact.
  const { title, description, editionKey, isbn, coverId, pages, publisher } =
    variant;
  return {
    ...book,
    title,
    description: description || "",
    editionKey,
    isbn,
    coverId,
    pages,
    publisher,
    language,
    id: book.id,
    workKey: book.workKey,
    status: book.status,
    tags: book.tags,
    translations: {
      ...book.translations,
      ...catalogueBook(book)?.translations,
      [language]: variant,
    },
    originalEdition: false,
  };
}

export function getCatalogue(language) {
  return catalogue.map((book) => localizeBook(book, language));
}

export async function loadBookEditions(books, language, signal) {
  const workKeys = [
    ...new Set(
      books
        .filter(
          (book) =>
            !book.manual &&
            book.language !== language &&
            !variantFor(book, language) &&
            !editions.has(cacheKey(workKeyFor(book), language)),
        )
        .map(workKeyFor)
        .filter((key) => /^\/works\/OL\d+W$/.test(key)),
    ),
  ];
  for (let offset = 0; offset < workKeys.length; offset += 20) {
    const keys = workKeys.slice(offset, offset + 20);
    const data = await searchBookEditions(keys, language, signal);
    for (const key of keys) {
      const document = data.docs.find(
        (item) => item.key === key && editionFor(item, language),
      );
      editions.set(
        cacheKey(key, language),
        document ? parseBook(document, language).translations[language] : null,
      );
    }
  }
  return workKeys.length > 0;
}
