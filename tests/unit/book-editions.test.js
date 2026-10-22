import { expect, test, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { catalogue } from "../../public/js/catalogue.js";
import {
  getCatalogue,
  localizeBook,
  loadBookEditions,
} from "../../public/js/book-editions.js";
import {
  parseBook,
  searchBooks,
  searchBookEditions,
} from "../../public/js/open-library.js";

test("the fantasy selection has English titles, summaries and verified edition references", () => {
  const english = getCatalogue("en");
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
  expect(getCatalogue("fr")[0].title).toBe("Le Hobbit");
});

test("localizing a saved book preserves its identity, tags, status and original data", () => {
  const saved = {
    ...catalogue[0],
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

test("search prefers the interface language without excluding incompletely catalogued books", async () => {
  const calls = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    async (url) => {
      calls.push(new URL(url));
      return Response.json({ docs: [] });
    },
  );
  try {
    await searchBooks("Hobbit", 1, undefined, "en");
    await searchBooks("Hobbit", 1, undefined, "fr");
    expect(calls[0].searchParams.get("q")).toBe("Hobbit");
    expect(calls[1].searchParams.get("q")).toBe("Hobbit");
    expect(calls[0].searchParams.get("lang")).toBe("en");
    expect(calls[1].searchParams.get("lang")).toBe("fr");
    await searchBookEditions(["/works/OL900003W"], "en");
    expect(calls[2].searchParams.get("q")).toContain("language:eng");
    expect(calls[0].searchParams.get("fields")).toContain("editions.title");
  } finally {
    fetchSpy.mockRestore();
  }
});

test("other saved works resolve translated editions without rewriting saved records", async () => {
  const saved = {
    id: "/works/OL900003W",
    workKey: "/works/OL900003W",
    title: "Titre français",
    author: "Auteur",
    language: "fr",
    tags: ["Favori"],
    status: "read",
  };
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      docs: [
        {
          key: saved.id,
          title: "Titre français",
          author_name: ["Auteur"],
          editions: {
            docs: [
              {
                key: "/books/OL900003M",
                title: "English title",
                language: ["eng"],
                cover_i: 7,
                isbn: ["9780000000003"],
              },
            ],
          },
        },
      ],
    }),
  );
  try {
    const before = JSON.stringify(saved);
    expect(await loadBookEditions([saved], "en")).toBe(true);
    expect(localizeBook(saved, "en")).toMatchObject({
      title: "English title",
      status: "read",
      tags: ["Favori"],
    });
    expect(await loadBookEditions([saved], "en")).toBe(false);
    expect(JSON.stringify(saved)).toBe(before);
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
