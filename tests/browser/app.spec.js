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
  await page.goto("/");
  await expect(page.locator(".book-card")).toHaveCount(8);
  await page.getByRole("button", { name: "Imaginaire", exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Tous les livres", exact: true })
    .click();
  await page.locator(".save-book").first().click();
  await page.getByRole("button", { name: /Ma liste à lire/ }).click();
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
  await page.goto("/");
  await page
    .getByRole("button", { name: "Ajouter un livre", exact: true })
    .click();
  await page.locator('[name="title"]').fill("Mon livre");
  await page.locator('[name="author"]').fill("Une autrice");
  await page.locator('[name="pages"]').fill("120");
  await page.locator('[name="tags"]').fill("Roman, Voyage");
  await page
    .getByRole("button", { name: "Ajouter à ma liste à lire", exact: true })
    .click();
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
  await page.goto("/");
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
  await page.goto("/");
  await page.locator("#search").fill("Camus");
  await page.locator("#search-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#search-notice")).toContainText(
    "Open Library est indisponible",
  );
  await expect(page.locator(".book-card")).toHaveCount(1);
  await expect(page.locator(".book-title")).toHaveText("L’Étranger");
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
  await page.goto("/");
  await page.locator("#search").fill("Dune");
  const request = page.waitForRequest("https://openlibrary.org/search.json?*");
  await page.locator("#search-form").evaluate((form) => form.requestSubmit());
  await request;
  await page.getByRole("button", { name: /Ma liste à lire/ }).click();
  release();
  await expect(page.locator("#result-count")).toHaveText(
    "0 livre dans votre liste",
  );
  await expect(page.locator("#search-notice")).toBeHidden();
});
