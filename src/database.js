import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseWishlist } from "../public/js/storage.js";

export function openStore(
  path = process.env.DATABASE_PATH || "./data/en-marge.sqlite",
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS library (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      books TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL DEFAULT 0,
      language TEXT CHECK (language IN ('fr', 'en'))
    );
    INSERT OR IGNORE INTO library (id) VALUES (1);
  `);
  const read = () => {
    const row = db
      .query("SELECT books, revision FROM library WHERE id = 1")
      .get();
    return { books: parseWishlist(row.books), revision: row.revision };
  };
  const write = db.query(
    "UPDATE library SET books = ?, revision = revision + 1 WHERE id = 1",
  );
  return {
    read,
    add: db.transaction((book) => {
      const current = read();
      const books = validateBooks([...current.books, book]);
      write.run(JSON.stringify(books));
      return books.at(-1);
    }).immediate,
    remove: db.transaction((id) => {
      const current = read();
      const book = current.books.find((entry) => entry.id === id);
      if (!book) throw new Error("Livre introuvable.");
      write.run(
        JSON.stringify(current.books.filter((entry) => entry.id !== id)),
      );
      return book;
    }).immediate,
    replace: db.transaction((books, revision) => {
      const current = read();
      if (current.revision !== revision) return null;
      write.run(JSON.stringify(books));
      return read();
    }),
    import: db.transaction((books) => {
      const current = read();
      const ids = new Set(current.books.map((book) => book.id));
      for (const book of books) {
        if (ids.has(book.id)) continue;
        current.books.push(book);
        ids.add(book.id);
      }
      write.run(JSON.stringify(current.books));
      return read();
    }),
    settings: () => db.query("SELECT language FROM library WHERE id = 1").get(),
    setLanguage(language) {
      db.query("UPDATE library SET language = ? WHERE id = 1").run(language);
      return this.settings();
    },
    close: () => db.close(),
  };
}

export function validateBooks(value) {
  if (!Array.isArray(value) || value.length > 10000)
    throw new Error("Liste invalide.");
  const ids = new Set();
  for (const book of value) {
    if (
      !book ||
      typeof book.id !== "string" ||
      !book.id.trim() ||
      typeof book.title !== "string" ||
      !book.title.trim() ||
      typeof book.author !== "string" ||
      !book.author.trim() ||
      ids.has(book.id)
    ) {
      throw new Error("Livre invalide ou identifiant dupliqué.");
    }
    ids.add(book.id);
  }
  return parseWishlist(JSON.stringify(value));
}
