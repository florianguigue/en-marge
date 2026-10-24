import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  resolveLanguage,
  setLanguage,
  getLanguage,
  getLocale,
  t,
  bookCount,
  pageCount,
  formatPublicationDate,
} from "../../public/js/i18n.js";
import { messages } from "../../public/js/messages.js";

afterEach(() => setLanguage("fr"));

test("chooses the first supported browser language, then falls back to French", () => {
  expect(resolveLanguage(null, ["en-GB", "fr-FR"])).toBe("en");
  expect(resolveLanguage(null, ["fr-CA", "en-US"])).toBe("fr");
  expect(resolveLanguage(null, ["de-DE", "en-US"])).toBe("en");
  expect(resolveLanguage(null, ["DE_de", null, "EN-us"])).toBe("en");
  expect(resolveLanguage(null, [], "en-AU")).toBe("en");
  expect(resolveLanguage(null, ["de-DE", "es-ES"])).toBe("fr");
  expect(resolveLanguage(null, undefined, undefined)).toBe("fr");
  expect(resolveLanguage(null, ["", null, 5, "bad_locale"])).toBe("fr");
});

test("a valid manual preference overrides the browser locale", () => {
  expect(resolveLanguage("fr", ["en-US"])).toBe("fr");
  expect(resolveLanguage("en", ["fr-FR"])).toBe("en");
  expect(resolveLanguage("de", ["en-US"])).toBe("en");
  expect(setLanguage("en")).toBe(true);
  expect(setLanguage("de")).toBe(false);
  expect(getLanguage()).toBe("en");
});

test("uses language-specific plurals and interpolates text without changing book data", () => {
  setLanguage("en");
  expect(bookCount(0)).toBe("0 books");
  expect(bookCount(1)).toBe("1 book");
  expect(pageCount(2)).toBe("2 pages");
  expect(t("bookStatus", { title: "Le Hobbit" })).toBe("Status of Le Hobbit");
  setLanguage("fr");
  expect(getLocale()).toBe("fr-FR");
  expect(new Intl.NumberFormat(getLocale()).resolvedOptions().locale).toBe(
    "fr-FR",
  );
  expect(bookCount(0)).toBe("0 livre");
  expect(bookCount(2)).toBe("2 livres");
  expect(bookCount(1000000)).toContain("livres");
});

test("both dictionaries contain every interface key and the same placeholders", () => {
  expect(Object.keys(messages.en).sort()).toEqual(
    Object.keys(messages.fr).sort(),
  );
  for (const key of Object.keys(messages.fr)) {
    expect(messages.en[key].trim().length).toBeGreaterThan(0);
    expect(messages.en[key].match(/\{\w+\}/g)?.sort() || []).toEqual(
      messages.fr[key].match(/\{\w+\}/g)?.sort() || [],
    );
  }
  const html = readFileSync(
    new URL("../../public/index.html", import.meta.url),
    "utf8",
  );
  for (const [, key] of html.matchAll(
    /data-i18n(?:-aria-label|-placeholder|-content)?="([^"]+)"/g,
  )) {
    expect(Object.hasOwn(messages.fr, key)).toBe(true);
  }
});

test("publication dates respect source precision, calendar validity and language", () => {
  expect(
    formatPublicationDate({ publishedDate: "2024-02-29", year: 2024 }),
  ).toBe("29 février 2024");
  expect(formatPublicationDate({ publishedDate: "2024-03-01" })).toBe(
    "1 mars 2024",
  );
  expect(formatPublicationDate({ publishedDate: "2024-02" })).toBe(
    "février 2024",
  );
  expect(formatPublicationDate({ publishedDate: "2024" })).toBe("2024");
  expect(formatPublicationDate({ year: 1998 })).toBe("1998");
  expect(
    formatPublicationDate({ publishedDate: "2023-02-29", year: 2023 }),
  ).toBe("2023");
  expect(formatPublicationDate({ publishedDate: "2024-13-01" })).toBe(
    "Non renseignée",
  );
  expect(formatPublicationDate({})).toBe("Non renseignée");
  setLanguage("en");
  expect(formatPublicationDate({ publishedDate: "2024-02-29" })).toBe(
    "February 29, 2024",
  );
});
