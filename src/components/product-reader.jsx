import React from "react";
import { I } from "./product-shared.jsx";
import { ProvBadge } from "./product-provenance.jsx";
import { ConvoArtifact } from "./product-convocard.jsx";
import { EchoOverlay } from "./product-echo.jsx";
import { catalogHasLiveBooks, findCatalogBook, getCatalogBooks } from "../lib/catalog.js";
import { convertChineseText, isChineseScriptMode } from "../lib/zh-convert.js";

/* product-reader.jsx — full-screen reader with selection menu, highlights,
   others' annotations, AI companion drawer, TOC, settings, progress.
   Layouts: classic | folio | archive | vertical | immersive. */
const { useState: useS, useEffect: useE, useRef: useR, useCallback: useCb } = React;
const READER_LAYOUT_OPTIONS = [
  { value: "classic", label: "经典" },
  { value: "folio", label: "书页" },
  { value: "archive", label: "批注" },
  { value: "vertical", label: "竖排" },
  { value: "immersive", label: "沉浸" },
];
const READER_LAYOUTS = new Set(READER_LAYOUT_OPTIONS.map((item) => item.value));
const profileRef = (x) => x?.userId ? { userId:x.userId, name:x.u || x.name } : (x?.u || x?.name || x);
const canProfile = (x) => window.canOpenProfile(profileRef(x));
const openProfile = (x) => window.openProfile(profileRef(x));

/* ---- AI canned brain (mode-aware) ---- */
const AI_MODES = [
  { k:"translate", label:"古文今译", role:"古文今译模式" },
  { k:"companion", label:"通读陪伴", role:"通读陪伴模式" },
  { k:"extend",    label:"知识延展", role:"知识延展模式" },
  { k:"notes",     label:"总结笔记", role:"总结笔记模式" },
  { k:"debate",    label:"苏格拉底", role:"苏格拉底模式" },
];
function aiReply(mode, q, ctx){
  const c = ctx ? `就你选中的「${ctx}」` : "这一句";
  if (mode === "translate")
    return { t:`今译：${ctx || q}。\n字词：逐句对照原文理解，先抓主语和动作，再看虚词转折。\n提醒：这是本地离线兜底；联网后会用 Workers AI 给出更准确的今译。`, ref:"古文今译 · offline" };
  if (mode === "debate")
    return { t:`那我反问你：你说的这个理解，换一个处境还成立吗？${ctx?`比如把「${ctx}」放到完全相反的情形里——它会不会反而说明了相反的事？`:""}先别急着下结论，我们一层层往下问。`, ref:"反问 · 苏格拉底式" };
  if (mode === "notes")
    return { t:`已为${c}整理 ——\n① 核心命题：语言与「道」的边界；\n② 关键对立：无名／有名、无欲／有欲；\n③ 收束：玄之又玄，众妙之门。`, ref:"已存入你的读书笔记 · 可导出" };
  if (mode === "extend")
    return { t:`${c}的这个概念，在馆里还能顺藤摸瓜：庄子《逍遥游》把它推得更远，亚当·斯密「看不见的手」也有几分影子。要不要对照读一段？`, ref:"↗ 跳转：庄子 · 逍遥游" };
  if (mode === "stoic")
    return { t:`换一个斯多葛的问法：${c}里，哪一部分在你的掌控之内，哪一部分不在？奥勒留会提醒你——困住人的从不是事本身，而是我们对它下的判断。`, ref:"斯多葛导师 · community/stoa" };
  if (mode === "textual")
    return { t:`先咬一下字：${c}的关键字，历代注本读法并不一致。王弼本与帛书本此处就有出入——把字源摊开，意思往往自己显形。`, ref:"考据派 · community/kaoju" };
  if (mode === "skeptic")
    return { t:`我先不接受这个说法。${c}——凭什么这样断定？它的反例是什么？换一个前提，结论还站得住吗？我们把它怀疑到底，剩下的才算数。`, ref:"怀疑论者 · community/pyrrho" };
  if (mode === "econ")
    return { t:`用激励和成本来看${c}：谁付出、谁得益？如果把它放进一个有稀缺和选择的处境里，人们的行为会怎么变？文本背后往往藏着一笔账。`, ref:"经济学家之眼 · community/smith" };
  return { t:`可以这样理解${c}：老子想说的，往往不在字面，而在字面留出的那道缝里。读慢一点，让句子自己展开——有需要我随时在旁边。`, ref:"道德经 · 第一章" };
}

function chapterPlaceholder(bookId, n, title, text = "正文加载中…", status = "loading") {
  return {
    n,
    title: title || `第 ${n} 章`,
    placeholder: true,
    status,
    paras: [[{ id: `${bookId}-c${n}-${status}`, t: text }]],
  };
}

const epubFont = {
  song: "'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', serif",
  kai: "'KaiTi', 'STKaiti', 'Cormorant Garamond', serif",
  hei: "ui-monospace, 'IBM Plex Mono', 'SFMono-Regular', monospace",
};
const epubPalette = {
  cream: { bg: "#f4efe5", fg: "#2d261f" },
  paper: { bg: "#f7f3ea", fg: "#27221c" },
  sepia: { bg: "#f3e8d2", fg: "#30261a" },
  night: { bg: "#14110c", fg: "#d9cfba" },
};

function applyEpubTheme(rendition, { font, size, lead, rtheme, layout = "classic" }) {
  if (!rendition?.themes) return;
  const palette = epubPalette[rtheme] || epubPalette.cream;
  const isVertical = layout === "vertical";
  const body = {
    "background": `${palette.bg} !important`,
    "color": `${palette.fg} !important`,
    "font-family": `${epubFont[font] || epubFont.song} !important`,
    "font-size": `${size}px !important`,
    "line-height": `${lead} !important`,
    "padding": isVertical ? "5% 2.4em !important" : "0 8% !important",
  };
  const paragraph = {
    "margin": isVertical ? "0 0 0 1.25em !important" : "0 0 1em 0 !important",
    "text-indent": isVertical ? "1em !important" : "1.25em !important",
  };
  if (isVertical) {
    Object.assign(body, {
      "writing-mode": "vertical-rl !important",
      "text-orientation": "mixed !important",
      "height": "100vh !important",
      "max-height": "100vh !important",
    });
    Object.assign(paragraph, {
      "writing-mode": "vertical-rl !important",
      "text-orientation": "mixed !important",
    });
  }
  rendition.themes.register("liber", {
    html: isVertical ? {
      "writing-mode": "vertical-rl !important",
      "text-orientation": "mixed !important",
      "height": "100vh !important",
    } : {},
    body: {
      ...body,
    },
    p: {
      ...paragraph,
    },
    "p.footnote": {
      "border-left": "2px solid rgba(169, 77, 53, .28) !important",
      "color": "#6d6255 !important",
      "font-size": ".86em !important",
      "padding-left": ".8em !important",
      "text-indent": "0 !important",
    },
    img: {
      "max-width": "100% !important",
      "height": "auto !important",
    },
    a: {
      "color": "#a94d35 !important",
    },
  });
  rendition.themes.select("liber");
}

function hasReaderEpub(book) {
  if (!book?.id || book.id === "daodejing") return false;
  if (book.hasEpub != null) return Boolean(book.hasEpub);
  return Boolean(book.dynamic);
}

function readerModeKey(bookId) {
  return `liber.reader.mode.v4.${bookId || "unknown"}`;
}

function defaultReaderMode(book) {
  return "text";
}

function storedReaderMode(book) {
  try {
    return localStorage.getItem(readerModeKey(book?.id)) === "text" ? "text" : defaultReaderMode(book);
  } catch {
    return defaultReaderMode(book);
  }
}

function storedReaderLayout() {
  try {
    const value = localStorage.getItem("liber.reader.layout") || "classic";
    return READER_LAYOUTS.has(value) ? value : "classic";
  } catch {
    return "classic";
  }
}

