import { expect, test } from "bun:test";
import { openStore } from "../../src/database.js";
import { createBookWorkflow } from "../../src/mcp-catalogue.js";
import { normalizeHardcover } from "../../src/metadata/providers/hardcover.js";
import {
  duneWork,
  duneEdition,
  hardcoverFixture,
} from "../fixtures/hardcover.js";

async function withWorkflow(options, run) {
  const store = openStore(":memory:");
  const catalogue = hardcoverFixture(options);
  try {
    await run(createBookWorkflow({ store, catalogue }), store);
  } finally {
    store.close();
  }
}

test("ranks title and author above provider order and stores full edition metadata", async () => {
  await withWorkflow(
    {
      books: [
        normalizeHardcover({
          ...duneWork,
          id: 99,
          author_names: ["Autre auteur"],
        }),
        normalizeHardcover(duneWork),
      ],
    },
    async (workflow, store) => {
      const result = await workflow.add({
        title: "DUNE",
        author: "frank herbert",
        tags: ["À lire"],
        status: "reading",
      });
      expect(result.outcome).toBe("added");
      expect(result.book).toMatchObject({
        id: "hardcover:12:edition:120",
        provider: "hardcover",
        manual: false,
        workId: "hardcover:12",
        editionId: "hardcover-edition:120",
        isbn: "9780441172719",
        language: "fr",
        pages: 700,
        publisher: "Éditeur",
        coverUrl: "https://example.org/dune.jpg",
        status: "reading",
        tags: ["À lire"],
      });
      expect(result.book.sources[0].provider).toBe("hardcover");
      expect(result.book.series[0].position).toBe(1);
      expect(store.read().revision).toBe(1);
    },
  );
});

test("ambiguous matches need an explicit selected candidate and do not write before confirmation", async () => {
  await withWorkflow(
    {
      books: [
        normalizeHardcover(duneWork),
        normalizeHardcover({ ...duneWork, id: 99 }),
      ],
    },
    async (workflow, store) => {
      const result = await workflow.add({ title: "Dune" });
      expect(result.outcome).toBe("needs_confirmation");
      expect(result.candidates).toHaveLength(2);
      expect(result.recommended.id).toBe("hardcover:12:edition:120");
      expect(store.read()).toEqual({ books: [], revision: 0 });
      expect(
        (
          await workflow.add({
            title: "Dune",
            candidate_id: result.recommended.id,
          })
        ).outcome,
      ).toBe("needs_confirmation");
      expect(
        (
          await workflow.add({
            title: "Dune",
            candidate_id: result.recommended.id,
            confirmed: true,
          })
        ).outcome,
      ).toBe("added");
      expect(store.read().revision).toBe(1);
    },
  );
});

test("a single approximate match or an author mismatch still requires confirmation", async () => {
  await withWorkflow({}, async (workflow, store) => {
    for (const args of [
      { title: "Duune" },
      { title: "Dune", author: "Isaac Asimov" },
    ])
      expect((await workflow.add(args)).outcome).toBe("needs_confirmation");
    expect(store.read().revision).toBe(0);
  });
});

test("typos rank the closest title above provider order without authorizing an addition", async () => {
  await withWorkflow(
    {
      books: [
        normalizeHardcover({ ...duneWork, id: 99, title: "Fondation" }),
        normalizeHardcover(duneWork),
      ],
    },
    async (workflow, store) => {
      const result = await workflow.add({
        title: "Duune",
        author: "Frank Herbert",
      });
      expect(result.outcome).toBe("needs_confirmation");
      expect(result.recommended.workId).toBe("hardcover:12");
      expect(store.read().revision).toBe(0);
    },
  );
});

test("an empty title-author query retries the title alone and still checks the author", async () => {
  const queries = [];
  await withWorkflow(
    {
      provider: {
        search: async ({ query }) => {
          queries.push(query);
          return {
            books: query === "Dune" ? [normalizeHardcover(duneWork)] : [],
            total: 1,
          };
        },
      },
    },
    async (workflow) => {
      expect(
        (await workflow.add({ title: "Dune", author: "Frank Herbert" }))
          .outcome,
      ).toBe("added");
      expect(queries).toEqual(["Dune Frank Herbert", "Dune"]);
    },
  );
});

