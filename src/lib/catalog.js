// Catalog state is backed by a TanStack Store (one reactive primitive, replacing the
// hand-rolled CustomEvent pub-sub). The public API (getCatalogBooks / setCatalogBooks /
// subscribeCatalog / …) is unchanged, so the ~18 consumers don't change. `catalogStore`
// is exported for new code that wants reactive reads via useStore(catalogStore, sel).
import { Store } from "@tanstack/store";

export const catalogStore = new Store({ books: null, total: null, loaded: false });
let seedBooksCache = null;
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

export function getCatalogBooks() {
  return catalogStore.state.books ?? seedBooks();
}

export function getCatalogTotal() {
  return catalogStore.state.total ?? getCatalogBooks().length;
}

export function setCatalogBooks(books, total = null) {
  const cleaned = cleanBooks(books);
  const t = Number.isFinite(total) ? total : cleaned.length;
  catalogStore.setState((p) => ({ ...p, books: cleaned, total: t, loaded: true }));
  if (typeof window !== "undefined") {
    window.BOOKS = cleaned;
    window.LIBER_CATALOG_TOTAL = t;
  }
  return cleaned;
}

export async function loadCatalogBooks() {
  if (inFlight) return inFlight;
  const api = typeof window !== "undefined" ? window.liberApi : null;
  if (!api?.books?.list) {
    catalogStore.setState((p) => ({ ...p, loaded: true }));
    return getCatalogBooks();
  }
  inFlight = api.books.list()
    .then((res) => setCatalogBooks(res?.books || [], Number(res?.total)))
    .catch(() => { catalogStore.setState((p) => ({ ...p, loaded: true })); return getCatalogBooks(); })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function subscribeCatalog(listener) {
  if (typeof window === "undefined") return () => {};
  let last; // notify only when the books array actually changes (not on a loaded-toggle)
  const sub = catalogStore.subscribe(() => {
    const books = getCatalogBooks();
    if (books === last) return;
    last = books;
    listener(books, { books, total: getCatalogTotal(), loaded: catalogStore.state.loaded });
  });
  return () => sub.unsubscribe();
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
