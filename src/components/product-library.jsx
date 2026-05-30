import React from "react";
import { Cover } from "./product-shared.jsx";
import { ChartsBand } from "./product-charts.jsx";

/* product-library.jsx — Library browse screen. */
const { useState: useStateLib } = React;

function Library({ onOpenBook, onOpenCharts }){
  const cats = ["全部 · 经典", "哲学 · 思想", "经济 · 政治", "科学 · 博物", "文学 · 诗"];
  const [cat, setCat] = useStateLib(cats[0]);
  const [sort, setSort] = useStateLib("最多人读");
  const feature = window.BOOKS.find(b => b.featured) || window.BOOKS[0];

  let list = window.BOOKS.filter(b => cat === cats[0] || b.cat === cat);
  if (sort === "最多人读") list = [...list].sort((a,b) => b.readsN - a.readsN);
  else if (sort === "划线最多") list = [...list].sort((a,b) => b.liners - a.liners);
  else if (sort === "最近上链") list = [...list];

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
                  <div><div className="n">{feature.annos.toLocaleString()}</div><div className="l">批注</div></div>
                  <div><div className="n">CC0</div><div className="l">公共版权</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Toolbar + grid */}
        <div className="lib-wrap">
          <ChartsBand onOpenBook={onOpenBook} onOpenCharts={onOpenCharts} />
          <div className="lib-bar">
            <span className="title">书库</span>
            <span className="count">1,284 卷已上链 · 显示 {list.length}</span>
            <div className="spacer"/>
            <div className="chips">
              {cats.map(c => (
                <button key={c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>
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
