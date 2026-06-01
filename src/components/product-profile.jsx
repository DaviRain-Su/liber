import React from "react";
import { I, Cover } from "./product-shared.jsx";
import { findCatalogBook, getCatalogBooks, subscribeCatalog } from "../lib/catalog.js";
import { shelfReadingEntries, subscribeShelf } from "../lib/shelf.js";

/* product-profile.jsx — profile for ME or any other reader.
   Reached from the app bar (me) or by clicking an avatar in comments/feed
   (others). Others get a working 关注/已关注 button; my own profile gets
   编辑资料 / 退出 + a 关注中 list of the friends I follow. */
const { useState: useSp, useEffect: useEpf } = React;

/* ---- Embedded Turnkey wallet panel (ported from the Liber Profile Wallet design) ---- */
const CHAIN_META = {
  sui:      { sym:"SUI", cls:"sui", glyph:"S",  name:"Sui" },
  ethereum: { sym:"ETH", cls:"eth", glyph:"Ξ",  name:"Ethereum" },
  solana:   { sym:"SOL", cls:"sol", glyph:"◎",  name:"Solana" },
  bitcoin:  { sym:"BTC", cls:"btc", glyph:"₿",  name:"Bitcoin" },
};
const WIC = {
  shield: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>,
  recv:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 4v13M6 11l6 6 6-6M5 20h14"/></svg>,
  swap:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M7 4 4 7l3 3M4 7h12M17 20l3-3-3-3M20 17H8"/></svg>,
  sign:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 19c3-1 4-9 6-9s2 5 4 5 2-3 4-3M4 21h16"/></svg>,
  check:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4.5 4.5L19 7"/></svg>,
};
const CHAIN_ORDER = ["sui", "ethereum", "solana", "bitcoin"];
function TokenSeal({ chain, size = 34 }){
  const m = CHAIN_META[chain] || { cls:"sui", glyph:"◦" };
  return <div className={`tok-seal ${m.cls}`} style={{ width:size, height:size, fontSize:Math.round(size*0.5) }}>{m.glyph}</div>;
}
function WalletPanel({ wallets, onReceive }){
  const chains = CHAIN_ORDER.filter(c => wallets[c]);
  const [copied, setCopied] = useSp(null);
  const [toast, setToast] = useSp("");
  const copy = (c, a) => { try { navigator.clipboard.writeText(a); } catch (e) {} setCopied(c); setTimeout(() => setCopied(null), 1200); };
  const soon = (m) => { setToast(m); setTimeout(() => setToast(""), 1800); };
  return (
    <div className="wpanel">
      <div className="wpanel-h">
        <span>通行密钥钱包 · {chains.length} 链</span>
        <span className="vfy">{WIC.shield} 已验证</span>
        <span className="more" onClick={onReceive}>收款 {I.right}</span>
      </div>
      <div className="waddr-grid">
        {chains.map(c => (
          <div key={c} className="waddr" onClick={() => copy(c, wallets[c])} title={wallets[c]}>
            <TokenSeal chain={c}/>
            <div className="wa-b">
              <div className="wa-nm">{CHAIN_META[c].name}</div>
              <div className="wa-ad">{wallets[c].slice(0, 8)}…{wallets[c].slice(-6)}</div>
            </div>
            <span className="wa-cp">{copied === c ? WIC.check : I.copy}</span>
          </div>
        ))}
      </div>
      <div className="wactions">
        <div className="wact" onClick={onReceive}><span className="wa-ic">{WIC.recv}</span>收款</div>
        <div className="wact" onClick={() => soon("转账功能即将上线")}><span className="wa-ic">{I.send}</span>转账</div>
        <div className="wact" onClick={() => soon("兑换功能即将上线")}><span className="wa-ic">{WIC.swap}</span>兑换</div>
        <div className="wact ghost" onClick={() => soon("链上签名即将上线")}><span className="wa-ic">{WIC.sign}</span>签名</div>
      </div>
      {toast && <div className="wtoast">{toast}</div>}
    </div>
  );
}
function ReceiveSheet({ wallets, onClose }){
  const chains = CHAIN_ORDER.filter(c => wallets[c]);
  const [copied, setCopied] = useSp(null);
  const copy = (c, a) => { try { navigator.clipboard.writeText(a); } catch (e) {} setCopied(c); setTimeout(() => setCopied(null), 1400); };
  return (
    <div className="wsheet-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wsheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wsheet-h"><span className="ttl">收款地址</span><span className="x" onClick={onClose}>{I.x}</span></div>
        <div className="wsheet-body">
          {chains.map(c => (
            <div className="wrcv" key={c}>
              <div className="wrcv-top"><TokenSeal chain={c} size={30}/><div><div className="wr-nm">{CHAIN_META[c].name}</div><div className="wr-net">{CHAIN_META[c].sym} · 主网</div></div></div>
              <div className="wrcv-addr">{wallets[c]}</div>
              <div className="wrcv-copy" onClick={() => copy(c, wallets[c])}>{copied === c ? WIC.check : I.copy} {copied === c ? "已复制" : "复制地址"}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
const EMPTY_ME = {
  name: "未登录读者",
  handle: "@login",
  color: "#3a4fb0",
  seal: "读",
  bio: "登录后可同步书架、笔记、关注和链上记录。",
  wallet: "未连接钱包",
  stats: { read:0, finished:0, lines:0, notes:0, agreed:0, followers:0, following:0 },
  reading: [],
  finished: [],
  publicNotes: [],
};

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

/* AI membership / 包月 — lives on my own profile, not in the AI chat panel.
   Shows plan + monthly quota, plus a stablecoin (链上) subscribe action when the
   treasury/coin/amount are configured server-side. */
function MembershipCard(){
  const [plan, setPlan] = useSp(null);
  const [paying, setPaying] = useSp(false);
  const [payMsg, setPayMsg] = useSp("");
  useEpf(() => {
    if (!window.liberApi?.billing?.plan) return;
    let live = true;
    window.liberApi.billing.plan().then((r) => { if (live) setPlan(r); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!plan) return null;
  const usage = plan.usage;
  const payment = plan.billing?.crypto;
  const isPro = usage?.plan === "pro" && usage?.limit === null;
  const payLabel = payment?.amountLabel || "稳定币";
  const quota = usage && usage.limit !== null ? `本月剩余 ${usage.remaining} / ${usage.limit} 次` : "本月不限量";
  const payStable = async () => {
    if (paying) return;
    setPaying(true);
    setPayMsg("请在钱包中确认交易…");
    try {
      const { stablecoinSubscribe } = await import("../lib/wallet.js"); // heavy @mysten/sui — load on click
      const res = await stablecoinSubscribe();
      setPlan((prev) => ({ ...(prev || {}), usage: res?.usage || prev?.usage }));
      setPayMsg("Pro 已开通，感谢支持。");
    } catch (err) {
      setPayMsg(err?.message || "支付确认失败");
    } finally {
      setPaying(false);
    }
  };
  return (
    <div className={`pf-membership ${isPro ? "pro" : ""}`}>
      <div className="pf-mem-main">
        <div className="pf-mem-h">
          <b>{isPro ? "Pro 会员" : "AI 包月会员"}</b>
          {isPro && <span className="pf-mem-badge">已开通</span>}
        </div>
        <div className="pf-mem-sub">
          {isPro
            ? "AI 书友、古文今译、知识延展不限量畅聊。"
            : payment?.configured
              ? `${payLabel} / 月 · 链上确认后即时开通，AI 不限量`
              : "链上订阅待配置收款地址与币种，敬请期待。"}
        </div>
        {usage && <div className="pf-mem-quota">{quota}</div>}
        {payMsg && <div className="pf-mem-msg">{payMsg}</div>}
      </div>
      {!isPro && payment?.configured && (
        <button className="btn btn-primary pf-mem-btn" disabled={paying} onClick={payStable}>
          {I.lock} {paying ? "确认中…" : "稳定币订阅"}
        </button>
      )}
    </div>
  );
}

function Profile({ userId, onOpenBook, onBack, authUser, onLogout, onProfileUpdated }){
  const isMe = !userId || userId === window.ME.name || userId === authUser?.id;

  /* my own identity, hydrated from the signed-in account / backend */
  const [me, setMe] = useSp(authUser ? window.ME : EMPTY_ME);
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
        setMe(EMPTY_ME);
        setHasAccount(false);
      }
    }).catch(() => {});
  }, [isMe]);

  const followSet = useFollowSet();
  const [tab, setTab] = useSp("shelf"); // shelf | finished | notes | following
  const [catalog, setCatalog] = useSp(() => getCatalogBooks());
  const [summary, setSummary] = useSp(null);
  const [editOpen, setEditOpen] = useSp(false);
  const [editForm, setEditForm] = useSp({ name:"", handle:"", bio:"", seal:"", color:"#3a4fb0" });
  const [editSaving, setEditSaving] = useSp(false);
  const [editError, setEditError] = useSp("");
  const [, refreshShelf] = useSp(0);
  const [walletReceive, setWalletReceive] = useSp(false);
  useEpf(() => {
    const offCatalog = subscribeCatalog((books) => setCatalog(books));
    const offShelf = subscribeShelf(() => refreshShelf((n) => n + 1));
    return () => { offCatalog(); offShelf(); };
  }, []);
  useEpf(() => {
    if (!isMe) { setSummary(null); return; }
    setSummary(null);   // drop the previous account's summary while we refetch
    if (!window.liberApi?.reading?.summary) return;
    let live = true;
    window.liberApi.reading.summary().then((r) => { if (live) setSummary(r); }).catch(() => {});
    return () => { live = false; };
  }, [isMe, authUser?.id]);

  const seedPerson = !isMe ? (window.PEOPLE || {})[userId] : null;
  const [remotePerson, setRemotePerson] = useSp(null);
  const [remoteFollowing, setRemoteFollowing] = useSp(false);
  const [profileLoading, setProfileLoading] = useSp(false);
  useEpf(() => {
    setRemotePerson(null);
    setRemoteFollowing(false);
    setProfileLoading(false);
    if (isMe || seedPerson || !userId || !window.liberApi?.readers?.get) return;
    let live = true;
    setProfileLoading(true);
    window.liberApi.readers.get(userId)
      .then((r) => {
        if (!live) return;
        setRemotePerson(r?.person || null);
        setRemoteFollowing(!!r?.following);
      })
      .catch(() => { if (live) setRemotePerson(null); })
      .finally(() => { if (live) setProfileLoading(false); });
    return () => { live = false; };
  }, [isMe, seedPerson, userId]);

  const [remoteFollowingList, setRemoteFollowingList] = useSp([]);
  useEpf(() => {
    if (!isMe || !window.liberApi?.readers?.following) return;
    let live = true;
    const load = () => {
      window.liberApi.readers.following()
        .then((r) => { if (live && Array.isArray(r?.readers)) setRemoteFollowingList(r.readers); })
        .catch(() => {});
    };
    load();
    window.addEventListener("liber-following", load);
    return () => { live = false; window.removeEventListener("liber-following", load); };
  }, [isMe]);

  const person = isMe ? me : (remotePerson || seedPerson);
  const openEdit = () => {
    setEditForm({
      name: me.name || "",
      handle: me.handle || "",
      bio: me.bio || "",
      seal: me.seal || "",
      color: me.color || "#3a4fb0",
    });
    setEditError("");
    setEditOpen(true);
  };
  const saveEdit = () => {
    if (!window.liberApi?.auth?.updateMe || editSaving) return;
    setEditSaving(true);
    setEditError("");
    window.liberApi.auth.updateMe(editForm)
      .then((r) => {
        if (r?.user) {
          setMe((m) => ({ ...m, ...r.user, stats: r.user.stats || m.stats }));
          setHasAccount(true);
          if (onProfileUpdated) onProfileUpdated();
        }
        setEditOpen(false);
      })
      .catch((err) => setEditError(err?.message || "保存失败"))
      .finally(() => setEditSaving(false));
  };

  if (!person){
    return (
      <div className="app-screen">
        <div className="pf"><div className="pf-wrap" style={{ paddingTop:60 }}>
          <button className="btn btn-ghost" onClick={onBack}>{I.left} 返回</button>
          <p className="muted" style={{ marginTop:24, fontSize:18 }}>{profileLoading ? "正在加载读者主页…" : "没有找到这位读者的主页。"}</p>
        </div></div>
      </div>
    );
  }

  const byId = (id) => catalog.find((book) => book.id === id) || findCatalogBook(id);
  const byTitleOrId = (x) => byId(x) || catalog.find(b => b.t === x || b.id === x);

  const serverReading = (summary?.reading || []).map((r) => ({ id: r.id, at: r.at }));
  const reading = isMe
    ? (hasAccount
        // signed in: 在读 is exactly what the server returns (empty == empty), so a
        // fresh account shows 0 and no other account's local shelf leaks in.
        ? serverReading.map((r) => ({ ...byId(r.id), at: r.at })).filter((b) => b && b.id)
        // guest: optimistic local shelf + live-library demo
        : shelfReadingEntries(person.reading || [], catalog))
    : (person.reading || []).map(r => ({ ...byId(r.id), at:r.at })).filter(b => b && b.id);
  const finished = (person.finished || []).map(byId).filter(Boolean);
  const realStats = isMe && summary?.stats
    ? { ...person.stats, ...summary.stats, followers: person.stats?.followers || 0, following: remoteFollowingList.length || person.stats?.following || 0 }
    : person.stats || {};

  /* normalize public notes to {q,t,book,chap,when};
     for my own profile, only surface notes whose book is in the live catalog */
  const catalogTitles = new Set(catalog.map((b) => b.t));
  const publicNotes = isMe && summary?.highlights
    ? summary.highlights.filter(h => h.note).map(h => ({ q:h.t, t:h.note, book:h.book, chap:h.chap, when:h.when }))
    : isMe
    ? (window.SEED_HL || []).filter(h => h.note && catalogTitles.has(h.book)).map(h => ({ q:h.t, t:h.note, book:h.book, chap:h.chap, when:h.when }))
    : (person.publicNotes || []);

  const following = !isMe && (person.id ? remoteFollowing : followSet.includes(person.name));
  const onToggleFollow = () => {
    if (person.id && window.liberApi?.readers?.follow) {
      window.liberApi.readers.follow(person.id).then((r) => {
        setRemoteFollowing(!!r?.following);
        setRemotePerson((p) => p ? ({ ...p, stats: { ...(p.stats || {}), followers: r?.followerCount ?? p.stats?.followers ?? 0 } }) : p);
        window.dispatchEvent(new Event("liber-following"));
      }).catch(() => {});
      return;
    }
    window.toggleFollow(person.name);
  };

  /* live counts */
  const followingCount = isMe ? (remoteFollowingList.length || followSet.length) : (realStats.following || 0);
  const followerCount = isMe ? realStats.followers : (person.id ? (realStats.followers || 0) : (realStats.followers || 0) + (following ? 1 : 0));

  const Stat = ({ n, l }) => <div className="pf-stat"><div className="n">{n}</div><div className="l">{l}</div></div>;

  /* people I follow, as full records */
  const followedPeople = remoteFollowingList.length
    ? remoteFollowingList
    : followSet.map(n => (window.PEOPLE || {})[n]).filter(Boolean);

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
              <div className="pf-wallet" onClick={() => isMe && person.turnkeyWallets && setWalletReceive(true)} style={isMe && person.turnkeyWallets ? { cursor: "pointer" } : undefined}>{I.lock} {person.wallet}</div>
            </div>
            <div className="pf-actions">
              {isMe ? (
                hasAccount ? (
                  <>
                    <button className="btn btn-primary" onClick={openEdit}>编辑资料</button>
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
                  <button className="btn btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent("liber-open-dm", { detail: { userId: person.userId || person.id || userId, name: person.name, color: person.color, seal: person.seal, handle: person.handle } }))}>私信</button>
                </>
              )}
            </div>
          </div>

          {isMe && person.turnkeyWallets && (person.turnkeyWallets.sui || person.turnkeyWallets.ethereum || person.turnkeyWallets.solana || person.turnkeyWallets.bitcoin) && (
            <WalletPanel wallets={person.turnkeyWallets} onReceive={() => setWalletReceive(true)} />
          )}

          <div className="pf-stats">
            <Stat n={realStats.read} l="在读"/>
            <Stat n={realStats.finished} l="读完"/>
            <Stat n={realStats.lines} l="划线"/>
            <Stat n={realStats.notes} l="批注"/>
            <Stat n={(realStats.agreed||0).toLocaleString()} l="获赞同"/>
            <Stat n={followingCount} l="关注中"/>
            <Stat n={followerCount} l="关注者"/>
          </div>

          {isMe && hasAccount && <MembershipCard />}

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
                <FollowRow key={p.id || p.name} p={p} following />
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
      {editOpen && (
        <EditProfileModal
          form={editForm}
          setForm={setEditForm}
          saving={editSaving}
          error={editError}
          onSave={saveEdit}
          onClose={() => !editSaving && setEditOpen(false)}
        />
      )}
      {walletReceive && person.turnkeyWallets && (
        <ReceiveSheet wallets={person.turnkeyWallets} onClose={() => setWalletReceive(false)} />
      )}
    </div>
  );
}

function EditProfileModal({ form, setForm, saving, error, onSave, onClose }){
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const colors = ["#3a4fb0", "#1f8a5b", "#9a5b2e", "#7a3d6b", "#b0553a", "#334155"];
  return (
    <>
      <div className="drawer-scrim" style={{ zIndex: 872 }} onClick={onClose}/>
      <div className="pf-edit-modal">
        <div className="pf-edit-head">
          <div>
            <div className="wm-kick">编辑资料</div>
            <div className="wm-sub">这些信息会显示在公开读者主页、批注和共读里。</div>
          </div>
          <span className="x" onClick={onClose}>{I.x}</span>
        </div>
        <div className="pf-edit-body">
          <label><span>昵称</span><input value={form.name} maxLength={32} onChange={(e)=>set("name", e.target.value)} placeholder="你的昵称"/></label>
          <label><span>Handle</span><input value={form.handle} maxLength={32} onChange={(e)=>set("handle", e.target.value)} placeholder="@reader"/></label>
          <label><span>印章</span><input value={form.seal} maxLength={2} onChange={(e)=>set("seal", e.target.value)} placeholder="读"/></label>
          <label><span>简介</span><textarea value={form.bio} maxLength={160} onChange={(e)=>set("bio", e.target.value)} placeholder="简单介绍你的阅读兴趣"/></label>
          <div className="pf-edit-colors">
            <span>头像颜色</span>
            <div>
              {colors.map((c) => (
                <button key={c} className={form.color === c ? "on" : ""} style={{ background:c }} onClick={()=>set("color", c)} aria-label={c}/>
              ))}
            </div>
          </div>
          {error && <div className="pf-edit-error">{error}</div>}
        </div>
        <div className="pf-edit-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>取消</button>
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </>
  );
}

/* one row in my 关注中 list */
function FollowRow({ p, following }){
  const target = p.id ? { userId: p.id, name: p.name } : p.name;
  const toggle = () => {
    if (p.id && window.liberApi?.readers?.follow) {
      window.liberApi.readers.follow(p.id).finally(() => window.dispatchEvent(new Event("liber-following")));
    } else {
      window.toggleFollow(p.name);
    }
  };
  return (
    <div className="pf-frow">
      <span className="ava" style={{ background:p.color }} onClick={()=>window.openProfile(target)}>{p.seal}</span>
      <div className="pf-frow-main" onClick={()=>window.openProfile(target)}>
        <div className="nm">{p.name} <span className="hd">{p.handle}</span></div>
        <div className="bio">{p.bio}</div>
        <div className="meta">{(p.stats?.followers || 0).toLocaleString()} 关注者 · 读完 {p.stats?.finished || 0} 本</div>
      </div>
      <button className={following ? "btn btn-ghost pf-follow on" : "btn btn-primary pf-follow"} onClick={toggle}>
        {following ? "已关注" : "+ 关注"}
      </button>
    </div>
  );
}

export { Profile };
