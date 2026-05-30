import React from "react";
import { I, AppBar, MobileTabBar } from "./product-shared.jsx";
import { IOSDevice } from "./ios-frame.jsx";
import { Onboarding } from "./product-onboarding.jsx";
import { Landing } from "./product-landing.jsx";
import { Library } from "./product-library.jsx";
import { Detail } from "./product-detail.jsx";
import { Notebook } from "./product-notebook.jsx";
import { Social } from "./product-social.jsx";
import { Profile } from "./product-profile.jsx";
import { Certificate } from "./product-certificate.jsx";
import { Shelf } from "./product-shelf.jsx";
import { Group, GroupsList } from "./product-group.jsx";
import { AgentSquare } from "./product-agents.jsx";
import { Charts } from "./product-charts.jsx";
import { Reader } from "./product-reader.jsx";
import { SearchOverlay } from "./product-search.jsx";
import { AgentView } from "./product-agentview.jsx";
import { CliAuth } from "./cli-auth.jsx";
import { setToken } from "../lib/api.js";

/* product-app.jsx — router, theme, mount. */
const { useState: useSt, useEffect: useEf, useCallback: useCb } = React;
const IS_PHONE_PREVIEW = new URLSearchParams(location.search).get("vp") === "phone";
const CLI_AUTH = new URLSearchParams(location.search).get("cli_auth");
const CLI_AUTH_CODE = new URLSearchParams(location.search).get("code");

