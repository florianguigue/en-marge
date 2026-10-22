import { test, expect } from "./fixtures.js";

test.beforeEach(async ({ context }) => {
  await context.route(/https:\/\/(fonts\.|covers\.|openlibrary\.)/, (route) =>
    route.abort(),
  );
});

test("persists independently of browser storage and is shared with a fresh browser context", async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Browser storage disabled");
    };
  });
  await page.goto("/#discover");
  await page.locator(".save-book").first().click();
  await expect(page.locator("#toast")).toContainText("Une nouvelle envie");
  await page.locator('[data-nav="wishlist"]').click();
  await page.locator("#books [data-reading-status]").selectOption("reading");
  await expect(page.locator("#toast")).toContainText("Statut enregistré");
  await page.locator("#language-select").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const context = await browser.newContext({ locale: "fr-FR" });
  try {
    await context.route(/https:\/\/(fonts\.|covers\.|openlibrary\.)/, (route) =>
      route.abort(),
    );
    const other = await context.newPage();
    await other.goto(new URL("/", page.url()).href);
    await expect(other.locator(".book-card")).toHaveCount(1);
    await expect(other.locator("#books [data-reading-status]")).toHaveValue(
      "reading",
    );
    await expect(other.locator("html")).toHaveAttribute("lang", "en");
    expect(await other.evaluate(() => localStorage.length)).toBe(0);
  } finally {
    await context.close();
  }
});

test("retains legacy data on failed import, then transfers it once", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "en-marge-wishlist-v1",
      JSON.stringify([
        {
          id: "manual:legacy",
          title: "Ancien livre",
          author: "Autrice",
          status: "read",
          tags: ["Favori"],
        },
      ]),
    ),
  );
  await page.route("**/api/library/import", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.reload();
  await expect(page.locator("#toast")).toContainText(
    "n’a pas pu être transférée",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("en-marge-wishlist-v1")),
  ).not.toBeNull();
  await page.unroute("**/api/library/import");
  await page.reload();
  await expect(page.locator(".book-title")).toHaveText("Ancien livre");
  expect(
    await page.evaluate(() => localStorage.getItem("en-marge-wishlist-v1")),
  ).toBeNull();
  await page.reload();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await expect(page.locator("#books [data-reading-status]")).toHaveValue(
    "read",
  );
});

test("failed initial load cannot overwrite an existing server library", async ({
  page,
  request,
}) => {
  const current = await (await request.get("/api/library")).json();
  const book = { id: "manual:server", title: "À conserver", author: "Autrice" };
  await request.put("/api/library", {
    data: { books: [book], revision: current.revision },
  });
  await page.route("**/api/library", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/#discover");
  await expect(page.locator("#toast")).toContainText("inaccessible");
  await page.locator(".save-book").first().click();
  await expect(page.locator("#toast")).toContainText("n’a pas été modifiée");
  expect((await (await request.get("/api/library")).json()).books[0].id).toBe(
    book.id,
  );
});
