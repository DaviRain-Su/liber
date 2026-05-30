import React from "react";
import { I } from "./product-shared.jsx";
import { CommentsPanel } from "./product-social.jsx";

/* product-notebook.jsx — your highlights/notes archive + AI chapter summaries + export. */
const { useState: useSn, useMemo: useMemoN, useEffect: useEffN } = React;

/* gather the reader's real highlights + notes from localStorage + backend, merged with seeds */
function gatherHighlights(serverReading = {}){
  const out = [];
  (window.SEED_HL || []).forEach(h => out.push({ ...h, seed:true }));
  (window.BOOKS || []).forEach(b => {
    let hl = {}, nt = {};
    try { hl = JSON.parse(localStorage.getItem("liber.hl."+b.id)) || {}; } catch {}
    try { nt = JSON.parse(localStorage.getItem("liber.nt."+b.id)) || {}; } catch {}
    const srv = serverReading[b.id] || {};
    hl = { ...(srv.highlights || {}), ...hl };
    if (srv.notes) {
      nt = { ...nt };
      Object.keys(srv.notes).forEach((sid) => {
        const have = new Set((nt[sid] || []).map(n => n.t));
        nt[sid] = [ ...(nt[sid] || []), ...srv.notes[sid].filter(n => !have.has(n.t)) ];
      });
    }
    const sentMap = {};
    if (b.id === "daodejing") (window.CHAPTERS||[]).forEach(c => c.paras.flat().forEach(s => { sentMap[s.id] = { t:s.t, chap:"第"+c.n+"章" }; }));
    Object.keys(hl).forEach(sid => {
      const s = sentMap[sid]; if (!s) return;
      if (out.some(o => o.sid === sid && o.book === b.t)) return;
      const myNote = (nt[sid]||[]).find(n => n.mine);
      out.push({ book:b.t, sid, chap:s.chap, color:hl[sid], t:s.t, note: myNote ? myNote.t : "", when:"刚刚", live:true });
    });
    Object.keys(nt).forEach(sid => {
      const s = sentMap[sid]; if (!s) return;
      (nt[sid]||[]).filter(n=>n.mine).forEach(n => {
        if (out.some(o => o.sid === sid && o.note === n.t)) return;
        if (!hl[sid]) out.push({ book:b.t, sid, chap:s.chap, color:"hl-user", t:s.t, note:n.t, when:"刚刚", live:true });
      });
    });
  });
  return out;
}

