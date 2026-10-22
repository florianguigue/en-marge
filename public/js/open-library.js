import { normal } from "./utils.js";

export async function searchBooks(query, page, signal) {
  const params = new URLSearchParams({
    q: query,
    lang: "fr",
    limit: "24",
    page: String(page),
    fields:
      "key,title,author_name,cover_i,isbn,number_of_pages_median,first_publish_year,subject,publisher",
  });
  const response = await fetch(
    `https://openlibrary.org/search.json?${params}`,
    { signal },
  );
  if (!response.ok) throw new Error("Open Library est indisponible.");
  const data = await response.json();
  if (!Array.isArray(data.docs))
    throw new Error("Réponse Open Library invalide.");
  return data;
}

export function parseBook(d) {
  const subjects = Array.isArray(d.subject) ? d.subject : [];
  const text = normal(subjects.join(" "));
  let genre =
    text.includes("science fiction") ||
    text.includes("fantasy") ||
    text.includes("fantastique")
      ? "Imaginaire"
      : text.includes("poetry") || text.includes("poesie")
        ? "Poésie"
        : text.includes("philosoph") ||
            text.includes("essay") ||
            text.includes("essai")
          ? "Essai"
          : text.includes("fiction") || text.includes("roman")
            ? "Roman"
            : subjects[0] || "À découvrir";
  return {
    id: d.key,
    workKey: d.key,
    title: d.title || "Sans titre",
    author: d.author_name?.join(", ") || "Auteur non renseigné",
    isbn: d.isbn?.find((i) => i.length === 13) || d.isbn?.[0] || "",
    coverId: d.cover_i || null,
    pages: d.number_of_pages_median || null,
    year: d.first_publish_year || null,
    publisher: d.publisher?.[0] || "",
    tags: [
      genre,
      ...subjects.filter((t) => normal(t) !== normal(genre)).slice(0, 3),
    ],
    description: "",
    color: "#557260",
  };
}
