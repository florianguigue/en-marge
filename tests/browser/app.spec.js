import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ context }) => {
  // Keep UI checks deterministic and usable without third-party services.
  await context.route(/https:\/\/(fonts\.|covers\.|openlibrary\.)/, (route) =>
    route.abort(),
  );
});

test("catalogue, filters, list view and browser persistence", async ({
  page,
}) => {
  await page.goto("/#discover");
  await expect(page.locator(".book-card")).toHaveCount(8);
  await expect(page.locator(".book-category")).toHaveText(
    Array(8).fill("Fantasy"),
  );
  await page.getByRole("button", { name: "Classiques", exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Tous les livres", exact: true })
    .click();
  await page.locator(".save-book").first().click();
  await page.getByRole("button", { name: /Ma bibliothèque/ }).click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Vue en liste", exact: true }).click();
  await expect(page.locator("#books")).toHaveClass("book-grid list");
  await page.reload();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.locator(".save-book").click();
  await expect(page.locator(".book-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("manual add, edit, tags and JSON export", async ({ page }) => {
  await page.goto("/#discover");
  await page
    .getByRole("button", { name: "Ajouter un livre", exact: true })
    .click();
  await page.locator('[name="title"]').fill("Mon livre");
  await page.locator('[name="author"]').fill("Une autrice");
  await page.locator('[name="pages"]').fill("120");
  await page.locator('[name="tags"]').fill("Roman, Voyage");
  await page
    .getByRole("button", { name: "Ajouter à ma bibliothèque", exact: true })
    .click();
  await page.locator("#books [data-reading-status]").selectOption("reading");
  await page.locator(".book-title").click();
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await page.locator('[name="title"]').fill("Mon livre modifié");
  await page
    .getByRole("button", { name: "Enregistrer les modifications", exact: true })
    .click();
  await page.locator(".book-title").click();
  await expect(page.locator("#detail-title")).toHaveText("Mon livre modifié");
  await page.locator("#personal-tags").fill("Nature, Nature, Essai");
  await page
    .getByRole("button", { name: "Enregistrer les tags", exact: true })
    .click();
  await page.locator("#book-dialog .close-dialog").click();
  await page
    .getByRole("button", { name: "À propos du stockage" })
    .filter({ visible: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exporter ma liste/ }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(saved).toHaveLength(1);
  expect(saved[0].title).toBe("Mon livre modifié");
  expect(saved[0].tags).toEqual(["Nature", "Essai"]);
  expect(saved[0].status).toBe("reading");
});

test("Open Library results and pagination", async ({ page }) => {
  await page.route("https://openlibrary.org/search.json?*", (route) => {
    const second =
      new URL(route.request().url()).searchParams.get("page") === "2";
    return route.fulfill({
      json: {
        numFound: 2,
        docs: [
          {
            key: second ? "/works/OL2W" : "/works/OL1W",
            title: second ? "Dune 2" : "Dune",
            author_name: ["Frank Herbert"],
          },
        ],
      },
    });
  });
  await page.goto("/#discover");
  await page.locator("#search").fill("Dune");
  await page.locator("#search-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".book-title")).toHaveText("Dune");
  await page.getByRole("button", { name: /Voir plus de résultats/ }).click();
  await expect(page.locator(".book-card")).toHaveCount(2);
  await expect(page.locator("#load-more")).toBeHidden();
});

test("unavailable search falls back to the local catalogue", async ({
  page,
}) => {
  await page.goto("/#discover");
  await page.locator("#search").fill("Tolkien");
  await page.locator("#search-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#search-notice")).toContainText(
    "Open Library est indisponible",
  );
  await expect(page.locator(".book-card")).toHaveCount(1);
  await expect(page.locator(".book-title")).toHaveText("Le Hobbit");
});

test("navigation cancels an in-flight search without replacing the wishlist", async ({
  page,
}) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("https://openlibrary.org/search.json?*", async (route) => {
    await pending;
    await route
      .fulfill({
        json: { docs: [{ key: "/works/OL1W", title: "Dune" }], numFound: 1 },
      })
      .catch(() => {});
  });
  await page.goto("/#discover");
  await page.locator("#search").fill("Dune");
  const request = page.waitForRequest("https://openlibrary.org/search.json?*");
  await page.locator("#search-form").evaluate((form) => form.requestSubmit());
  await request;
  await page.getByRole("button", { name: /Ma bibliothèque/ }).click();
  release();
  await expect(page.locator("#result-count")).toHaveText(
    "0 livre dans votre bibliothèque",
  );
  await expect(page.locator("#search-notice")).toBeHidden();
});

test("reading statuses, filters and persistence from cards and details", async ({
  page,
}) => {
  await page.goto("/#discover");
  await expect(page.locator("#reading-filters")).toBeHidden();
  await page.locator(".save-book").first().click();
  await page.getByRole("button", { name: /Ma bibliothèque/ }).click();
  const status = page.locator("#books [data-reading-status]");
  await expect(status).toHaveValue("to-read");
  await status.selectOption("reading");
  await page.locator(".book-title").click();
  const detailStatus = page.locator("#book-dialog [data-reading-status]");
  await expect(detailStatus).toHaveValue("reading");
  await detailStatus.selectOption("read");
  await expect(detailStatus).toHaveValue("read");
  await page.locator("#book-dialog .close-dialog").click();
  await page.locator('[data-reading-filter="to-read"]').click();
  await expect(page.locator(".book-card")).toHaveCount(0);
  await page.locator('[data-reading-filter="read"]').click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await expect(page.locator('[data-reading-filter="read"]')).toHaveText("Lu 1");
  await page.getByRole("button", { name: "Vue en liste", exact: true }).click();
  await status.selectOption("abandoned");
  await expect(page.locator(".book-card")).toHaveCount(0);
  await page.locator('[data-reading-filter="abandoned"]').click();
  await expect(status).toHaveValue("abandoned");
  await page.reload();
  await expect(status).toHaveValue("abandoned");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await status.selectOption("to-read");
  await page.reload();
  await expect(status).toHaveValue("to-read");
});

test("old lists default to À lire and status changes synchronize between tabs", async ({
  page,
  context,
}) => {
  await page.goto("/#discover");
  await page.evaluate(() => {
    localStorage.setItem(
      "en-marge-wishlist-v1",
      JSON.stringify([
        {
          id: "manual:legacy",
          title: "Ancien livre",
          author: "Une autrice",
          manual: true,
        },
      ]),
    );
  });
  await page.goto("/#wishlist");
  await page.reload();
  const status = page.locator("#books [data-reading-status]");
  await expect(status).toHaveValue("to-read");
  const otherPage = await context.newPage();
  await otherPage.goto("/#wishlist");
  await otherPage.locator(".book-title").click();
  await status.selectOption("reading");
  await expect(
    otherPage.locator("#book-dialog [data-reading-status]"),
  ).toHaveValue("reading");
  await expect(otherPage.locator("#books [data-reading-status]")).toHaveValue(
    "reading",
  );
  await otherPage.close();
});

test("an unavailable browser storage does not change the reading status", async ({
  page,
}) => {
  await page.goto("/#discover");
  await page.locator(".save-book").first().click();
  await page.getByRole("button", { name: /Ma bibliothèque/ }).click();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable");
    };
  });
  const status = page.locator("#books [data-reading-status]");
  await status.selectOption("reading");
  await expect(status).toHaveValue("to-read");
  await expect(page.locator("#toast")).toContainText(
    "Votre liste n’a pas été modifiée",
  );
  await page.reload();
  await expect(status).toHaveValue("to-read");
});
