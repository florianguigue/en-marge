import { normalizeReadingStatus } from "./reading-status.js";

// Keep the original key so existing lists remain available on the same origin.
export const STORAGE = "en-marge-wishlist-v1";

export function parseWishlist(raw) {
  const data = JSON.parse(raw || "[]");
  if (!Array.isArray(data))
    throw new Error("La liste enregistrée est invalide.");
  return data
    .filter(
      (book) =>
        book &&
        typeof book.id === "string" &&
        typeof book.title === "string" &&
        typeof book.author === "string",
    )
    .map((book) => ({
      ...book,
      status: normalizeReadingStatus(book.status),
      tags: Array.isArray(book.tags)
        ? book.tags.filter((tag) => typeof tag === "string")
        : [],
    }));
}
