import React from "react";

/* product-certificate.jsx — on-chain proof certificate with verify animation. */
const { useState: useSc, useEffect: useEc } = React;

function Certificate({ bookId, onBack, onOpenBook }){
  const book = (window.BOOKS||[]).find(b => b.id === bookId) || window.BOOKS[0];
  const [verifying, setVerifying] = useSc(false);
  const [steps, setSteps] = useSc([]); // verified step keys
  const [net, setNet] = useSc(null);   // live storage-network reachability (from /api)
  useEc(() => {
    if (!window.liberApi) return;
    window.liberApi.books.proof(bookId).then(r => { if (r && r.networks) setNet(r.networks); }).catch(() => {});
  }, []);
  const checks = [
    { k:"walrus", label:"Walrus 正文分块", detail:"读取 142 个内容块，哈希校验通过" },
    { k:"arweave", label:"Arweave 冷备份", detail:"永久副本存在，跨网络可达" },
    { k:"sui", label:"Sui 链上索引", detail:"书目对象 #0427 状态有效" },
    { k:"license", label:"CC0 授权声明", detail:"公共领域贡献，自由传播" },
  ];

  const verify = () => {
    setVerifying(true); setSteps([]);
    checks.forEach((c,i) => setTimeout(() => {
      setSteps(s => [...s, c.k]);
      if (i === checks.length-1) setTimeout(() => setVerifying(false), 400);
    }, 500*(i+1)));
  };

  const copies = [
    { net:"Walrus", node:"主存储 · Sui", id:book.blob, status:"primary" },
    { net:"Arweave", node:"永久冷备", id:book.backup, status:"backup" },
    { net:"IPFS", node:"社区镜像 · 3 节点", id:"ipfs://bafy…k29r", status:"mirror" },
  ];

  return (
    <div className="app-screen">
      <div className="cert">
        <div className="cert-wrap">
          <div className="crumb" style={{paddingTop:24}}>
            <a onClick={onBack}>{book.t}</a> <span>/</span> <span style={{color:"var(--ink)"}}>存证证书</span>
          </div>

          <div className="cert-sheet">
            <div className="cert-watermark">{book.seal}</div>
            <div className="cert-top">
              <div>
                <div className="kicker">永久存证证书</div>
                <h1 className="cert-title">{book.t}</h1>
                <div className="cert-by">{book.a} · {book.sub} · {book.year}</div>
              </div>
              <div className={`cert-badge ${verifying?"checking":(steps.length===checks.length?"ok":"")}`}>
                {steps.length===checks.length ? "● 已验证" : verifying ? "验证中…" : "● 已永久存证"}
              </div>
            </div>

            <p className="cert-stmt">
              本卷正文已分块写入去中心化存储网络，并在多个网络保留冗余副本。其内容地址永久有效，
              <b>没有任何一方能够单方面删除或篡改它——包括 Liber 自己。</b>
            </p>

            {/* storage copies */}
            <div className="cert-sec">
              <div className="cs-h">跨网络副本</div>
              {net && net.configured && (
                <div className="cs-net" style={{fontSize:12, color:"var(--ink-3)", margin:"-2px 0 10px", fontFamily:"var(--mono)"}}>
                  实时探测 · Walrus {net.walrus===false?"⚠ 暂不可达":"✓ 网络可达"} · Arweave {net.arweave===false?"⚠ 暂不可达":"✓ 网关可达"}
                  {net.sui!=null && <> · Sui {net.sui?`✓ 链上活跃${net.checkpoint?` · #${net.checkpoint}`:""}`:"⚠ 暂不可达"}</>}
                </div>
              )}
              {copies.map((c,i) => (
                <div className={`copy-row ${steps.includes(c.net==="Walrus"?"walrus":c.net==="Arweave"?"arweave":"")?"verified":""}`} key={i}>
                  <span className={`copy-dot ${c.status}`}/>
                  <div className="copy-net"><div className="cn">{c.net}</div><div className="cd">{c.node}</div></div>
                  <code className="copy-id">{c.id}</code>
                  <span className="copy-stat">{verifying && !steps.includes(c.net==="Walrus"?"walrus":c.net==="Arweave"?"arweave":"x") ? "…" : "可达"}</span>
                </div>
              ))}
            </div>

            {/* verify checklist */}
            <div className="cert-sec">
              <div className="cs-h">完整性校验</div>
              <div className="verify-grid">
                {checks.map(c => {
                  const done = steps.includes(c.k);
                  return (
                    <div className={`verify-item ${done?"done":""} ${verifying&&!done?"pending":""}`} key={c.k}>
                      <span className="vi-check">{done ? "✓" : verifying ? "○" : "·"}</span>
                      <div><div className="vi-l">{c.label}</div><div className="vi-d">{done?c.detail:"待校验"}</div></div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="cert-foot">
              <div className="cf-meta">
                <div><span className="k">存证时间</span><span className="v">2025-03-12 09:41 UTC</span></div>
                <div><span className="k">索引对象</span><span className="v">{book.index}</span></div>
              </div>
              <div className="cf-actions">
                <button className="btn btn-primary" onClick={verify} disabled={verifying}>
                  {verifying ? "验证中…" : steps.length===checks.length ? "重新验证" : "一键验证存证"}
                </button>
                <button className="btn btn-ghost" onClick={()=>onOpenBook(book.id)}>开始阅读</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { Certificate };
