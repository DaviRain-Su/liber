import React from "react";
import { Mark, I } from "./product-shared.jsx";

/* product-landing.jsx — the public marketing landing page.
   A faithful React port of the design's Liber.html. Uses the landing-page
   classes that already live in src/styles/liber.css (hero, perm-grid, proof,
   read-frame, role-grid, soc-grid, agent-grid, term, coll-grid, cta, reveal…).

   Two real CTAs:
     onEnter   — 开始阅读：不登录，直接进入书库
     onSignIn  — 连接钱包 / 登录：进入 onboarding 流程 */
const { useState, useEffect, useRef } = React;

/* AI 书友演示线程（与设计稿一致，tab 可切换） */
const THREADS = {
  companion: {
    role: "通读陪伴模式", ph: "问问书友这一句……",
    msgs: [
      { who: "user", t: "「道可道，非常道」到底在说什么？" },
      { who: "ai", t: "可以这样理解：能用语言说清楚的「道」，就已经不是那个恒常的、根本的道了。老子一上来就提醒你——真正的道超出语言。", ref: "道德经 · 第一章" },
      { who: "user", t: "那读它还有意义吗？" },
      { who: "ai", t: "有。语言是指月的手指。读下去你会发现，他用「水」「婴儿」「谷」一类比喻，反复绕着那个说不尽的东西——这正是读《道德经》的乐趣。" },
    ],
  },
  extend: {
    role: "知识延展模式", ph: "这个概念还出现在哪些书里？",
    msgs: [
      { who: "user", t: "「无为」这个概念，别的书里怎么讲？" },
      { who: "ai", t: "它在道家里反复出现。庄子把它推得更远——「无为而无不为」。如果你感兴趣，馆里的《庄子·逍遥游》正好接着讲。", ref: "↗ 跳转：庄子 · 逍遥游" },
      { who: "ai", t: "换个视角，亚当·斯密「看不见的手」也有几分「无为」的影子：不刻意干预，秩序自然生成。要不要对照读一段《国富论》？", ref: "↗ 跳转：国富论 · 第四篇" },
    ],
  },
  notes: {
    role: "总结笔记模式", ph: "帮我总结这一章……",
    msgs: [
      { who: "user", t: "帮我把第一章整理成笔记。" },
      { who: "ai", t: "已为你生成 ——\n① 道不可言说，语言有边界；\n② 无名 / 有名：天地之始 与 万物之母；\n③「玄之又玄」是认识万物的门径。", ref: "已存入你的读书笔记 · 可导出" },
      { who: "user", t: "加上我划的那句。" },
      { who: "ai", t: "好的，已把你的划线「道可道，非常道」与你的批注一并归档到本章笔记。" },
    ],
  },
  debate: {
    role: "苏格拉底模式", ph: "我想和你辩一辩……",
    msgs: [
      { who: "user", t: "我觉得「无为」就是消极、什么都不做。" },
      { who: "ai", t: "那我问你：农夫不拔苗助长，是「什么都不做」，还是恰恰做了最该做的事？", ref: "反问 · 苏格拉底式" },
      { who: "user", t: "……好像是顺应规律地做。" },
      { who: "ai", t: "对。那么「无为」究竟是不作为，还是「不妄为」？这两者的差别，可能正是老子想让你停下来想的地方。" },
    ],
  },
};

/* Hero 叠放的三本书封面 */
const HERO_COVERS = [
  { cls: "ink", top: "CC0 · LAOZI", title: "道德經", size: 40, author: "老子", seal: "永", pos: "cv-1" },
  { cls: "cream", top: "CC0 · A. SMITH", title: "國富論", size: 33, author: "亚当·斯密", seal: "藏", pos: "cv-2" },
  { cls: "cinnabar", top: "CC0 · AURELIUS", title: "沉思錄", size: 38, author: "马可·奥勒留", seal: "册", pos: "cv-3" },
];

function MiniCover({ b }) {
  return (
    <div className={`cover ${b.cls}`}>
      <div className="c-top">CC0</div>
      <div><div className="c-title">{b.t}</div></div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div className="c-author">{b.a}</div>
        <div className="c-seal">{b.seal}</div>
      </div>
    </div>
  );
}

