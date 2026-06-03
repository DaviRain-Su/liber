import React from "react";

/* product-convocard.jsx — shareable conversation artifact, reused by the
   reader (share preview) and the social page (feed + browse).
   Forms: 'card' (对话卡) and 'insight' (金句卡).
   Plus: fork-tree modal (lineage) + insight-card PNG export. */

const CC_ICO = {
  fork: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="6" cy="5" r="2.4" />
      <circle cx="18" cy="5" r="2.4" />
      <circle cx="12" cy="19" r="2.4" />
      <path d="M6 7.4v3c0 2 1.6 3 3.5 3.4M18 7.4v3c0 2-1.6 3-3.5 3.4M12 14v2.6" />
    </svg>
  ),
  up: (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m6 14 6-6 6 6" />
    </svg>
  ),
  chat: (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 21 12Z" />
    </svg>
  ),
  save: (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M6 4h12v16l-6-4-6 4z" />
    </svg>
  ),
  saved: (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M6 4h12v16l-6-4-6 4z" />
    </svg>
  ),
  img: (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 18 5-5 4 4 3-3 4 4" />
    </svg>
  ),
  x: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  ),
};

const profileRef = (x) =>
  x?.userId || x?.id ? { userId: x.userId || x.id, name: x.name } : x?.name || x;
const canProfile = (x) => window.canOpenProfile(profileRef(x));
const openProfile = (x) => window.openProfile(profileRef(x));

function CCForkTree({ convo, onOpenTree }) {
  const nodes = [];
  const collect = (arr = []) =>
    arr.forEach((n) => {
      nodes.push(n);
      collect(n.children || []);
    });
  collect(convo.tree || []);
  const cs = nodes
    .slice(0, 3)
    .map((n) => [n.ava || String(n.name || "读")[0], n.color || "#3a4fb0"]);
  const clickable = !!(onOpenTree && convo.forks > 0);
  return (
    <div
      className={"cf-tree" + (clickable ? " link" : "")}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              onOpenTree(convo);
            }
          : undefined
      }
    >
      {cs.length > 0 && (
        <span className="dots">
          {cs.map(([n, c], i) => (
            <i key={i} style={{ background: c }}>
              {n}
            </i>
          ))}
        </span>
      )}
      被 {convo.forks} 人接着问过{clickable && " · 看对话树"}
    </div>
  );
}

function CCFoot({ convo, onFork, onSave, saved, dark, onExport, onComment, onVote, voted }) {
  return (
    <div className={dark ? "ci-foot" : "cf-foot"}>
      <button className="cf-fork" onClick={onFork}>
        {CC_ICO.fork} 接着这段问
      </button>
      <div className="cf-acts">
        <span
          onClick={onVote}
          style={
            onVote ? { cursor: "pointer", ...(voted ? { color: "var(--accent)" } : null) } : null
          }
        >
          {CC_ICO.up} {convo.agree}
        </span>
        <span onClick={onComment} style={onComment ? { cursor: "pointer" } : null}>
          {CC_ICO.chat} {convo.comments}
        </span>
        {onExport && (
          <span onClick={onExport} title="存为图片">
            {CC_ICO.img} 存图
          </span>
        )}
        <span onClick={onSave} style={saved ? { color: "var(--accent)" } : null}>
          {saved ? CC_ICO.saved : CC_ICO.save} {saved ? "已收藏" : "收藏"}
        </span>
      </div>
    </div>
  );
}

