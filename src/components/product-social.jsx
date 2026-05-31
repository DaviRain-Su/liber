import React from "react";
import { I } from "./product-shared.jsx";
import { ConvoArtifact, ForkTreeModal } from "./product-convocard.jsx";
import { getCatalogBooks } from "../lib/catalog.js";

/* product-social.jsx — co-reading: feed, popular highlights, shared convos, discussion thread. */
const { useState: useSs, useEffect: useEffS } = React;

/* Continue a SPECIFIC fork-tree branch: seed the reader with the original
   exchange plus this branch's lineage of questions (root → … → picked node),
   and attribute the continuation to the branch author. Falls back to the whole
   convo when no branch path is given. */
function branchConvo(convo, path){
  if (!path || !path.length) return convo;
  const tip = path[path.length - 1];
  return {
    ...convo,
    author: { id: tip.userId, userId: tip.userId, name: tip.name, ava: tip.ava, color: tip.color },
    msgs: [...(convo.msgs || []), ...path.map(n => ({ r: "q", t: n.q }))],
    branchOf: convo.id,
    branchName: tip.name,
  };
}

const profileRef = (x) => x?.userId ? { userId:x.userId, name:x.u || x.name } : (x?.u || x?.name || x);
const canProfile = (x) => window.canOpenProfile(profileRef(x));
const openProfile = (x) => window.openProfile(profileRef(x));