function Notebook({ onOpenBook }){
  const [serverReading, setServerReading] = useSn({});
  const all = useMemoN(() => gatherHighlights(serverReading), [serverReading]);
  const books = useMemoN(() => ["全部", ...Array.from(new Set(all.map(h => h.book)))], [all]);
  const [bookF, setBookF] = useSn("全部");
  const [typeF, setTypeF] = useSn("summary"); // summary | highlight | note | work
  const [writeOpen, setWriteOpen] = useSn(false);
  const [cmtFor, setCmtFor] = useSn(null); // work id whose comments panel is open
  const [works, setWorks] = useSn(() => { try { return JSON.parse(localStorage.getItem("liber.works"))||[]; } catch { return []; } });
  useEffN(() => {
    if (!window.liberApi) return;
    window.liberApi.works.list().then(r => { if (r && Array.isArray(r.works) && r.works.length) setWorks(r.works.map(w => ({ ...w, when: w.when || "已发布" }))); }).catch(() => {});
  }, []);
  useEffN(() => {
    if (!window.liberApi) return;
    let live = true;
    Promise.all((window.BOOKS || []).map((b) =>
      window.liberApi.reading.get(b.id)
        .then((r) => [b.id, r])
        .catch(() => null)
    )).then((rows) => {
      if (!live) return;
      const next = {};
      rows.filter(Boolean).forEach(([id, r]) => { next[id] = r; });
      setServerReading(next);
    });
    return () => { live = false; };
  }, []);

  const hls = all.filter(h => bookF === "全部" || h.book === bookF);
  const notesOnly = hls.filter(h => h.note);
  const summaries = (window.AI_SUMMARIES||[]).filter(s => {
    const bk = (window.BOOKS||[]).find(b => b.id === s.book);
    return bookF === "全部" || (bk && bk.t === bookF);
  });

  /* ---- export ---- */
  const buildMarkdown = () => {
    let md = `# 我的读书笔记 · Liber\n\n> 导出于 ${new Date().toLocaleDateString("zh-CN")} · 永久存储于 Walrus · Arweave\n\n`;
    summaries.forEach(s => {
      md += `## ${s.chap}\n\n**脉络**\n`;
      s.thread.forEach((l,i) => md += `${i+1}. ${l}\n`);
      md += `\n**金句**\n`;
      s.quotes.forEach(q => md += `> ${q}\n`);
      md += `\n`;
    });
    if (hls.length){
      md += `## 我的划线与批注\n\n`;
      hls.forEach(h => { md += `- 「${h.t}」 *(${h.book} · ${h.chap})*\n`; if (h.note) md += `  > ${h.note}\n`; });
    }
    return md;
  };
  const download = (name, text, type) => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  const exportMd = () => download("我的读书笔记.md", buildMarkdown(), "text/markdown");
  const exportHtml = () => {
    const body = buildMarkdown()
      .replace(/^# (.*)$/gm, "<h1>$1</h1>").replace(/^## (.*)$/gm, "<h2>$1</h2>")
      .replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>").replace(/^\d+\. (.*)$/gm, "<li>$1</li>")
      .replace(/^- (.*)$/gm, "<li>$1</li>").replace(/\*(.*?)\*/g, "<em>$1</em>").replace(/\n/g, "\n");
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>我的读书笔记</title>
<style>body{font-family:Georgia,'Songti SC',serif;max-width:680px;margin:60px auto;padding:0 30px;color:#211b15;line-height:1.7}h1{font-size:34px}h2{font-size:22px;border-bottom:1px solid #ddd;padding-bottom:8px;margin-top:40px}blockquote{border-left:3px solid #c0432b;margin:8px 0;padding:4px 16px;color:#4a4035;font-style:italic}li{margin:4px 0}em{color:#80735f}</style></head><body>${body}</body></html>`;
    download("我的读书笔记.html", doc, "text/html");
  };

  return (
    <div className="app-screen">
      <div className="nb">
        <div className="nb-wrap">
          <div className="nb-head">
            <div>
              <div className="kicker">我的笔记本</div>
              <h1 className="nb-title">读过的，都留下了痕迹。</h1>
              <p className="nb-sub">{all.length} 条划线 · {all.filter(h=>h.note).length} 条批注 · {summaries.length} 篇 AI 摘要 · 全部永久存证</p>
            </div>
            <div className="nb-export">
              <button className="btn btn-ghost" onClick={exportMd}>{I.copy} 导出 Markdown</button>
              <button className="btn btn-primary" onClick={()=>setWriteOpen(true)}>＋ 写成导读 <span className="arr">→</span></button>
            </div>
          </div>

          <div className="nb-body">
            <aside className="nb-side">
              <div className="s-group">
                <div className="s-h">类型</div>
                <div className={`s-item ${typeF==="summary"?"on":""}`} onClick={()=>setTypeF("summary")}>AI 摘要 · {summaries.length}</div>
                <div className={`s-item ${typeF==="highlight"?"on":""}`} onClick={()=>setTypeF("highlight")}>全部划线 · {hls.length}</div>
                <div className={`s-item ${typeF==="note"?"on":""}`} onClick={()=>setTypeF("note")}>我的批注 · {notesOnly.length}</div>
                <div className={`s-item ${typeF==="work"?"on":""}`} onClick={()=>setTypeF("work")}>我的导读 · {works.length}</div>
              </div>
              <div className="s-group">
                <div className="s-h">书目</div>
                {books.map(b => <div key={b} className={`s-item ${bookF===b?"on":""}`} onClick={()=>setBookF(b)}>{b}</div>)}
              </div>
            </aside>

            <main className="nb-main">
              {typeF === "summary" && (
                summaries.length ? summaries.map((s,i) => (
                  <div className="nb-summary" key={i}>
                    <div className="ns-head">
                      <span className="orb"/>
                      <div><div className="ns-chap">{s.chap}</div><div className="ns-when">{s.when}</div></div>
                      <span className="ns-tag">可导出</span>
                    </div>
                    <div className="ns-block">
                      <div className="ns-lab">脉络</div>
                      <ol className="ns-thread">{s.thread.map((l,j)=><li key={j}>{l}</li>)}</ol>
                    </div>
                    <div className="ns-block">
                      <div className="ns-lab">金句</div>
                      {s.quotes.map((q,j)=><div className="ns-quote" key={j}>「{q}」</div>)}
                    </div>
                    {s.mine && s.mine.length>0 && (
                      <div className="ns-block">
                        <div className="ns-lab">你在本章的划线</div>
                        {s.mine.map((q,j)=><div className="ns-mine" key={j}><span className="hl-user" style={{padding:"1px 3px",borderRadius:2}}>{q}</span></div>)}
                      </div>
                    )}
                  </div>
                )) : <Empty t="还没有 AI 摘要。读完一章，AI 会自动整理脉络与金句。" />
              )}

              {typeF === "highlight" && (
                hls.length ? hls.map((h,i) => (
                  <div className="nb-hl" key={i}>
                    <span className={`hl-bar ${h.color}`}/>
                    <div className="hl-c">
                      <div className="hl-q">「{h.t}」</div>
                      {h.note && <div className="hl-note">{I.note} {h.note}</div>}
                      <div className="hl-meta"><span>{h.book} · {h.chap}</span><span>{h.when}</span>{h.live && <span className="live">你刚标的</span>}</div>
                    </div>
                  </div>
                )) : <Empty t="还没有划线。打开任意一本书，选中一句试试。" />
              )}

              {typeF === "note" && (
                notesOnly.length ? notesOnly.map((h,i) => (
                  <div className="nb-note-card" key={i}>
                    <div className="nc-q">「{h.t}」</div>
                    <div className="nc-t">{h.note}</div>
                    <div className="nc-meta"><span>{h.book} · {h.chap}</span><span>{h.when}</span></div>
                  </div>
                )) : <Empty t="还没有批注。在阅读器里选中一句，写下你的想法。" />
              )}

              {typeF === "work" && (
                works.length ? works.map((w,i) => (
                  <div className="nb-work" key={i}>
                    <div className="nw-top"><div className="nw-cc">CC0</div><div className="nw-when">{w.when}</div></div>
                    <div className="nw-title">{w.title}</div>
                    <div className="nw-body">{w.body.length>180?w.body.slice(0,180)+"…":w.body}</div>
                    <div className="nw-foot">
                      <code className="nw-addr">{w.addr}</code>
                      <span className="nw-meta">已发布回图书馆 · 可被检索 / 被 Agent 引用</span>
                    </div>
                    {w.id && <div className="nw-comment-toggle" style={{ marginTop:8, fontSize:13, cursor:"pointer", color:"var(--accent)" }} onClick={()=>setCmtFor(cmtFor===w.id?null:w.id)}>{cmtFor===w.id?"收起评论":"评论 / 讨论"}</div>}
                    {w.id && cmtFor===w.id && <CommentsPanel targetType="work" targetId={w.id} />}
                  </div>
                )) : <Empty t="还没有作品。把你读到的、想到的，写成一篇导读，以 CC0 发布回图书馆——它会成为可被检索、可被 Agent 引用的新对象。" />
              )}
            </main>
          </div>
        </div>
      </div>
      {writeOpen && (
        <WriteComposer summaries={summaries} hls={hls}
          onClose={()=>setWriteOpen(false)}
          onPublish={(w)=>{ const next=[w,...works]; setWorks(next); localStorage.setItem("liber.works", JSON.stringify(next)); if (window.liberApi) window.liberApi.works.publish(w.title, w.body).catch(()=>{}); setWriteOpen(false); setTypeF("work"); }} />
      )}
    </div>
  );
}

/* ---- WriteComposer: turn notes into a CC0 reading-essay published to the library ---- */
function WriteComposer({ summaries, hls, onClose, onPublish }){
  const draft = (() => {
    let s = "";
    const sm = summaries[0];
    if (sm) s += sm.thread.join("");
    const q = (hls.find(h=>h.note) || {}).note;
    if (q) s += "\n\n" + q;
    return s || "把你在这本书里读到的、想到的，连成一段。";
  })();
  const [title, setTitle] = useSn("");
  const [body, setBody] = useSn(draft);
  const [vis, setVis] = useSn("public");
  const publish = () => {
    if (!body.trim()) return;
    const id = "w" + Date.now().toString(36);
    onPublish({ id, title: title.trim() || "一篇未命名的导读", body: body.trim(), when:"刚刚", addr:`liber://work/${id}`, license:"CC0-1.0", cited:0 });
  };
  return (
    <>
      <div className="drawer-scrim" style={{ zIndex: 862 }} onClick={onClose}/>
      <div className="write-modal">
        <div className="wm-head">
          <div><div className="wm-kick">{I.note} 写成一篇导读</div><div className="wm-sub">把笔记与对话，连成你自己的文字 · 以 CC0 发布回图书馆</div></div>
          <span className="x" onClick={onClose}>{I.x}</span>
        </div>
        <div className="wm-body">
          <input className="wm-title" placeholder="给它起个标题…" value={title} onChange={e=>setTitle(e.target.value)}/>
          <textarea className="wm-text" value={body} onChange={e=>setBody(e.target.value)} rows={9}/>
          <div className="wm-row">
            <div className="wm-lab">授权</div>
            <div className="wm-cc">CC0 · 公共领域 · 任何人（含 Agent）可自由引用、再创作</div>
          </div>
          <div className="wm-row">
            <div className="wm-lab">谁能看到</div>
            <div className="seg">
              <button className={vis==="public"?"on":""} onClick={()=>setVis("public")}>公开发布到馆藏</button>
              <button className={vis==="private"?"on":""} onClick={()=>setVis("private")}>仅自己</button>
            </div>
          </div>
        </div>
        <div className="wm-foot">
          <div className="wm-note">发布后会获得一个稳定地址 <code>liber://work/…</code>，成为可被检索、可被引用的对象。</div>
          <button className="btn btn-primary" disabled={!body.trim()} onClick={publish}>以 CC0 发布 <span className="arr">→</span></button>
        </div>
      </div>
    </>
  );
}

function Empty({ t }){
  return <div className="nb-empty"><div className="ne-mark">∅</div><p>{t}</p></div>;
}

export { Notebook };
