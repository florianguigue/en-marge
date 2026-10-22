import { afterAll, beforeAll, expect, test } from "bun:test";
import { parsePort, startServer } from "../../src/server.js";

let server;
beforeAll(() => {
  server = startServer({ port: 0, hostname: "127.0.0.1" });
});
afterAll(() => server?.stop(true));
const request = (path, options) => fetch(new URL(path, server.url), options);

test("serves the app and every JavaScript module with usable content types", async () => {
  const index = await request("/?example=1");
  expect(index.status).toBe(200);
  expect(index.headers.get("content-type")).toContain("text/html");
  expect(await index.text()).toContain('type="module"');
  for (const file of [
    "app",
    "catalogue",
    "icons",
    "open-library",
    "storage",
    "utils",
  ]) {
    const response = await request(`/js/${file}.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
  }
  expect((await request("/style.css")).headers.get("content-type")).toContain(
    "text/css",
  );
});

test("supports health checks and HEAD without a body", async () => {
  expect(await (await request("/healthz")).json()).toEqual({ status: "ok" });
  for (const path of ["/", "/healthz", "/js/app.js"]) {
    const response = await request(path, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  }
});

test("keeps project files private and rejects unknown paths", async () => {
  for (const path of [
    "/missing",
    "/package.json",
    "/src/server.js",
    "/.git/config",
    "/%2e%2e/package.json",
    "/js/%2e%2e/%2e%2e/package.json",
  ]) {
    expect((await request(path)).status).toBe(404);
  }
});

test("rejects writes and advertises supported methods", async () => {
  const response = await request("/", { method: "POST", body: "example" });
  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("GET, HEAD");
});

test("validates PORT instead of silently using another port", () => {
  expect(parsePort()).toBe(4173);
  expect(parsePort("0")).toBe(0);
  expect(parsePort("8080")).toBe(8080);
  for (const value of ["", "abc", "4173oops", "1.5", "-1", "65536"]) {
    expect(() => parsePort(value)).toThrow();
  }
});
