import React from "react";
import { I } from "./product-shared.jsx";
import api from "../lib/api.js";
import { ECHOES as SEED_ECHOES } from "../data/product-data.js";
import { findCatalogBook } from "../lib/catalog.js";
import { layoutForce } from "../lib/force-graph.js";

/* product-graph.jsx — "思维链接" knowledge-graph view.
   Renders the library's cross-book echoes as a force-directed constellation:
   each node is a book (sized by how many echoes touch it), each edge a
   book↔book link (thickness = how many sentence-level echoes connect the pair).
   Data: GET /api/graph/map (live echo_edges, else seed-derived). Falls back to
   the seed ECHOES entirely when the backend is unavailable, so it works on a
   static deploy too — same graceful-degradation contract as the rest of api.js. */
const { useState: useGs, useEffect: useGe, useRef: useGr } = React;

// cover-class → swatch color (mirrors .cover.* in liber.css)
const CLS_COLOR = {
  ink: "#211b15", cinnabar: "#b0553a", cream: "#caa96a",
  jade: "#20402f", indigo: "#1f2747", slate: "#2c2b2f",
};
const colorFor = (cls) => CLS_COLOR[cls] || CLS_COLOR.ink;

// Build {nodes, edges} from the seed ECHOES dictionary as a last-resort fallback.
function seedMap() {
  const pair = new Map();
  const hits = new Map();
  const bump = (a, b) => {
    if (!a || !b || a === b) return;
    const [x, y] = a < b ? [a, b] : [b, a];
    const k = `${x}|${y}`;
    pair.set(k, { a: x, b: y, weight: (pair.get(k)?.weight || 0) + 1 });
    hits.set(x, (hits.get(x) || 0) + 1);
    hits.set(y, (hits.get(y) || 0) + 1);
  };
  for (const data of Object.values(SEED_ECHOES || {})) {
    for (const it of data.items || []) { if (it.bookId) bump("daodejing", it.bookId); }
  }
  const meta = (id) => { const b = findCatalogBook(id) || {}; return { t: b.t || id, seal: b.seal || "·", cls: b.cls || "ink" }; };
  return {
    source: "seed",
    nodes: [...hits.entries()].map(([id, w]) => ({ id, ...meta(id), weight: w })),
    edges: [...pair.values()].map((p) => ({ source: p.a, target: p.b, weight: p.weight, score: 0.9 })),
  };
}

function GraphView({ onClose, onOpenBook }) {
  const [state, setState] = useGs({ loading: true, source: null, nodes: [], edges: [], error: null });
  const [hover, setHover] = useGs(null);
  const wrapRef = useGr(null);
  const W = 560, H = 440;

  useGe(() => {
    let alive = true;
    (async () => {
      try {
        const m = await api.graph.map(400);
        if (!alive) return;
        if (m && m.nodes && m.nodes.length) setState({ loading: false, ...m, error: null });
        else setState({ loading: false, ...seedMap(), error: null });
      } catch {
        if (alive) setState({ loading: false, ...seedMap(), error: "offline" });
      }
    })();
    return () => { alive = false; };
  }, []);

  const { pts, links } = React.useMemo(
    () => (state.nodes.length ? layoutForce(state.nodes, state.edges, W, H) : { pts: [], links: [] }),
    [state.nodes, state.edges],
  );
  const maxW = Math.max(1, ...state.nodes.map((n) => n.weight || 1));
  const radius = (w) => 14 + Math.round((Math.min(w, maxW) / maxW) * 16);

  return (
    <>
      <div className="drawer-scrim" style={{ zIndex: 845 }} onClick={onClose} />
      <div className="graph-modal">
        <div className="graph-head">
          <div>
            <div className="graph-kick">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="12" cy="18" r="2"/><circle cx="12" cy="11" r="2.4"/><path d="M6.7 6.6 9.8 9.8M17.2 7.6 14.1 10.2M12 13.4V16"/></svg>
              思维链接 · 全馆呼应图谱
            </div>
            <div className="graph-theme">
              {state.source === "live"
                ? "由读者的划线、提问与 AI 对话生长而成"
                : state.source === "seed"
                  ? "示意图谱 · 启用知识图谱后将随阅读生长"
                  : "加载中…"}
            </div>
          </div>
          <span className="x" onClick={onClose}>{I.x}</span>
        </div>

        <div className="graph-canvas" ref={wrapRef}>
          {state.loading ? (
            <div className="graph-empty">正在汇集馆藏呼应…</div>
          ) : state.nodes.length === 0 ? (
            <div className="graph-empty">还没有跨书呼应。划线、向书友提问，链接会在这里生长。</div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="知识图谱">
              {links.map((l, i) => {
                const active = hover && (l.s.id === hover || l.t.id === hover);
                return (
                  <line key={"e" + i} x1={l.s.x} y1={l.s.y} x2={l.t.x} y2={l.t.y}
                    stroke={active ? "var(--accent)" : "var(--accent-line)"}
                    strokeWidth={active ? 2 : 1 + Math.min(l.w, 5) * 0.5}
                    strokeOpacity={hover && !active ? 0.18 : 0.6}
                    strokeDasharray={l.w > 1 ? "0" : "3 3"} />
                );
              })}
              {pts.map((p) => {
                const r = radius(p.weight);
                const dim = hover && hover !== p.id && !links.some((l) => (l.s.id === hover && l.t.id === p.id) || (l.t.id === hover && l.s.id === p.id));
                return (
                  <g key={p.id} style={{ cursor: "pointer", opacity: dim ? 0.32 : 1, transition: "opacity .15s" }}
                    onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}
                    onClick={() => onOpenBook && onOpenBook(p.id)}>
                    <circle cx={p.x} cy={p.y} r={r} fill={colorFor(p.cls)} stroke="var(--paper-2)" strokeWidth="2" />
                    <text x={p.x} y={p.y + 5} textAnchor="middle" fontFamily="var(--display)" fontSize={Math.round(r * 0.78)} fill="#fff">{p.seal}</text>
                    <text x={p.x} y={p.y + r + 14} textAnchor="middle" fontFamily="var(--display)" fontSize="12" fill="var(--ink)">{p.t}</text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        <div className="graph-legend">
          <span><i className="gl-dot" /> 圆点 = 一本书，越大 = 被越多呼应触及</span>
          <span><i className="gl-line" /> 连线 = 跨书呼应，越粗 = 链接越密</span>
        </div>
        <div className="graph-foot">
          {state.source === "live"
            ? <>这张图谱是<b>活的</b> · 每一次划线与提问都在为它添一条线</>
            : <>这是<b>示意图谱</b> · 部署知识图谱（<code>GRAPH_ENABLED</code>）后，它将随真实阅读生长</>}
          {" · "}<b>每条呼应本身都是可被引用的 CC0 对象</b>
        </div>
      </div>
    </>
  );
}

export { GraphView };