/* ---- 对话卡 ---- */
function ConvoCardForm({
  convo,
  expanded,
  onToggleExpand,
  onFork,
  onSave,
  saved,
  onOpenTree,
  onComment,
  onVote,
  voted,
}) {
  const shown = expanded ? convo.msgs : convo.msgs.slice(0, 3);
  return (
    <div className="cf cform-card">
      <div className="cf-head">
        <div className="cf-anchor">
          <span className="seal">{convo.seal}</span>
          <div className="meta">
            <div className="bk">{convo.bookT}</div>
            <div className="ch">{convo.chap}</div>
          </div>
        </div>
        <CCForkTree convo={convo} onOpenTree={onOpenTree} />
      </div>
      <div className="cf-hook">{convo.title || convo.msgs[0].t}</div>
      <div className="cf-bubbles">
        {shown.map((m, i) => (
          <div className={`cf-turn ${m.r}`} key={i}>
            {m.r === "a" && <div className="role">书友 · AI</div>}
            <div className="tx">{m.t}</div>
          </div>
        ))}
      </div>
      {!expanded && convo.msgs.length > 3 && (
        <div className="more-turns" onClick={onToggleExpand}>
          展开全部 {convo.msgs.length} 条对话 ↓
        </div>
      )}
      <CCFoot
        convo={convo}
        onFork={onFork}
        onSave={onSave}
        saved={saved}
        onComment={onComment}
        onVote={onVote}
        voted={voted}
      />
      <div className="cf-byline">
        {canProfile(convo.author) ? (
          <>
            <span
              className="ava ava-link"
              style={{ background: convo.author.color }}
              onClick={() => openProfile(convo.author)}
            >
              {convo.author.ava}
            </span>
            <span className="name-link" onClick={() => openProfile(convo.author)}>
              {convo.author.name}
            </span>{" "}
            在读《{convo.bookT}》时问出
          </>
        ) : (
          <>
            <span className="ava" style={{ background: convo.author.color }}>
              {convo.author.ava}
            </span>
            一位读者在读《{convo.bookT}》时问出
          </>
        )}
      </div>
    </div>
  );
}

