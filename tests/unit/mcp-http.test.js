import { expect, test } from "bun:test";
import { startServer } from "../../src/server.js";
import { hardcoverFixture } from "../fixtures/hardcover.js";

async function rpc(server, method, params = {}, headers = {}) {
  const response = await fetch(new URL("/mcp", server.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.text();
  const data = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? JSON.parse(
        body
          .split("\n")
          .find((line) => line.startsWith("data: "))
          .slice(6),
      )
    : JSON.parse(body);
  return { response, data };
}

test("remote MCP serves public tools over Streamable HTTP and shares the web library", async () => {
  const server = startServer({
    port: 0,
    databasePath: ":memory:",
    publicUrl: "",
    metadataService: hardcoverFixture(),
  });
  try {
    const initialized = await rpc(server, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "remote-test", version: "1.0" },
    });
    expect(initialized.response.status).toBe(200);
    expect(initialized.data.result.serverInfo.name).toBe("en-marge");
    expect(initialized.response.headers.get("cache-control")).toBe("no-store");
    const tools = (await rpc(server, "tools/list")).data.result.tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add_book",
      "delete_book",
      "list_books",
      "search_books",
    ]);
    const call = async (name, args = {}) =>
      (await rpc(server, "tools/call", { name, arguments: args })).data.result;
    expect(
      (await call("search_books", { query: "Dune" })).structuredContent.books[0]
        .id,
    ).toBe("hardcover:12");
    const book = (
      await call("add_book", { title: "Dune", author: "Frank Herbert" })
    ).structuredContent.book;
    const library = async () =>
      (await fetch(new URL("/api/library", server.url))).json();
    expect((await library()).books).toEqual([book]);
    expect((await call("list_books")).structuredContent.books).toEqual([book]);
    expect(
      (await call("delete_book", { id: book.id })).isError,
    ).toBeUndefined();
    expect(await library()).toEqual({ books: [], revision: 2 });
    expect((await call("delete_book", { id: book.id })).isError).toBe(true);
    for (const method of ["GET", "DELETE"]) {
      expect(
        (await fetch(new URL("/mcp", server.url), { method })).status,
      ).toBe(405);
    }
    expect(
      (await rpc(server, "tools/list", {}, { Origin: "https://other.example" }))
        .response.status,
    ).toBe(403);
    expect(
      (await rpc(server, "tools/list", {}, { Host: "other.example" })).response
        .status,
    ).toBe(403);
    const badJson = await fetch(new URL("/mcp", server.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: "{bad",
    });
    expect(badJson.status).toBe(400);
  } finally {
    await server.stop(true);
  }
});

test("HTTPS reverse proxy origin permits browser edits and MCP without trusting forwarded headers", async () => {
  const origin = "https://en-marge.home.florianguigue.fr";
  const server = startServer({
    port: 0,
    databasePath: ":memory:",
    publicUrl: origin,
  });
  try {
    const headers = { Host: "en-marge.home.florianguigue.fr", Origin: origin };
    expect(
      (await rpc(server, "tools/list", {}, headers)).data.result.tools,
    ).toHaveLength(4);
    const edit = await fetch(new URL("/api/library", server.url), {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        books: [{ id: "web", title: "Livre", author: "Auteur" }],
        revision: 0,
      }),
    });
    expect(edit.status).toBe(200);
    expect(
      (
        await rpc(
          server,
          "tools/call",
          { name: "list_books", arguments: {} },
          headers,
        )
      ).data.result.structuredContent.books[0].id,
    ).toBe("web");
    expect(
      (
        await rpc(
          server,
          "tools/list",
          {},
          {
            ...headers,
            Origin: "https://other.example",
            "X-Forwarded-Host": "other.example",
          },
        )
      ).response.status,
    ).toBe(403);
    expect((await fetch(new URL("/healthz", server.url))).status).toBe(200);
  } finally {
    await server.stop(true);
  }
});

test("HTTP confirmation survives independent requests and rejects invalid confirmations without writing", async () => {
  const server = startServer({
    port: 0,
    databasePath: ":memory:",
    publicUrl: "",
    metadataService: hardcoverFixture(),
  });
  const call = async (args) =>
    (await rpc(server, "tools/call", { name: "add_book", arguments: args }))
      .data.result;
  const library = async () =>
    (await fetch(new URL("/api/library", server.url))).json();
  try {
    const proposal = (await call({ title: "Duune", author: "Frank Herbert" }))
      .structuredContent;
    expect(proposal.outcome).toBe("needs_confirmation");
    expect(await library()).toEqual({ books: [], revision: 0 });
    for (const args of [
      { title: "Duune", confirmed: true },
      { title: "Dune", pages: 123 },
      { title: "Duune", candidate_id: "manual:1", confirmed: true },
      { title: "Duune", candidate_id: "hardcover:999", confirmed: true },
    ])
      expect((await call(args)).isError).toBe(true);
    expect(await library()).toEqual({ books: [], revision: 0 });
    const args = {
      title: "Duune",
      author: "Frank Herbert",
      candidate_id: proposal.recommended.id,
      confirmed: true,
      tags: ["Conseillé"],
      status: "reading",
    };
    const added = (await call(args)).structuredContent;
    expect(added.outcome).toBe("added");
    expect(added.book.tags).toContain("Conseillé");
    expect(added.book.status).toBe("reading");
    expect((await call(args)).structuredContent.outcome).toBe("already_exists");
    expect((await library()).revision).toBe(1);
  } finally {
    await server.stop(true);
  }
});

test("rejects invalid public origins before opening the server", () => {
  for (const publicUrl of [
    "http://example.com",
    "https://example.com/mcp",
    "https://user:password@example.com",
    "https://example.com?x=1",
  ]) {
    expect(() =>
      startServer({ port: 0, databasePath: ":memory:", publicUrl }),
    ).toThrow();
  }
});