function Social({ onOpenBook, onOpenGroup, onContinue }){
  const [tab, setTab] = useSs("feed"); // feed | convos | groups
  const [thread, setThread] = useSs(null); // open discussion overlay
  const hasLiveCatalog = getCatalogBooks().some((b) => b.dynamic);
  const allowSeedFallback = !window.liberApi && !hasLiveCatalog;
  const [apiFeed, setApiFeed] = useSs(null);
  const [apiGroups, setApiGroups] = useSs(null);
  const feed = apiFeed || (allowSeedFallback ? window.FEED || [] : []);
  const hot = allowSeedFallback ? window.HIGHLIGHTS || [] : [];
  const groups = apiGroups || (allowSeedFallback ? window.GROUPS || [] : []);
  /* shared conversations: backend (/api/shares) with localStorage+seed fallback */
  // Must stay an ARRAY — it's spread into `convos` below, so a corrupt non-array
  // value in localStorage would throw "not iterable" and blank the whole page.
  let published = []; try { const p = JSON.parse(localStorage.getItem("liber.shared")); if (Array.isArray(p)) published = p; } catch {}
  const [apiConvos, setApiConvos] = useSs(null);
  useEffS(() => {
    if (!window.liberApi) return;
    window.liberApi.shares.list().then(r => { if (r && Array.isArray(r.shares)) setApiConvos(r.shares); }).catch(() => {});
    window.liberApi.feed().then(r => { if (r && Array.isArray(r.feed)) setApiFeed(r.feed); }).catch(() => {});
    window.liberApi.groups.list().then(r => { if (r && Array.isArray(r.groups)) setApiGroups(r.groups); }).catch(() => {});
  }, []);
  const convos = apiConvos || [...published, ...(allowSeedFallback ? window.SHARED_CONVOS || [] : [])];
  const [expanded, setExpanded] = useSs(null);   // convo id
  const [forkTree, setForkTree] = useSs(null);   // convo whose tree is open
  const [saved, setSaved] = useSs(() => { try { return JSON.parse(localStorage.getItem("liber.saved.convos")) || []; } catch { return []; } });
  const toggleSave = (id) => {
    setSaved(s => { const n = s.includes(id) ? s.filter(x=>x!==id) : [...s, id]; localStorage.setItem("liber.saved.convos", JSON.stringify(n)); return n; });
    if (window.liberApi) window.liberApi.shares.save(id).catch(() => {});
  };
  const [commentsFor, setCommentsFor] = useSs(null); // convo id whose comments panel is open
  const [voted, setVoted] = useSs([]);               // convo ids upvoted this session (drives accent)
  const vote = (id) => {
    setVoted(v => v.includes(id) ? v.filter(x=>x!==id) : [...v, id]);
    if (window.liberApi) window.liberApi.vote("share", id).catch(() => {});
  };

  return (
    <div className="app-screen">
      <div className="soc">
        <div className="soc-wrap">
          <div className="soc-head">
            <div className="kicker">共读 / 社交</div>
            <h1 className="soc-title">一个人读，<br/>和一群人一起读。</h1>
            <p className="soc-sub">书页的边缘从不安静——看看别人在同一句旁写下的批注、被划得最多的句子，和精彩的 AI 对话。</p>
          </div>

          <div className="soc-grid2">
            {/* main column */}
            <div className="soc-main">
              <div className="soc-tabs">
                <button className={tab==="feed"?"on":""} onClick={()=>setTab("feed")}>动态</button>
                <button className={tab==="convos"?"on":""} onClick={()=>setTab("convos")}>可分享的对话</button>
                <button className={tab==="groups"?"on":""} onClick={()=>setTab("groups")}>共读小组</button>
              </div>

              {tab === "feed" && (
                feed.length ? feed.map((f,i) => (
                  <FeedCard key={i} f={f} onOpenThread={() => window.THREAD && setThread({ ...window.THREAD, key: "daodejing:c2-s1" })} onOpenBook={onOpenBook}
                    onOpenGroup={f.kind==="group" ? () => onOpenGroup(f.groupId || groups[0]?.id) : null} />
                )) : <EmptySocial text="还没有真实动态。划线、批注、发布对话后会出现在这里。" />
              )}

              {tab === "convos" && (
                <div className="soc-convos">
                  <div className="soc-convos-intro">读者们把和 AI 聊出的精彩片段公开在这里。浏览、收藏，或者——<b>接着 ta 停下的地方继续问</b>。</div>
                  {convos.length ? convos.map((c) => (
                    <div className="soc-convo-item" key={c.id}>
                      {c.mine && <div className="mine-tag">你分享的</div>}
                      <ConvoArtifact convo={c}
                        expanded={expanded === c.id}
                        onToggleExpand={() => setExpanded(expanded === c.id ? null : c.id)}
                        onFork={() => onContinue(c)}
                        onSave={() => toggleSave(c.id)}
                        onOpenTree={(cv) => setForkTree(cv)}
                        onComment={() => setCommentsFor(commentsFor === c.id ? null : c.id)}
                        onVote={() => vote(c.id)}
                        voted={voted.includes(c.id)}
                        saved={saved.includes(c.id)} />
                      {commentsFor === c.id && <CommentsPanel targetType="share" targetId={c.id} />}
                    </div>
                  )) : <EmptySocial text="还没有公开对话。从阅读器里和 AI 书友聊完后，可以分享出来。" />}
                </div>
              )}

              {tab === "groups" && (
                <div className="soc-grouplist">
                  {groups.length ? groups.map(g => (
                    <div className="gl-card" key={g.id} onClick={()=>onOpenGroup(g.id)}>
                      <div className="glc-top">
                        <span className="glc-seal" style={{background:g.color}}>{g.seal}</span>
                        <div><div className="glc-n">{g.name}</div><div className="glc-bk">共读《{g.bookT || g.book}》</div></div>
                        {g.joined && <span className="glc-joined">已加入</span>}
                      </div>
                      <p className="glc-desc">{g.desc}</p>
                      <div className="glc-foot">
                        <div className="glc-avas">
                          {g.memberAvatars.slice(0,5).map((a,i)=><span key={i} className="ga" style={{background:a.c, marginLeft:i?-9:0, zIndex:9-i}}>{a.n}</span>)}
                          <span className="glc-mc">{g.members} 人</span>
                        </div>
                        <span className="glc-prog">本周 {g.weekRange}</span>
                      </div>
                    </div>
                  )) : <EmptySocial text="还没有真实共读小组。当前真实馆藏会生成可加入的小组，加入后成员与讨论会写入数据库。" />}
                </div>
              )}
            </div>

            {/* side: hot highlights + groups */}
            <aside className="soc-aside">
              <div className="aside-card">
                <div className="ac-h">本馆热门划线</div>
                {hot.length ? hot.map(h => (
                  <div className="ac-hl" key={h.rank} onClick={() => onOpenBook && onOpenBook("daodejing")}>
                    <span className="rk">{h.rank}</span>
                    <div><div className="q">「{h.q}」</div><div className="c">{h.c} · {h.n}</div></div>
                  </div>
                )) : <EmptySocial text="真实划线产生后会显示排行。" compact />}
              </div>
              <div className="aside-card">
                <div className="ac-h">共读小组</div>
                {groups.length ? groups.map(g => (
                  <div className="grp" key={g.id} onClick={()=>onOpenGroup(g.id)} style={{cursor:"pointer"}}>
                    <span className="gd" style={{background:g.color}}/>
                    <div><div className="gn">{g.name}</div><div className="gm">{g.members} 人 · 本周 {g.weekRange}</div></div>
                  </div>
                )) : <EmptySocial text="暂无小组" compact />}
                <button className="btn btn-ghost btn-block" style={{marginTop:14}} onClick={()=>setTab("groups")}>浏览全部小组</button>
              </div>
            </aside>
          </div>
        </div>
      </div>

      {thread && <ThreadOverlay thread={thread} onClose={() => setThread(null)} />}
      {forkTree && <ForkTreeModal convo={forkTree} onClose={() => setForkTree(null)} onFork={(node, path) => { setForkTree(null); onContinue(branchConvo(forkTree, path)); }} />}
    </div>
  );
}

