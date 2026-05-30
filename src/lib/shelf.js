const SHELF_EVENT = "liber-shelf";
const READING_KEY = "liber.shelf.reading";

function safeReadIds(key) {
  try {
    const ids = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id) : [];
  } catch {
    return [];
  }
}

function writeIds(key, ids) {
  localStorage.setItem(key, JSON.stringify([...new Set(ids)]));
  window.dispatchEvent(new CustomEvent(SHELF_EVENT));
}

export function getShelfReadingIds() {
  if (typeof localStorage === "undefined") return [];
  return safeReadIds(READING_KEY);
}

export function addShelfBook(bookId) {
  if (!bookId || typeof localStorage === "undefined") return;
  writeIds(READING_KEY, [bookId, ...getShelfReadingIds()]);
}

export function subscribeShelf(listener) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SHELF_EVENT, listener);
  return () => window.removeEventListener(SHELF_EVENT, listener);
}

export function shelfReadingEntries(seedReading, catalog) {
  const books = Array.isArray(catalog) ? catalog : [];
  const byId = (id) => books.find((book) => book.id === id);
  const seen = new Set();
  const localRows = getShelfReadingIds()
    .map((id) => byId(id))
    .filter(Boolean)
    .map((book) => ({ ...book, at: "未开始 · 0%" }));
  const seedRows = (Array.isArray(seedReading) ? seedReading : [])
    .map((row) => {
      const book = byId(row.id);
      return book ? { ...book, at: row.at || "未开始 · 0%" } : null;
    })
    .filter(Boolean);
  const rows = [...localRows, ...seedRows].filter((book) => !seen.has(book.id) && seen.add(book.id));
  if (rows.length) return rows;

  const liveBooks = books.filter((book) => book.dynamic);
  return liveBooks.map((book) => ({ ...book, at: "未开始 · 0%" }));
}

export function shelfCollections(seedCollections, catalog) {
  const liveBooks = (Array.isArray(catalog) ? catalog : []).filter((book) => book.dynamic);
  if (liveBooks.length) {
    return [{
      id: "live-library",
      name: "已入库公版书",
      desc: "来自真实入库内容",
      books: liveBooks.map((book) => book.id),
      color: "ink",
    }];
  }
  return Array.isArray(seedCollections) ? seedCollections : [];
}
