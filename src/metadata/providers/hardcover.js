import { metadata, strings, normalizeIsbn } from "../model.js";
import { ProviderError } from "../http.js";

export function normalizeHardcover(book, edition) {
  if (!book?.id || !book.title) return null;
  const language =
    edition?.language?.code2 ||
    { French: "fr", English: "en", français: "fr", anglais: "en" }[
      edition?.language?.language
    ] ||
    null;
  return metadata("hardcover", book.id, {
    id: edition
      ? `hardcover:${book.id}:edition:${edition.id}`
      : `hardcover:${book.id}`,
    workId: `hardcover:${book.id}`,
    editionId: edition ? `hardcover-edition:${edition.id}` : null,
    title: edition?.title || book.title,
    author:
      strings(book.author_names).join(", ") ||
      (book.contributions || [])
        .map((item) => item.author?.name)
        .filter(Boolean)
        .join(", "),
    description: edition?.description || book.description,
    language,
    // Work-level ISBN arrays describe many editions and must never be used to merge editions.
    isbns: edition ? [edition.isbn_13, edition.isbn_10] : [],
    pages: edition ? edition.pages || null : book.pages || null,
    year: edition ? edition.release_year || null : book.release_year || null,
    publishedDate: edition
      ? edition.release_date || null
      : book.release_date || null,
    publisher: edition?.publisher?.name || "",
    format: edition?.physical_format || null,
    coverUrl: edition?.image?.url || book.image?.url,
    tags: strings(book.genres),
    series: (book.book_series || [])
      .filter((entry) => entry.series?.name)
      .map((entry) => ({
        id: `hardcover:${entry.series.id}`,
        name: entry.series.name,
        position: entry.position ?? null,
        source: "hardcover",
      })),
    sourceUrl: `https://hardcover.app/books/${encodeURIComponent(book.slug || String(book.id))}`,
  });
}

const bookFields = `id title slug description pages release_year release_date
  image { url } contributions { author { name } }
  book_series { position series { id name } }`;
const editionFields = `id book_id title isbn_10 isbn_13 pages release_date release_year physical_format
  language { code2 language } publisher { name } image { url }`;

export function createHardcover({ request, token = "" }) {
  const query = async (query, variables) => {
    const data = await request("https://api.hardcover.app/v1/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.replace(/^Bearer\s+/i, "")}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (data.errors?.length || !data.data)
      throw new ProviderError("invalid_response");
    return data.data;
  };
  const getBook = async (id) => {
    const data = await query(
      `query Book($id: Int!) { books(where: {id: {_eq: $id}}, limit: 1) { ${bookFields} } }`,
      { id: Number(id) },
    );
    return data.books?.[0];
  };
  const getEditions = async (id) => {
    const data = await query(
      `query Editions($id: Int!) { editions(where: {book_id: {_eq: $id}}, limit: 40, order_by: {users_count: desc}) { ${editionFields} } }`,
      { id: Number(id) },
    );
    return data.editions || [];
  };
  return {
    id: "hardcover",
    enabled: Boolean(token),
    validId: (id) => /^\d{1,10}$/.test(id),
    async search({ query: text, page = 1, limit = 24 }) {
      const isbn = normalizeIsbn(text.replace(/^isbn:/i, ""));
      if (isbn) {
        const books = await this.findByIsbn(isbn);
        return { books, total: books.length, hasMore: false };
      }
      const data = await query(
        `query Search($text: String!, $page: Int!, $limit: Int!) { search(query: $text, query_type: "Book", page: $page, per_page: $limit) { results } }`,
        { text, page, limit },
      );
      const results =
        typeof data.search?.results === "string"
          ? JSON.parse(data.search.results)
          : data.search?.results;
      if (!Array.isArray(results?.hits))
        throw new ProviderError("invalid_response");
      return {
        books: results.hits
          .map((hit) => normalizeHardcover(hit.document))
          .filter(Boolean),
        total: results.found || 0,
        hasMore: page * limit < results.found && results.hits.length === limit,
      };
    },
    async findByExternalId(id, language) {
      const book = await getBook(id);
      if (!book) return null;
      const editions = await getEditions(id);
      const normalized = editions.map((edition) =>
        normalizeHardcover(book, edition),
      );
      const selected =
        normalized.find((edition) => edition.language === language) ||
        normalized[0] ||
        normalizeHardcover(book);
      return { ...selected, editions: normalized };
    },
    async findByIsbn(isbn) {
      const data = await query(
        `query Isbn($isbn: String!) { editions(where: {isbn_13: {_eq: $isbn}}, limit: 5) { ${editionFields} } }`,
        { isbn },
      );
      const results = [];
      for (const edition of data.editions || []) {
        const book = await getBook(edition.book_id);
        const normalized = normalizeHardcover(book, edition);
        if (normalized) results.push(normalized);
      }
      return results;
    },
  };
}
