import { normalizeIsbn } from "./metadata/model.js";

const normalize = (value = "") =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const overlap = (a, b) => {
  const left = new Set(normalize(a).split(" ").filter(Boolean));
  const right = new Set(normalize(b).split(" ").filter(Boolean));
  const common = [...left].filter((word) => right.has(word)).length;
  return common / Math.max(left.size, right.size, 1);
};
const similarity = (a, b) => {
  const left = normalize(a);
  const right = normalize(b);
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const row = [i];
    for (let j = 1; j <= right.length; j++)
      row[j] = Math.min(
        row[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + Number(left[i - 1] !== right[j - 1]),
      );
    previous = row;
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length, 1);
};
const score = (book, title, author) =>
  (normalize(book.title) === normalize(title)
    ? 100
    : 60 *
      Math.max(overlap(book.title, title), similarity(book.title, title))) +
  (author
    ? normalize(book.author) === normalize(author)
      ? 40
      : 20 * overlap(book.author, author)
    : 0);

export function createBookWorkflow({ store, catalogue }) {
  const languageFor = (language) =>
    language || store.settings().language || "fr";
  const requireHardcover = () => {
    if (!catalogue.providers().some((p) => p.id === "hardcover" && p.enabled))
      throw new Error(
        "Hardcover est désactivé. Configurez HARDCOVER_API_TOKEN et activez ce fournisseur avant l’ajout.",
      );
  };
  const search = async ({ query, language, page = 1 }) => {
    requireHardcover();
    return catalogue.search({
      query,
      language: languageFor(language),
      page,
      provider: "hardcover",
    });
  };
  const resolve = async (candidateId, language, title) => {
    const [, id, editionId] =
      /^hardcover:(\d{1,10})(?::edition:(\d{1,10}))?$/.exec(candidateId) || [];
    if (!id) throw new Error("Identifiant Hardcover invalide.");
    const data = await catalogue.book({ provider: "hardcover", id, language });
    const book = editionId
      ? [data.book, ...(data.book.editions || [])].find(
          (edition) => edition.id === candidateId,
        )
      : data.book.editions?.find(
          (edition) =>
            edition.language === language &&
            normalize(edition.title) === normalize(title),
        ) || data.book;
    if (!book) throw new Error("Édition Hardcover introuvable.");
    return {
      book:
        book.id === data.book.id
          ? data.book
          : { ...book, editions: data.book.editions || [] },
      warnings: data.warnings || [],
    };
  };
  return {
    search,
    async add({
      title,
      author,
      language,
      candidate_id,
      confirmed,
      status,
      tags,
    }) {
      requireHardcover();
      language = languageFor(language);
      let candidates = [];
      let warnings = [];
      let certain = false;
      const isbn = normalizeIsbn(title.replace(/^isbn:/i, ""));
      if (!candidate_id) {
        let data = await search({
          query:
            isbn || [title, author].filter(Boolean).join(" ").slice(0, 300),
          language,
        });
        warnings.push(...data.warnings);
        if (!data.books.length && author && !isbn) {
          data = await search({ query: title, language });
          warnings.push(...data.warnings);
        }
        candidates = [...data.books].sort(
          (a, b) => score(b, title, author) - score(a, title, author),
        );
        if (!candidates.length)
          return {
            outcome: "not_found",
            message:
              "Aucun résultat Hardcover. Précisez le titre, l’auteur ou un ISBN ; aucun livre n’a été ajouté.",
            candidates: [],
            warnings,
          };
        const best = candidates[0];
        certain = isbn
          ? best.isbns.includes(isbn) && candidates.length === 1
          : normalize(best.title) === normalize(title) &&
            (!author || normalize(best.author) === normalize(author)) &&
            (!candidates[1] ||
              score(best, title, author) -
                score(candidates[1], title, author) >=
                20);
        candidate_id = best.id;
      }
      const resolved = await resolve(candidate_id, language, title);
      const book = resolved.book;
      warnings.push(...resolved.warnings);
      const needsConfirmation =
        !certain ||
        book.language !== language ||
        !book.author?.trim() ||
        (author && normalize(book.author) !== normalize(author));
      if (!confirmed && needsConfirmation)
        return {
          outcome: "needs_confirmation",
          message:
            "Présentez la fiche recommandée (titre, auteur, langue, édition) et les alternatives à l’utilisateur. Demandez son choix avant tout ajout. Après son accord explicite, rappelez add_book avec les mêmes paramètres, candidate_id égal à l’identifiant choisi et confirmed: true.",
          reason: !certain ? "uncertain_match" : "edition_language_or_author",
          requestedLanguage: language,
          recommended: book,
          candidates: [
            book,
            ...candidates.filter((b) => b.externalId !== book.externalId),
          ].slice(0, 5),
          warnings,
        };
      if (!book.author?.trim())
        throw new Error(
          "La fiche Hardcover ne comporte pas d’auteur ; ajout impossible.",
        );
      return {
        ...store.addCatalogueBook({
          ...book,
          manual: false,
          status: status || "to-read",
          tags: [...new Set([...book.tags, ...(tags || [])])],
          addedAt: Date.now(),
          color: "#557260",
        }),
        warnings,
      };
    },
  };
}
