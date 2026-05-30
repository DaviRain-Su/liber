import React from "react";
import { I } from "./product-shared.jsx";

/* product-group.jsx — co-reading group detail + groups discovery list. */
const { useState: useGrp, useEffect: useEffG } = React;

/* discovery list (when no groupId) */
function GroupsList({ onOpenGroup, onBack }){
  const groups = window.GROUPS || [];
  return (
    <div className="app-screen">
      <div className="grp-screen">
        <div className="grp-wrap">
          <div className="crumb" style={{paddingTop:24}}>
            <a onClick={onBack}>共读</a> <span>/</span> <span style={{color:"var(--ink)"}}>共读小组</span>
          </div>
          <div className="gl-head">
            <div><div className="kicker">共读小组</div><h1 className="gl-title">找一群人，一起读完一本书。</h1></div>
            <button className="btn btn-primary">＋ 发起共读</button>
          </div>
          <div className="gl-grid">
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
        </div>
      </div>
    </div>
  );
}

function Group({ groupId, onBack, onOpenReader }){
  const g = (window.GROUPS||[]).find(x => x.id === groupId) || window.GROUPS[0];
  const bookT = g.book==="daodejing"?"道德经":g.book==="meditations"?"沉思录":"国富论";
  const [joined, setJoined] = useGrp(g.joined);
  const [replies, setReplies] = useGrp(g.discussion);
  const [draft, setDraft] = useGrp("");
  useEffG(() => {
    if (!window.liberApi) return;
    window.liberApi.groups.get(g.id).then(r => { if (r && r.group && Array.isArray(r.group.discussion)) setReplies(r.group.discussion); }).catch(() => {});
  }, [g.id]);
  const add = () => {
    if(!draft.trim()) return;
    const text = draft.trim();
    const chap = g.weekRange.split(" ")[0];
    setReplies(r => [{ u:"林知秋", color:"#3a4fb0", when:"刚刚", chap, t:text, up:0, replies:0, mine:true }, ...r]);
    if (window.liberApi) window.liberApi.groups.post(g.id, text, chap).catch(() => {});
    setDraft("");
  };

  return (
    <div className="app-screen">
      <div className="grp-screen">
        {/* banner */}
        <div className="grp-banner" style={{background:`linear-gradient(120deg, ${g.color}, color-mix(in oklab, ${g.color} 55%, #14110c))`}}>
          <div className="grp-wrap gb-inner">
            <span className="gb-seal">{g.seal}</span>
            <div className="gb-meta">
              <div className="gb-kick">共读小组 · 共读《{bookT}》</div>
              <h1 className="gb-name">{g.name}</h1>
              <p className="gb-desc">{g.desc}</p>
            </div>
          </div>
        </div>

        <div className="grp-wrap">
          <div className="crumb" style={{paddingTop:18}}>
            <a onClick={onBack}>共读</a> <span>/</span> <span style={{color:"var(--ink)"}}>{g.name}</span>
          </div>

          {/* action bar */}
          <div className="grp-bar">
            <div className="gbar-avas">
              {g.memberAvatars.map((a,i)=><span key={i} className="ga" style={{background:a.c, marginLeft:i?-10:0, zIndex:20-i}}>{a.n}</span>)}
              <span className="gbar-mc">{g.members} 人在读 · 组长 {g.lead}</span>
            </div>
            <div className="gbar-act">
              {joined
                ? <><button className="btn btn-ghost" onClick={()=>onOpenReader(g.book)}>跟上进度 →</button><button className="btn btn-ghost" onClick={()=>setJoined(false)}>已加入 ✓</button></>
                : <button className="btn btn-primary" onClick={()=>setJoined(true)}>加入共读</button>}
            </div>
          </div>

          <div className="grp-grid">
            {/* main: progress + discussion */}
            <main className="grp-main">
              <div className="grp-progress">
                <div className="gp-h"><span>本周进度 · {g.weekRange}</span><span className="gp-pct">{g.progressPct}%</span></div>
                <div className="gp-track"><div className="gp-fill" style={{width:g.progressPct+"%", background:g.color}}/></div>
                <div className="gp-sub">{g.members} 人中约 {Math.round(g.members*g.progressPct/100)} 人已读到本周进度 · 组内已有 {g.annos} 条批注</div>
              </div>

              {/* top annotation */}
              <div className="grp-topanno">
                <div className="ta-lab">本周最热批注</div>
                <div className="ta-quote">「{g.topAnno.quote}」</div>
                <div className="ta-row">
                  <span className="ava" style={{background:g.topAnno.color}}>{g.topAnno.u[0]}</span>
                  <div><div className="nm">{g.topAnno.u}</div><div className="tx">{g.topAnno.t}</div></div>
                  <span className="up">{I.up} {g.topAnno.up}</span>
                </div>
              </div>

              {/* discussion */}
              <div className="grp-disc">
                <div className="gd-h">组内讨论 · {replies.length}</div>
                <div className="gd-compose">
                  <span className="ava" style={{background:"#3a4fb0"}}>林</span>
                  <input placeholder={`聊聊本周的 ${g.weekRange}…`} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")add();}}/>
                  <span className="send" onClick={add}>{I.send}</span>
                </div>
                {replies.map((d,i) => (
                  <div className="gd-post" key={i}>
                    <span className="ava" style={{background:d.color}}>{d.u[0]}</span>
                    <div className="gd-body">
                      <div className="gd-top"><span className="nm">{d.u}{d.mine&&" · 你"}</span><span className="chap">{d.chap}</span><span className="when">{d.when}</span></div>
                      <div className="tx">{d.t}</div>
                      <div className="mt"><span>{I.up} 赞同 {d.up}</span><span>{d.replies||0} 回复</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </main>

            {/* aside: schedule */}
            <aside className="grp-aside">
              <div className="sh-card">
                <div className="shc-h">阅读排期</div>
                <div className="sched">
                  {g.schedule.map((s,i) => (
                    <div className={`sch-row ${s.state}`} key={i}>
                      <span className="sch-dot"/>
                      <div className="sch-mid"><div className="sch-wk">{s.wk}</div><div className="sch-chap">{s.chap}</div></div>
                      {s.state==="done" && <span className="sch-tag">✓</span>}
                      {s.state==="current" && <span className="sch-tag now">进行中</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="sh-card">
                <div className="shc-h">成员</div>
                <div className="mem-grid">
                  {g.memberAvatars.map((a,i)=>(
                    <div className="mem" key={i}><span className="ava" style={{background:a.c}}>{a.n}</span></div>
                  ))}
                  {g.members > g.memberAvatars.length && <div className="mem more">+{g.members-g.memberAvatars.length}</div>}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

export { Group, GroupsList };
