import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../src/database.js";
import { createMetadataService } from "../../src/metadata/index.js";
import { createHttpClient, ProviderError } from "../../src/metadata/http.js";
import {
  metadata,
  normalizeIsbn,
  mergeBooks,
  deduplicate,
} from "../../src/metadata/model.js";
import {
  createGoogleBooks,
  normalizeGoogleVolume,
} from "../../src/metadata/providers/google-books.js";
import {
  createHardcover,
  normalizeHardcover,
} from "../../src/metadata/providers/hardcover.js";

const isbn = "9780547928227";
const record = (provider, id, fields = {}) =>
  metadata(provider, id, {
    title: "The Hobbit",
    author: "J. R. R. Tolkien",
    isbn,
    ...fields,
  });
const fakeProvider = (id, fields = {}) => ({
  id,
  enabled: true,
  search: async () => ({ books: [], total: 0, hasMore: false }),
  findByIsbn: async () => [],
  findByExternalId: async () => null,
  ...fields,
});

test("ISBN matching validates checksums and equates ISBN-10 with ISBN-13", () => {
  expect(normalizeIsbn("0-547-92822-X")).toBe(isbn);
  expect(normalizeIsbn("978-0-547-92822-7")).toBe(isbn);
  for (const invalid of ["9780000000000", "123", "isbn:bad", "9780547928228"])
    expect(normalizeIsbn(invalid)).toBe("");
});

test("Google volumes are editions, strip HTML, select HTTPS covers and retain provenance", () => {
  const book = normalizeGoogleVolume({
    id: "gb1",
    volumeInfo: {
      title: "The Hobbit",
      authors: ["Tolkien"],
      description: "<p>A <b>journey</b> &amp; adventure</p>",
      language: "en",
      industryIdentifiers: [{ type: "ISBN_13", identifier: isbn }],
      imageLinks: {
        large: "http://books.google.com/large",
        thumbnail: "https://books.google.com/small",
      },
    },
  });
  expect(book).toMatchObject({
    id: "google-books:gb1",
    workId: null,
    editionId: "google-books:gb1",
    isbn,
    coverUrl: "https://books.google.com/large",
    description: "A journey & adventure",
    language: "en",
  });
  expect(book.provenance.description.provider).toBe("google-books");
  expect(normalizeGoogleVolume({ id: "missing" })).toBeNull();
  expect(
    normalizeGoogleVolume({
      id: "safe",
      volumeInfo: {
        title: "Safe",
        imageLinks: { thumbnail: "javascript:alert(1)" },
      },
    }).coverUrl,
  ).toBe("");
});

test("merging fills gaps, preserves primary edition and tracks field sources", () => {
  const primary = record("google-books", "1", {
    language: "fr",
    title: "Le Hobbit",
  });
  const secondary = record("hardcover", "2", {
    description: "A journey",
    pages: 320,
    series: [{ name: "Middle-earth", position: 1 }],
  });
  const before = JSON.stringify(primary);
  const merged = mergeBooks(primary, secondary);
  expect(merged.title).toBe("Le Hobbit");
  expect(merged.description).toBe("A journey");
  expect(merged.provenance.description.provider).toBe("hardcover");
  expect(merged.provenance.title.provider).toBe("google-books");
  expect(merged.sources).toHaveLength(2);
  expect(merged.externalIds).toEqual({ "google-books": "1", hardcover: "2" });
  expect(JSON.stringify(primary)).toBe(before);
  const otherEdition = record("google-books", "3", {
    isbn: "9782070612888",
    pages: 717,
  });
  expect(mergeBooks(primary, otherEdition)).toBe(primary);
  expect(deduplicate([primary, secondary, otherEdition], "fr")).toHaveLength(2);
  expect(
    deduplicate(
      [
        record("google-books", "unknown", { isbn: "" }),
        record("hardcover", "unknown", { isbn: "" }),
      ],
      "fr",
    ),
  ).toHaveLength(2);
});

