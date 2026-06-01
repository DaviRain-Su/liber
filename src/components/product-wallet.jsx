/* product-wallet.jsx — the embedded multi-chain wallet, ported from the
   "Liber Profile Wallet" design (wallet-kit + wallet-screens + wallet-flows +
   WalletTabPane). Rendered as the 钱包 tab in the profile. Real Turnkey addresses
   (Sui/ETH/SOL/BTC) are wired into the identity strip + receive flow; balances /
   assets / activity are sample data until on-chain balance + history are fetched. */
import React from "react";
import { api } from "../lib/api.js";
import { createWalletPasskey, passkeySupported, passkeySignDigest } from "../lib/turnkey-passkey.js";
const { useState: useS, useEffect: useE, useRef: useR } = React;

/* ---------- icons ---------- */
const WI = {
  send:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 13 20 4l-6 16-2.5-6.5L4 13Z"/></svg>,
  recv:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 4v13M6 11l6 6 6-6M5 20h14"/></svg>,
  swap:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M7 4 4 7l3 3M4 7h12M17 20l3-3-3-3M20 17H8"/></svg>,
  sign:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 19c3-1 4-9 6-9s2 5 4 5 2-3 4-3M4 21h16"/></svg>,
  copy:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>,
  check: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4.5 4.5L19 7"/></svg>,
  x:     <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m6 6 12 12M18 6 6 18"/></svg>,
  left:  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 5-7 7 7 7"/></svg>,
  right: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 5 7 7-7 7"/></svg>,
  chev:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 6 6 6-6 6"/></svg>,
  up:    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m6 14 6-6 6 6"/></svg>,
  down:  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m6 10 6 6 6-6"/></svg>,
  shield:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>,
  finger:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 4a6 6 0 0 0-6 6v3M12 4a6 6 0 0 1 6 6v2a8 8 0 0 1-1 4M9 20a10 10 0 0 1-1-7 4 4 0 0 1 8 0v2M12 13v3M15 20a14 14 0 0 0 .8-4"/></svg>,
  dot:   <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>,
  ext:   <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 5h5v5M19 5l-8 8M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>,
  book:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h12"/></svg>,
};
const ACT_GLYPH = { send:WI.send, recv:WI.recv, swap:WI.swap, tip:WI.book, gas:WI.sign, storage:WI.shield, mint:WI.send, sign:WI.sign };
function WMark({ size = 26 }){
  return (<svg width={size} height={size} viewBox="0 0 30 30" fill="none" aria-hidden="true">
    <rect x="4" y="5" width="3.2" height="20" rx="1.6" fill="currentColor"/><rect x="10.4" y="5" width="3.2" height="20" rx="1.6" fill="currentColor"/>
    <rect x="16.8" y="5" width="3.2" height="20" rx="1.6" fill="currentColor"/><rect x="23.2" y="5" width="3.2" height="20" rx="1.6" fill="currentColor"/>
    <rect x="2" y="13.4" width="26" height="2.4" rx="1.2" fill="currentColor"/></svg>);
}
const fmtUSD = (n, dp=2) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits:dp, maximumFractionDigits:dp });
const signed = (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

/* ---------- sample data (balances/assets/activity until on-chain fetch) ---------- */
function spark(seed, n, drift){ const pts=[]; let v=50; for (let i=0;i<n;i++){ seed=(seed*9301+49297)%233280; const r=seed/233280; v+=(r-0.5)*14+drift; v=Math.max(8,Math.min(92,v)); pts.push(Math.round(v*10)/10);} return pts; }
const TOKENS = [
  { sym:"BTC", name:"Bitcoin", chain:"Bitcoin", cls:"btc", glyph:"₿", amt:"0.3184", value:21142.51, price:"66,400.20", chg:+2.31, spark:spark(13,40,.55) },
  { sym:"ETH", name:"Ethereum", chain:"Ethereum", cls:"eth", glyph:"Ξ", amt:"4.207", value:13884.10, price:"3,300.71", chg:-0.84, spark:spark(71,40,-.2) },
  { sym:"SOL", name:"Solana", chain:"Solana", cls:"sol", glyph:"◎", amt:"86.40", value:12702.24, price:"147.02", chg:+5.12, spark:spark(29,40,.7) },
  { sym:"SUI", name:"Sui", chain:"Sui", cls:"sui", glyph:"S", amt:"3,920.5", value:7488.16, price:"1.910", chg:+1.07, spark:spark(47,40,.3) },
  { sym:"USDC", name:"USD Coin", chain:"Ethereum", cls:"usdc", glyph:"$", amt:"5,280.00", value:5280.00, price:"1.000", chg:+0.01, stable:true, spark:spark(5,40,.02) },
  { sym:"WAL", name:"Walrus", chain:"Sui", cls:"wal", glyph:"❖", amt:"12,400", value:3844.00, price:"0.310", chg:+8.40, spark:spark(63,40,.9) },
];
const PORTFOLIO = { total: TOKENS.reduce((s,t)=>s+t.value,0), chg24h:+2.74, chgAbs:+1772.40, spark:spark(101,56,.5) };
const ALLOC = TOKENS.map(t=>({ sym:t.sym, cls:t.cls, value:t.value })).sort((a,b)=>b.value-a.value);
const CONTACTS = [
  { name:"译者 · 陈年", sub:"译《沉思录》", seal:"陈", cls:"cinnabar", chains:["ETH","SUI"], addr:"0x77cd…1a28" },
  { name:"作者 · 苏白", sub:"《回声集》", seal:"苏", cls:"indigo", chains:["SOL","ETH"], addr:"7xQr…8Wz" },
  { name:"共读组 · 玄之", sub:"道德经精读", seal:"玄", cls:"jade", chains:["SUI"], addr:"0x9a01…ee37" },
  { name:"自己 · 冷钱包", sub:"Ledger 硬件", seal:"冷", cls:"ink", chains:["BTC","ETH"], addr:"bc1qcold…22a9" },
];
const ACTIVITY = [
  { id:"tx01", kind:"tip", title:"打赏译者 · 陈年", sub:"《沉思录》全译", sym:"USDC", amt:"-25.00", chain:"Ethereum", when:"今天 · 14:22", hash:"0x9f3a…d21c", note:"感谢这版译文" },
  { id:"tx02", kind:"gas", title:"链上批注 · 道德经", sub:"第二章 · 1 条划线上链", sym:"SUI", amt:"-0.042", chain:"Sui", when:"今天 · 11:08", hash:"sui:8c…a1f4" },
  { id:"tx03", kind:"recv", title:"收款 · 苏白", sub:"《回声集》稿费分成", sym:"SOL", amt:"+4.50", chain:"Solana", when:"昨天 · 20:41", hash:"5KpA…q9Lm" },
  { id:"tx04", kind:"storage", title:"永久存储 · Walrus", sub:"上传 12 MB 手稿副本", sym:"WAL", amt:"-180", chain:"Sui", when:"昨天 · 09:15", hash:"walrus://0x21be…9f04" },
  { id:"tx05", kind:"swap", title:"兑换 · ETH → USDC", sub:"0.5 ETH 换 1,649 USDC", sym:"USDC", amt:"+1,649.00", chain:"Ethereum", when:"3 天前", hash:"0x4c7a…f9b3" },
  { id:"tx07", kind:"send", title:"转账 · 自己 · 冷钱包", sub:"归集 BTC 到硬件钱包", sym:"BTC", amt:"-0.05", chain:"Bitcoin", when:"上周", hash:"bc1q…22a9" },
];
const USES = [
  { k:"tip", title:"打赏作者 / 译者", desc:"为你读到的好译文、好书评，直接打一笔。", cta:"去打赏", sym:"USDC" },
  { k:"gas", title:"为划线 · 批注付 gas", desc:"把你的划线与批注永久写上链，按条计费。", cta:"管理上链", sym:"SUI" },
  { k:"storage", title:"永久存储费用", desc:"用 WAL 为手稿与副本支付 Walrus / Arweave 存储。", cta:"充值存储", sym:"WAL" },
  { k:"mint", title:"限量藏书证书", desc:"铸造或收藏限量版藏书证书（NFT），永久归你。", cta:"浏览证书", sym:"SUI" },
];
const SIGN_REQUESTS = {
  message: { kind:"message", origin:"liber.xyz", title:"登录 Liber", purpose:"用你的钱包签名登录，确认你是这枚地址的主人。不会发起任何转账。", chain:"Sui",
    message:"liber.xyz 想要验证你的身份\n\nNonce: 7Hq2-9fLm-2025\n时间: 2026-06-01 14:30 UTC\n\n签名即代表同意《使用条款》。" },
  approve: { kind:"approve", origin:"liber.xyz · 永久存储", title:"授权 Walrus 扣费", purpose:"授权 Liber 存储合约在你上传手稿时，自动从余额扣除 WAL 作为存储费。", chain:"Sui",
    rows:[["合约","sui::walrus::StoragePool"],["授权额度","至多 500 WAL"],["每次扣费","按存储字节计算"],["可随时撤销","是"]] },
};
const TIPS_WALL = [
  { name:"玄之", seal:"玄", color:"#2e7d57", amt:"+50.0", sym:"SUI", msg:"精读组受益良多，谢谢", when:"昨天 · 21:08", hash:"sui:8c…a1f4" },
  { name:"苏白", seal:"苏", color:"#c0432b", amt:"+0.2", sym:"SOL", msg:"", when:"3 天前", hash:"5KpA…q9Lm" },
  { name:"陈年", seal:"陈", color:"#9a5b2e", amt:"+100.00", sym:"USDC", msg:"敬这份坚持十年的译事", when:"上周", hash:"0x77cd…1a28" },
];
const priceNum = (t) => Number(String(t.price).replace(/,/g,"")) || 0;
const balNum = (t) => Number(String(t.amt).replace(/,/g,"")) || 0;

/* ---------- primitives ---------- */
function TokenSeal({ token, size = 44 }){
  const s = typeof token === "string" ? (TOKENS.find(t => t.sym === token) || { cls:"slate", glyph:"◦" }) : token;
  return <div className={`tok-seal ${s.cls}`} style={{ width:size, height:size, fontSize:size*0.46 }}><span>{s.glyph}</span></div>;
}
function Sparkline({ data, w=120, h=36, up=true, area=false, strokeW=1.6 }){
  const min=Math.min(...data), max=Math.max(...data), span=(max-min)||1, stepX=w/(data.length-1);
  const pts=data.map((v,i)=>[i*stepX, h-((v-min)/span)*(h-4)-2]);
  const d=pts.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" ");
  const col=up?"var(--pos)":"var(--neg)", id="sg"+Math.abs((data[0]*1000|0))+data.length;
  return (<svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
    {area && (<><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity="0.22"/><stop offset="1" stopColor={col} stopOpacity="0"/></linearGradient></defs>
      <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${id})`} stroke="none"/></>)}
    <path d={d} fill="none" stroke={col} strokeWidth={strokeW} strokeLinejoin="round" strokeLinecap="round"/></svg>);
}
function AllocRing({ alloc, size=168, thick=22 }){
  const total=alloc.reduce((s,a)=>s+a.value,0), r=(size-thick)/2, c=2*Math.PI*r, cx=size/2; let off=0;
  return (<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="alloc-ring">
    <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--hair)" strokeWidth={thick}/>
    {alloc.map((a)=>{ const len=(a.value/total)*c; const el=(<circle key={a.sym} cx={cx} cy={cx} r={r} fill="none" stroke={`var(--tk-${a.cls})`} strokeWidth={thick} strokeDasharray={`${len} ${c-len}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cx})`} strokeLinecap="butt"/>); off+=len; return el; })}</svg>);
}
function QR({ seed="liber", size=176 }){
  const n=25, cells=useR(null);
  if (!cells.current){ let s=0; for (let i=0;i<seed.length;i++) s=(s*31+seed.charCodeAt(i))%233280; const grid=[]; for (let y=0;y<n;y++){ const row=[]; for (let x=0;x<n;x++){ s=(s*9301+49297)%233280; row.push(s/233280>0.5);} grid.push(row);} cells.current=grid; }
  const px=size/n;
  const isFinder=(x,y)=>{ const f=(ox,oy)=>x>=ox&&x<ox+7&&y>=oy&&y<oy+7; return f(0,0)||f(n-7,0)||f(0,n-7); };
  const inCore=(x,y)=>{ const f=(ox,oy)=>x>=ox+2&&x<ox+5&&y>=oy+2&&y<oy+5; return f(0,0)||f(n-7,0)||f(0,n-7); };
  const rects=[]; for (let y=0;y<n;y++) for (let x=0;x<n;x++){ if (x>=10&&x<15&&y>=10&&y<15) continue; if (isFinder(x,y)){ if (inCore(x,y)) rects.push([x,y]); continue; } if (cells.current[y][x]) rects.push([x,y]); }
  const frame=(ox,oy)=>(<rect key={ox+"-"+oy} x={ox*px} y={oy*px} width={7*px} height={7*px} rx={px} fill="none" stroke="currentColor" strokeWidth={px}/>);
  return (<div className="qr" style={{ width:size, height:size }}><svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
    {rects.map(([x,y],i)=><rect key={i} x={x*px+px*0.08} y={y*px+px*0.08} width={px*0.84} height={px*0.84} rx={px*0.18} fill="currentColor"/>)}{frame(0,0)}{frame(n-7,0)}{frame(0,n-7)}</svg>
    <div className="qr-mark"><WMark size={size*0.16}/></div></div>);
}
function PasskeyGate({ label="用通行密钥确认", sub="Face ID / 指纹 · 无需助记词", onDone, onCancel }){
  const [phase,setPhase]=useS("idle"); const timer=useR(null);
  const start=()=>{ if (phase!=="idle") return; setPhase("scanning"); timer.current=setTimeout(()=>{ setPhase("done"); setTimeout(()=>onDone&&onDone(),620); },1250); };
  useE(()=>()=>clearTimeout(timer.current),[]);
  return (<div className="pk"><button className={"pk-orb "+phase} onClick={start} aria-label={label}><span className="pk-ring"/><span className="pk-ico">{phase==="done"?WI.check:WI.finger}</span></button>
    <div className="pk-label">{phase==="done"?"已签名":phase==="scanning"?"正在验证…":label}</div><div className="pk-sub">{sub}</div>
    {onCancel&&phase==="idle"&&<button className="pk-cancel" onClick={onCancel}>取消</button>}</div>);
}
// Real passkey gate: tapping the orb runs onSign (Face ID → Turnkey → broadcast).
// Parent unmounts this on success; on failure it shows the error and allows retry.
function RealSignGate({ label="用通行密钥确认", sub, onSign, onCancel }){
  const [phase,setPhase]=useS("idle"); const [err,setErr]=useS("");
  const go=async()=>{ if (phase==="working") return; setPhase("working"); setErr("");
    try { await onSign(); } catch(e){ setErr((e&&e.message)||"签名或广播失败"); setPhase("error"); } };
  return (<div className="pk"><button className={"pk-orb "+(phase==="working"?"scanning":"")} onClick={go} aria-label={label}><span className="pk-ring"/><span className="pk-ico">{WI.finger}</span></button>
    <div className="pk-label">{phase==="working"?"请在设备上确认…":phase==="error"?"轻点重试":label}</div>
    <div className="pk-sub" style={phase==="error"?{ color:"var(--neg)" }:null}>{phase==="error"?err:sub}</div>
    {onCancel&&phase!=="working"&&<button className="pk-cancel" onClick={onCancel}>取消</button>}</div>);
}

/* ---------- flows (sheets) ---------- */
function Sheet({ title, step, onBack, onClose, wide, children }){
  return (<div className="sheet-scrim" onMouseDown={(e)=>{ if (e.target===e.currentTarget) onClose(); }}>
    <div className={"sheet"+(wide?" wide":"")} onMouseDown={(e)=>e.stopPropagation()}>
      <div className="sheet-h">{onBack&&<span className="back" onClick={onBack}>{WI.left}</span>}<span className="ttl">{title}</span>{step&&<span className="step">{step}</span>}<span className="x" onClick={onClose}>{WI.x}</span></div>
      <div className="sheet-body">{children}</div></div></div>);
}
function TokenPick({ tokens, value, onChange }){
  return (<div className="tok-pick">{tokens.map(t=>(<div key={t.sym} className={"tok-pill"+(value&&value.sym===t.sym?" on":"")} onClick={()=>onChange(t)}><TokenSeal token={t} size={30}/><div><div className="tp-nm">{t.sym}</div><div className="tp-bal tnum">{t.amt}</div></div></div>))}</div>);
}
function RecipientPick({ token, value, onChange }){
  const [custom,setCustom]=useS("");
  const filtered=CONTACTS.filter(c=>!token||c.chains.includes(token.sym)||c.chains.includes(token.chain));
  return (<div><div className="fld"><div className="fld-l">粘贴地址或 .liber 名称</div>
    <input className="inp" placeholder="0x… / bc1… / name.liber" value={custom} onChange={(e)=>{ setCustom(e.target.value); onChange(e.target.value?{ name:"自定义地址", addr:e.target.value, cls:"slate", seal:"#" }:null); }}/></div>
    <div className="recip-divider">通讯录</div>
    {(filtered.length?filtered:CONTACTS).map(c=>(<div key={c.name} className={"recip"+(value&&value.name===c.name?" on":"")} onClick={()=>{ setCustom(""); onChange(c); }}><span className={"av "+c.cls}>{c.seal}</span><div className="rb"><div className="nm">{c.name}</div><div className="ad">{c.addr} · {c.chains.join(" / ")}</div></div><div className="rb r-sub"><div className="sub">{c.sub}</div></div></div>))}</div>);
}
function AmountEntry({ token, amount, onChange }){
  const max=balNum(token), fiat=(Number(amount)||0)*priceNum(token);
  return (<div><div className="amt-big"><input className="ai-in tnum" inputMode="decimal" placeholder="0" value={amount} onChange={(e)=>onChange(e.target.value.replace(/[^0-9.]/g,""))} autoFocus/><div className="ai-sym">{token.sym} · 余额 {token.amt}</div><div className="ai-fiat tnum">≈ {fmtUSD(fiat)}</div></div>
    <div className="quick-amt">{[0.25,0.5,1].map(f=>(<button key={f} onClick={()=>onChange(String(+(max*f).toPrecision(6)))}>{f===1?"全部":`${f*100}%`}</button>))}</div></div>);
}
function ReviewRows({ token, recipient, amount }){
  const fiat=(Number(amount)||0)*priceNum(token);
  return (<div className="rev"><div className="rev-hero"><TokenSeal token={token} size={46}/><div><div className="rh-amt tnum">{amount||0} {token.sym}</div><div className="rh-sub tnum">≈ {fmtUSD(fiat)}</div></div></div>
    <div className="rr"><span className="k">收款人</span><span className="v">{recipient?recipient.name:"—"}</span></div>
    <div className="rr"><span className="k">地址</span><span className="v">{recipient?recipient.addr:"—"}</span></div>
    <div className="rr"><span className="k">网络</span><span className="v">{token.chain}</span></div>
    <div className="rr"><span className="k">矿工费</span><span className="v tnum">≈ $0.21</span></div>
    <div className="rr total"><span className="k">合计</span><span className="v tnum">{amount||0} {token.sym}</span></div></div>);
}
function SendFlow({ tokens, presetToken, onClose }){
  const [token,setToken]=useS(presetToken||tokens[0]);
  const [recipient,setRecipient]=useS(null);
  const [amount,setAmount]=useS("");
  const [phase,setPhase]=useS("asset");
  const [result,setResult]=useS(null); // real broadcast result { digest, explorer, network, status }
  const hash=useR("0x"+Math.random().toString(16).slice(2,6)+"…"+Math.random().toString(16).slice(2,6));
  // All four chains are wired for real, non-custodial passkey signing.
  const order=["asset","recipient","amount","review","pk","done"], idx=order.indexOf(phase);
  const titles={ asset:"选择资产", recipient:"收款人", amount:"输入金额", review:"确认", pk:"签名", done:"完成" };
  const next=()=>setPhase(order[idx+1]); const back=idx>0&&phase!=="done"?()=>setPhase(order[idx-1]):null;
  // Build → passkey-sign (in browser, straight to Turnkey) → broadcast (server).
  const signAndSend=async()=>{
    const sign=(prep)=>passkeySignDigest({ organizationId:prep.organizationId, signWith:prep.signWith, digestHex:prep.digestHex, hashFunction:prep.hashFunction });
    const fail=(r,m)=>{ if (!r||!r.ok) throw new Error((r&&(r.message||r.error))||m); return r; };
    let out;
    if (token.chain === "Sui") {
      const prep=fail(await api.auth.suiPrepare({ to:recipient.addr, amount:Number(amount) }), "构建交易失败");
      out=await api.auth.suiBroadcast({ txBytesB64:prep.txBytesB64, activityId:(await sign(prep)).activityId });
    } else if (token.chain === "Ethereum") {
      const prep=fail(await api.auth.evmPrepare({ to:recipient.addr, amount:Number(amount), token:token.sym }), "构建交易失败");
      out=await api.auth.evmBroadcast({ tx:prep.tx, activityId:(await sign(prep)).activityId });
    } else if (token.chain === "Solana") {
      const prep=fail(await api.auth.solPrepare({ to:recipient.addr, amount:Number(amount) }), "构建交易失败");
      out=await api.auth.solBroadcast({ sol:prep.sol, activityId:(await sign(prep)).activityId });
    } else { // Bitcoin
      const prep=fail(await api.auth.btcPrepare({ to:recipient.addr, amount:Number(amount) }), "构建交易失败");
      out=await api.auth.btcBroadcast({ btc:prep.btc, activityId:(await sign(prep)).activityId });
    }
    if (!out||!out.ok) throw new Error((out&&(out.message||out.error))||"广播失败");
    setResult(out); setPhase("done");
  };
  return (<Sheet title={titles[phase]} step={phase!=="done"?`${idx+1} / 5`:null} onBack={back} onClose={onClose}>
    <div className="steps" style={{ marginBottom:20 }}>{order.slice(0,5).map((s,i)=><i key={s} className={i===idx?"on":i<idx?"done":""}/>)}</div>
    {phase==="asset" && <TokenPick tokens={tokens} value={token} onChange={(t)=>{ setToken(t); next(); }}/>}
    {phase==="recipient" && <RecipientPick token={token} value={recipient} onChange={setRecipient}/>}
    {phase==="amount" && <AmountEntry token={token} amount={amount} onChange={setAmount}/>}
    {phase==="review" && <ReviewRows token={token} recipient={recipient} amount={amount}/>}
    {phase==="pk" && <RealSignGate label="用通行密钥确认转账" sub={`${amount} ${token.sym} → ${recipient&&recipient.name} · 真实上链`} onSign={signAndSend} onCancel={()=>setPhase("review")}/>}
    {phase==="done" && (<div className="done-state"><div className="done-mark">{WI.check}</div><div className="dt">{result?"转账已上链":"转账已提交"}</div>
      <div className="dsub">{amount} {token.sym} → {recipient&&recipient.name}<br/>{result?`已在 ${result.network} 广播 · ${result.status==="success"?"成功":(result.status||"已提交")}`:`已在 ${token.chain} 上广播，等待确认。`}</div>
      {result&&result.explorer ? <a className="done-hash" href={result.explorer} target="_blank" rel="noreferrer">{WI.ext} 在区块浏览器查看</a> : <div className="done-hash">{WI.ext} {hash.current}</div>}</div>)}
    {(phase==="recipient"||phase==="amount"||phase==="review") && (<div style={{ display:"flex", gap:12, marginTop:24 }}><button className="wbtn wbtn-primary" disabled={(phase==="recipient"&&!recipient)||(phase==="amount"&&!(Number(amount)>0))} onClick={next}>{phase==="review"?"用通行密钥签名":"继续"} {WI.right}</button></div>)}
    {phase==="done" && <div style={{ marginTop:24 }}><button className="wbtn wbtn-ghost" style={{ width:"100%" }} onClick={onClose}>完成</button></div>}
  </Sheet>);
}
function ReceiveFlow({ presetToken, addresses, onClose }){
  const chains=["Sui","Ethereum","Solana","Bitcoin"].filter(c=>addresses[{ Bitcoin:"BTC", Ethereum:"ETH", Solana:"SOL", Sui:"SUI" }[c]]);
  const [chain,setChain]=useS((presetToken&&presetToken.chain)||chains[0]);
  const addr=addresses[{ Bitcoin:"BTC", Ethereum:"ETH", Solana:"SOL", Sui:"SUI" }[chain]] || "";
  const [copied,setCopied]=useS(false);
  const copy=()=>{ try{ navigator.clipboard.writeText(addr); }catch(e){} setCopied(true); setTimeout(()=>setCopied(false),1400); };
  return (<Sheet title="收款" onClose={onClose}><div className="recv-card">
    <div className="recv-chain-tabs">{chains.map(c=><div key={c} className={"tok-pill"+(chain===c?" on":"")} onClick={()=>setChain(c)}><span className="tp-nm" style={{ fontSize:14 }}>{c}</span></div>)}</div>
    <QR seed={addr} size={184}/>
    <div className="recv-addr"><span className="ad">{addr}</span><span className="cp" onClick={copy}>{copied?WI.check:WI.copy}</span></div>
    <div style={{ fontFamily:"var(--mono)", fontSize:12, color:"var(--ink-3)", marginTop:16, lineHeight:1.6 }}>仅向此地址转入 <b style={{ color:"var(--ink-2)" }}>{chain}</b> 网络资产。<br/>由通行密钥守护 · 无需助记词。</div>
  </div></Sheet>);
}
function SwapFlow({ tokens, presetToken, onClose }){
  const [from,setFrom]=useS(presetToken||tokens[0]);
  const [to,setTo]=useS(tokens[1]||tokens[0]); const [amt,setAmt]=useS("1"); const [pick,setPick]=useS(null); const [phase,setPhase]=useS("form");
  const rate=priceNum(from)/(priceNum(to)||1), out=(Number(amt)||0)*rate; const flip=()=>{ setFrom(to); setTo(from); };
  if (pick) return (<Sheet title="选择代币" onBack={()=>setPick(null)} onClose={onClose}><TokenPick tokens={tokens} value={pick==="from"?from:to} onChange={(t)=>{ pick==="from"?setFrom(t):setTo(t); setPick(null); }}/></Sheet>);
  return (<Sheet title="兑换 · Swap" onClose={onClose} onBack={phase==="pk"?()=>setPhase("form"):null}>
    {phase==="done" ? (<><div className="done-state"><div className="done-mark">{WI.check}</div><div className="dt">兑换完成</div><div className="dsub">{amt} {from.sym} → {out.toPrecision(6)} {to.sym}</div></div><div style={{ marginTop:24 }}><button className="wbtn wbtn-ghost" style={{ width:"100%" }} onClick={onClose}>完成</button></div></>)
    : phase==="pk" ? <PasskeyGate label="确认兑换" onDone={()=>setPhase("done")} onCancel={()=>setPhase("form")}/>
    : (<><div className="swap-leg"><div className="sl-top"><span>支付</span><span className="tnum">余额 {from.amt}</span></div><div className="sl-row"><input className="sl-amt tnum" inputMode="decimal" value={amt} onChange={(e)=>setAmt(e.target.value.replace(/[^0-9.]/g,""))}/><div className="sl-pick" onClick={()=>setPick("from")}><TokenSeal token={from} size={26}/><span className="nm">{from.sym}</span>{WI.down}</div></div></div>
      <div className="swap-mid"><button onClick={flip}>{WI.swap}</button></div>
      <div className="swap-leg"><div className="sl-top"><span>获得（预估）</span><span className="tnum">余额 {to.amt}</span></div><div className="sl-row"><input className="sl-amt tnum" readOnly value={out?out.toPrecision(6):"0"}/><div className="sl-pick" onClick={()=>setPick("to")}><TokenSeal token={to} size={26}/><span className="nm">{to.sym}</span>{WI.down}</div></div></div>
      <div className="swap-rate"><div className="sr"><span className="k">汇率</span><span className="tnum">1 {from.sym} ≈ {rate.toPrecision(5)} {to.sym}</span></div><div className="sr"><span className="k">滑点</span><span>0.5%</span></div><div className="sr"><span className="k">网络费</span><span className="tnum">≈ $0.21</span></div></div>
      <button className="wbtn wbtn-primary" style={{ width:"100%", marginTop:20 }} disabled={!(Number(amt)>0)} onClick={()=>setPhase("pk")}>{WI.sign} 审阅并签名兑换</button></>)}
  </Sheet>);
}
function SignFlow({ onClose }){
  const [kind,setKind]=useS("message"); const [phase,setPhase]=useS("review"); const req=SIGN_REQUESTS[kind];
  return (<Sheet title="签名请求" onClose={onClose} onBack={phase==="pk"?()=>setPhase("review"):null}>
    {phase==="done" ? (<><div className="done-state"><div className="done-mark">{WI.check}</div><div className="dt">{kind==="message"?"已签名":"已授权"}</div><div className="dsub">{req.origin} 已收到你的{kind==="message"?"签名":"授权"}。<br/>未发生任何转账。</div></div><div style={{ marginTop:24 }}><button className="wbtn wbtn-ghost" style={{ width:"100%" }} onClick={onClose}>完成</button></div></>)
    : phase==="pk" ? <PasskeyGate label="用通行密钥签名" sub="不会发起转账 · 仅证明身份/授权" onDone={()=>setPhase("done")} onCancel={()=>setPhase("review")}/>
    : (<><div className="seg-tabs" style={{ marginBottom:18 }}><button className={kind==="message"?"on":""} onClick={()=>setKind("message")}>签名消息</button><button className={kind==="approve"?"on":""} onClick={()=>setKind("approve")}>授权交易</button></div>
      <div className="sign-origin"><span className="so-fav"><WMark size={20}/></span><div><div className="so-t">{req.title}</div><div className="so-u">{WI.shield} {req.origin} · {req.chain}</div></div></div>
      <div className="sign-purpose">{req.purpose}</div>
      {kind==="message" ? <div className="sign-msg">{req.message}</div> : <div className="rev">{req.rows.map(([k,v],i)=><div key={i} className="rr"><span className="k">{k}</span><span className="v">{v}</span></div>)}</div>}
      <div className="sign-warn">{WI.shield} 只在你信任的站点签名。Liber 不会通过签名转移你的资产。</div>
      <div style={{ display:"flex", gap:12, marginTop:20 }}><button className="wbtn wbtn-ghost" onClick={onClose}>拒绝</button><button className="wbtn wbtn-primary" onClick={()=>setPhase("pk")}>{WI.sign} {kind==="message"?"签名":"授权"}</button></div></>)}
  </Sheet>);
}
function ActivityDetail({ item, onClose }){
  const neg=item.amt.trim().startsWith("-");
  return (<Sheet title="交易明细" onClose={onClose}><div className="rev"><div className="rev-hero"><TokenSeal token={item.sym} size={46}/><div><div className="rh-amt tnum" style={{ color:neg?"var(--ink)":"var(--pos)" }}>{item.amt} {item.sym}</div><div className="rh-sub">{item.title}</div></div></div>
    <div className="rr"><span className="k">说明</span><span className="v">{item.sub}</span></div><div className="rr"><span className="k">网络</span><span className="v">{item.chain}</span></div>
    <div className="rr"><span className="k">时间</span><span className="v">{item.when}</span></div><div className="rr"><span className="k">交易哈希</span><span className="v">{item.hash}</span></div>
    <div className="rr"><span className="k">状态</span><span className="v" style={{ color:"var(--pos)" }}>● 已确认 · 永久存证</span></div></div>
    {item.note && <div style={{ fontFamily:"var(--body)", fontStyle:"italic", fontSize:15, color:"var(--ink-2)", marginTop:16, padding:"0 4px" }}>「{item.note}」</div>}
    {item.explorer
      ? <a className="wbtn wbtn-ghost" style={{ width:"100%", marginTop:20, display:"flex", justifyContent:"center", gap:8, textDecoration:"none" }} href={item.explorer} target="_blank" rel="noreferrer">{WI.ext} 在区块浏览器中查看</a>
      : <button className="wbtn wbtn-ghost" style={{ width:"100%", marginTop:20 }}>{WI.ext} 在区块浏览器中查看</button>}</Sheet>);
}
function FlowHost({ flow, addresses, tokens, onClose }){
  if (!flow) return null;
  if (flow.kind==="send") return <SendFlow tokens={tokens} presetToken={flow.token} onClose={onClose}/>;
  if (flow.kind==="receive") return <ReceiveFlow presetToken={flow.token} addresses={addresses} onClose={onClose}/>;
  if (flow.kind==="swap") return <SwapFlow tokens={tokens} presetToken={flow.token} onClose={onClose}/>;
  if (flow.kind==="sign") return <SignFlow onClose={onClose}/>;
  if (flow.kind==="activity") return <ActivityDetail item={flow.item} onClose={onClose}/>;
  return null;
}

/* ---------- tab-pane sections ---------- */
function WalletBand({ portfolio, alloc, loading }){
  const [whole, cents] = fmtUSD(portfolio.total).replace("$", "").split(".");
  const hasAlloc = alloc && alloc.length > 0;
  return (<div className="pfw-band"><div><div className="bb-label">{WI.shield} 我的资产 · 由通行密钥守护{loading ? " · 加载中…" : ""}</div>
    <div className="bb-total tnum">${whole}<span className="cents">.{cents}</span></div>
    <div className="bb-delta"><span className="tnum" style={{ color: "var(--ink-3)" }}>{hasAlloc ? "链上实时余额 · 主网" : "暂无资产 · 向上方地址转入即可"}</span></div></div>
    {hasAlloc && <div className="bb-ring"><AllocRing alloc={alloc} size={108} thick={15}/></div>}</div>);
}
function QuickActions({ onAction }){
  return (<div className="pfw-actions">
    <button className="qa" onClick={()=>onAction("send")}><span className="qa-ic">{WI.send}</span>转账</button>
    <button className="qa" onClick={()=>onAction("receive")}><span className="qa-ic">{WI.recv}</span>收款</button>
    <button className="qa" onClick={()=>onAction("swap")}><span className="qa-ic">{WI.swap}</span>兑换</button>
    <button className="qa ghost" onClick={()=>onAction("sign")}><span className="qa-ic">{WI.sign}</span>签名</button></div>);
}
const ADDR_META = [["sui","SUI","Sui"],["ethereum","ETH","Ethereum"],["solana","SOL","Solana"],["bitcoin","BTC","Bitcoin"]];
function IdentityStrip({ wallets, onReceive }){
  const [copied,setCopied]=useS(null);
  const copy=(k,a)=>{ try{ navigator.clipboard.writeText(a); }catch(e){} setCopied(k); setTimeout(()=>setCopied(null),1200); };
  const rows=ADDR_META.filter(([k])=>wallets[k]);
  return (<div className="pfw-card pfw-identity"><div className="pi-h"><span>链上身份 · 真实地址</span><span className="vfy">{WI.shield} 通行密钥已验证</span><span className="more" style={{ marginLeft:"auto" }} onClick={onReceive}>收款 {WI.right}</span></div>
    <div className="pfw-addr-grid">{rows.map(([k,sym,name])=>(<div key={k} className="pfw-addr" onClick={()=>copy(k,wallets[k])} title={wallets[k]}><TokenSeal token={sym} size={34}/><div className="pa-b"><div className="pa-nm">{name}</div><div className="pa-ad">{wallets[k]}</div></div><span className="pa-cp">{copied===k?WI.check:WI.copy}</span></div>))}</div></div>);
}
function AssetList({ tokens, onOpen }){
  return (<div className="panel"><div className="asset-rows">{tokens.map(t=>(
    <div key={t.sym} className="arow" onClick={()=>onOpen(t)}><TokenSeal token={t} size={42}/>
      <div className="a-id"><div className="nm">{t.name}</div><div className="ch">{t.chain} · {t.sym}</div></div>
      <div className="a-price tnum">{t.price != null ? "$" + Number(t.price).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</div>
      <div className="a-spark">{t.spark ? <Sparkline data={t.spark} w={120} h={34} up/> : null}</div>
      <div className="a-bal"><div className="v tnum">{t.value ? fmtUSD(t.value) : "$0.00"}</div><div className="u tnum">{t.amt} {t.sym}</div></div>
      <span className="a-go">{WI.chev}</span></div>))}</div></div>);
}
function ActivityList({ items, onOpen, limit }){
  const list=limit?items.slice(0,limit):items;
  return (<div className="panel"><div className="act-list">{list.map(a=>{ const neg=a.amt.trim().startsWith("-"); return (
    <div key={a.id} className="act" onClick={()=>onOpen&&onOpen(a)}><span className="a-ic">{ACT_GLYPH[a.kind]||WI.send}</span>
      <div className="a-bd"><div className="t">{a.title}</div><div className="s"><span>{a.sub}</span><span className="hash">· {a.hash}</span></div></div>
      <div className="a-amt"><div className={"v tnum "+(neg?"neg":"pos")}>{a.amt} {a.sym}</div><div className="st">{WI.dot} {a.when}</div></div></div>); })}</div></div>);
}
function UsesGrid({ onAction }){
  return (<div className="uses-grid">{USES.map(u=>(<div key={u.k} className="use-card"><div className="u-h"><TokenSeal token={u.sym} size={30}/><div className="u-t">{u.title}</div></div><div className="u-d">{u.desc}</div>
    <div className="u-cta" onClick={()=>onAction(u.k==="tip"?"send":u.k==="storage"?"swap":u.k==="mint"?"receive":"sign")}>{u.cta} {WI.right}</div></div>))}</div>);
}
function ThanksWall(){
  return (<div className="pfw-card thanks-wall"><div className="tw-list">{TIPS_WALL.map((t,i)=>(<div className="tw-item" key={i}><span className="tw-av" style={{ background:`linear-gradient(135deg, ${t.color}, #2e3a7a)` }}>{t.seal}</span>
    <div className="tw-b"><div className="tw-top"><span className="tw-nm">{t.name}</span><span className="tw-amt tnum">{t.amt} {t.sym}</span></div>{t.msg&&<div className="tw-msg">「{t.msg}」</div>}<div className="tw-meta">{t.when} · <span className="tw-hash">{t.hash}</span></div></div></div>))}</div></div>);
}

