import React from "react";
import { Cover, I } from "./product-shared.jsx";
import { findCatalogBook, getCatalogBooks, subscribeCatalog } from "../lib/catalog.js";
import {
  loadMyBooklists,
  createBooklist,
  deleteBooklist,
  renameBooklist,
  addBookToBooklist,
  removeBookFromBooklist,
  getBooklist,
  forkBooklist,
  toggleSaveBooklist,
  subscribeBooklists,
} from "../lib/booklists.js";

/* product-booklist.jsx — the 书单 detail screen plus two reusable pickers:
   <AddToBooklist> (add the current book to one of your lists) and <BookPicker>
   (add catalogue books to the current list). Backed by /api/booklists with a
   localStorage fallback (see lib/booklists.js). */
const { useState: useS, useEffect: useE } = React;

function resolveBook(catalog, id) {
  return (
    catalog.find((b) => b.id === id) ||
    findCatalogBook(id) || { id, t: id, a: "", sub: "", cls: "ink", seal: "书" }
  );
}

/* ---- "加入书单" popup, opened from book detail / library cards ---- */
function AddToBooklist({ bookId, onClose }) {
  const [lists, setLists] = useS(null);
  const [creating, setCreating] = useS(false);
  const [name, setName] = useS("");
  const [busy, setBusy] = useS(false);

  const refresh = () => loadMyBooklists(bookId).then(setLists);
  useE(() => {
    refresh();
    const off = subscribeBooklists(refresh);
    return off;
  }, [bookId]);

  const toggle = async (l) => {
    setBusy(true);
    if (l.has) await removeBookFromBooklist(l.id, bookId);
    else await addBookToBooklist(l.id, bookId);
    await refresh();
    setBusy(false);
  };
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    await createBooklist({ name: n, bookId });
    setName("");
    setCreating(false);
    await refresh();
    setBusy(false);
  };

  return (
    <div className="bl-pop-scrim" onClick={onClose}>
      <div className="bl-pop" onClick={(e) => e.stopPropagation()}>
        <div className="bl-pop-h">
          <span>加入书单</span>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            {I.x}
          </button>
        </div>
        <div className="bl-pop-list">
          {lists == null && <div className="bl-pop-empty">加载中…</div>}
          {lists && lists.length === 0 && !creating && (
            <div className="bl-pop-empty">你还没有书单。新建一个，把这本书放进去。</div>
          )}
          {lists &&
            lists.map((l) => (
              <button
                key={l.id}
                className={"bl-pop-row" + (l.has ? " on" : "")}
                disabled={busy}
                onClick={() => toggle(l)}
              >
                <span className="bl-check">{l.has ? "✓" : "＋"}</span>
                <span className="bl-pop-name">{l.name}</span>
                <span className="bl-pop-n">{l.count} 本</span>
              </button>
            ))}
        </div>
        {creating ? (
          <div className="bl-pop-create">
            <input
              autoFocus
              placeholder="新书单名称…"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
            />
            <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={create}>
              创建
            </button>
          </div>
        ) : (
          <button className="btn btn-ghost btn-block" onClick={() => setCreating(true)}>
            ＋ 新建书单
          </button>
        )}
      </div>
    </div>
  );
}

/* ---- catalogue picker: add books to the current list ---- */
function BookPicker({ listId, existing, onClose }) {
  const [q, setQ] = useS("");
  const [catalog, setCatalog] = useS(() => getCatalogBooks());
  useE(() => {
    const off = subscribeCatalog((b) => setCatalog(b));
    return off;
  }, []);
  const has = new Set(existing || []);
  const term = q.trim().toLowerCase();
  const list = catalog
    .filter((b) => {
      if (!term) return true;
      return [b.t, b.a, b.sub].some((s) =>
        String(s || "")
          .toLowerCase()
          .includes(term),
      );
    })
    .slice(0, 60);

  return (
    <div className="bl-pop-scrim" onClick={onClose}>
      <div className="bl-pop bl-pop-wide" onClick={(e) => e.stopPropagation()}>
        <div className="bl-pop-h">
          <span>添加书籍</span>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            {I.x}
          </button>
        </div>
        <input
          className="bl-search"
          autoFocus
          placeholder="搜书名、作者…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="bl-pick-grid">
          {list.map((b) => (
            <button
              key={b.id}
              className={"bl-pick" + (has.has(b.id) ? " on" : "")}
              disabled={has.has(b.id)}
              onClick={() => addBookToBooklist(listId, b.id)}
            >
              <Cover book={b} />
              <span className="bl-pick-t">{b.t}</span>
              <span className="bl-pick-add">{has.has(b.id) ? "✓ 已在书单" : "＋ 加入"}</span>
            </button>
          ))}
          {!list.length && <div className="bl-pop-empty">没有匹配的书。</div>}
        </div>
      </div>
    </div>
  );
}

