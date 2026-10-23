import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { openStore } from "./database.js";
import { createMetadataService } from "./metadata/index.js";
import { createBookWorkflow } from "./mcp-catalogue.js";

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
    return result(await operation(args));
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
  metadataService,
} = {}) {
  const store = sharedStore || openStore(databasePath);
  const workflow = createBookWorkflow({
    store,
    catalogue: metadataService || createMetadataService({ store }),
  });
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
    "search_books",
    {
      description:
        "Rechercher un titre, un auteur ou un ISBN dans Hardcover sans modifier la bibliothèque. Comparer les candidats avant un ajout ; transmettre leur id à add_book uniquement après confirmation explicite si la correspondance est incertaine.",
      inputSchema: z
        .object({
          query: text.max(300),
          language: z
            .enum(["fr", "en"])
            .optional()
            .describe(
              "Langue souhaitée ; préférence de la bibliothèque par défaut",
            ),
          page: z.number().int().min(1).max(100).default(1),
        })
        .strict(),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handle(workflow.search),
  );
  server.registerTool(
    "add_book",
    {
      description:
        "Chercher la meilleure correspondance Hardcover et ajouter sa fiche complète, dans la langue souhaitée. En cas d’ambiguïté ou de langue différente, renvoie needs_confirmation sans écriture : présenter la fiche et demander le choix de l’utilisateur, puis rappeler avec candidate_id et confirmed: true après son accord explicite. Aucun ajout manuel ni repli si Hardcover est indisponible. Un livre déjà présent n’est pas ajouté à nouveau.",
      inputSchema: z
        .object({
          title: text.max(300).describe("Titre du livre ou ISBN à chercher"),
          author: text
            .max(300)
            .optional()
            .describe("Auteur ou autrice, si connu"),
          language: z.enum(["fr", "en"]).optional(),
          candidate_id: text
            .regex(/^hardcover:\d{1,10}(?::edition:\d{1,10})?$/)
            .optional()
            .describe(
              "Identifiant exact de la fiche ou édition Hardcover choisie parmi les résultats",
            ),
          confirmed: z
            .boolean()
            .default(false)
            .describe(
              "True uniquement après accord explicite de l’utilisateur pour candidate_id",
            ),
          status: status.default("to-read"),
          tags: z.array(text).max(15).default([]),
        })
        .strict()
        .refine((args) => !args.confirmed || Boolean(args.candidate_id), {
          message: "candidate_id est requis après confirmation.",
        }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    handle(workflow.add),
  );
  server.registerTool(
    "update_book_status",
    {
      description:
        "Modifier le statut de lecture d’un livre par son identifiant exact obtenu avec list_books, sans changer ses autres informations. Statuts : to-read (À lire), reading (En cours), read (Lu), abandoned (Abandonné). Répéter le statut actuel ne modifie pas la bibliothèque.",
      inputSchema: z.object({ id: text, status }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    handle(({ id, status }) => ({ book: store.updateBookStatus(id, status) })),
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
