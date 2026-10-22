import { expect, test } from "./fixtures.js";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ context }) => {
  await context.route(/https:\/\/(fonts\.|covers\.|openlibrary\.)/, (route) =>
    route.abort(),
  );
});

for (const [locale, language, library] of [
  ["en-GB", "en", "My library"],
  ["fr-FR", "fr", "Ma bibliothèque"],
  ["de-DE", "fr", "Ma bibliothèque"],
]) {
  test.describe(`browser locale ${locale}`, () => {
    test.use({ locale });
    test("opens the library by default and respects direct links", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        language === "fr" ? "fr-FR" : language,
      );
      await expect(page.locator('[data-nav="wishlist"]')).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.locator('[data-nav="wishlist"]')).toContainText(
        library,
      );
      await expect(page.locator("#language-select")).toHaveValue(language);
      await page.goto("/#discover");
      await expect(page.locator(".book-card")).toHaveCount(8);
      await page.reload();
      await expect(page.locator('[data-nav="discover"]')).toHaveAttribute(
        "aria-current",
        "page",
      );
      await page.goto("/");
      await expect(page.locator('[data-nav="wishlist"]')).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  });
}

test("falls back to French when the browser provides no usable locale", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { get: () => [] });
    Object.defineProperty(navigator, "language", { get: () => undefined });
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");
  await expect(page.locator('[data-nav="wishlist"]')).toContainText(
    "Ma bibliothèque",
  );
});

test("a manual language choice survives reload without changing the library", async ({
  page,
}) => {
  await page.goto("/#discover");
  await page.locator(".save-book").first().click();
  await page.locator('[data-nav="wishlist"]').click();
  await page.locator("#books [data-reading-status]").selectOption("reading");
  const before = (await (await page.request.get("/api/library")).json()).books;
  await page.locator("#language-select").selectOption("en");
  await expect(page.locator('[data-nav="wishlist"]')).toContainText(
    "My library",
  );
  await expect(page.locator("#result-count")).toHaveText(
    "1 book in your library",
  );
  await expect(page.locator("#toast")).toHaveText("Status saved: Reading.");
  await expect(
    page.locator("#books [data-reading-status] option:checked"),
  ).toHaveText("Reading");
  await expect(page.locator("#search")).toHaveAttribute(
    "placeholder",
    "Search my library…",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#books [data-reading-status]")).toHaveValue(
    "reading",
  );
  await expect(page.locator(".book-title")).toHaveText("The Hobbit");
  expect((await (await page.request.get("/api/library")).json()).books).toEqual(
    before,
  );
  await page.locator("#language-select").selectOption("fr");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");
  await expect(page.locator(".book-title")).toHaveText("Le Hobbit");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test.describe("English interface", () => {
  test.use({ locale: "en-US" });
  test("manual books, details, statuses and export work in English", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#result-count")).toHaveText(
      "0 books in your library",
    );
    await page.getByRole("button", { name: "Add a book", exact: true }).click();
    await expect(page.locator("#manual-title")).toHaveText("Add a book");
    await page.locator('[name="title"]').fill("Un titre personnel");
    await page.locator('[name="author"]').fill("Élodie");
    await page
      .getByRole("textbox", { name: "Summary", exact: true })
      .fill("Mon résumé");
    await page
      .getByRole("button", { name: "Add to my library", exact: true })
      .click();
    await page.locator("#books [data-reading-status]").selectOption("reading");
    await page.locator(".book-title").click();
    await expect(
      page.getByRole("heading", { name: "About this book", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#detail-description")).toHaveText("Mon résumé");
    await page
      .locator("#book-dialog [data-reading-status]")
      .selectOption("read");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator("#manual-title")).toHaveText("Edit book");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page.locator('[data-reading-filter="read"]').click();
    await expect(page.locator('[data-reading-filter="read"]')).toHaveText(
      "Read 1",
    );
    await page
      .getByRole("button", { name: "About storage" })
      .filter({ visible: true })
      .click();
    await expect(page.locator("#about-title")).toHaveText(
      "Your reading plans stay here.",
    );
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export my library (JSON)", exact: true })
      .click();
    const download = await downloadPromise;
    const books = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(books[0]).toMatchObject({
      title: "Un titre personnel",
      author: "Élodie",
      description: "Mon résumé",
      status: "read",
    });
  });

  test("search uses English and existing error messages change language immediately", async ({
    page,
  }) => {
    await page.goto("/#discover");
    await page.locator("#search").fill("Tolkien");
    const requestPromise = page.waitForRequest(
      "https://openlibrary.org/search.json?*",
    );
    await page.locator("#search-form").evaluate((form) => form.requestSubmit());
    const request = await requestPromise;
    expect(new URL(request.url()).searchParams.get("lang")).toBe("en");
    await expect(page.locator("#search-notice")).toContainText(
      "Open Library is unavailable",
    );
    await page.locator("#language-select").selectOption("fr");
    await expect(page.locator("#search-notice")).toContainText(
      "Open Library est indisponible",
    );
    await expect(page.locator("#search")).toHaveValue("Tolkien");
    await expect(page.locator(".book-card")).toHaveCount(1);
  });
});

test("changing language in another tab translates an open form without losing its draft", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  await page
    .getByRole("button", { name: "Ajouter un livre", exact: true })
    .click();
  await page.locator('[name="title"]').fill("Brouillon à conserver");
  await other.locator("#language-select").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#manual-title")).toHaveText("Add a book");
  await expect(page.locator('[name="title"]')).toHaveValue(
    "Brouillon à conserver",
  );
  await expect(page.locator('[name="author"]')).toHaveAttribute(
    "placeholder",
    "First and last name",
  );
  await other.close();
});

test("language switching remains usable when saving preferences is unavailable", async ({
  page,
}) => {
  await page.route("**/api/settings", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { error: "Unavailable" } })
      : route.continue(),
  );
  await page.goto("/");
  await page.locator("#language-select").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");
  await expect(page.locator("#toast")).toContainText(
    "Le serveur n’a pas pu enregistrer la langue",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");
});
