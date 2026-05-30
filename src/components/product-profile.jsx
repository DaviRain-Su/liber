import React from "react";
import { I, Cover } from "./product-shared.jsx";

/* product-profile.jsx — personal profile: bio, stats, shelf, public annotations. */
const { useState: useSp, useEffect: useEffP } = React;

function Profile({ onOpenBook }){
  const [me, setMe] = useSp(window.ME);
  useEffP(() => {
    if (!window.liberApi) return;
    window.liberApi.auth.me().then(r => { if (r && r.user) setMe(m => ({ ...m, ...r.user, stats: r.user.stats || m.stats })); }).catch(() => {});
  }, []);
  const [tab, setTab] = useSp("shelf"); // shelf | notes | finished
  const byId = (id) => (window.BOOKS||[]).find(b => b.id === id);
  const reading = me.reading.map(r => ({ ...byId(r.id), at:r.at })).filter(Boolean);
  const finished = me.finished.map(byId).filter(Boolean);

  /* public annotations = seed highlights that have notes */
  const publicNotes = (window.SEED_HL||[]).filter(h => h.note);

  const Stat = ({ n, l }) => <div className="pf-stat"><div className="n">{n}</div><div className="l">{l}</div></div>;

  return (
    <div className="app-screen">
      <div className="pf">
        <div className="pf-cover"/>
        <div className="pf-wrap">
          <div className="pf-id">
            <div className="pf-ava" style={{ background:`linear-gradient(135deg, ${me.color}, #2e3a7a)` }}>{me.seal}</div>
            <div className="pf-name">
              <h1>{me.name}</h1>
              <div className="handle">{me.handle} · {me.joined}</div>
              <p className="bio">{me.bio}</p>
              <div className="pf-wallet">{I.lock} {me.wallet}</div>
            </div>
            <div className="pf-actions">
              <button className="btn btn-primary">关注</button>
              <button className="btn btn-ghost">编辑资料</button>
            </div>
          </div>

          <div className="pf-stats">
            <Stat n={me.stats.read} l="在读"/>
            <Stat n={me.stats.finished} l="读完"/>
            <Stat n={me.stats.lines} l="划线"/>
            <Stat n={me.stats.notes} l="批注"/>
            <Stat n={me.stats.agreed.toLocaleString()} l="获赞同"/>
            <Stat n={me.stats.followers} l="关注者"/>
          </div>

          <div className="pf-tabs">
            <button className={tab==="shelf"?"on":""} onClick={()=>setTab("shelf")}>在读 · {reading.length}</button>
            <button className={tab==="finished"?"on":""} onClick={()=>setTab("finished")}>读完 · {finished.length}</button>
            <button className={tab==="notes"?"on":""} onClick={()=>setTab("notes")}>公开批注 · {publicNotes.length}</button>
          </div>

          {tab === "shelf" && (
            <div className="pf-shelf">
              {reading.map(b => (
                <div className="pf-bk" key={b.id} onClick={()=>onOpenBook(b.id)}>
                  <Cover book={b} />
                  <div className="prog"><div className="pf-fill" style={{ width: b.at.match(/(\d+)%/)?.[1]+"%" }}/></div>
                  <div className="t">{b.t}</div>
                  <div className="at">{b.at}</div>
                </div>
              ))}
            </div>
          )}
          {tab === "finished" && (
            <div className="pf-shelf">
              {finished.map(b => (
                <div className="pf-bk" key={b.id} onClick={()=>onOpenBook(b.id)}>
                  <Cover book={b} />
                  <div className="t">{b.t}</div>
                  <div className="at">已读完 · {b.a}</div>
                </div>
              ))}
            </div>
          )}
          {tab === "notes" && (
            <div className="pf-notes">
              {publicNotes.map((h,i) => {
                const bk = (window.BOOKS||[]).find(b => b.t === h.book || b.id === h.book);
                return (
                  <div className="pf-note" key={i} onClick={()=>bk&&onOpenBook(bk.id)}>
                    <div className="pn-q">「{h.t}」</div>
                    <div className="pn-t">{h.note}</div>
                    <div className="pn-meta"><span>{h.book} · {h.chap}</span><span>{h.when}</span></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { Profile };
