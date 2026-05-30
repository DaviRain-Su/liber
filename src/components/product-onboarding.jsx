import React from "react";
import { I, Mark } from "./product-shared.jsx";

/* product-onboarding.jsx — welcome + value props + decentralized sign-in + interests. */
const { useState: useOnb, useEffect: useEonb } = React;

const WALLETS = [
  { k:"sui",      name:"Sui 钱包",  glyph:"◇", color:"#4da2ff", desc:"官方钱包 · 推荐" },
  { k:"suiet",    name:"Suiet",     glyph:"❂", color:"#5168bf", desc:"轻量浏览器扩展" },
  { k:"backpack", name:"Backpack",  glyph:"▣", color:"#e33e3f", desc:"多链钱包" },
];
const INTERESTS = [
  { k:"philo", label:"哲学 · 思想", seal:"道" },
  { k:"econ",  label:"经济 · 政治", seal:"富" },
  { k:"sci",   label:"科学 · 博物", seal:"源" },
  { k:"lit",   label:"文学 · 诗", seal:"诗" },
  { k:"history", label:"历史 · 传记", seal:"史" },
  { k:"art",   label:"艺术 · 美学", seal:"艺" },
];
const VALUES = [
  { seal:"永", title:"永不消失的图书馆", t:"每一本书都分块写入去中心化存储，多网络留存副本。没有任何一方能单方面删除它——包括我们自己。" },
  { seal:"友", title:"读到哪，问到哪", t:"AI 书友陪你通读。选中任意一句就能追问、延展、被反问，或让它替你整理成笔记。" },
  { seal:"共", title:"一个人读，一群人读", t:"看见别人在同一句旁的批注，加入共读小组，让书页的边缘不再安静。" },
];