test("Hardcover work ISBNs never masquerade as a single edition", () => {
  const book = {
    id: 12,
    title: "The Hobbit",
    isbns: [isbn, "9782070612888"],
    author_names: ["Tolkien"],
    book_series: [{ position: 1.5, series: { id: 1, name: "Middle-earth" } }],
  };
  expect(normalizeHardcover(book).isbns).toEqual([]);
  expect(normalizeHardcover(book).series[0].position).toBe(1.5);
  const a = normalizeHardcover(book, {
    id: 1,
    isbn_13: isbn,
    language: { code2: "en" },
  });
  const b = normalizeHardcover(book, {
    id: 2,
    isbn_13: "9782070612888",
    language: { code2: "fr" },
  });
  expect(a.workId).toBe(b.workId);
  expect(a.id).not.toBe(b.id);
  expect(deduplicate([a, b], "fr")).toHaveLength(2);
});

test("Google search uses offsets and preserves unknown and other languages", async () => {
  const urls = [];
  const provider = createGoogleBooks({
    apiKey: "private",
    request: async (url) => {
      urls.push(new URL(url));
      return {
        kind: "books#volumes",
        totalItems: 100,
        items: [
          { id: "1", volumeInfo: { title: "Inconnu" } },
          { id: "2", volumeInfo: { title: "English", language: "en" } },
        ],
      };
    },
  });
  const result = await provider.search({
    query: "Zorhal",
    page: 2,
    language: "fr",
  });
  expect(result.books).toHaveLength(2);
  expect(urls[0].searchParams.get("startIndex")).toBe("24");
  expect(urls[0].searchParams.has("langRestrict")).toBe(false);
  expect(urls[0].searchParams.get("key")).toBe("private");
  await provider.findByIsbn(isbn, "en");
  expect(urls[1].searchParams.get("q")).toBe(`isbn:${isbn}`);
});

test("Hardcover uses server-side variables and detects GraphQL failures", async () => {
  const calls = [];
  const provider = createHardcover({
    token: "Bearer private-token",
    request: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, options, body });
      if (body.query.includes("Search"))
        return {
          data: {
            search: {
              results: JSON.stringify({
                found: 1,
                hits: [
                  {
                    document: {
                      id: 12,
                      title: "The Hobbit",
                      author_names: ["Tolkien"],
                    },
                  },
                ],
              }),
            },
          },
        };
      return { errors: [{ message: "private error" }] };
    },
  });
  expect((await provider.search({ query: 'title "quoted"' })).books[0].id).toBe(
    "hardcover:12",
  );
  expect(calls[0].options.headers.Authorization).toBe("Bearer private-token");
  expect(calls[0].body.variables.text).toBe('title "quoted"');
  expect(calls[0].body.query).not.toContain("quoted");
  await expect(provider.findByExternalId("12", "fr")).rejects.toThrow(
    "invalid_response",
  );
  expect(createHardcover({ request: async () => {} }).enabled).toBe(false);
});

test("default search uses Hardcover for text and ISBN without querying Google on success", async () => {
  const calls = [];
  const service = createMetadataService({
    env: {
      HARDCOVER_API_TOKEN: "private-token",
      GOOGLE_BOOKS_API_KEY: "private-key",
    },
    fetchImpl: async (url, options) => {
      calls.push(String(url));
      if (String(url) !== "https://api.hardcover.app/v1/graphql")
        throw new Error("Unexpected fallback");
      const { query } = JSON.parse(options.body);
      if (query.includes("Search"))
        return Response.json({
          data: {
            search: {
              results: {
                found: 1,
                hits: [{ document: { id: 12, title: "The Hobbit" } }],
              },
            },
          },
        });
      if (query.includes("Isbn"))
        return Response.json({
          data: {
            editions: [
              { id: 1, book_id: 12, isbn_13: isbn, language: { code2: "en" } },
            ],
          },
        });
      return Response.json({
        data: { books: [{ id: 12, title: "The Hobbit" }] },
      });
    },
  });
  expect(service.providers()).toEqual([
    { id: "hardcover", enabled: true },
    { id: "google-books", enabled: true },
  ]);
  expect((await service.search({ query: "Hobbit" })).provider).toBe(
    "hardcover",
  );
  expect((await service.search({ query: isbn })).provider).toBe("hardcover");
  expect((await service.isbn({ isbn })).book.provider).toBe("hardcover");
  expect(
    calls.every((url) => url === "https://api.hardcover.app/v1/graphql"),
  ).toBe(true);
});

