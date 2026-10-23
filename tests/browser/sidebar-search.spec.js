import { expect, test, seedLibrary, legacyBooks } from "./fixtures.js";

const book = (title) => ({
  id: `hardcover:${title}`,
  provider: "hardcover",
  externalId: title,
  title,
  author: "Autrice",
  language: "fr",
  tags: ["Roman"],
});
const result = (title) => ({
  books: [book(title)],
  total: 1,
  hasMore: false,
  provider: "hardcover",
});

test("the empty library has no suggestions and the only catalogue search is in the sidebar", async ({
  page,
}) => {
  const queries = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/catalogue/search?"))
      queries.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator('[data-nav="discover"]')).toHaveCount(0);
  await expect(page.locator(".sidebar #search")).toBeVisible();
  await expect(page.locator("main #search")).toHaveCount(0);
  await expect(page.locator(".book-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Rechercher un livre", exact: true })
    .click();
  await expect(page.locator("#search")).toBeFocused();
  expect(queries).toHaveLength(0);
});

test("typing launches a debounced catalogue search from the library", async ({
  page,
}) => {
  const queries = [];
  await page.route("**/api/catalogue/search?*", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    queries.push(query);
    return route.fulfill({ json: result(query) });
  });
  await page.goto("/");
  await page.locator("#search").fill("Tol");
  await page.locator("#search").fill("Tolkien");
  await expect(page.locator(".book-title")).toHaveText("Tolkien");
  expect(queries).toEqual(["Tolkien"]);
  await expect(page.locator("#collection-title")).toHaveText(
    "Résultats de recherche",
  );
  await expect(page.locator("#search-query")).toContainText("Tolkien");
  await expect(page.locator("#library-filter")).toBeHidden();
});

test("new input cancels an older search before its response can replace the results", async ({
  page,
}) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/catalogue/search?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "Ancien") await pending;
    await route.fulfill({ json: result(query) }).catch(() => {});
  });
  await page.goto("/");
  const started = page.waitForRequest("**/api/catalogue/search?*");
  await page.locator("#search").fill("Ancien");
  await page.locator("#search").press("Enter");
  await started;
  await page.locator("#search").fill("Nouveau");
  await expect(page.locator(".book-title")).toHaveText("Nouveau");
  release();
  await expect(page.locator(".book-title")).toHaveText("Nouveau");
  await expect(page.locator("#search-notice")).toBeHidden();
});

test("search links survive reload and browser navigation, and clearing restores the library", async ({
  page,
}) => {
  await page.route("**/api/catalogue/search?*", (route) =>
    route.fulfill({ json: result("Zorhal") }),
  );
  await page.goto("/");
  await page.locator("#search").fill("Zorhal");
  await page.locator("#search").press("Enter");
  await expect(page).toHaveURL(/#search\?q=Zorhal$/);
  await expect(page.locator(".book-title")).toHaveText("Zorhal");
  await page.reload();
  await expect(page.locator("#search")).toHaveValue("Zorhal");
  await expect(page.locator(".book-title")).toHaveText("Zorhal");
  await page.goBack();
  await expect(page.locator("#collection-title")).toHaveText("Ma bibliothèque");
  await expect(page.locator(".book-card")).toHaveCount(0);
  await page.goForward();
  await expect(page.locator(".book-title")).toHaveText("Zorhal");
  await page.locator("#search-clear").click();
  await expect(page.locator("#search")).toBeFocused();
  await expect(page.locator("#search")).toHaveValue("");
  await expect(page.locator("#collection-title")).toHaveText("Ma bibliothèque");
  await expect(page.locator(".book-card")).toHaveCount(0);
});

test("library filtering stays separate from the catalogue search", async ({
  page,
}) => {
  await seedLibrary(page.request, legacyBooks.slice(0, 3));
  const queries = [];
  await page.route("**/api/catalogue/search?*", (route) => {
    queries.push(route.request().url());
    return route.fulfill({ json: result("Un autre Hobbit") });
  });
  await page.goto("/");
  await page.locator("#library-search").fill("Hobbit");
  await expect(page.locator(".book-title")).toHaveText("Le Hobbit");
  expect(queries).toHaveLength(0);
  await page.locator("#search").fill("Hobbit");
  await page.locator("#search").press("Enter");
  await expect(page.locator(".book-title")).toHaveText("Un autre Hobbit");
  await page.locator('[data-nav="wishlist"]').click();
  await expect(page.locator(".book-card")).toHaveCount(3);
  await expect(page.locator("#library-search")).toHaveValue("");
});

test("the sidebar search stays visible while scrolling without horizontal overflow", async ({
  page,
}) => {
  await seedLibrary(
    page.request,
    Array.from({ length: 24 }, (_, index) => ({
      id: `manual:${index}`,
      title: `Livre ${index}`,
      author: "Autrice",
      manual: true,
      tags: [],
    })),
  );
  await page.goto("/");
  await expect(page.locator(".book-card")).toHaveCount(24);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  const bounds = await page.locator("#search").boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(
    page.viewportSize().height,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
