import React from "react";
import { I } from "./product-shared.jsx";

/* product-messaging.jsx — Direct messages (私信) overlay, wired to the live
   /api/messages backend. A two-pane modal: thread list + conversation. Messages
   can carry a quoted passage/annotation (rendered via QuoteBlock). */
const { useState: useMsg, useEffect: useMsgE, useRef: useMsgR } = React;

function QuoteBlock({ quote }){
  return (
    <div className="dm-quote">
      <div className="dm-quote-q">「{quote.q}」</div>
      {quote.note && <div className="dm-quote-note">{quote.note}</div>}
      <div className="dm-quote-src">{quote.book}{quote.chap ? ` · ${quote.chap}` : ""}{quote.note ? " · 批注" : ""}</div>
    </div>
  );
}

function Messenger({ startWith, onClose }){
  const api = typeof window !== "undefined" ? window.liberApi : null;
  const [threads, setThreads] = useMsg([]);
  const [active, setActive] = useMsg(startWith?.userId || null);
  const [partner, setPartner] = useMsg(startWith?.userId ? startWith : null);
  const [msgs, setMsgs] = useMsg([]);
  const [draft, setDraft] = useMsg("");
  const [loading, setLoading] = useMsg(false);
  const bodyRef = useMsgR(null);

  const loadThreads = () => { api?.messages?.threads().then(r => { if (Array.isArray(r?.threads)) setThreads(r.threads); }).catch(()=>{}); };
  useMsgE(() => { loadThreads(); }, []);

  /* ensure a freshly-opened partner shows in the list even with no history */
  const list = (() => {
    const arr = [...threads];
    if (startWith?.userId && !arr.some(t => t.userId === startWith.userId)) {
      arr.unshift({ userId: startWith.userId, name: startWith.name || "读者", handle: startWith.handle || "", color: startWith.color || "#3a4fb0", seal: String(startWith.name || "读")[0], lastText:"", lastFromMe:false, unread:0 });
    }
    return arr;
  })();

  useMsgE(() => {
    if (!active) { setMsgs([]); return; }
    let live = true;
    setLoading(true);
    api?.messages?.with(active)
      .then(r => { if (!live) return; if (r?.partner) setPartner(r.partner); setMsgs(Array.isArray(r?.messages) ? r.messages : []); })
      .catch(()=>{})
      .finally(()=>{ if (live) { setLoading(false); loadThreads(); } });
    return () => { live = false; };
  }, [active]);

  useMsgE(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, loading]);

  const openPerson = () => partner && window.openProfile && window.openProfile({ userId: partner.userId, name: partner.name });
  const send = () => {
    const t = draft.trim(); if (!t || !active) return;
    setMsgs(m => [...m, { id:"local"+Date.now(), fromMe:true, t, quote:null, when:"刚刚" }]);
    setDraft("");
    api?.messages?.send(active, t).then(()=>loadThreads()).catch(()=>{});
  };

  return (
    <div className="dm-scrim" onClick={onClose}>
      <div className="dm" onClick={e=>e.stopPropagation()}>
        <div className="dm-list">
          <div className="dm-list-head">私信</div>
          <div className="dm-convos">
            {list.map(p => (
              <div className={"dm-convo"+(active===p.userId?" on":"")} key={p.userId} onClick={()=>{ setActive(p.userId); setPartner(p); }}>
                <span className="dm-ava" style={{ background:p.color }}>{p.seal}</span>
                <div className="dm-convo-main">
                  <div className="dm-convo-nm">{p.name}{p.unread>0 && <span className="dm-unread-dot"/>}</div>
                  <div className="dm-convo-last">{p.lastText ? (p.lastFromMe?"你：":"")+p.lastText : "开始一段对话…"}</div>
                </div>
              </div>
            ))}
            {list.length===0 && <div className="dm-none" style={{ margin:"24px 14px", fontSize:14 }}>还没有私信。<br/>在书友主页点「私信」开始。</div>}
          </div>
        </div>

        <div className="dm-thread">
          {active && partner ? (
            <>
              <div className="dm-thread-head">
                <span className="dm-ava sm" style={{ background:partner.color }} onClick={openPerson}>{partner.seal || String(partner.name||"读")[0]}</span>
                <div className="dm-thread-id" onClick={openPerson}>
                  <div className="nm">{partner.name}</div>
                  <div className="hd">{partner.handle}</div>
                </div>
                <button className="dm-x" onClick={onClose}>{I.x}</button>
              </div>
              <div className="dm-body" ref={bodyRef}>
                {loading && <div className="dm-empty">加载中…</div>}
                {!loading && msgs.length===0 && <div className="dm-empty">给 {partner.name} 写第一条消息吧。</div>}
                {msgs.map((m,i) => (
                  <div className={"dm-msg"+(m.fromMe?" me":"")} key={m.id||i}>
                    <div className="dm-bubble">
                      {m.quote && <QuoteBlock quote={m.quote} />}
                      {m.t && <div className="dm-text">{m.t}</div>}
                    </div>
                    <div className="dm-when">{m.when}</div>
                  </div>
                ))}
              </div>
              <div className="dm-compose">
                <input placeholder={`给 ${partner.name} 发消息…`} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") send(); }}/>
                <span className="send" onClick={send}>{I.send}</span>
              </div>
            </>
          ) : (
            <div className="dm-none">选择一个对话，<br/>或在书友主页点「私信」开始。</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================ NOTIFICATIONS ============================ */
const NOTIF_FILTERS = [["all","全部"],["follow","关注"],["reply","回复"],["agree","赞同"],["dm","私信"]];

function Notifications({ onClose, onOpenBook }){
  const api = typeof window !== "undefined" ? window.liberApi : null;
  const [items, setItems] = useMsg([]);
  const [filter, setFilter] = useMsg("all");
  const load = () => api?.notifications?.list().then(r => { if (Array.isArray(r?.notifications)) setItems(r.notifications); }).catch(() => {});
  useMsgE(() => { load(); }, []);
  const ICON = { follow: I.userplus, reply: I.note, agree: I.heart, dm: I.mail, agent: I.agent };
  const shown = filter === "all" ? items : items.filter(n => n.kind === filter);
  const unreadOf = (k) => items.filter(n => (k === "all" || n.kind === k) && !n.read).length;
  const bump = () => window.dispatchEvent(new Event("liber-notifs"));
  const markOne = (n) => { if (!n.read) { api?.notifications?.read(n.id).catch(() => {}); setItems(its => its.map(x => x.id === n.id ? { ...x, read: true } : x)); bump(); } };
  const readAll = () => { api?.notifications?.readAll().catch(() => {}); setItems(its => its.map(n => ({ ...n, read: true }))); bump(); };
  const canGo = (n) => !!((["follow","dm"].includes(n.kind) && n.actorId) || n.book);
  const act = (n) => {
    markOne(n);
    if (n.kind === "follow" && n.actorId) { onClose(); window.openProfile && window.openProfile({ userId: n.actorId, name: n.who }); return; }
    if (n.kind === "dm" && n.actorId) { onClose(); window.dispatchEvent(new CustomEvent("liber-open-dm", { detail: { userId: n.actorId, name: n.who } })); return; }
    if (n.book) { onClose(); onOpenBook && onOpenBook(n.book); return; }
  };
  return (
    <>
      <div className="dropdown-scrim" onClick={onClose}/>
      <div className="notif-pop">
        <div className="notif-head"><span>通知</span><button className="notif-readall" onClick={readAll}>全部已读</button></div>
        <div className="notif-filters">
          {NOTIF_FILTERS.map(([k,label]) => { const u = unreadOf(k); return (
            <button key={k} className={filter===k?"on":""} onClick={()=>setFilter(k)}>{label}{u>0 && <span className="nf-count">{u}</span>}</button>
          ); })}
        </div>
        <div className="notif-list">
          {shown.map(n => (
            <div className={"notif"+(n.read?" read":"")+(canGo(n)?" go":"")} key={n.id} onClick={canGo(n)?()=>act(n):()=>markOne(n)}>
              {!n.read && <span className="notif-unread"/>}
              <span className="notif-ava" style={{ background:n.color }}>{String(n.who||"读")[0]}</span>
              <div className="notif-body">
                <div className="notif-t"><b>{n.who}</b> {n.text}</div>
                <div className="notif-meta"><span className="notif-kind">{ICON[n.kind] || I.bell}</span><span>{n.when}</span></div>
              </div>
            </div>
          ))}
          {shown.length===0 && <div className="notif-empty">没有这类通知。</div>}
        </div>
      </div>
    </>
  );
}

export { Messenger, Notifications };