function Landing({ onEnter, onSignIn }) {
  const rootRef = useRef(null);
  const navRef = useRef(null);
  const [mode, setMode] = useState("companion");
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark"
  );

  const BOOKS = (typeof window !== "undefined" && window.BOOKS) || [];

  /* nav 滚动态 */
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* reveal-on-scroll：内联样式强制可见，绝不会卡在隐藏态 */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reveals = Array.from(root.querySelectorAll(".reveal"));
    const show = (el) => { el.classList.add("in"); el.style.opacity = "1"; el.style.transform = "none"; };
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => { if (en.isIntersecting) { show(en.target); io.unobserve(en.target); } }),
      { threshold: 0.08, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach((el) => io.observe(el));
    requestAnimationFrame(() => reveals.forEach((el) => { if (el.getBoundingClientRect().top < window.innerHeight * 0.96) show(el); }));
    const t = setTimeout(() => reveals.forEach(show), 1400);
    return () => { io.disconnect(); clearTimeout(t); };
  }, []);

  const toggleTheme = () => {
    const dk = document.documentElement.getAttribute("data-theme") === "dark";
    document.documentElement.setAttribute("data-theme", dk ? "light" : "dark");
    setDark(!dk);
    document.dispatchEvent(new Event("liber-theme"));
  };

  const thread = THREADS[mode];

  return (
    <div className="landing" ref={rootRef}>
      {/* ============ NAV ============ */}
      <nav className="nav" ref={navRef} id="nav">
        <a className="brand" href="#top" aria-label="Liber" onClick={(e) => e.preventDefault()}>
          <Mark size={30} />
          <span>
            <div className="word">Liber</div>
            <div className="sub">永存的开放图书馆</div>
          </span>
        </a>
        <div className="nav-links">
          <a href="#discover">书库</a>
          <a href="#permanence">永久保存</a>
          <a href="#ai">AI 书友</a>
          <a href="#social">共读</a>
          <a href="#open">开放协议</a>
        </div>
        <div className="nav-right">
          <button className="theme-btn" onClick={toggleTheme} aria-label="切换主题">
            {dark ? I.sun : I.moon}
          </button>
          <button className="btn btn-ghost" onClick={onSignIn}>登录</button>
          <button className="btn btn-primary" onClick={onEnter}>开始阅读 <span className="arr">→</span></button>
        </div>
      </nav>

      <span id="top" />

      {/* ============ HERO ============ */}
      <header className="hero">
        <div className="wrap">
          <div className="hero-grid">
            <div>
              <span className="kicker reveal">CC0 · 去中心化 · 开源</span>
              <h1 className="display-xl reveal d1">永远<br /><span className="serif-it">不会丢失</span><br />的图书馆<span className="seal">.</span></h1>
              <p className="lede reveal d2">人类的公共知识，本就属于所有人。Liber 把它们永久写入去中心化网络，配上一位真正懂书的 AI 书友——开放、可被 AI Agent 读取，永不下架。</p>
              <div className="cta-row reveal d3">
                <button className="btn btn-primary" onClick={onEnter}>开始阅读 <span className="arr">→</span></button>
                <button className="btn btn-ghost" onClick={onSignIn}>连接钱包登录</button>
              </div>
              <div className="hero-stats reveal d4">
                <div><div className="n">永久</div><div className="l">Walrus · Arweave 存储</div></div>
                <div><div className="n">CC0</div><div className="l">公共版权 · 自由传播</div></div>
                <div><div className="n">100%</div><div className="l">开源 · 社区共建</div></div>
              </div>
            </div>
            <div className="hero-art reveal d2">
              {HERO_COVERS.map((c) => (
                <div className={`cover ${c.cls} ${c.pos}`} key={c.pos}>
                  <div className="c-top">{c.top}</div>
                  <div>
                    <div className="c-title" style={{ fontSize: c.size }}>{c.title}</div>
                    <div className="c-author" style={{ marginTop: 8 }}>{c.author}</div>
                  </div>
                  <div className="c-seal">{c.seal}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* ============ DISCOVER ============ */}
      <section className="sec" id="discover">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="kicker">书库 / 发现</span>
            <h2 className="display-l">一座对所有人<br />敞开的书库。</h2>
            <p className="sub">每一本都是公共领域的经典，每一本都已永久上链。挑一本，开始读——无需付费，无需许可。</p>
          </div>
          <div className="frame reveal d1">
            <div className="frame-bar">
              <span className="dot" /><span className="dot" /><span className="dot" />
              <span className="url">🔒 liber.xyz/library <span style={{ opacity: 0.6 }}>· 1,284 卷已上链</span></span>
            </div>
            <div className="frame-body">
              <div className="disc">
                <aside className="disc-side">
                  <div className="s-group">
                    <div className="s-h">主题</div>
                    <div className="s-item on">全部 · 经典</div>
                    <div className="s-item">哲学 · 思想</div>
                    <div className="s-item">经济 · 政治</div>
                    <div className="s-item">文学 · 诗</div>
                    <div className="s-item">科学 · 博物</div>
                  </div>
                  <div className="s-group">
                    <div className="s-h">排序</div>
                    <div className="s-item on">最多人读</div>
                    <div className="s-item">最近上链</div>
                    <div className="s-item">划线最多</div>
                  </div>
                  <div className="s-group">
                    <div className="s-h">语言</div>
                    <div className="s-item">中文 · 英文 · 全部</div>
                  </div>
                </aside>
                <div className="shelf">
                  {BOOKS.map((b) => (
                    <div className="shelf-card" key={b.id} onClick={onEnter} role="button">
                      <MiniCover b={b} />
                      <div className="meta">
                        <div className="t">{b.t}</div>
                        <div className="a">{b.a}</div>
                        <div className="stat"><span><b>{b.reads}</b> 在读</span><span>{b.lines} 划线</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ PERMANENCE ============ */}
      <section className="sec" id="permanence" style={{ background: "var(--paper-2)" }}>
        <hr className="rule" style={{ position: "absolute", top: 0, left: 0, right: 0 }} />
        <div className="wrap">
          <div className="perm-grid">
            <div className="reveal">
              <span className="kicker">永久保存</span>
              <h2 className="display-m" style={{ marginTop: 18 }}>书会绝版，<br />平台会关停。<br /><span className="serif-it" style={{ color: "var(--accent)" }}>知识不该如此。</span></h2>
              <p className="sub" style={{ maxWidth: "42ch" }}>Liber 不把书存在某家公司的服务器上。每一卷的正文都写入 <b>Walrus（Sui 上的去中心化存储）</b> 与 <b>Arweave</b>，索引结构记录在 <b>Sui</b> 链上。没有谁能单方面删除它——包括我们自己。</p>
              <div style={{ marginTop: 28 }}><span className="badge-perm">◇ 一次写入 · 永久可读</span></div>
            </div>
            <div className="reveal d1">
              <div className="stack">
                <div className="layer"><div className="lnum">01</div><div className="ltxt"><div className="lt">正文内容</div><div className="ld">书页原文，分块寻址存储</div></div><div className="ltag">Walrus</div></div>
                <div className="layer"><div className="lnum">02</div><div className="ltxt"><div className="lt">冷备份</div><div className="ld">永久副本，跨网络冗余</div></div><div className="ltag">Arweave</div></div>
                <div className="layer"><div className="lnum">03</div><div className="ltxt"><div className="lt">索引 / 元数据</div><div className="ld">书目、章节、划线、热度</div></div><div className="ltag">Sui</div></div>
              </div>
              <div className="proof" style={{ marginTop: 18 }}>
                <div className="ph">道德经 · 存证</div>
                <div className="pr"><span className="k">blob_id</span><span className="v">walrus://0x8f3a…d21c</span></div>
                <div className="pr"><span className="k">backup</span><span className="v">ar://Qd9_kP…7Lm</span></div>
                <div className="pr"><span className="k">index</span><span className="v">sui::registry::Book#0427</span></div>
                <div className="pr"><span className="k">status</span><span className="v"><span className="ok">● 已永久存证</span></span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ AI COMPANION ============ */}
      <section className="sec" id="ai">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="kicker">AI 书友</span>
            <h2 className="display-l">读到不懂的地方，<br />身边正好有人懂。</h2>
            <p className="sub">不是冷冰冰的问答框。Liber 的 AI 读过同一本书，知道你读到了哪一页——你划一句、问一句，它就在书页旁边接上话。</p>
          </div>
          <div className="read-frame reveal d1">
            <div className="read-grid">
              <div className="read-pane">
                <div className="r-chap">道德经 · 第一章</div>
                <div className="r-title">道，可道</div>
                <div className="r-body">
                  <p><span className="hl">道可道，非常道；名可名，非常名。</span></p>
                  <p>无名天地之始，有名万物之母。故常无欲，以观其妙；常有欲，以观其徼。</p>
                  <p>此两者，同出而异名，同谓之玄。<span className="hl-people">玄</span>之又玄，众妙之门。</p>
                </div>
              </div>
              <div className="ai-pane">
                <div className="ai-head">
                  <span className="ai-orb" />
                  <div><div className="nm">书友</div><div className="role">{thread.role}</div></div>
                </div>
                <div className="ai-tabs">
                  {[["companion", "通读陪伴"], ["extend", "知识延展"], ["notes", "总结笔记"], ["debate", "苏格拉底"]].map(([k, label]) => (
                    <span key={k} className={`ai-tab${mode === k ? " on" : ""}`} onClick={() => setMode(k)}>{label}</span>
                  ))}
                </div>
                <div className="ai-thread">
                  {thread.msgs.map((m, i) =>
                    m.who === "user" ? (
                      <div className="bub user" key={i}>{m.t}</div>
                    ) : (
                      <div className="bub ai" key={i}>
                        <div className="who">书友 · AI</div>
                        {m.t.split("\n").map((line, j) => <React.Fragment key={j}>{j > 0 && <br />}{line}</React.Fragment>)}
                        {m.ref && <div className="ref">{m.ref}</div>}
                      </div>
                    )
                  )}
                </div>
                <div className="ai-input">
                  <span className="ph">{thread.ph}</span>
                  <span className="send">↑</span>
                </div>
              </div>
            </div>
          </div>
          <div className="role-grid reveal d1">
            <div className="role-card"><div className="rc-no">01 / 陪伴</div><h3>像一个边读边聊的书友</h3><p>读到哪、卡在哪，它都知道。用你能听懂的话把难句讲开，不剧透后文，陪你一章一章走完。</p></div>
            <div className="role-card"><div className="rc-no">02 / 延展</div><h3>把概念连到更大的世界</h3><p>「无为」在庄子里怎么说？亚当·斯密的「看不见的手」又是什么？一键跳到馆里的相关书与段落。</p></div>
            <div className="role-card"><div className="rc-no">03 / 笔记</div><h3>自动生成摘要与读书笔记</h3><p>每读完一章，自动整理脉络、金句与你的划线，存成可导出的笔记。回头复习，几分钟唤回整本书。</p></div>
            <div className="role-card"><div className="rc-no">04 / 思辨</div><h3>苏格拉底式地与你过招</h3><p>不只解释，还会质疑。对书中的观点提出反问，逼你想得更深——把读书变成一场对话，而非灌输。</p></div>
          </div>
        </div>
      </section>

      {/* ============ SOCIAL ============ */}
      <section className="sec" id="social" style={{ background: "var(--paper-2)" }}>
        <hr className="rule" style={{ position: "absolute", top: 0, left: 0, right: 0 }} />
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="kicker">共读 / 社交</span>
            <h2 className="display-l">一个人读，<br />和一群人一起读。</h2>
            <p className="sub">书页的边缘从不安静。在 Liber，你能看见别人在同一句话旁写下的批注、被划得最多的句子，甚至别人和 AI 的精彩对话。</p>
          </div>
          <div className="soc-grid">
            <div className="card col-7 reveal d1">
              <div className="c-k">段落级批注</div>
              <h3>在书页边缘，留下你的痕迹</h3>
              <p style={{ marginBottom: 6 }}>选中任意一句，写下批注。其他读者读到同一句时，能看见你的想法。</p>
              <div className="anno-quote">「<span className="marked">天下皆知美之为美，斯恶已。</span>」<span className="muted" style={{ fontSize: 15, fontStyle: "normal" }}>— 道德经 · 第二章</span></div>
              <div className="note">
                <div className="ava" style={{ background: "#3a4fb0" }}>林</div>
                <div className="nb"><div className="nm">林知秋</div><div className="tx">美与丑是同时被定义出来的——一旦立了标准，对立面就跟着诞生了。</div><div className="mt">12 人赞同 · 3 条回复</div></div>
              </div>
              <div className="note">
                <div className="ava" style={{ background: "var(--accent)" }}>AI</div>
                <div className="nb"><div className="nm">书友 · AI</div><div className="tx">这正是老子的「相对」观。可与第二章后文「有无相生，难易相成」连起来读。</div><div className="mt">由 23 位读者收藏进笔记</div></div>
              </div>
            </div>
            <div className="card col-5 reveal d2">
              <div className="c-k">热门划线</div>
              <h3>被最多人记住的句子</h3>
              <div style={{ marginTop: 18 }}>
                <div className="hi-row"><div className="rank">1</div><div><div className="q">「知人者智，自知者明。」</div><div className="c">道德经 · 第三十三章 · 8,402 人划线</div></div></div>
                <div className="hi-row"><div className="rank">2</div><div><div className="q">「我们感受到的不是事物本身，而是我们对它的看法。」</div><div className="c">沉思录 · 卷四 · 6,118 人划线</div></div></div>
                <div className="hi-row"><div className="rank">3</div><div><div className="q">「我们的晚餐并非来自屠夫的恩惠，而是出于他对自身利益的考虑。」</div><div className="c">国富论 · 第一篇 · 5,277 人划线</div></div></div>
              </div>
            </div>
            <div className="card col-12 reveal d1" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 36, alignItems: "center" }}>
              <div>
                <div className="c-k">可分享的对话</div>
                <h3>把一段好对话，分享出去</h3>
                <p>你和 AI 书友聊出的精彩片段，可以一键公开。其他人能浏览、收藏，甚至接着这段对话继续追问——知识在对话里生长。</p>
                <div style={{ marginTop: 18 }}><span className="badge-perm">↗ 公开分享 · 可被 Agent 引用</span></div>
              </div>
              <div className="ai-thread" style={{ background: "var(--paper)", border: "1px solid var(--hair)", borderRadius: 12, padding: "22px 24px", gap: 14 }}>
                <div className="bub user">「看不见的手」是斯密在为自私辩护吗？</div>
                <div className="bub ai"><div className="who">书友 · AI</div>恰恰相反。他想说的是：个人追求自利，在竞争市场里会<b>无意中</b>促进公共利益——这是结果，不是动机的辩护。<div className="ref">国富论 · 第四篇 第二章</div></div>
                <div className="bub user">那它什么时候会失灵？</div>
                <div className="bub ai"><div className="who">书友 · AI</div>好问题。当存在垄断、外部性或信息不对称时……</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ OPEN / AGENT ============ */}
      <section className="sec" id="open">
        <div className="wrap">
          <div className="sec-head reveal" style={{ maxWidth: 820 }}>
            <span className="kicker">开放协议 / Agent 友好</span>
            <h2 className="display-l">为人，<br />也为 AI Agent 而建。</h2>
            <p className="sub">微信读书是一座封闭的花园。Liber 反过来：内容、索引、数据全部开放。AI Agent 可以通过 MCP 直接读取书目与阅读数据，把整座图书馆当作工具来用。</p>
          </div>
          <div className="agent-grid" style={{ marginTop: 48 }}>
            <div className="reveal d1">
              <ul className="feat-list">
                <li><span className="fi">◆</span><span><b>全部开源。</b> 协议、索引、客户端代码公开可审计，社区共建，可自托管。</span></li>
                <li><span className="fi">◆</span><span><b>数据可读（MCP）。</b> 阅读量、热门划线、畅销度等后台数据，通过 MCP 标准化暴露给 Agent。</span></li>
                <li><span className="fi">◆</span><span><b>内容即接口。</b> 每一卷书都有稳定的链上地址，Agent 可直接定位到章节与段落。</span></li>
                <li><span className="fi">◆</span><span><b>无抽成、无下架。</b> CC0 内容自由流通，没有平台从中抽水，也没人能让它消失。</span></li>
              </ul>
            </div>
            <div className="reveal d2">
              <div className="term">
                <div className="tbar"><i /><i /><i /></div>
                <div className="tbody">
                  <div className="cmd"><span className="pr">agent ❯</span> liber.query(<span className="str">"最畅销的哲学公版书"</span>)</div>
                  <div className="out" style={{ margin: "6px 0 14px" }}>→ 通过 MCP 读取链上索引…</div>
                  <div className="out">{"{"}</div>
                  <div className="out">&nbsp;&nbsp;<span className="key">"title"</span>: <span className="str">"道德经"</span>,</div>
                  <div className="out">&nbsp;&nbsp;<span className="key">"reads_30d"</span>: <span className="str">48,201</span>,</div>
                  <div className="out">&nbsp;&nbsp;<span className="key">"top_highlight"</span>: <span className="str">"知人者智，自知者明"</span>,</div>
                  <div className="out">&nbsp;&nbsp;<span className="key">"blob"</span>: <span className="str">"walrus://0x8f3a…d21c"</span>,</div>
                  <div className="out">&nbsp;&nbsp;<span className="key">"license"</span>: <span className="str">"CC0"</span></div>
                  <div className="out">{"}"}</div>
                  <div className="cmd" style={{ marginTop: 12 }}><span className="pr">agent ❯</span> <span style={{ opacity: 0.5 }}>▍</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ COLLECTION ============ */}
      <section className="sec" id="collection" style={{ background: "var(--paper-2)" }}>
        <hr className="rule" style={{ position: "absolute", top: 0, left: 0, right: 0 }} />
        <div className="wrap">
          <div className="sec-head center reveal">
            <span className="kicker">馆藏 · 节选</span>
            <h2 className="display-m" style={{ marginTop: 16 }}>从这些开始读起。</h2>
          </div>
          <div className="coll-grid">
            {BOOKS.map((b) => (
              <div className="coll-card" key={b.id} onClick={onEnter} role="button">
                <MiniCover b={b} />
                <div className="ti">{b.t}</div>
                <div className="au">{b.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ CTA ============ */}
      <section className="cta" id="join">
        <div className="wrap">
          <span className="kicker center reveal" style={{ display: "flex" }}>加入早期共建</span>
          <h2 className="big reveal d1" style={{ marginTop: 22 }}>一座<span className="serif-it" style={{ color: "var(--accent)" }}>不灭</span>的图书馆，<br />正在被写下。</h2>
          <p className="sub reveal d2">现在就进去读，或连接钱包，成为最早的读者与共建者。开源、永久、属于所有人。</p>
          <div className="cta-row reveal d3" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={onEnter}>开始阅读 <span className="arr">→</span></button>
            <button className="btn btn-ghost" onClick={onSignIn}>连接钱包登录</button>
          </div>
          <p className="muted reveal d3" style={{ fontFamily: "var(--mono)", fontSize: 12, marginTop: 18, letterSpacing: ".04em" }}>★ 已有 3,140 位读者在等候 · GitHub 开源仓库即将公开</p>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer>
        <div className="wrap">
          <div className="foot-grid">
            <div className="foot-col">
              <a className="brand" href="#top" style={{ marginBottom: 14 }} onClick={(e) => e.preventDefault()}>
                <Mark size={26} />
                <span className="word" style={{ fontSize: 22 }}>Liber</span>
              </a>
              <p className="muted" style={{ fontSize: 15, maxWidth: "30ch" }}>人类的公共知识，永久、开放、对 AI 友好。一座不会丢失的图书馆。</p>
            </div>
            <div className="foot-col"><h4>探索</h4><a href="#discover">书库</a><a href="#ai">AI 书友</a><a href="#social">共读</a><a href="#collection">馆藏</a></div>
            <div className="foot-col"><h4>协议</h4><a href="#permanence">Walrus 存储</a><a href="#permanence">Arweave 备份</a><a href="#permanence">Sui 索引</a><a href="#open">MCP 接口</a></div>
            <div className="foot-col"><h4>社区</h4><a href="#open">GitHub</a><a href="#open">开发文档</a><a href="#join">加入共建</a><a href="#join">Discord</a></div>
          </div>
          <div className="foot-bottom">
            <span>© 2026 Liber · 内容遵循 CC0 公共领域贡献</span>
            <span>Built for humans &amp; agents · 永久存储于 Walrus · Arweave</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export { Landing };