/* ---- 金句卡 ---- */
function InsightCardForm({
  convo,
  expanded,
  onToggleExpand,
  onFork,
  onSave,
  saved,
  onOpenTree,
  onComment,
  onVote,
  voted,
}) {
  const [tplOpen, setTplOpen] = React.useState(false);
  return (
    <div className="cf cform-insight">
      <div className="ci-mark">”</div>
      <div className="ci-insight">{convo.insight}</div>
      <div className="ci-from">
        由一段关于《{convo.bookT} · {convo.chap}》的对话提炼
        <br />
        原文：<b>「{convo.quote.slice(0, 12)}…」</b>
      </div>
      {!expanded ? (
        <div className="ci-expand" onClick={onToggleExpand}>
          看背后的完整对话 · {convo.msgs.length} 条 ↓
        </div>
      ) : (
        <div className="ci-thread">
          {convo.msgs.map((m, i) => (
            <div className={`cf-turn ${m.r}`} key={i}>
              {m.r === "a" && <div className="role">书友 · AI</div>}
              <div className="tx">{m.t}</div>
            </div>
          ))}
        </div>
      )}
      <CCFoot
        convo={convo}
        onFork={onFork}
        onSave={onSave}
        saved={saved}
        dark
        onExport={() => setTplOpen((o) => !o)}
        onComment={onComment}
        onVote={onVote}
        voted={voted}
      />
      {tplOpen && (
        <div
          className="ci-tpl"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            margin: "10px 0 0",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, opacity: 0.7, fontFamily: "var(--mono, monospace)" }}>
            存为图片 · 选模板
          </span>
          {Object.values(INSIGHT_THEMES).map((t) => (
            <button
              key={t.key}
              title={`${t.label}色模板`}
              onClick={() => {
                exportInsightImage(convo, t.key);
                setTplOpen(false);
              }}
              style={{
                width: 36,
                height: 30,
                borderRadius: 6,
                cursor: "pointer",
                background: t.bg,
                color: t.fg,
                border: `1.5px solid ${t.accent}`,
                fontFamily: "var(--display, serif)",
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div
        className="ci-byline"
        onClick={onOpenTree && convo.forks > 0 ? () => onOpenTree(convo) : undefined}
        style={onOpenTree && convo.forks > 0 ? { cursor: "pointer" } : null}
      >
        {convo.forks} 人从这里接着往下问{onOpenTree && convo.forks > 0 && " · 看对话树"}
      </div>
    </div>
  );
}

/* ---- picker ---- */
function ConvoArtifact(props) {
  return props.convo.form === "insight" ? (
    <InsightCardForm {...props} />
  ) : (
    <ConvoCardForm {...props} />
  );
}

/* ============================================================
   Fork-tree modal — conversation lineage
   ============================================================ */
function TreeNode({ node, onFork, depth, path = [] }) {
  const [open, setOpen] = React.useState(true);
  const kids = node.children || [];
  const here = [...path, node]; // root → … → this node, the exact branch lineage
  return (
    <div className="ft-node">
      <div className="ft-card">
        <span
          className={"ava" + (canProfile(node) ? " ava-link" : "")}
          style={{ background: node.color }}
          onClick={canProfile(node) ? () => openProfile(node) : undefined}
        >
          {node.ava}
        </span>
        <div className="ft-body">
          <div className="ft-top">
            <span
              className={"nm" + (canProfile(node) ? " name-link" : "")}
              onClick={canProfile(node) ? () => openProfile(node) : undefined}
            >
              {node.name}
            </span>
            <span className="ft-meta">
              {CC_ICO.up} {node.agree} · 被 {node.forks} 人接着问
            </span>
          </div>
          <div className="ft-q">从这里问起：「{node.q}」</div>
          <div className="ft-acts">
            <span onClick={() => onFork(node, here)}>接着 ta 的问 →</span>
          </div>
        </div>
      </div>
      {kids.length > 0 && (
        <div className="ft-children">
          {kids.map((k) => (
            <TreeNode key={k.id} node={k} onFork={onFork} depth={depth + 1} path={here} />
          ))}
        </div>
      )}
    </div>
  );
}

function ForkTreeModal({ convo, onClose, onFork }) {
  const tree = convo.tree || [];
  const total = (function count(nodes) {
    return nodes.reduce((s, n) => s + 1 + count(n.children || []), 0);
  })(tree);
  return (
    <>
      <div className="drawer-scrim" style={{ zIndex: 866 }} onClick={onClose} />
      <div className="forktree-modal">
        <div className="ft-head">
          <div>
            <div className="ft-kick">
              {CC_ICO.fork} 对话树 · 这段被接力了 {total} 次
            </div>
            <div className="ft-sub">
              {convo.bookT} · {convo.chap}
            </div>
          </div>
          <span className="x" onClick={onClose}>
            {CC_ICO.x}
          </span>
        </div>
        <div className="ft-rootcard">
          <div className="ft-root-q">「{convo.title || convo.insight || convo.msgs[0].t}」</div>
          <div className="ft-root-by">
            <span
              className={"ava" + (canProfile(convo.author) ? " ava-link" : "")}
              style={{ background: convo.author.color }}
              onClick={canProfile(convo.author) ? () => openProfile(convo.author) : undefined}
            >
              {convo.author.ava}
            </span>
            原对话 ·{" "}
            <span
              className={canProfile(convo.author) ? "name-link" : ""}
              onClick={canProfile(convo.author) ? () => openProfile(convo.author) : undefined}
            >
              {convo.author.name}
            </span>{" "}
            · {convo.msgs.length} 条
          </div>
        </div>
        <div className="ft-tree">
          {tree.length === 0 ? (
            <div className="ft-empty">还没有人从这段接着问。你可以成为第一个。</div>
          ) : (
            tree.map((n) => <TreeNode key={n.id} node={n} onFork={onFork} depth={0} path={[]} />)
          )}
        </div>
      </div>
    </>
  );
}

/* ============================================================
   Export 金句卡 as a PNG (canvas, no deps) — 3 templates
   ============================================================ */
const INSIGHT_THEMES = {
  ink: {
    key: "ink",
    label: "墨",
    bg: "#211b15",
    grain: "rgba(236,226,207,0.05)",
    accent: "#c0432b",
    fg: "#ece2cf",
    fgSoft: "rgba(236,226,207,0.62)",
    fgFaint: "rgba(236,226,207,0.4)",
    fgGhost: "rgba(236,226,207,0.28)",
    rule: "rgba(236,226,207,0.16)",
    divider: "rgba(192,67,43,0.7)",
    sealBg: "#c0432b",
    sealFg: "#ece2cf",
  },
  paper: {
    key: "paper",
    label: "纸",
    bg: "#f4efe4",
    grain: "rgba(33,27,21,0.05)",
    accent: "#c0432b",
    fg: "#211b15",
    fgSoft: "rgba(33,27,21,0.6)",
    fgFaint: "rgba(33,27,21,0.42)",
    fgGhost: "rgba(33,27,21,0.3)",
    rule: "rgba(33,27,21,0.14)",
    divider: "rgba(192,67,43,0.8)",
    sealBg: "#c0432b",
    sealFg: "#f4efe4",
  },
  cinnabar: {
    key: "cinnabar",
    label: "朱",
    bg: "#b23a26",
    grain: "rgba(255,240,225,0.06)",
    accent: "#f7e3cf",
    fg: "#fbeee6",
    fgSoft: "rgba(251,238,230,0.74)",
    fgFaint: "rgba(251,238,230,0.52)",
    fgGhost: "rgba(251,238,230,0.36)",
    rule: "rgba(251,238,230,0.22)",
    divider: "rgba(251,238,230,0.85)",
    sealBg: "#211b15",
    sealFg: "#fbeee6",
  },
};

async function exportInsightImage(convo, theme = "ink") {
  const p = INSIGHT_THEMES[theme] || INSIGHT_THEMES.ink;
  const W = 1080,
    H = 1350,
    pad = 110;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d");
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch {}

  /* bg */
  x.fillStyle = p.bg;
  x.fillRect(0, 0, W, H);
  /* grain dots */
  x.fillStyle = p.grain;
  for (let yy = 40; yy < H; yy += 24)
    for (let xx = 40; xx < W; xx += 24) x.fillRect(xx, yy, 1.4, 1.4);
  /* accent quote mark */
  x.fillStyle = p.accent;
  x.font = '700 280px Georgia, "Times New Roman", serif';
  x.textBaseline = "alphabetic";
  x.fillText("”", pad - 14, 330);

  /* insight — big serif, wrapped */
  x.fillStyle = p.fg;
  const fontSize = 78,
    lineH = 108,
    maxW = W - pad * 2;
  x.font = `600 ${fontSize}px "Cormorant Garamond", "Noto Serif SC", "Songti SC", serif`;
  const lines = wrapCJK(x, convo.insight, maxW);
  let yy = 430;
  lines.forEach((ln) => {
    x.fillText(ln, pad, yy);
    yy += lineH;
  });

  /* divider */
  yy += 18;
  x.strokeStyle = p.divider;
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(pad, yy);
  x.lineTo(pad + 64, yy);
  x.stroke();

  /* provenance */
  yy += 52;
  x.fillStyle = p.fgSoft;
  x.font = '30px "IBM Plex Mono", monospace';
  x.fillText(`由一段关于《${convo.bookT} · ${convo.chap}》的对话提炼`, pad, yy);
  yy += 44;
  const orig =
    "原文：「" + (convo.quote.length > 20 ? convo.quote.slice(0, 20) + "…" : convo.quote) + "」";
  x.fillText(orig, pad, yy);

  /* footer brand bar */
  const fy = H - 110;
  x.strokeStyle = p.rule;
  x.lineWidth = 1.5;
  x.beginPath();
  x.moveTo(pad, fy);
  x.lineTo(W - pad, fy);
  x.stroke();
  /* seal */
  x.fillStyle = p.sealBg;
  x.fillRect(pad, fy + 26, 44, 56);
  x.fillStyle = p.sealFg;
  x.font = '600 30px "Cormorant Garamond","Songti SC",serif';
  x.textAlign = "center";
  x.fillText(convo.seal, pad + 22, fy + 66);
  x.textAlign = "left";
  /* brand text */
  x.fillStyle = p.fg;
  x.font = '600 34px "Cormorant Garamond","Songti SC",serif';
  x.fillText("Liber", pad + 62, fy + 52);
  x.fillStyle = p.fgFaint;
  x.font = '20px "IBM Plex Mono", monospace';
  x.fillText("永存的开放图书馆 · 已永久存证", pad + 62, fy + 80);
  /* right: CC0 */
  x.textAlign = "right";
  x.fillStyle = p.fgFaint;
  x.font = '22px "IBM Plex Mono", monospace';
  x.fillText("CC0 · 自由传播", W - pad, fy + 52);
  x.fillStyle = p.fgGhost;
  x.font = '18px "IBM Plex Mono", monospace';
  x.fillText("walrus://0x8f3a…d21c", W - pad, fy + 80);
  x.textAlign = "left";

  cv.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${convo.bookT}·金句·${p.label}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }, "image/png");
}

/* wrap CJK + latin by measuring per character */
function wrapCJK(ctx, text, maxW) {
  const lines = [];
  let line = "";
  for (const chTok of Array.from(text)) {
    const test = line + chTok;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = chTok;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export { ConvoArtifact, ConvoCardForm, InsightCardForm, ForkTreeModal, exportInsightImage };
