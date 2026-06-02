import React from "react";
import { I } from "./product-shared.jsx";
import { findCatalogBook, getCatalogBooks } from "../lib/catalog.js";

/* product-charts.jsx — open rankings: today / 7-day / 30-day,
   by reads / highlights / conversations. Full screen + compact library band. */
const { useState: useCh, useEffect: useEffC } = React;
import { useQuery } from "@tanstack/react-query";

const CH_WINDOWS = [["today","今日"],["week","近 7 天"],["month","近 30 天"]];
const CH_METRICS = [["reads","在读"],["lines","划线"],["convos","对话"],["echoes","呼应"],["surge","飙升"]];

function Delta({ d }){
  if (d === 0) return <span className="ch-delta flat">—</span>;
  return <span className={"ch-delta "+(d>0?"up":"down")}>{d>0?"▲":"▼"}{Math.abs(d)}</span>;
}
function Surge({ p }){
  return <span className={"ch-surge "+(p>=0?"up":"down")}>{p>=0?"▲":"▼"} {Math.abs(p)}%</span>;
}

function rankBy(list, metric){
  return [...list].sort((a,b) => b[metric] - a[metric]);
}

/* full charts screen */
function Charts({ onOpenBook, onBack, onAgentCharts }){
  const [obj, setObj] = useCh("book");   // book | sent
  const [win, setWin] = useCh("today");
  const [metric, setMetric] = useCh("reads");
  const byId = (id) => findCatalogBook(id);
  /* live rankings from the backend (seed baseline + event aggregation), seed fallback */
  const liveQ = useQuery({ queryKey: ["charts", win], queryFn: () => window.liberApi.charts(win), enabled: !!window.liberApi });
  const live = liveQ.data && Array.isArray(liveQ.data.rows) ? liveQ.data : null;
  const useLive = live && live.window === win;
  const seedChartsAllowed = !getCatalogBooks().some((b) => b.dynamic);
  const surgeMap = (useLive ? live.surge : (window.SURGE || {})[win]) || {};
  const data = ((useLive ? live.rows : seedChartsAllowed ? (window.CHARTS || {})[win] : []) || []).map(r => ({ ...r, surge: surgeMap[r.id] ?? 0, echoes: r.echoes ?? 0 }));
  const ranked = rankBy(data, metric);
  const readTop3 = rankBy(data, "reads").slice(0,3).map(r=>r.id);
  const max = Math.max(...ranked.map(r => r[metric]), 1);
  const metricLabel = CH_METRICS.find(m=>m[0]===metric)[1];
  const hot = (useLive && live.hotToday) || (seedChartsAllowed ? (window.CHARTS||{}).hotToday : null);
  const sentences = [...((useLive && live.sentences) || (seedChartsAllowed ? window.HOT_SENTENCES : []) || [])].sort((a,b)=>b.liners-a.liners);

  return (
    <div className="app-screen">
      <div className="charts">
        <div className="charts-wrap">
          <div className="crumb" style={{ paddingTop:24 }}>
            <a onClick={onBack}>书库</a> <span>/</span> <span style={{ color:"var(--ink)" }}>榜单</span>
          </div>
          <div className="ch-head">
            <div>
              <div className="kicker">读者在读什么</div>
              <h1 className="ch-title">榜单</h1>
              <p className="ch-sub">实时汇总自链上的公开阅读信号——谁在读、划了哪句、聊了多少。<b>这份榜单本身就是开放数据，任何 Agent 都能读取。</b></p>
              <button className="ch-agentbtn" onClick={() => onAgentCharts({ win, metric, obj })}>{I.agent} 在 Agent 视角中查看这份榜单</button>
            </div>
            {hot && (
              <div className="ch-hot">
                <div className="ch-hot-lab">今日热句</div>
                <div className="ch-hot-q">「{hot.q}」</div>
                <div className="ch-hot-m">{hot.book} · {hot.chap} · {hot.n}</div>
              </div>
            )}
          </div>

          {/* object toggle: 书 / 句 */}
          <div className="ch-obj">
            <button className={obj==="book"?"on":""} onClick={()=>setObj("book")}>书榜</button>
            <button className={obj==="sent"?"on":""} onClick={()=>setObj("sent")}>热句榜</button>
          </div>

          {obj === "book" ? (
            <>
              <div className="ch-controls">
                <div className="ch-wins">
                  {CH_WINDOWS.map(([k,l]) => <button key={k} className={win===k?"on":""} onClick={()=>setWin(k)}>{l}</button>)}
                </div>
                <div className="ch-metrics">
                  排序：
                  {CH_METRICS.map(([k,l]) => <span key={k} className={"ch-mt "+(metric===k?"on":"")} onClick={()=>setMetric(k)}>{l}榜</span>)}
                </div>
              </div>

              <div className="ch-list">
                <div className="ch-row ch-head-row">
                  <span className="ch-rk">#</span><span className="ch-bk">书</span>
                  <span className="ch-bar-col">{metric==="surge"?"增速":metricLabel}</span>
                  <span className="ch-cols">在读 / 划线 / 对话</span>
                  <span className="ch-dl">较上期</span>
                </div>
                {ranked.map((r,i) => {
                  const b = byId(r.id); if (!b) return null;
                  const darkhorse = metric==="surge" && r.surge>0 && !readTop3.includes(r.id) && i<3;
                  return (
                    <div className="ch-row" key={r.id} onClick={()=>onOpenBook(r.id)}>
                      <span className={"ch-rk"+(i<3?" top":"")}>{i+1}</span>
                      <div className="ch-bk">
                        <span className={"ch-cv "+b.cls}>{b.seal}</span>
                        <div><div className="ch-t">{b.t} {darkhorse && <span className="ch-horse">黑马</span>}</div><div className="ch-a">{b.a}</div></div>
                      </div>
                      {metric==="surge" ? (
                        <div className="ch-bar-col"><div className="ch-bar"><div className="ch-fill" style={{ width:Math.min(100,r.surge<0?4:r.surge/2)+"%", background:r.surge>=0?"#2e9e6b":"var(--accent)" }}/></div><div className="ch-val"><Surge p={r.surge}/></div></div>
                      ) : (
                        <div className="ch-bar-col"><div className="ch-bar"><div className="ch-fill" style={{ width:(r[metric]/max*100)+"%" }}/></div><div className="ch-val">{r[metric].toLocaleString()}</div></div>
                      )}
                      <span className="ch-cols">{r.reads.toLocaleString()} · {r.lines.toLocaleString()} · {r.convos}</span>
                      <span className="ch-dl"><Delta d={r.delta}/></span>
                    </div>
                  );
                })}
              </div>
              <div className="ch-foot">{metric==="surge"?"飙升榜按环比增速排序——黑马是绝对量还不高、但涨得最快的书。":"榜单每 10 分钟从链上重算。"} 经 <code>liber.get_charts(window, metric)</code> 对 Agent 开放 · 无人工干预</div>
            </>
          ) : (
            <>
              <div className="ch-controls"><div className="ch-wins"><button className="on">今日 · 热句榜</button></div><div className="ch-metrics">按划线人数排序</div></div>
              <div className="ch-sent-list">
                {sentences.map((s,i) => (
                  <div className="ch-sent" key={s.sid} onClick={()=>onOpenBook(s.bookId)}>
                    <span className={"ch-rk"+(i<3?" top":"")}>{i+1}</span>
                    <div className="ch-sent-body">
                      <div className="ch-sent-q">「{s.q}」</div>
                      <div className="ch-sent-m"><span>{s.book} · {s.chap}</span><span>{s.liners.toLocaleString()} 人划线</span><span>{s.convos} 段对话</span><Surge p={s.surge}/></div>
                    </div>
                    <span className="ch-dl"><Delta d={s.delta}/></span>
                  </div>
                ))}
              </div>
              <div className="ch-foot">单句维度的榜单——划线与对话把整本书里最被记住的句子顶了上来。经 <code>liber.get_charts("today","sentences")</code> 开放。</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* compact band for the library */
function ChartsBand({ onOpenBook, onOpenCharts }){
  const [win, setWin] = useCh("today");
  const rowsQ = useQuery({ queryKey: ["charts", win], queryFn: () => window.liberApi.charts(win), enabled: !!window.liberApi });
  const rows = rowsQ.data && Array.isArray(rowsQ.data.rows) ? rowsQ.data.rows : null;
  const seedChartsAllowed = !getCatalogBooks().some((b) => b.dynamic);
  const data = rows || (seedChartsAllowed ? (window.CHARTS || {})[win] : []) || [];
  const ranked = rankBy(data, "reads").slice(0,5);
  const byId = (id) => findCatalogBook(id);
  return (
    <div className="charts-band">
      <div className="cb-head">
        <span className="cb-title">热读榜</span>
        <div className="cb-wins">
          {CH_WINDOWS.map(([k,l]) => <button key={k} className={win===k?"on":""} onClick={()=>setWin(k)}>{l}</button>)}
        </div>
        <span className="cb-more" onClick={onOpenCharts}>完整榜单 →</span>
      </div>
      <div className="cb-list">
        {ranked.map((r,i) => {
          const b = byId(r.id); if(!b) return null;
          return (
            <div className="cb-row" key={r.id} onClick={()=>onOpenBook(r.id)}>
              <span className={"cb-rk"+(i<3?" top":"")}>{i+1}</span>
              <span className={"cb-cv "+b.cls}>{b.seal}</span>
              <div className="cb-mid"><div className="cb-t">{b.t}</div><div className="cb-m">{r.reads.toLocaleString()} 在读</div></div>
              <Delta d={r.delta}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { Charts, ChartsBand };
