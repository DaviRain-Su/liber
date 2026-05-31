import React from "react";
import { I } from "./product-shared.jsx";
import { findCatalogBook, getCatalogTotal, licenseLabel } from "../lib/catalog.js";

/* product-agentview.jsx — "Agent View": flip any page into the structured,
   addressable, MCP representation an AI Agent sees. Reuses .term styles. */
const { useState: useAv } = React;

const MCP_TOOLS = [
  { name:"liber.search", sig:"(query) → Book[]", desc:"全文检索书名 / 作者 / 句子" },
  { name:"liber.read_passage", sig:"(book, ch, range) → Text", desc:"按章节/段落定位正文" },
  { name:"liber.get_highlights", sig:"(book) → Highlight[]", desc:"热门划线与计数" },
  { name:"liber.get_conversations", sig:"(book, sid?) → Convo[]", desc:"读者×AI 的公开对话与 fork 树" },
  { name:"liber.get_echoes", sig:"(sid) → Echo[]", desc:"跨书呼应（连接层）" },
  { name:"liber.get_graph", sig:"(limit?) → {nodes,edges}", desc:"全馆思维链接图谱（书↔书呼应网络）" },
  { name:"liber.post_annotation", sig:"(sid, text, sig) → id", desc:"以签名身份写入批注" },
];

function JLine({ k, v, t, last, indent=1 }){
  const cls = t==="str" ? "str" : t==="key" ? "key" : t==="num" ? "num" : "";
  return (
    <div className="out" style={{ paddingLeft: indent*16 }}>
      {k && <span className="key">"{k}"</span>}{k && ": "}
      <span className={cls}>{t==="str" ? `"${v}"` : String(v)}</span>{!last && ","}
    </div>
  );
}

