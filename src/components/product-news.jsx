import React from "react";
import { getNews, findNewsPost } from "../data/news-data.js";
import { clickable } from "../lib/a11y.js";

/* product-news.jsx — 动态 / News.
   A lightweight blog surface: a list of short, original posts plus an
   article reader. The flagship post explains what the public domain is
   and why Liber can build an entire library on it.

   Two screens, wired in product-app.jsx via route.screen:
     "news"     → <News>      the index / list
     "newsPost" → <NewsPost>  a single article */

/* ---- inline **bold** ---- */
function inline(text) {
  const parts = String(text).split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) =>
    i % 2 === 1 ? <b key={i}>{p}</b> : <React.Fragment key={i}>{p}</React.Fragment>,
  );
}

/* ---- one article body block ---- */
function Block({ b }) {
  if (b.type === "h2") return <h2 className="art-h">{b.text}</h2>;
  if (b.type === "quote")
    return (
      <blockquote className="art-quote">
        <span>{inline(b.text)}</span>
        {b.cite && <cite>— {b.cite}</cite>}
      </blockquote>
    );
  if (b.type === "ul")
    return (
      <ul className="art-ul">
        {b.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </ul>
    );
  return <p className={"art-p" + (b.lead ? " lead" : "")}>{inline(b.text)}</p>;
}

function fmtDate(d) {
  return String(d || "").replace(/-/g, " · ");
}

/* ---- News index ---- */
function News({ onOpenPost, onBack }) {
  const posts = getNews();
  return (
    <div className="app-screen">
      <div className="news">
        <div className="news-wrap">
          <div className="crumb" style={{ paddingTop: 24 }}>
            <a onClick={onBack}>书库</a> <span>/</span>{" "}
            <span style={{ color: "var(--ink)" }}>动态</span>
          </div>
          <div className="news-head">
            <div className="kicker">动态 · News</div>
            <h1 className="news-title">
              关于这座图书馆，
              <br />
              我们想说的话。
            </h1>
            <p className="news-sub">
              一些短文与公告——关于公共领域、关于永久保存、关于我们为什么这样做事。 所有原创内容均以{" "}
              <b>CC0</b> 发布，欢迎自由转载。
            </p>
          </div>

          <div className="news-list">
            {posts.map((p) => (
              <article className="news-card" key={p.id} {...clickable(() => onOpenPost(p.id))}>
                <div className={"news-seal " + (p.cls || "ink")}>{p.seal || "文"}</div>
                <div className="news-body">
                  <div className="news-meta">
                    <span className="news-tag">{p.tag}</span>
                    <span className="news-date">{fmtDate(p.date)}</span>
                  </div>
                  <h2 className="news-card-title">{p.title}</h2>
                  <p className="news-excerpt">{p.excerpt}</p>
                  <span className="news-more">
                    阅读全文 <span className="arr">→</span>
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Single article ---- */
function NewsPost({ postId, onOpenPost, onBack }) {
  const post = findNewsPost(postId);
  const posts = getNews();

  if (!post) {
    return (
      <div className="app-screen">
        <div className="news">
          <div className="news-wrap" style={{ paddingTop: 80 }}>
            <div className="kicker">动态</div>
            <h1 className="display-m" style={{ margin: "14px 0" }}>
              没有找到这篇文章。
            </h1>
            <button type="button" className="btn btn-primary" onClick={onBack}>
              回到动态 <span className="arr">→</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const more = posts.filter((p) => p.id !== post.id).slice(0, 2);

  return (
    <div className="app-screen">
      <div className="news">
        <div className="article-wrap">
          <div className="crumb" style={{ paddingTop: 24 }}>
            <a onClick={onBack}>动态</a> <span>/</span>{" "}
            <span style={{ color: "var(--ink)" }}>{post.tag}</span>
          </div>

          <header className="article-head">
            <div className="article-meta">
              <span className="news-tag">{post.tag}</span>
              <span className="news-date">{fmtDate(post.date)}</span>
              <span className="news-date">{post.author}</span>
            </div>
            <h1 className="article-title">{post.title}</h1>
            {post.excerpt && <p className="article-lede">{post.excerpt}</p>}
          </header>

          <div className="article-body">
            {post.body.map((b, i) => (
              <Block key={i} b={b} />
            ))}
          </div>

          <footer className="article-foot">
            <span className="article-license">
              本文由 {post.author} 原创，并以 <b>{post.license}</b> 公共领域贡献声明发布 ·
              可自由转载、翻译、改编
            </span>
          </footer>

          {more.length > 0 && (
            <div className="article-more">
              <div className="article-more-h">继续读</div>
              <div className="article-more-grid">
                {more.map((p) => (
                  <div
                    className="article-more-card"
                    key={p.id}
                    {...clickable(() => onOpenPost(p.id))}
                  >
                    <span className="news-tag">{p.tag}</span>
                    <div className="article-more-title">{p.title}</div>
                    <div className="article-more-ex">{p.excerpt}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 36 }}>
            <button type="button" className="btn btn-ghost" onClick={onBack}>
              ← 全部动态
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { News, NewsPost };
