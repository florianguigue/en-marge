import { test as base, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

export { expect };
export const test = base.extend({
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
