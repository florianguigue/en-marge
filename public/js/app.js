import { icon } from "./icons.js";
import { esc, normal } from "./utils.js";
import { catalogue, palette } from "./catalogue.js";
import {
  getCatalogue,
  localizeBook,
  loadBookEditions,
} from "./book-editions.js";
import { STORAGE, parseWishlist } from "./storage.js";
import {
  loadLibrary,
  writeLibrary,
  importLibrary,
  loadSettings,
  writeLanguage,
} from "./api.js";
import { searchBooks, loadBookMetadata, safeMetadataUrl } from "./metadata.js";
import { READING_STATUSES, normalizeReadingStatus } from "./reading-status.js";
import { normalizeIsbn } from "./isbn.js";
import {
  LANGUAGE_STORAGE,
  initializeLanguage,
  getLanguage,
  getLocale,
  setLanguage,
  t,
  formatNumber,
  pluralKey,
  bookCount,
  pageCount,
  genreLabel,
  applyTranslations,
} from "./i18n.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
initializeLanguage();
let saved = [];
let revision = 0;
let storageOK = false;
let saving = false;
let migrationFailed = false;
try {
  const library = await loadLibrary();
  saved = library.books;
  revision = library.revision;
  storageOK = true;
  // Read the old browser data once; remove it only after a committed import.
  let legacy;
  try {
    legacy = localStorage.getItem(STORAGE);
  } catch {}
  if (legacy) {
    try {
      const imported = await importLibrary(parseWishlist(legacy));
      saved = imported.books;
      revision = imported.revision;
      localStorage.removeItem(STORAGE);
    } catch {
      migrationFailed = true;
    }
  }
} catch {}
try {
  const settings = await loadSettings();
  let preference = settings.language;
  let legacy;
  try {
    legacy = localStorage.getItem(LANGUAGE_STORAGE);
  } catch {}
  if (!preference && ["fr", "en"].includes(legacy)) {
    preference = (await writeLanguage(legacy)).language;
  }
  initializeLanguage(preference);
  try {
    localStorage.removeItem(LANGUAGE_STORAGE);
  } catch {}
} catch {}
let state = {
  page: location.hash === "#discover" ? "discover" : "wishlist",
  genre: "Tous",
  pages: "all",
  readingStatus: "all",
  query: "",
  view: "grid",
  sort: "default",
  remote: null,
  remoteTotal: 0,
  remotePage: 1,
  remoteHasMore: false,
  remoteProvider: null,
  remoteLanguage: null,
  busy: false,
  notice: "",
};
let controller;
let editionController;
const metadataDetails = new Map();
let detailId = null;
let toastTimer;
let currentToast;
let lastTrigger;
let editingId = null;
function hydrate() {
  document
    .querySelectorAll("[data-icon]")
    .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
}
async function save(next) {
  if (!storageOK || saving) {
    toast("storageFailed");
    return false;
  }
  saving = true;
  try {
    const library = await writeLibrary(next, revision);
    saved = library.books;
    revision = library.revision;
    return true;
  } catch (error) {
    if (error.status === 409) {
      await syncLibrary(true);
      toast("storageConflict");
    } else toast("storageFailed");
    return false;
  } finally {
    saving = false;
  }
}
async function syncLibrary(force = false) {
  try {
    const library = await loadLibrary();
    if (saving && !force) return;
    storageOK = true;
    if (library.revision <= revision) return;
    saved = library.books;
    revision = library.revision;
    render();
    refreshSavedEditions();
    if (detailId && $("#book-dialog").open) {
      if (find(detailId)) showDetail(detailId, false);
      else $("#book-dialog").close();
    }
  } catch {}
}
function findSaved(b) {
  return saved.find(
    (s) =>
      s.id === b.id ||
      (normalizeIsbn(s.isbn) &&
        normalizeIsbn(s.isbn) === normalizeIsbn(b.isbn)) ||
      (s.manual &&
        b.manual &&
        normal(s.title) === normal(b.title) &&
        normal(s.author) === normal(b.author)),
  );
}
function isSaved(book) {
  return Boolean(findSaved(book));
}
function readingStatusControl(book) {
  const status = normalizeReadingStatus(book.status);
  return `<label class="reading-status status-${status}"><span>${t("readingStatus")}</span><select data-reading-status="${esc(book.id)}" aria-label="${esc(t("bookStatus", { title: bookName(book) }))}">${Object.entries(
    READING_STATUSES,
  )
    .map(
      ([value, label]) =>
        `<option value="${value}" ${value === status ? "selected" : ""}>${t(`status.${value}`)}</option>`,
    )
    .join("")}</select></label>`;
}
function renderReadingFilters() {
  const element = $("#reading-filters");
  element.hidden = state.page !== "wishlist";
  if (element.hidden) return;
  const options = [
    ["all", t("allStatuses")],
    ...Object.entries(READING_STATUSES),
  ];
  element.innerHTML = options
    .map(([status, label]) => {
      const active = state.readingStatus === status;
      const count =
        status === "all"
          ? saved.length
          : saved.filter((book) => book.status === status).length;
      return `<button class="chip reading-filter ${active ? "active" : ""}" data-reading-filter="${status}" aria-pressed="${active}">${status === "all" ? label : t(`status.${status}`)} <span class="reading-count">${formatNumber(count)}</span></button>`;
    })
    .join("");
}
async function changeReadingStatus(control) {
  const id = control.dataset.readingStatus;
  const status = control.value;
  const book = saved.find((item) => item.id === id);
  if (!book || !Object.hasOwn(READING_STATUSES, status)) return;
  const inDialog = Boolean(control.closest("dialog"));
  if (
    !(await save(
      saved.map((item) => (item.id === id ? { ...item, status } : item)),
    ))
  ) {
    control.value = book.status;
    return;
  }
  render();
  if (detailId && $("#book-dialog").open) showDetail(detailId, false);
  const container = inDialog ? $("#book-dialog") : $("#books");
  const nextControl = [
    ...container.querySelectorAll("[data-reading-status]"),
  ].find((item) => item.dataset.readingStatus === id);
  (nextControl || $('#reading-filters [aria-pressed="true"]'))?.focus();
  toast("statusSaved", null, { status });
}
function find(id) {
  const book =
    saved.find((b) => b.id === id) ||
    state.remote?.find((b) => b.id === id) ||
    catalogue.find((b) => b.id === id);
  if (!book) return undefined;
  const localized = localizeBook(book, getLanguage());
  return { ...localized, ...metadataDetails.get(`${id}:${getLanguage()}`) };
}
function bookName(book) {
  return !book.title || ["Sans titre", "Untitled"].includes(book.title)
    ? t("untitled")
    : book.title;
}
function bookAuthor(book) {
  return !book.author ||
    ["Auteur non renseigné", "Unknown author"].includes(book.author)
    ? t("unknownAuthor")
    : book.author;
}
function cover(b) {
  const src =
    safeMetadataUrl(b.coverUrl) ||
    (!b.provider && b.coverId
      ? `https://covers.openlibrary.org/b/id/${encodeURIComponent(b.coverId)}-M.jpg?default=false`
      : !b.provider && b.isbn
        ? `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(b.isbn)}-M.jpg?default=false`
        : "");
  return `<div class="cover-placeholder" ${src ? "hidden" : ""} style="--book-color:${/^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#557260"}">
    <small>${esc(bookAuthor(b))}</small><span>${esc(bookName(b))}</span><span class="ornament">✳</span>
  </div>${src ? `<img class="book-cover" src="${src}" alt="${esc(t("coverAlt", { title: bookName(b) }))}" loading="lazy">` : ""}`;
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
  return `<article class="book-card">
    <button class="cover-button" data-detail="${esc(b.id)}" aria-label="${esc(t("viewBook", { title: bookName(b) }))}">
      <div class="cover-stage" style="--stage:${palette[i % palette.length]}">${cover(b)}
        <span class="book-number" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
        <span class="cover-hint">${t("openDetail")} ${icon("arrow")}</span>
      </div>
    </button>
    <button class="icon-btn save-book ${added ? "saved" : ""}" data-save="${esc(b.id)}"
      aria-label="${esc(t(added ? "removeBookLabel" : "addBookLabel", { title: bookName(b) }))}" aria-pressed="${added}">${icon(added ? "check" : "plus")}</button>
    <div class="book-info">
      <span class="book-category">${esc(genreLabel((b.tags || [])[0] || "À découvrir"))}</span>
      <button class="book-title" data-detail="${esc(b.id)}">${esc(bookName(b))}</button>
      <p class="book-author">${esc(bookAuthor(b))}</p>
      <div class="book-meta"><span>${b.pages ? pageCount(b.pages) : t("pagesUnknown")}</span>${b.year ? `<span>${esc(b.year)}</span>` : ""}</div>
      ${b.originalEdition ? `<span class="book-edition-note">${t(b.language ? "originalEdition" : "editionLanguageUnknown")}</span>` : ""}
      ${state.page === "wishlist" ? readingStatusControl(b) : ""}
    </div>
  </article>`;
}
function sourceBooks() {
  const language = getLanguage();
  if (state.page === "wishlist")
    return saved.map((book) => localizeBook(book, language));
  return (
    state.remote?.map((book) => localizeBook(book, language)) ??
    getCatalogue(language)
  );
}
function filtered() {
  let books = sourceBooks().filter((b) => {
    if (
      state.page === "wishlist" &&
      state.readingStatus !== "all" &&
      b.status !== state.readingStatus
    )
      return false;
    if (
      state.page === "wishlist" &&
      state.query &&
      !normal(
        [b.title, b.author, b.isbn, ...b.tags, ...b.tags.map(genreLabel)].join(
          " ",
        ),
      ).includes(normal(state.query))
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
    books.sort((a, b) => a.title.localeCompare(b.title, getLocale()));
  if (state.sort === "author")
    books.sort((a, b) => a.author.localeCompare(b.author, getLocale()));
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
    wish ? t("library") : t("discoverBooks"),
  );
  $("#search").placeholder = wish ? t("searchLibrary") : t("searchPlaceholder");
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
    ? t("recentlyAdded")
    : state.remote
      ? t("relevance")
      : t("ourSelection");
  $$("[data-genre]").forEach((b) =>
    b.classList.toggle("active", b.dataset.genre === state.genre),
  );
  const fixed = ["Tous", "Roman", "Imaginaire", "Essai", "Classique"];
  const extra = [...new Set(sourceBooks().flatMap((b) => b.tags || []))]
    .filter((t) => !fixed.includes(t))
    .sort((a, b) => genreLabel(a).localeCompare(genreLabel(b), getLocale()));
  $("#extra-genre").innerHTML =
    `<option value="">${t("otherGenres")}</option>` +
    extra
      .map((t) => `<option value="${esc(t)}">${esc(genreLabel(t))}</option>`)
      .join("");
  $("#extra-genre").value = fixed.includes(state.genre) ? "" : state.genre;
  renderReadingFilters();
  const books = filtered();
  const booksLabel = bookCount(books.length);
  $("#result-count").textContent = state.busy
    ? t("searching")
    : wish
      ? t("inLibrary", { books: booksLabel })
      : state.remote
        ? t(pluralKey("remoteCount", books.length), {
            books: booksLabel,
            total: formatNumber(state.remoteTotal),
          })
        : t("discoverCount", { books: booksLabel });
  $("#search-notice").hidden = !state.notice;
  $("#search-notice").textContent = state.notice ? t(state.notice) : "";
  $("#books").className = "book-grid" + (state.view === "list" ? " list" : "");
  $("#books").classList.toggle("loading", state.busy);
  const emptyLibrary = wish && !saved.length;
  $("#books").innerHTML = books.length
    ? books.map(card).join("")
    : state.busy
      ? `<div class="empty"><span class="busy-spinner"></span><h3>${t("findingNext")}</h3></div>`
      : `<div class="empty">${icon(emptyLibrary ? "library" : "search")}
        <h3>${t(emptyLibrary ? "emptyLibraryTitle" : "emptyResultsTitle")}</h3>
        <p>${t(emptyLibrary ? "emptyLibraryText" : "emptyResultsText")}</p>
        <button class="primary" id="empty-action">${t(emptyLibrary ? "discoverBooks" : "resetFilters")} ${icon("arrow")}</button>
      </div>`;
  $("#load-more").hidden =
    wish || !state.remote || !state.remoteHasMore || state.busy;
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
    readingStatus: "all",
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
function renderToast() {
  if (!currentToast) return;
  const { key, undo, values } = currentToast;
  const params =
    key === "statusSaved"
      ? { ...values, status: t(`status.${values.status}`) }
      : values;
  const element = $("#toast");
  element.replaceChildren(document.createTextNode(t(key, params)));
  if (undo) {
    const button = document.createElement("button");
    button.textContent = t("undo");
    button.onclick = () => {
      undo();
      element.classList.remove("visible");
    };
    element.append(button);
  }
}
function toast(key, undo, values = {}) {
  clearTimeout(toastTimer);
  currentToast = { key, undo, values };
  renderToast();
  $("#toast").classList.add("visible");
  toastTimer = setTimeout(
    () => $("#toast").classList.remove("visible"),
    undo ? 8000 : 4200,
  );
}
async function toggleSave(id) {
  const b = find(id);
  if (!b) return;
  const existing = findSaved(b);
  if (existing) {
    if (!(await save(saved.filter((s) => s.id !== existing.id)))) return;
    toast("bookRemoved", async () => {
      if (!isSaved(existing) && (await save([...saved, existing]))) {
        render();
        if (detailId) showDetail(detailId, false);
      }
    });
  } else {
    if (!(await save([...saved, { ...b, addedAt: Date.now() }]))) return;
    toast("bookAdded");
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
  if (safeMetadataUrl(b.sourceUrl)) return safeMetadataUrl(b.sourceUrl);
  if (/^\/books\/OL\d+M$/.test(b.editionKey))
    return `https://openlibrary.org${b.editionKey}`;
  if (b.workKey && /^\/?works\/OL\d+W$/.test(b.workKey))
    return `https://openlibrary.org/${b.workKey.replace(/^\//, "")}`;
  return "";
}
function showDetail(id, open = true) {
  let b = find(id);
  if (!b) return;
  const details = metadataDetails.get(`${id}:${getLanguage()}`);
  if (details)
    b = { ...b, ...details, id: b.id, status: b.status, tags: b.tags };
  detailId = id;
  const added = isSaved(b);
  const url = sourceUrl(b);
  $("#book-detail").innerHTML = `<div class="detail-layout">
    <div class="detail-cover">${cover(b)}</div>
    <div class="detail-content">
      <div class="eyebrow">${t(b.manual ? "personalBook" : "discoverStory")}</div>
      <h2 id="detail-title">${esc(bookName(b))}</h2><p class="detail-author">${esc(bookAuthor(b))}</p>
      ${b.originalEdition ? `<span class="detail-source">${t(b.language ? "originalEdition" : "editionLanguageUnknown")}</span>` : ""}
      <div class="detail-tags">${(b.tags || []).map((tag) => `<span class="chip">${esc(genreLabel(tag))}</span>`).join("")}</div>
      <dl class="detail-facts">
        <div><dt>${t("pageNumber")}</dt><dd>${b.pages ? pageCount(b.pages) : t("notProvided")}</dd></div>
        <div><dt>${t("firstPublication")}</dt><dd>${b.year ? esc(b.year) : t("yearUnknown")}</dd></div>
        <div><dt>ISBN</dt><dd>${esc(b.isbn || t("notProvided"))}</dd></div>
        <div><dt>${t("publisher")}</dt><dd>${esc(b.publisher || t("notProvided"))}</dd></div>
      </dl>
      <h3>${t("aboutBook")}</h3><p class="description" id="detail-description">${esc(b.description || t("noSummary"))}</p>
      ${b.series?.length ? `<h3>${t("series")}</h3><p>${b.series.map((series) => `${esc(series.name)}${series.position != null ? ` · ${esc(series.position)}` : ""}`).join("<br>")}</p>` : ""}
      ${
        added
          ? `${readingStatusControl(localizeBook(findSaved(b), getLanguage()))}
        <label class="personal-label">${t("personalTags")}<input class="personal-tags" id="personal-tags" value="${esc(b.tags.join(", "))}" maxlength="250" placeholder="${t("personalTagsPlaceholder")}"></label>
        <button class="text-btn" id="save-tags">${t("saveTags")}</button>`
          : ""
      }
      <div class="detail-actions">
        <button class="primary" data-save="${esc(b.id)}">${icon(added ? "check" : "plus")}${t(added ? "removeFromLibrary" : "addToLibrary")}</button>
        ${b.manual ? `<button class="secondary" id="edit-manual">${t("edit")}</button>` : ""}
      </div>
      ${url ? `<a class="detail-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${t("metadataReference")}</a>` : `<span class="detail-source">${t(b.manual ? "manualMetadata" : "notProvided")}</span>`}
      ${b.sources?.length ? `<span class="detail-source">${t("metadataSources")} ${b.sources.map((source) => esc(source.provider)).join(", ")}</span>` : ""}
      ${safeMetadataUrl(b.imageCredits?.url) ? `<a class="detail-source" href="${esc(safeMetadataUrl(b.imageCredits.url))}" target="_blank" rel="noopener noreferrer">${esc(b.imageCredits.text || t("imageCredit"))}</a>` : ""}
      ${b.manual ? "" : `<span class="detail-source">${t("editionPagesVary")}</span>`}
    </div>
  </div>`;
  bindImageFallback($("#book-dialog"));
  if (open) openDialog("#book-dialog");
  if (!b.manual && !details) loadDetails(b);
}
async function loadDetails(b) {
  const language = getLanguage();
  const key = `${b.id}:${language}`;
  try {
    const data = await loadBookMetadata(
      b,
      language,
      AbortSignal.timeout(12000),
    );
    // An existing edition remains authoritative when an ISBN lookup resolves a new provider.
    const details = data?.book;
    if (!details) return;
    const sameEdition =
      (b.editionId && b.editionId === details.editionId) ||
      (normalizeIsbn(b.isbn) &&
        normalizeIsbn(b.isbn) === normalizeIsbn(details.isbn));
    metadataDetails.set(key, {
      description: details.description || b.description,
      series: details.series,
      sources: details.sources,
      provenance: details.provenance,
      externalIds: { ...b.externalIds, ...details.externalIds },
      ...(sameEdition
        ? {
            pages: b.pages || details.pages,
            publisher: b.publisher || details.publisher,
            year: b.year || details.year,
            coverUrl: b.coverUrl || details.coverUrl,
            imageCredits: b.coverUrl ? b.imageCredits : details.imageCredits,
            author:
              !b.author ||
              ["Auteur non renseigné", "Unknown author"].includes(b.author)
                ? details.author
                : b.author,
          }
        : {}),
    });
    if (
      getLanguage() === language &&
      detailId === b.id &&
      $("#book-dialog").open
    )
      refreshOpenDetail();
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
  state.remoteLanguage = getLanguage();
  state.busy = true;
  state.notice = "";
  if (!more) {
    state.remote = [];
    state.remoteTotal = 0;
    state.remotePage = 1;
    state.remoteProvider = null;
    state.remoteHasMore = false;
  } else state.remotePage++;
  render();
  const timer = setTimeout(() => currentController.abort("timeout"), 15000);
  try {
    const data = await searchBooks(
      q,
      state.remotePage,
      currentController.signal,
      getLanguage(),
      more ? state.remoteProvider : undefined,
    );
    if (controller !== currentController) return;
    const books = data.books;
    state.remote = more
      ? [...new Map([...state.remote, ...books].map((b) => [b.id, b])).values()]
      : books;
    state.remoteTotal = data.total ?? books.length;
    state.remoteHasMore = Boolean(data.hasMore);
    state.remoteProvider = data.provider;
    if (!books.length && !more) state.notice = "noResults";
    else if (data.warnings?.length) state.notice = "partialSearch";
  } catch (error) {
    if (controller !== currentController) return;
    if (more) {
      state.remotePage--;
      state.notice = "nextResultsUnavailable";
    } else {
      state.remote = getCatalogue(getLanguage()).filter((b) =>
        normal(
          [
            b.title,
            b.author,
            b.isbn,
            ...b.tags,
            ...b.tags.map(genreLabel),
          ].join(" "),
        ).includes(normal(q)),
      );
      state.remoteTotal = state.remote.length;
      state.remoteHasMore = false;
      state.notice = "searchUnavailable";
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
  state.readingStatus = "all";
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
function updateManualLabels() {
  $("#manual-title").textContent = t(editingId ? "editBook" : "addBook");
  $('#manual-form button[type="submit"]').innerHTML =
    icon(editingId ? "check" : "plus") +
    t(editingId ? "saveChanges" : "addToLibrary");
}
function refreshOpenDetail() {
  if (detailId && $("#book-dialog").open) {
    const tags = $("#personal-tags")?.value;
    showDetail(detailId, false);
    if (tags !== undefined && $("#personal-tags"))
      $("#personal-tags").value = tags;
  }
}
async function refreshSavedEditions() {
  editionController?.abort();
  const current = new AbortController();
  editionController = current;
  const language = getLanguage();
  const timeout = setTimeout(() => current.abort(), 12000);
  try {
    const changed = await loadBookEditions(saved, language, current.signal);
    if (
      changed &&
      editionController === current &&
      getLanguage() === language
    ) {
      render();
      refreshOpenDetail();
    }
  } catch {
    // Retain the saved edition when the service has no matching edition or is unavailable.
  } finally {
    clearTimeout(timeout);
  }
}
function refreshLanguage() {
  applyTranslations();
  $("#language-select").value = getLanguage();
  render();
  updateManualLabels();
  refreshOpenDetail();
  if ($("#toast").classList.contains("visible")) renderToast();
  refreshSavedEditions();
  if (
    state.page === "discover" &&
    state.remote !== null &&
    state.query &&
    state.remoteLanguage !== getLanguage()
  )
    search();
}
$("#language-select").addEventListener("change", async (event) => {
  try {
    const settings = await writeLanguage(event.target.value);
    setLanguage(settings.language);
    refreshLanguage();
  } catch {
    event.target.value = getLanguage();
    toast("languageNotSaved");
  }
});
function manualOpen(b) {
  editingId = b?.id || null;
  const form = $("#manual-form");
  form.reset();
  if (b) {
    for (const k of ["title", "author", "pages", "year", "description"])
      form.elements[k].value = b[k] || "";
    form.elements.tags.value = b.tags.join(", ");
  }
  updateManualLabels();
  openDialog("#manual-dialog");
}
document.addEventListener("click", async (e) => {
  const detail = e.target.closest("[data-detail]");
  const saveButton = e.target.closest("[data-save]");
  const nav = e.target.closest("[data-nav]");
  const genre = e.target.closest("[data-genre]");
  const readingFilter = e.target.closest("[data-reading-filter]");
  if (readingFilter) {
    state.readingStatus = readingFilter.dataset.readingFilter;
    render();
    $(
      `#reading-filters [data-reading-filter="${state.readingStatus}"]`,
    ).focus();
  }
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
    if (
      await save(saved.map((b) => (b.id === detailId ? { ...b, tags } : b)))
    ) {
      render();
      showDetail(detailId, false);
      toast("tagsSaved");
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
document.addEventListener("change", (event) => {
  if (event.target.matches("[data-reading-status]"))
    changeReadingStatus(event.target);
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
$("#manual-form").onsubmit = async (e) => {
  e.preventDefault();
  const data = new FormData(e.target);
  const title = data.get("title").trim(),
    author = data.get("author").trim();
  if (!title || !author) {
    toast("titleAuthorRequired");
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
    toast("alreadySaved");
    return;
  }
  if (
    await save(
      editingId
        ? saved.map((b) => (b.id === editingId ? book : b))
        : [...saved, book],
    )
  ) {
    $("#manual-dialog").close();
    navigate("wishlist");
    toast(editingId ? "bookUpdated" : "manualBookAdded");
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
  const page = location.hash === "#discover" ? "discover" : "wishlist";
  if (page !== state.page) navigate(page);
});
async function syncSettings() {
  try {
    const settings = await loadSettings();
    if (settings.language && settings.language !== getLanguage()) {
      setLanguage(settings.language);
      refreshLanguage();
    }
  } catch {}
}
// Refresh from the server across tabs and devices without writing browser storage.
window.addEventListener("focus", () => {
  if (!saving) {
    syncLibrary();
    syncSettings();
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !saving) {
    syncLibrary();
    syncSettings();
  }
});
setInterval(() => {
  if (!saving && !document.hidden) {
    syncLibrary();
    syncSettings();
  }
}, 3000);
hydrate();
refreshLanguage();
if (!storageOK) toast("storageUnreadable");

if (migrationFailed) toast("migrationFailed");
