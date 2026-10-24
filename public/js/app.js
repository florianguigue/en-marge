import { icon } from "./icons.js";
import { esc, normal } from "./utils.js";
const palette = [
  "#e8dfd1",
  "#dfe4d9",
  "#e9ddd0",
  "#deded5",
  "#e4ddce",
  "#e0e2d4",
  "#eadfd5",
  "#dfdbcf",
];
import { localizeBook, loadBookEditions } from "./book-editions.js";
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
  formatPublicationDate,
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
function readRoute() {
  const [page, params] = location.hash.slice(1).split("?");
  const query = new URLSearchParams(params).get("q")?.trim() || "";
  return page === "search" && query
    ? { page: "search", query }
    : { page: "wishlist", query: "" };
}
function writeRoute(page, query = "") {
  const hash =
    page === "search"
      ? `#search?${new URLSearchParams({ q: query })}`
      : "#wishlist";
  if (location.hash === hash) return;
  history[readRoute().page === page ? "replaceState" : "pushState"](
    null,
    "",
    hash,
  );
}
const initialRoute = readRoute();
let inputTimer;
let state = {
  page: initialRoute.page,
  pages: "all",
  readingStatus: "all",
  query: initialRoute.query,
  libraryQuery: "",
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
    saved.find((b) => b.id === id) || state.remote?.find((b) => b.id === id);
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
function seriesLabel(series) {
  return `${esc(series.name)}${series.position != null ? ` · ${esc(t("seriesVolume", { position: series.position }))}` : ""}`;
}
function compareTitles(a, b) {
  return a.title.localeCompare(b.title, getLocale());
}
function compareSeries(a, b) {
  const first = a.series?.[0];
  const second = b.series?.[0];
  if (!first || !second)
    return (
      Number(Boolean(second)) - Number(Boolean(first)) || compareTitles(a, b)
    );
  return (
    first.name.localeCompare(second.name, getLocale()) ||
    (first.position ?? Infinity) - (second.position ?? Infinity) ||
    compareTitles(a, b)
  );
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
      <button class="book-title" data-detail="${esc(b.id)}">${esc(bookName(b))}</button>
      <p class="book-author">${esc(bookAuthor(b))}</p>
      ${b.series?.length ? `<p class="book-series">${esc(t("series"))} : ${b.series.map(seriesLabel).join("<br>")}</p>` : ""}
      <div class="book-meta"><span>${b.pages ? pageCount(b.pages) : t("pagesUnknown")}</span>${b.publishedDate || b.year ? `<span>${esc(formatPublicationDate(b))}</span>` : ""}</div>
      ${b.originalEdition ? `<span class="book-edition-note">${t(b.language ? "originalEdition" : "editionLanguageUnknown")}</span>` : ""}
      ${state.page === "wishlist" ? readingStatusControl(b) : ""}
    </div>
  </article>`;
}
function sourceBooks() {
  const language = getLanguage();
  return (state.page === "wishlist" ? saved : state.remote || []).map(
    (book) => ({
      ...localizeBook(book, language),
      ...metadataDetails.get(`${book.id}:${language}`),
    }),
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
      state.libraryQuery &&
      !normal(
        [
          b.title,
          b.author,
          b.isbn,
          ...(b.series || []).map((series) => series.name),
        ].join(" "),
      ).includes(normal(state.libraryQuery))
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
  if (state.sort === "series") books.sort(compareSeries);
  if (state.sort === "status") {
    const statuses = Object.keys(READING_STATUSES);
    books.sort(
      (a, b) =>
        statuses.indexOf(normalizeReadingStatus(a.status)) -
          statuses.indexOf(normalizeReadingStatus(b.status)) ||
        compareTitles(a, b),
    );
  }
  if (state.sort === "default" && state.page === "wishlist")
    books.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  return books;
}
function render() {
  const wish = state.page === "wishlist";
  $(".collection").setAttribute(
    "aria-label",
    wish ? t("library") : t("searchResults"),
  );
  $("#collection-title").textContent = wish ? t("library") : t("searchResults");
  $("#search-query").hidden = wish;
  $("#search-query").textContent = wish
    ? ""
    : t("searchFor", { query: state.query });
  $("#library-filter").hidden = !wish;
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
    : t("relevance");
  $('#sort option[value="status"]').hidden = !wish;
  renderReadingFilters();
  const books = filtered();
  const booksLabel = bookCount(books.length);
  $("#result-count").textContent = state.busy
    ? t("searching")
    : wish
      ? t("inLibrary", { books: booksLabel })
      : t(pluralKey("remoteCount", books.length), {
          books: booksLabel,
          total: formatNumber(state.remoteTotal),
        });
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
        <button class="primary" id="empty-action">${t(emptyLibrary ? "searchBook" : state.notice === "searchUnavailable" ? "retrySearch" : "resetFilters")} ${icon("arrow")}</button>
      </div>`;
  $("#load-more").hidden =
    wish || !state.remote || !state.remoteHasMore || state.busy;
  $("#search-form button[type=submit]").disabled = !$("#search").value.trim();
  $("#books").setAttribute("aria-busy", String(state.busy));
  bindImageFallback();
}
function navigate(page = "wishlist") {
  clearTimeout(inputTimer);
  controller?.abort();
  controller = null;
  state = {
    ...state,
    page,
    query: "",
    libraryQuery: "",
    pages: "all",
    readingStatus: "all",
    sort: "default",
    remote: null,
    remoteTotal: 0,
    notice: "",
    busy: false,
  };
  $("#search").value = "";
  $("#library-search").value = "";
  $("#sort").value = "default";
  $("#pages-filter").value = "all";
  writeRoute(page);
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
      <dl class="detail-facts">
        <div><dt>${t("pageNumber")}</dt><dd>${b.pages ? pageCount(b.pages) : t("notProvided")}</dd></div>
        <div><dt>${t("publicationDate")}</dt><dd>${esc(formatPublicationDate(b))}</dd></div>
        <div><dt>ISBN</dt><dd>${esc(b.isbn || t("notProvided"))}</dd></div>
        <div><dt>${t("publisher")}</dt><dd>${esc(b.publisher || t("notProvided"))}</dd></div>
        ${b.series?.length ? `<div class="detail-series"><dt>${t("series")}</dt><dd>${b.series.map(seriesLabel).join("<br>")}</dd></div>` : ""}
      </dl>
      <h3>${t("aboutBook")}</h3><p class="description" id="detail-description">${esc(b.description || t("noSummary"))}</p>
      ${added ? readingStatusControl(localizeBook(findSaved(b), getLanguage())) : ""}
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
      series: details.series?.length ? details.series : b.series,
      sources: details.sources,
      provenance: details.provenance,
      externalIds: { ...b.externalIds, ...details.externalIds },
      ...(sameEdition
        ? {
            pages: b.pages || details.pages,
            publisher: b.publisher || details.publisher,
            year: b.year || details.year,
            publishedDate:
              details.publishedDate?.length > (b.publishedDate?.length || 0)
                ? details.publishedDate
                : b.publishedDate,
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
    if (getLanguage() === language) {
      render();
      if (detailId === b.id && $("#book-dialog").open) refreshOpenDetail();
    }
  } catch {}
}
async function search(more = false) {
  clearTimeout(inputTimer);
  const q = $("#search").value.trim();
  if (!q) {
    navigate("wishlist");
    return;
  }
  if (state.page !== "search") {
    state.pages = "all";
    state.readingStatus = "all";
    state.sort = "default";
    $("#sort").value = "default";
    $("#pages-filter").value = "all";
  }
  state.page = "search";
  writeRoute("search", q);
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
      state.remote = [];
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
  state.pages = "all";
  $("#pages-filter").value = "all";
  state.libraryQuery = "";
  $("#library-search").value = "";
  render();
}
function updateManualLabels() {
  $("#manual-title").textContent = t(editingId ? "editBook" : "addBook");
  $('#manual-form button[type="submit"]').innerHTML =
    icon(editingId ? "check" : "plus") +
    t(editingId ? "saveChanges" : "addToLibrary");
}
function refreshOpenDetail() {
  if (detailId && $("#book-dialog").open) showDetail(detailId, false);
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
    state.page === "search" &&
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
    for (const k of [
      "title",
      "author",
      "pages",
      "publishedDate",
      "description",
    ])
      form.elements[k].value = b[k] || "";
    form.elements.series.value = b.series?.[0]?.name || "";
    form.elements.seriesPosition.value = b.series?.[0]?.position ?? "";
  }
  updateManualLabels();
  openDialog("#manual-dialog");
}
document.addEventListener("click", async (e) => {
  const detail = e.target.closest("[data-detail]");
  const saveButton = e.target.closest("[data-save]");
  const nav = e.target.closest("[data-nav]");
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
  if (e.target.closest(".close-dialog")) e.target.closest("dialog").close();
  if (e.target.closest("#empty-action")) {
    if (state.page === "wishlist" && !saved.length) $("#search").focus();
    else if (state.notice === "searchUnavailable") search();
    else resetFilters();
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
$("#search").addEventListener("input", () => {
  clearTimeout(inputTimer);
  controller?.abort();
  controller = null;
  const query = $("#search").value.trim();
  if (!query) {
    navigate("wishlist");
    return;
  }
  if (state.page !== "search") {
    state.pages = "all";
    state.readingStatus = "all";
    state.sort = "default";
    $("#sort").value = "default";
    $("#pages-filter").value = "all";
  }
  state.page = "search";
  state.query = query;
  state.remote = [];
  state.remoteTotal = 0;
  state.remoteHasMore = false;
  state.busy = true;
  state.notice = "";
  writeRoute("search", query);
  render();
  inputTimer = setTimeout(() => search(), 350);
});
$("#library-search").addEventListener("input", () => {
  state.libraryQuery = $("#library-search").value.trim();
  render();
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
  const publishedDate = data.get("publishedDate");
  const series = data.get("series").trim();
  const position = data.get("seriesPosition");
  const book = {
    ...(old || {}),
    id: editingId || "manual:" + crypto.randomUUID(),
    title,
    author,
    pages: Number(data.get("pages")) || null,
    publishedDate:
      publishedDate ||
      (/^\d{4}(?:-\d{2})?$/.test(old?.publishedDate || "")
        ? old.publishedDate
        : null),
    year: publishedDate
      ? Number(publishedDate.slice(0, 4))
      : /^\d{4}-\d{2}-\d{2}$/.test(old?.publishedDate || "")
        ? null
        : old?.year || null,
    tags: old?.tags || [],
    series: series
      ? [
          { name: series, position: position === "" ? null : Number(position) },
          ...(old?.series?.slice(1) || []),
        ]
      : [],
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
function restoreRoute() {
  const route = readRoute();
  if (
    route.page === "wishlist" &&
    location.hash &&
    location.hash !== "#wishlist"
  )
    history.replaceState(null, "", "#wishlist");
  if (route.page === state.page && route.query === state.query) return;
  if (route.page === "wishlist") navigate("wishlist");
  else {
    $("#search").value = route.query;
    search();
  }
}
window.addEventListener("hashchange", restoreRoute);
window.addEventListener("popstate", restoreRoute);
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
$("#search").value = state.query;
if (
  location.hash &&
  initialRoute.page === "wishlist" &&
  location.hash !== "#wishlist"
)
  history.replaceState(null, "", "#wishlist");
hydrate();
refreshLanguage();
if (!storageOK) toast("storageUnreadable");

if (migrationFailed) toast("migrationFailed");
