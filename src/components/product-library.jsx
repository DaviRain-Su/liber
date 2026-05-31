import React from "react";
import { Cover } from "./product-shared.jsx";
import { ChartsBand } from "./product-charts.jsx";
import { getCatalogBooks, getCatalogTotal, licenseLabel, loadCatalogBooks, subscribeCatalog } from "../lib/catalog.js";

/* product-library.jsx — Library browse screen. */
const { useState: useStateLib, useEffect: useEffLib } = React;

const LANG_ORDER = ["zh", "en", "ja", "ko", "pt", "fr", "de", "es", "it", "eo", "ca", "ro", "tl", "he", "da", "no", "sv", "fi", "nl", "pl", "cs", "ru", "hu", "el", "la"];
const LANG_LABELS = {
  zh: { name: "中文", sub: "Chinese" },
  en: { name: "English", sub: "英文" },
  ja: { name: "日本語", sub: "日文" },
  ko: { name: "한국어", sub: "韩文" },
  pt: { name: "Português", sub: "葡萄牙语" },
  fr: { name: "Français", sub: "法语" },
  de: { name: "Deutsch", sub: "德语" },
  es: { name: "Español", sub: "西班牙语" },
  it: { name: "Italiano", sub: "意大利语" },
  eo: { name: "Esperanto", sub: "世界语" },
  ca: { name: "Català", sub: "加泰罗尼亚语" },
  ro: { name: "Română", sub: "罗马尼亚语" },
  tl: { name: "Tagalog", sub: "他加禄语" },
  he: { name: "עברית", sub: "希伯来语" },
  da: { name: "Dansk", sub: "丹麦语" },
  no: { name: "Norsk", sub: "挪威语" },
  sv: { name: "Svenska", sub: "瑞典语" },
  fi: { name: "Suomi", sub: "芬兰语" },
  nl: { name: "Nederlands", sub: "荷兰语" },
  pl: { name: "Polski", sub: "波兰语" },
  cs: { name: "Čeština", sub: "捷克语" },
  ru: { name: "Русский", sub: "俄语" },
  hu: { name: "Magyar", sub: "匈牙利语" },
  el: { name: "Ελληνικά", sub: "希腊语" },
  la: { name: "Latina", sub: "拉丁语" },
};
const LANG_ALIASES = {
  中文: "zh",
  Chinese: "zh",
  英文: "en",
  English: "en",
  日文: "ja",
  Japanese: "ja",
};
const SUBJECTS = [
  {
    id: "thought",
    name: "哲学思想",
    sub: "Philosophy & thought",
    match: /哲学|思想|道家|儒家|法家|佛|佛典|宗教|神学|道藏|伦理|修辞|oratory|philos|filos|filozof|ethic|relig|theolog|mystic|mistica|mística|confessiones|tao|dao|buddh|esperanto.*gramatiko/,
  },
  {
    id: "politics",
    name: "经济政治",
    sub: "Politics & society",
    match: /经济|政治|政论|兵法|策略|法律|国家|社会|权利|女权|传记|回忆|历史|演说|econom|politic|state|government|rights|social|memoir|biograf|biography|history|historia|istor|kasaysayan|talambuhay|eml[eé]kirat|memorii|m[eé]moires|correspondence|levelek/,
  },
  {
    id: "science",
    name: "科学博物",
    sub: "Science & knowledge",
    match: /科学|博物|自然|数学|百科|天文|物理|地理|旅行|游记|笔记|文论|家训|语言|语法|字典|读本|science|natural|mathemat|astronom|physics|zoolog|botan|geograph|travel|voyage|journey|adventure|avontuur|aventure|resa|matkakertomus|encyclop|grammar|dictionary|reader|lingvo|učebnice|čítanka|nauka|folkl[oó]r|folklore|volkskunde/,
  },
  {
    id: "literature",
    name: "文学诗",
    sub: "Fiction & poetry",
    match: /./,
  },
];

function langLabel(code) {
  return LANG_LABELS[code] || { name: code || "未知语言", sub: code || "unknown" };
}

function langCodeFor(book) {
  const raw = String(book?.lang || "").trim();
  return LANG_ALIASES[raw] || raw || "unknown";
}

function directionFor(book) {
  const cat = String(book?.cat || book?.category || "").trim();
  if (!cat) return "未分类";
  const parts = cat.split("·").map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(" · ") : parts[0];
}

