import React from "react";
import { I } from "./product-shared.jsx";
import { ProvBadge } from "./product-provenance.jsx";
import { ConvoArtifact } from "./product-convocard.jsx";
import { EchoOverlay } from "./product-echo.jsx";

/* product-reader.jsx — full-screen reader with selection menu, highlights,
   others' annotations, AI companion drawer, TOC, settings, progress.
   Three layouts: classic | archive | immersive. */
const { useState: useS, useEffect: useE, useRef: useR, useCallback: useCb } = React;

/* ---- AI canned brain (mode-aware) ---- */
const AI_MODES = [
  { k:"companion", label:"通读陪伴", role:"通读陪伴模式" },
  { k:"extend",    label:"知识延展", role:"知识延展模式" },
  { k:"notes",     label:"总结笔记", role:"总结笔记模式" },
  { k:"debate",    label:"苏格拉底", role:"苏格拉底模式" },
];
function aiReply(mode, q, ctx){
  const c = ctx ? `就你选中的「${ctx}」` : "这一句";
  if (mode === "debate")
    return { t:`那我反问你：你说的这个理解，换一个处境还成立吗？${ctx?`比如把「${ctx}」放到完全相反的情形里——它会不会反而说明了相反的事？`:""}先别急着下结论，我们一层层往下问。`, ref:"反问 · 苏格拉底式" };
  if (mode === "notes")
    return { t:`已为${c}整理 ——\n① 核心命题：语言与「道」的边界；\n② 关键对立：无名／有名、无欲／有欲；\n③ 收束：玄之又玄，众妙之门。`, ref:"已存入你的读书笔记 · 可导出" };
  if (mode === "extend")
    return { t:`${c}的这个概念，在馆里还能顺藤摸瓜：庄子《逍遥游》把它推得更远，亚当·斯密「看不见的手」也有几分影子。要不要对照读一段？`, ref:"↗ 跳转：庄子 · 逍遥游" };
  if (mode === "stoic")
    return { t:`换一个斯多葛的问法：${c}里，哪一部分在你的掌控之内，哪一部分不在？奥勒留会提醒你——困住人的从不是事本身，而是我们对它下的判断。`, ref:"斯多葛导师 · community/stoa" };
  if (mode === "textual")
    return { t:`先咬一下字：${c}的关键字，历代注本读法并不一致。王弼本与帛书本此处就有出入——把字源摊开，意思往往自己显形。`, ref:"考据派 · community/kaoju" };
  if (mode === "skeptic")
    return { t:`我先不接受这个说法。${c}——凭什么这样断定？它的反例是什么？换一个前提，结论还站得住吗？我们把它怀疑到底，剩下的才算数。`, ref:"怀疑论者 · community/pyrrho" };
  if (mode === "econ")
    return { t:`用激励和成本来看${c}：谁付出、谁得益？如果把它放进一个有稀缺和选择的处境里，人们的行为会怎么变？文本背后往往藏着一笔账。`, ref:"经济学家之眼 · community/smith" };
  return { t:`可以这样理解${c}：老子想说的，往往不在字面，而在字面留出的那道缝里。读慢一点，让句子自己展开——有需要我随时在旁边。`, ref:"道德经 · 第一章" };
}

