import React from "react";

/* product-shared.jsx — Cover, icon set, AppBar. Exported to window. */
const { useState, useEffect, useRef, useCallback } = React;

/* ---- Icon set (1.7 stroke, inherits currentColor) ---- */
const I = {
  search:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>,
  sun:      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="4.4"/><path d="M12 2v2.6M12 19.4V22M4.2 4.2l1.9 1.9M17.9 17.9l1.9 1.9M2 12h2.6M19.4 12H22M4.2 19.8l1.9-1.9M17.9 6.1l1.9-1.9"/></svg>,
  moon:     <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>,
  list:     <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 6h16M4 12h16M4 18h10"/></svg>,
  type:     <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg>,
  spark:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>,
  hl:       <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 20h16M5 16l9-9 3 3-9 9H5v-3Z"/></svg>,
  note:     <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/></svg>,
  copy:     <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>,
  ask:      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M21 12a8 8 0 1 1-3.5-6.6L21 4v5h-5"/></svg>,
  x:        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m6 6 12 12M18 6 6 18"/></svg>,
  left:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 5-7 7 7 7"/></svg>,
  right:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 5 7 7-7 7"/></svg>,
  up:       <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 14 6-6 6 6"/></svg>,
  send:     <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12h13M12 5l7 7-7 7"/></svg>,
  book:     <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h12"/></svg>,
  lock:     <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>,
  echo:     <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="2.6"/><circle cx="5" cy="6" r="1.5"/><circle cx="19" cy="7" r="1.5"/><circle cx="18" cy="18" r="1.5"/><path d="M9.9 10.7 6.4 7.2M14.1 10.9 17.4 8.2M13.7 14.1 16.8 16.6"/></svg>,
  agent:    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="7" width="16" height="12" rx="2"/><path d="M12 7V4M9 12h.01M15 12h.01M9.5 16h5"/><path d="M2 11v3M22 11v3"/></svg>,
};

/* ---- Brand mark ---- */
function Mark({ size = 28 }){
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="3.2" height="20" rx="1.6" fill="currentColor"/>
      <rect x="10.4" y="5" width="3.2" height="20" rx="1.6" fill="currentColor"/>
      <rect x="16.8" y="5" width="3.2" height="20" rx="1.6" fill="currentColor"/>
      <rect x="23.2" y="5" width="3.2" height="20" rx="1.6" fill="currentColor"/>
      <rect x="2" y="13.4" width="26" height="2.4" rx="1.2" fill="currentColor"/>
    </svg>
  );
}

/* ---- Book cover ---- */
function Cover({ book, className = "", style }){
  return (
    <div className={`bk-cover ${book.cls} ${className}`} style={style}>
      <div className="c-top">CC0 · {(book.sub || book.a).toUpperCase()}</div>
      <div>
        <div className="c-title">{book.t}</div>
        {book.sub && <div className="c-sub">{book.sub}</div>}
      </div>
      <div className="c-foot">
        <div className="c-author">{book.a}</div>
        <div className="c-seal">{book.seal}</div>
      </div>
    </div>
  );
}

/* ---- Top app bar ---- */
function AppBar({ active, onNav, onHome, onToggleTheme, isDark, onSearch, onProfile, onAgentView, agentOn, user, onLogout }){
  const links = [["library","书库"],["charts","榜单"],["shelf","我的书架"],["notes","笔记"],["social","共读"],["news","动态"]];
  const ava = user?.seal || user?.name?.slice(0, 1) || "读";
  return (
    <div className="appbar">
      <div className="brand" onClick={onHome || (() => onNav("library"))} title="回到首页">
        <Mark size={26}/>
        <span className="word">Liber</span>
      </div>
      <nav className="nav">
        {links.map(([k,label]) => (
          <a key={k} className={active === k ? "on" : ""} onClick={() => onNav(k)}>{label}</a>
        ))}
      </nav>
      <div className="spacer"/>
      <div className="search" onClick={onSearch} role="button">
        {I.search}
        <input placeholder="搜书名、作者、句子…" readOnly style={{ cursor:"pointer" }} />
        <kbd>/</kbd>
      </div>
      <button className="icon-btn appbar-msearch" onClick={onSearch} aria-label="搜索">{I.search}</button>
      <button className={"av-toggle"+(agentOn?" on":"")} onClick={onAgentView} title="Agent 视角：这一页 AI Agent 看到的样子">{I.agent}<span>Agent 视角</span></button>
      <button className="icon-btn" onClick={onToggleTheme} aria-label="切换主题">{isDark ? I.sun : I.moon}</button>
      {user && <button className="appbar-logout" onClick={onLogout}>退出</button>}
      <div className={"avatar"+(active==="profile"?" on":"")} title={user ? `${user.name} · 我的` : "我的"} onClick={onProfile}>{ava}</div>
    </div>
  );
}

/* ---- Mobile bottom tab bar (CSS-shown under 760px) ---- */
function MobileTabBar({ active, onNav }){
  const tabs = [
    ["library","书库", I.search && (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 5a2 2 0 0 1 2-2h13v17H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/></svg>)],
    ["shelf","书架",
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 4h4v16H4zM10 4h4v16h-4zM17 5l3.4 .9-3 14.7-3.3-.9z"/></svg>],
    ["notes","笔记",
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M5 4h12l2 2v14H5z"/><path d="M9 9h7M9 13h7M9 17h4"/></svg>],
    ["social","共读",
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="8" cy="9" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M14 20c0-2.2 1.2-3.6 3-3.8"/></svg>],
    ["news","动态",
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 5h12v14H6a2 2 0 0 1-2-2z"/><path d="M16 8h3a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2"/><path d="M7 9h6M7 13h6M7 17h4"/></svg>],
    ["profile","我的",
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>],
  ];
  return (
    <nav className="mobile-tabbar">
      {tabs.map(([k,label,icon]) => (
        <button key={k} className={active===k?"on":""} onClick={()=>onNav(k)}>
          {icon}<span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ---- Profile navigation + follow store (shared via window across screens) ---- */
function profileTarget(input){
  if (!input) return null;
  if (typeof input === "object") {
    const userId = input.userId || input.id;
    const name = input.name || input.u;
    if (userId || name) return { userId, name };
    return null;
  }
  const name = String(input);
  if (name.startsWith("u_")) return { userId: name };
  if ((window.PEOPLE && window.PEOPLE[name]) || (window.ME && name === window.ME.name)) return { name };
  return null;
}
function canOpenProfile(input){
  return !!profileTarget(input);
}
function openProfile(input){
  const target = profileTarget(input);
  if (!target) return;
  window.dispatchEvent(new CustomEvent("liber-open-profile", { detail: target }));
}
const FOLLOW_KEY = "liber.following";
function readFollow(){
  try { const v = JSON.parse(localStorage.getItem(FOLLOW_KEY)); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function writeFollow(list){
  localStorage.setItem(FOLLOW_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("liber-following"));
}
function isFollowing(name){ return readFollow().includes(name); }
function toggleFollow(name){
  const cur = readFollow();
  const next = cur.includes(name) ? cur.filter(x => x !== name) : [...cur, name];
  writeFollow(next);
  return next.includes(name);
}

if (typeof window !== "undefined")
  Object.assign(window, { canOpenProfile, openProfile, readFollow, writeFollow, isFollowing, toggleFollow });

export { I, Mark, Cover, AppBar, MobileTabBar, canOpenProfile, openProfile, readFollow, writeFollow, isFollowing, toggleFollow };