/* ---- the 书单 detail screen ---- */
function Booklist({ listId, onBack, onOpenBook }) {
  const [list, setList] = useS(null);
  const [loading, setLoading] = useS(true);
  const [catalog, setCatalog] = useS(() => getCatalogBooks());
  const [adding, setAdding] = useS(false);
  const [editing, setEditing] = useS(false);
  const [nameDraft, setNameDraft] = useS("");
  const [copied, setCopied] = useS(false);
  const [saved, setSaved] = useS(false);

  const refresh = () =>
    getBooklist(listId).then((l) => {
      setList(l);
      setSaved(!!l?.saved);
      setLoading(false);
    });
  useE(() => {
    setLoading(true);
    refresh();
    const off = subscribeBooklists(refresh);
    return off;
  }, [listId]);
  useE(() => {
    const off = subscribeCatalog((b) => setCatalog(b));
    return off;
  }, []);

  const mine = !!list?.mine;
  const books = list ? (list.books || []).map((id) => resolveBook(catalog, id)) : [];

  const startEdit = () => {
    setNameDraft(list?.name || "");
    setEditing(true);
  };
  const saveEdit = async () => {
    const n = nameDraft.trim();
    if (n) await renameBooklist(listId, n);
    setEditing(false);
    await refresh();
  };
  const remove = async (bookId) => {
    await removeBookFromBooklist(listId, bookId);
    await refresh();
  };
  const onDelete = async () => {
    await deleteBooklist(listId);
    onBack();
  };
  const onFork = async () => {
    const id = await forkBooklist(listId);
    if (id) onBack();
  };
  const onSave = async () => {
    const s = await toggleSaveBooklist(listId);
    if (s != null) setSaved(s);
  };
  const copyLink = () => {
    try {
      const url = `${location.origin}${location.pathname}?booklist=${encodeURIComponent(listId)}`;
      navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  if (loading && !list) {
    return (
      <div className="app-screen">
        <div className="bl-screen">
          <div className="bl-wrap">
            <div className="bl-empty">加载中…</div>
          </div>
        </div>
      </div>
    );
  }
  if (!list) {
    return (
      <div className="app-screen">
        <div className="bl-screen">
          <div className="bl-wrap">
            <div className="crumb">
              <a onClick={onBack}>我的书架</a> <span>/</span>{" "}
              <span style={{ color: "var(--ink)" }}>书单</span>
            </div>
            <div className="bl-empty">没有找到这个书单，它可能已被删除或未公开。</div>
            <button className="btn btn-ghost" onClick={onBack}>
              ← 返回
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-screen">
      <div className="bl-screen">
        <div className="bl-wrap">
          <div className="crumb">
            <a onClick={onBack}>我的书架</a> <span>/</span>
            <span style={{ color: "var(--ink)" }}>书单</span>
          </div>

          <div className="bl-head">
            <div className={`bl-spine ${list.color || "ink"}`}>{books[0]?.seal || "单"}</div>
            <div className="bl-head-mid">
              {editing ? (
                <div className="bl-edit">
                  <input
                    autoFocus
                    value={nameDraft}
                    maxLength={40}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit();
                      if (e.key === "Escape") setEditing(false);
                    }}
                  />
                  <button className="btn btn-primary" onClick={saveEdit}>
                    保存
                  </button>
                  <button className="btn btn-ghost" onClick={() => setEditing(false)}>
                    取消
                  </button>
                </div>
              ) : (
                <h1 className="bl-title">{list.name}</h1>
              )}
              {list.desc && <p className="bl-desc">{list.desc}</p>}
              <div className="bl-meta">
                <span>{list.count} 本</span>
                <span>· {list.owner?.name || "读者"} 创建</span>
                {list.visibility === "private" && <span>· 私密</span>}
                {list.forkedFrom && <span>· 来自 fork</span>}
              </div>
            </div>
          </div>

          <div className="bl-actions">
            {mine ? (
              <>
                <button className="btn btn-primary" onClick={() => setAdding(true)}>
                  ＋ 添加书籍
                </button>
                {!editing && (
                  <button className="btn btn-ghost" onClick={startEdit}>
                    重命名
                  </button>
                )}
                <button className="btn btn-ghost" onClick={copyLink}>
                  {copied ? "已复制链接 ✓" : "复制书单链接"}
                </button>
                <button className="btn btn-ghost bl-danger" onClick={onDelete}>
                  删除书单
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" onClick={onFork}>
                  Fork 到我的书单
                </button>
                <button className="btn btn-ghost" onClick={onSave}>
                  {saved ? "已收藏 ✓" : "收藏书单"}
                </button>
                <button className="btn btn-ghost" onClick={copyLink}>
                  {copied ? "已复制链接 ✓" : "复制书单链接"}
                </button>
              </>
            )}
          </div>

          {books.length === 0 ? (
            <div className="bl-empty">
              这个书单还没有书。
              {mine ? "点「添加书籍」从书库挑选，或在书籍详情页点「加入书单」。" : ""}
            </div>
          ) : (
            <div className="bl-books">
              {books.map((b) => (
                <div className="bl-book" key={b.id}>
                  <div className="bl-book-cover" onClick={() => onOpenBook(b.id)}>
                    <Cover book={b} />
                  </div>
                  <div className="bl-book-t" onClick={() => onOpenBook(b.id)}>
                    {b.t}
                  </div>
                  <div className="bl-book-a">{b.a}</div>
                  {mine && (
                    <button className="bl-book-rm" title="移出书单" onClick={() => remove(b.id)}>
                      {I.x}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {adding && (
        <BookPicker
          listId={listId}
          existing={list.books || []}
          onClose={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

export { Booklist, AddToBooklist, BookPicker };
