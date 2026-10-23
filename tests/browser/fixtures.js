import { test as base, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

export { expect };
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