test("empty Hardcover results fall back to Google for search and ISBN lookup", async () => {
  const calls = [];
  const primary = fakeProvider("hardcover", {
    search: async () => {
      calls.push("hardcover-search");
      return { books: [], total: 0 };
    },
    findByIsbn: async () => {
      calls.push("hardcover-isbn");
      return [];
    },
  });
  const fallback = fakeProvider("google-books", {
    search: async () => {
      calls.push("google-search");
      return { books: [record("google-books", "1")], total: 1 };
    },
    findByIsbn: async () => {
      calls.push("google-isbn");
      return [record("google-books", "1")];
    },
  });
  const service = createMetadataService({
    providers: [primary, fallback],
    env: {},
  });
  expect((await service.search({ query: "Hobbit" })).provider).toBe(
    "google-books",
  );
  expect((await service.isbn({ isbn })).book.provider).toBe("google-books");
  expect(calls).toEqual([
    "hardcover-search",
    "google-search",
    "hardcover-isbn",
    "google-isbn",
  ]);
});

test("a complete Hardcover edition does not trigger a Google enrichment lookup", async () => {
  let calls = 0;
  const primary = fakeProvider("hardcover", {
    findByExternalId: async () =>
      record("hardcover", "1", {
        description: "Summary",
        coverUrl: "https://example.org/cover.jpg",
        pages: 300,
        publisher: "Publisher",
        language: "fr",
      }),
  });
  const fallback = fakeProvider("google-books", {
    findByIsbn: async () => {
      calls++;
      return [];
    },
  });
  const service = createMetadataService({
    providers: [primary, fallback],
    env: {},
  });
  expect(
    (await service.book({ provider: "hardcover", id: "1" })).book.provider,
  ).toBe("hardcover");
  expect(calls).toBe(0);
});

test("search falls back after failure, pins pagination and reports partial availability", async () => {
  const primary = fakeProvider("hardcover", {
    search: async () => {
      throw new ProviderError("rate_limited", 429);
    },
  });
  let calls = 0;
  const fallback = fakeProvider("google-books", {
    search: async ({ page }) => {
      calls++;
      return {
        books: [record("google-books", String(page))],
        total: 50,
        hasMore: true,
      };
    },
  });
  const service = createMetadataService({
    providers: [primary, fallback],
    env: {},
  });
  const result = await service.search({ query: "Hobbit" });
  expect(result.provider).toBe("google-books");
  expect(result.warnings).toEqual([
    { provider: "hardcover", code: "rate_limited" },
  ]);
  expect(
    (
      await service.search({
        query: "Hobbit",
        page: 2,
        provider: "google-books",
      })
    ).books[0].id,
  ).toBe("google-books:2");
  expect(calls).toBe(2);
});

test("successful empty searches and total outages have different outcomes", async () => {
  const service = createMetadataService({
    providers: [fakeProvider("empty")],
    env: {},
  });
  expect((await service.search({ query: "Nothing" })).books).toEqual([]);
  const down = createMetadataService({
    providers: [
      fakeProvider("down", {
        search: async () => {
          throw new Error("private error");
        },
      }),
    ],
    env: {},
  });
  await expect(down.search({ query: "Nothing" })).rejects.toMatchObject({
    status: 503,
  });
});

test("detail enrichment tolerates the fallback being unavailable", async () => {
  const primary = fakeProvider("hardcover", {
    findByExternalId: async () => record("hardcover", "1"),
  });
  const fallback = fakeProvider("google-books", {
    findByIsbn: async () => {
      throw new Error("offline");
    },
  });
  const service = createMetadataService({
    providers: [primary, fallback],
    env: {},
  });
  const result = await service.book({ provider: "hardcover", id: "1" });
  expect(result.book.id).toBe("hardcover:1");
  expect(result.book.sources).toHaveLength(1);
  expect(result.warnings).toEqual([
    { provider: "google-books", code: "unavailable" },
  ]);
});

