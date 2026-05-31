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

export async function ensureGuestSession() {
  if (getToken()) return null;
  return api.auth.guest();
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
const del = (p) => req("DELETE", p);

export const api = {
  get, post, put, del,
  health: () => get("/health"),

  auth: {
    guest: async () => { const r = await post("/auth/guest"); if (r?.token) setToken(r.token); return r; },
    me: () => get("/auth/me"),
    logout: async () => { try { await post("/auth/logout"); } finally { setToken(null); } },
    nonce: () => post("/auth/nonce"),
    verify: (payload) => post("/auth/verify", payload),
    googleConfig: () => get("/auth/google/config"),
    google: (credential) => post("/auth/google", { credential }),
    passkey: {
      registerOptions: () => post("/auth/passkey/register/options"),
      registerVerify: (response) => post("/auth/passkey/register/verify", { response }),
      loginOptions: () => post("/auth/passkey/login/options"),
      loginVerify: (response) => post("/auth/passkey/login/verify", { response }),
    },
    updateMe: (payload) => put("/auth/me", payload),
    cliStart: () => post("/auth/cli/start"),
    cliPoll: (deviceCode) => get(`/auth/cli/poll/${encodeURIComponent(deviceCode)}`),
    cliApprove: (deviceCode) => post("/auth/cli/approve", { deviceCode }),
  },

  books: {
    list: (query = "") => get("/books" + query),
    get: (id) => get(`/books/${id}`),
    chapters: (id) => get(`/books/${id}/chapters`),
    content: (id, n) => get(`/books/${id}/content/${n}`),
    proof: (id) => get(`/books/${id}/proof`),
    ingest: (payload) => post("/books/ingest", payload),
  },
  search: (q) => get(`/search?q=${encodeURIComponent(q)}`),

  reading: {
    summary: () => get("/reading/summary"),
    get: (bookId) => get(`/reading/${bookId}`),
    highlight: (bookId, sid, color) => put(`/reading/${bookId}/highlight`, { sid, color }),
    note: (bookId, sid, text, isPublic = true) => post(`/reading/${bookId}/note`, { sid, text, public: isPublic }),
    progress: (bookId, chapterN, percent) => put(`/reading/${bookId}/progress`, { chapter_n: chapterN, percent }),
  },

  // 书单 (booklists): user-curated, D1-backed, shareable + forkable.
  booklists: {
    list: (bookId) => get("/booklists" + (bookId ? `?bookId=${encodeURIComponent(bookId)}` : "")),
    get: (id) => get(`/booklists/${id}`),
    create: (payload) => post("/booklists", payload),
    update: (id, payload) => put(`/booklists/${id}`, payload),
    remove: (id) => del(`/booklists/${id}`),
    addItem: (id, bookId, note) => post(`/booklists/${id}/items`, { bookId, note }),
    removeItem: (id, bookId) => del(`/booklists/${id}/items/${encodeURIComponent(bookId)}`),
    fork: (id) => post(`/booklists/${id}/fork`),
    save: (id) => post(`/booklists/${id}/save`),
  },

  annotations: (bookId, sid) => get(`/annotations/${bookId}/${sid}`),
  feed: () => get("/feed"),

  readers: {
    list: () => get("/readers"),
    get: (id) => get(`/readers/${encodeURIComponent(id)}`),
    following: () => get("/readers/following"),
    follow: (id) => post(`/readers/${encodeURIComponent(id)}/follow`),
  },

  shares: {
    list: () => get("/shares"),
    publish: (payload) => post("/shares", payload),
    save: (id) => post(`/shares/${id}/save`),
  },

  // generic comments + votes (target type: 'share' | 'work' | 'book' | …)
  comments: {
    list: (type, id) => get(`/comments/${type}/${id}`),
    add: (type, id, text) => post(`/comments/${type}/${id}`, { text }),
  },
  vote: (type, id) => post(`/vote/${type}/${id}`),
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
  // 私信 (direct messages between readers)
  messages: {
    threads: () => get("/messages/threads"),
    unread: () => get("/messages/unread"),
    with: (userId) => get(`/messages/with/${encodeURIComponent(userId)}`),
    send: (userId, text, quote) => post(`/messages/with/${encodeURIComponent(userId)}`, { text, quote }),
  },
  // 通知 (notifications feed)
  notifications: {
    list: () => get("/notifications"),
    unread: () => get("/notifications/unread"),
    readAll: () => post("/notifications/read"),
    read: (id) => post(`/notifications/${encodeURIComponent(id)}/read`),
  },
  works: {
    list: () => get("/works"),
    publish: (title, body) => post("/works", { title, body }),
  },

  ai: {
    chat: (payload) => post("/ai/chat", payload),
    usage: () => get("/ai/usage"),
    conversations: () => get("/ai/conversations"),
    conversation: (id) => get(`/ai/conversations/${id}`),
    correctTranslation: (cacheKey, translatedText) => put(`/ai/translations/${encodeURIComponent(cacheKey)}`, { translatedText }),
  },

  platform: {
    status: () => get("/platform/status"),
    semanticSearch: (q, limit = 8) => get(`/platform/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`),
    jobs: (status = "") => get("/platform/jobs" + (status ? `?status=${encodeURIComponent(status)}` : "")),
    enqueue: (payload) => post("/platform/jobs", payload),
    drain: (limit = 5) => post("/platform/jobs/drain", { limit }),
    indexBook: (id) => post(`/platform/index/book/${encodeURIComponent(id)}`),
    renderShareCard: (payload) => post("/platform/render/share-card", payload),
  },

  billing: {
    plan: () => get("/billing/plan"),
    cryptoConfig: () => get("/billing/crypto/config"),
    confirmCrypto: (digest) => post("/billing/crypto/confirm", { digest }),
    checkout: () => post("/billing/checkout"),
  },

  charts: (window = "today") => get(`/charts?window=${window}`),
  mcp: { manifest: () => get("/mcp"), call: (tool, args) => post("/mcp/call", { tool, args }) },

  // Knowledge graph (living cross-book echoes). stats/map are open + read-only;
  // backfill/maintenance are publish-gated. Callers should fall back to the seed
  // ECHOES when these reject (static deploy / offline).
  graph: {
    stats: () => get("/graph/stats"),
    map: (limit = 400) => get(`/graph/map?limit=${limit}`),
    echoes: (sid) => post("/mcp/call", { tool: "get_echoes", args: { sid } }),
  },
};

export default api;
