// Tiny dependency-free force-directed layout shared by the knowledge-graph view
// (product-graph.jsx) and the per-sentence echo constellation (product-echo.jsx).
// Deterministic enough for a one-shot settle; not a live simulation.
//
// nodes: [{ id, ... }]   edges: [{ source, target, weight? }]
// Returns { pts: [{...node, x, y}], links: [{ s, t, w }] }.
export function layoutForce(nodes, edges, W, H, opts = {}) {
  const iters = opts.iters || 280;
  const repel = opts.repel || 5200;
  const restLen = opts.restLen || 150;
  const cx = W / 2, cy = H / 2;
  const pts = nodes.map((n, i) => {
    const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    return { ...n, x: cx + Math.cos(a) * 90 + (Math.random() - 0.5) * 24, y: cy + Math.sin(a) * 90 + (Math.random() - 0.5) * 24, vx: 0, vy: 0 };
  });
  const byId = new Map(pts.map((p) => [p.id, p]));
  const links = edges
    .map((e) => ({ s: byId.get(e.source), t: byId.get(e.target), w: e.weight || 1 }))
    .filter((l) => l.s && l.t);
  for (let it = 0; it < iters; it++) {
    const k = 1 - it / iters; // cooling
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2);
        const rep = repel / d2;
        const fx = (dx / d) * rep, fy = (dy / d) * rep;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    for (const l of links) {
      const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const rest = restLen - Math.min(l.w, 6) * 10;
      const f = (d - rest) * 0.02;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy;
    }
    for (const p of pts) {
      p.vx += (cx - p.x) * 0.012; p.vy += (cy - p.y) * 0.012;
      p.x += p.vx * 0.5 * k; p.y += p.vy * 0.5 * k;
      p.vx *= 0.86; p.vy *= 0.86;
      p.x = Math.max(28, Math.min(W - 28, p.x));
      p.y = Math.max(28, Math.min(H - 28, p.y));
    }
  }
  return { pts, links };
}
