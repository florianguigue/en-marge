import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { openStore } from "../../src/database.js";
import { hardcoverFixture } from "../fixtures/hardcover.js";

async function connect(databasePath) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../../src/mcp.js", import.meta.url))],
    {
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        HARDCOVER_API_TOKEN: "test-token",
        METADATA_DISABLED_PROVIDERS: "google-books",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let nextId = 0;
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
  });
  // Drain diagnostic output so an error cannot block the protocol pipe.
  child.stderr.resume();
  const send = (message) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP timeout: ${method}`));
      }, 3000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(message);
      });
      send({ id, method, params });
    });
  const close = () =>
    new Promise((resolve) => {
      child.once("exit", resolve);
      child.stdin.end();
    });
  const initialized = await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "en-marge-test", version: "1.0.0" },
  });
  expect(initialized.error).toBeUndefined();
  send({ method: "notifications/initialized" });
  return { request, close };
}

test("MCP stdio lists, validates, adds, updates and deletes persistent books shared with the app", async () => {
  const directory = mkdtempSync(join(tmpdir(), "en-marge-mcp-"));
  const path = join(directory, "library.sqlite");
  const store = openStore(path);
  let client;
  try {
    // Prewarm the persistent catalogue cache; the stdio child uses the real
    // service without making network calls or using personal credentials.
    const catalogue = hardcoverFixture({ store });
    await catalogue.search({
      query: "Dune Frank Herbert",
      provider: "hardcover",
    });
    await catalogue.book({ provider: "hardcover", id: "12" });
    client = await connect(path);
    const tools = (await client.request("tools/list")).result.tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add_book",
      "delete_book",
      "list_books",
      "search_books",
      "update_book_status",
    ]);
    expect(
      tools.find((tool) => tool.name === "delete_book").annotations
        .destructiveHint,
    ).toBe(true);
    const call = async (name, args = {}) =>
      (await client.request("tools/call", { name, arguments: args })).result;
    expect((await call("list_books")).structuredContent.books).toEqual([]);
    for (const args of [
      {},
      { title: " ", author: "Auteur" },
      { title: "Livre", author: "Auteur", status: "bad" },
    ]) {
      expect((await call("add_book", args)).isError).toBe(true);
    }
    expect(store.read().revision).toBe(0);
    const added = (
      await call("add_book", {
        title: " Dune ",
        author: "Frank Herbert",
        tags: ["SF"],
      })
    ).structuredContent.book;
    expect(added.title).toBe("Dune");
    expect(added.status).toBe("to-read");
    expect(added.id).toBe("hardcover:12:edition:120");
    expect(added.manual).toBe(false);
    expect(added.publisher).toBe("Éditeur");
    expect(added.series[0].name).toBe("Dune");
    expect(store.read()).toEqual({ books: [added], revision: 1 });
    // An edit based on the UI's previous revision must not overwrite an MCP addition.
    expect(store.replace([], 0)).toBeNull();
    const updated = { ...added, status: "read" };
    expect(
      (await call("update_book_status", { id: added.id, status: "read" }))
        .structuredContent.book,
    ).toEqual(updated);
    expect(store.read()).toEqual({ books: [updated], revision: 2 });
    expect(store.replace([added], 1)).toBeNull();
    await client.close();
    client = await connect(path);
    expect((await call("list_books")).structuredContent.books).toEqual([
      updated,
    ]);
    const other = { id: "manual:ui", title: "Autre livre", author: "Autrice" };
    store.import([other]);
    expect((await call("delete_book", { id: "missing" })).isError).toBe(true);
    expect(store.read().revision).toBe(3);
    expect(
      (await call("delete_book", { id: added.id })).structuredContent.book,
    ).toEqual(updated);
    expect(store.read().books.map((book) => book.id)).toEqual([other.id]);
    expect(store.read().revision).toBe(4);
  } finally {
    await client?.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
