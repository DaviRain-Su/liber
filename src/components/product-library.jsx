import React from "react";
import { Cover } from "./product-shared.jsx";
import { ChartsBand } from "./product-charts.jsx";
import { getCatalogBooks, getCatalogTotal, licenseLabel, loadCatalogBooks, subscribeCatalog } from "../lib/catalog.js";

/* product-library.jsx — Library browse screen. */
const { useState: useStateLib, useEffect: useEffLib } = React;

const LANG_ORDER = ["zh", "en", "ja", "ko", "pt", "fr", "de", "es", "it", "da", "no", "sv", "fi", "nl", "pl", "cs", "ru", "hu", "el", "la"];
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

function langLabel(code) {
  return LANG_LABELS[code] || { name: code || "未知语言", sub: code || "unknown" };
}

function directionFor(book) {
  const cat = String(book?.cat || book?.category || "").trim();
  if (!cat) return "未分类";
  const parts = cat.split("·").map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(" · ") : parts[0];
}

function languageGroups(books) {
  const map = new Map();
  for (const book of books) {
    const code = book.lang || "unknown";
    const row = map.get(code) || { code, count: 0, directions: new Map() };
    row.count += 1;
    const dir = directionFor(book);
    row.directions.set(dir, (row.directions.get(dir) || 0) + 1);
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

function Library({ onOpenBook, onOpenCharts }){
  const [lang, setLang] = useStateLib("all");
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
  const currentLang = lang === "all" ? null : langs.find((row) => row.code === lang);
  const scopedBooks = lang === "all" ? books : books.filter((b) => (b.lang || "unknown") === lang);
  const directions = directionOptions(scopedBooks);
  useEffLib(() => {
    if (direction === "all") return;
    if (!directions.some((row) => row.name === direction)) setDirection("all");
  }, [direction, directions.map((row) => row.name).join("|")]);

  let list = scopedBooks.filter(b => direction === "all" || directionFor(b) === direction);
  if (sort === "最多人读") list = [...list].sort((a,b) => (b.readsN || 0) - (a.readsN || 0));
  else if (sort === "划线最多") list = [...list].sort((a,b) => (b.liners || 0) - (a.liners || 0));
  else if (sort === "最近上链") list = [...list];
  const selectedLangLabel = currentLang ? langLabel(currentLang.code) : { name: "全部语言", sub: "All languages" };
  const selectedSummary = currentLang
    ? `${selectedLangLabel.name} · ${currentLang.count} 卷 · ${directions.length} 个方向`
    : `${langs.length} 种语言 · ${books.length.toLocaleString("zh-CN")} 卷`;

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
                <span className="eyebrow">按语言浏览</span>
                <h2>{selectedLangLabel.name}</h2>
              </div>
              <span className="tax-count">{selectedSummary}</span>
            </div>
            <div className="lang-grid">
              <button className={`lang-filter ${lang === "all" ? "on" : ""}`} onClick={() => { setLang("all"); setDirection("all"); }}>
                <span className="lf-main">全部语言</span>
                <span className="lf-sub">{langs.length} 种语言</span>
                <span className="lf-count">{books.length}</span>
              </button>
              {langs.map((row) => {
                const meta = langLabel(row.code);
                const preview = [...row.directions.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([name]) => name)
                  .join(" / ");
                return (
                  <button key={row.code} className={`lang-filter ${lang === row.code ? "on" : ""}`} onClick={() => { setLang(row.code); setDirection("all"); }}>
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
            <span className="count">{total.toLocaleString("zh-CN")} 卷已入库 · 当前显示 {list.length}</span>
            <div className="spacer"/>
            <div className="chips">
              <button className={`chip ${direction === "all" ? "on" : ""}`} onClick={() => setDirection("all")}>全部方向 · {scopedBooks.length}</button>
              {directions.map((row) => (
                <button key={row.name} className={`chip ${direction === row.name ? "on" : ""}`} onClick={() => setDirection(row.name)}>
                  {row.name} · {row.count}
                </button>
              ))}
            </div>
            <div className="sort-sel">
              排序
              <select value={sort} onChange={e => setSort(e.target.value)}>
                <option>最多人读</option>
                <option>划线最多</option>
                <option>最近上链</option>
              </select>
            </div>
          </div>

          <div className="lib-grid">
            {list.map(b => (
              <div className="bk-card" key={b.id} onClick={() => onOpenBook(b.id)}>
                <Cover book={b} />
                <div className="meta">
                  <div className="t">{b.t}</div>
                  <div className="a">{b.a}</div>
                  <div className="book-taxonomy"><span>{langLabel(b.lang).name}</span><span>{directionFor(b)}</span></div>
                  <div className="stat"><span><b>{b.reads}</b> 在读</span><span>{b.lines} 划线</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export { Library };