function readStoredMap(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function flattenEpubToc(items = [], depth = 0, out = []) {
  for (const item of items || []) {
    const href = item.href || item.url || item.cfi || "";
    const title = item.label || item.title || item.text || href;
    if (href && title) out.push({ key: `${href}-${out.length}`, href, title, depth, has: true });
    if (item.subitems?.length) flattenEpubToc(item.subitems, depth + 1, out);
  }
  return out;
}

function sameEpubHref(left = "", right = "") {
  const clean = (value) => String(value || "").split("#")[0];
  return Boolean(clean(left) && clean(left) === clean(right));
}

function epubContentDocument(contents) {
  return contents?.document || contents?.content?.document || contents?.window?.document || null;
}

function applyChineseScriptToDocument(doc, mode, originalText) {
  if (!doc?.body) return;
  const win = doc.defaultView || window;
  const filter = win.NodeFilter || globalThis.NodeFilter;
  if (!filter) return;
  const walker = doc.createTreeWalker(doc.body, filter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return filter.FILTER_REJECT;
      const parent = node.parentElement;
      if (parent?.closest?.("script, style, svg, math, code, pre")) return filter.FILTER_REJECT;
      return filter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    node.nodeValue = convertChineseText(originalText.get(node), mode);
    node = walker.nextNode();
  }
  doc.documentElement?.setAttribute("data-liber-script", mode);
}

function applyEpubScriptMode(rendition, mode, originalText) {
  const contents = typeof rendition?.getContents === "function" ? rendition.getContents() : [];
  for (const content of contents) applyChineseScriptToDocument(epubContentDocument(content), mode, originalText);
}

function EpubReader({ bookId, controlRef, font, size, lead, rtheme, scriptMode, layout, onNavigation, onRelocated, onUnavailable }) {
  const hostRef = useR(null);
  const renditionRef = useR(null);
  const scriptModeRef = useR(scriptMode);
  const originalTextRef = useR(new WeakMap());
  const [status, setStatus] = useS("loading");
  const [error, setError] = useS("");

  useE(() => {
    scriptModeRef.current = scriptMode;
    applyEpubScriptMode(renditionRef.current, scriptMode, originalTextRef.current);
  }, [scriptMode, status]);

  useE(() => {
    let cancelled = false;
    let epubBook = null;
    let rendition = null;
    setStatus("loading");
    setError("");
    const source = `/api/books/${encodeURIComponent(bookId)}/reader.epub`;

    import("epubjs").then((mod) => {
      if (cancelled) return null;
      const ePub = mod.default?.default || mod.default || mod["module.exports"]?.default || mod["module.exports"];
      if (typeof ePub !== "function") throw new Error("EPUB 阅读器初始化失败");
      epubBook = ePub(source);
      epubBook.loaded?.navigation?.then((nav) => {
        if (!cancelled) onNavigation?.(flattenEpubToc(nav?.toc || []));
      }).catch(() => {});
      rendition = epubBook.renderTo(hostRef.current, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "none",
      });
      renditionRef.current = rendition;
      controlRef.current = {
        next: () => rendition.next(),
        prev: () => rendition.prev(),
        display: (href) => rendition.display(href),
      };
      rendition.hooks?.content?.register?.((contents) => {
        applyChineseScriptToDocument(epubContentDocument(contents), scriptModeRef.current, originalTextRef.current);
      });
      rendition.on?.("relocated", (loc) => {
        if (!cancelled) onRelocated?.(loc);
      });
      applyEpubTheme(rendition, { font, size, lead, rtheme, layout });
      return rendition.display();
    }).then(() => {
      if (!cancelled) setStatus("ready");
    }).catch((err) => {
      if (!cancelled) {
        setStatus("error");
        setError(err?.message || "EPUB 阅读版暂时无法加载");
        onUnavailable?.(err);
      }
    });

    return () => {
      cancelled = true;
      if (controlRef.current) controlRef.current = null;
      renditionRef.current = null;
      originalTextRef.current = new WeakMap();
      try { rendition?.destroy?.(); } catch { /* ignore */ }
      try { epubBook?.destroy?.(); } catch { /* ignore */ }
    };
  }, [bookId, onNavigation, onRelocated, onUnavailable]);

  useE(() => {
    applyEpubTheme(renditionRef.current, { font, size, lead, rtheme, layout });
    try { renditionRef.current?.resize?.(); } catch { /* ignore */ }
  }, [font, size, lead, rtheme, layout, status]);

  return (
    <div className="rd-epub-panel">
      <div className="rd-epub-host" ref={hostRef}/>
      {status !== "ready" && (
        <div className={`rd-epub-status ${status}`}>
          {status === "error" ? error : "正在打开 EPUB 阅读版…"}
        </div>
      )}
    </div>
  );
}

