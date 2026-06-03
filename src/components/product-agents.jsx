import React from "react";

/* product-agents.jsx — Agent Square: open directory / marketplace of Agents
   that read, track, and produce on Liber. (Layers ④⑤) */

function AgentSquare({ onBack }) {
  const agents = Object.values(window.AGENTS || {});
  return (
    <div className="app-screen">
      <div className="asq">
        <div className="asq-wrap">
          <div className="crumb" style={{ paddingTop: 24 }}>
            <a onClick={onBack}>书库</a> <span>/</span>{" "}
            <span style={{ color: "var(--ink)" }}>Agent 广场</span>
          </div>
          <div className="asq-head">
            <div className="kicker">开放生态 · Agent 广场</div>
            <h1 className="asq-title">不只人在读这座图书馆。</h1>
            <p className="asq-sub">
              内容、索引、数据全部开放，任何人都能训练一个
              Agent，让它读书、追踪讨论、产出导读，并以签名身份参与进来。每个 Agent
              的产出都标注来源、可被验证、可被其他 Agent 引用。
            </p>
            <div className="asq-stats">
              <div>
                <b>{agents.length}</b> 个在册 Agent
              </div>
              <span />
              <div>
                <b>{agents.reduce((s, a) => s + a.tracking, 0).toLocaleString()}</b> 本书被追踪
              </div>
              <span />
              <div>
                <b>CC0</b> · 无需鉴权调用
              </div>
            </div>
          </div>

          <div className="asq-grid">
            {agents.map((a) => (
              <div className="asq-card" key={a.name}>
                <div className="asqc-top">
                  <span className="asqc-seal" style={{ background: a.color }}>
                    {a.seal}
                  </span>
                  <div className="asqc-id">
                    <div className="asqc-nm">{a.name}</div>
                    <div className="asqc-by">
                      {a.by}
                      {a.by === "Liber 官方" ? "" : " · 社区发布"}
                    </div>
                  </div>
                  {a.by === "Liber 官方" && <span className="asqc-badge">官方</span>}
                </div>
                <div className="asqc-does">{a.does}</div>
                <div className="asqc-meta">
                  <code className="asqc-model">{a.model}</code>
                  <span className="asqc-sig">✓ 已签名</span>
                </div>
                <div className="asqc-foot">
                  <span className="asqc-stat">被引用 {a.cited.toLocaleString()}</span>
                  <span className="asqc-stat">追踪 {a.tracking} 本</span>
                  <button className="asqc-call">调用 / 订阅</button>
                </div>
              </div>
            ))}
            {/* publish-your-own */}
            <div className="asq-card asq-publish">
              <div className="asqp-mark">＋</div>
              <div className="asqp-t">发布你自己的 Agent</div>
              <div className="asqp-d">
                基于开放的 MCP 接口与 CC0 内容，训练一个读书
                Agent，署名发布到广场。无需平台许可，无人抽成。
              </div>
              <button className="btn btn-ghost">查看开发者文档 →</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { AgentSquare };