function Onboarding({ onFinish }){
  const [step, setStep] = useOnb(0);
  const [connecting, setConnecting] = useOnb(null); // wallet key
  const [account, setAccount] = useOnb(null);       // {wallet, addr}
  const [picks, setPicks] = useOnb(["philo"]);
  const total = 5;

  const connect = (w) => {
    setConnecting(w.k);
    setTimeout(() => {
      setConnecting(null);
      setAccount({ wallet:w.name, addr:"sui:0x7c"+Math.random().toString(16).slice(2,6)+"…a4f1" });
      setStep(3);
    }, 1400);
  };
  const passkey = () => {
    setConnecting("passkey");
    setTimeout(() => { setConnecting(null); setAccount({ wallet:"通行密钥", addr:"passkey · 林知秋" }); setStep(3); }, 1200);
  };
  const togglePick = (k) => setPicks(p => p.includes(k) ? p.filter(x=>x!==k) : [...p, k]);

  const finish = (guest) => {
    localStorage.setItem("liber.onboarded", "1");
    if (account) localStorage.setItem("liber.account", JSON.stringify(account));
    if (guest) localStorage.setItem("liber.guest", "1");
    onFinish();
  };

  return (
    <div className="onb" data-step={step}>
      {/* left brand panel (desktop) */}
      <div className="onb-aside">
        <div className="onb-aside-in">
          <div className="onb-brand"><Mark size={30}/><span>Liber</span></div>
          <div className="onb-aside-mark">{["道","思","富","源","诗"][step]}</div>
          <div className="onb-aside-copy">
            <div className="oa-kick">永存的开放图书馆</div>
            <p>“为往圣继绝学”——<br/>把人类的公共经典，<br/>放进一座删不掉的图书馆。</p>
          </div>
          <div className="onb-aside-foot">CC0 · 公共领域 · 去中心化存储</div>
        </div>
      </div>

      {/* right flow panel */}
      <div className="onb-main">
        <div className="onb-topbar">
          <div className="onb-dots">
            {Array.from({length:total}).map((_,i)=>(
              <span key={i} className={i===step?"on":i<step?"done":""}/>
            ))}
          </div>
          {step>0 && step<4 && <button className="onb-skip" onClick={()=>finish(true)}>跳过，先逛逛</button>}
        </div>

        <div className="onb-stage">
          {/* 0 — welcome */}
          {step===0 && (
            <div className="onb-card onb-welcome">
              <div className="ow-mark"><Mark size={46}/></div>
              <h1>欢迎来到 Liber</h1>
              <p className="ow-lede">一座为所有人开放、且永远不会消失的图书馆。<br/>从这里开始，慢读一本好书。</p>
              <div className="onb-actions">
                <button className="btn btn-primary onb-cta" onClick={()=>setStep(1)}>开始 <span className="arr">→</span></button>
                <button className="btn btn-ghost onb-cta" onClick={()=>setStep(2)}>我已有账户，直接登录</button>
              </div>
              <div className="ow-stats">
                <div><b>1,284</b> 卷已上链</div><span/><div><b>CC0</b> 公共版权</div><span/><div><b>3</b> 重存储备份</div>
              </div>
            </div>
          )}

          {/* 1 — value props */}
          {step===1 && (
            <div className="onb-card onb-values">
              <div className="onb-h"><div className="kicker">为什么是 Liber</div><h2>三件我们想做对的事</h2></div>
              <div className="val-grid">
                {VALUES.map((v,i)=>(
                  <div className="val-item" key={i}>
                    <span className="val-seal">{v.seal}</span>
                    <div className="val-t">{v.title}</div>
                    <div className="val-d">{v.t}</div>
                  </div>
                ))}
              </div>
              <div className="onb-actions">
                <button className="btn btn-primary onb-cta" onClick={()=>setStep(2)}>登录，开始阅读 <span className="arr">→</span></button>
              </div>
            </div>
          )}

          {/* 2 — sign in */}
          {step===2 && (
            <div className="onb-card onb-signin">
              <div className="onb-h"><div className="kicker">登录 / 创建账户</div><h2>连接你的钱包</h2>
                <p className="onb-sub">Liber 是去中心化的——你的身份属于你自己，书架与笔记跟着账户走，不绑定任何平台。</p></div>
              <div className="wallet-list">
                {WALLETS.map(w=>(
                  <button className={`wallet-row ${connecting===w.k?"connecting":""}`} key={w.k} disabled={!!connecting} onClick={()=>connect(w)}>
                    <span className="w-glyph" style={{background:w.color}}>{w.glyph}</span>
                    <div className="w-mid"><div className="w-n">{w.name}</div><div className="w-d">{w.desc}</div></div>
                    {connecting===w.k ? <span className="w-spin"/> : <span className="w-arr">{I.right}</span>}
                  </button>
                ))}
              </div>
              <div className="onb-or"><span>或</span></div>
              <div className="signin-alt">
                <button className={`btn btn-ghost ${connecting==="passkey"?"connecting":""}`} disabled={!!connecting} onClick={passkey}>
                  {I.lock} 用通行密钥登录
                </button>
                <button className="btn btn-quiet" disabled={!!connecting} onClick={()=>finish(true)}>以访客身份浏览</button>
              </div>
              <div className="onb-fine">连接即表示同意以 CC0 协议共享你的公开批注。私钥永不离开你的钱包。</div>
            </div>
          )}

          {/* 3 — interests */}
          {step===3 && (
            <div className="onb-card onb-interests">
              <div className="onb-h">
                {account && <div className="acct-pill">{I.lock} 已连接 · {account.wallet}</div>}
                <div className="kicker">个性化</div><h2>你想读些什么？</h2>
                <p className="onb-sub">选几个方向，我们用它为你挑书、组织书库首页。随时能改。</p>
              </div>
              <div className="int-grid">
                {INTERESTS.map(it=>(
                  <button className={`int-chip ${picks.includes(it.k)?"on":""}`} key={it.k} onClick={()=>togglePick(it.k)}>
                    <span className="int-seal">{it.seal}</span>{it.label}
                    {picks.includes(it.k) && <span className="int-check">✓</span>}
                  </button>
                ))}
              </div>
              <div className="onb-actions">
                <button className="btn btn-primary onb-cta" disabled={!picks.length} onClick={()=>setStep(4)}>就这些，继续 <span className="arr">→</span></button>
              </div>
            </div>
          )}

          {/* 4 — ready */}
          {step===4 && (
            <div className="onb-card onb-ready">
              <div className="ready-seal">藏</div>
              <h1>你的图书馆已就绪</h1>
              <p className="ow-lede">{picks.length} 个方向、1,284 卷经典，<br/>和一位随时在旁的 AI 书友，等你翻开第一页。</p>
              <div className="onb-actions">
                <button className="btn btn-primary onb-cta" onClick={()=>finish(false)}>进入图书馆 <span className="arr">→</span></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { Onboarding };
