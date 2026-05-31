import React from "react";
import { I, AppBar, MobileTabBar } from "./product-shared.jsx";
import { IOSDevice } from "./ios-frame.jsx";
import { Onboarding } from "./product-onboarding.jsx";
import { Landing } from "./product-landing.jsx";
import { Library } from "./product-library.jsx";
import { Detail } from "./product-detail.jsx";
import { SearchOverlay } from "./product-search.jsx";
import { CliAuth } from "./cli-auth.jsx";

// Route-split: heavy / rarely-first screens load on demand so the landing +
// library first-paint path ships a smaller entry chunk. Landing, Library,
// Detail, Search, Onboarding stay eager (the first-paint path).
const lz = (loader, name) => React.lazy(() => loader().then((m) => ({ default: m[name] })));
const Notebook = lz(() => import("./product-notebook.jsx"), "Notebook");
const Social = lz(() => import("./product-social.jsx"), "Social");
const Profile = lz(() => import("./product-profile.jsx"), "Profile");
const Certificate = lz(() => import("./product-certificate.jsx"), "Certificate");
const Shelf = lz(() => import("./product-shelf.jsx"), "Shelf");
const Booklist = lz(() => import("./product-booklist.jsx"), "Booklist");
const Group = lz(() => import("./product-group.jsx"), "Group");
const GroupsList = lz(() => import("./product-group.jsx"), "GroupsList");
const AgentSquare = lz(() => import("./product-agents.jsx"), "AgentSquare");
const Charts = lz(() => import("./product-charts.jsx"), "Charts");
const News = lz(() => import("./product-news.jsx"), "News");
const NewsPost = lz(() => import("./product-news.jsx"), "NewsPost");
const Reader = lz(() => import("./product-reader.jsx"), "Reader");
const AgentView = lz(() => import("./product-agentview.jsx"), "AgentView");
const GraphView = lz(() => import("./product-graph.jsx"), "GraphView");
const Messenger = lz(() => import("./product-messaging.jsx"), "Messenger");
const NotificationsPop = lz(() => import("./product-messaging.jsx"), "Notifications");

const SUSPENSE_FALLBACK = <div style={{ minHeight: "50vh" }} aria-busy="true" />;
import { setToken } from "../lib/api.js";
import { findCatalogBook, getCatalogBooks, loadCatalogBooks, subscribeCatalog } from "../lib/catalog.js";
import { clearShelf } from "../lib/shelf.js";

/* product-app.jsx — router, theme, mount. */
const { useState: useSt, useEffect: useEf, useCallback: useCb } = React;
const IS_PHONE_PREVIEW = new URLSearchParams(location.search).get("vp") === "phone";
const CLI_AUTH = new URLSearchParams(location.search).get("cli_auth");
const CLI_AUTH_CODE = new URLSearchParams(location.search).get("code");
const SHARED_BOOKLIST = new URLSearchParams(location.search).get("booklist");

