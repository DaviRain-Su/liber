import React from "react";
import { I, Cover } from "./product-shared.jsx";

/* product-shelf.jsx — My Shelf: reading hub. Stats + reading/want/finished + collections. */
const { useState: useShf } = React;

function Shelf({ onOpenBook, onOpenReader, onOpenGroup }){
  const me = window.ME;
  const byId = (id) => (window.BOOKS||[]).find(b => b.id === id);
  const reading = me.reading.map(r => ({ ...byId(r.id), at:r.at })).filter(Boolean);
  const want = (me.wantToRead||[]).map(byId).filter(Boolean);
  const finished = (me.finished||[]).map(byId).filter(Boolean);
  const groups = (me.groups||[]).map(id => (window.GROUPS||[]).find(g => g.id === id)).filter(Boolean);
  const [tab, setTab] = useShf("reading");

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
              <div className="n">{me.streak}<span className="u"> 天</span></div>
              <div className="l">连续阅读</div>
              <div className="flames">{Array.from({length:7}).map((_,i)=><span key={i} className={i<5?"on":""}/>)}</div>
            </div>
            <div className="ss-item">
              <div className="n">{me.weekRead}<span className="u"> / {me.weekGoal}</span></div>
              <div className="l">本周已读 (天)</div>
              <div className="ss-bar"><div className="ss-fill" style={{width:(me.weekRead/me.weekGoal*100)+"%"}}/></div>
            </div>
            <div className="ss-item">
              <div className="n">{me.yearFinished}<span className="u"> / {me.yearGoal}</span></div>
              <div className="l">今年读完</div>
              <div className="ss-bar"><div className="ss-fill" style={{width:(me.yearFinished/me.yearGoal*100)+"%"}}/></div>
            </div>
            <div className="ss-item">
              <div className="n">{me.stats.lines}</div>
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
              </div>

              {/* collections */}
              <div className="sh-card">
                <div className="shc-h">我的书单</div>
                {me.collections.map(c => (
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
