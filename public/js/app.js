import { icon } from "./icons.js";
import { esc, normal } from "./utils.js";
import { catalogue, palette } from "./catalogue.js";
import { STORAGE, parseWishlist } from "./storage.js";
import { parseBook, searchBooks } from "./open-library.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let saved = [];
let storageOK = true;
try {
  saved = parseWishlist(localStorage.getItem(STORAGE));
} catch {
  storageOK = false;
}
let state = {
  page: location.hash === "#wishlist" ? "wishlist" : "discover",
  genre: "Tous",
  pages: "all",
  query: "",
  view: "grid",
  sort: "default",
  remote: null,
  remoteTotal: 0,
  remotePage: 1,
  busy: false,
  notice: "",
};
let controller;
let detailId = null;
let toastTimer;
let lastTrigger;
let editingId = null;
function hydrate() {
  document
    .querySelectorAll("[data-icon]")
    .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
}
function save(next) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(next));
    saved = next;
    return true;
  } catch {
    toast(
      "Le navigateur ne permet pas l’enregistrement. Votre liste n’a pas été modifiée.",
    );
    return false;
  }
}
function isSaved(b) {
  return saved.some(
    (s) =>
      s.id === b.id ||
      (s.isbn && b.isbn && s.isbn === b.isbn) ||
      (normal(s.title) === normal(b.title) &&
        normal(s.author) === normal(b.author)),
  );
}
function find(id) {
  return (
    saved.find((b) => b.id === id) ||
    state.remote?.find((b) => b.id === id) ||
    catalogue.find((b) => b.id === id)
  );
}
function cover(b) {
  const src = b.coverId
    ? `https://covers.openlibrary.org/b/id/${encodeURIComponent(b.coverId)}-M.jpg?default=false`
    : b.isbn
      ? `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(b.isbn)}-M.jpg?default=false`
      : "";
  return `<div class="cover-placeholder" ${src ? "hidden" : ""} style="--book-color:${/^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#557260"}"><small>${esc(b.author)}</small><span>${esc(b.title)}</span><span class="ornament">✳</span></div>${src ? `<img class="book-cover" src="${src}" alt="Couverture de ${esc(b.title)}" loading="lazy">` : ""}`;
}
function bindImageFallback(root = document) {
  root.querySelectorAll("img.book-cover").forEach((img) => {
    const fail = () => {
      img.hidden = true;
      img.previousElementSibling.hidden = false;
    };
    img.addEventListener("error", fail, { once: true });
    img.addEventListener(
      "load",
      () => {
        if (img.naturalWidth < 5) fail();
      },
      { once: true },
    );
  });
}
function card(b, i) {
  const added = isSaved(b);
  return `<article class="book-card"><button class="cover-button" data-detail="${esc(b.id)}" aria-label="Voir la fiche de ${esc(b.title)}"><div class="cover-stage" style="--stage:${palette[i % palette.length]}">${cover(b)}<span class="book-number" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><span class="cover-hint">Ouvrir la fiche ${icon("arrow")}</span></div></button><button class="icon-btn save-book ${added ? "saved" : ""}" data-save="${esc(b.id)}" aria-label="${added ? "Retirer" : "Ajouter"} ${esc(b.title)} ${added ? "de" : "à"} ma liste à lire" aria-pressed="${added}">${icon(added ? "check" : "plus")}</button><div class="book-info"><span class="book-category">${esc((b.tags || [])[0] || "À découvrir")}</span><button class="book-title" data-detail="${esc(b.id)}">${esc(b.title)}</button><p class="book-author">${esc(b.author)}</p><div class="book-meta"><span>${b.pages ? esc(b.pages) + " pages" : "Pages non renseignées"}</span>${b.year ? `<span>${esc(b.year)}</span>` : ""}</div></div></article>`;
}
function sourceBooks() {
  return state.page === "wishlist" ? saved : (state.remote ?? catalogue);
}
function filtered() {
  let books = sourceBooks().filter((b) => {
    if (
      state.page === "wishlist" &&
      state.query &&
      !normal([b.title, b.author, b.isbn, ...b.tags].join(" ")).includes(
        normal(state.query),
      )
    )
      return false;
    if (
      state.genre !== "Tous" &&
      !b.tags?.some((t) => normal(t) === normal(state.genre))
    )
      return false;
    const n = Number(b.pages);
    if (state.pages === "short") return n > 0 && n < 250;
    if (state.pages === "medium") return n >= 250 && n <= 500;
    if (state.pages === "long") return n > 500;
    return true;
  });
  if (state.sort === "title")
    books.sort((a, b) => a.title.localeCompare(b.title, "fr"));
  if (state.sort === "author")
    books.sort((a, b) => a.author.localeCompare(b.author, "fr"));
  if (state.sort === "pages")
    books.sort((a, b) => (a.pages || Infinity) - (b.pages || Infinity));
  if (state.sort === "year")
    books.sort((a, b) => (b.year || 0) - (a.year || 0));
  if (state.sort === "default" && state.page === "wishlist")
    books.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  return books;
}
function render() {
  const wish = state.page === "wishlist";
  $(".collection").setAttribute(
    "aria-label",
    wish ? "Ma liste à lire" : "Découvrir des livres",
  );
  $("#search").placeholder = wish
    ? "Rechercher dans ma liste à lire…"
    : "Un titre, un auteur, un ISBN…";
  $("#search-clear").hidden = !$("#search").value;
  $("#nav-count").textContent = saved.length;
  $$("[data-nav]").forEach((b) => {
    b.classList.toggle("active", b.dataset.nav === state.page);
    b.setAttribute(
      "aria-current",
      b.dataset.nav === state.page ? "page" : "false",
    );
  });
  $('#sort option[value="default"]').textContent = wish
    ? "Derniers ajouts"
    : state.remote
      ? "Pertinence"
      : "Notre sélection";
  $$("[data-genre]").forEach((b) =>
    b.classList.toggle("active", b.dataset.genre === state.genre),
  );
  const fixed = ["Tous", "Roman", "Imaginaire", "Essai", "Classique"];
  const extra = [...new Set(sourceBooks().flatMap((b) => b.tags || []))]
    .filter((t) => !fixed.includes(t))
    .sort((a, b) => a.localeCompare(b, "fr"));
  $("#extra-genre").innerHTML =
    '<option value="">Autres genres</option>' +
    extra.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  $("#extra-genre").value = fixed.includes(state.genre) ? "" : state.genre;
  const books = filtered();
  $("#result-count").textContent = state.busy
    ? "Recherche en cours…"
    : `${books.length} livre${books.length > 1 ? "s" : ""}${wish ? " dans votre liste" : state.remote ? " affiché" + (books.length > 1 ? "s" : "") + " sur " + state.remoteTotal.toLocaleString("fr-FR") : " à découvrir"}`;
  $("#search-notice").hidden = !state.notice;
  $("#search-notice").textContent = state.notice;
  $("#books").className = "book-grid" + (state.view === "list" ? " list" : "");
  $("#books").classList.toggle("loading", state.busy);
  $("#books").innerHTML = books.length
    ? books.map(card).join("")
    : state.busy
      ? `<div class="empty"><span class="busy-spinner"></span><h3>À la recherche de votre prochain livre…</h3></div>`
      : `<div class="empty">${icon(wish && !saved.length ? "bookmark" : "search")}<h3>${wish && !saved.length ? "Votre prochaine histoire commence ici." : "Aucun livre pour le moment."}</h3><p>${wish && !saved.length ? "Un titre vous fait de l’œil ? Ajoutez-le depuis Découvrir, ou créez sa fiche manuellement." : "Essayez un autre titre ou élargissez vos filtres pour trouver votre bonheur."}</p><button class="primary" id="empty-action">${wish && !saved.length ? "Découvrir des livres" : "Réinitialiser les filtres"} ${icon("arrow")}</button></div>`;
  $("#load-more").hidden =
    wish ||
    !state.remote ||
    state.remote.length >= state.remoteTotal ||
    state.busy;
  $("#search-form button[type=submit]").disabled = state.busy;
  bindImageFallback();
}
function navigate(page) {
  controller?.abort();
  controller = null;
  state = {
    ...state,
    page,
    genre: "Tous",
    query: "",
    pages: "all",
    sort: "default",
    remote: null,
    remoteTotal: 0,
    notice: "",
    busy: false,
  };
  $("#search").value = "";
  $("#sort").value = "default";
  $("#pages-filter").value = "all";
  location.hash = page;
  render();
}
function toast(message, undo) {
  clearTimeout(toastTimer);
  const el = $("#toast");
  el.replaceChildren(document.createTextNode(message));
  if (undo) {
    const btn = document.createElement("button");
    btn.textContent = "Annuler";
    btn.onclick = () => {
      undo();
      el.classList.remove("visible");
    };
    el.append(btn);
  }
  el.classList.add("visible");
  toastTimer = setTimeout(
    () => el.classList.remove("visible"),
    undo ? 8000 : 4200,
  );
}
function toggleSave(id) {
  const b = find(id);
  if (!b) return;
  const existing = saved.find(
    (s) =>
      s.id === id ||
      (s.isbn && s.isbn === b.isbn) ||
      (normal(s.title) === normal(b.title) &&
        normal(s.author) === normal(b.author)),
  );
  if (existing) {
    if (!save(saved.filter((s) => s.id !== existing.id))) return;
    toast("Livre retiré de votre liste.", () => {
      if (!isSaved(existing) && save([...saved, existing])) {
        render();
        if (detailId) showDetail(detailId, false);
      }
    });
  } else {
    if (!save([...saved, { ...b, addedAt: Date.now() }])) return;
    toast("Une nouvelle envie dans votre liste !");
  }
  render();
  if (detailId === id && $("#book-dialog").open) {
    $("#book-dialog").close();
    return;
  }
  if (detailId && $("#book-dialog").open) {
    if (!find(detailId)) {
      $("#book-dialog").close();
    } else showDetail(detailId, false);
  }
}
function openDialog(id) {
  lastTrigger = document.activeElement;
  $(id).showModal();
}
function sourceUrl(b) {
  if (b.workKey && /^\/?works\/OL\d+W$/.test(b.workKey))
    return `https://openlibrary.org/${b.workKey.replace(/^\//, "")}`;
  return b.isbn
    ? `https://openlibrary.org/isbn/${encodeURIComponent(b.isbn)}`
    : "";
}
function showDetail(id, open = true) {
  const b = find(id);
  if (!b) return;
  detailId = id;
  const added = isSaved(b);
  const url = sourceUrl(b);
  $("#book-detail").innerHTML =
    `<div class="detail-layout"><div class="detail-cover">${cover(b)}</div><div class="detail-content"><div class="eyebrow">${b.manual ? "VOTRE FICHE PERSONNELLE" : "UNE HISTOIRE À DÉCOUVRIR"}</div><h2 id="detail-title">${esc(b.title)}</h2><p class="detail-author">${esc(b.author)}</p><div class="detail-tags">${(b.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div><dl class="detail-facts"><div><dt>Nombre de pages</dt><dd>${b.pages ? esc(b.pages) + " pages" : "Non renseigné"}</dd></div><div><dt>Première parution</dt><dd>${b.year ? esc(b.year) : "Non renseignée"}</dd></div><div><dt>ISBN</dt><dd>${esc(b.isbn || "Non renseigné")}</dd></div><div><dt>Éditeur</dt><dd>${esc(b.publisher || "Non renseigné")}</dd></div></dl><h3>À propos du livre</h3><p class="description" id="detail-description">${esc(b.description || "Aucun résumé disponible pour ce livre.")}</p>${added ? `<label class="personal-label">Mes tags · séparés par des virgules<input class="personal-tags" id="personal-tags" value="${esc(b.tags.join(", "))}" maxlength="250" placeholder="Roman, Nature…"></label><button class="text-btn" id="save-tags">Enregistrer les tags</button>` : ""}<div class="detail-actions"><button class="primary" data-save="${esc(b.id)}">${icon(added ? "check" : "plus")}${added ? "Retirer de ma liste" : "Ajouter à ma liste à lire"}</button>${b.manual ? `<button class="secondary" id="edit-manual">Modifier</button>` : ""}</div>${url ? `<a class="detail-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Voir la référence sur Open Library ↗</a>` : '<span class="detail-source">Métadonnées ajoutées manuellement.</span>'}${b.manual ? "" : '<span class="detail-source">Le nombre de pages peut varier selon l’édition.</span>'}</div></div>`;
  bindImageFallback($("#book-dialog"));
  if (open) openDialog("#book-dialog");
  if (b.workKey && !b.description) loadDescription(b);
}
async function loadDescription(b) {
  try {
    if (!/^\/?works\/OL\d+W$/.test(b.workKey)) return;
    const response = await fetch(
      `https://openlibrary.org/${b.workKey.replace(/^\//, "")}.json`,
      { signal: AbortSignal.timeout(9000) },
    );
    if (!response.ok) return;
    const data = await response.json();
    const text =
      typeof data.description === "string"
        ? data.description
        : data.description?.value;
    if (text) {
      b.description = text;
      if (detailId === b.id && $("#book-dialog").open)
        $("#detail-description").textContent = text;
    }
  } catch {}
}
async function search(more = false) {
  if (state.page === "wishlist") {
    state.query = $("#search").value.trim();
    render();
    return;
  }
  const q = $("#search").value.trim();
  if (!q) {
    controller?.abort();
    controller = null;
    state.remote = null;
    state.query = "";
    state.notice = "";
    state.busy = false;
    render();
    return;
  }
  controller?.abort();
  controller = null;
  controller = new AbortController();
  const currentController = controller;
  state.query = q;
  state.busy = true;
  state.notice = "";
  if (!more) {
    state.remote = [];
    state.remoteTotal = 0;
    state.remotePage = 1;
  } else state.remotePage++;
  render();
  const timer = setTimeout(() => currentController.abort("timeout"), 15000);
  try {
    const data = await searchBooks(
      q,
      state.remotePage,
      currentController.signal,
    );
    if (controller !== currentController) return;
    const books = data.docs.map(parseBook);
    state.remote = more
      ? [...new Map([...state.remote, ...books].map((b) => [b.id, b])).values()]
      : books;
    state.remoteTotal = data.numFound ?? data.num_found ?? books.length;
    if (!books.length && !more)
      state.notice =
        "Aucun résultat dans Open Library. Essayez un titre dans sa langue originale, un auteur ou un ISBN.";
  } catch (error) {
    if (controller !== currentController) return;
    if (more) {
      state.remotePage--;
      state.notice =
        "Les résultats suivants ne sont pas disponibles pour le moment. Vous pouvez réessayer.";
    } else {
      state.remote = catalogue.filter((b) =>
        normal([b.title, b.author, b.isbn, ...b.tags].join(" ")).includes(
          normal(q),
        ),
      );
      state.remoteTotal = state.remote.length;
      state.notice =
        "Open Library est indisponible ou trop lent. Seule notre sélection locale est affichée. Vous pouvez réessayer ou ajouter une fiche manuellement.";
    }
  } finally {
    clearTimeout(timer);
    if (controller === currentController) {
      state.busy = false;
      render();
    }
  }
}
function resetFilters() {
  state.genre = "Tous";
  state.pages = "all";
  $("#pages-filter").value = "all";
  if (state.page === "wishlist" || (state.remote && !state.remote.length)) {
    state.query = "";
    $("#search").value = "";
    if (state.page === "discover") {
      state.remote = null;
      state.notice = "";
    }
  }
  render();
}
function manualOpen(b) {
  editingId = b?.id || null;
  const form = $("#manual-form");
  form.reset();
  $("#manual-title").textContent = b ? "Modifier le livre" : "Ajouter un livre";
  if (b) {
    for (const k of ["title", "author", "pages", "year", "description"])
      form.elements[k].value = b[k] || "";
    form.elements.tags.value = b.tags.join(", ");
  }
  $("#manual-form button[type=submit]").innerHTML =
    icon(b ? "check" : "plus") +
    (b ? "Enregistrer les modifications" : "Ajouter à ma liste à lire");
  openDialog("#manual-dialog");
}
document.addEventListener("click", (e) => {
  const detail = e.target.closest("[data-detail]");
  const saveButton = e.target.closest("[data-save]");
  const nav = e.target.closest("[data-nav]");
  const genre = e.target.closest("[data-genre]");
  if (detail) showDetail(detail.dataset.detail);
  if (saveButton) toggleSave(saveButton.dataset.save);
  if (nav) navigate(nav.dataset.nav);
  if (genre) {
    state.genre = genre.dataset.genre;
    render();
  }
  if (e.target.closest(".close-dialog")) e.target.closest("dialog").close();
  if (e.target.closest("#empty-action")) {
    if (state.page === "wishlist" && !saved.length) navigate("discover");
    else resetFilters();
  }
  if (e.target.closest("#save-tags")) {
    const input = $("#personal-tags");
    const tags = [
      ...new Set(
        input.value
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ].slice(0, 15);
    if (save(saved.map((b) => (b.id === detailId ? { ...b, tags } : b)))) {
      render();
      showDetail(detailId, false);
      toast("Vos tags ont été enregistrés.");
    }
  }
  if (e.target.closest("#edit-manual")) {
    const b = find(detailId);
    $("#book-dialog").close();
    manualOpen(b);
  }
});
$$("dialog").forEach((d) => {
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    }
  });
  d.addEventListener("close", () => {
    if (d.id === "book-dialog") detailId = null;
    if (lastTrigger?.isConnected) lastTrigger.focus();
  });
});
$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  search();
});
let inputTimer;
$("#search").addEventListener("input", () => {
  $("#search-clear").hidden = !$("#search").value;
  if (state.page === "wishlist") {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      state.query = $("#search").value.trim();
      render();
    }, 150);
  } else if (!$("#search").value) search();
});
$("#search-clear").onclick = () => {
  $("#search").value = "";
  search();
  $("#search").focus();
};
$("#sort").onchange = (e) => {
  state.sort = e.target.value;
  render();
};
$("#pages-filter").onchange = (e) => {
  state.pages = e.target.value;
  render();
};
$("#extra-genre").onchange = (e) => {
  state.genre = e.target.value || "Tous";
  render();
};
$("#advanced-toggle").onclick = () => {
  const open = $("#advanced").hidden;
  $("#advanced").hidden = !open;
  $("#advanced-toggle").setAttribute("aria-expanded", String(open));
};
$("#reset-filters").onclick = resetFilters;
$("#grid-view").onclick = () => setView("grid");
$("#list-view").onclick = () => setView("list");
function setView(view) {
  state.view = view;
  $("#grid-view").classList.toggle("active", view === "grid");
  $("#list-view").classList.toggle("active", view === "list");
  $("#grid-view").setAttribute("aria-pressed", String(view === "grid"));
  $("#list-view").setAttribute("aria-pressed", String(view === "list"));
  render();
}
$("#manual-open").onclick = () => manualOpen();
$("#about").onclick = () => openDialog("#about-dialog");
$("#about-footer").onclick = () => openDialog("#about-dialog");
$("#load-more").onclick = () => search(true);
$("#manual-form").onsubmit = (e) => {
  e.preventDefault();
  const data = new FormData(e.target);
  const title = data.get("title").trim(),
    author = data.get("author").trim();
  if (!title || !author) {
    toast("Veuillez renseigner le titre et l’auteur.");
    return;
  }
  const old = editingId ? saved.find((b) => b.id === editingId) : null;
  const book = {
    ...(old || {}),
    id: editingId || "manual:" + crypto.randomUUID(),
    title,
    author,
    pages: Number(data.get("pages")) || null,
    year: Number(data.get("year")) || null,
    tags: [
      ...new Set(
        data
          .get("tags")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ].slice(0, 15),
    description: data.get("description").trim(),
    manual: true,
    addedAt: old?.addedAt || Date.now(),
    color: "#557260",
  };
  if (!editingId && isSaved(book)) {
    toast("Ce livre est déjà dans votre liste.");
    return;
  }
  if (
    save(
      editingId
        ? saved.map((b) => (b.id === editingId ? book : b))
        : [...saved, book],
    )
  ) {
    $("#manual-dialog").close();
    navigate("wishlist");
    toast(
      editingId
        ? "La fiche a été mise à jour."
        : "Votre livre a rejoint la liste à lire.",
    );
  }
};
$("#export").onclick = () => {
  const blob = new Blob([JSON.stringify(saved, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "en-marge-ma-liste.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
window.addEventListener("hashchange", () => {
  const page = location.hash === "#wishlist" ? "wishlist" : "discover";
  if (page !== state.page) navigate(page);
});
window.addEventListener("storage", (e) => {
  if (e.key !== STORAGE) return;
  try {
    saved = parseWishlist(e.newValue);
    render();
  } catch {}
});
hydrate();
render();
if (!storageOK)
  toast(
    "Les données enregistrées ne sont pas accessibles. Vous pouvez exporter votre liste depuis les informations.",
  );
