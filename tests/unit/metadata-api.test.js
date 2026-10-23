import { expect, test } from "bun:test";
import { startServer } from "../../src/server.js";
import { createMetadataService } from "../../src/metadata/index.js";
import { createGoogleBooks } from "../../src/metadata/providers/google-books.js";

test("catalogue HTTP API normalizes provider data and validates routes without changing the library", async () => {
  const calls = [];
  const provider = createGoogleBooks({
    apiKey: "private-key",
    request: async (url) => {
      calls.push(new URL(url));
      const volume = {
        id: "hobbit",
        volumeInfo: {
          title: "Le Hobbit",
          authors: ["Tolkien"],
          language: "fr",
          industryIdentifiers: [
            { type: "ISBN_13", identifier: "9780547928227" },
          ],
        },
      };
      return url.pathname.endsWith("/hobbit")
        ? volume
        : { kind: "books#volumes", totalItems: 1, items: [volume] };
    },
  });
  const service = createMetadataService({ providers: [provider], env: {} });
  const server = startServer({
    port: 0,
    hostname: "127.0.0.1",
    databasePath: ":memory:",
    metadataService: service,
  });
  const get = (path, options) => fetch(new URL(path, server.url), options);
  try {
    const response = await get("/api/catalogue/search?q=Hobbit&language=fr");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const result = await response.json();
    expect(result.books[0]).toMatchObject({
      id: "google-books:hobbit",
      language: "fr",
      title: "Le Hobbit",
    });
    expect(JSON.stringify(result)).not.toContain("private-key");
    expect(calls[0].searchParams.get("key")).toBe("private-key");
    const detail = await (
      await get(
        "/api/catalogue/book?provider=google-books&id=hobbit&language=fr",
      )
    ).json();
    expect(detail.book.sources[0].provider).toBe("google-books");
    expect(
      (await (await get("/api/catalogue/isbn?isbn=0-547-92822-X")).json()).book
        .isbn,
    ).toBe("9780547928227");
    for (const path of [
      "/api/catalogue/search",
      "/api/catalogue/search?q=x&page=-1",
      "/api/catalogue/search?q=x&language=de",
      "/api/catalogue/book?provider=missing&id=1",
      "/api/catalogue/isbn?isbn=bad",
    ])
      expect((await get(path)).status).toBe(400);
    expect((await get("/api/catalogue/missing")).status).toBe(404);
    const wrongMethod = await get("/api/catalogue/search?q=x", {
      method: "POST",
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("Allow")).toBe("GET");
    expect(await (await get("/api/catalogue/providers")).json()).toEqual([
      { id: "google-books", enabled: true },
    ]);
    expect(await (await get("/api/library")).json()).toEqual({
      books: [],
      revision: 0,
    });
  } finally {
    await server.stop(true);
  }
});
