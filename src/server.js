import { fileURLToPath } from "node:url";
import {
  createMcpHandler,
  hostHeaderValidationResponse,
} from "@modelcontextprotocol/server";
import { openStore, validateBooks } from "./database.js";
import { createLibraryMcpServer } from "./mcp.js";
import { createMetadataService, CatalogueError } from "./metadata/index.js";

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const files = new Map(
  [
    ...new Bun.Glob("**/*").scanSync({ cwd: publicDirectory, onlyFiles: true }),
  ].map((path) => [`/${path}`, `${publicDirectory}${path}`]),
);
files.set("/", files.get("/index.html"));

export function parsePort(value = "4173") {
  if (!/^\d+$/.test(String(value)))
    throw new Error("PORT doit être un entier.");
  const port = Number(value);
  if (port < 0 || port > 65535)
    throw new Error("PORT doit être compris entre 0 et 65535.");
  return port;
}

export function startServer({
  port = parsePort(process.env.PORT),
  hostname = process.env.HOST || "127.0.0.1",
  databasePath = process.env.DATABASE_PATH || "./data/en-marge.sqlite",
  publicUrl = process.env.PUBLIC_URL,
  metadataService,
} = {}) {
  const publicOrigin = publicUrl ? new URL(publicUrl).origin : null;
  if (
    publicUrl &&
    (!publicUrl.startsWith("https://") ||
      new URL(publicUrl).pathname !== "/" ||
      new URL(publicUrl).search ||
      new URL(publicUrl).hash ||
      new URL(publicUrl).username ||
      new URL(publicUrl).password)
  ) {
    throw new Error(
      "PUBLIC_URL doit être une origine HTTPS, sans chemin ni identifiants.",
    );
  }
  const store = openStore(databasePath);
  const catalogue = metadataService || createMetadataService({ store });
  const mcp = createMcpHandler(() => createLibraryMcpServer({ store }), {
    maxRequestBodySize: 1024 * 1024,
  });
  let server;
  try {
    server = Bun.serve({
      port,
      hostname,
      maxRequestBodySize: 10 * 1024 * 1024,
      async fetch(request) {
        const headers = new Headers({
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "Cache-Control": "no-cache",
        });
        const { pathname } = new URL(request.url);
        if (pathname === "/mcp") {
          const rejected = hostHeaderValidationResponse(
            request,
            publicOrigin
              ? [new URL(publicOrigin).hostname]
              : ["localhost", "127.0.0.1", "[::1]"],
          );
          if (rejected) return rejected;
          const origin = request.headers.get("Origin");
          if (
            (origin &&
              origin !== (publicOrigin || new URL(request.url).origin)) ||
            request.headers.get("Sec-Fetch-Site") === "cross-site"
          ) {
            return Response.json(
              { error: "Origine non autorisée." },
              { status: 403 },
            );
          }
          const response = await mcp.fetch(request);
          response.headers.set("Cache-Control", "no-store");
          response.headers.set("X-Content-Type-Options", "nosniff");
          return response;
        }
        if (pathname.startsWith("/api/")) {
          headers.set("Cache-Control", "no-store");
          const json = (body, status = 200) =>
            Response.json(body, { status, headers });
          if (pathname.startsWith("/api/catalogue/")) {
            const routes = {
              "/api/catalogue/search": "search",
              "/api/catalogue/book": "book",
              "/api/catalogue/isbn": "isbn",
              "/api/catalogue/providers": "providers",
            };
            const action = routes[pathname];
            if (!action) return json({ error: "Route introuvable." }, 404);
            if (request.method !== "GET") {
              headers.set("Allow", "GET");
              return json({ error: "Méthode non autorisée." }, 405);
            }
            const params = new URL(request.url).searchParams;
            try {
              return json(
                await catalogue[action]({
                  query: params.get("q"),
                  page: params.has("page") ? Number(params.get("page")) : 1,
                  language: params.get("language") || "fr",
                  provider: params.get("provider") || undefined,
                  id: params.get("id"),
                  isbn: params.get("isbn"),
                }),
              );
            } catch (error) {
              return json(
                {
                  error:
                    error instanceof CatalogueError
                      ? error.message
                      : "Catalogue indisponible.",
                },
                error instanceof CatalogueError ? error.status : 503,
              );
            }
          }
          const methods = {
            "/api/library": ["GET", "PUT"],
            "/api/library/import": ["POST"],
            "/api/settings": ["GET", "PUT"],
          }[pathname];
          if (!methods) return json({ error: "Route introuvable." }, 404);
          if (!methods.includes(request.method)) {
            headers.set("Allow", methods.join(", "));
            return json({ error: "Méthode non autorisée." }, 405);
          }
          try {
            if (request.method === "GET")
              return json(
                pathname === "/api/library" ? store.read() : store.settings(),
              );
            const origin = request.headers.get("Origin");
            if (
              (origin &&
                origin !== (publicOrigin || new URL(request.url).origin)) ||
              request.headers.get("Sec-Fetch-Site") === "cross-site"
            )
              return json({ error: "Origine non autorisée." }, 403);
            if (
              !request.headers
                .get("Content-Type")
                ?.startsWith("application/json")
            )
              return json({ error: "JSON requis." }, 415);
            let body;
            try {
              body = await request.json();
            } catch {
              return json({ error: "JSON invalide." }, 400);
            }
            if (pathname === "/api/settings") {
              if (!["fr", "en"].includes(body?.language))
                return json({ error: "Langue invalide." }, 400);
              return json(store.setLanguage(body.language));
            }
            let books;
            try {
              books = validateBooks(body?.books);
            } catch {
              return json({ error: "Liste invalide." }, 400);
            }
            if (pathname === "/api/library/import")
              return json(store.import(books));
            if (!Number.isSafeInteger(body.revision) || body.revision < 0)
              return json({ error: "Révision invalide." }, 400);
            const result = store.replace(books, body.revision);
            return result
              ? json(result)
              : json({ error: "La bibliothèque a changé. Réessayez." }, 409);
          } catch (error) {
            console.error("Échec du stockage", error);
            return json({ error: "Stockage indisponible." }, 503);
          }
        }
        const head = request.method === "HEAD";
        if (request.method !== "GET" && !head) {
          headers.set("Allow", "GET, HEAD");
          return new Response("Méthode non autorisée", {
            status: 405,
            headers,
          });
        }

        if (pathname === "/healthz") {
          headers.set("Content-Type", "application/json; charset=utf-8");
          return new Response(head ? null : JSON.stringify({ status: "ok" }), {
            headers,
          });
        }

        // Resolve only public files discovered at startup; never join a request path.
        const filePath = files.get(pathname);
        if (!filePath)
          return new Response(head ? null : "Page introuvable", {
            status: 404,
            headers,
          });
        const file = Bun.file(filePath);
        headers.set("Content-Type", file.type);
        return new Response(head ? null : file, { headers });
      },
    });
  } catch (error) {
    store.close();
    throw error;
  }
  const stop = server.stop.bind(server);
  server.stop = async (...args) => {
    await mcp.close();
    await stop(...args);
    store.close();
  };
  return server;
}

if (import.meta.main) {
  const server = startServer();
  console.info(`En marge est disponible sur ${server.url}`);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await server.stop();
      process.exit(0);
    });
  }
}
