import React from "react";
import { I } from "./product-shared.jsx";
import { ConvoArtifact, ForkTreeModal } from "./product-convocard.jsx";

/* product-social.jsx — co-reading: feed, popular highlights, shared convos, discussion thread. */
const { useState: useSs, useEffect: useEffS } = React;

function Social({ onOpenBook, onOpenGroup, onContinue }){
  const [tab, setTab] = useSs("feed"); // feed | convos | groups
  const [thread, setThread] = useSs(null); // open discussion overlay
  const feed = window.FEED || [];
  const hot = window.HIGHLIGHTS || [];
  const groups = window.GROUPS || [];
  /* shared conversations: backend (/api/shares) with localStorage+seed fallback */
  let published = []; try { published = JSON.parse(localStorage.getItem("liber.shared")) || []; } catch {}
  const [apiConvos, setApiConvos] = useSs(null);
  useEffS(() => {
    if (!window.liberApi) return;
    window.liberApi.shares.list().then(r => { if (r && Array.isArray(r.shares)) setApiConvos(r.shares); }).catch(() => {});
  }, []);
  const convos = apiConvos || [...published, ...(window.SHARED_CONVOS || [])];
  const [expanded, setExpanded] = useSs(null);   // convo id
  const [forkTree, setForkTree] = useSs(null);   // convo whose tree is open
  const [saved, setSaved] = useSs(() => { try { return JSON.parse(localStorage.getItem("liber.saved.convos")) || []; } catch { return []; } });
  const toggleSave = (id) => {
    setSaved(s => { const n = s.includes(id) ? s.filter(x=>x!==id) : [...s, id]; localStorage.setItem("liber.saved.convos", JSON.stringify(n)); return n; });
    if (window.liberApi) window.liberApi.shares.save(id).catch(() => {});
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

              {tab === "feed" && feed.map((f,i) => (
                <FeedCard key={i} f={f} onOpenThread={() => setThread({ ...window.THREAD, key: "daodejing:c2-s1" })} onOpenBook={onOpenBook}
                  onOpenGroup={f.kind==="group" ? () => onOpenGroup("daoist-read") : null} />
              ))}

              {tab === "convos" && (
                <div className="soc-convos">
                  <div className="soc-convos-intro">读者们把和 AI 聊出的精彩片段公开在这里。浏览、收藏，或者——<b>接着 ta 停下的地方继续问</b>。</div>
                  {convos.map((c) => (
                    <div className="soc-convo-item" key={c.id}>
                      {c.mine && <div className="mine-tag">你分享的</div>}
                      <ConvoArtifact convo={c}
                        expanded={expanded === c.id}
                        onToggleExpand={() => setExpanded(expanded === c.id ? null : c.id)}
                        onFork={() => onContinue(c)}
                        onSave={() => toggleSave(c.id)}
                        onOpenTree={(cv) => setForkTree(cv)}
                        saved={saved.includes(c.id)} />
                    </div>
                  ))}
                </div>
              )}

              {tab === "groups" && (
                <div className="soc-grouplist">
                  {groups.map(g => (
                    <div className="gl-card" key={g.id} onClick={()=>onOpenGroup(g.id)}>
                      <div className="glc-top">
                        <span className="glc-seal" style={{background:g.color}}>{g.seal}</span>
                        <div><div className="glc-n">{g.name}</div><div className="glc-bk">共读《{g.book==="daodejing"?"道德经":g.book==="meditations"?"沉思录":"国富论"}》</div></div>
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
                  ))}
                </div>
              )}
            </div>

            {/* side: hot highlights + groups */}
            <aside className="soc-aside">
              <div className="aside-card">
                <div className="ac-h">本馆热门划线</div>
                {hot.map(h => (
                  <div className="ac-hl" key={h.rank} onClick={() => onOpenBook && onOpenBook("daodejing")}>
                    <span className="rk">{h.rank}</span>
                    <div><div className="q">「{h.q}」</div><div className="c">{h.c} · {h.n}</div></div>
                  </div>
                ))}
              </div>
              <div className="aside-card">
                <div className="ac-h">共读小组</div>
                {groups.map(g => (
                  <div className="grp" key={g.id} onClick={()=>onOpenGroup(g.id)} style={{cursor:"pointer"}}>
                    <span className="gd" style={{background:g.color}}/>
                    <div><div className="gn">{g.name}</div><div className="gm">{g.members} 人 · 本周 {g.weekRange}</div></div>
                  </div>
                ))}
                <button className="btn btn-ghost btn-block" style={{marginTop:14}} onClick={()=>setTab("groups")}>浏览全部小组</button>
              </div>
            </aside>
          </div>
        </div>
      </div>

      {thread && <ThreadOverlay thread={thread} onClose={() => setThread(null)} />}
      {forkTree && <ForkTreeModal convo={forkTree} onClose={() => setForkTree(null)} onFork={() => { setForkTree(null); onContinue(forkTree); }} />}
    </div>
  );
}

function FeedCard({ f, onOpenThread, onOpenBook, onOpenGroup }){
  const head = (
    <div className="fc-top">
      <div className="ava" style={{ background:f.color }}>{f.u==="书友 · AI"?"AI":f.u[0]}</div>
      <div className="fc-who">
        <div className="fc-u">{f.u}</div>
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
    setReplies(r => [...r, { u:"林知秋", color:"#3a4fb0", when:"刚刚", t:text, up:0, mine:true }]);
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
            <div className="ava" style={{ background:thread.root.color }}>{thread.root.u[0]}</div>
            <div className="nb2">
              <div className="nm">{thread.root.u} <span className="when">{thread.root.when}</span></div>
              <div className="tx">{thread.root.t}</div>
              <div className="mt"><span>{I.up} 赞同 {thread.root.up}</span><span>回复</span></div>
            </div>
          </div>
          <div className="tm-replies">
            {replies.map((r,i) => (
              <div className="tm-note" key={i}>
                <div className="ava" style={{ background:r.color }}>{r.ai?"AI":r.u[0]}</div>
                <div className="nb2">
                  <div className="nm">{r.u}{r.mine&&" · 你"} <span className="when">{r.when}</span></div>
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

export { Social };
