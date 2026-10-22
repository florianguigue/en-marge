import { fileURLToPath } from "node:url";

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
} = {}) {
  return Bun.serve({
    port,
    hostname,
    fetch(request) {
      const headers = new Headers({
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Cache-Control": "no-cache",
      });
      const head = request.method === "HEAD";
      if (request.method !== "GET" && !head) {
        headers.set("Allow", "GET, HEAD");
        return new Response("Méthode non autorisée", { status: 405, headers });
      }

      const { pathname } = new URL(request.url);
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