function App(){
  if (CLI_AUTH) return <CliAuth deviceCode={CLI_AUTH} userCode={CLI_AUTH_CODE} />;

  /* landing gate — the public marketing page is the first thing a new visitor
     sees. A visitor skips it only after completing onboarding or explicitly
     choosing "开始阅读"; neither path creates or displays a guest identity. */
  const [entered, setEntered] = useSt(
    () => localStorage.getItem("liber.onboarded") === "1" || localStorage.getItem("liber.reader.entered") === "1"
  );
  /* onboarding gate */
  const [onboarded, setOnboarded] = useSt(() => localStorage.getItem("liber.onboarded") === "1");
  /* phone preview overlay (outer instance only) */
  const [phonePreview, setPhonePreview] = useSt(false);
  useEf(() => {
    const h = (e) => { if (!IS_PHONE_PREVIEW) setPhonePreview(e.detail === "phone"); };
    window.addEventListener("liber-device", h);
    const o = () => { localStorage.removeItem("liber.onboarded"); setOnboarded(false); };
    window.addEventListener("liber-show-onboarding", o);
    /* click an avatar anywhere → open that reader's profile, remembering where we came from */
    const p = (e) => { setReader(null); setSearch(false); setAgentView(null);
      setRoute(r => ({ screen:"profile", userId: e.detail, from: r.screen === "profile" ? r.from : r.screen })); };
    window.addEventListener("liber-open-profile", p);
    return () => { window.removeEventListener("liber-device", h); window.removeEventListener("liber-show-onboarding", o); window.removeEventListener("liber-open-profile", p); };
  }, []);

  /* route: {screen:'library'|'detail', bookId} ; reader is an overlay */
  const [route, setRoute] = useSt(() => {
    try { return JSON.parse(localStorage.getItem("liber.route")) || { screen:"library" }; }
    catch { return { screen:"library" }; }
  });
  const [reader, setReader] = useSt(null); // {bookId, startChapter} | null
  const [search, setSearch] = useSt(false); // search overlay open
  const [agentView, setAgentView] = useSt(null); // Agent View context | null
  const [dark, setDark] = useSt(() => document.documentElement.getAttribute("data-theme") === "dark");
  const [authUser, setAuthUser] = useSt(null);

  const refreshAuth = useCb(() => {
    if (!window.liberApi?.auth?.me) {
      setAuthUser(null);
      return;
    }
    let live = true;
    window.liberApi.auth.me()
      .then(r => { if (live) setAuthUser(r?.user || null); })
      .catch(() => { if (live) setAuthUser(null); });
    return () => { live = false; };
  }, []);

  const clearLoginState = useCb(() => {
    setToken(null);
    localStorage.removeItem("liber.account");
    localStorage.removeItem("liber.guest");
    localStorage.removeItem("liber.onboarded");
    localStorage.removeItem("liber.reader.entered");
    localStorage.removeItem("liber.route");
  }, []);

  const logout = useCb(async () => {
    try {
      if (window.liberApi?.auth?.logout) await window.liberApi.auth.logout();
    } catch {
      setToken(null);
    }
    clearLoginState();
    setAuthUser(null);
    setOnboarded(false);
    setEntered(false);
    setRoute({ screen:"library" });
    setReader(null);
    setSearch(false);
    setAgentView(null);
    window.scrollTo(0, 0);
  }, [clearLoginState]);

  const returnHome = useCb(() => {
    setReader(null);
    setSearch(false);
    setAgentView(null);
    setPhonePreview(false);
    setRoute({ screen:"library" });
    setEntered(false);
    window.scrollTo(0, 0);
  }, []);

  /* keyboard: "/" opens search */
  useEf(() => {
    const h = (e) => {
      if (e.key === "/" && !reader && !search && !/input|textarea/i.test(document.activeElement?.tagName||"")){ e.preventDefault(); setSearch(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [reader, search]);

  useEf(refreshAuth, [refreshAuth, entered, onboarded]);
  useEf(() => { localStorage.setItem("liber.route", JSON.stringify(route)); }, [route]);

  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    setDark(!dark);
    document.dispatchEvent(new Event("liber-theme"));
  };
  /* allow tweaks/other to drive theme */
  useEf(() => {
    const h = () => { const d = document.documentElement.getAttribute("data-theme")==="dark"; document.documentElement.setAttribute("data-theme", d?"light":"dark"); setDark(!d); };
    window.addEventListener("liber-toggle-theme", h);
    return () => window.removeEventListener("liber-toggle-theme", h);
  }, [dark]);
  /* keep our dark flag in sync when someone else (e.g. the landing page) flips
     the theme directly on <html> and emits liber-theme. */
  useEf(() => {
    const h = () => setDark(document.documentElement.getAttribute("data-theme") === "dark");
    document.addEventListener("liber-theme", h);
    return () => document.removeEventListener("liber-theme", h);
  }, []);

  /* landing CTAs */
  const enterAsGuest = () => {           // 开始阅读 → 直接进书库，不创建访客身份
    localStorage.setItem("liber.reader.entered", "1");
    localStorage.setItem("liber.onboarded", "1");
    localStorage.removeItem("liber.guest");
    setRoute({ screen:"library" });
    setOnboarded(true);
    setEntered(true);
    window.scrollTo(0, 0);
  };
  const goSignIn = () => {                // 连接钱包 / 登录 → 进入 onboarding（浮层）
    /* Persist nothing here — onboarding's own finish() writes the durable flags.
       entered flips in memory only, so reloading mid-onboarding returns to the
       landing page instead of trapping the visitor on the login screen. */
    setEntered(true);                     // onboarded 仍为 false → Onboarding 接管
    window.scrollTo(0, 0);
  };
  /* one-time migration: free anyone trapped by the old standalone entered flag */
  useEf(() => {
    if (localStorage.getItem("liber.guest") === "1") {
      localStorage.removeItem("liber.guest");
      setToken(null);
      setAuthUser(null);
    }
    localStorage.removeItem("liber.entered");
  }, []);

  const openBook = (bookId, straightToReader) => {
    if (straightToReader) setReader({ bookId });
    else setRoute({ screen:"detail", bookId });
  };
  const openReader = (bookId, startChapter, continueConvo) => setReader({ bookId, startChapter, continueConvo });
  const openBookFromOverlay = (bookId) => { setRoute({ screen:"detail", bookId }); };

  /* gate: show the landing page until the visitor enters. */
  if (!entered) {
    return <Landing onEnter={enterAsGuest} onSignIn={goSignIn} />;
  }

  return (
    <>
      {!onboarded && <Onboarding onFinish={() => setOnboarded(true)} />}
      {!reader && (
        <>
          <AppBar active={({detail:"library", group:"social", groups:"social", cert:"library"})[route.screen] || route.screen}
            onNav={(k) => setRoute({ screen: k === "library" ? "library" : k })}
            onHome={returnHome}
            onToggleTheme={toggleTheme} isDark={dark}
            onSearch={() => setSearch(true)} onProfile={() => setRoute(r => ({ screen:"profile", from: r.screen === "profile" ? r.from : r.screen }))}
            onAgentView={() => setAgentView(v => v ? null : { book: (route.screen==="detail"||route.screen==="cert") ? window.BOOKS.find(b=>b.id===route.bookId) : null })} agentOn={!!agentView}
            user={authUser} onLogout={logout} />
          {route.screen === "library" && <Library onOpenBook={openBook} onOpenCharts={() => setRoute({ screen:"charts" })} />}
          {route.screen === "detail" && <Detail bookId={route.bookId} onOpenReader={openReader} onOpenCert={(id) => setRoute({ screen:"cert", bookId:id })} onBack={() => setRoute({ screen:"library" })} onOpenAgents={() => setRoute({ screen:"agents" })} />}
          {route.screen === "notes" && <Notebook onOpenBook={openBook} />}
          {route.screen === "social" && <Social onOpenBook={openBook} onOpenGroup={(id) => setRoute({ screen: id ? "group" : "groups", groupId:id })} onContinue={(c) => openReader(c.book, undefined, c)} />}
          {route.screen === "profile" && <Profile key={route.userId || "me"} userId={route.userId} onOpenBook={openBook} onBack={() => setRoute({ screen: route.from || "library" })} authUser={authUser} onLogout={logout} />}
          {route.screen === "cert" && <Certificate bookId={route.bookId} onBack={() => setRoute({ screen:"detail", bookId:route.bookId })} onOpenBook={openReader} />}
          {route.screen === "shelf" && <Shelf onOpenBook={openBook} onOpenReader={openReader} onOpenGroup={(id) => setRoute({ screen: id ? "group" : "groups", groupId:id })} />}
          {route.screen === "groups" && <GroupsList onOpenGroup={(id) => setRoute({ screen:"group", groupId:id })} onBack={() => setRoute({ screen:"social" })} />}
          {route.screen === "group" && <Group groupId={route.groupId} onBack={() => setRoute({ screen:"social" })} onOpenReader={openReader} />}
          {route.screen === "agents" && <AgentSquare onBack={() => setRoute({ screen:"library" })} />}
          {route.screen === "charts" && <Charts onOpenBook={openBook} onBack={() => setRoute({ screen:"library" })} onAgentCharts={(ctx) => setAgentView({ charts: ctx })} />}
          <MobileTabBar active={({detail:"library", group:"social", groups:"social", cert:"library", notes:"notes"})[route.screen] || route.screen}
            onNav={(k) => setRoute({ screen: k })} />
        </>
      )}
      {reader && (
        <Reader bookId={reader.bookId} startChapter={reader.startChapter} continueConvo={reader.continueConvo} onClose={() => setReader(null)} onOpenBook={(bid) => { setReader(null); setRoute({ screen:"detail", bookId:bid }); }} />
      )}
      {search && (
        <SearchOverlay onClose={() => setSearch(false)} onOpenBook={openBookFromOverlay} />
      )}
      {agentView && (
        <AgentView
          context={agentView}
          onCopy={(t)=>{ navigator.clipboard && navigator.clipboard.writeText(t); }}
          onSquare={() => { setAgentView(null); setRoute({ screen:"agents" }); }}
          onClose={() => setAgentView(null)} />
      )}
      {phonePreview && (
        <div className="phone-preview-scrim" onClick={() => { setPhonePreview(false); window.dispatchEvent(new CustomEvent("liber-device-reset")); }}>
          <div className="phone-preview-wrap" onClick={e => e.stopPropagation()}>
            <div className="phone-preview-cap">移动端预览 · 390pt</div>
            <IOSDevice>
              <div style={{ height:"100%", padding:"52px 0 22px", boxSizing:"border-box" }}>
                <iframe src={location.pathname + "?vp=phone"} title="移动端预览" style={{ width:"100%", height:"100%", border:0, background:"var(--paper)" }} />
              </div>
            </IOSDevice>
            <button className="phone-preview-close" onClick={() => { setPhonePreview(false); window.dispatchEvent(new CustomEvent("liber-device-reset")); }}>{I.x} 关闭预览</button>
          </div>
        </div>
      )}
    </>
  );
}

/* lightweight placeholder for not-yet-built tabs */
function Placeholder({ name, onBack }){
  return (
    <div className="app-screen">
      <div style={{ flex:1, display:"grid", placeItems:"center", textAlign:"center", padding:"80px 20px" }}>
        <div>
          <div className="kicker" style={{ justifyContent:"center", marginBottom:18 }}>即将到来</div>
          <h2 className="display-m" style={{ marginBottom:14 }}>{name}</h2>
          <p className="muted" style={{ maxWidth:"42ch", margin:"0 auto 26px", fontSize:18 }}>
            这一部分还在设计中。当前原型聚焦在 <b style={{ color:"var(--accent)" }}>书库 → 详情 → 阅读器</b> 这条主线。
          </p>
          <button className="btn btn-primary" onClick={onBack}>回到书库 <span className="arr">→</span></button>
        </div>
      </div>
    </div>
  );
}

export { App, Placeholder };
