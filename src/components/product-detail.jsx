import React from "react";
import { Cover, I } from "./product-shared.jsx";
import { CommentsPanel } from "./product-social.jsx";

/* product-detail.jsx — Book detail page. */
function Detail({ bookId, onOpenReader, onOpenCert, onBack, onOpenAgents }){
  const book = window.BOOKS.find(b => b.id === bookId) || window.BOOKS[0];
  const hasContent = book.id === "daodejing";
  const toc = hasContent ? window.TOC : null;
  const highlights = hasContent ? window.HIGHLIGHTS : null;
  const reviews = hasContent ? window.REVIEWS : null;
  const [cmtOpen, setCmtOpen] = React.useState(false);

  return (
    <div className="app-screen">
      <div className="detail">
        <div className="detail-wrap">
          <div className="crumb">
            <a onClick={onBack}>书库</a> <span>/</span> <span>{book.cat}</span> <span>/</span>
            <span style={{ color: "var(--ink)" }}>{book.t}</span>
          </div>

          <div className="detail-grid">
            {/* left rail */}
            <div className="detail-rail">
              <Cover book={book} />
              <div className="detail-actions">
                <button className="btn btn-primary btn-block" onClick={() => onOpenReader(book.id)}>
                  {I.book} 开始阅读
                </button>
                <button className="btn btn-ghost btn-block">＋ 加入书架</button>
              </div>
              <div className="detail-mini">
                <div><div className="n">{book.pages}</div><div className="l">章 / 节</div></div>
                <div><div className="n">{book.words.replace("约 ","")}</div><div className="l">篇幅</div></div>
                <div><div className="n">{book.reads}</div><div className="l">在读</div></div>
                <div><div className="n">{book.lines}</div><div className="l">划线</div></div>
              </div>
            </div>

            {/* main */}
            <div className="detail-main">
              <div className="cat">{book.cat}</div>
              <h1>{book.t}</h1>
              <div className="orig">{book.sub} · {book.year}</div>
              <div className="byline">{book.a}</div>
              <p className="lede">{book.blurb}</p>
              {book.long && <p className="body">{book.long}</p>}
              <div className="meta-tags">
                <span className="meta-tag">{book.lang}</span>
                <span className="meta-tag">CC0 公共领域</span>
                <span className="meta-tag">{book.year}</span>
                <span className="meta-tag">已永久存证</span>
              </div>

              <div className="agent-track" onClick={onOpenAgents}>
                <div className="at-avas">
                  {["友","导","思","考"].map((s,i)=>(
                    <span key={i} className="at-ava" style={{ background:["var(--accent)","#2e7d57","#3a4fb0","#9a5b2e"][i], marginLeft:i?-9:0, zIndex:9-i }}>{s}</span>
                  ))}
                </div>
                <div className="at-txt"><b>4 个 Agent</b> 正在追踪这本书的讨论 · 导读 Agent 已生成一份摘要</div>
                <span className="at-go">Agent 广场 →</span>
              </div>

              {/* TOC */}
              {toc && (
                <div className="dsec">
                  <div className="dsec-h">
                    <span className="t">目录</span>
                    <span className="c">{book.pages} 章 · {toc.filter(t=>t.has).length} 章可试读</span>
                    <span className="more" onClick={() => onOpenReader(book.id)}>从头开始 →</span>
                  </div>
                  <div className="toc-list">
                    {toc.map(t => (
                      <div className="toc-row" key={t.n}
                        onClick={() => t.has && onOpenReader(book.id, t.n)}
                        style={!t.has ? { cursor: "default", opacity: .5 } : null}>
                        <span className="num">{String(t.n).padStart(2,"0")}</span>
                        <span className="tt">{t.title}</span>
                        {!t.has && <span className="lock">{I.lock}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* permanence proof */}
              <div className="dsec">
                <div className="dsec-h">
                  <span className="t">永久存证</span>
                  <span className="c">没有人能单方面删除它 — 包括我们自己</span>
                  <span className="more" onClick={() => onOpenCert(book.id)}>查看存证证书 →</span>
                </div>
                <div className="proof-card">
                  <div className="ph">{book.t} · 链上记录 <span className="ok">● 已永久存证</span></div>
                  <div className="pr"><span className="k">blob_id</span><span className="v">{book.blob}</span></div>
                  <div className="pr"><span className="k">backup</span><span className="v">{book.backup}</span></div>
                  <div className="pr"><span className="k">index</span><span className="v">{book.index}</span></div>
                  <div className="pr"><span className="k">license</span><span className="v">CC0 1.0 Universal</span></div>
                </div>
              </div>

              {/* popular highlights */}
              {highlights && (
                <div className="dsec">
                  <div className="dsec-h">
                    <span className="t">热门划线</span>
                    <span className="c">被最多人记住的句子</span>
                  </div>
                  <div className="hl-list">
                    {highlights.map(h => (
                      <div className="hl-row" key={h.rank}>
                        <span className="rank">{h.rank}</span>
                        <div>
                          <div className="q">「{h.q}」</div>
                          <div className="c">{h.c} · {h.n}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* reviews */}
              {reviews && (
                <div className="dsec">
                  <div className="dsec-h">
                    <span className="t">读者说</span>
                    <span className="c">{reviews.length} 条 · 平均 4.8 ★</span>
                  </div>
                  {reviews.map((r,i) => (
                    <div className="review" key={i}>
                      <div className="ava" style={{ background: r.color }}>{r.u[0]}</div>
                      <div className="rb">
                        <div className="top">
                          <span className="nm">{r.u}</span>
                          <span className="stars">{"★".repeat(r.rating)}{"☆".repeat(5-r.rating)}</span>
                          <span className="chap">{r.chap}</span>
                          <span className="when">{r.when}</span>
                        </div>
                        <div className="tx">{r.t}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* discussion — generic comments on the book (D1 → Walrus/Sui) */}
              <div className="dsec">
                <div className="dsec-h">
                  <span className="t">讨论</span>
                  <span className="c">读这本书的人在聊什么</span>
                  <span className="more" onClick={() => setCmtOpen(o => !o)}>{cmtOpen ? "收起 ↑" : "展开 / 发表评论 ↓"}</span>
                </div>
                {cmtOpen && <CommentsPanel targetType="book" targetId={book.id} />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { Detail };