/* ---------- the 钱包 tab (pane + flow host) ---------- */
export function WalletTab({ wallets, passkeyEnrolled, userId, userName }){
  const [flow, setFlow] = useS(null);
  const [pkState, setPkState] = useS(passkeyEnrolled ? "done" : "idle"); // idle | working | done | error
  const [pkErr, setPkErr] = useS("");
  const [bal, setBal] = useS(null);
  const [loading, setLoading] = useS(true);
  const [acts, setActs] = useS(null); // real on-chain ledger items (null = loading)
  const [reload, setReload] = useS(0);
  useE(() => {
    let live = true;
    api.auth.walletBalances().then((r) => { if (live) { setBal(r); setLoading(false); } }).catch(() => { if (live) setLoading(false); });
    api.auth.walletActivity().then((r) => { if (live) setActs((r && r.items) || []); }).catch(() => { if (live) setActs([]); });
    return () => { live = false; };
  }, [reload]);
  const tokens = ((bal && bal.tokens) || []).map((t) => ({
    sym: t.sym, name: t.name, chain: t.chain, cls: t.cls, glyph: t.glyph,
    amt: t.amt == null ? "—" : String(t.amt), value: t.value == null ? 0 : t.value,
    price: t.price, chg: 0, spark: null, address: t.address,
  }));
  const portfolio = { total: (bal && bal.total) || 0 };
  const alloc = tokens.filter((t) => t.value > 0).map((t) => ({ sym: t.sym, cls: t.cls, value: t.value })).sort((a, b) => b.value - a.value);
  const addresses = { SUI: wallets.sui, ETH: wallets.ethereum, SOL: wallets.solana, BTC: wallets.bitcoin };
  const onAction = (kind, arg) => {
    if (kind === "activity") { setFlow({ kind: "activity", item: arg }); return; }
    if ((kind === "send" || kind === "swap") && !tokens.length) return;
    setFlow({ kind, token: arg });
  };
  const enrollPasskey = async () => {
    if (!passkeySupported()) { setPkErr("此设备不支持通行密钥"); setPkState("error"); return; }
    setPkState("working"); setPkErr("");
    try {
      const payload = await createWalletPasskey({ userId, userName });
      const r = await api.auth.enrollWalletPasskey(payload);
      if (r && r.ok) setPkState("done");
      else { setPkState("error"); setPkErr((r && r.error) || "注册失败"); }
    } catch (e) { setPkState("error"); setPkErr((e && e.message) || "已取消或失败"); }
  };
  return (
    <div className="pfw-tabpane">
      {pkState !== "done" && (
        <div className="pk-banner">
          <div className="pkb-ic">{WI.shield}</div>
          <div className="pkb-b">
            <div className="pkb-t">为钱包设置通行密钥</div>
            <div className="pkb-d">{pkErr || "用 Face ID / 指纹给钱包加一把签名钥匙。之后转账由你的通行密钥授权，服务器无法擅自动用你的资产。"}</div>
          </div>
          <button className="wbtn wbtn-primary" style={{ flex: "none" }} disabled={pkState === "working"} onClick={enrollPasskey}>
            {pkState === "working" ? "请在设备上确认…" : <>{WI.finger} 设置</>}
          </button>
        </div>
      )}
      <WalletBand portfolio={portfolio} alloc={alloc} loading={loading}/>
      <QuickActions onAction={onAction}/>
      <IdentityStrip wallets={wallets} onReceive={() => setFlow({ kind: "receive" })}/>
      <div>
        <div className="pfw-h"><span className="t">资产 · {tokens.length || 4} 链</span><span className="lock">{loading ? "加载中…" : "链上实时余额 · 主网"}</span></div>
        <AssetList tokens={tokens} onOpen={(t) => onAction("send", t)}/>
      </div>
      <div>
        <div className="pfw-h"><span className="t">在 Liber 里用它</span></div>
        <UsesGrid onAction={onAction}/>
      </div>
      <div>
        <div className="pfw-h"><span className="t">账册 · 最近活动</span><span className="lock">{acts == null ? "加载中…" : "Sui 链上记录 · 实时"}</span></div>
        {acts && acts.length
          ? <ActivityList items={acts} onOpen={(a) => onAction("activity", a)} limit={8}/>
          : <div className="panel" style={{ padding: "26px", textAlign: "center", fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink-3)" }}>{acts == null ? "正在读取链上记录…" : "暂无链上活动 · 转账后会出现在这里"}</div>}
      </div>
      <FlowHost flow={flow} addresses={addresses} tokens={tokens} onClose={() => { const wasSend = flow && (flow.kind === "send" || flow.kind === "swap"); setFlow(null); if (wasSend) setReload((n) => n + 1); }}/>
    </div>
  );
}
