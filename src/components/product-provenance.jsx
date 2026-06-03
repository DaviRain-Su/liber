import React from "react";
import { I } from "./product-shared.jsx";

/* product-provenance.jsx — provenance badge + detail popover.
   Distinguishes 人 / AI Agent, shows 已签名 + 被引用 N, with an on-chain detail. */
const { useState: useProv } = React;

/* resolve an annotation-ish object into provenance facts */
function provFacts(n) {
  const ag = n.agent ? (window.AGENTS || {})[n.agent] : null;
  return {
    isAgent: !!n.ai || !!ag,
    name: ag ? ag.name : n.u || n.name || "读者",
    model: ag ? ag.model : null,
    by: ag ? ag.by : null,
    sig: ag
      ? ag.sig
      : n.sig ||
        "sui:0x" +
          (Math.abs(hashStr(n.u || n.name || "x")).toString(16) + "0000").slice(0, 4) +
          "…" +
          (Math.abs(hashStr(n.t || "")).toString(16) + "00").slice(0, 2) +
          "f1",
    signed: n.signed !== false,
    cited: n.cited || 0,
    when: n.when || null,
  };
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

function ProvBadge({ note, mine }) {
  const [open, setOpen] = useProv(null); // {x,y}
  const f = provFacts(note);
  const onClick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setOpen({ x: r.left, y: r.bottom + 6 });
  };
  return (
    <>
      <span className="prov" onClick={onClick}>
        <span className="prov-nm">
          {f.name}
          {mine && " · 你"}
        </span>
        {f.isAgent && <span className="prov-kind">AI Agent</span>}
        {f.signed && (
          <span className="prov-sig" title="链上签名">
            ✓ 已签名
          </span>
        )}
        {f.cited > 0 && <span className="prov-cite">被引用 {f.cited.toLocaleString()}</span>}
      </span>
      {open && <ProvDetail f={f} pos={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ProvDetail({ f, pos, onClose }) {
  return (
    <>
      <div
        className="drawer-scrim"
        style={{ background: "transparent", zIndex: 852 }}
        onClick={onClose}
      />
      <div
        className="prov-detail"
        style={{ left: Math.min(pos.x, window.innerWidth - 300), top: pos.y }}
      >
        <div className="pd-head">
          <span className={"pd-orb" + (f.isAgent ? " agent" : "")}>
            {f.isAgent ? I.agent : f.name[0]}
          </span>
          <div>
            <div className="pd-nm">{f.name}</div>
            <div className="pd-kind">{f.isAgent ? `AI Agent · ${f.model}` : "人类读者"}</div>
          </div>
        </div>
        <div className="pd-rows">
          {f.by && (
            <div className="pd-row">
              <span className="k">来源</span>
              <span className="v">{f.by}</span>
            </div>
          )}
          <div className="pd-row">
            <span className="k">签名</span>
            <span className="v mono">{f.sig}</span>
          </div>
          <div className="pd-row">
            <span className="k">状态</span>
            <span className="v ok">● 已链上签名 · 任何人可验证</span>
          </div>
          <div className="pd-row">
            <span className="k">被引用</span>
            <span className="v">
              {f.cited.toLocaleString()} 次{f.isAgent && " · 可被其他 Agent 引用"}
            </span>
          </div>
          {f.when && (
            <div className="pd-row">
              <span className="k">时间</span>
              <span className="v">{f.when}</span>
            </div>
          )}
        </div>
        <div className="pd-foot">
          {f.isAgent ? "由 Agent 产出 · 已标注来源，不冒充人类" : "由人写下 · 钱包签名，归属于本人"}
        </div>
        {!f.isAgent && window.canOpenProfile(f.name) && (
          <button
            className="pd-visit"
            onClick={() => {
              onClose();
              window.openProfile(f.name);
            }}
          >
            查看 {f.name} 的主页 {I.right}
          </button>
        )}
      </div>
    </>
  );
}

export { ProvBadge, provFacts };
