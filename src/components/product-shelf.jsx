import React from "react";
import { I, Cover } from "./product-shared.jsx";
import { getCatalogBooks, subscribeCatalog } from "../lib/catalog.js";
import { shelfCollections, shelfReadingEntries, subscribeShelf } from "../lib/shelf.js";

/* product-shelf.jsx — My Shelf: reading hub. Stats + reading/want/finished + collections. */
const { useState: useShf, useEffect: useEff } = React;

function Shelf({ onOpenBook, onOpenReader, onOpenGroup }){
  const me = window.ME;
  const [catalog, setCatalog] = useShf(() => getCatalogBooks());
  const [summary, setSummary] = useShf(null);
  const [apiGroups, setApiGroups] = useShf([]);
  const [, refreshShelf] = useShf(0);
  useEff(() => {
    const offCatalog = subscribeCatalog((books) => setCatalog(books));
    const offShelf = subscribeShelf(() => refreshShelf((n) => n + 1));
    return () => { offCatalog(); offShelf(); };
  }, []);
  useEff(() => {
    if (!window.liberApi) return;
    let live = true;
    window.liberApi.reading.summary().then((r) => { if (live) setSummary(r); }).catch(() => {});
    window.liberApi.groups.list().then((r) => { if (live && Array.isArray(r?.groups)) setApiGroups(r.groups); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const byId = (id) => catalog.find((book) => book.id === id);
  const serverReading = (summary?.reading || []).map((r) => ({ id: r.id, at: r.at }));
  const reading = shelfReadingEntries(serverReading.length ? serverReading : me.reading, catalog);
  const want = (me.wantToRead||[]).map(byId).filter(Boolean);
  const finished = (me.finished||[]).map(byId).filter(Boolean);
  const joinedIds = new Set(summary?.joinedGroupIds || []);
  const groups = apiGroups.filter((g) => joinedIds.has(g.id) || g.joined);
  const collections = shelfCollections(me.collections, catalog);
  const [tab, setTab] = useShf("reading");
  const stats = summary?.stats || { streak: 0, weekRead: 0, yearFinished: 0, lines: 0 };

  const pct = (b) => (b.at && b.at.match(/(\d+)%/)) ? b.at.match(/(\d+)%/)[1] : "0";

  return (
    <div className="app-screen">
      <div className="shelf-screen">
        <div className="shelf-wrap">
          <div className="sh-head">
            <div className="kicker">我的书架</div>
            <h1 className="sh-title">你的私人图书馆。</h1>
          </div>

          {/* reading stats band */}
          <div className="sh-stats">
            <div className="ss-item ss-streak">
              <div className="n">{stats.streak}<span className="u"> 天</span></div>
              <div className="l">连续阅读</div>
              <div className="flames">{Array.from({length:7}).map((_,i)=><span key={i} className={i<Math.min(stats.streak,7)?"on":""}/>)}</div>
            </div>
            <div className="ss-item">
              <div className="n">{stats.weekRead}<span className="u"> / 7</span></div>
              <div className="l">本周已读 (天)</div>
              <div className="ss-bar"><div className="ss-fill" style={{width:(stats.weekRead/7*100)+"%"}}/></div>
            </div>
            <div className="ss-item">
              <div className="n">{stats.yearFinished}</div>
              <div className="l">今年读完</div>
              <div className="ss-bar"><div className="ss-fill" style={{width:stats.yearFinished ? "100%" : "0%"}}/></div>
            </div>
            <div className="ss-item">
              <div className="n">{stats.lines}</div>
              <div className="l">累计划线</div>
            </div>
          </div>

          <div className="sh-grid">
            <main className="sh-main">
              <div className="sh-tabs">
                <button className={tab==="reading"?"on":""} onClick={()=>setTab("reading")}>在读 · {reading.length}</button>
                <button className={tab==="want"?"on":""} onClick={()=>setTab("want")}>想读 · {want.length}</button>
                <button className={tab==="finished"?"on":""} onClick={()=>setTab("finished")}>读完 · {finished.length}</button>
              </div>

              {tab==="reading" && (
                <div className="sh-reading">
                  {reading.map(b => (
                    <div className="rd-row" key={b.id}>
                      <Cover book={b} className="rd-row-cover" />
                      <div className="rd-row-mid">
                        <div className="t" onClick={()=>onOpenBook(b.id)}>{b.t}</div>
                        <div className="a">{b.a} · {b.sub}</div>
                        <div className="rd-prog"><div className="rd-fill" style={{width:pct(b)+"%"}}/></div>
                        <div className="at">读到 {b.at}</div>
                      </div>
                      <div className="rd-row-act">
                        <button className="btn btn-primary" onClick={()=>onOpenReader(b.id)}>{I.book} 继续读</button>
                        <button className="btn btn-ghost" onClick={()=>onOpenBook(b.id)}>详情</button>
                      </div>
                    </div>
                  ))}
                  {!reading.length && <div className="pf-empty">你的书架里还没有书。从书库打开一本书后，可以把它加入书架。</div>}
                </div>
              )}

              {(tab==="want"||tab==="finished") && (
                <div className="sh-cards">
                  {(tab==="want"?want:finished).map(b => (
                    <div className="sh-bk" key={b.id} onClick={()=>onOpenBook(b.id)}>
                      <Cover book={b} />
                      <div className="t">{b.t}</div>
                      <div className="at">{tab==="want" ? "想读 · "+b.cat : "已读完 · "+b.a}</div>
                    </div>
                  ))}
                  {(tab==="want"?want:finished).length === 0 && <div className="pf-empty">{tab==="want" ? "暂无想读图书。" : "暂无读完图书。"}</div>}
                </div>
              )}
            </main>

            <aside className="sh-aside">
              {/* my groups */}
              <div className="sh-card">
                <div className="shc-h">我加入的共读 <span className="more" onClick={()=>onOpenGroup(null)}>全部 →</span></div>
                {groups.map(g => (
                  <div className="sh-grp" key={g.id} onClick={()=>onOpenGroup(g.id)}>
                    <span className="gd" style={{background:g.color}}>{g.seal}</span>
                    <div className="gmid"><div className="gn">{g.name}</div><div className="gm">本周 · {g.weekRange}</div></div>
                    <span className="gp">{g.progressPct}%</span>
                  </div>
                ))}
                {groups.length === 0 && <div className="pf-empty">你还没有加入共读小组。</div>}
              </div>

              {/* collections */}
              <div className="sh-card">
                <div className="shc-h">我的书单</div>
                {collections.map(c => (
                  <div className="sh-coll" key={c.id}>
                    <div className="coll-stack">
                      {c.books.map((bid,i) => { const b=byId(bid); return b ? <span key={bid} className={`coll-sp ${b.cls}`} style={{zIndex:9-i, marginLeft:i?-14:0}}>{b.seal}</span> : null; })}
                    </div>
                    <div className="coll-mid"><div className="cn">{c.name}</div><div className="cd">{c.desc}</div></div>
                    <span className="cc-n">{c.books.length} 本</span>
                  </div>
                ))}
                <button className="btn btn-ghost btn-block" style={{marginTop:14}}>＋ 新建书单</button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

export { Shelf };
