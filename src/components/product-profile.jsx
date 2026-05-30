import React from "react";
import { I, Cover } from "./product-shared.jsx";
import { findCatalogBook, getCatalogBooks } from "../lib/catalog.js";

/* product-profile.jsx — profile for ME or any other reader.
   Reached from the app bar (me) or by clicking an avatar in comments/feed
   (others). Others get a working 关注/已关注 button; my own profile gets
   编辑资料 / 退出 + a 关注中 list of the friends I follow. */
const { useState: useSp, useEffect: useEpf } = React;

/* live view of who I follow, synced across the app */
function useFollowSet(){
  const [set, setSet] = useSp(() => window.readFollow());
  useEpf(() => {
    const h = () => setSet(window.readFollow());
    window.addEventListener("liber-following", h);
    return () => window.removeEventListener("liber-following", h);
  }, []);
  return set;
}

function Profile({ userId, onOpenBook, onBack, authUser, onLogout }){
  const isMe = !userId || userId === window.ME.name;

  /* my own identity, hydrated from the signed-in account / backend */
  const [me, setMe] = useSp(window.ME);
  const [hasAccount, setHasAccount] = useSp(!!authUser);
  useEpf(() => {
    if (authUser) {
      setMe(m => ({ ...m, ...authUser, stats: authUser.stats || m.stats }));
      setHasAccount(true);
    }
  }, [authUser]);
  useEpf(() => {
    if (!isMe || !window.liberApi) return;
    window.liberApi.auth.me().then(r => {
      if (r?.user) {
        setMe(m => ({ ...m, ...r.user, stats: r.user.stats || m.stats }));
        setHasAccount(true);
      } else {
        setHasAccount(false);
      }
    }).catch(() => {});
  }, [isMe]);

  const followSet = useFollowSet();
  const [tab, setTab] = useSp("shelf"); // shelf | finished | notes | following

  const person = isMe ? me : (window.PEOPLE || {})[userId];

  if (!person){
    return (
      <div className="app-screen">
        <div className="pf"><div className="pf-wrap" style={{ paddingTop:60 }}>
          <button className="btn btn-ghost" onClick={onBack}>{I.left} 返回</button>
          <p className="muted" style={{ marginTop:24, fontSize:18 }}>没有找到这位读者的主页。</p>
        </div></div>
      </div>
    );
  }

  const byId = (id) => findCatalogBook(id);
  const byTitleOrId = (x) => findCatalogBook(x) || (window.BOOKS || []).find(b => b.t === x || b.id === x);

  const reading = (person.reading || []).map(r => ({ ...byId(r.id), at:r.at })).filter(b => b && b.id);
  const finished = (person.finished || []).map(byId).filter(Boolean);

  /* normalize public notes to {q,t,book,chap,when};
     for my own profile, only surface notes whose book is in the live catalog */
  const catalogTitles = new Set(getCatalogBooks().map((b) => b.t));
  const publicNotes = isMe
    ? (window.SEED_HL || []).filter(h => h.note && catalogTitles.has(h.book)).map(h => ({ q:h.t, t:h.note, book:h.book, chap:h.chap, when:h.when }))
    : (person.publicNotes || []);

  const following = !isMe && followSet.includes(person.name);
  const onToggleFollow = () => window.toggleFollow(person.name);

  /* live counts */
  const followingCount = isMe ? followSet.length : (person.stats.following || 0);
  const followerCount = isMe ? person.stats.followers : (person.stats.followers || 0) + (following ? 1 : 0);

  const Stat = ({ n, l }) => <div className="pf-stat"><div className="n">{n}</div><div className="l">{l}</div></div>;

  /* people I follow, as full records */
  const followedPeople = followSet.map(n => (window.PEOPLE || {})[n]).filter(Boolean);

  return (
    <div className="app-screen">
      <div className="pf">
        <div className="pf-wrap">
        <div className="pf-cover">
          {isMe
            ? <div className="pf-cover-art"></div>
            : <div className="pf-cover-art" style={{ background:`linear-gradient(120deg, ${person.color}, color-mix(in oklab, ${person.color} 30%, #2e3a7a))` }}></div>}
          {!isMe && onBack && <button className="pf-back" onClick={onBack}>{I.left} 返回</button>}
        </div>
          <div className="pf-id">
            <div className="pf-ava" style={{ background:`linear-gradient(135deg, ${person.color}, #2e3a7a)` }}>{person.seal}</div>
            <div className="pf-name">
              <h1>{person.name}{isMe && <span className="pf-you">你</span>}</h1>
              <div className="handle">{person.handle} · {person.joined}</div>
              <p className="bio">{person.bio}</p>
              <div className="pf-wallet">{I.lock} {person.wallet}</div>
            </div>
            <div className="pf-actions">
              {isMe ? (
                hasAccount ? (
                  <>
                    <button className="btn btn-primary">编辑资料</button>
                    <button className="btn btn-ghost" onClick={onLogout}>退出登录</button>
                  </>
                ) : (
                  <button className="btn btn-primary" onClick={() => window.dispatchEvent(new Event("liber-show-onboarding"))}>登录 / 连接钱包</button>
                )
              ) : (
                <>
                  <button className={following ? "btn btn-ghost pf-follow on" : "btn btn-primary pf-follow"} onClick={onToggleFollow}>
                    {following ? <><span className="pf-check">✓</span>已关注</> : "+ 关注"}
                  </button>
                  <button className="btn btn-ghost">私信</button>
                </>
              )}
            </div>
          </div>

          <div className="pf-stats">
            <Stat n={person.stats.read} l="在读"/>
            <Stat n={person.stats.finished} l="读完"/>
            <Stat n={person.stats.lines} l="划线"/>
            <Stat n={person.stats.notes} l="批注"/>
            <Stat n={(person.stats.agreed||0).toLocaleString()} l="获赞同"/>
            <Stat n={followingCount} l="关注中"/>
            <Stat n={followerCount} l="关注者"/>
          </div>

          <div className="pf-tabs">
            <button className={tab==="shelf"?"on":""} onClick={()=>setTab("shelf")}>在读 · {reading.length}</button>
            <button className={tab==="finished"?"on":""} onClick={()=>setTab("finished")}>读完 · {finished.length}</button>
            <button className={tab==="notes"?"on":""} onClick={()=>setTab("notes")}>公开批注 · {publicNotes.length}</button>
            {isMe && <button className={tab==="following"?"on":""} onClick={()=>setTab("following")}>关注中 · {followedPeople.length}</button>}
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
                const bk = byTitleOrId(h.book);
                return (
                  <div className="pf-note" key={i} onClick={()=>bk&&onOpenBook(bk.id)}>
                    <div className="pn-q">「{h.q}」</div>
                    <div className="pn-t">{h.t}</div>
                    <div className="pn-meta"><span>{h.book} · {h.chap}</span><span>{h.when}</span></div>
                  </div>
                );
              })}
              {publicNotes.length === 0 && <div className="pf-empty">{person.name} 还没有公开批注。</div>}
            </div>
          )}
          {tab === "following" && isMe && (
            <div className="pf-follow-list">
              {followedPeople.map(p => (
                <FollowRow key={p.name} p={p} following={followSet.includes(p.name)} />
              ))}
              {followedPeople.length === 0 && (
                <div className="pf-empty">
                  你还没有关注任何书友。<br/>
                  在「共读」里点开别人的头像，就能去 ta 的主页关注。
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* one row in my 关注中 list */
function FollowRow({ p, following }){
  return (
    <div className="pf-frow">
      <span className="ava" style={{ background:p.color }} onClick={()=>window.openProfile(p.name)}>{p.seal}</span>
      <div className="pf-frow-main" onClick={()=>window.openProfile(p.name)}>
        <div className="nm">{p.name} <span className="hd">{p.handle}</span></div>
        <div className="bio">{p.bio}</div>
        <div className="meta">{p.stats.followers.toLocaleString()} 关注者 · 读完 {p.stats.finished} 本</div>
      </div>
      <button className={following ? "btn btn-ghost pf-follow on" : "btn btn-primary pf-follow"} onClick={()=>window.toggleFollow(p.name)}>
        {following ? "已关注" : "+ 关注"}
      </button>
    </div>
  );
}

export { Profile };
