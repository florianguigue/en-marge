import { expect, test } from "bun:test";
import { parseWishlist, STORAGE } from "../../public/js/storage.js";
import { parseBook } from "../../public/js/open-library.js";

test("loads existing lists while discarding malformed entries and tags", () => {
  const book = {
    id: "manual:1",
    title: "Titre",
    author: "Auteur",
    addedAt: 42,
    tags: ["Roman", null, 5],
  };
  expect(STORAGE).toBe("en-marge-wishlist-v1");
  expect(parseWishlist(JSON.stringify([null, {}, book]))).toEqual([
    { ...book, tags: ["Roman"] },
  ]);
  expect(parseWishlist(null)).toEqual([]);
  expect(
    parseWishlist(JSON.stringify([{ ...book, tags: null }]))[0].tags,
  ).toEqual([]);
});

test("reports unreadable data without overwriting it", () => {
  expect(() => parseWishlist("{broken")).toThrow();
  expect(() => parseWishlist('{"books":[]}')).toThrow();
});

test("accepts incomplete Open Library metadata", () => {
  const book = parseBook({
    key: "/works/OL1W",
    title: "Dune",
    subject: ["Science fiction"],
    isbn: ["1234567890", "9781234567890"],
  });
  expect(book.tags[0]).toBe("Imaginaire");
  expect(book.isbn).toBe("9781234567890");
  expect(book.author).toBe("Auteur non renseigné");
  expect(book.pages).toBeNull();
});
