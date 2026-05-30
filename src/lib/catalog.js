const CATALOG_EVENT = "liber-catalog";

let seedBooksCache = null;
let catalogBooks = null;
let catalogTotal = null;
let loaded = false;
let inFlight = null;

function seedBooks() {
  if (seedBooksCache) return seedBooksCache;
  seedBooksCache = typeof window !== "undefined" && Array.isArray(window.BOOKS)
    ? [...window.BOOKS]
    : [];
  return seedBooksCache;
}

function cleanBooks(books) {
  const seen = new Set();
  return (Array.isArray(books) ? books : [])
    .filter((book) => book && book.id && !seen.has(book.id) && seen.add(book.id));
}

function emitCatalog() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CATALOG_EVENT, {
    detail: { books: getCatalogBooks(), total: getCatalogTotal(), loaded },
  }));
}

export function getCatalogBooks() {
  if (catalogBooks) return catalogBooks;
  catalogBooks = seedBooks();
  return catalogBooks;
}

export function getCatalogTotal() {
  return catalogTotal ?? getCatalogBooks().length;
}

export function setCatalogBooks(books, total = null) {
  catalogBooks = cleanBooks(books);
  catalogTotal = Number.isFinite(total) ? total : catalogBooks.length;
  loaded = true;
  if (typeof window !== "undefined") {
    window.BOOKS = catalogBooks;
    window.LIBER_CATALOG_TOTAL = catalogTotal;
  }
  emitCatalog();
  return catalogBooks;
}

export async function loadCatalogBooks() {
  if (inFlight) return inFlight;
  const api = typeof window !== "undefined" ? window.liberApi : null;
  if (!api?.books?.list) {
    loaded = true;
    emitCatalog();
    return getCatalogBooks();
  }
  inFlight = api.books.list()
    .then((res) => setCatalogBooks(res?.books || [], Number(res?.total)))
    .catch(() => {
      loaded = true;
      emitCatalog();
      return getCatalogBooks();
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function subscribeCatalog(listener) {
  if (typeof window === "undefined") return () => {};
  const onCatalog = (event) => listener(event.detail?.books || getCatalogBooks(), event.detail || {});
  window.addEventListener(CATALOG_EVENT, onCatalog);
  return () => window.removeEventListener(CATALOG_EVENT, onCatalog);
}

export function findCatalogBook(bookId) {
  return getCatalogBooks().find((book) => book.id === bookId);
}

export function catalogHasLiveBooks() {
  return getCatalogBooks().some((book) => book.dynamic);
}

export function licenseLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "CC0-1.0";
  if (/public[-\s]?domain/i.test(raw)) return "Public Domain";
  if (/^cc0/i.test(raw)) return "CC0-1.0";
  return raw;
}