function EmptySocial({ text, compact }){
  return <div className="pf-empty" style={{ padding: compact ? "10px 0" : 28 }}>{text}</div>;
}

function FeedCard({ f, onOpenThread, onOpenBook, onOpenGroup }){
  const canOpen = canProfile(f);
  const head = (
    <div className="fc-top">
      <div className={"ava"+(canOpen?" ava-link":"")} style={{ background:f.color }} onClick={canOpen?()=>openProfile(f):undefined}>{f.u==="书友 · AI"?"AI":f.u[0]}</div>
      <div className="fc-who">
        <div className={"fc-u"+(canOpen?" name-link":"")} onClick={canOpen?()=>openProfile(f):undefined}>{f.u}</div>
        <div className="fc-act">
          {f.kind==="anno" && <>批注了 <b>{f.book}</b> · {f.chap}</>}
          {f.kind==="highlight" && <>划线了 <b>{f.book}</b> · {f.chap}</>}
          {f.kind==="convo" && <>分享了一段对话 · <b>{f.book}</b></>}
          {f.kind==="finished" && <>读完了 <b>{f.book}</b></>}
          {f.kind==="group" && <>更新了共读进度</>}
        </div>
      </div>
      <span className="fc-when">{f.when}</span>
    </div>
  );
  return (
    <div className="feed-card">
      {head}
      {f.quote && <div className="fc-quote" onClick={onOpenThread}>「{f.quote}」</div>}
      {f.title && <div className="fc-convo-title">{f.title}</div>}
      {f.preview && <div className="fc-preview"><span className="who">书友 · AI</span>{f.preview}</div>}
      {f.t && <div className="fc-text">{f.t}</div>}
      <div className="fc-foot">
        <span>{I.up} {f.up||0}</span>
        {f.replies != null && <span className="lk" onClick={onOpenThread}>{f.replies} 条回复 · 加入讨论</span>}
        {f.saved != null && <span>{f.saved} 收藏</span>}
        {f.members != null && <span className="lk" onClick={onOpenGroup||undefined}>{f.members} 人在读 · 进入小组</span>}
      </div>
    </div>
  );
}

