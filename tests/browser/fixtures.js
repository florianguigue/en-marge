import { test as base, expect } from "@playwright/test";
import { legacyBooks } from "../../public/js/legacy-editions.js";
import { execFileSync } from "node:child_process";

export { expect, legacyBooks };
export async function seedLibrary(request, books = [legacyBooks[0]]) {
  const current = await (await request.get("/api/library")).json();
  const response = await request.put("/api/library", {
    data: { books, revision: current.revision },
  });
  expect(response.ok()).toBe(true);
}

export const test = base.extend({
  metadataOffline: [
    async ({ context }, use) => {
      await context.route("**/api/catalogue/**", (route) =>
        route.fulfill({
          status: 503,
          json: { error: "Catalogue indisponible." },
        }),
      );
      await context.route("https://**", (route) => route.abort());
      await use();
    },
    { auto: true },
  ],
  resetDatabase: [
    async ({}, use) => {
      execFileSync("bun", [
        "-e",
        `
        import { openStore } from "./src/database.js";
        const store = openStore(process.env.E2E_DATABASE_PATH);
        store.replace([], store.read().revision);
        store.setLanguage(null);
        store.close();
      `,
      ]);
      await use();
    },
    { auto: true },
  ],
});
