import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { openStore } from "./database.js";

// MCP hosts need not launch the process from the application directory.
const defaultDatabasePath = fileURLToPath(
  new URL("../data/en-marge.sqlite", import.meta.url),
);
const text = z.string().trim().min(1);
const status = z.enum(["to-read", "reading", "read", "abandoned"]);
const result = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
  structuredContent: data,
});
const handle = (operation) => async (args) => {
  try {
    return result(operation(args));
  } catch (error) {
    console.error("Échec de l’outil bibliothèque :", error);
    return {
      isError: true,
      content: [{ type: "text", text: error.message }],
    };
  }
};

export function createLibraryMcpServer({
  databasePath = process.env.DATABASE_PATH || defaultDatabasePath,
  store: sharedStore,
} = {}) {
  const store = sharedStore || openStore(databasePath);
  const server = new McpServer({ name: "en-marge", version: "1.0.0" });
  if (!sharedStore) server.server.onclose = () => store.close();

  server.registerTool(
    "list_books",
    {
      description:
        "Lister les livres de la bibliothèque avec leurs identifiants.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handle(() => store.read()),
  );
  server.registerTool(
    "add_book",
    {
      description:
        "Ajouter un livre à la bibliothèque. Un nouvel identifiant est généré à chaque ajout.",
      inputSchema: z
        .object({
          title: text.describe("Titre du livre"),
          author: text.describe("Auteur ou autrice"),
          status: status.default("to-read"),
          tags: z.array(text).max(15).default([]),
          description: z.string().default(""),
          year: z.number().int().positive().optional(),
          pages: z.number().int().positive().optional(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    handle((args) => ({
      book: store.add({
        ...args,
        id: `manual:${randomUUID()}`,
        manual: true,
        addedAt: Date.now(),
        color: "#557260",
      }),
    })),
  );
  server.registerTool(
    "delete_book",
    {
      description:
        "Supprimer définitivement un livre par son identifiant exact obtenu avec list_books.",
      inputSchema: z.object({ id: text }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    handle(({ id }) => ({ book: store.remove(id) })),
  );
  return server;
}

if (import.meta.main) {
  serveStdio(() => createLibraryMcpServer());
}