function foldText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function subjectFor(book) {
  const haystack = foldText([
    book?.cat,
    book?.category,
    book?.sub,
    book?.t,
    book?.title,
  ].filter(Boolean).join(" "));
  return SUBJECTS.find((subject) => subject.match.test(haystack))?.id || "literature";
}

function subjectMeta(id) {
  return SUBJECTS.find((subject) => subject.id === id) || SUBJECTS[SUBJECTS.length - 1];
}

function languageGroups(books) {
  const map = new Map();
  for (const book of books) {
    const code = langCodeFor(book);
    const row = map.get(code) || { code, count: 0, subjects: new Map() };
    row.count += 1;
    const subject = subjectFor(book);
    row.subjects.set(subject, (row.subjects.get(subject) || 0) + 1);
    map.set(code, row);
  }
  return [...map.values()].sort((a, b) => {
    const ai = LANG_ORDER.indexOf(a.code);
    const bi = LANG_ORDER.indexOf(b.code);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return b.count - a.count || a.code.localeCompare(b.code);
  });
}

function directionOptions(books) {
  const map = new Map();
  for (const book of books) {
    const dir = directionFor(book);
    map.set(dir, (map.get(dir) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function subjectOptions(books) {
  const map = new Map();
  for (const book of books) {
    const subject = subjectFor(book);
    map.set(subject, (map.get(subject) || 0) + 1);
  }
  return SUBJECTS
    .map((subject) => ({ ...subject, count: map.get(subject.id) || 0 }))
    .filter((subject) => subject.count > 0);
}

function sortBooks(books, sort) {
  if (sort === "最多人读") return [...books].sort((a,b) => (b.readsN || 0) - (a.readsN || 0));
  if (sort === "划线最多") return [...books].sort((a,b) => (b.liners || 0) - (a.liners || 0));
  return [...books];
}

function booksForSubject(books, subject) {
  return books.filter((book) => subjectFor(book) === subject);
}

function Library({ onOpenBook, onOpenCharts }){
  const [lang, setLang] = useStateLib("all");
  const [subject, setSubject] = useStateLib("all");
  const [direction, setDirection] = useStateLib("all");
  const [sort, setSort] = useStateLib("最多人读");
  const [books, setBooks] = useStateLib(() => getCatalogBooks());
  const [total, setTotal] = useStateLib(() => getCatalogTotal());
  useEffLib(() => {
    const off = subscribeCatalog((next) => { setBooks(next); setTotal(getCatalogTotal()); });
    loadCatalogBooks().then((next) => { setBooks(next); setTotal(getCatalogTotal()); }).catch(() => {});
    return off;
  }, []);
  const feature = books.find(b => b.featured) || books[0];
  const featureLicense = licenseLabel(feature?.license).replace("Public Domain", "PD").replace("CC0-1.0", "CC0");
  const langs = languageGroups(books);
  const allDirections = directionOptions(books);
  const currentLang = lang === "all" ? null : langs.find((row) => row.code === lang);
  const scopedBooks = lang === "all" ? books : books.filter((b) => langCodeFor(b) === lang);
  const subjectScopedBooks = subject === "all" ? scopedBooks : scopedBooks.filter((b) => subjectFor(b) === subject);
  const subjects = subjectOptions(scopedBooks);
  const directions = directionOptions(subjectScopedBooks);
  const subjectKey = subjects.map((row) => row.id).join("|");
  const directionKey = directions.map((row) => row.name).join("|");
  useEffLib(() => {
    if (subject === "all") return;
    if (!subjects.some((row) => row.id === subject)) {
      setSubject("all");
      setDirection("all");
    }
  }, [subject, subjectKey]);
  useEffLib(() => {
    if (direction === "all") return;
    if (!directions.some((row) => row.name === direction)) setDirection("all");
  }, [direction, directionKey]);

  const list = sortBooks(subjectScopedBooks.filter(b => direction === "all" || directionFor(b) === direction), sort);
  const languageSections = langs.map((row) => {
    const sectionBooks = books.filter((book) => langCodeFor(book) === row.code);
    const sorted = sortBooks(sectionBooks, sort);
    const subjectRows = SUBJECTS
      .map((meta) => ({
        ...meta,
        count: row.subjects.get(meta.id) || 0,
        books: sortBooks(sectionBooks.filter((book) => subjectFor(book) === meta.id), sort).slice(0, 4),
      }))
      .filter((item) => item.count > 0);
    return { ...row, meta: langLabel(row.code), books: sorted.slice(0, 5), subjectRows };
  });
  const selectedLangLabel = currentLang ? langLabel(currentLang.code) : { name: "全部语言", sub: "All languages" };
  const selectedSubjectLabel = subject === "all" ? null : subjectMeta(subject);
  const selectedSummary = currentLang
    ? `${selectedLangLabel.name} · ${currentLang.count} 卷 · ${subjects.length} 个主题子类`
    : `${langs.length} 种语言 · ${books.length.toLocaleString("zh-CN")} 卷`;
  const displayCount = currentLang
    ? `当前显示 ${list.length}`
    : `按语言和主题子类分区展示`;
  const selectedPath = [
    "全部语言",
    currentLang ? selectedLangLabel.name : null,
    selectedSubjectLabel ? selectedSubjectLabel.name : null,
    direction !== "all" ? direction : null,
  ].filter(Boolean);

  if (!feature) {
    return (
      <div className="app-screen">
        <div className="lib">
          <div className="lib-wrap" style={{ paddingTop:80 }}>
            <div className="kicker">书库</div>
            <h1 className="display-m" style={{ margin:"14px 0" }}>还没有真实图书入库。</h1>
            <p className="muted">通过 Liber CLI 发布一本 CC0 或 Public Domain EPUB 后，这里会自动显示真实目录。</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-screen">
      <div className="lib">
        {/* Feature strip */}
        <div className="lib-feature">
          <div className="lib-wrap">
            <div className="feature-grid">
              <Cover book={feature} className="feature-cover" onClick={() => onOpenBook(feature.id)} />
              <div className="feature-meta">
                <div className="kick">本周精选 · 已永久上链</div>
                <h1>{feature.t}</h1>
                <div className="auth">{feature.a} · {feature.sub}</div>
                <p className="blurb">{feature.blurb}</p>
                <div className="row">
                  <button className="btn btn-primary" onClick={() => onOpenBook(feature.id, true)}>开始阅读 <span className="arr">→</span></button>
                  <button className="btn btn-ghost" onClick={() => onOpenBook(feature.id)}>查看详情</button>
                </div>
                <div className="feature-stats">
                  <div><div className="n">{feature.reads}</div><div className="l">在读</div></div>
                  <div><div className="n">{feature.lines}</div><div className="l">划线</div></div>
                  <div><div className="n">{(feature.annos || 0).toLocaleString()}</div><div className="l">批注</div></div>
                  <div><div className="n">{featureLicense}</div><div className="l">版权</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Toolbar + grid */}
        <div className="lib-wrap">
          <ChartsBand onOpenBook={onOpenBook} onOpenCharts={onOpenCharts} />
          <div className="lib-taxonomy">
            <div className="tax-head">
              <div>
                <span className="eyebrow">书库分类</span>
                <h2>{currentLang ? selectedLangLabel.name : "语言索引"}</h2>
              </div>
              <span className="tax-count">{selectedSummary}</span>
            </div>
            <div className="tax-path" aria-label="当前分类路径">
              {selectedPath.map((item, index) => (
                <React.Fragment key={`${item}-${index}`}>
                  {index > 0 && <span className="tax-sep">/</span>}
                  <button
                    className={`tax-crumb ${index === selectedPath.length - 1 ? "on" : ""}`}
                    onClick={() => {
                      if (index === 0) { setLang("all"); setSubject("all"); setDirection("all"); }
                      if (index === 1 && currentLang) { setSubject("all"); setDirection("all"); }
                      if (index === 2 && selectedSubjectLabel) setDirection("all");
                    }}
                  >
                    {item}
                  </button>
                </React.Fragment>
              ))}
            </div>
            <div className="tax-metrics">
              <div><b>{langs.length}</b><span>语言</span></div>
              <div><b>{SUBJECTS.length}</b><span>主题子类</span></div>
              <div><b>{allDirections.length}</b><span>细分类</span></div>
              <div><b>{books.length.toLocaleString("zh-CN")}</b><span>馆藏</span></div>
            </div>
            <div className="lang-grid">
              <button className={`lang-filter ${lang === "all" ? "on" : ""}`} onClick={() => { setLang("all"); setSubject("all"); setDirection("all"); }}>
                <span className="lf-main">全部语言</span>
                <span className="lf-sub">{langs.length} 种语言</span>
                <span className="lf-count">{books.length}</span>
              </button>
              {langs.map((row) => {
                const meta = langLabel(row.code);
                const preview = SUBJECTS
                  .map((item) => ({ name: item.name, count: row.subjects.get(item.id) || 0 }))
                  .filter((item) => item.count > 0)
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 3)
                  .map((item) => item.name)
                  .join(" / ");
                return (
                  <button key={row.code} className={`lang-filter ${lang === row.code ? "on" : ""}`} onClick={() => { setLang(row.code); setSubject("all"); setDirection("all"); }}>
                    <span className="lf-main">{meta.name}</span>
                    <span className="lf-sub">{meta.sub}</span>
                    <span className="lf-count">{row.count}</span>
                    <span className="lf-dirs">{preview}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lib-bar">
            <span className="title">{currentLang ? `${selectedLangLabel.name} 书库` : "全部书库"}</span>
            <span className="count">{total.toLocaleString("zh-CN")} 卷已入库 · {displayCount}</span>
            <div className="spacer"/>
            <div className="sort-sel">
              排序
              <select value={sort} onChange={e => setSort(e.target.value)}>
                <option>最多人读</option>
                <option>划线最多</option>
                <option>最近上链</option>
              </select>
            </div>
          </div>

          {!currentLang && (
            <div className="language-sections">
              {languageSections.map((section) => (
                <section className="language-section" key={section.code}>
                  <div className="language-section-head">
                    <div>
                      <div className="language-section-kicker">{section.meta.sub}</div>
                      <h3>{section.meta.name}</h3>
                    </div>
                    <button className="text-link" onClick={() => { setLang(section.code); setSubject("all"); setDirection("all"); }}>
                      查看全部 {section.count} 卷
                    </button>
                  </div>
                  <div className="subject-strip">
                    {section.subjectRows.map((row) => (
                      <button key={row.id} className="subject-mini" onClick={() => { setLang(section.code); setSubject(row.id); setDirection("all"); }}>
                        <span>{row.name}</span>
                        <b>{row.count}</b>
                      </button>
                    ))}
                  </div>
                  <div className="section-book-row">
                    {section.books.map((b) => (
                      <div className="bk-card compact" key={b.id} onClick={() => onOpenBook(b.id)}>
                        <Cover book={b} />
                        <div className="meta">
                          <div className="t">{b.t}</div>
                          <div className="a">{b.a}</div>
                          <div className="book-taxonomy"><span>{subjectMeta(subjectFor(b)).name}</span><span>{directionFor(b)}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {currentLang && (
            <>
              <div className="subject-panel">
                <div className="subject-panel-head">
                  <span>主题子类</span>
                  <b>{selectedLangLabel.name} · {subjects.length} 类</b>
                </div>
                <div className="subject-grid">
                  <button className={`subject-card ${subject === "all" ? "on" : ""}`} onClick={() => { setSubject("all"); setDirection("all"); }}>
                    <span className="sc-name">全部主题</span>
                    <span className="sc-count">{scopedBooks.length} 卷</span>
                    <span className="sc-sample">覆盖 {subjects.map((row) => row.name).join(" / ")}</span>
                  </button>
                  {subjects.map((row) => {
                    const samples = booksForSubject(scopedBooks, row.id).slice(0, 3).map((b) => b.t).join(" / ");
                    return (
                      <button key={row.id} className={`subject-card ${subject === row.id ? "on" : ""}`} onClick={() => { setSubject(row.id); setDirection("all"); }}>
                        <span className="sc-name">{row.name}</span>
                        <span className="sc-count">{row.count} 卷</span>
                        <span className="sc-sample">{samples}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="fine-panel">
                  <div className="fine-panel-head">
                    <span>细分类</span>
                    <b>{selectedSubjectLabel ? selectedSubjectLabel.name : "全部主题"}</b>
                  </div>
                  <div className="fine-strip">
                    <button className={`fine-chip ${direction === "all" ? "on" : ""}`} onClick={() => setDirection("all")}>
                      全部 <b>{subjectScopedBooks.length}</b>
                    </button>
                    {directions.map((row) => (
                      <button key={row.name} className={`fine-chip ${direction === row.name ? "on" : ""}`} onClick={() => setDirection(row.name)}>
                        {row.name} <b>{row.count}</b>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="lib-grid">
                {list.map(b => (
                  <div className="bk-card" key={b.id} onClick={() => onOpenBook(b.id)}>
                    <Cover book={b} />
                    <div className="meta">
                      <div className="t">{b.t}</div>
                      <div className="a">{b.a}</div>
                      <div className="book-taxonomy"><span>{langLabel(langCodeFor(b)).name}</span><span>{subjectMeta(subjectFor(b)).name}</span><span>{directionFor(b)}</span></div>
                      <div className="stat"><span><b>{b.reads}</b> 在读</span><span>{b.lines} 划线</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export { Library };