test("prefers an edition matching both the requested title and language", async () => {
  const preferred = normalizeHardcover(duneWork, { ...duneEdition, id: 121 });
  const other = normalizeHardcover(duneWork, {
    ...duneEdition,
    title: "Dune — édition intégrale",
  });
  await withWorkflow(
    {
      provider: {
        findByExternalId: async () => ({
          ...other,
          editions: [other, preferred],
        }),
      },
    },
    async (workflow) => {
      expect((await workflow.add({ title: "Dune" })).book.id).toBe(
        preferred.id,
      );
    },
  );
});

test("language defaults to the library setting and mismatched or unknown languages require confirmation", async () => {
  for (const language of ["en", null]) {
    const edition = {
      ...duneEdition,
      language: language ? { code2: language } : null,
    };
    await withWorkflow({ edition }, async (workflow, store) => {
      expect((await workflow.add({ title: "Dune" })).outcome).toBe(
        "needs_confirmation",
      );
      expect(store.read().revision).toBe(0);
      if (language) {
        store.setLanguage("en");
        expect((await workflow.add({ title: "Dune" })).outcome).toBe("added");
      }
    });
  }
});

test("a searched ISBN retains its exact edition even when another edition is preferred", async () => {
  const english = normalizeHardcover(duneWork, {
    ...duneEdition,
    id: 121,
    language: { code2: "en" },
  });
  const french = normalizeHardcover(duneWork, {
    ...duneEdition,
    isbn_13: "9782070612888",
  });
  await withWorkflow(
    {
      books: [english],
      provider: {
        findByExternalId: async () => ({
          ...french,
          editions: [french, english],
        }),
      },
    },
    async (workflow, store) => {
      const result = await workflow.add({ title: "978-0-441-17271-9" });
      expect(result.outcome).toBe("needs_confirmation");
      expect(result.recommended.id).toBe(english.id);
      expect(result.recommended.isbn).toBe("9780441172719");
      const added = await workflow.add({
        title: "9780441172719",
        candidate_id: english.id,
        confirmed: true,
      });
      expect(added.book.language).toBe("en");
      expect(store.read().books).toHaveLength(1);
    },
  );
});

test("empty results, provider failures, missing configuration and invalid IDs never create manual records", async () => {
  await withWorkflow({ books: [] }, async (workflow, store) => {
    expect((await workflow.add({ title: "Inconnu" })).outcome).toBe(
      "not_found",
    );
    expect(store.read().revision).toBe(0);
  });
  for (const provider of [
    { enabled: false },
    {
      search: async () => {
        throw new Error("offline");
      },
    },
    {
      findByExternalId: async () => {
        throw new Error("offline");
      },
    },
  ]) {
    await withWorkflow({ provider }, async (workflow, store) => {
      await expect(workflow.add({ title: "Dune" })).rejects.toThrow();
      expect(store.read().revision).toBe(0);
    });
  }
  await withWorkflow({}, async (workflow, store) => {
    for (const candidate_id of [
      "manual:1",
      "hardcover:999",
      "hardcover:12:edition:999",
    ])
      await expect(
        workflow.add({ title: "Dune", candidate_id, confirmed: true }),
      ).rejects.toThrow();
    expect(store.read().revision).toBe(0);
  });
});

test("repeated concurrent adds return the existing book and preserve personal fields and revision", async () => {
  await withWorkflow({}, async (workflow, store) => {
    const results = await Promise.all([
      workflow.add({ title: "Dune", status: "read", tags: ["Personnel"] }),
      workflow.add({ title: "Dune" }),
    ]);
    expect(results.map((result) => result.outcome)).toEqual([
      "added",
      "already_exists",
    ]);
    expect(store.read().revision).toBe(1);
    expect(results[1].book.status).toBe("read");
    expect(results[1].book.tags).toContain("Personnel");
    expect(
      store.addCatalogueBook({
        ...results[0].book,
        id: "hardcover:12:edition:121",
      }).outcome,
    ).toBe("already_exists");
    expect(
      store.addCatalogueBook({
        ...results[0].book,
        id: "google-books:1",
        workId: null,
        externalIds: {},
      }).outcome,
    ).toBe("already_exists");
    expect(store.read().revision).toBe(1);
  });
});
