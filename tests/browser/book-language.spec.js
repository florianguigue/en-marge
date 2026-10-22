import { expect, test } from "./fixtures.js";

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

test("fantasy titles, summaries and covers follow the selected language in Discover and the library", async ({
  page,
}) => {
  await page.goto("/#discover");
  const frenchCover = await page
    .locator(".book-card img")
    .first()
    .getAttribute("src");
  await page.locator("#language-select").selectOption("en");
  await expect(page.locator(".book-title")).toHaveText([
    "The Hobbit",
    "A Wizard of Earthsea",
    "The Name of the Wind",
    "Assassin’s Apprentice",
    "Northern Lights",
    "Mistborn: The Final Empire",
    "The Last Wish",
    "A Winter’s Promise",
  ]);
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
  await page.locator(".save-book").first().click();
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

const document = {
  key: "/works/OL900099W",
  title: "Le Livre des brumes",
  cover_i: 1,
  isbn: ["9780000000000"],
  author_name: ["An Author"],
  editions: {
    docs: [
      {
        key: "/books/OL900099M",
        title: "Le Livre des brumes",
        language: ["fre"],
        cover_i: 11,
        isbn: ["9780000000001"],
      },
      {
        key: "/books/OL900098M",
        title: "The Book of Mists",
        language: ["eng"],
        cover_i: 22,
        isbn: ["9780000000002"],
      },
    ],
  },
};

test("search and saved works use matching editions, retaining status and tags across languages", async ({
  page,
}) => {
  const requests = [];
  await page.route("https://openlibrary.org/search.json?*", (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: { docs: [document], numFound: 1 } });
  });
  await page.route("https://openlibrary.org/books/OL900098M.json", (route) =>
    route.fulfill({
      json: { description: "An English summary for the English edition." },
    }),
  );
  await page.route("https://openlibrary.org/books/OL900099M.json", (route) =>
    route.fulfill({ json: { description: "Un résumé en français." } }),
  );
  await page.goto("/#discover");
  await page.locator("#language-select").selectOption("en");
  await page.locator("#search").fill("Mists");
  await page.locator("#search-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".book-title")).toHaveText("The Book of Mists");
  expect(requests[0].searchParams.get("q")).toBe("Mists");
  expect(requests[0].searchParams.get("lang")).toBe("en");
  await page.locator(".book-title").click();
  await expect(page.locator("#detail-description")).toContainText(
    "An English summary",
  );
  await expect(page.locator(".detail-facts")).toContainText("9780000000002");
  await page.locator("#book-dialog .close-dialog").click();
  await page.locator(".save-book").click();
  await page.locator('[data-nav="wishlist"]').click();
  await page.locator("#books [data-reading-status]").selectOption("read");
  await page.locator(".book-title").click();
  await page.locator("#personal-tags").fill("Favori");
  await page.locator("#save-tags").click();
  await page.locator("#book-dialog .close-dialog").click();
  const saved = (await (await page.request.get("/api/library")).json()).books;
  await page.locator("#language-select").selectOption("fr");
  await expect(page.locator(".book-title")).toHaveText("Le Livre des brumes");
  await expect(page.locator("#books [data-reading-status]")).toHaveValue(
    "read",
  );
  expect(
    requests.some((request) =>
      request.searchParams.get("q").includes("language:fre"),
    ),
  ).toBe(true);
  await page.locator(".book-title").click();
  await expect(page.locator("#personal-tags")).toHaveValue("Favori");
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
  await page.route("https://openlibrary.org/search.json?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("lang") === "en")
      await pending;
    await route
      .fulfill({ json: { docs: [document], numFound: 1 } })
      .catch(() => {});
  });
  await page.goto("/#discover");
  await page.locator("#language-select").selectOption("en");
  await page.locator("#search").fill("Mists");
  const started = page.waitForRequest("https://openlibrary.org/search.json?*");
  await page.locator("#search-form").evaluate((form) => form.requestSubmit());
  await started;
  await page.locator("#language-select").selectOption("fr");
  release();
  await expect(page.locator(".book-title")).toHaveText("Le Livre des brumes");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");
});
