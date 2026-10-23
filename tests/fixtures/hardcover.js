import { createMetadataService } from "../../src/metadata/index.js";
import { normalizeHardcover } from "../../src/metadata/providers/hardcover.js";

export const duneWork = {
  id: 12,
  title: "Dune",
  slug: "dune",
  author_names: ["Frank Herbert"],
  description: "Un roman sur Arrakis.",
  book_series: [{ position: 1, series: { id: 4, name: "Dune" } }],
};
export const duneEdition = {
  id: 120,
  title: "Dune",
  isbn_13: "9780441172719",
  pages: 700,
  release_year: 2021,
  language: { code2: "fr" },
  publisher: { name: "Éditeur" },
  image: { url: "https://example.org/dune.jpg" },
};
export function hardcoverFixture({
  store,
  books,
  edition = duneEdition,
  provider = {},
} = {}) {
  return createMetadataService({
    store,
    env: {},
    providers: [
      {
        id: "hardcover",
        enabled: true,
        validId: (id) => /^\d+$/.test(id),
        search: async () => ({
          books: books || [normalizeHardcover(duneWork)],
          total: books?.length ?? 1,
          hasMore: false,
        }),
        findByExternalId: async (id) => {
          if (id !== "12") return null;
          const book = normalizeHardcover(duneWork, edition);
          return { ...book, editions: [book] };
        },
        findByIsbn: async () => [],
        ...provider,
      },
    ],
  });
}