function ThreadOverlay({ thread, onClose }){
  const [replies, setReplies] = useSs(thread.replies);
  const [draft, setDraft] = useSs("");
  useEffS(() => {
    if (!window.liberApi || !thread.key) return;
    window.liberApi.thread.get(thread.key).then(r => { if (r && Array.isArray(r.replies) && r.replies.length) setReplies(prev => [...prev, ...r.replies]); }).catch(() => {});
  }, []);
  const add = () => {
    if(!draft.trim()) return;
    const text = draft.trim();
    setReplies(r => [...r, { u:"你", color:"#3a4fb0", when:"刚刚", t:text, up:0, mine:true }]);
    if (window.liberApi && thread.key) window.liberApi.thread.reply(thread.key, text).catch(() => {});
    setDraft("");
  };
  return (
    <>
      <div className="drawer-scrim" style={{ zIndex:860 }} onClick={onClose}/>
      <div className="thread-modal">
        <div className="tm-head">
          <div><div className="tm-bk">{thread.book} · {thread.chap}</div><div className="tm-liners">{thread.liners} 人划线 · {replies.length+1} 条讨论</div></div>
          <span className="x" onClick={onClose}>{I.x}</span>
        </div>
        <div className="tm-quote">「{thread.quote}」</div>
        <div className="tm-body">
          <div className="tm-note root">
            <div className={"ava"+(canProfile(thread.root)?" ava-link":"")} style={{ background:thread.root.color }} onClick={canProfile(thread.root)?()=>openProfile(thread.root):undefined}>{thread.root.u[0]}</div>
            <div className="nb2">
              <div className="nm"><span className={canProfile(thread.root)?"name-link":""} onClick={canProfile(thread.root)?()=>openProfile(thread.root):undefined}>{thread.root.u}</span> <span className="when">{thread.root.when}</span></div>
              <div className="tx">{thread.root.t}</div>
              <div className="mt"><span>{I.up} 赞同 {thread.root.up}</span><span>回复</span></div>
            </div>
          </div>
          <div className="tm-replies">
            {replies.map((r,i) => (
              <div className="tm-note" key={i}>
                <div className={"ava"+(canProfile(r)?" ava-link":"")} style={{ background:r.color }} onClick={canProfile(r)?()=>openProfile(r):undefined}>{r.ai?"AI":r.u[0]}</div>
                <div className="nb2">
                  <div className="nm"><span className={canProfile(r)?"name-link":""} onClick={canProfile(r)?()=>openProfile(r):undefined}>{r.u}</span>{r.mine&&" · 你"} <span className="when">{r.when}</span></div>
                  <div className="tx">{r.t}</div>
                  <div className="mt"><span>{I.up} 赞同 {r.up}</span><span>回复</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="tm-compose">
          <input placeholder="加入讨论，其他读者会看见…" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")add();}}/>
          <span className="send" onClick={add}>{I.send}</span>
        </div>
      </div>
    </>
  );
}

/* Comments on a shared conversation (generic target). Stored in D1 via the API;
   degrades to an empty/local list when the backend is unavailable. */
function CommentsPanel({ targetType, targetId }){
  const [list, setList] = useSs(null);
  const [draft, setDraft] = useSs("");
  useEffS(() => {
    let live = true;
    if (window.liberApi) window.liberApi.comments.list(targetType, targetId).then(r => { if (live) setList((r && r.comments) || []); }).catch(() => { if (live) setList([]); });
    else setList([]);
    return () => { live = false; };
  }, [targetId]);
  const add = () => {
    const t = draft.trim(); if (!t) return;
    setList(l => [ ...(l || []), { id:"local"+Date.now(), u:"你", color:"#3a4fb0", t, up:0, when:"刚刚", mine:true } ]);
    if (window.liberApi) window.liberApi.comments.add(targetType, targetId, t).catch(() => {});
    setDraft("");
  };
  const [upvoted, setUpvoted] = useSs([]); // comment ids upvoted this session
  const upvote = (cmId) => {
    if (String(cmId).startsWith("local")) return;       // not yet persisted
    const on = upvoted.includes(cmId);
    setUpvoted(v => on ? v.filter(x=>x!==cmId) : [...v, cmId]);
    setList(l => (l||[]).map(cm => cm.id===cmId ? { ...cm, up:(cm.up||0)+(on?-1:1) } : cm));
    if (window.liberApi) window.liberApi.vote("comment", cmId).catch(() => {});
  };
  const wrap = { margin:"10px 0 2px", padding:"12px 14px", border:"1px solid var(--line, rgba(0,0,0,.1))", borderRadius:8, background:"var(--paper-2, rgba(0,0,0,.02))" };
  const row = { display:"flex", gap:8, alignItems:"flex-start", margin:"8px 0" };
  const av = (c) => ({ flex:"0 0 24px", width:24, height:24, borderRadius:"50%", background:c, color:"#fff", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center" });
  return (
    <div className="convo-comments" style={wrap}>
      <div style={{ fontSize:13, fontWeight:600, opacity:.7, marginBottom:6 }}>评论{list ? ` · ${list.length}` : ""}</div>
      <div style={{ maxHeight:260, overflowY:"auto" }}>
        {list === null && <div style={{ fontSize:13, opacity:.55, fontStyle:"italic" }}>加载中…</div>}
        {list && list.length === 0 && <div style={{ fontSize:13, opacity:.55, fontStyle:"italic" }}>还没有评论。来写第一条。</div>}
        {list && list.map(cm => (
          <div style={row} key={cm.id}>
            <span className={canProfile(cm) ? "ava-link" : ""} style={av(cm.color || "#3a4fb0")} onClick={canProfile(cm) ? () => openProfile(cm) : undefined}>{cm.seal || String(cm.u || "读")[0]}</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12, opacity:.6 }}><span className={canProfile(cm) ? "name-link" : ""} onClick={canProfile(cm) ? () => openProfile(cm) : undefined}>{cm.u}</span>{cm.mine && " · 你"} <span style={{ marginLeft:6 }}>{cm.when}</span>{cm.walrus && <span title={cm.walrus} style={{ marginLeft:6, color:"var(--accent)" }}>· 已存证</span>}</div>
              <div style={{ fontSize:14, lineHeight:1.6 }}>{cm.t}</div>
              <div style={{ fontSize:12, marginTop:2, cursor:"pointer", color: upvoted.includes(cm.id) ? "var(--accent)" : "inherit", opacity:.7, display:"inline-flex", alignItems:"center", gap:3 }} onClick={() => upvote(cm.id)}>{I.up} 赞同 {cm.up || 0}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:8 }}>
        <input style={{ flex:1, padding:"7px 10px", border:"1px solid var(--line, rgba(0,0,0,.12))", borderRadius:6, font:"inherit", background:"var(--paper, #fff)", color:"inherit" }}
          placeholder="写下你的评论，其他读者会看见…" value={draft}
          onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") add(); }}/>
        <span className="send" style={{ cursor:"pointer", padding:"6px 8px" }} onClick={add}>{I.send}</span>
      </div>
    </div>
  );
}

export { Social, CommentsPanel };
