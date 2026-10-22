import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineConfig } from "@playwright/test";

process.env.E2E_DATABASE_PATH ||= join(
  tmpdir(),
  `en-marge-e2e-${process.pid}.sqlite`,
);
export default defineConfig({
  workers: 1,
  testDir: "./tests/browser",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    locale: "fr-FR",
  },
  webServer: {
    command: "bun run start",
    url: "http://127.0.0.1:4174/healthz",
    env: {
      HOST: "127.0.0.1",
      PORT: "4174",
      DATABASE_PATH: process.env.E2E_DATABASE_PATH,
    },
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