function Reader({ bookId, startChapter, onClose, continueConvo, onOpenBook }){
  const missingBook = { id: bookId, t: "未找到该书", a: "", sub: "", cls: "ink", seal: "书" };
  const seedBook = findCatalogBook(bookId) || (catalogHasLiveBooks() ? missingBook : getCatalogBooks()[0]) || missingBook;
  const seedContentFor = (id) => (window.BOOK_CONTENT && window.BOOK_CONTENT[id]) || null;
  const seedContent = seedContentFor(seedBook.id);
  const seedChapters = seedContent?.chapters || [];
  const [book, setBook] = useS(seedBook);
  const [chapters, setChapters] = useS(seedChapters);
  const [toc, setToc] = useS(seedContent?.toc || []);
  const [cIdx, setCIdx] = useS(() => {
    const i = seedChapters.findIndex(c => c.n === startChapter);
    return i >= 0 ? i : 0;
  });
  useE(() => {
    const nextSeed = findCatalogBook(bookId) || (catalogHasLiveBooks() ? missingBook : getCatalogBooks()[0]) || missingBook;
    const nextContent = seedContentFor(nextSeed.id);
    const nextSeedChapters = nextContent?.chapters || [];
    setBook(nextSeed);
    setChapters(nextSeedChapters);
    setToc(nextContent?.toc || []);
    const seedIdx = nextSeedChapters.findIndex(c => c.n === startChapter);
    setCIdx(seedIdx >= 0 ? seedIdx : 0);
    if (!window.liberApi) return;
    let live = true;
    window.liberApi.books.get(bookId).then((detail) => {
      if (!live) return;
      if (detail?.book) setBook(detail.book);
      if (Array.isArray(detail?.toc) && detail.toc.length) {
        const readable = detail.toc.filter(t => t.has !== false);
        const list = readable.length ? readable : detail.toc;
        setToc(detail.toc);
        setChapters(list.map(t => chapterPlaceholder(bookId, t.n, t.title)));
        const i = list.findIndex(c => c.n === startChapter);
        setCIdx(i >= 0 ? i : 0);
      }
    }).catch(() => {});
    return () => { live = false; };
  }, [bookId, startChapter]);
  const noText = !chapters.length;
  const ch = chapters[cIdx] || chapters[0] || { n: 1, title: "暂无正文", paras: [] };
  const chapterCount = chapters.length || 1;

  useE(() => {
    if (!ch?.placeholder || ch.status !== "loading" || !window.liberApi?.books?.content) return;
    let live = true;
    window.liberApi.books.content(bookId, ch.n).then((res) => {
      if (!live) return;
      const next = res?.chapter || null;
      if (!next?.paras?.length) throw new Error("empty chapter");
      setChapters((rows) => rows.map((row) => row.n === ch.n ? { ...next, placeholder: false, status: "ready" } : row));
    }).catch(() => {
      if (!live) return;
      setChapters((rows) => rows.map((row) => row.n === ch.n
        ? chapterPlaceholder(bookId, ch.n, ch.title, "这一章暂时无法加载。请稍后重试。", "error")
        : row));
    });
    return () => { live = false; };
  }, [bookId, ch?.n, ch?.placeholder, ch?.status]);

  /* layout (driven by tweaks + the in-reader 版式 switcher) */
  const [layout, setLayout] = useS(storedReaderLayout);
  const setReaderLayout = useCb((value) => {
    const next = READER_LAYOUTS.has(value) ? value : "classic";
    setLayout(next);
    try { localStorage.setItem("liber.reader.layout", next); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("liber-reader-layout", { detail: next }));
  }, []);
  useE(() => {
    const h = e => { if (READER_LAYOUTS.has(e.detail)) setLayout(e.detail); };
    window.addEventListener("liber-reader-layout", h);
    return () => window.removeEventListener("liber-reader-layout", h);
  }, []);
  const [readMode, setReadModeState] = useS(() => storedReaderMode(seedBook));
  const epubControl = useR(null);
  const [epubToc, setEpubToc] = useS([]);
  const [epubLocation, setEpubLocation] = useS(null);
  const hasEpub = hasReaderEpub(book);
  const setReadMode = useCb((next, options = {}) => {
    setReadModeState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      if (options.persist !== false) {
        try {
          if (value === "text") localStorage.setItem(readerModeKey(book.id), value);
          else localStorage.removeItem(readerModeKey(book.id));
        } catch { /* ignore */ }
      }
      return value;
    });
  }, [book.id]);
  useE(() => {
    setReadModeState(storedReaderMode(book));
    setEpubToc([]);
    setEpubLocation(null);
  }, [book.id, book.dynamic, book.hasEpub]);
  useE(() => {
    if (!hasEpub && readMode === "epub") setReadMode("text");
  }, [hasEpub, readMode, setReadMode]);

  /* reading settings (persisted) */
  const load = (k, d) => { const v = localStorage.getItem("liber.set."+k); return v == null ? d : v; };
  const [font, setFont]     = useS(() => load("font", "song"));
  const [size, setSize]     = useS(() => +load("size", 21));
  const [lead, setLead]     = useS(() => +load("lead", 1.95));
  const [meas, setMeas]     = useS(() => {
    const raw = localStorage.getItem("liber.set.meas");
    /* widen the default column (was 38rem → too much side whitespace); migrate the stale default once */
    if (raw == null || localStorage.getItem("liber.set.ver") !== "2") return 46;
    return +raw;
  });
  const [rtheme, setRtheme] = useS(() => load("rtheme", "cream"));
  const [scriptMode, setScriptMode] = useS(() => {
    const value = load("script", "original");
    return isChineseScriptMode(value) ? value : "original";
  });
  useE(() => { localStorage.setItem("liber.set.font", font); }, [font]);
  useE(() => { localStorage.setItem("liber.set.size", size); }, [size]);
  useE(() => { localStorage.setItem("liber.set.lead", lead); }, [lead]);
  useE(() => { localStorage.setItem("liber.set.meas", meas); localStorage.setItem("liber.set.ver", "2"); }, [meas]);
  useE(() => { localStorage.setItem("liber.set.rtheme", rtheme); }, [rtheme]);
  useE(() => { localStorage.setItem("liber.set.script", scriptMode); }, [scriptMode]);
  const tx = useCb((value) => convertChineseText(value, scriptMode), [scriptMode]);

  /* ---- page-turn mode: scroll | slide | book | curl | fade (applies to 互动/text reading) ---- */
  const [pageMode, setPageMode] = useS(() => load("pagemode", "scroll"));
  useE(() => { localStorage.setItem("liber.set.pagemode", pageMode); }, [pageMode]);
  const paged = pageMode !== "scroll" && readMode === "text" && !noText;
  const flowRef = useR(null);
  const vpRef = useR(null);
  const [page, setPage] = useS(0);
  const [pageCount, setPageCount] = useS(1);
  const [step, setStep] = useS(0);
  const [colw, setColw] = useS(0);
  const [gap, setGap] = useS(88);
  const [fading, setFading] = useS(false);
  const [flip, setFlip] = useS(null);   // page-curl overlay: { show, bg, dir }
  const animatingRef = useR(false);
  const pendingLast = useR(false);
  const isCurl = pageMode === "curl";

  const fontFam = { song: "var(--body)", kai: "'Cormorant Garamond', 'KaiTi', serif", hei: "'IBM Plex Mono', sans-serif" }[font] || "var(--body)";

  /* highlights + user notes (persisted per book) */
  const hlKey = "liber.hl."+book.id, ntKey = "liber.nt."+book.id;
  const [hls, setHls]   = useS(() => readStoredMap(hlKey));
  const [notes, setNotes] = useS(() => readStoredMap(ntKey));
  const [heat, setHeat] = useS({});
  useE(() => {
    setHls(readStoredMap("liber.hl."+book.id));
    setNotes(readStoredMap("liber.nt."+book.id));
    setHeat({});
    setSrvAnno({});
  }, [book.id]);
  useE(() => { localStorage.setItem(hlKey, JSON.stringify(hls)); }, [hls]);
  useE(() => { localStorage.setItem(ntKey, JSON.stringify(notes)); }, [notes]);

  /* hydrate this book's highlights/notes from the backend (cross-device), best-effort */
  useE(() => {
    if (typeof window === "undefined" || !window.liberApi) return;
    let cancelled = false;
    window.liberApi.reading.get(book.id).then(r => {
      if (cancelled || !r) return;
      if (r.highlights && Object.keys(r.highlights).length) setHls(prev => ({ ...r.highlights, ...prev }));
      if (r.notes && Object.keys(r.notes).length) setNotes(prev => {
        const merged = { ...prev };
        for (const sid of Object.keys(r.notes)) {
          const have = new Set((merged[sid] || []).map(n => n.t));
          merged[sid] = [ ...(merged[sid] || []), ...r.notes[sid].filter(n => !have.has(n.t)) ];
        }
        return merged;
      });
      if (r.heat && typeof r.heat === "object") setHeat(r.heat);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [book.id]);

  /* popovers / drawers */
  const [sel, setSel]   = useS(null);   // {x,y,text,sids}
  const [notePop, setNotePop] = useS(null); // {x,y,sid}
  const [tocOpen, setTocOpen] = useS(false);
  const [setOpen, setSetOpen] = useS(false);
  const [aiOpen, setAiOpen]   = useS(!!continueConvo);
  const [turn, setTurn] = useS(null);
  const [railTab, setRailTab] = useS(continueConvo ? "ai" : "anno"); // archive rail: anno | ai

  /* share composer + toast */
  const [shareOpen, setShareOpen] = useS(false);
  const [toast, setToast] = useS(null);
  const [echo, setEcho] = useS(null);   // {sid, text} for cross-book echoes
  const onEpubUnavailable = useCb(() => {
    setReadMode("text", { persist: false });
    setToast("EPUB 阅读版暂时无法打开，已切到文本索引");
  }, [setReadMode]);

  /* AI state */
  const [aiMode, setAiMode] = useS("companion");
  const [summoned, setSummoned] = useS([]);   // invited community lens ids
  const [lensPicker, setLensPicker] = useS(false);
  const [aiCtx, setAiCtx]   = useS(continueConvo ? continueConvo.quote : null);
  const [feed, setFeed]     = useS(() => continueConvo
    ? [
        { who:"bot", t:`你正接着 ${continueConvo.author?.name||"一位读者"} 关于《${continueConvo.bookT}》的这段对话往下问。下面是 ta 之前聊到的——继续就好。`, ref:"接续对话 · "+continueConvo.chap },
        ...continueConvo.msgs.map(m => ({ who: m.r==="q"?"user":"bot", t:m.t, ref: m.r==="q"?undefined:"原对话" })),
      ]
    : [
        { who:"bot", t:`我正在陪你读这本《${seedBook.t}》。读到哪、卡在哪，问我就好——我会尽量只基于当前文本回答。`, ref:"通读陪伴模式" },
      ]);
  const [typing, setTyping] = useS(false);
  const [draft, setDraft]   = useS("");
  const [srvAnno, setSrvAnno] = useS({}); // others' annotations fetched from the backend, per sentence

  const scrollRef = useR(null);
  const turnTimer = useR(null);
  const [prog, setProg] = useS(0);
  useE(() => () => { if (turnTimer.current) window.clearTimeout(turnTimer.current); }, []);

  /* progress tracking */
  useE(() => {
    const el = scrollRef.current; if (!el) return;
    const onScroll = () => {
      if (layout === "vertical") {
        const max = el.scrollWidth - el.clientWidth;
        setProg(max > 0 ? Math.min(1, Math.abs(el.scrollLeft) / max) : 0);
        return;
      }
      const max = el.scrollHeight - el.clientHeight;
      setProg(max > 0 ? el.scrollTop / max : 0);
    };
    el.addEventListener("scroll", onScroll, { passive:true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [cIdx, layout]);
  useE(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = 0;
    scrollRef.current.scrollLeft = 0;
  }, [cIdx, layout]);

  /* persist place (local + backend progress, best-effort) */
  useE(() => {
    localStorage.setItem("liber.place", JSON.stringify({ bookId: book.id, n: ch.n }));
    if (typeof window !== "undefined" && window.liberApi)
      window.liberApi.reading.progress(book.id, ch.n, Math.round((cIdx / chapterCount) * 100)).catch(() => {});
  }, [book.id, ch.n, cIdx, chapterCount]);

  /* ---- text selection -> popover ---- */
  const onMouseUp = useCb(() => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.toString().trim()) { setSel(null); return; }
    const range = s.getRangeAt(0);
    const sids = [];
    document.querySelectorAll(".rd-sentence").forEach(el => {
      if (range.intersectsNode(el)) sids.push(el.dataset.sid);
    });
    if (!sids.length) { setSel(null); return; }
    const r = range.getBoundingClientRect();
    setSel({ x: r.left + r.width/2, y: r.top - 10, text: s.toString().trim(), sids });
    setNotePop(null);
  }, []);

  const applyHl = (color) => {
    if (!sel) return;
    const sids = sel.sids;
    const clearing = color == null;
    const before = hls;
    setHls(prev => {
      const n = { ...prev };
      sids.forEach(id => {
        if (clearing) delete n[id];
        else n[id] = color;
      });
      return n;
    });
    setHeat(prev => {
      const next = { ...prev };
      sids.forEach(id => {
        if (clearing) {
          if (before[id]) next[id] = Math.max(0, Number(next[id] || 1) - 1);
        } else if (!before[id]) {
          next[id] = Number(next[id] || 0) + 1;
        }
        if (!next[id]) delete next[id];
      });
      return next;
    });
    if (window.liberApi) sids.forEach(id => window.liberApi.reading.highlight(book.id, id, color).catch(() => {}));
    window.getSelection().removeAllRanges();
    setSel(null);
  };
  const startNote = () => {
    if (!sel) return;
    const sids = sel.sids;
    const before = hls;
    setHls(prev => {
      const n = { ...prev };
      sids.forEach(id => { if(!n[id]) n[id] = "hl-user"; });
      return n;
    });
    setHeat(prev => {
      const next = { ...prev };
      sids.forEach(id => {
        if (!before[id]) next[id] = Number(next[id] || 0) + 1;
      });
      return next;
    });
    if (window.liberApi) sids.forEach(id => {
      if (!before[id]) window.liberApi.reading.highlight(book.id, id, "hl-user").catch(() => {});
    });
    const sid = sel.sids[0];
    const r = { x: sel.x, y: sel.y + 26, sid };
    window.getSelection().removeAllRanges();
    setSel(null);
    setNotePop({ ...r, focus:true });
  };
  const askAI = () => {
    if (!sel) return;
    setAiCtx(sel.text);
    setAiOpen(true);
    if (layout === "archive") setRailTab("ai");
    window.getSelection().removeAllRanges();
    setSel(null);
  };
  const translateSelection = () => {
    if (!sel) return;
    const text = sel.text;
    setAiCtx(text);
    setAiMode("translate");
    setAiOpen(true);
    if (layout === "archive") setRailTab("ai");
    window.getSelection().removeAllRanges();
    setSel(null);
    sendAI("翻译成现代白话", { mode: "translate", context: text });
  };
  const openEcho = () => {
    if (!sel) return;
    setEcho({ sid: sel.sids[0], text: sel.text });
    window.getSelection().removeAllRanges();
    setSel(null);
  };

  /* clear sel popover on outside scroll/click */
  useE(() => {
    const clear = () => setSel(null);
    const el = scrollRef.current;
    el && el.addEventListener("scroll", clear, { passive:true });
    return () => el && el.removeEventListener("scroll", clear);
  }, []);

  /* ---- annotations helpers ---- */
  const annoFor = (sid) => {
    const base = (window.ANNOTATIONS[sid] || []);
    const mine = (notes[sid] || []);
    const seen = new Set([...base, ...mine].map(n => n.t));
    const others = (srvAnno[sid] || []).filter(n => !seen.has(n.t));
    return [...base, ...mine, ...others];
  };
  const openNotePop = (sid, e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setNotePop({ x: r.left + r.width/2, y: r.bottom + 8, sid });
    setSel(null);
    if (window.liberApi && srvAnno[sid] === undefined)
      window.liberApi.annotations(book.id, sid).then(res => { if (res && Array.isArray(res.annotations)) setSrvAnno(p => ({ ...p, [sid]: res.annotations })); }).catch(() => {});
  };
  const [noteDraft, setNoteDraft] = useS("");
  const addNote = (sid) => {
    if (!noteDraft.trim()) return;
    const text = noteDraft.trim();
    setNotes(prev => ({ ...prev, [sid]: [ ...(prev[sid]||[]), { u:"你", color:"#3a4fb0", t: text, up:0, replies:0, mine:true } ] }));
    if (window.liberApi) window.liberApi.reading.note(book.id, sid, text).catch(() => {});
    setNoteDraft("");
  };

  const heatCountFor = (sid) => Math.max(Number(heat[sid] || 0), hls[sid] ? 1 : 0);

  /* ---- AI send — live Workers AI, falling back to the canned brain ---- */
  const sendAI = (text, options = {}) => {
    const q = (text != null ? text : draft).trim();
    if (!q) return;
    const mode = options.mode || aiMode;
    const ctx = options.context ?? aiCtx;
    setFeed(f => [...f, { who:"user", t:q }]);
    setDraft("");
    setTyping(true);
    setAiOpen(true);
    const fallback = () => setFeed(f => [...f, { who:"bot", ...aiReply(mode, q, ctx) }]);
    const finish = () => { setTyping(false); setAiCtx(null); };
    if (typeof window !== "undefined" && window.liberApi) {
      window.liberApi.ai.chat({ bookId: book.id, lens: mode, question: q, context: ctx, chapter: `第 ${ch.n} 章 · ${ch.title}` })
        .then(res => { if (res && res.text && !res.error) setFeed(f => [...f, { who:"bot", t: res.text, ref: res.ref }]); else fallback(); })
        .catch(fallback)
        .finally(finish);
    } else {
      setTimeout(() => { fallback(); finish(); }, 950);
    }
  };

  /* nav */
  const go = (d) => {
    if (readMode === "epub" && epubControl.current) {
      setTurn(d > 0 ? "next" : "prev");
      if (turnTimer.current) window.clearTimeout(turnTimer.current);
      turnTimer.current = window.setTimeout(() => setTurn(null), 420);
      (d > 0 ? epubControl.current.next : epubControl.current.prev)();
      return;
    }
    setCIdx(i => {
    const next = Math.min(chapterCount - 1, Math.max(0, i + d));
    if (next === i) return i;
    setTurn(d > 0 ? "next" : "prev");
    if (turnTimer.current) window.clearTimeout(turnTimer.current);
    turnTimer.current = window.setTimeout(() => setTurn(null), 420);
    return next;
    });
  };
  const jumpTo = (n) => { const i = chapters.findIndex(c => c.n === n); if (i >= 0){ setReadMode("text"); setCIdx(i); setTocOpen(false); } };
  const jumpEpubTo = useCb((href) => {
    if (!href || !epubControl.current?.display) return;
    setReadMode("epub", { persist: false });
    epubControl.current.display(href);
    setTocOpen(false);
  }, [setReadMode]);

  /* ---- pagination: measure columns + page count when in a paged text mode ---- */
  React.useLayoutEffect(() => {
    if (!paged) return;
    const flow = flowRef.current, vp = vpRef.current;
    if (!flow || !vp) return;
    const GAP = pageMode === "book" ? 54 : 88;
    const measure = () => {
      const cs = getComputedStyle(flow);
      const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
      const contentW = Math.max(120, flow.clientWidth - padL - padR);
      const cw = pageMode === "book" ? (contentW - GAP) / 2 : contentW;
      flow.style.columnWidth = cw + "px";
      flow.style.columnGap = GAP + "px";
      const cols = Math.max(1, Math.round((flow.scrollWidth - padL - padR + GAP) / (cw + GAP)));
      const pages = pageMode === "book" ? Math.ceil(cols / 2) : cols;
      const pitch = pageMode === "book" ? (cw * 2 + GAP * 2) : (cw + GAP);
      setColw(cw); setGap(GAP); setStep(pitch);
      setPageCount(Math.max(1, pages));
      if (pendingLast.current){ pendingLast.current = false; setPage(Math.max(0, pages - 1)); }
      else setPage(p => Math.min(p, Math.max(0, pages - 1)));
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(vp);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [paged, pageMode, size, lead, meas, font, cIdx, ch]);

  /* reset to first page when chapter changes (unless we asked for the last page) */
  useE(() => { if (!pendingLast.current) setPage(0); }, [cIdx]);

  const turnPage = (dir) => {
    const apply = () => {
      if (dir > 0){
        if (page < pageCount - 1) setPage(page + 1);
        else if (cIdx < chapters.length - 1){ setPage(0); setCIdx(cIdx + 1); }
      } else {
        if (page > 0) setPage(page - 1);
        else if (cIdx > 0){ pendingLast.current = true; setCIdx(cIdx - 1); }
      }
    };
    if (pageMode === "fade"){ setFading(true); setTimeout(() => { apply(); setFading(false); }, 200); }
    else apply();
  };

  /* ---- realistic paper page-curl (单页掀页) ---- */
  const flipPage = (dir) => {
    if (animatingRef.current) return;
    /* chapter boundaries: hop without the curl animation */
    if (dir > 0 && page >= pageCount - 1){ if (cIdx < chapters.length - 1){ setPage(0); setCIdx(cIdx + 1); } return; }
    if (dir < 0 && page <= 0){ if (cIdx > 0){ pendingLast.current = true; setCIdx(cIdx - 1); } return; }
    const from = page, to = page + dir;
    const readerEl = document.querySelector(".reader");
    const bg = readerEl ? getComputedStyle(readerEl).backgroundColor : "#f5efe2";
    animatingRef.current = true;
    if (dir > 0){
      setPage(to);                                 // next page sits underneath
      setFlip({ show: from, dir, bg });            // leaving page flips away (CSS curlFwd)
    } else {
      setFlip({ show: to, dir, bg });              // incoming page flips in (CSS curlBwd)
    }
    setTimeout(() => { if (dir < 0) setPage(to); setFlip(null); animatingRef.current = false; }, 740);
  };

  /* unified page advance: curl uses the flip engine, others slide/fade */
  const advance = (dir) => { if (isCurl) flipPage(dir); else turnPage(dir); };

  useE(() => {
    const onKey = (e) => {
      if (e.key === "Escape"){ if (aiOpen) setAiOpen(false); else if (tocOpen) setTocOpen(false); else if (setOpen) setSetOpen(false); else if (notePop) setNotePop(null); else onClose(); }
      if (e.key === "ArrowRight" && !aiOpen){ paged ? advance(1) : go(1); }
      if (e.key === "ArrowLeft" && !aiOpen){ paged ? advance(-1) : go(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aiOpen, tocOpen, setOpen, notePop, readMode, paged, pageMode, page, pageCount, cIdx]);

  /* ---- render one sentence ---- */
  const renderSentence = (s) => {
    const cnt = annoFor(s.id).length;
    const hasAnno = cnt > 0;
    const lineHeat = heatCountFor(s.id);
    const cls = ["rd-sentence"];
    if (hls[s.id]) cls.push(hls[s.id]);
    if (hasAnno) cls.push("has-anno");
    if (lineHeat > 0) cls.push("has-heat");
    return (
      <span key={s.id} className={cls.join(" ")} data-sid={s.id}
        onClick={hasAnno ? (e) => openNotePop(s.id, e) : undefined}>
        {tx(s.t)}
        {lineHeat > 0 && (
          <span className="hl-heat" title={`${lineHeat} 人划线`}>
            {I.hl}<span>{lineHeat}</span>
          </span>
        )}
        {hasAnno && cnt > 0 && (
          <span className="anno-marker" onClick={(e) => { e.stopPropagation(); openNotePop(s.id, e); }}>{cnt}</span>
        )}
      </span>
    );
  };
  const needsSentenceGap = (left, right) =>
    /[A-Za-z0-9"”’')\]]$/.test(left?.t || "") && /^[A-Za-z0-9"“‘'(\[]/.test(right?.t || "");
  const renderParagraph = (p, i) => (
    <p key={i}>
      {p.map((s, j) => (
        <React.Fragment key={s.id}>
          {j > 0 && needsSentenceGap(p[j - 1], s) ? " " : null}
          {renderSentence(s)}
        </React.Fragment>
      ))}
    </p>
  );

  /* per-chapter reading-time estimate (~380 字/分钟) */
  const chapChars = ch.paras.flat().reduce((s, seg) => s + (seg.t ? seg.t.length : 0), 0);
  const chapMins = Math.max(1, Math.round(chapChars / 380));
  const barProg = paged ? (pageCount > 1 ? page / (pageCount - 1) : 1) : prog;
  const pct = Math.round(((cIdx + barProg) / chapterCount) * 100);

  /* chapter body — shared by scroll + paged layouts */
  const chapterBody = (
    <>
      <div className="rd-chap-no">第 {String(ch.n).padStart(2,"0")} 章{ch.paras.length ? ` · 约 ${chapMins} 分钟` : ""}</div>
      <h1 className="rd-chap-title">{tx(ch.title)}</h1>
      <div className="rd-chap-rule"/>
      {ch.truncated && (
        <div className="rd-chap-partial" role="status" style={{ margin: "0 0 14px", padding: "10px 14px", borderRadius: 8, background: "rgba(176,90,32,0.10)", border: "1px solid rgba(176,90,32,0.30)", color: "#8a4a1f", fontSize: 13, lineHeight: 1.6 }}>
          本章完整正文暂时无法读取，当前仅显示节选预览。完整内容正在恢复，请稍后重试。
        </div>
      )}
      <div className="rd-text">
        {ch.paras.map(renderParagraph)}
      </div>
      {(() => {
        const echoSid = ch.paras.flat().find(s => window.ECHOES[s.id]);
        const echo = echoSid ? window.ECHOES[echoSid.id] : null;
        const crossRec = echo ? echo.items.find(it => it.inLib) : null;
        const nextChap = chapters[cIdx+1];
        if (!crossRec && !nextChap) return null;
        return (
          <div className="rd-chapter-end">
            <div className="rce-rule"/>
            <div className="rce-h">读完这一章 · 顺着线索读下去</div>
            <div className="rce-cards">
              {nextChap && (
                <div className="rce-card" onClick={() => go(1)}>
                  <span className="rce-seal" style={{ background:"#211b15", color:"#ece2cf" }}>{book.seal}</span>
                  <div className="rce-mid"><div className="rce-lab">本书 · 接着读</div><div className="rce-t">第 {nextChap.n} 章 · {tx(nextChap.title)}</div></div>
                  <span className="rce-go">{I.right}</span>
                </div>
              )}
              {crossRec && (
                <div className="rce-card" onClick={() => onOpenBook && onOpenBook(crossRec.bookId)}>
                  <span className="rce-seal" style={{ background: crossRec.color }}>{crossRec.seal}</span>
                  <div className="rce-mid"><div className="rce-lab">跨书 · {tx(echo.theme)}</div><div className="rce-t">{tx(crossRec.bookT)} · {tx(crossRec.chap)}</div><div className="rce-why">{tx(crossRec.why)}</div></div>
                  <span className="rce-go">{I.right}</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
  const activeEpubHref = epubLocation?.start?.href || "";
  const activeEpubItem = readMode === "epub" && activeEpubHref
    ? epubToc.find((item) => sameEpubHref(item.href, activeEpubHref))
    : null;
  const tocRows = readMode === "epub" && epubToc.length
    ? epubToc
    : (toc.length ? toc : chapters.map(c => ({ n: c.n, title: c.title, has: true })));
  const waitingForEpubToc = readMode === "epub" && hasEpub && !epubToc.length;
  const seekTextProgress = useCb((e) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (paged) {
      setPage(Math.max(0, Math.min(pageCount - 1, Math.round(f * (pageCount - 1)))));
      return;
    }
    if (layout === "vertical") {
      const max = el.scrollWidth - el.clientWidth;
      const target = max * f;
      el.scrollLeft = el.scrollLeft < 0 ? -target : target;
      if (f > 0 && Math.abs(el.scrollLeft) < 1) el.scrollLeft = -target;
      return;
    }
    el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
  }, [layout, paged, pageCount]);

  return (
    <div className="reader" data-layout={layout} data-mode={readMode} data-rtheme={rtheme} data-turn={turn || undefined}
      style={{ "--read-size": size+"px", "--read-leading": lead, "--read-measure": meas+"rem", "--read-font": fontFam }}>

      {/* top bar */}
      <div className="rd-bar">
        <button className="icon-btn" onClick={onClose} title="返回 (Esc)">{I.left}</button>
        <div className="rd-title">
          <span className="bk">{tx(book.t)}</span>
          <span className="ch">{readMode === "epub" ? `EPUB${activeEpubItem?.title ? ` · ${tx(activeEpubItem.title)}` : ""}` : `第 ${ch.n} 章 · ${tx(ch.title)}`}</span>
        </div>
        <div className="spacer"/>
        <button className={`rd-tool ${tocOpen?"on":""}`} onClick={() => { setTocOpen(v=>!v); setSetOpen(false); }}>{I.list} 目录</button>
        <div className="rd-mode-toggle" role="group" aria-label="阅读模式">
          <button className={`rd-tool ${readMode==="text"?"on":""}`} title="互动阅读版" onClick={() => setReadMode("text")}>{I.note} 互动</button>
          <button className={`rd-tool ${readMode==="epub"?"on":""}`} disabled={!hasEpub} title={hasEpub ? "EPUB 阅读版" : "暂无 EPUB 阅读版"} onClick={() => setReadMode("epub", { persist: false })}>{I.book} EPUB</button>
        </div>
        <button className={`rd-tool ${setOpen?"on":""}`} id="rd-set-btn" onClick={() => { setSetOpen(v=>!v); setTocOpen(false); }}>{I.type} 显示</button>
        <button className={`rd-tool ${aiOpen?"on":""}`} onClick={() => { setAiOpen(v=>!v); if(layout==="archive") setRailTab("ai"); }}>{I.spark} AI 书友</button>
      </div>

      {/* reading region */}
      <div className="rd-body">
        {readMode === "epub" ? (
          <EpubReader
            bookId={book.id}
            controlRef={epubControl}
            font={font}
            size={size}
            lead={lead}
            rtheme={rtheme}
            scriptMode={scriptMode}
            layout={layout}
            onNavigation={setEpubToc}
            onRelocated={setEpubLocation}
            onUnavailable={onEpubUnavailable}
          />
        ) : noText ? (
          <div className="rd-scroll" ref={scrollRef}>
            <div className="rd-empty">
              <div className="rd-empty-seal" style={{ background: book.cls ? undefined : "var(--accent)" }}>{book.seal || "书"}</div>
              <h1 className="rd-empty-h">《{tx(book.t)}》的正文还在入库中</h1>
              {hasEpub ? (
                <>
                  <p className="rd-empty-p">这本书有原版 EPUB，可以直接打开阅读。</p>
                  <div className="rd-empty-actions">
                    <button className="btn btn-primary" onClick={() => setReadMode("epub")}>{I.book} 打开 EPUB 阅读版</button>
                    <button className="btn btn-ghost" onClick={onClose}>返回书库</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="rd-empty-p">Liber 只收录 CC0 / 公共领域文本，这本书的逐句精读版正在录入。</p>
                  <p className="rd-empty-p rd-empty-sub">可以先读《道德经》《论语》《孙子兵法》——它们已经有逐句正文，支持划线、批注和问 AI。</p>
                  <div className="rd-empty-actions">
                    <button className="btn btn-primary" onClick={onClose}>返回书库</button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : paged ? (
          <div className="rd-scroll rd-scroll-paged" data-style={pageMode}>
            <div className="rd-paged-vp" ref={vpRef}>
              <div className={"rd-col rd-paged-flow"+(fading?" fading":"")} ref={flowRef} onMouseUp={onMouseUp}
                style={{ transform:`translateX(${-page*step}px)`, opacity: fading ? 0 : 1 }}>
                {chapterBody}
              </div>
              {isCurl && flip && (
                <div className={"rd-curl "+(flip.dir>0?"fwd":"bwd")} aria-hidden="true">
                  <div className="rd-curl-face" style={{ background: flip.bg }}>
                    <div className="rd-col rd-paged-flow" style={{ columnWidth: colw+"px", columnGap: gap+"px", transform:`translateX(${-flip.show*step}px)` }}>
                      {chapterBody}
                    </div>
                    <div className="rd-curl-sheen"/>
                  </div>
                  <div className="rd-curl-back" style={{ background: flip.bg }}/>
                </div>
              )}
            </div>
            <div className="rd-spine" aria-hidden="true"/>
            <button className="rd-pg-arrow left" onClick={() => advance(-1)} disabled={page===0 && cIdx===0} aria-label="上一页">{I.left}</button>
            <button className="rd-pg-arrow right" onClick={() => advance(1)} disabled={page>=pageCount-1 && cIdx===chapters.length-1} aria-label="下一页">{I.right}</button>
            <div className="rd-page-ind">{page+1} / {pageCount}</div>
          </div>
        ) : (
          <div className="rd-scroll" ref={scrollRef}>
            <div className="rd-col" key={`${book.id}-${ch.n}`} onMouseUp={onMouseUp}>
              {chapterBody}
            </div>
          </div>
        )}

        {/* archive persistent rail */}
        {layout === "archive" && readMode === "text" && (
          <div className="rd-rail">
            <div className="rail-tabs">
              <button className={railTab==="anno"?"on":""} onClick={() => setRailTab("anno")}>本章批注</button>
              <button className={railTab==="ai"?"on":""} onClick={() => setRailTab("ai")}>AI 书友</button>
            </div>
            <div className="rail-body">
              {railTab === "anno" ? (
                <RailAnnotations ch={ch} annoFor={annoFor} tx={tx} />
              ) : (
                <AIPanel inline {...{ aiMode, setAiMode, aiCtx, setAiCtx, feed, typing, draft, setDraft, sendAI, onShare:()=>setShareOpen(true), summoned, onSummon:()=>setLensPicker(true) }} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* bottom progress */}
      <div className="rd-foot">
        <div className="pg-nav">
          <button onClick={() => go(-1)} disabled={readMode === "text" && cIdx===0}>{I.left}</button>
          <button onClick={() => go(1)} disabled={readMode === "text" && cIdx===chapterCount-1}>{I.right}</button>
        </div>
        <div className="pg-track" onClick={seekTextProgress}>
          <div className="pg-fill" style={{ width: readMode === "epub" ? "0%" : (barProg*100)+"%" }}/>
          <div className="pg-dot" style={{ left: readMode === "epub" ? "0%" : (barProg*100)+"%" }}/>
        </div>
        <div className="pg-label">{readMode === "epub" ? "EPUB 阅读" : `第 ${ch.n} 章 · 全书 ${pct}%`}</div>
      </div>

      {/* selection popover */}
      {sel && (
        <div className="sel-pop" style={{ left: sel.x, top: sel.y }} onMouseDown={e=>e.preventDefault()}>
          <span className="swatch" style={{ background:"var(--accent)" }} title="朱砂" onClick={() => applyHl("hl-user")}/>
          <span className="swatch" style={{ background:"#e3b54a" }} title="赭黄" onClick={() => applyHl("hl-yellow")}/>
          <span className="swatch" style={{ background:"#5aa36e" }} title="松绿" onClick={() => applyHl("hl-green")}/>
          {sel.sids.some(id => hls[id]) && (
            <button className="clear-hl" title="取消划线" onClick={() => applyHl(null)}>{I.x} 取消</button>
          )}
          <span className="sep"/>
          <button onClick={startNote}>{I.note} 批注</button>
          <button onClick={translateSelection}>{I.spark} 今译</button>
          <button onClick={askAI}>{I.spark} 问 AI</button>
          <button onClick={openEcho}>{I.echo} 回声</button>
          <button onClick={() => { navigator.clipboard && navigator.clipboard.writeText(sel.text); setSel(null); }}>{I.copy} 复制</button>
        </div>
      )}

      {/* annotation popover */}
      {notePop && (() => {
        const list = annoFor(notePop.sid);
        const sObj = ch.paras.flat().find(x => x.id === notePop.sid);
        const lineHeat = heatCountFor(notePop.sid);
        return (
          <>
            <div className="drawer-scrim" style={{ background:"transparent", zIndex:835 }} onClick={() => setNotePop(null)}/>
            <div className="note-pop" style={{ left: Math.min(Math.max(notePop.x,180), window.innerWidth-180), top: notePop.y, transform:"translateX(-50%)" }}>
              <div className="np-head">
                {list.length} 条批注
                {lineHeat > 0 && <span className="np-heat">{I.hl}{lineHeat} 人划线</span>}
                <span className="x" onClick={() => setNotePop(null)}>{I.x}</span>
              </div>
              {sObj && <div className="np-quote">「{tx(sObj.t)}」</div>}
              <div className="np-list">
                {list.map((n,i) => (
                  <div className="np-note" key={i}>
                    <div className={"ava"+(n.ai?" agent":"")+(!n.ai&&canProfile(n)?" ava-link":"")} style={{ background: n.color }} onClick={!n.ai&&canProfile(n)?()=>openProfile(n):undefined}>{n.ai ? "AI" : n.u[0]}</div>
                    <div>
                      <ProvBadge note={n} mine={n.mine}/>
                      <div className="tx">{n.t}</div>
                      <div className="mt"><span>{I.up} 赞同 {n.up||0}</span><span>回复 {n.replies||0}</span></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="np-add">
                <input autoFocus={notePop.focus} placeholder="写下你的批注，其他读者会看见…" value={noteDraft}
                  onChange={e=>setNoteDraft(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") addNote(notePop.sid); }}/>
                <span className="send" onClick={() => addNote(notePop.sid)}>{I.send}</span>
              </div>
            </div>
          </>
        );
      })()}

      {/* settings popover */}
      {setOpen && (
        <>
          <div className="drawer-scrim" style={{ background:"transparent" }} onClick={() => setSetOpen(false)}/>
          <div className="set-pop" style={{ right: 22, top: 64 }}>
            <div className="set-row">
              <div className="lab">阅读体验</div>
              <div className="seg reader-layout-seg">
                {READER_LAYOUT_OPTIONS.map(({ value, label }) => (
                  <button key={value} className={layout===value?"on":""} onClick={() => setReaderLayout(value)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <div className="lab">翻页方式 <span className="set-hint">{readMode==="epub"?"EPUB 自带翻页":pageMode==="scroll"?"上下卷动":"左右翻页"}</span></div>
              <div className="seg page-seg">
                {[["scroll","卷轴"],["slide","滑动"],["book","书页"],["curl","卷页"],["fade","淡出"]].map(([k,l]) => (
                  <button key={k} className={pageMode===k?"on":""} onClick={() => setPageMode(k)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <div className="lab">中文显示</div>
              <div className="seg">
                {[["original","原文"],["hans","简体"],["hant","繁体"]].map(([k,l]) => (
                  <button key={k} className={scriptMode===k?"on":""} onClick={() => setScriptMode(k)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <div className="lab">主题底色</div>
              <div className="seg theme-seg">
                {[["cream","米纸"],["paper","素白"],["sepia","羊皮"],["night","夜读"]].map(([k,l]) => (
                  <button key={k} className={rtheme===k?"on":""} onClick={() => setRtheme(k)}>
                    <span className={`sw ${k}`}/>{l}
                  </button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <div className="lab">字体</div>
              <div className="seg">
                {[["song","宋"],["kai","楷 / 衬线"],["hei","等宽"]].map(([k,l]) => (
                  <button key={k} className={font===k?"on":""} onClick={() => setFont(k)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <div className="lab">字号 <b>{size}px</b></div>
              <input className="range" type="range" min="16" max="28" step="1" value={size} onChange={e=>setSize(+e.target.value)}/>
            </div>
            <div className="set-row">
              <div className="lab">行距 <b>{lead.toFixed(2)}</b></div>
              <input className="range" type="range" min="1.5" max="2.4" step="0.05" value={lead} onChange={e=>setLead(+e.target.value)}/>
            </div>
            <div className="set-row">
              <div className="lab">栏宽 <b>{meas} rem</b></div>
              <input className="range" type="range" min="32" max="62" step="1" value={meas} onChange={e=>setMeas(+e.target.value)}/>
            </div>
          </div>
        </>
      )}

      {/* TOC drawer */}
      {tocOpen && (
        <>
          <div className="drawer-scrim" onClick={() => setTocOpen(false)}/>
          <div className="toc-drawer">
            <div className="dh"><span className="t">目录 · {tx(book.t)}</span><span className="x" onClick={() => setTocOpen(false)}>{I.x}</span></div>
            <div className="dbody">
              {waitingForEpubToc && (
                <div className="toc-empty">正在读取 EPUB 阅读版目录…</div>
              )}
              {!waitingForEpubToc && tocRows.map((t, idx) => {
                const active = readMode === "epub" && t.href ? sameEpubHref(t.href, activeEpubHref) : t.n === ch.n;
                return (
                  <div
                    key={t.key || t.href || t.n}
                    className={`toc-item ${active?"on":""} ${!t.has?"lock":""}`}
                    style={t.depth ? { paddingLeft: 24 + t.depth * 14 } : undefined}
                    onClick={() => t.href ? jumpEpubTo(t.href) : (t.has && jumpTo(t.n))}
                  >
                    <span className="num">{String(t.n || idx + 1).padStart(2,"0")}</span>
                    <span className="tt">{tx(t.title)}</span>
                    {!t.has && <span className="lk">{I.lock}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* AI drawer (classic / immersive) */}
      {aiOpen && layout !== "archive" && (
        <>
          <div className="drawer-scrim" onClick={() => setAiOpen(false)}/>
          <div className="ai-drawer">
            <div className="dh">
              <span className="orb"/>
              <div><div className="nm">{(window.AGENTS[(window.LENSES.find(l=>l.id===aiMode)||{}).agent]||{}).name||"书友"}</div><div className="role">{(window.LENSES.find(l=>l.id===aiMode)||{}).name} 视角</div></div>
              <span className="x" onClick={() => setAiOpen(false)}>{I.x}</span>
            </div>
            <AIPanel {...{ aiMode, setAiMode, aiCtx, setAiCtx, feed, typing, draft, setDraft, sendAI, onShare:()=>setShareOpen(true), summoned, onSummon:()=>setLensPicker(true) }} />
          </div>
        </>
      )}

      {/* lens picker — summon a reading perspective */}
      {lensPicker && (
        <LensPicker active={aiMode} summoned={summoned}
          onClose={() => setLensPicker(false)}
          onSummon={(id) => { setSummoned(s => s.includes(id) ? s : [...s, id]); setAiMode(id); setLensPicker(false); setAiOpen(true); }} />
      )}

      {/* share composer */}
      {shareOpen && (
        <ShareComposer book={book} ch={ch} aiCtx={aiCtx} feed={feed} continueConvo={continueConvo}
          onClose={() => setShareOpen(false)}
          onPublish={(label) => { setShareOpen(false); setToast(label); setTimeout(()=>setToast(null), 3200); }} />
      )}

      {/* toast */}
      {toast && (
        <div className="rd-toast">
          <span className="t-ok">✓</span>
          <div><div className="t-t">{toast}</div><div className="t-s">已发布到共读页 · 别人可以接着这段继续问</div></div>
        </div>
      )}

      {/* cross-book echoes */}
      {echo && (
        <EchoOverlay sid={echo.sid} sentence={echo.text} book={book}
          onClose={() => setEcho(null)}
          onOpenBook={(bid) => { setEcho(null); onClose(); onOpenBook && onOpenBook(bid); }} />
      )}
    </div>
  );
}

/* ---- Share composer: pick form (对话卡 / 金句卡), turns, title, publish ---- */
function ShareComposer({ book, ch, aiCtx, feed, continueConvo, onClose, onPublish }){
  /* if this session continues an existing convo, publishing forks it (grows its tree) */
  const parentId = continueConvo?.branchOf || continueConvo?.id || null;
  /* derive turns from the live AI feed (skip the opening system bot line) */
  const allTurns = feed
    .map((m, idx) => ({ idx, r: m.who === "user" ? "q" : "a", t: m.t }))
    .filter((m, i) => !(i === 0 && m.r === "a"));   // drop greeting
  const firstQ = allTurns.findIndex(t => t.r === "q");
  const seed = allTurns.slice(firstQ < 0 ? 0 : firstQ);

  const [form, setForm] = useS("card");          // card | insight
  const [picked, setPicked] = useS(() => seed.map(t => t.idx));
  const [insight, setInsight] = useS(() => {
    const lastA = [...seed].reverse().find(t => t.r === "a");
    return lastA ? lastA.t.replace(/^[^，。]*[，。]/, "").slice(0, 26).replace(/[，。]$/, "") || lastA.t.slice(0,24) : "";
  });
  const [vis, setVis] = useS("public");

  const msgs = seed.filter(t => picked.includes(t.idx)).map(t => ({ r: t.r, t: t.t }));
  const quote = aiCtx || (ch.paras.flat()[0] && ch.paras.flat()[0].t) || book.t;
  const draftConvo = {
    id: "draft", form, bookT: book.t, seal: book.seal, chap: `第 ${ch.n} 章 · ${ch.title}`,
    quote, title: msgs.find(m=>m.r==="q")?.t, insight,
    author: { name: "你", ava: "读", color: "#3a4fb0" },
    forks: 0, agree: 0, comments: 0, saves: 0, when: "刚刚", msgs,
  };

  const publish = () => {
    const rec = { ...draftConvo, id: "u" + Date.now(), mine: true };
    let arr = []; try { arr = JSON.parse(localStorage.getItem("liber.shared")) || []; } catch {}
    arr.unshift(rec);
    localStorage.setItem("liber.shared", JSON.stringify(arr));
    if (window.liberApi)
      window.liberApi.shares.publish({ bookId: book.id, form, title: draftConvo.title, insight, quote, visibility: vis, chap: draftConvo.chap, seal: book.seal, msgs, parentId }).catch(() => {});
    onPublish(form === "insight" ? "金句卡已分享" : "对话卡已分享");
  };

  const toggle = (idx) => setPicked(p => p.includes(idx) ? p.filter(x=>x!==idx) : [...p, idx].sort((a,b)=>a-b));

  return (
    <>
      <div className="drawer-scrim" style={{ zIndex: 860 }} onClick={onClose}/>
      <div className="share-modal">
        <div className="sh-head">
          <div><div className="sh-kick">{I.spark} 分享这段对话</div><div className="sh-sub">弱化是谁问的，让问题和过程本身被看见</div></div>
          <span className="x" onClick={onClose}>{I.x}</span>
        </div>

        <div className="sh-body">
          {/* left: controls */}
          <div className="sh-controls">
            <div className="sh-row">
              <div className="sh-lab">形态</div>
              <div className="seg">
                <button className={form==="card"?"on":""} onClick={()=>setForm("card")}>对话卡</button>
                <button className={form==="insight"?"on":""} onClick={()=>setForm("insight")}>金句卡</button>
              </div>
            </div>
            {form==="insight" && (
              <div className="sh-row">
                <div className="sh-lab">提炼的金句 <span className="hint">AI 已草拟，可改</span></div>
                <textarea className="sh-insight" value={insight} onChange={e=>setInsight(e.target.value)} rows={2}/>
              </div>
            )}
            <div className="sh-row">
              <div className="sh-lab">纳入哪几轮 <span className="hint">{picked.length} / {seed.length} 条</span></div>
              <div className="sh-turns">
                {seed.map(t => (
                  <label className={`sh-turn ${picked.includes(t.idx)?"on":""} ${t.r}`} key={t.idx}>
                    <input type="checkbox" checked={picked.includes(t.idx)} onChange={()=>toggle(t.idx)}/>
                    <span className="rr">{t.r==="q"?"读者":"AI"}</span>
                    <span className="tt">{t.t.length>34?t.t.slice(0,34)+"…":t.t}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="sh-row">
              <div className="sh-lab">谁能看到</div>
              <div className="seg">
                <button className={vis==="public"?"on":""} onClick={()=>setVis("public")}>公开</button>
                <button className={vis==="group"?"on":""} onClick={()=>setVis("group")}>仅共读小组</button>
                <button className={vis==="private"?"on":""} onClick={()=>setVis("private")}>仅自己</button>
              </div>
            </div>
            <button className="btn btn-primary sh-publish" disabled={!msgs.length} onClick={publish}>
              发布到共读页 <span className="arr">→</span>
            </button>
          </div>

          {/* right: live preview */}
          <div className="sh-preview">
            <div className="shp-lab">预览</div>
            <div className="shp-stage">
              <ConvoArtifact convo={draftConvo} expanded={true} onToggleExpand={()=>{}} onFork={()=>{}} onSave={()=>{}} saved={false}/>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---- lens picker: summon a community reading perspective ---- */
function LensPicker({ active, summoned, onClose, onSummon }){
  const lenses = window.LENSES || [];
  const community = lenses.filter(l => l.tag === "community");
  const official = lenses.filter(l => l.tag === "official");
  return (
    <>
      <div className="drawer-scrim" style={{ zIndex: 858 }} onClick={onClose}/>
      <div className="lens-modal">
        <div className="lens-head">
          <div><div className="lens-kick">{I.spark} 召唤一个读书视角</div><div className="lens-sub">同一本书，换一种眼光读。每个视角都是一个署名的 Agent。</div></div>
          <span className="x" onClick={onClose}>{I.x}</span>
        </div>
        <div className="lens-body">
          <div className="lens-grp">官方 · 内置</div>
          {official.map(l => (
            <div className={`lens-row ${active===l.id?"on":""}`} key={l.id} onClick={() => onSummon(l.id)}>
              <span className="lens-av" style={{ background:l.color }}>{l.seal}</span>
              <div className="lens-mid"><div className="lens-nm">{l.name}</div><div className="lens-pitch">{l.pitch}</div></div>
              <span className="lens-pick">{active===l.id?"使用中":"切换"}</span>
            </div>
          ))}
          <div className="lens-grp">社区 · 可发布 <span className="lens-grp-x">任何人都能训练并发布一个视角</span></div>
          {community.map(l => {
            const ag = (window.AGENTS||{})[l.agent] || {};
            const on = summoned.includes(l.id);
            return (
              <div className={`lens-row ${active===l.id?"on":""}`} key={l.id} onClick={() => onSummon(l.id)}>
                <span className="lens-av" style={{ background:l.color }}>{l.seal}</span>
                <div className="lens-mid">
                  <div className="lens-nm">{l.name} <span className="lens-prov">✓ 已签名 · 被引用 {ag.cited?.toLocaleString?.()||ag.cited}</span></div>
                  <div className="lens-pitch">{l.pitch}</div>
                  <div className="lens-by">{ag.model} · {ag.by}</div>
                </div>
                <span className="lens-pick">{active===l.id?"使用中":on?"再次使用":"召唤"}</span>
              </div>
            );
          })}
        </div>
        <div className="lens-foot">视角是开放生态的一部分 · 由社区训练、署名发布、可被任何 Agent 调用</div>
      </div>
    </>
  );
}

/* ---- shared AI panel (drawer + archive rail) ---- */
function AIPanel({ aiMode, setAiMode, aiCtx, setAiCtx, feed, typing, draft, setDraft, sendAI, onShare, summoned, onSummon, inline }){
  const feedRef = useR(null);
  useE(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [feed, typing]);
  const suggests = aiMode === "translate"
    ? ["翻译成现代白话", "逐字解释关键词", "这句话有哪些常见误读？"]
    : ["这一句到底在说什么？", "和后文有什么关系？", "帮我总结这一章"];
  const hasExchange = feed.some(m => m.who === "user");
  const active = (window.LENSES||[]).filter(l => l.tag === "official" || (summoned||[]).includes(l.id));
  return (
    <>
      <div className="ai-modes">
        {active.map(l => (
          <span key={l.id} className={`ai-mode ${aiMode===l.id?"on":""} ${l.tag==="community"?"comm":""}`} onClick={() => setAiMode(l.id)}>{l.tag==="community"&&<i className="lens-seal" style={{background:l.color}}>{l.seal}</i>}{l.name}</span>
        ))}
        <span className="ai-mode summon" onClick={onSummon}>＋ 召唤视角</span>
      </div>
      {aiCtx && (
        <div className="ai-ctx">
          <div>
            <div className="lab">就这一句提问</div>
            <div className="q">「{aiCtx.length>30?aiCtx.slice(0,30)+"…":aiCtx}」</div>
          </div>
          <span className="x" onClick={() => setAiCtx(null)}>{I.x}</span>
        </div>
      )}
      <div className="ai-feed" ref={feedRef}>
        {feed.map((m,i) => m.who === "user"
          ? <div className="ai-bub user" key={i}>{m.t}</div>
          : <div className="ai-bub bot" key={i}><div className="who">书友 · AI</div>{m.t.split("\n").map((l,j)=><div key={j}>{l}</div>)}{m.ref && <div className="ref">{m.ref}</div>}</div>
        )}
        {typing && <div className="ai-typing"><i/><i/><i/></div>}
      </div>
      {hasExchange && onShare && (
        <div className="ai-share-bar" onClick={onShare}>
          <span className="asb-l">{I.spark} 这段聊得不错？<b>分享出去</b>，让别人接着问</span>
          <span className="asb-arr">{I.right}</span>
        </div>
      )}
      <div className="ai-suggest">
        {suggests.map((s,i) => <span key={i} className="ai-chip" onClick={() => sendAI(s)}>{s}</span>)}
      </div>
      <div className="ai-compose">
        <input placeholder="问问书友这一句…" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") sendAI(); }}/>
        <span className="send" onClick={() => sendAI()}>{I.send}</span>
      </div>
    </>
  );
}

/* ---- archive rail annotations ---- */
function RailAnnotations({ ch, annoFor, tx = (value) => value }){
  const sentences = ch.paras.flat().filter(s => annoFor(s.id).length);
  if (!sentences.length) return <div className="rail-section"><div className="rs-h">本章批注</div><div style={{ color:"var(--ink-3)", fontSize:14, fontStyle:"italic" }}>这一章还没有批注。选中一句，留下第一条。</div></div>;
  return (
    <div className="rail-section">
      <div className="rs-h">本章批注 · {sentences.length} 句被标注</div>
      {sentences.map(s => annoFor(s.id).map((n,i) => (
        <div className="rail-note" key={s.id+i}>
          {i===0 && <div className="rn-q">「{tx(s.t).length>22?tx(s.t).slice(0,22)+"…":tx(s.t)}」</div>}
          <div className="rn-row">
            <div className={"ava"+(n.ai?" agent":"")} style={{ background:n.color }}>{n.ai?"AI":n.u[0]}</div>
            <div>
              <ProvBadge note={n}/>
              <div className="rn-tx">{n.t}</div>
            </div>
          </div>
        </div>
      )))}
    </div>
  );
}

export { Reader };
