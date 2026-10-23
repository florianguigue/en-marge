import { expect, test, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { legacyBooks } from "../../public/js/legacy-editions.js";
import {
  localizeBook,
  loadBookEditions,
} from "../../public/js/book-editions.js";
import { parseBook } from "../../public/js/open-library.js";
import { searchBooks, loadBookMetadata } from "../../public/js/metadata.js";

test("historical saved books retain their translated editions", () => {
  const english = legacyBooks.map((book) => localizeBook(book, "en"));
  expect(english).toHaveLength(8);
  expect(english[0].title).toBe("The Hobbit");
  expect(english[7].title).toBe("A Winter’s Promise");
  for (const book of english) {
    expect(book.language).toBe("en");
    expect(book.editionKey).toMatch(/^\/books\/OL\d+M$/);
    expect(book.description.length).toBeGreaterThan(50);
    expect(book.coverId).toBeGreaterThan(0);
    expect(book.isbn.length).toBeGreaterThanOrEqual(10);
  }
  expect(localizeBook(legacyBooks[0], "fr").title).toBe("Le Hobbit");
});

test("localizing a saved book preserves its identity, tags, status and original data", () => {
  const saved = {
    ...legacyBooks[0],
    status: "reading",
    tags: ["Mon tag"],
    addedAt: 42,
  };
  const before = JSON.stringify(saved);
  const english = localizeBook(saved, "en");
  expect(english.title).toBe("The Hobbit");
  expect(english.description).toContain("Bilbo Baggins");
  expect(english).toMatchObject({
    id: saved.id,
    status: "reading",
    tags: ["Mon tag"],
    addedAt: 42,
  });
  expect(localizeBook(english, "fr").title).toBe("Le Hobbit");
  expect(JSON.stringify(saved)).toBe(before);
  const manual = { ...saved, manual: true, title: "Mon titre personnel" };
  expect(localizeBook(manual, "en")).toBe(manual);
});

test("search reads the matching edition title, cover and ISBN instead of the work metadata", () => {
  const doc = {
    key: "/works/OL900001W",
    title: "Titre original",
    cover_i: 1,
    isbn: ["9780000000000"],
    number_of_pages_median: 999,
    author_name: ["Author"],
    editions: {
      docs: [
        {
          key: "/books/OL900001M",
          title: "Titre français",
          language: ["fre"],
          cover_i: 2,
          isbn: ["9780000000001"],
        },
        {
          key: "/books/OL900002M",
          title: "English edition",
          language: ["eng"],
          cover_i: 3,
          isbn: ["9780000000002"],
          publisher: ["English publisher"],
        },
      ],
    },
  };
  expect(parseBook(doc, "en")).toMatchObject({
    title: "English edition",
    coverId: 3,
    isbn: "9780000000002",
    editionKey: "/books/OL900002M",
    publisher: "English publisher",
    pages: null,
    language: "en",
  });
  expect(parseBook(doc, "fr").title).toBe("Titre français");
});

test("search passes query, page and language to the unified server API", async () => {
  const calls = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    async (url) => {
      calls.push(new URL(url, "http://localhost"));
      return Response.json({ books: [], total: 0, hasMore: false });
    },
  );
  try {
    await searchBooks("Hobbit", 2, undefined, "en", "google-books");
    expect(calls[0].pathname).toBe("/api/catalogue/search");
    expect(calls[0].searchParams.get("q")).toBe("Hobbit");
    expect(calls[0].searchParams.get("page")).toBe("2");
    expect(calls[0].searchParams.get("language")).toBe("en");
    expect(calls[0].searchParams.get("provider")).toBe("google-books");
  } finally {
    fetchSpy.mockRestore();
  }
});

test("explicit related editions change display without rewriting saved records", async () => {
  const saved = {
    id: "hardcover:900003",
    provider: "hardcover",
    externalId: "900003",
    title: "Titre français",
    author: "Auteur",
    language: "fr",
    tags: ["Favori"],
    status: "read",
  };
  let calls = 0;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls++;
    return Response.json({
      book: {
        ...saved,
        editions: [
          {
            id: "hardcover:900003:edition:1",
            provider: "hardcover",
            externalId: "900003",
            title: "English title",
            language: "en",
            author: "Auteur",
            coverUrl: "https://example.org/cover.jpg",
            isbn: "9780547928227",
          },
        ],
      },
    });
  });
  try {
    const before = JSON.stringify(saved);
    expect(await loadBookEditions([saved], "en")).toBe(true);
    expect(localizeBook(saved, "en")).toMatchObject({
      title: "English title",
      coverUrl: "https://example.org/cover.jpg",
      status: "read",
      tags: ["Favori"],
      id: saved.id,
    });
    expect(await loadBookEditions([saved], "en")).toBe(false);
    expect(calls).toBe(1);
    expect(JSON.stringify(saved)).toBe(before);
    expect(localizeBook(localizeBook(saved, "en"), "fr").title).toBe(
      "Titre français",
    );
  } finally {
    fetchSpy.mockRestore();
  }
});

test("a failed edition lookup is retryable and never guesses a translation", async () => {
  const saved = {
    id: "google-books:retry",
    provider: "google-books",
    externalId: "retry",
    title: "Untranslated",
    author: "Author",
    language: null,
  };
  const fetchSpy = spyOn(globalThis, "fetch")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(Response.json({ book: { ...saved, language: "en" } }));
  try {
    expect(await loadBookEditions([saved], "en")).toBe(false);
    expect(localizeBook(saved, "en").title).toBe("Untranslated");
    expect(await loadBookEditions([saved], "en")).toBe(true);
  } finally {
    fetchSpy.mockRestore();
  }
});

test("an unavailable saved provider falls back to the common ISBN lookup", async () => {
  const book = {
    id: "google-books:unavailable",
    provider: "google-books",
    externalId: "unavailable",
    isbn: "9780547928227",
  };
  const urls = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    async (url) => {
      urls.push(url);
      return urls.length === 1
        ? new Response("Unavailable", { status: 503 })
        : Response.json({
            book: {
              id: "hardcover:1",
              title: "The Hobbit",
              author: "Tolkien",
              language: "en",
              isbn: book.isbn,
            },
          });
    },
  );
  try {
    expect((await loadBookMetadata(book, "en")).book.title).toBe("The Hobbit");
    expect(urls[0]).toContain("/api/catalogue/book?");
    expect(urls[1]).toContain("/api/catalogue/isbn?");
  } finally {
    fetchSpy.mockRestore();
  }
});

test("Zorhal retains all three volumes, including the two editions with no language", () => {
  const response = JSON.parse(
    readFileSync(
      new URL("../fixtures/zorhal-search.json", import.meta.url),
      "utf8",
    ),
  );
  const books = response.docs.map((document) => parseBook(document, "fr"));
  expect(books.map((book) => book.title)).toEqual([
    "Zorhal",
    "Zorhal T.2",
    "Zorhal T.3",
  ]);
  expect(books.map((book) => book.language)).toEqual(["fr", null, null]);
  expect(books[1]).toMatchObject({
    editionKey: "/books/OL61963652M",
    isbn: "9791097908133",
    coverId: 15222016,
  });
  expect(books[1].translations).toBeUndefined();
  const englishView = parseBook(response.docs[0], "en");
  expect(englishView.language).toBe("fr");
  expect(englishView.translations.en).toBeUndefined();
});