function App(){
  if (CLI_AUTH) return <CliAuth deviceCode={CLI_AUTH} userCode={CLI_AUTH_CODE} />;

  /* landing gate — the public marketing page is the first thing a new visitor
     sees. A visitor skips it only after completing onboarding or explicitly
     choosing "开始阅读"; neither path creates or displays a guest identity. */
  const [entered, setEntered] = useSt(
    () => SHARED_BOOKLIST != null || localStorage.getItem("liber.onboarded") === "1" || localStorage.getItem("liber.reader.entered") === "1"
  );
  /* onboarding gate (a shared booklist link opens straight into a read-only view) */
  const [onboarded, setOnboarded] = useSt(() => SHARED_BOOKLIST != null || localStorage.getItem("liber.onboarded") === "1");
  /* phone preview overlay (outer instance only) */
  const [phonePreview, setPhonePreview] = useSt(false);
  useEf(() => {
    const h = (e) => { if (!IS_PHONE_PREVIEW) setPhonePreview(e.detail === "phone"); };
    window.addEventListener("liber-device", h);
    const o = () => { localStorage.removeItem("liber.onboarded"); setOnboarded(false); };
    window.addEventListener("liber-show-onboarding", o);
    /* click an avatar anywhere → open that reader's profile, remembering where we came from */
    const p = (e) => { setReader(null); setSearch(false); setAgentView(null);
      const d = typeof e.detail === "object" && e.detail ? e.detail : { userId: e.detail };
      setRoute(r => ({ screen:"profile", userId: d.userId || d.name, from: r.screen === "profile" ? r.from : r.screen })); };
    window.addEventListener("liber-open-profile", p);
    /* open the 私信 overlay on a specific reader (from a profile's 私信 button) */
    const dm = (e) => { setReader(null); setSearch(false); setAgentView(null); setMessenger(e.detail || true); };
    window.addEventListener("liber-open-dm", dm);
    return () => { window.removeEventListener("liber-device", h); window.removeEventListener("liber-show-onboarding", o); window.removeEventListener("liber-open-profile", p); window.removeEventListener("liber-open-dm", dm); };
  }, []);

  /* route: {screen:'library'|'detail', bookId} ; reader is an overlay */
  const [route, setRoute] = useSt(() => {
    if (SHARED_BOOKLIST) return { screen:"booklist", listId: SHARED_BOOKLIST };
    try {
      const r = JSON.parse(localStorage.getItem("liber.route"));
      // require a sane shape — a corrupt-but-valid-JSON value shouldn't strand the app
      return r && typeof r.screen === "string" ? r : { screen:"library" };
    } catch { return { screen:"library" }; }
  });
  const [reader, setReader] = useSt(null); // {bookId, startChapter} | null
  const [search, setSearch] = useSt(false); // search overlay open
  const [agentView, setAgentView] = useSt(null); // Agent View context | null
  const [graphView, setGraphView] = useSt(false); // knowledge-graph overlay open
  const [messenger, setMessenger] = useSt(null);  // 私信 overlay: {userId,name,...} | true | null
  const [mailDot, setMailDot] = useSt(false);      // unread DM indicator
  const [notifOpen, setNotifOpen] = useSt(false);  // 通知 dropdown open
  const [bellDot, setBellDot] = useSt(false);      // unread notifications indicator
  const [dark, setDark] = useSt(() => document.documentElement.getAttribute("data-theme") === "dark");
  const [authUser, setAuthUser] = useSt(null);
  const [, setCatalogBooks] = useSt(() => getCatalogBooks());

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
    clearShelf();   // drop the local 在读 shelf so the next account starts clean
    localStorage.removeItem("liber.account");
    localStorage.removeItem("liber.guest");
    localStorage.removeItem("liber.onboarded");
    localStorage.removeItem("liber.reader.entered");
    localStorage.removeItem("liber.route");
    // Per-user reading data is keyed by bookId only (liber.hl.<id> highlights,
    // liber.nt.<id> notes) plus the global liber.shared cards and liber.place
    // last-position. Drop all of them so one account's private annotations don't
    // bleed into the next signed-in account on a shared/multi-account device.
    localStorage.removeItem("liber.shared");
    localStorage.removeItem("liber.place");
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("liber.hl.") || k.startsWith("liber.nt."))) localStorage.removeItem(k);
    }
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

  /* poll unread 私信 + 通知 counts for the AppBar mail/bell dots */
  useEf(() => {
    if (!authUser || !window.liberApi) { setMailDot(false); setBellDot(false); return; }
    let live = true;
    const poll = () => {
      window.liberApi.messages?.unread().then(r => { if (live) setMailDot((r?.unread || 0) > 0); }).catch(() => {});
      window.liberApi.notifications?.unread().then(r => { if (live) setBellDot((r?.unread || 0) > 0); }).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 45000);
    const onNotifs = () => poll();
    window.addEventListener("liber-notifs", onNotifs);
    return () => { live = false; clearInterval(t); window.removeEventListener("liber-notifs", onNotifs); };
  }, [authUser]);
  useEf(() => { localStorage.setItem("liber.route", JSON.stringify(route)); }, [route]);
  useEf(() => {
    const off = subscribeCatalog((books) => setCatalogBooks(books));
    loadCatalogBooks().then(setCatalogBooks).catch(() => {});
    return off;
  }, []);

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
  const openNews = (postId) => {         // 落地页「动态」入口 → 进入 News（公开内容，无需登录）
    localStorage.setItem("liber.reader.entered", "1");
    localStorage.setItem("liber.onboarded", "1");
    localStorage.removeItem("liber.guest");
    setRoute(postId ? { screen:"newsPost", postId } : { screen:"news" });
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
  const openBooklist = (listId) => { setReader(null); setSearch(false); setRoute({ screen:"booklist", listId }); };

  /* gate: show the landing page until the visitor enters. */
  if (!entered) {
    return <Landing onEnter={enterAsGuest} onSignIn={goSignIn} onOpenNews={openNews} />;
  }

  return (
    <>
      {!onboarded && <Onboarding onFinish={() => setOnboarded(true)} />}
      {!reader && (
        <>
          <AppBar active={({detail:"library", group:"social", groups:"social", cert:"library", booklist:"shelf", newsPost:"news"})[route.screen] || route.screen}
            onNav={(k) => setRoute({ screen: k === "library" ? "library" : k })}
            onHome={returnHome}
            onToggleTheme={toggleTheme} isDark={dark}
            onSearch={() => setSearch(true)} onProfile={() => setRoute(r => ({ screen:"profile", from: r.screen === "profile" ? r.from : r.screen }))}
            onAgentView={() => setAgentView(v => v ? null : { book: (route.screen==="detail"||route.screen==="cert") ? findCatalogBook(route.bookId) : null })} agentOn={!!agentView}
            user={authUser} onLogout={logout}
            onMail={() => { setNotifOpen(false); setMessenger(true); }} mailDot={mailDot}
            onBell={() => setNotifOpen(o => !o)} bellDot={bellDot} />
          <React.Suspense fallback={SUSPENSE_FALLBACK}>
          {route.screen === "library" && <Library onOpenBook={openBook} onOpenCharts={() => setRoute({ screen:"charts" })} />}
          {route.screen === "detail" && <Detail bookId={route.bookId} onOpenReader={openReader} onOpenCert={(id) => setRoute({ screen:"cert", bookId:id })} onBack={() => setRoute({ screen:"library" })} onOpenAgents={() => setRoute({ screen:"agents" })} />}
          {route.screen === "notes" && <Notebook onOpenBook={openBook} />}
          {route.screen === "social" && <Social onOpenBook={openBook} onOpenGroup={(id) => setRoute({ screen: id ? "group" : "groups", groupId:id })} onContinue={(c) => openReader(c.book, undefined, c)} />}
          {route.screen === "profile" && <Profile key={route.userId || "me"} userId={route.userId} onOpenBook={openBook} onBack={() => setRoute({ screen: route.from || "library" })} authUser={authUser} onLogout={logout} onProfileUpdated={refreshAuth} />}
          {route.screen === "cert" && <Certificate bookId={route.bookId} onBack={() => setRoute({ screen:"detail", bookId:route.bookId })} onOpenBook={openReader} />}
          {route.screen === "shelf" && <Shelf onOpenBook={openBook} onOpenReader={openReader} onOpenGroup={(id) => setRoute({ screen: id ? "group" : "groups", groupId:id })} onOpenBooklist={openBooklist} />}
          {route.screen === "booklist" && <Booklist listId={route.listId} onBack={() => setRoute({ screen:"shelf" })} onOpenBook={openBook} />}
          {route.screen === "groups" && <GroupsList onOpenGroup={(id) => setRoute({ screen:"group", groupId:id })} onBack={() => setRoute({ screen:"social" })} />}
          {route.screen === "group" && <Group groupId={route.groupId} onBack={() => setRoute({ screen:"social" })} onOpenReader={openReader} />}
          {route.screen === "agents" && <AgentSquare onBack={() => setRoute({ screen:"library" })} />}
          {route.screen === "charts" && <Charts onOpenBook={openBook} onBack={() => setRoute({ screen:"library" })} onAgentCharts={(ctx) => setAgentView({ charts: ctx })} />}
          {route.screen === "news" && <News onOpenPost={(id) => setRoute({ screen:"newsPost", postId:id })} onBack={() => setRoute({ screen:"library" })} />}
          {route.screen === "newsPost" && <NewsPost postId={route.postId} onOpenPost={(id) => setRoute({ screen:"newsPost", postId:id })} onBack={() => setRoute({ screen:"news" })} />}
          </React.Suspense>
          <MobileTabBar active={({detail:"library", group:"social", groups:"social", cert:"library", notes:"notes", booklist:"shelf", newsPost:"news"})[route.screen] || route.screen}
            onNav={(k) => setRoute({ screen: k })} />
        </>
      )}
      {reader && (
        <React.Suspense fallback={SUSPENSE_FALLBACK}>
          <Reader bookId={reader.bookId} startChapter={reader.startChapter} continueConvo={reader.continueConvo} onClose={() => setReader(null)} onOpenBook={(bid) => { setReader(null); setRoute({ screen:"detail", bookId:bid }); }} />
        </React.Suspense>
      )}
      {search && (
        <SearchOverlay onClose={() => setSearch(false)} onOpenBook={openBookFromOverlay} />
      )}
      {messenger && (
        <React.Suspense fallback={SUSPENSE_FALLBACK}>
          <Messenger startWith={messenger === true ? null : messenger} onClose={() => { setMessenger(null); setMailDot(false); }} />
        </React.Suspense>
      )}
      {notifOpen && (
        <React.Suspense fallback={null}>
          <NotificationsPop onClose={() => setNotifOpen(false)} onOpenBook={(bid) => { setNotifOpen(false); setReader(null); setRoute({ screen:"detail", bookId:bid }); }} />
        </React.Suspense>
      )}
      {agentView && (
        <React.Suspense fallback={SUSPENSE_FALLBACK}>
          <AgentView
            context={agentView}
            onCopy={(t)=>{ navigator.clipboard && navigator.clipboard.writeText(t); }}
            onSquare={() => { setAgentView(null); setRoute({ screen:"agents" }); }}
            onGraph={() => { setAgentView(null); setGraphView(true); }}
            onClose={() => setAgentView(null)} />
        </React.Suspense>
      )}
      {graphView && (
        <React.Suspense fallback={SUSPENSE_FALLBACK}>
          <GraphView
            onOpenBook={(bid) => { setGraphView(false); setRoute({ screen:"detail", bookId:bid }); }}
            onClose={() => setGraphView(false)} />
        </React.Suspense>
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
