import { expect, test, seedLibrary } from "./fixtures.js";

test.beforeEach(async ({ context }) => {
  await context.route(/https:\/\/(fonts\.|covers\.|openlibrary\.)/, (route) =>
    route.abort(),
  );
});

test.describe("French regional locale", () => {
  test.use({ locale: "fr-CA" });
  test("always uses the France locale for the application", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");
    await expect(page.locator("#language-select")).toHaveValue("fr");
    expect(
      await page.evaluate(
        () =>
          new Intl.NumberFormat(document.documentElement.lang).resolvedOptions()
            .locale,
      ),
    ).toBe("fr-FR");
  });
});

test("historical saved titles, summaries and covers follow the selected language", async ({
  page,
}) => {
  await seedLibrary(page.request);
  await page.goto("/");
  const frenchCover = await page
    .locator(".book-card img")
    .first()
    .getAttribute("src");
  await page.locator("#language-select").selectOption("en");
  await expect(page.locator(".book-title")).toHaveText("The Hobbit");
  expect(
    await page.locator(".book-card img").first().getAttribute("src"),
  ).not.toBe(frenchCover);
  await page.locator(".book-title").first().click();
  await expect(page.locator("#detail-description")).toContainText(
    "Bilbo Baggins",
  );
  await expect(page.locator(".detail-source[href]")).toHaveAttribute(
    "href",
    /\/books\/OL\d+M$/,
  );
  await page.locator("#book-dialog .close-dialog").click();
  await page.locator('[data-nav="wishlist"]').click();
  await page.locator("#books [data-reading-status]").selectOption("reading");
  await page.locator("#language-select").selectOption("fr");
  await expect(page.locator(".book-title")).toHaveText("Le Hobbit");
  await expect(page.locator("#books [data-reading-status]")).toHaveValue(
    "reading",
  );
  await page.locator(".book-title").click();
  await expect(page.locator("#detail-description")).toContainText(
    "Bilbo Sacquet",
  );
  await page.locator("#book-dialog .close-dialog").click();
  await page.locator("#language-select").selectOption("en");
  await page.reload();
  await expect(page.locator(".book-title")).toHaveText("The Hobbit");
  await expect(page.locator("#books [data-reading-status]")).toHaveValue(
    "reading",
  );
});

const edition = (language) => ({
  id: "hardcover:900099",
  provider: "hardcover",
  externalId: "900099",
  title: language === "en" ? "The Book of Mists" : "Le Livre des brumes",
  author: "An Author",
  language,
  tags: [],
  publishedDate: language === "en" ? "2024-02-29" : "2025-03-06",
  series: [{ name: "Mists", position: 2 }],
  isbn: language === "en" ? "9780547928227" : "9782070612888",
  coverUrl: `https://example.org/${language}.jpg`,
  sourceUrl: "https://hardcover.app/books/mists",
  description:
    language === "en"
      ? "An English summary for the English edition."
      : "Un résumé en français.",
});

test("search and saved works use matching edition dates, retaining status across languages", async ({
  page,
}) => {
  const requests = [];
  await page.route("**/api/catalogue/search?*", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    return route.fulfill({
      json: {
        books: [edition(url.searchParams.get("language"))],
        total: 1,
        hasMore: false,
        provider: "hardcover",
      },
    });
  });
  await page.route("**/api/catalogue/book?*", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const book = edition(url.searchParams.get("language"));
    return route.fulfill({
      json: { book: { ...book, editions: [edition("fr"), edition("en")] } },
    });
  });
  await page.goto("/");
  await page.locator("#language-select").selectOption("en");
  await page.locator("#search").fill("Mists");
  await page.locator("#search-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".book-title")).toHaveText("The Book of Mists");
  await expect(page.locator(".book-meta")).toContainText("February 29, 2024");
  expect(requests[0].searchParams.get("q")).toBe("Mists");
  expect(requests[0].searchParams.get("language")).toBe("en");
  await page.locator(".book-title").click();
  await expect(page.locator("#detail-description")).toContainText(
    "An English summary",
  );
  await expect(page.locator(".detail-facts")).toContainText("9780547928227");
  await page.locator("#book-dialog .close-dialog").click();
  await page.locator(".save-book").click();
  await page.locator('[data-nav="wishlist"]').click();
  await page.locator("#books [data-reading-status]").selectOption("read");
  const saved = (await (await page.request.get("/api/library")).json()).books;
  await page.locator("#language-select").selectOption("fr");
  await expect(page.locator(".book-title")).toHaveText("Le Livre des brumes");
  await expect(page.locator(".book-meta")).toContainText("6 mars 2025");
  await expect(page.locator(".book-series")).toContainText("Mists · Tome 2");
  await expect(page.locator("#books [data-reading-status]")).toHaveValue(
    "read",
  );
  expect(
    requests.some(
      (request) =>
        request.pathname === "/api/catalogue/book" &&
        request.searchParams.get("language") === "fr",
    ),
  ).toBe(true);
  await page.locator(".book-title").click();
  await expect(
    page.locator("#personal-tags, #save-tags, .detail-tags"),
  ).toHaveCount(0);
  await expect(page.locator(".detail-facts")).toContainText("6 mars 2025");
  await expect(page.locator("#detail-description")).toHaveText(
    "Un résumé en français.",
  );
  await page.locator("#book-dialog .close-dialog").click();
  expect((await (await page.request.get("/api/library")).json()).books).toEqual(
    saved,
  );
  await page.locator("#language-select").selectOption("en");
  await expect(page.locator(".book-title")).toHaveText("The Book of Mists");
});

test("switching language replaces an in-flight search with the new edition language", async ({
  page,
}) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/catalogue/search?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("language") === "en")
      await pending;
    await route
      .fulfill({
        json: {
          books: [
            edition(
              new URL(route.request().url()).searchParams.get("language"),
            ),
          ],
          total: 1,
          hasMore: false,
          provider: "hardcover",
        },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page.locator("#language-select").selectOption("en");
  await page.locator("#search").fill("Mists");
  const started = page.waitForRequest("**/api/catalogue/search?*");
  await page.locator("#search-form").evaluate((form) => form.requestSubmit());
  await started;
  await page.locator("#language-select").selectOption("fr");
  release();
  await expect(page.locator(".book-title")).toHaveText("Le Livre des brumes");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");
});
