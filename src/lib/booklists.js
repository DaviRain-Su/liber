// 书单 (booklists) store — backend-first (D1 via /api/booklists), with a
// localStorage fallback so the static / offline / signed-out preview still
// works. Components call these helpers and subscribe to `liber-booklists`.

const EVENT = "liber-booklists";
const LOCAL_KEY = "liber.booklists";

function api() {
  return (typeof window !== "undefined" && window.liberApi) || null;
}
function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}
function isLocalId(id) {
  return typeof id === "string" && id.startsWith("bl_local_");
}

export function subscribeBooklists(listener) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/* ---- localStorage fallback ---- */
function readLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeLocal(lists) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(lists)); } catch { /* ignore */ }
  emit();
}
function localId() {
  return "bl_local_" + Math.random().toString(36).slice(2, 10);
}
function normalizeLocal(l) {
  const books = Array.isArray(l.books) ? l.books : [];
  return {
    id: l.id,
    name: l.name,
    desc: l.desc || "",
    color: l.color || "ink",
    visibility: "private",
    books,
    items: books.map((b) => ({ bookId: b, note: "", title: null })),
    count: books.length,
    mine: true,
    local: true,
  };
}

/* ---- public API (always async, never throws) ---- */
export async function loadMyBooklists(bookId) {
  const a = api();
  if (a?.booklists?.list && a?.auth) {
    try {
      const r = await a.booklists.list(bookId);
      const lists = r?.booklists || [];
      return lists.map((l) => (bookId ? { ...l, has: !!l.has } : l));
    } catch { /* fall through to local */ }
  }
  const local = readLocal().map(normalizeLocal);
  if (bookId) local.forEach((l) => { l.has = l.books.includes(bookId); });
  return local;
}

export async function createBooklist({ name, desc = "", color = "ink", bookId = null }) {
  const a = api();
  if (a?.booklists?.create) {
    try {
      const r = await a.booklists.create({ name, desc, color, bookId });
      emit();
      if (r?.booklist) return r.booklist;
    } catch { /* fall through to local */ }
  }
  const lists = readLocal();
  const l = { id: localId(), name, desc, color, books: bookId ? [bookId] : [] };
  lists.unshift(l);
  writeLocal(lists);
  return normalizeLocal(l);
}

export async function deleteBooklist(listId) {
  const a = api();
  if (a?.booklists?.remove && !isLocalId(listId)) {
    try { await a.booklists.remove(listId); emit(); return; } catch { /* fall through */ }
  }
  writeLocal(readLocal().filter((l) => l.id !== listId));
}

export async function renameBooklist(listId, name, desc) {
  const a = api();
  if (a?.booklists?.update && !isLocalId(listId)) {
    try { await a.booklists.update(listId, { name, desc }); emit(); return; } catch { /* fall through */ }
  }
  const lists = readLocal();
  const l = lists.find((x) => x.id === listId);
  if (l) { l.name = name; if (desc != null) l.desc = desc; writeLocal(lists); }
}

export async function addBookToBooklist(listId, bookId) {
  const a = api();
  if (a?.booklists?.addItem && !isLocalId(listId)) {
    try { await a.booklists.addItem(listId, bookId); emit(); return; } catch { /* fall through */ }
  }
  const lists = readLocal();
  const l = lists.find((x) => x.id === listId);
  if (l) {
    l.books = Array.isArray(l.books) ? l.books : [];
    if (!l.books.includes(bookId)) { l.books.unshift(bookId); writeLocal(lists); }
  }
}

export async function removeBookFromBooklist(listId, bookId) {
  const a = api();
  if (a?.booklists?.removeItem && !isLocalId(listId)) {
    try { await a.booklists.removeItem(listId, bookId); emit(); return; } catch { /* fall through */ }
  }
  const lists = readLocal();
  const l = lists.find((x) => x.id === listId);
  if (l) { l.books = (l.books || []).filter((b) => b !== bookId); writeLocal(lists); }
}

export async function getBooklist(listId) {
  const a = api();
  if (a?.booklists?.get && !isLocalId(listId)) {
    try { const r = await a.booklists.get(listId); if (r?.booklist) return r.booklist; } catch { /* fall through */ }
  }
  const l = readLocal().find((x) => x.id === listId);
  return l ? normalizeLocal(l) : null;
}

export async function forkBooklist(listId) {
  const a = api();
  if (a?.booklists?.fork) {
    try { const r = await a.booklists.fork(listId); emit(); return r?.id || null; } catch { /* ignore */ }
  }
  return null;
}

export async function toggleSaveBooklist(listId) {
  const a = api();
  if (a?.booklists?.save) {
    try { const r = await a.booklists.save(listId); emit(); return r?.saved; } catch { /* ignore */ }
  }
  return null;
}
