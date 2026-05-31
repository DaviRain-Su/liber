import React from "react";
import { I, Cover } from "./product-shared.jsx";
import { getCatalogBooks, getCatalogTotal, loadCatalogBooks, subscribeCatalog } from "../lib/catalog.js";

/* product-search.jsx — global search overlay: books, sentences/highlights, people. */
const { useState: useSse, useEffect: useEse, useRef: useRse, useMemo: useMse } = React;

/* build a sentence index from every seeded book's chapters (道德经/论语/孙子兵法…) */
function buildSentenceIndex(){
  const out = [];
  const content = window.BOOK_CONTENT || {};
  const titleOf = (bid) => (window.BOOKS || []).find(b => b.id === bid)?.t || bid;
  Object.keys(content).forEach(bid => {
    const t = titleOf(bid);
    (content[bid].chapters || []).forEach(c => c.paras.flat().forEach(s =>
      out.push({ t:s.t, book:t, bookId:bid, chap:"第"+c.n+"章", n:c.n })));
  });
  return out;
}

function SearchOverlay({ initial, onClose, onOpenBook }){
  const [q, setQ] = useSse(initial || "");
  const [apiRes, setApiRes] = useSse(null);
  const [readers, setReaders] = useSse([]);
  const [catalog, setCatalog] = useSse(() => getCatalogBooks());
  const inputRef = useRse(null);
  const sentences = useMse(() => buildSentenceIndex(), []);
  useEse(() => { inputRef.current && inputRef.current.focus(); }, []);
  useEse(() => { const h = e => { if(e.key==="Escape") onClose(); }; window.addEventListener("keydown",h); return ()=>window.removeEventListener("keydown",h); }, []);
  useEse(() => {
    const off = subscribeCatalog((books) => setCatalog(books));
    loadCatalogBooks().then(setCatalog).catch(() => {});
    return off;
  }, []);
  useEse(() => {
    if (!window.liberApi?.readers?.list) return;
    window.liberApi.readers.list()
      .then((r) => { if (Array.isArray(r?.readers)) setReaders(r.readers); })
      .catch(() => {});
  }, []);

  const term = q.trim();
  useEse(() => {
    if (!window.liberApi || !term) { setApiRes(null); return; }
    const t = term;
    const id = setTimeout(() => { window.liberApi.search(t).then(r => setApiRes({ term: t, ...r })).catch(() => {}); }, 180);
    return () => clearTimeout(id);
  }, [term]);
  const useApi = apiRes && apiRes.term === term;
  const allowSeedFallback = !window.liberApi;
  const books = term
    ? (useApi && Array.isArray(apiRes.books) ? apiRes.books : allowSeedFallback ? catalog.filter(b => b.t.includes(term) || b.a.includes(term) || (b.sub || "").toLowerCase().includes(term.toLowerCase()) || b.cat.includes(term)) : [])
    : (allowSeedFallback ? catalog : catalog.filter(b => b.dynamic)).slice(0,4);
  const sents = term
    ? (useApi && Array.isArray(apiRes.sentences) ? apiRes.sentences : allowSeedFallback ? sentences.filter(s => s.t.includes(term)) : [])
    : [];
  const people = term ? readers.filter(p => (p.name || "").includes(term) || (p.handle || "").includes(term) || (p.bio || "").includes(term)) : [];
  const empty = term && !books.length && !sents.length && !people.length;

  const hi = (text) => {
    if (!term) return text;
    const i = text.indexOf(term); if (i<0) return text;
    return <>{text.slice(0,i)}<mark>{text.slice(i,i+term.length)}</mark>{text.slice(i+term.length)}</>;
  };

  const open = (id) => { onOpenBook(id); onClose(); };

  return (
    <>
      <div className="search-scrim" onClick={onClose}/>
      <div className="search-modal">
        <div className="sm-bar">
          {I.search}
          <input ref={inputRef} placeholder="搜书名、作者、句子，或读者…" value={q} onChange={e=>setQ(e.target.value)} />
          <kbd onClick={onClose}>Esc</kbd>
        </div>
        <div className="sm-body">
          {empty && <div className="sm-empty">没有找到与「{term}」相关的结果。试试「道」「自知」「斯密」。</div>}

          {books.length>0 && (
            <div className="sm-sec">
              <div className="sm-h">{term?"书":"推荐"} · {books.length}</div>
              {books.map(b => (
                <div className="sm-book" key={b.id} onClick={()=>open(b.id)}>
                  <Cover book={b} className="sm-cover"/>
                  <div><div className="t">{hi(b.t)}</div><div className="a">{hi(b.a)} · {b.cat}</div></div>
                  <span className="sm-go">{b.reads} 在读</span>
                </div>
              ))}
            </div>
          )}

          {sents.length>0 && (
            <div className="sm-sec">
              <div className="sm-h">句子 · 划线 · {sents.length}</div>
              {sents.slice(0,6).map((s,i) => (
                <div className="sm-sent" key={i} onClick={()=>open(s.bookId)}>
                  <span className="qm">”</span>
                  <div><div className="q">{hi(s.t)}</div><div className="c">{s.book} · {s.chap}</div></div>
                </div>
              ))}
            </div>
          )}

          {people.length>0 && (
            <div className="sm-sec">
              <div className="sm-h">读者 · {people.length}</div>
              {people.map((p,i) => (
                <div className="sm-person" key={p.id || i} onClick={() => { window.openProfile({ userId:p.id, name:p.name }); onClose(); }}>
                  <div className="ava" style={{background:p.color}}>{p.seal || String(p.name || "读")[0]}</div>
                  <div><div className="nm">{hi(p.name || "读者")}</div><div className="pb">{hi(p.bio || "")} · {p.stats?.lines || 0} 划线</div></div>
                  <button className="btn btn-ghost sm-follow" onClick={(e) => { e.stopPropagation(); window.liberApi?.readers?.follow?.(p.id).catch(()=>{}); }}>关注</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="sm-foot"><span>↵ 打开</span><span>Esc 关闭</span><span>跨全馆 {getCatalogTotal().toLocaleString("zh-CN")} 卷检索</span></div>
      </div>
    </>
  );
}

export { SearchOverlay };
