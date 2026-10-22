import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../src/server.js";

const directory = mkdtempSync(join(tmpdir(), "en-marge-db-"));
const databasePath = join(directory, "nested", "library.sqlite");
const book = {
  id: "manual:1",
  title: "Livre",
  author: "Autrice",
  tags: ["Roman"],
  status: "reading",
};
let server;
const start = () =>
  startServer({ port: 0, hostname: "127.0.0.1", databasePath });
const request = (path, method = "GET", body, headers = {}) =>
  fetch(new URL(path, server.url), {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeAll(() => {
  server = start();
});
afterAll(async () => {
  await server?.stop(true);
  rmSync(directory, { recursive: true, force: true });
});

test("commits books and language, persists across server restart, and rejects stale writes", async () => {
  expect(await (await request("/api/library")).json()).toEqual({
    books: [],
    revision: 0,
  });
  const saved = await request("/api/library", "PUT", {
    books: [book],
    revision: 0,
  });
  expect(saved.status).toBe(200);
  expect(saved.headers.get("cache-control")).toBe("no-store");
  expect(await saved.json()).toEqual({ books: [book], revision: 1 });
  expect(
    (await request("/api/settings", "PUT", { language: "en" })).status,
  ).toBe(200);
  await server.stop(true);
  server = start();
  expect(await (await request("/api/library")).json()).toEqual({
    books: [book],
    revision: 1,
  });
  expect(await (await request("/api/settings")).json()).toEqual({
    language: "en",
  });
  expect(
    (await request("/api/library", "PUT", { books: [], revision: 0 })).status,
  ).toBe(409);
  expect((await (await request("/api/library")).json()).books).toEqual([book]);
});

test("merges legacy data idempotently without replacing server books", async () => {
  const legacy = { id: "manual:2", title: "Ancien", author: "Auteur" };
  for (let i = 0; i < 2; i++) {
    const response = await request("/api/library/import", "POST", {
      books: [{ ...book, status: "read" }, legacy],
    });
    expect(response.status).toBe(200);
    expect((await response.json()).books).toEqual([
      book,
      { ...legacy, tags: [], status: "to-read" },
    ]);
  }
});

test("rejects malformed data, unsupported methods and cross-origin writes without data loss", async () => {
  const before = await (await request("/api/library")).json();
  for (const body of [
    null,
    {},
    { books: {} },
    { books: [null] },
    { books: [{ id: "x" }] },
    { books: [book, book], revision: before.revision },
    { books: [], revision: -1 },
  ]) {
    expect((await request("/api/library", "PUT", body)).status).toBe(400);
  }
  expect(
    (await request("/api/settings", "PUT", { language: "de" })).status,
  ).toBe(400);
  expect((await request("/api/library", "DELETE")).status).toBe(405);
  expect((await request("/api/missing")).status).toBe(404);
  expect(
    (
      await request(
        "/api/library",
        "PUT",
        { books: [], revision: before.revision },
        { Origin: "https://other.example" },
      )
    ).status,
  ).toBe(403);
  const invalid = await fetch(new URL("/api/library", server.url), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: "{bad",
  });
  expect(invalid.status).toBe(400);
  expect(
    (await request("/api/library", "PUT", {}, { "Content-Type": "text/plain" }))
      .status,
  ).toBe(415);
  expect(await (await request("/api/library")).json()).toEqual(before);
  const removed = await request("/api/library", "PUT", {
    books: [],
    revision: before.revision,
  });
  expect(removed.status).toBe(200);
  await server.stop(true);
  server = start();
  expect((await (await request("/api/library")).json()).books).toEqual([]);
});
