import React from "react";
import { I } from "./product-shared.jsx";
import { getCatalogTotal } from "../lib/catalog.js";
import api from "../lib/api.js";

/* product-echo.jsx — cross-book "echoes" overlay (L4 connection layer).
   Given a sentence, show where the idea echoes across the library:
   a small constellation + echo cards with AI-explained connections.
   Echoes are fetched LIVE (get_echoes: merged seed + auto-discovered edges),
   with the static seed ECHOES as a graceful fallback. */
const { useState: useEc2, useEffect: useEcEf } = React;

// cover-class → swatch color (mirrors .cover.* in liber.css); used when a live
// echo item carries no explicit color (seed items do; auto-discovered ones don't).
const CLS_COLOR = { ink:"#211b15", cinnabar:"#b0553a", cream:"#caa96a", jade:"#20402f", indigo:"#1f2747", slate:"#2c2b2f" };
const itemColor = (it) => it.color || CLS_COLOR[(window.BOOKS || []).find(b => b.id === it.bookId)?.cls] || CLS_COLOR.ink;
const itemSeal = (it) => it.seal || (window.BOOKS || []).find(b => b.id === it.bookId)?.seal || "·";

function EchoOverlay({ sid, sentence, book, onClose, onOpenBook }){
  const seed = (window.ECHOES || {})[sid] || null;
  const [data, setData] = useEc2(seed);

  /* fetch live echoes; keep the seed as the instant + fallback render. */
  useEcEf(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.graph.echoes(sid);
        const live = r && r.result;
        if (alive && live && live.items && live.items.length) setData(live);
      } catch { /* keep seed fallback */ }
    })();
    return () => { alive = false; };
  }, [sid]);

  const items = data ? data.items : [];
  const theme = data ? data.theme : "主题呼应";

  /* constellation geometry: center = this book, nodes around */
  const cx = 130, cy = 120, R = 88;
  const n = Math.max(items.length, 1);
  const nodes = items.map((it, i) => {
    const ang = (-90 + (360 / n) * i) * Math.PI / 180;
    return { ...it, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  });

  return (
    <>
      <div className="drawer-scrim" style={{ zIndex: 845 }} onClick={onClose}/>
      <div className="echo-modal">
        <div className="echo-head">
          <div>
            <div className="echo-kick">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="1.6"/><circle cx="19" cy="7" r="1.6"/><circle cx="18" cy="18" r="1.6"/><path d="M9.8 10.6 6.2 7M14.2 10.8 17.6 8M13.6 14.2 16.8 16.8"/></svg>
              回声 · 这句在馆里的呼应
            </div>
            <div className="echo-theme">{theme}</div>
          </div>
          <span className="x" onClick={onClose}>{I.x}</span>
        </div>

        {/* anchor sentence */}
        <div className="echo-anchor">
          <span className="seal">{book.seal}</span>
          <div>
            <div className="ea-q">「{sentence}」</div>
            <div className="ea-src">{book.t} · 你正在读的这一句</div>
          </div>
        </div>

        {/* constellation */}
        <div className="echo-constellation">
          <svg viewBox="0 0 260 240" width="100%" height="240">
            {nodes.map((nd,i) => (
              <line key={"l"+i} x1={cx} y1={cy} x2={nd.x} y2={nd.y} stroke="var(--accent-line)" strokeWidth="1" strokeDasharray="3 3"/>
            ))}
            {nodes.map((nd,i) => (
              <g key={"n"+i}>
                <circle cx={nd.x} cy={nd.y} r="18" fill={itemColor(nd)}/>
                <text x={nd.x} y={nd.y+5} textAnchor="middle" fontFamily="var(--display)" fontSize="15" fill="#fff">{itemSeal(nd)}</text>
              </g>
            ))}
            <circle cx={cx} cy={cy} r="26" fill="#211b15"/>
            <text x={cx} y={cy+6} textAnchor="middle" fontFamily="var(--display)" fontSize="19" fill="#ece2cf">{book.seal}</text>
          </svg>
        </div>

        {/* echo cards */}
        <div className="echo-list">
          {items.map((it,i) => (
            <div className="echo-card" key={i}>
              <div className="ec-top">
                <span className="ec-seal" style={{ background: itemColor(it) }}>{itemSeal(it)}</span>
                <div className="ec-meta"><div className="ec-bk">{it.bookT}{!it.inLib && <span className="ec-corpus">馆藏</span>}</div><div className="ec-ch">{it.chap}</div></div>
              </div>
              <div className="ec-quote">「{it.quote}」</div>
              <div className="ec-why"><span className="ec-why-lab">为何呼应</span>{it.why}</div>
              <div className="ec-acts">
                {it.inLib
                  ? <button className="ec-go" onClick={() => onOpenBook(it.bookId)}>跳去读《{it.bookT}》 →</button>
                  : <span className="ec-soon">该卷已在馆藏 · 即将开放</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="echo-foot">
          由 AI 在全 {getCatalogTotal().toLocaleString("zh-CN")} 卷公共版权馆藏中检索 · <b>这条「呼应」本身也是可被引用的对象</b>
        </div>
      </div>
    </>
  );
}

export { EchoOverlay };
