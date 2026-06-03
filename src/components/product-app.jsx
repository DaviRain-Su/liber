import React from "react";
import { I, AppBar, MobileTabBar } from "./product-shared.jsx";
import { IOSDevice } from "./ios-frame.jsx";
import { Onboarding } from "./product-onboarding.jsx";
import { Landing } from "./product-landing.jsx";
import { Library } from "./product-library.jsx";
import { Detail } from "./product-detail.jsx";
import { SearchOverlay } from "./product-search.jsx";
import { CliAuth } from "./cli-auth.jsx";
import { clickable } from "../lib/a11y.js";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
  useNavigate,
  useRouterState,
  createBrowserHistory,
} from "@tanstack/react-router";

// Route-split: heavy / rarely-first screens load on demand so the landing +
// library first-paint path ships a smaller entry chunk.
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
import {
  findCatalogBook,
  getCatalogBooks,
  loadCatalogBooks,
  subscribeCatalog,
} from "../lib/catalog.js";
import { clearShelf } from "../lib/shelf.js";

/* product-app.jsx — app shell + TanStack Router (real URLs / deep links / back-fwd). */
const { useState: useSt, useEffect: useEf, useCallback: useCb, createContext, useContext } = React;
const IS_PHONE_PREVIEW = new URLSearchParams(location.search).get("vp") === "phone";
const CLI_AUTH = new URLSearchParams(location.search).get("cli_auth");
const CLI_AUTH_CODE = new URLSearchParams(location.search).get("code");
const SHARED_BOOKLIST = new URLSearchParams(location.search).get("booklist");

// The shell shares its overlay handlers + navigation helpers with the screen routes
// (which are dumb wrappers that hand them to the unchanged screen components).
const ShellCtx = createContext(null);
const useShell = () => useContext(ShellCtx);

// pathname → which AppBar/tab is "active" (mirrors the old screen→tab mapping).
function activeTab(p) {
  const seg = p.split("/")[1] || "library";
  const map = {
    "": "library",
    book: "library",
    cert: "library",
    group: "social",
    groups: "social",
    booklist: "shelf",
    news: "news",
  };
  return map[seg] || seg;
}
const TAB_PATH = {
  library: "/",
  social: "/social",
  notes: "/notes",
  shelf: "/shelf",
  news: "/news",
  charts: "/charts",
  profile: "/profile",
  agents: "/agents",
  groups: "/groups",
};

function RootLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  /* landing / onboarding gates (unchanged behaviour) */
  const [entered, setEntered] = useSt(
    () =>
      SHARED_BOOKLIST != null ||
      localStorage.getItem("liber.onboarded") === "1" ||
      localStorage.getItem("liber.reader.entered") === "1",
  );
  const [onboarded, setOnboarded] = useSt(
    () => SHARED_BOOKLIST != null || localStorage.getItem("liber.onboarded") === "1",
  );
  const [phonePreview, setPhonePreview] = useSt(false);

  /* overlays (NOT routes — they stack on top of whatever screen is showing) */
  const [reader, setReader] = useSt(null);
  const [search, setSearch] = useSt(false);
  const [agentView, setAgentView] = useSt(null);
  const [graphView, setGraphView] = useSt(false);
  const [messenger, setMessenger] = useSt(null);
  const [mailDot, setMailDot] = useSt(false);
  const [notifOpen, setNotifOpen] = useSt(false);
  const [bellDot, setBellDot] = useSt(false);
  const [dark, setDark] = useSt(
    () => document.documentElement.getAttribute("data-theme") === "dark",
  );
  const [authUser, setAuthUser] = useSt(null);
  const [, setCatalogBooks] = useSt(() => getCatalogBooks());

  /* navigation helpers (URL-backed; the reader stays an overlay) */
  const openBook = (bookId, straightToReader) => {
    if (straightToReader) setReader({ bookId });
    else navigate({ to: "/book/$bookId", params: { bookId } });
  };
  const openReader = (bookId, startChapter, continueConvo) =>
    setReader({ bookId, startChapter, continueConvo });
  const openBookFromOverlay = (bookId) => navigate({ to: "/book/$bookId", params: { bookId } });
  const openBooklist = (listId) => {
    setReader(null);
    setSearch(false);
    navigate({ to: "/booklist/$listId", params: { listId } });
  };

  /* old ?booklist=<id> share links → /booklist/<id> */
  useEf(() => {
    if (SHARED_BOOKLIST) navigate({ to: "/booklist/$listId", params: { listId: SHARED_BOOKLIST } });
  }, []); // eslint-disable-line

  useEf(() => {
    const h = (e) => {
      if (!IS_PHONE_PREVIEW) setPhonePreview(e.detail === "phone");
    };
    window.addEventListener("liber-device", h);
    const o = () => {
      localStorage.removeItem("liber.onboarded");
      setOnboarded(false);
    };
    window.addEventListener("liber-show-onboarding", o);
    /* click an avatar anywhere → open that reader's profile */
    const p = (e) => {
      setReader(null);
      setSearch(false);
      setAgentView(null);
      const d = typeof e.detail === "object" && e.detail ? e.detail : { userId: e.detail };
      const uid = d.userId || d.name;
      navigate(
        uid ? { to: "/profile/$userId", params: { userId: String(uid) } } : { to: "/profile" },
      );
    };
    window.addEventListener("liber-open-profile", p);
    const dm = (e) => {
      setReader(null);
      setSearch(false);
      setAgentView(null);
      setMessenger(e.detail || true);
    };
    window.addEventListener("liber-open-dm", dm);
    return () => {
      window.removeEventListener("liber-device", h);
      window.removeEventListener("liber-show-onboarding", o);
      window.removeEventListener("liber-open-profile", p);
      window.removeEventListener("liber-open-dm", dm);
    };
  }, []); // eslint-disable-line

  const refreshAuth = useCb(() => {
    if (!window.liberApi?.auth?.me) {
      setAuthUser(null);
      return;
    }
    let live = true;
    window.liberApi.auth
      .me()
      .then((r) => {
        if (!live) return;
        const u = r?.user || null;
        setAuthUser(u);
        const tw = u && u.turnkeyWallets;
        const incomplete = !tw || !tw.sui || !tw.ethereum || !tw.solana || !tw.bitcoin;
        if (u && !u.is_guest && incomplete && window.liberApi.auth.ensureWallet) {
          const flag = `liber.tk.ensured3.${u.id}`;
          if (!localStorage.getItem(flag)) {
            window.liberApi.auth
              .ensureWallet()
              .then((res) => {
                localStorage.setItem(flag, "1");
                if (live && res?.wallets)
                  setAuthUser((prev) =>
                    prev && prev.id === u.id ? { ...prev, turnkeyWallets: res.wallets } : prev,
                  );
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {
        if (live) setAuthUser(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const clearLoginState = useCb(() => {
    setToken(null);
    clearShelf();
    localStorage.removeItem("liber.account");
    localStorage.removeItem("liber.guest");
    localStorage.removeItem("liber.onboarded");
    localStorage.removeItem("liber.reader.entered");
    localStorage.removeItem("liber.route");
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
    navigate({ to: "/" });
    setReader(null);
    setSearch(false);
    setAgentView(null);
    window.scrollTo(0, 0);
  }, [clearLoginState]); // eslint-disable-line

  const returnHome = useCb(() => {
    setReader(null);
    setSearch(false);
    setAgentView(null);
    setPhonePreview(false);
    navigate({ to: "/" });
    setEntered(false);
    window.scrollTo(0, 0);
  }, []); // eslint-disable-line

  useEf(() => {
    const h = (e) => {
      if (
        e.key === "/" &&
        !reader &&
        !search &&
        !/input|textarea/i.test(document.activeElement?.tagName || "")
      ) {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [reader, search]);

  useEf(refreshAuth, [refreshAuth, entered, onboarded]);

  useEf(() => {
    if (!authUser || !window.liberApi) {
      setMailDot(false);
      setBellDot(false);
      return;
    }
    let live = true;
    const poll = () => {
      window.liberApi.messages
        ?.unread()
        .then((r) => {
          if (live) setMailDot((r?.unread || 0) > 0);
        })
        .catch(() => {});
      window.liberApi.notifications
        ?.unread()
        .then((r) => {
          if (live) setBellDot((r?.unread || 0) > 0);
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 45000);
    const onNotifs = () => poll();
    window.addEventListener("liber-notifs", onNotifs);
    return () => {
      live = false;
      clearInterval(t);
      window.removeEventListener("liber-notifs", onNotifs);
    };
  }, [authUser]);

  useEf(() => {
    const off = subscribeCatalog((books) => setCatalogBooks(books));
    loadCatalogBooks()
      .then(setCatalogBooks)
      .catch(() => {});
    return off;
  }, []);

  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    setDark(!dark);
    document.dispatchEvent(new Event("liber-theme"));
  };
  useEf(() => {
    const h = () => {
      const d = document.documentElement.getAttribute("data-theme") === "dark";
      document.documentElement.setAttribute("data-theme", d ? "light" : "dark");
      setDark(!d);
    };
    window.addEventListener("liber-toggle-theme", h);
    return () => window.removeEventListener("liber-toggle-theme", h);
  }, [dark]);
  useEf(() => {
    const h = () => setDark(document.documentElement.getAttribute("data-theme") === "dark");
    document.addEventListener("liber-theme", h);
    return () => document.removeEventListener("liber-theme", h);
  }, []);

  const enterAsGuest = () => {
    localStorage.setItem("liber.reader.entered", "1");
    localStorage.setItem("liber.onboarded", "1");
    localStorage.removeItem("liber.guest");
    navigate({ to: "/" });
    setOnboarded(true);
    setEntered(true);
    window.scrollTo(0, 0);
  };
  const openNews = (postId) => {
    localStorage.setItem("liber.reader.entered", "1");
    localStorage.setItem("liber.onboarded", "1");
    localStorage.removeItem("liber.guest");
    navigate(
      postId ? { to: "/news/$postId", params: { postId: String(postId) } } : { to: "/news" },
    );
    setOnboarded(true);
    setEntered(true);
    window.scrollTo(0, 0);
  };
  const goSignIn = () => {
    setEntered(true);
    window.scrollTo(0, 0);
  };

  useEf(() => {
    if (localStorage.getItem("liber.guest") === "1") {
      localStorage.removeItem("liber.guest");
      setToken(null);
      setAuthUser(null);
    }
    localStorage.removeItem("liber.entered");
  }, []);

  const shell = {
    navigate,
    openBook,
    openReader,
    openBookFromOverlay,
    openBooklist,
    setReader,
    setSearch,
    setAgentView,
    setGraphView,
    authUser,
    refreshAuth,
    logout,
  };

  /* landing gate — public marketing page until the visitor enters */
  if (!entered) {
    return <Landing onEnter={enterAsGuest} onSignIn={goSignIn} onOpenNews={openNews} />;
  }

  const bookMatch = pathname.match(/^\/book\/([^/]+)/);
  const currentBookId = bookMatch ? bookMatch[1] : null;
  const active = activeTab(pathname);

  return (
    <ShellCtx.Provider value={shell}>
      {!onboarded && <Onboarding onFinish={() => setOnboarded(true)} />}
      {!reader && (
        <>
          <AppBar
            active={active}
            onNav={(k) => navigate({ to: TAB_PATH[k] || "/" })}
            onHome={returnHome}
            onToggleTheme={toggleTheme}
            isDark={dark}
            onSearch={() => setSearch(true)}
            onProfile={() => navigate({ to: "/profile" })}
            onAgentView={() =>
              setAgentView((v) =>
                v ? null : { book: currentBookId ? findCatalogBook(currentBookId) : null },
              )
            }
            agentOn={!!agentView}
            user={authUser}
            onLogout={logout}
            onMail={() => {
              setNotifOpen(false);
              setMessenger(true);
            }}
            mailDot={mailDot}
            onBell={() => setNotifOpen((o) => !o)}
            bellDot={bellDot}
          />
          <React.Suspense fallback={SUSPENSE_FALLBACK}>
            <Outlet />
          </React.Suspense>
          <MobileTabBar active={active} onNav={(k) => navigate({ to: TAB_PATH[k] || "/" })} />
        </>
      )}
      {reader && (
        <React.Suspense fallback={SUSPENSE_FALLBACK}>
          <Reader
            bookId={reader.bookId}
            startChapter={reader.startChapter}
            continueConvo={reader.continueConvo}
            onClose={() => setReader(null)}
            onOpenBook={(bid) => {
              setReader(null);
              navigate({ to: "/book/$bookId", params: { bookId: bid } });
            }}
          />
        </React.Suspense>
      )}
      {search && (
        <SearchOverlay onClose={() => setSearch(false)} onOpenBook={openBookFromOverlay} />
      )}
      {messenger && (
        <React.Suspense fallback={SUSPENSE_FALLBACK}>
          <Messenger
            startWith={messenger === true ? null : messenger}
            onClose={() => {
              setMessenger(null);
              setMailDot(false);
            }}
          />
        </React.Suspense>
      )}
      {notifOpen && (
        <React.Suspense fallback={null}>
          <NotificationsPop
            onClose={() => setNotifOpen(false)}
            onOpenBook={(bid) => {
              setNotifOpen(false);
              setReader(null);
              navigate({ to: "/book/$bookId", params: { bookId: bid } });
            }}
          />
        </React.Suspense>
      )}
      {agentView && (
        <React.Suspense fallback={SUSPENSE_FALLBACK}>
          <AgentView
            context={agentView}
            onCopy={(t) => {
              navigator.clipboard && navigator.clipboard.writeText(t);
            }}
            onSquare={() => {
              setAgentView(null);
              navigate({ to: "/agents" });
            }}
            onGraph={() => {
              setAgentView(null);
              setGraphView(true);
            }}
            onClose={() => setAgentView(null)}
          />
        </React.Suspense>
      )}
      {graphView && (
        <React.Suspense fallback={SUSPENSE_FALLBACK}>
          <GraphView
            onOpenBook={(bid) => {
              setGraphView(false);
              navigate({ to: "/book/$bookId", params: { bookId: bid } });
            }}
            onClose={() => setGraphView(false)}
          />
        </React.Suspense>
      )}
      {phonePreview && (
        <div
          className="phone-preview-scrim"
          {...clickable(() => {
            setPhonePreview(false);
            window.dispatchEvent(new CustomEvent("liber-device-reset"));
          })}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: click-containment, not a control */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-containment, not a control */}
          <div className="phone-preview-wrap" onClick={(e) => e.stopPropagation()}>
            <div className="phone-preview-cap">移动端预览 · 390pt</div>
            <IOSDevice>
              <div style={{ height: "100%", padding: "52px 0 22px", boxSizing: "border-box" }}>
                <iframe
                  src={location.pathname + "?vp=phone"}
                  title="移动端预览"
                  style={{ width: "100%", height: "100%", border: 0, background: "var(--paper)" }}
                />
              </div>
            </IOSDevice>
            <button
              type="button"
              className="phone-preview-close"
              onClick={() => {
                setPhonePreview(false);
                window.dispatchEvent(new CustomEvent("liber-device-reset"));
              }}
            >
              {I.x} 关闭预览
            </button>
          </div>
        </div>
      )}
    </ShellCtx.Provider>
  );
}

/* ---------- screen routes (dumb wrappers over the unchanged screen components) ---------- */
const rootRoute = createRootRoute({ component: RootLayout });
const r = (path, component) => createRoute({ getParentRoute: () => rootRoute, path, component });

function LibraryScreen() {
  const s = useShell();
  return <Library onOpenBook={s.openBook} onOpenCharts={() => s.navigate({ to: "/charts" })} />;
}
function DetailScreen() {
  const s = useShell();
  const { bookId } = detailRoute.useParams();
  return (
    <Detail
      bookId={bookId}
      onOpenReader={s.openReader}
      onOpenCert={(id) => s.navigate({ to: "/book/$bookId/cert", params: { bookId: id } })}
      onBack={() => s.navigate({ to: "/" })}
      onOpenAgents={() => s.navigate({ to: "/agents" })}
    />
  );
}
function CertScreen() {
  const s = useShell();
  const { bookId } = certRoute.useParams();
  return (
    <Certificate
      bookId={bookId}
      onBack={() => s.navigate({ to: "/book/$bookId", params: { bookId } })}
      onOpenBook={s.openReader}
    />
  );
}
function NotesScreen() {
  const s = useShell();
  return <Notebook onOpenBook={s.openBook} />;
}
function SocialScreen() {
  const s = useShell();
  return (
    <Social
      onOpenBook={s.openBook}
      onOpenGroup={(id) =>
        s.navigate(id ? { to: "/group/$groupId", params: { groupId: id } } : { to: "/groups" })
      }
      onContinue={(c) => s.openReader(c.book, undefined, c)}
    />
  );
}
function ProfileScreen() {
  const s = useShell();
  const { userId } = profileUserRoute.useParams();
  return (
    <Profile
      key={userId || "me"}
      userId={userId}
      onOpenBook={s.openBook}
      onBack={() => (window.history.length > 1 ? window.history.back() : s.navigate({ to: "/" }))}
      authUser={s.authUser}
      onLogout={s.logout}
      onProfileUpdated={s.refreshAuth}
    />
  );
}
function ProfileMeScreen() {
  const s = useShell();
  return (
    <Profile
      key="me"
      userId={undefined}
      onOpenBook={s.openBook}
      onBack={() => (window.history.length > 1 ? window.history.back() : s.navigate({ to: "/" }))}
      authUser={s.authUser}
      onLogout={s.logout}
      onProfileUpdated={s.refreshAuth}
    />
  );
}
function ShelfScreen() {
  const s = useShell();
  return (
    <Shelf
      onOpenBook={s.openBook}
      onOpenReader={s.openReader}
      onOpenGroup={(id) =>
        s.navigate(id ? { to: "/group/$groupId", params: { groupId: id } } : { to: "/groups" })
      }
      onOpenBooklist={s.openBooklist}
    />
  );
}
function BooklistScreen() {
  const s = useShell();
  const { listId } = booklistRoute.useParams();
  return (
    <Booklist listId={listId} onBack={() => s.navigate({ to: "/shelf" })} onOpenBook={s.openBook} />
  );
}
function GroupsScreen() {
  const s = useShell();
  return (
    <GroupsList
      onOpenGroup={(id) => s.navigate({ to: "/group/$groupId", params: { groupId: id } })}
      onBack={() => s.navigate({ to: "/social" })}
    />
  );
}
function GroupScreen() {
  const s = useShell();
  const { groupId } = groupRoute.useParams();
  return (
    <Group
      groupId={groupId}
      onBack={() => s.navigate({ to: "/social" })}
      onOpenReader={s.openReader}
    />
  );
}
function AgentsScreen() {
  const s = useShell();
  return <AgentSquare onBack={() => s.navigate({ to: "/" })} />;
}
function ChartsScreen() {
  const s = useShell();
  return (
    <Charts
      onOpenBook={s.openBook}
      onBack={() => s.navigate({ to: "/" })}
      onAgentCharts={(ctx) => s.setAgentView({ charts: ctx })}
    />
  );
}
function NewsScreen() {
  const s = useShell();
  return (
    <News
      onOpenPost={(id) => s.navigate({ to: "/news/$postId", params: { postId: String(id) } })}
      onBack={() => s.navigate({ to: "/" })}
    />
  );
}
function NewsPostScreen() {
  const s = useShell();
  const { postId } = newsPostRoute.useParams();
  return (
    <NewsPost
      postId={postId}
      onOpenPost={(id) => s.navigate({ to: "/news/$postId", params: { postId: String(id) } })}
      onBack={() => s.navigate({ to: "/news" })}
    />
  );
}

const libraryRoute = r("/", LibraryScreen);
const detailRoute = r("/book/$bookId", DetailScreen);
const certRoute = r("/book/$bookId/cert", CertScreen);
const notesRoute = r("/notes", NotesScreen);
const socialRoute = r("/social", SocialScreen);
const profileMeRoute = r("/profile", ProfileMeScreen);
const profileUserRoute = r("/profile/$userId", ProfileScreen);
const shelfRoute = r("/shelf", ShelfScreen);
const booklistRoute = r("/booklist/$listId", BooklistScreen);
const groupsRoute = r("/groups", GroupsScreen);
const groupRoute = r("/group/$groupId", GroupScreen);
const agentsRoute = r("/agents", AgentsScreen);
const chartsRoute = r("/charts", ChartsScreen);
const newsRoute = r("/news", NewsScreen);
const newsPostRoute = r("/news/$postId", NewsPostScreen);
// catch-all → library (keeps a stray/unknown path from blanking the app)
const catchAllRoute = r("$", LibraryScreen);

const routeTree = rootRoute.addChildren([
  libraryRoute,
  detailRoute,
  certRoute,
  notesRoute,
  socialRoute,
  profileMeRoute,
  profileUserRoute,
  shelfRoute,
  booklistRoute,
  groupsRoute,
  groupRoute,
  agentsRoute,
  chartsRoute,
  newsRoute,
  newsPostRoute,
  catchAllRoute,
]);
const router = createRouter({ routeTree, history: createBrowserHistory(), defaultPreload: false });

function App() {
  if (CLI_AUTH) return <CliAuth deviceCode={CLI_AUTH} userCode={CLI_AUTH_CODE} />;
  return <RouterProvider router={router} />;
}

/* lightweight placeholder for not-yet-built tabs */
function Placeholder({ name, onBack }) {
  return (
    <div className="app-screen">
      <div
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          textAlign: "center",
          padding: "80px 20px",
        }}
      >
        <div>
          <div className="kicker" style={{ justifyContent: "center", marginBottom: 18 }}>
            即将到来
          </div>
          <h2 className="display-m" style={{ marginBottom: 14 }}>
            {name}
          </h2>
          <p className="muted" style={{ maxWidth: "42ch", margin: "0 auto 26px", fontSize: 18 }}>
            这一部分还在设计中。当前原型聚焦在{" "}
            <b style={{ color: "var(--accent)" }}>书库 → 详情 → 阅读器</b> 这条主线。
          </p>
          <button type="button" className="btn btn-primary" onClick={onBack}>
            回到书库 <span className="arr">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export { App, Placeholder };