test("a Google edition can resolve translations through an explicit Hardcover ISBN match", async () => {
  const google = fakeProvider("google-books", {
    findByExternalId: async () =>
      record("google-books", "linked", { language: "en" }),
  });
  const french = record("hardcover", "related-fr", {
    isbn: "9782070612888",
    language: "fr",
    title: "Titre français",
  });
  const hardcover = fakeProvider("hardcover", {
    findByIsbn: async () => [
      record("hardcover", "work-1", {
        workId: "hardcover:work-1",
        language: "en",
      }),
    ],
    findByExternalId: async (id) => {
      expect(id).toBe("work-1");
      return { ...french, editions: [french] };
    },
  });
  const service = createMetadataService({
    providers: [google, hardcover],
    env: {},
  });
  const { book } = await service.book({
    provider: "google-books",
    id: "linked",
    language: "fr",
  });
  expect(book.id).toBe("google-books:linked");
  expect(book.isbn).toBe(isbn);
  expect(book.editions[0]).toMatchObject({
    title: "Titre français",
    language: "fr",
    isbn: "9782070612888",
  });
});

test("cache persists across service restarts, expires and does not change library revision", async () => {
  const directory = mkdtempSync(join(tmpdir(), "en-marge-metadata-"));
  const path = join(directory, "library.sqlite");
  let store = openStore(path);
  let calls = 0;
  const providers = [
    fakeProvider("google-books", {
      search: async () => {
        calls++;
        return {
          books: [record("google-books", "1")],
          total: 1,
          hasMore: false,
        };
      },
    }),
  ];
  try {
    const first = createMetadataService({ store, providers, env: {} });
    await Promise.all([
      first.search({ query: "Hobbit" }),
      first.search({ query: "Hobbit" }),
    ]);
    expect(calls).toBe(1);
    store.close();
    store = openStore(path);
    const second = createMetadataService({ store, providers, env: {} });
    await second.search({ query: "Hobbit" });
    expect(calls).toBe(1);
    await second.search({ query: "Hobbit", language: "en" });
    expect(calls).toBe(2);
    expect(store.read()).toEqual({ books: [], revision: 0 });
    store.metadataCacheSet("expiring", { value: 1 }, 10, 100);
    expect(store.metadataCacheGet("expiring", 109)).toEqual({ value: 1 });
    expect(store.metadataCacheGet("expiring", 110)).toBeNull();
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("configuration disables providers without exposing credentials and validates input", async () => {
  const service = createMetadataService({
    env: {
      GOOGLE_BOOKS_API_KEY: "secret",
      HARDCOVER_API_TOKEN: "secret",
      METADATA_DISABLED_PROVIDERS: "hardcover",
    },
  });
  expect(service.providers()).toEqual([
    { id: "hardcover", enabled: false },
    { id: "google-books", enabled: true },
  ]);
  expect(JSON.stringify(service.providers())).not.toContain("secret");
  for (const args of [
    { query: "" },
    { query: "x", page: -1 },
    { query: "x", page: 1.5 },
    { query: "x", language: "de" },
    { query: "x", provider: "open-library" },
  ])
    await expect(service.search(args)).rejects.toMatchObject({ status: 400 });
  await expect(
    service.book({ provider: "google-books", id: "../../secret" }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(service.isbn({ isbn: "9780000000000" })).rejects.toMatchObject({
    status: 400,
  });
});

test("HTTP retries transient failures, honors Retry-After and never retries authentication failures", async () => {
  let calls = 0;
  let clock = 0;
  const request = createHttpClient({
    intervalMs: 1000,
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? new Response("offline", { status: 503 })
        : Response.json({ ok: true });
    },
  });
  expect(await request("https://example.org")).toEqual({ ok: true });
  expect(calls).toBe(2);
  expect(clock).toBe(1000);
  let limitedCalls = 0;
  const limited = createHttpClient({
    now: () => clock,
    fetchImpl: async () => {
      limitedCalls++;
      return new Response("limited", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    },
  });
  await expect(limited("https://example.org")).rejects.toMatchObject({
    code: "rate_limited",
  });
  await expect(limited("https://example.org")).rejects.toMatchObject({
    code: "rate_limited",
  });
  expect(limitedCalls).toBe(1);
  let deniedCalls = 0;
  const denied = createHttpClient({
    fetchImpl: async () => {
      deniedCalls++;
      return new Response("denied", { status: 401 });
    },
  });
  await expect(denied("https://example.org")).rejects.toMatchObject({
    status: 401,
  });
  expect(deniedCalls).toBe(1);
});