function Reader({ bookId, startChapter, onClose, continueConvo, onOpenBook }){
  const book = window.BOOKS.find(b => b.id === bookId) || window.BOOKS[0];
  const chapters = window.CHAPTERS;
  const startIdx = Math.max(0, chapters.findIndex(c => c.n === startChapter));
  const [cIdx, setCIdx] = useS(startIdx >= 0 ? startIdx : 0);
  const ch = chapters[cIdx];

  /* layout (driven by tweaks) */
  const [layout, setLayout] = useS(localStorage.getItem("liber.reader.layout") || "classic");
  useE(() => {
    const h = e => setLayout(e.detail);
    window.addEventListener("liber-reader-layout", h);
    return () => window.removeEventListener("liber-reader-layout", h);
  }, []);

  /* reading settings (persisted) */
  const load = (k, d) => { const v = localStorage.getItem("liber.set."+k); return v == null ? d : v; };
  const [font, setFont]     = useS(() => load("font", "song"));
  const [size, setSize]     = useS(() => +load("size", 21));
  const [lead, setLead]     = useS(() => +load("lead", 1.95));
  const [meas, setMeas]     = useS(() => +load("meas", 38));
  const [rtheme, setRtheme] = useS(() => load("rtheme", "cream"));
  useE(() => { localStorage.setItem("liber.set.font", font); }, [font]);
  useE(() => { localStorage.setItem("liber.set.size", size); }, [size]);
  useE(() => { localStorage.setItem("liber.set.lead", lead); }, [lead]);
  useE(() => { localStorage.setItem("liber.set.meas", meas); }, [meas]);
  useE(() => { localStorage.setItem("liber.set.rtheme", rtheme); }, [rtheme]);

  const fontFam = { song: "var(--body)", kai: "'Cormorant Garamond', 'KaiTi', serif", hei: "'IBM Plex Mono', sans-serif" }[font] || "var(--body)";

  /* highlights + user notes (persisted per book) */
  const hlKey = "liber.hl."+book.id, ntKey = "liber.nt."+book.id;
  const [hls, setHls]   = useS(() => { try { return JSON.parse(localStorage.getItem(hlKey)) || {}; } catch { return {}; } });
  const [notes, setNotes] = useS(() => { try { return JSON.parse(localStorage.getItem(ntKey)) || {}; } catch { return {}; } });
  useE(() => { localStorage.setItem(hlKey, JSON.stringify(hls)); }, [hls]);
  useE(() => { localStorage.setItem(ntKey, JSON.stringify(notes)); }, [notes]);

  /* popovers / drawers */
  const [sel, setSel]   = useS(null);   // {x,y,text,sids}
  const [notePop, setNotePop] = useS(null); // {x,y,sid}
  const [tocOpen, setTocOpen] = useS(false);
  const [setOpen, setSetOpen] = useS(false);
  const [aiOpen, setAiOpen]   = useS(!!continueConvo);
  const [railTab, setRailTab] = useS(continueConvo ? "ai" : "anno"); // archive rail: anno | ai

  /* share composer + toast */
  const [shareOpen, setShareOpen] = useS(false);
  const [toast, setToast] = useS(null);
  const [echo, setEcho] = useS(null);   // {sid, text} for cross-book echoes

  /* AI state */
  const [aiMode, setAiMode] = useS("companion");
  const [summoned, setSummoned] = useS([]);   // invited community lens ids
  const [lensPicker, setLensPicker] = useS(false);
  const [aiCtx, setAiCtx]   = useS(continueConvo ? continueConvo.quote : null);
  const [feed, setFeed]     = useS(() => continueConvo
    ? [
        { who:"bot", t:`你正接着 ${continueConvo.author?.name||"一位读者"} 关于《${continueConvo.bookT}》的这段对话往下问。下面是 ta 之前聊到的——继续就好。`, ref:"接续对话 · "+continueConvo.chap },
        ...continueConvo.msgs.map(m => ({ who: m.r==="q"?"user":"bot", t:m.t, ref: m.r==="q"?undefined:"原对话" })),
      ]
    : [
        { who:"bot", t:"我读过这本《道德经》，也知道你正翻到第一章。读到哪、卡在哪，问我就好——我不剧透后文。", ref:"通读陪伴模式" },
      ]);
  const [typing, setTyping] = useS(false);
  const [draft, setDraft]   = useS("");

  const scrollRef = useR(null);
  const [prog, setProg] = useS(0);

  /* progress tracking */
  useE(() => {
    const el = scrollRef.current; if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      setProg(max > 0 ? el.scrollTop / max : 0);
    };
    el.addEventListener("scroll", onScroll, { passive:true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [cIdx]);
  useE(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [cIdx]);

  /* persist place */
  useE(() => { localStorage.setItem("liber.place", JSON.stringify({ bookId: book.id, n: ch.n })); }, [cIdx]);

  /* ---- text selection -> popover ---- */
  const onMouseUp = useCb(() => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.toString().trim()) { setSel(null); return; }
    const range = s.getRangeAt(0);
    const sids = [];
    document.querySelectorAll(".rd-sentence").forEach(el => {
      if (range.intersectsNode(el)) sids.push(el.dataset.sid);
    });
    if (!sids.length) { setSel(null); return; }
    const r = range.getBoundingClientRect();
    setSel({ x: r.left + r.width/2, y: r.top - 10, text: s.toString().trim(), sids });
    setNotePop(null);
  }, []);

  const applyHl = (color) => {
    if (!sel) return;
    setHls(prev => { const n = { ...prev }; sel.sids.forEach(id => n[id] = color); return n; });
    window.getSelection().removeAllRanges();
    setSel(null);
  };
  const startNote = () => {
    if (!sel) return;
    setHls(prev => { const n = { ...prev }; sel.sids.forEach(id => { if(!n[id]) n[id] = "hl-user"; }); return n; });
    const sid = sel.sids[0];
    const r = { x: sel.x, y: sel.y + 26, sid };
    window.getSelection().removeAllRanges();
    setSel(null);
    setNotePop({ ...r, focus:true });
  };
  const askAI = () => {
    if (!sel) return;
    setAiCtx(sel.text);
    setAiOpen(true);
    if (layout === "archive") setRailTab("ai");
    window.getSelection().removeAllRanges();
    setSel(null);
  };
  const openEcho = () => {
    if (!sel) return;
    setEcho({ sid: sel.sids[0], text: sel.text });
    window.getSelection().removeAllRanges();
    setSel(null);
  };

  /* clear sel popover on outside scroll/click */
  useE(() => {
    const clear = () => setSel(null);
    const el = scrollRef.current;
    el && el.addEventListener("scroll", clear, { passive:true });
    return () => el && el.removeEventListener("scroll", clear);
  }, []);

  /* ---- annotations helpers ---- */
  const annoFor = (sid) => {
    const base = (window.ANNOTATIONS[sid] || []);
    const mine = (notes[sid] || []);
    return [...base, ...mine];
  };
  const openNotePop = (sid, e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setNotePop({ x: r.left + r.width/2, y: r.bottom + 8, sid });
    setSel(null);
  };
  const [noteDraft, setNoteDraft] = useS("");
  const addNote = (sid) => {
    if (!noteDraft.trim()) return;
    setNotes(prev => ({ ...prev, [sid]: [ ...(prev[sid]||[]), { u:"林知秋", color:"#3a4fb0", t: noteDraft.trim(), up:0, replies:0, mine:true } ] }));
    setNoteDraft("");
  };

  /* ---- AI send ---- */
  const sendAI = (text) => {
    const q = (text != null ? text : draft).trim();
    if (!q) return;
    setFeed(f => [...f, { who:"user", t:q }]);
    setDraft("");
    setTyping(true);
    setAiOpen(true);
    setTimeout(() => {
      const r = aiReply(aiMode, q, aiCtx);
      setFeed(f => [...f, { who:"bot", ...r }]);
      setTyping(false);
      setAiCtx(null);
    }, 950);
  };

  /* nav */
  const go = (d) => setCIdx(i => Math.min(chapters.length-1, Math.max(0, i + d)));
  const jumpTo = (n) => { const i = chapters.findIndex(c => c.n === n); if (i >= 0){ setCIdx(i); setTocOpen(false); } };

  useE(() => {
    const onKey = (e) => {
      if (e.key === "Escape"){ if (aiOpen) setAiOpen(false); else if (tocOpen) setTocOpen(false); else if (setOpen) setSetOpen(false); else if (notePop) setNotePop(null); else onClose(); }
      if (e.key === "ArrowRight" && !aiOpen) go(1);
      if (e.key === "ArrowLeft" && !aiOpen) go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aiOpen, tocOpen, setOpen, notePop]);

  /* ---- render one sentence ---- */
  const renderSentence = (s) => {
    const hasAnno = !!(window.ANNOTATIONS[s.id] || notes[s.id]);
    const cnt = annoFor(s.id).length;
    const cls = ["rd-sentence"];
    if (hls[s.id]) cls.push(hls[s.id]);
    if (hasAnno) cls.push("has-anno");
    return (
      <span key={s.id} className={cls.join(" ")} data-sid={s.id}
        onClick={hasAnno ? (e) => openNotePop(s.id, e) : undefined}>
        {s.t}
        {hasAnno && cnt > 0 && (
          <span className="anno-marker" onClick={(e) => { e.stopPropagation(); openNotePop(s.id, e); }}>{cnt}</span>
        )}
      </span>
    );
  };

  const pct = Math.round(((cIdx + prog) / chapters.length) * 100);

  return (
    <div className="reader" data-layout={layout} data-rtheme={rtheme}
      style={{ "--read-size": size+"px", "--read-leading": lead, "--read-measure": meas+"rem", "--read-font": fontFam }}>

      {/* top bar */}
      <div className="rd-bar">
        <button className="icon-btn" onClick={onClose} title="返回 (Esc)">{I.left}</button>
        <div className="rd-title">
          <span className="bk">{book.t}</span>
          <span className="ch">第 {ch.n} 章 · {ch.title}</span>
        </div>
        <div className="spacer"/>
        <button className={`rd-tool ${tocOpen?"on":""}`} onClick={() => { setTocOpen(v=>!v); setSetOpen(false); }}>{I.list} 目录</button>
        <button className={`rd-tool ${setOpen?"on":""}`} id="rd-set-btn" onClick={() => { setSetOpen(v=>!v); setTocOpen(false); }}>{I.type} 显示</button>
        <button className={`rd-tool ${aiOpen?"on":""}`} onClick={() => { setAiOpen(v=>!v); if(layout==="archive") setRailTab("ai"); }}>{I.spark} AI 书友</button>
      </div>

      {/* reading region */}
      <div className="rd-body">
        <div className="rd-scroll" ref={scrollRef}>
          <div className="rd-col" onMouseUp={onMouseUp}>
            <div className="rd-chap-no">第 {String(ch.n).padStart(2,"0")} 章</div>
            <h1 className="rd-chap-title">{ch.title}</h1>
            <div className="rd-chap-rule"/>
            <div className="rd-text">
              {ch.paras.map((p, i) => (
                <p key={i}>{p.map(renderSentence)}</p>
              ))}
            </div>
            {(() => {
              const echoSid = ch.paras.flat().find(s => window.ECHOES[s.id]);
              const echo = echoSid ? window.ECHOES[echoSid.id] : null;
              const crossRec = echo ? echo.items.find(it => it.inLib) : null;
              const nextChap = chapters[cIdx+1];
              if (!crossRec && !nextChap) return null;
              return (
                <div className="rd-chapter-end">
                  <div className="rce-rule"/>
                  <div className="rce-h">读完这一章 · 顺着线索读下去</div>
                  <div className="rce-cards">
                    {nextChap && (
                      <div className="rce-card" onClick={() => go(1)}>
                        <span className="rce-seal" style={{ background:"#211b15", color:"#ece2cf" }}>{book.seal}</span>
                        <div className="rce-mid"><div className="rce-lab">本书 · 接着读</div><div className="rce-t">第 {nextChap.n} 章 · {nextChap.title}</div></div>
                        <span className="rce-go">{I.right}</span>
                      </div>
                    )}
                    {crossRec && (
                      <div className="rce-card" onClick={() => onOpenBook && onOpenBook(crossRec.bookId)}>
                        <span className="rce-seal" style={{ background: crossRec.color }}>{crossRec.seal}</span>
                        <div className="rce-mid"><div className="rce-lab">跨书 · {echo.theme}</div><div className="rce-t">{crossRec.bookT} · {crossRec.chap}</div><div className="rce-why">{crossRec.why}</div></div>
                        <span className="rce-go">{I.right}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* archive persistent rail */}
        {layout === "archive" && (
          <div className="rd-rail">
            <div className="rail-tabs">
              <button className={railTab==="anno"?"on":""} onClick={() => setRailTab("anno")}>本章批注</button>
              <button className={railTab==="ai"?"on":""} onClick={() => setRailTab("ai")}>AI 书友</button>
            </div>
            <div className="rail-body">
              {railTab === "anno" ? (
                <RailAnnotations ch={ch} annoFor={annoFor} />
              ) : (
                <AIPanel inline {...{ aiMode, setAiMode, aiCtx, setAiCtx, feed, typing, draft, setDraft, sendAI, onShare:()=>setShareOpen(true), summoned, onSummon:()=>setLensPicker(true) }} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* bottom progress */}
      <div className="rd-foot">
        <div className="pg-nav">
          <button onClick={() => go(-1)} disabled={cIdx===0}>{I.left}</button>
          <button onClick={() => go(1)} disabled={cIdx===chapters.length-1}>{I.right}</button>
        </div>
        <div className="pg-track" onClick={(e)=>{ const r=e.currentTarget.getBoundingClientRect(); const f=(e.clientX-r.left)/r.width; const el=scrollRef.current; if(el) el.scrollTop=(el.scrollHeight-el.clientHeight)*f; }}>
          <div className="pg-fill" style={{ width: (prog*100)+"%" }}/>
          <div className="pg-dot" style={{ left: (prog*100)+"%" }}/>
        </div>
        <div className="pg-label">第 {ch.n} 章 · 全书 {pct}%</div>
      </div>

      {/* selection popover */}
      {sel && (
        <div className="sel-pop" style={{ left: sel.x, top: sel.y }} onMouseDown={e=>e.preventDefault()}>
          <span className="swatch" style={{ background:"var(--accent)" }} title="朱砂" onClick={() => applyHl("hl-user")}/>
          <span className="swatch" style={{ background:"#e3b54a" }} title="赭黄" onClick={() => applyHl("hl-yellow")}/>
          <span className="swatch" style={{ background:"#5aa36e" }} title="松绿" onClick={() => applyHl("hl-green")}/>
          <span className="sep"/>
          <button onClick={startNote}>{I.note} 批注</button>
          <button onClick={askAI}>{I.spark} 问 AI</button>
          <button onClick={openEcho}>{I.echo} 回声</button>
          <button onClick={() => { navigator.clipboard && navigator.clipboard.writeText(sel.text); setSel(null); }}>{I.copy} 复制</button>
        </div>
      )}

      {/* annotation popover */}
      {notePop && (() => {
        const list = annoFor(notePop.sid);
        const sObj = ch.paras.flat().find(x => x.id === notePop.sid);
        return (
          <>
            <div className="drawer-scrim" style={{ background:"transparent", zIndex:835 }} onClick={() => setNotePop(null)}/>
            <div className="note-pop" style={{ left: Math.min(Math.max(notePop.x,180), window.innerWidth-180), top: notePop.y, transform:"translateX(-50%)" }}>
              <div className="np-head">{list.length} 条批注 <span className="x" onClick={() => setNotePop(null)}>{I.x}</span></div>
              {sObj && <div className="np-quote">「{sObj.t}」</div>}
              <div className="np-list">
                {list.map((n,i) => (
                  <div className="np-note" key={i}>
                    <div className={"ava"+(n.ai?" agent":"")} style={{ background: n.color }}>{n.ai ? "AI" : n.u[0]}</div>
                    <div>
                      <ProvBadge note={n} mine={n.mine}/>
                      <div className="tx">{n.t}</div>
                      <div className="mt"><span>{I.up} 赞同 {n.up||0}</span><span>回复 {n.replies||0}</span></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="np-add">
                <input autoFocus={notePop.focus} placeholder="写下你的批注，其他读者会看见…" value={noteDraft}
                  onChange={e=>setNoteDraft(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") addNote(notePop.sid); }}/>
                <span className="send" onClick={() => addNote(notePop.sid)}>{I.send}</span>
              </div>
            </div>
          </>
        );
      })()}

      {/* settings popover */}
      {setOpen && (
        <>
          <div className="drawer-scrim" style={{ background:"transparent" }} onClick={() => setSetOpen(false)}/>
          <div className="set-pop" style={{ right: 22, top: 64 }}>
            <div className="set-row">
              <div className="lab">主题底色</div>
              <div className="seg theme-seg">
                {[["cream","米纸"],["paper","素白"],["sepia","羊皮"],["night","夜读"]].map(([k,l]) => (
                  <button key={k} className={rtheme===k?"on":""} onClick={() => setRtheme(k)}>
                    <span className={`sw ${k}`}/>{l}
                  </button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <div className="lab">字体</div>
              <div className="seg">
                {[["song","宋"],["kai","楷 / 衬线"],["hei","等宽"]].map(([k,l]) => (
                  <button key={k} className={font===k?"on":""} onClick={() => setFont(k)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <div className="lab">字号 <b>{size}px</b></div>
              <input className="range" type="range" min="16" max="28" step="1" value={size} onChange={e=>setSize(+e.target.value)}/>
            </div>
            <div className="set-row">
              <div className="lab">行距 <b>{lead.toFixed(2)}</b></div>
              <input className="range" type="range" min="1.5" max="2.4" step="0.05" value={lead} onChange={e=>setLead(+e.target.value)}/>
            </div>
            <div className="set-row">
              <div className="lab">栏宽 <b>{meas} rem</b></div>
              <input className="range" type="range" min="28" max="50" step="1" value={meas} onChange={e=>setMeas(+e.target.value)}/>
            </div>
          </div>
        </>
      )}

      {/* TOC drawer */}
      {tocOpen && (
        <>
          <div className="drawer-scrim" onClick={() => setTocOpen(false)}/>
          <div className="toc-drawer">
            <div className="dh"><span className="t">目录 · {book.t}</span><span className="x" onClick={() => setTocOpen(false)}>{I.x}</span></div>
            <div className="dbody">
              {window.TOC.map(t => {
                const active = t.n === ch.n;
                return (
                  <div key={t.n} className={`toc-item ${active?"on":""} ${!t.has?"lock":""}`} onClick={() => t.has && jumpTo(t.n)}>
                    <span className="num">{String(t.n).padStart(2,"0")}</span>
                    <span className="tt">{t.title}</span>
                    {!t.has && <span className="lk">{I.lock}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* AI drawer (classic / immersive) */}
      {aiOpen && layout !== "archive" && (
        <>
          <div className="drawer-scrim" onClick={() => setAiOpen(false)}/>
          <div className="ai-drawer">
            <div className="dh">
              <span className="orb"/>
              <div><div className="nm">{(window.AGENTS[(window.LENSES.find(l=>l.id===aiMode)||{}).agent]||{}).name||"书友"}</div><div className="role">{(window.LENSES.find(l=>l.id===aiMode)||{}).name} 视角</div></div>
              <span className="x" onClick={() => setAiOpen(false)}>{I.x}</span>
            </div>
            <AIPanel {...{ aiMode, setAiMode, aiCtx, setAiCtx, feed, typing, draft, setDraft, sendAI, onShare:()=>setShareOpen(true), summoned, onSummon:()=>setLensPicker(true) }} />
          </div>
        </>
      )}

      {/* lens picker — summon a reading perspective */}
      {lensPicker && (
        <LensPicker active={aiMode} summoned={summoned}
          onClose={() => setLensPicker(false)}
          onSummon={(id) => { setSummoned(s => s.includes(id) ? s : [...s, id]); setAiMode(id); setLensPicker(false); setAiOpen(true); }} />
      )}

      {/* share composer */}
      {shareOpen && (
        <ShareComposer book={book} ch={ch} aiCtx={aiCtx} feed={feed}
          onClose={() => setShareOpen(false)}
          onPublish={(label) => { setShareOpen(false); setToast(label); setTimeout(()=>setToast(null), 3200); }} />
      )}

      {/* toast */}
      {toast && (
        <div className="rd-toast">
          <span className="t-ok">✓</span>
          <div><div className="t-t">{toast}</div><div className="t-s">已发布到共读页 · 别人可以接着这段继续问</div></div>
        </div>
      )}

      {/* cross-book echoes */}
      {echo && (
        <EchoOverlay sid={echo.sid} sentence={echo.text} book={book}
          onClose={() => setEcho(null)}
          onOpenBook={(bid) => { setEcho(null); onClose(); onOpenBook && onOpenBook(bid); }} />
      )}
    </div>
  );
}

/* ---- Share composer: pick form (对话卡 / 金句卡), turns, title, publish ---- */
function ShareComposer({ book, ch, aiCtx, feed, onClose, onPublish }){
  /* derive turns from the live AI feed (skip the opening system bot line) */
  const allTurns = feed
    .map((m, idx) => ({ idx, r: m.who === "user" ? "q" : "a", t: m.t }))
    .filter((m, i) => !(i === 0 && m.r === "a"));   // drop greeting
  const firstQ = allTurns.findIndex(t => t.r === "q");
  const seed = allTurns.slice(firstQ < 0 ? 0 : firstQ);

  const [form, setForm] = useS("card");          // card | insight
  const [picked, setPicked] = useS(() => seed.map(t => t.idx));
  const [insight, setInsight] = useS(() => {
    const lastA = [...seed].reverse().find(t => t.r === "a");
    return lastA ? lastA.t.replace(/^[^，。]*[，。]/, "").slice(0, 26).replace(/[，。]$/, "") || lastA.t.slice(0,24) : "";
  });
  const [vis, setVis] = useS("public");

  const msgs = seed.filter(t => picked.includes(t.idx)).map(t => ({ r: t.r, t: t.t }));
  const quote = aiCtx || (ch.paras.flat()[0] && ch.paras.flat()[0].t) || book.t;
  const draftConvo = {
    id: "draft", form, bookT: book.t, seal: book.seal, chap: `第 ${ch.n} 章 · ${ch.title}`,
    quote, title: msgs.find(m=>m.r==="q")?.t, insight,
    author: { name: window.ME?.name || "林知秋", ava: window.ME?.seal || "林", color: window.ME?.color || "#3a4fb0" },
    forks: 0, agree: 0, comments: 0, saves: 0, when: "刚刚", msgs,
  };

  const publish = () => {
    const rec = { ...draftConvo, id: "u" + Date.now(), mine: true };
    let arr = []; try { arr = JSON.parse(localStorage.getItem("liber.shared")) || []; } catch {}
    arr.unshift(rec);
    localStorage.setItem("liber.shared", JSON.stringify(arr));
    onPublish(form === "insight" ? "金句卡已分享" : "对话卡已分享");
  };

  const toggle = (idx) => setPicked(p => p.includes(idx) ? p.filter(x=>x!==idx) : [...p, idx].sort((a,b)=>a-b));

  return (
    <>
      <div className="drawer-scrim" style={{ zIndex: 860 }} onClick={onClose}/>
      <div className="share-modal">
        <div className="sh-head">
          <div><div className="sh-kick">{I.spark} 分享这段对话</div><div className="sh-sub">弱化是谁问的，让问题和过程本身被看见</div></div>
          <span className="x" onClick={onClose}>{I.x}</span>
        </div>

        <div className="sh-body">
          {/* left: controls */}
          <div className="sh-controls">
            <div className="sh-row">
              <div className="sh-lab">形态</div>
              <div className="seg">
                <button className={form==="card"?"on":""} onClick={()=>setForm("card")}>对话卡</button>
                <button className={form==="insight"?"on":""} onClick={()=>setForm("insight")}>金句卡</button>
              </div>
            </div>
            {form==="insight" && (
              <div className="sh-row">
                <div className="sh-lab">提炼的金句 <span className="hint">AI 已草拟，可改</span></div>
                <textarea className="sh-insight" value={insight} onChange={e=>setInsight(e.target.value)} rows={2}/>
              </div>
            )}
            <div className="sh-row">
              <div className="sh-lab">纳入哪几轮 <span className="hint">{picked.length} / {seed.length} 条</span></div>
              <div className="sh-turns">
                {seed.map(t => (
                  <label className={`sh-turn ${picked.includes(t.idx)?"on":""} ${t.r}`} key={t.idx}>
                    <input type="checkbox" checked={picked.includes(t.idx)} onChange={()=>toggle(t.idx)}/>
                    <span className="rr">{t.r==="q"?"读者":"AI"}</span>
                    <span className="tt">{t.t.length>34?t.t.slice(0,34)+"…":t.t}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="sh-row">
              <div className="sh-lab">谁能看到</div>
              <div className="seg">
                <button className={vis==="public"?"on":""} onClick={()=>setVis("public")}>公开</button>
                <button className={vis==="group"?"on":""} onClick={()=>setVis("group")}>仅共读小组</button>
                <button className={vis==="private"?"on":""} onClick={()=>setVis("private")}>仅自己</button>
              </div>
            </div>
            <button className="btn btn-primary sh-publish" disabled={!msgs.length} onClick={publish}>
              发布到共读页 <span className="arr">→</span>
            </button>
          </div>

          {/* right: live preview */}
          <div className="sh-preview">
            <div className="shp-lab">预览</div>
            <div className="shp-stage">
              <ConvoArtifact convo={draftConvo} expanded={true} onToggleExpand={()=>{}} onFork={()=>{}} onSave={()=>{}} saved={false}/>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---- lens picker: summon a community reading perspective ---- */
function LensPicker({ active, summoned, onClose, onSummon }){
  const lenses = window.LENSES || [];
  const community = lenses.filter(l => l.tag === "community");
  const official = lenses.filter(l => l.tag === "official");
  return (
    <>
      <div className="drawer-scrim" style={{ zIndex: 858 }} onClick={onClose}/>
      <div className="lens-modal">
        <div className="lens-head">
          <div><div className="lens-kick">{I.spark} 召唤一个读书视角</div><div className="lens-sub">同一本书，换一种眼光读。每个视角都是一个署名的 Agent。</div></div>
          <span className="x" onClick={onClose}>{I.x}</span>
        </div>
        <div className="lens-body">
          <div className="lens-grp">官方 · 内置</div>
          {official.map(l => (
            <div className={`lens-row ${active===l.id?"on":""}`} key={l.id} onClick={() => onSummon(l.id)}>
              <span className="lens-av" style={{ background:l.color }}>{l.seal}</span>
              <div className="lens-mid"><div className="lens-nm">{l.name}</div><div className="lens-pitch">{l.pitch}</div></div>
              <span className="lens-pick">{active===l.id?"使用中":"切换"}</span>
            </div>
          ))}
          <div className="lens-grp">社区 · 可发布 <span className="lens-grp-x">任何人都能训练并发布一个视角</span></div>
          {community.map(l => {
            const ag = (window.AGENTS||{})[l.agent] || {};
            const on = summoned.includes(l.id);
            return (
              <div className={`lens-row ${active===l.id?"on":""}`} key={l.id} onClick={() => onSummon(l.id)}>
                <span className="lens-av" style={{ background:l.color }}>{l.seal}</span>
                <div className="lens-mid">
                  <div className="lens-nm">{l.name} <span className="lens-prov">✓ 已签名 · 被引用 {ag.cited?.toLocaleString?.()||ag.cited}</span></div>
                  <div className="lens-pitch">{l.pitch}</div>
                  <div className="lens-by">{ag.model} · {ag.by}</div>
                </div>
                <span className="lens-pick">{active===l.id?"使用中":on?"再次使用":"召唤"}</span>
              </div>
            );
          })}
        </div>
        <div className="lens-foot">视角是开放生态的一部分 · 由社区训练、署名发布、可被任何 Agent 调用</div>
      </div>
    </>
  );
}

/* ---- shared AI panel (drawer + archive rail) ---- */
function AIPanel({ aiMode, setAiMode, aiCtx, setAiCtx, feed, typing, draft, setDraft, sendAI, onShare, summoned, onSummon, inline }){
  const feedRef = useR(null);
  useE(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [feed, typing]);
  const suggests = ["这一句到底在说什么？", "和后文有什么关系？", "帮我总结这一章"];
  const hasExchange = feed.some(m => m.who === "user");
  const active = (window.LENSES||[]).filter(l => l.tag === "official" || (summoned||[]).includes(l.id));
  return (
    <>
      <div className="ai-modes">
        {active.map(l => (
          <span key={l.id} className={`ai-mode ${aiMode===l.id?"on":""} ${l.tag==="community"?"comm":""}`} onClick={() => setAiMode(l.id)}>{l.tag==="community"&&<i className="lens-seal" style={{background:l.color}}>{l.seal}</i>}{l.name}</span>
        ))}
        <span className="ai-mode summon" onClick={onSummon}>＋ 召唤视角</span>
      </div>
      {aiCtx && (
        <div className="ai-ctx">
          <div>
            <div className="lab">就这一句提问</div>
            <div className="q">「{aiCtx.length>30?aiCtx.slice(0,30)+"…":aiCtx}」</div>
          </div>
          <span className="x" onClick={() => setAiCtx(null)}>{I.x}</span>
        </div>
      )}
      <div className="ai-feed" ref={feedRef}>
        {feed.map((m,i) => m.who === "user"
          ? <div className="ai-bub user" key={i}>{m.t}</div>
          : <div className="ai-bub bot" key={i}><div className="who">书友 · AI</div>{m.t.split("\n").map((l,j)=><div key={j}>{l}</div>)}{m.ref && <div className="ref">{m.ref}</div>}</div>
        )}
        {typing && <div className="ai-typing"><i/><i/><i/></div>}
      </div>
      {hasExchange && onShare && (
        <div className="ai-share-bar" onClick={onShare}>
          <span className="asb-l">{I.spark} 这段聊得不错？<b>分享出去</b>，让别人接着问</span>
          <span className="asb-arr">{I.right}</span>
        </div>
      )}
      <div className="ai-suggest">
        {suggests.map((s,i) => <span key={i} className="ai-chip" onClick={() => sendAI(s)}>{s}</span>)}
      </div>
      <div className="ai-compose">
        <input placeholder="问问书友这一句…" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") sendAI(); }}/>
        <span className="send" onClick={() => sendAI()}>{I.send}</span>
      </div>
    </>
  );
}

/* ---- archive rail annotations ---- */
function RailAnnotations({ ch, annoFor }){
  const sentences = ch.paras.flat().filter(s => window.ANNOTATIONS[s.id]);
  if (!sentences.length) return <div className="rail-section"><div className="rs-h">本章批注</div><div style={{ color:"var(--ink-3)", fontSize:14, fontStyle:"italic" }}>这一章还没有批注。选中一句，留下第一条。</div></div>;
  return (
    <div className="rail-section">
      <div className="rs-h">本章批注 · {sentences.length} 句被标注</div>
      {sentences.map(s => annoFor(s.id).map((n,i) => (
        <div className="rail-note" key={s.id+i}>
          {i===0 && <div className="rn-q">「{s.t.length>22?s.t.slice(0,22)+"…":s.t}」</div>}
          <div className="rn-row">
            <div className={"ava"+(n.ai?" agent":"")} style={{ background:n.color }}>{n.ai?"AI":n.u[0]}</div>
            <div>
              <ProvBadge note={n}/>
              <div className="rn-tx">{n.t}</div>
            </div>
          </div>
        </div>
      )))}
    </div>
  );
}

export { Reader };