function AgentView({ context, onClose, onCopy, onSquare, onGraph }){
  const book = context.book;
  const ctxCharts = context.charts;
  const corpus = !book && !ctxCharts;
  const addr = book
    ? { uri:`liber://${book.id}`, blob:book.blob, index:book.index, license:book.license || "CC0-1.0" }
    : { uri:"liber://registry", blob:"walrus://0x00…root", index:"sui::registry::Library", license:"CC0-1.0" };

  if (ctxCharts){
    const winMap = { today:"today", week:"7d", month:"30d" };
    const data = ((window.CHARTS||{})[ctxCharts.win]||[]);
    const surge = (window.SURGE||{})[ctxCharts.win]||{};
    const ranked = ctxCharts.metric==="surge"
      ? [...data].sort((a,b)=>(surge[b.id]||0)-(surge[a.id]||0))
      : [...data].sort((a,b)=>b[ctxCharts.metric]-a[ctxCharts.metric]);
    const top = ranked.slice(0,5);
    return (
      <>
        <div className="drawer-scrim" onClick={onClose}/>
        <div className="agentview-drawer">
          <div className="av-head">
            <div className="av-orb">{I.agent}</div>
            <div><div className="av-t">Agent 视角 · 榜单</div><div className="av-s">同一份榜单，Agent 调用到的样子</div></div>
            <span className="x" onClick={onClose}>{I.x}</span>
          </div>
          <div className="av-body">
            <div className="av-sec">
              <div className="av-h">这份榜单的地址</div>
              <div className="av-addr">
                <div className="ar"><span className="k">liber</span><code>liber://charts/{ctxCharts.win}/{ctxCharts.metric}</code><span className="copy" onClick={()=>onCopy(`liber://charts/${ctxCharts.win}/${ctxCharts.metric}`)}>{I.copy}</span></div>
                <div className="ar"><span className="k">refresh</span><code>every 10m · on-chain</code></div>
                <div className="ar"><span className="k">license</span><code>CC0-1.0 · 无需鉴权</code></div>
              </div>
            </div>
            <div className="av-sec">
              <div className="av-h">Agent 怎么调用它</div>
              <div className="term">
                <div className="tbar"><i></i><i></i><i></i></div>
                <div className="tbody">
                  <div className="cmd"><span className="pr">agent ❯</span> liber.get_charts(<span className="str">"{winMap[ctxCharts.win]}"</span>, <span className="str">"{ctxCharts.metric}"</span>)</div>
                  <div className="out" style={{margin:"6px 0 12px"}}>→ 读取链上聚合信号…</div>
                  <div className="out">{"["}</div>
                  {top.map((r,i)=>{
                    const b=findCatalogBook(r.id)||{};
                    const val = ctxCharts.metric==="surge" ? (surge[r.id]||0)+"%" : r[ctxCharts.metric];
                    return (
                      <div className="out" key={r.id} style={{paddingLeft:16}}>{"{ "}<span className="key">"rank"</span>: <span className="num">{i+1}</span>, <span className="key">"title"</span>: <span className="str">"{b.t}"</span>, <span className="key">"{ctxCharts.metric}"</span>: <span className="str">{val}</span> {"}"}{i<top.length-1?",":""}</div>
                    );
                  })}
                  <div className="out">{"]"}</div>
                  <div className="cmd" style={{marginTop:10}}><span className="pr">agent ❯</span> <span style={{opacity:.5}}>▍</span></div>
                </div>
              </div>
            </div>
            <div className="av-sec">
              <div className="av-h">能拿它做什么</div>
              <div className="av-tools">
                <div className="av-tool"><div className="at-top"><code className="at-name">导读 Agent</code></div><div className="at-desc">追踪飙升榜，自动给冒头的书生成导读</div></div>
                <div className="av-tool"><div className="at-top"><code className="at-name">推荐 Agent</code></div><div className="at-desc">把热句榜接入"接着读"，顺着潮流荐书</div></div>
                <div className="av-tool"><div className="at-top"><code className="at-name">研究 Agent</code></div><div className="at-desc">按 30 天趋势做公共阅读的计量分析</div></div>
              </div>
            </div>
          </div>
          <div className="av-foot">榜单不是排他的产品功能，而是<b>一份谁都能读的公共信号</b> · <span className="av-square-link" onClick={onSquare}>看看哪些 Agent 在用它 →</span></div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose}/>
      <div className="agentview-drawer">
        <div className="av-head">
          <div className="av-orb">{I.agent}</div>
              <div><div className="av-t">Agent 视角</div><div className="av-s">{corpus ? "整座图书馆" : `《${book.t}》`} · AI Agent 看到的样子</div></div>
          <span className="x" onClick={onClose}>{I.x}</span>
        </div>

        <div className="av-body">
          {/* addressable */}
          <div className="av-sec">
            <div className="av-h">可寻址对象 · 每个对象都有稳定地址</div>
            <div className="av-addr">
              <div className="ar"><span className="k">liber</span><code>{addr.uri}</code><span className="copy" onClick={()=>onCopy(addr.uri)}>{I.copy}</span></div>
              <div className="ar"><span className="k">blob</span><code>{addr.blob}</code></div>
              <div className="ar"><span className="k">index</span><code>{addr.index}</code></div>
              <div className="ar"><span className="k">license</span><code>{licenseLabel(addr.license)}</code></div>
            </div>
          </div>

          {/* structured object */}
          <div className="av-sec">
            <div className="av-h">结构化对象 · JSON</div>
            <div className="av-json term">
              <div className="tbody">
                <div className="out">{"{"}</div>
                {book ? (
                  <>
                    <JLine k="type" v="Book" t="str"/>
                    <JLine k="title" v={book.t} t="str"/>
                    <JLine k="author" v={book.a} t="str"/>
                    <JLine k="year" v={book.year} t="str"/>
                    <JLine k="chapters" v={book.pages} t="num"/>
                    <JLine k="reads_30d" v={book.readsN} t="num"/>
                    <JLine k="liners" v={book.liners} t="num"/>
                    <JLine k="annotations" v={book.annos} t="num"/>
                    <div className="out" style={{paddingLeft:16}}><span className="key">"addressable"</span>: {"["}</div>
                    <div className="out" style={{paddingLeft:32}}><span className="str">"chapter"</span>, <span className="str">"paragraph"</span>, <span className="str">"sentence"</span>, <span className="str">"highlight"</span>, <span className="str">"conversation"</span></div>
                    <div className="out" style={{paddingLeft:16}}>{"],"}</div>
                    <JLine k="license" v={book.license || "CC0-1.0"} t="str" last/>
                  </>
                ) : (
                  <>
                    <JLine k="type" v="Library" t="str"/>
                    <JLine k="volumes" v={getCatalogTotal()} t="num"/>
                    <JLine k="storage" v="walrus + arweave + ipfs" t="str"/>
                    <JLine k="auth_required" v={false} t="num"/>
                    <JLine k="rate_limit" v="none" t="str"/>
                    <JLine k="license" v="CC0-1.0" t="str" last/>
                  </>
                )}
                <div className="out">{"}"}</div>
              </div>
            </div>
          </div>

          {/* MCP tools */}
          <div className="av-sec">
            <div className="av-h">可调用的 MCP 工具</div>
            <div className="av-tools">
              {MCP_TOOLS.map(t => (
                <div className="av-tool" key={t.name}>
                  <div className="at-top"><code className="at-name">{t.name}</code><code className="at-sig">{t.sig}</code></div>
                  <div className="at-desc">{t.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* example call */}
          <div className="av-sec">
            <div className="av-h">示例调用</div>
            <div className="term">
              <div className="tbar"><i></i><i></i><i></i></div>
              <div className="tbody">
                <div className="cmd"><span className="pr">agent ❯</span> liber.{book ? "get_top_highlight" : "query"}(<span className="str">"{book ? book.t : "最畅销的哲学公版书"}"</span>)</div>
                <div className="out" style={{margin:"6px 0 12px"}}>→ 经 MCP 读取链上索引…</div>
                <div className="out">{"{"}</div>
                <div className="out" style={{paddingLeft:16}}><span className="key">"title"</span>: <span className="str">"{book ? book.t : "道德经"}"</span>,</div>
                <div className="out" style={{paddingLeft:16}}><span className="key">"top_highlight"</span>: <span className="str">"知人者智，自知者明"</span>,</div>
                <div className="out" style={{paddingLeft:16}}><span className="key">"liners"</span>: <span className="str">{book ? book.liners : 8402}</span>,</div>
                <div className="out" style={{paddingLeft:16}}><span className="key">"blob"</span>: <span className="str">{addr.blob}</span></div>
                <div className="out">{"}"}</div>
                <div className="cmd" style={{marginTop:10}}><span className="pr">agent ❯</span> <span style={{opacity:.5}}>▍</span></div>
              </div>
            </div>
          </div>
        </div>

        <div className="av-foot">全部 CC0 · 无需鉴权 · 无抽成 · 无下架 — <b>内容即接口</b><br/>
          {onGraph && <span className="av-square-link" onClick={onGraph}>看全馆思维链接图谱 →</span>}
          {onGraph && <br/>}
          <span className="av-square-link" onClick={onSquare}>浏览 Agent 广场 —谁在读这座图书馆 →</span></div>
      </div>
    </>
  );
}

export { AgentView };
