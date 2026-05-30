import React from "react";
import { I, AppBar, MobileTabBar } from "./product-shared.jsx";
import { IOSDevice } from "./ios-frame.jsx";
import { Onboarding } from "./product-onboarding.jsx";
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

/* product-app.jsx — router, theme, mount. */
const { useState: useSt, useEffect: useEf } = React;
const IS_PHONE_PREVIEW = new URLSearchParams(location.search).get("vp") === "phone";

function App(){
  /* onboarding gate */
  const [onboarded, setOnboarded] = useSt(() => localStorage.getItem("liber.onboarded") === "1");
  /* phone preview overlay (outer instance only) */
  const [phonePreview, setPhonePreview] = useSt(false);
  useEf(() => {
    const h = (e) => { if (!IS_PHONE_PREVIEW) setPhonePreview(e.detail === "phone"); };
    window.addEventListener("liber-device", h);
    const o = () => { localStorage.removeItem("liber.onboarded"); setOnboarded(false); };
    window.addEventListener("liber-show-onboarding", o);
    return () => { window.removeEventListener("liber-device", h); window.removeEventListener("liber-show-onboarding", o); };
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

  /* keyboard: "/" opens search */
  useEf(() => {
    const h = (e) => {
      if (e.key === "/" && !reader && !search && !/input|textarea/i.test(document.activeElement?.tagName||"")){ e.preventDefault(); setSearch(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [reader, search]);

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

  const openBook = (bookId, straightToReader) => {
    if (straightToReader) setReader({ bookId });
    else setRoute({ screen:"detail", bookId });
  };
  const openReader = (bookId, startChapter, continueConvo) => setReader({ bookId, startChapter, continueConvo });
  const openBookFromOverlay = (bookId) => { setRoute({ screen:"detail", bookId }); };

  return (
    <>
      {!onboarded && <Onboarding onFinish={() => setOnboarded(true)} />}
      {!reader && (
        <>
          <AppBar active={({detail:"library", group:"social", groups:"social", cert:"library"})[route.screen] || route.screen}
            onNav={(k) => setRoute({ screen: k === "library" ? "library" : k })}
            onToggleTheme={toggleTheme} isDark={dark}
            onSearch={() => setSearch(true)} onProfile={() => setRoute({ screen:"profile" })}
            onAgentView={() => setAgentView(v => v ? null : { book: (route.screen==="detail"||route.screen==="cert") ? window.BOOKS.find(b=>b.id===route.bookId) : null })} agentOn={!!agentView} />
          {route.screen === "library" && <Library onOpenBook={openBook} onOpenCharts={() => setRoute({ screen:"charts" })} />}
          {route.screen === "detail" && <Detail bookId={route.bookId} onOpenReader={openReader} onOpenCert={(id) => setRoute({ screen:"cert", bookId:id })} onBack={() => setRoute({ screen:"library" })} onOpenAgents={() => setRoute({ screen:"agents" })} />}
          {route.screen === "notes" && <Notebook onOpenBook={openBook} />}
          {route.screen === "social" && <Social onOpenBook={openBook} onOpenGroup={(id) => setRoute({ screen: id ? "group" : "groups", groupId:id })} onContinue={(c) => openReader(c.book, undefined, c)} />}
          {route.screen === "profile" && <Profile onOpenBook={openBook} />}
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
