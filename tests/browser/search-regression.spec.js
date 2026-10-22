import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Real Open Library response: volumes 2 and 3 have no indexed language.
const zorhal = JSON.parse(
  readFileSync(
    new URL("../fixtures/zorhal-search.json", import.meta.url),
    "utf8",
  ),
);

for (const language of ["fr", "en"]) {
  test(`finds every Zorhal volume with a ${language} interface`, async ({
    page,
    context,
  }) => {
    await context.route(/https:\/\/(fonts\.|covers\.|openlibrary\.)/, (route) =>
      route.abort(),
    );
    let searchURL;
    await page.route("https://openlibrary.org/search.json?*", (route) => {
      searchURL = new URL(route.request().url());
      const strict = searchURL.searchParams.get("q").includes("language:");
      return route.fulfill({
        json: strict
          ? { ...zorhal, numFound: 1, docs: zorhal.docs.slice(0, 1) }
          : zorhal,
      });
    });
    await page.goto("/#discover");
    await page.locator("#language-select").selectOption(language);
    await page.locator("#search").fill("Zorhal");
    await page.locator("#search-form").evaluate((form) => form.requestSubmit());
    await expect(page.locator(".book-title")).toHaveText([
      "Zorhal",
      "Zorhal T.2",
      "Zorhal T.3",
    ]);
    expect(searchURL.searchParams.get("q")).toBe("Zorhal");
    expect(searchURL.searchParams.get("lang")).toBe(language);
    expect(
      await page.locator(".book-edition-note").allTextContents(),
    ).toContain(
      language === "fr" ? "Langue non renseignée" : "Language not specified",
    );
    const second = page
      .locator(".book-card")
      .filter({ has: page.locator(".book-title", { hasText: "Zorhal T.2" }) });
    await second.locator(".book-title").click();
    await expect(page.locator("#detail-title")).toHaveText("Zorhal T.2");
    await expect(page.locator(".detail-source[href]")).toHaveAttribute(
      "href",
      "https://openlibrary.org/books/OL61963652M",
    );
    await page.locator("#book-dialog .close-dialog").click();
    await second.locator(".save-book").click();
    await page.locator('[data-nav="wishlist"]').click();
    await expect(page.locator(".book-title")).toHaveText("Zorhal T.2");
    await expect(page.locator("#books [data-reading-status]")).toHaveValue(
      "to-read",
    );
  });
}
