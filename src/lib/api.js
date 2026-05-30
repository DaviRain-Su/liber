// Liber API client — same-origin /api, bearer token persisted in localStorage.
// Designed to DEGRADE GRACEFULLY: callers should catch and fall back to the
// seed data / localStorage when a method rejects (e.g. a static Pages-only
// deploy with no backend, or offline). The frontend rewire (P5) wires these in.

const BASE = "/api";
const TOKEN_KEY = "liber.token";

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

async function req(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    credentials: "include",
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* non-JSON */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

const get = (p) => req("GET", p);
const post = (p, b) => req("POST", p, b);
const put = (p, b) => req("PUT", p, b);

export const api = {
  get, post, put,
  health: () => get("/health"),

  auth: {
    guest: async () => { const r = await post("/auth/guest"); if (r?.token) setToken(r.token); return r; },
    me: () => get("/auth/me"),
    logout: async () => { try { await post("/auth/logout"); } finally { setToken(null); } },
    nonce: () => post("/auth/nonce"),
    verify: (payload) => post("/auth/verify", payload),
  },

  books: {
    list: (query = "") => get("/books" + query),
    get: (id) => get(`/books/${id}`),
    chapters: (id) => get(`/books/${id}/chapters`),
    proof: (id) => get(`/books/${id}/proof`),
  },
  search: (q) => get(`/search?q=${encodeURIComponent(q)}`),

  reading: {
    get: (bookId) => get(`/reading/${bookId}`),
    highlight: (bookId, sid, color) => put(`/reading/${bookId}/highlight`, { sid, color }),
    note: (bookId, sid, text, isPublic = true) => post(`/reading/${bookId}/note`, { sid, text, public: isPublic }),
    progress: (bookId, chapterN, percent) => put(`/reading/${bookId}/progress`, { chapter_n: chapterN, percent }),
  },

  annotations: (bookId, sid) => get(`/annotations/${bookId}/${sid}`),
  feed: () => get("/feed"),

  shares: {
    list: () => get("/shares"),
    publish: (payload) => post("/shares", payload),
    save: (id) => post(`/shares/${id}/save`),
  },
  groups: {
    list: () => get("/groups"),
    get: (id) => get(`/groups/${id}`),
    join: (id) => post(`/groups/${id}/join`),
    post: (id, text, chap) => post(`/groups/${id}/posts`, { text, chap }),
  },
  thread: {
    get: (key) => get(`/threads/${encodeURIComponent(key)}`),
    reply: (key, text) => post(`/threads/${encodeURIComponent(key)}`, { text }),
  },
  works: {
    list: () => get("/works"),
    publish: (title, body) => post("/works", { title, body }),
  },

  ai: {
    chat: (payload) => post("/ai/chat", payload),
    conversations: () => get("/ai/conversations"),
    conversation: (id) => get(`/ai/conversations/${id}`),
  },

  charts: (window = "today") => get(`/charts?window=${window}`),
  mcp: { manifest: () => get("/mcp"), call: (tool, args) => post("/mcp/call", { tool, args }) },
};

export default api;
