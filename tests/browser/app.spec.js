import { expect, test, seedLibrary, legacyBooks } from "./fixtures.js";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ context }) => {
  // Keep UI checks deterministic and usable without third-party services.
  await context.route(/https:\/\/(fonts\.|covers\.|openlibrary\.)/, (route) =>
    route.abort(),
  );
});

test("library filters, list view and server persistence", async ({ page }) => {
  await seedLibrary(page.request, legacyBooks.slice(0, 3));
  await page.goto("/");
  await expect(page.locator(".book-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Classiques", exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Tous les livres", exact: true })
    .click();
  await expect(page.locator(".book-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Vue en liste", exact: true }).click();
  await expect(page.locator("#books")).toHaveClass("book-grid list");
  await page.reload();
  await expect(page.locator(".book-card")).toHaveCount(3);
  await page.locator(".save-book").first().click();
  await expect(page.locator(".book-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(3);
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

test("unified catalogue results and pagination", async ({ page }) => {
  await page.route("**/api/catalogue/search?*", (route) => {
    const second =
      new URL(route.request().url()).searchParams.get("page") === "2";
    return route.fulfill({
      json: {
        total: 2,
        hasMore: !second,
        provider: "google-books",
        books: [
          {
            id: second ? "google-books:2" : "google-books:1",
            title: second ? "Dune 2" : "Dune",
            author: "Frank Herbert",
            language: "fr",
            tags: [],
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

test("unavailable search shows no suggestions", async ({ page }) => {
  await page.goto("/");
  await page.locator("#search").fill("Tolkien");
  await page.locator("#search-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#search-notice")).toContainText(
    "Le catalogue est indisponible",
  );
  await expect(page.locator(".book-card")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Réessayer la recherche" }),
  ).toBeVisible();
});

test("navigation cancels an in-flight search without replacing the wishlist", async ({
  page,
}) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/catalogue/search?*", async (route) => {
    await pending;
    await route
      .fulfill({
        json: {
          books: [{ id: "google-books:1", title: "Dune" }],
          total: 1,
          hasMore: false,
        },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page.locator("#search").fill("Dune");
  const request = page.waitForRequest("**/api/catalogue/search?*");
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
  await seedLibrary(page.request);
  await page.goto("/");
  await expect(page.locator("#reading-filters")).toBeVisible();
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

test("enriched metadata and sources are displayed and saved with provider covers", async ({
  page,
}) => {
  const book = {
    id: "google-books:metadata",
    provider: "google-books",
    externalId: "metadata",
    editionId: "google-books:metadata",
    title: "Le livre enrichi",
    author: "Autrice",
    language: "fr",
    isbn: "9780547928227",
    coverUrl: "https://example.org/google-cover.jpg",
    sourceUrl: "https://books.google.com/books?id=metadata",
    tags: [],
  };
  const sources = [
    { provider: "google-books", externalId: "metadata" },
    { provider: "hardcover", externalId: "1" },
  ];
  await page.route("**/api/catalogue/search?*", (route) =>
    route.fulfill({
      json: {
        books: [book],
        total: 1,
        hasMore: false,
        provider: "google-books",
        warnings: [{ provider: "hardcover", code: "unavailable" }],
      },
    }),
  );
  await page.route("**/api/catalogue/book?*", (route) =>
    route.fulfill({
      json: {
        book: {
          ...book,
          description: "Un résumé enrichi",
          pages: 321,
          publisher: "Éditeur",
          sources,
          provenance: { pages: sources[1] },
          series: [{ name: "La saga", position: 2 }],
        },
      },
    }),
  );
  await page.goto("/");
  await page.locator("#search").fill("enrichi");
  await page.locator("#search-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#search-notice")).toContainText(
    "Certains fournisseurs",
  );
  await expect(page.locator("#books img")).toHaveAttribute(
    "src",
    book.coverUrl,
  );
  await page.locator(".book-title").click();
  await expect(page.locator("#detail-description")).toHaveText(
    "Un résumé enrichi",
  );
  await expect(page.locator(".detail-facts")).toContainText("321");
  await expect(page.locator("#book-detail")).toContainText("La saga · 2");
  await expect(page.locator(".detail-source[href]")).toHaveAttribute(
    "href",
    book.sourceUrl,
  );
  await page.locator("#book-dialog [data-save]").click();
  await expect(page.locator("#book-dialog")).not.toBeVisible();
  const saved = (await (await page.request.get("/api/library")).json())
    .books[0];
  expect(saved).toMatchObject({
    id: book.id,
    pages: 321,
    description: "Un résumé enrichi",
    sources,
  });
  expect(saved.provenance.pages.provider).toBe("hardcover");
});

test("different editions with the same title and author can be saved independently", async ({
  page,
}) => {
  const books = ["9780547928227", "9782070612888"].map((isbn, index) => ({
    id: `google-books:edition${index}`,
    title: "Même titre",
    author: "Même auteur",
    language: "fr",
    isbn,
    tags: [],
  }));
  await page.route("**/api/catalogue/search?*", (route) =>
    route.fulfill({
      json: { books, total: 2, hasMore: false, provider: "google-books" },
    }),
  );
  await page.goto("/");
  await page.locator("#search").fill("Même titre");
  await page.locator("#search-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".book-card")).toHaveCount(2);
  await page.locator(".save-book").first().click();
  await page.locator(".save-book").nth(1).click();
  await page.locator('[data-nav="wishlist"]').click();
  await expect(page.locator(".book-card")).toHaveCount(2);
  expect(
    (await (await page.request.get("/api/library")).json()).books.map(
      (book) => book.isbn,
    ),
  ).toEqual(books.map((book) => book.isbn));
});

test("old lists default to À lire and status changes synchronize between tabs", async ({
  page,
  context,
}) => {
  await page.goto("/");
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

test("an unavailable server does not change the reading status", async ({
  page,
}) => {
  await seedLibrary(page.request);
  await page.goto("/");
  await page.getByRole("button", { name: /Ma bibliothèque/ }).click();
  await page.route("**/api/library", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { error: "Unavailable" } })
      : route.continue(),
  );
  const status = page.locator("#books [data-reading-status]");
  await status.selectOption("reading");
  await expect(status).toHaveValue("to-read");
  await expect(page.locator("#toast")).toContainText(
    "Votre liste n’a pas été modifiée",
  );
  await page.reload();
  await expect(status).toHaveValue("to-read");
});
