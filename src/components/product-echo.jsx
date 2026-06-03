import React from "react";
import { I } from "./product-shared.jsx";
import { getCatalogTotal } from "../lib/catalog.js";
import api from "../lib/api.js";
import { layoutForce } from "../lib/force-graph.js";
import { clickable } from "../lib/a11y.js";

/* product-echo.jsx — cross-book "echoes" overlay (L4 connection layer).
   Given a sentence, show where the idea echoes across the library:
   a small constellation + echo cards with AI-explained connections.
   Echoes are fetched LIVE (get_echoes: merged seed + auto-discovered edges),
   with the static seed ECHOES as a graceful fallback. */
const { useState: useEc2, useEffect: useEcEf, useMemo: useEcMemo } = React;
import { useQuery } from "@tanstack/react-query";

// cover-class → swatch color (mirrors .cover.* in liber.css); used when a live
// echo item carries no explicit color (seed items do; auto-discovered ones don't).
const CLS_COLOR = {
  ink: "#211b15",
  cinnabar: "#b0553a",
  cream: "#caa96a",
  jade: "#20402f",
  indigo: "#1f2747",
  slate: "#2c2b2f",
};
const itemColor = (it) =>
  it.color || CLS_COLOR[(window.BOOKS || []).find((b) => b.id === it.bookId)?.cls] || CLS_COLOR.ink;
const itemSeal = (it) =>
  it.seal || (window.BOOKS || []).find((b) => b.id === it.bookId)?.seal || "·";

function EchoOverlay({ sid, sentence, book, onClose, onOpenBook }) {
  const seed = (window.ECHOES || {})[sid] || null;
  // live echoes; keep the seed as the instant + fallback render.
  const echoQ = useQuery({ queryKey: ["echoes", sid], queryFn: () => api.graph.echoes(sid) });
  const live = echoQ.data && echoQ.data.result;
  const data = live && live.items && live.items.length ? live : seed;

  const items = data ? data.items : [];
  const theme = data ? data.theme : "主题呼应";

  /* constellation: force-directed neighbourhood — the anchor sentence at the
     centre, each echo a neighbour pulled toward it (stronger score = closer). */
  const W = 260,
    H = 240,
    cx = W / 2,
    cy = H / 2;
  const { nodes, anchor } = useEcMemo(() => {
    if (!items.length) return { nodes: [], anchor: { x: cx, y: cy } };
    const gNodes = [{ id: "__anchor__" }, ...items.map((it, i) => ({ id: "n" + i, ...it }))];
    const gEdges = items.map((it, i) => ({
      source: "__anchor__",
      target: "n" + i,
      weight: 1 + Math.round((it.score || 0) * 4),
    }));
    const { pts } = layoutForce(gNodes, gEdges, W, H, { iters: 220, repel: 3200, restLen: 86 });
    const a = pts.find((p) => p.id === "__anchor__") || { x: cx, y: cy };
    return { nodes: pts.filter((p) => p.id !== "__anchor__"), anchor: a };
  }, [data]);

  return (
    <>
      <div className="drawer-scrim" style={{ zIndex: 845 }} {...clickable(onClose)} />
      <div className="echo-modal">
        <div className="echo-head">
          <div>
            <div className="echo-kick">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <circle cx="5" cy="6" r="1.6" />
                <circle cx="19" cy="7" r="1.6" />
                <circle cx="18" cy="18" r="1.6" />
                <path d="M9.8 10.6 6.2 7M14.2 10.8 17.6 8M13.6 14.2 16.8 16.8" />
              </svg>
              回声 · 这句在馆里的呼应
            </div>
            <div className="echo-theme">{theme}</div>
          </div>
          <span className="x" {...clickable(onClose)}>
            {I.x}
          </span>
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
            <title>回响星图</title>
            {nodes.map((nd, i) => (
              <line
                key={"l" + i}
                x1={anchor.x}
                y1={anchor.y}
                x2={nd.x}
                y2={nd.y}
                stroke="var(--accent-line)"
                strokeWidth={1 + Math.min(nd.score ? nd.score * 3 : 0, 2)}
                strokeDasharray={nd.score ? "0" : "3 3"}
              />
            ))}
            {nodes.map((nd, i) => (
              <g
                key={"n" + i}
                style={{ cursor: nd.inLib ? "pointer" : "default" }}
                {...clickable(() => nd.inLib && onOpenBook(nd.bookId))}
              >
                <circle cx={nd.x} cy={nd.y} r="18" fill={itemColor(nd)} />
                <text
                  x={nd.x}
                  y={nd.y + 5}
                  textAnchor="middle"
                  fontFamily="var(--display)"
                  fontSize="15"
                  fill="#fff"
                >
                  {itemSeal(nd)}
                </text>
              </g>
            ))}
            <circle cx={anchor.x} cy={anchor.y} r="26" fill="#211b15" />
            <text
              x={anchor.x}
              y={anchor.y + 6}
              textAnchor="middle"
              fontFamily="var(--display)"
              fontSize="19"
              fill="#ece2cf"
            >
              {book.seal}
            </text>
          </svg>
        </div>

        {/* echo cards */}
        <div className="echo-list">
          {items.map((it, i) => (
            <div className="echo-card" key={i}>
              <div className="ec-top">
                <span className="ec-seal" style={{ background: itemColor(it) }}>
                  {itemSeal(it)}
                </span>
                <div className="ec-meta">
                  <div className="ec-bk">
                    {it.bookT}
                    {!it.inLib && <span className="ec-corpus">馆藏</span>}
                  </div>
                  <div className="ec-ch">{it.chap}</div>
                </div>
              </div>
              <div className="ec-quote">「{it.quote}」</div>
              <div className="ec-why">
                <span className="ec-why-lab">为何呼应</span>
                {it.why}
              </div>
              <div className="ec-acts">
                {it.inLib ? (
                  <button type="button" className="ec-go" onClick={() => onOpenBook(it.bookId)}>
                    跳去读《{it.bookT}》 →
                  </button>
                ) : (
                  <span className="ec-soon">该卷已在馆藏 · 即将开放</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="echo-foot">
          由 AI 在全 {getCatalogTotal().toLocaleString("zh-CN")} 卷公共版权馆藏中检索 ·{" "}
          <b>这条「呼应」本身也是可被引用的对象</b>
        </div>
      </div>
    </>
  );
}

export { EchoOverlay };
