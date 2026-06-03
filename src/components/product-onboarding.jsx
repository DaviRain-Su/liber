import React from "react";
import { I, Mark } from "./product-shared.jsx";
// wallet.js (@mysten/sui) and passkey.js (@simplewebauthn) are heavy and only
// needed once the user actually signs in — dynamic-import them in the handlers
// below so they split out of the first-paint bundle.
import { api, getToken, setToken } from "../lib/api.js";
import { getCatalogTotal } from "../lib/catalog.js";

/* product-onboarding.jsx — welcome + value props + decentralized sign-in + interests. */
const { useState: useOnb, useEffect: useEonb } = React;

/* brand glyph for the passkey auth-row (Google's button is GIS-rendered) */
const PasskeyGlyph = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="8.5" cy="8.5" r="4.6" />
    <path d="m11.8 11.8 7 7M16.4 16.4l2-2M14.2 14.2l1.8-1.8" />
  </svg>
);

const WALLETS = [
  {
    k: "sui",
    kind: "sui",
    name: "Sui 钱包",
    glyph: "◇",
    color: "#4da2ff",
    desc: "Sui 网络 · 推荐",
  },
  { k: "suiet", kind: "sui", name: "Suiet", glyph: "❂", color: "#5168bf", desc: "Sui 轻量扩展" },
  {
    k: "metamask",
    kind: "evm",
    name: "MetaMask",
    glyph: "Ξ",
    color: "#627eea",
    desc: "以太坊 / EVM 网络",
  },
  {
    k: "phantom",
    kind: "solana",
    name: "Phantom",
    glyph: "◎",
    color: "#9945ff",
    desc: "Solana 网络",
  },
];
const INTERESTS = [
  { k: "philo", label: "哲学 · 思想", seal: "道" },
  { k: "econ", label: "经济 · 政治", seal: "富" },
  { k: "sci", label: "科学 · 博物", seal: "源" },
  { k: "lit", label: "文学 · 诗", seal: "诗" },
  { k: "history", label: "历史 · 传记", seal: "史" },
  { k: "art", label: "艺术 · 美学", seal: "艺" },
];
const VALUES = [
  {
    seal: "永",
    title: "永不消失的图书馆",
    t: "每一本书都分块写入去中心化存储，多网络留存副本。没有任何一方能单方面删除它——包括我们自己。",
  },
  {
    seal: "友",
    title: "读到哪，问到哪",
    t: "AI 书友陪你通读。选中任意一句就能追问、延展、被反问，或让它替你整理成笔记。",
  },
  {
    seal: "共",
    title: "一个人读，一群人读",
    t: "看见别人在同一句旁的批注，加入共读小组，让书页的边缘不再安静。",
  },
];

function Onboarding({ onFinish }) {
  const [step, setStep] = useOnb(0);
  const [connecting, setConnecting] = useOnb(null); // wallet key
  const [account, setAccount] = useOnb(null); // {wallet, addr}
  const [authError, setAuthError] = useOnb(""); // sign-in error message
  const [picks, setPicks] = useOnb(["philo"]);
  const [googleOn, setGoogleOn] = useOnb(false); // Google login configured + button mounted
  const googleRef = React.useRef(null);
  const [email, setEmail] = useOnb("");
  const [emailStage, setEmailStage] = useOnb("input"); // input | code
  const [emailCode, setEmailCode] = useOnb("");
  const [emailHint, setEmailHint] = useOnb("");
  const emailValid = /.+@.+\..+/.test(email);
  const total = 5;
  const catalogTotal = getCatalogTotal();

  const connect = async (w) => {
    setConnecting(w.k);
    setAuthError("");
    try {
      const mod = await import("../lib/wallet.js");
      // Route by chain: each does connect → sign the login nonce → backend verify.
      const acct =
        w.kind === "evm"
          ? await mod.evmLogin()
          : w.kind === "solana"
            ? await mod.solanaLogin()
            : await mod.walletLogin(w.name);
      setConnecting(null);
      setAccount({ wallet: w.name, addr: acct.address });
      setStep(3);
    } catch (e) {
      setConnecting(null);
      if (w.kind === "sui") {
        // Preserve the Sui demo fallback so first-run onboarding still flows when no
        // wallet is installed. For real EVM/Solana logins, surface the error instead
        // of faking a connection the user didn't actually make.
        setAccount({
          wallet: w.name,
          addr: "sui:0x7c" + Math.random().toString(16).slice(2, 6) + "…a4f1",
        });
        setStep(3);
      } else {
        setAuthError(e?.message || "登录失败，请重试");
      }
    }
  };
  // Real WebAuthn: register-or-sign-in, mint a session, then advance. No demo
  // fallback — a passkey that didn't actually log in must surface an error, not
  // pretend, so we don't land back on the "未登录" state the reader hit before.
  // Two explicit intents so a returning reader never forks a new account: "登录"
  // uses discoverable credentials (finds an iCloud/Google-synced passkey even on a
  // fresh device); "创建" is the only path that mints a new account.
  const passkey = async (mode = "signin") => {
    setConnecting(mode === "create" ? "passkey-create" : "passkey");
    setAuthError("");
    try {
      const mod = await import("../lib/passkey.js");
      const res = mode === "create" ? await mod.passkeyCreate() : await mod.passkeySignIn();
      setConnecting(null);
      setAccount({ wallet: "通行密钥", addr: res?.user?.handle || "passkey" });
      setStep(3);
    } catch (e) {
      setConnecting(null);
      if (mode === "signin" && (e?.name === "NotAllowedError" || e?.status === 404)) {
        setAuthError("没有找到可用的通行密钥。首次使用请点“创建通行密钥”。");
      } else {
        setAuthError(
          e?.name === "NotAllowedError"
            ? "通行密钥操作已取消，请重试"
            : e?.message || "通行密钥登录失败，请重试",
        );
      }
    }
  };
  // Mount Google's "Sign in with Google" button when the sign-in step is shown,
  // but only if the backend has GOOGLE_CLIENT_ID set (otherwise it stays hidden).
  useEonb(() => {
    if (step !== 2) return;
    let cancelled = false;
    (async () => {
      try {
        const { mountGoogleButton } = await import("../lib/google.js");
        if (cancelled || !googleRef.current) return;
        const ok = await mountGoogleButton(googleRef.current, {
          onSuccess: ({ user }) => {
            setConnecting(null);
            setAuthError("");
            setAccount({ wallet: "Google", addr: user?.name || user?.handle || "google" });
            setStep(3);
          },
          onError: (e) => {
            if (!cancelled) setAuthError(e?.message || "Google 登录失败，请重试");
          },
        });
        if (!cancelled) setGoogleOn(ok);
      } catch {
        if (!cancelled) setGoogleOn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step]);

  // email one-time-code login
  const emailStart = async () => {
    if (!emailValid || connecting) return;
    setConnecting("email");
    setAuthError("");
    setEmailHint("");
    try {
      const r = await api.auth.emailStart(email.trim());
      setConnecting(null);
      setEmailStage("code");
      setEmailCode("");
      setEmailHint(
        r?.devCode
          ? `测试模式 · 你的验证码：${r.devCode}`
          : `验证码已发送至 ${email.trim()}，10 分钟内有效`,
      );
    } catch (e) {
      setConnecting(null);
      setAuthError(e?.message || "发送失败，请重试");
    }
  };
  const emailVerify = async () => {
    if (emailCode.length < 6 || connecting) return;
    setConnecting("email");
    setAuthError("");
    try {
      const r = await api.auth.emailVerify(email.trim(), emailCode);
      if (r?.token) setToken(r.token);
      setConnecting(null);
      setAccount({ wallet: "邮箱", addr: r?.user?.handle || email.trim() });
      setStep(3);
    } catch (e) {
      setConnecting(null);
      setAuthError(e?.message || "验证失败，请重试");
    }
  };

  const togglePick = (k) => setPicks((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const finish = async () => {
    localStorage.setItem("liber.onboarded", "1");
    localStorage.setItem("liber.reader.entered", "1");
    localStorage.removeItem("liber.guest");
    if (account && getToken()) localStorage.setItem("liber.account", JSON.stringify(account));
    onFinish();
  };

  return (
    <div className="onb" data-step={step}>
      {/* left brand panel (desktop) */}
      <div className="onb-aside">
        <div className="onb-aside-in">
          <div className="onb-brand">
            <Mark size={30} />
            <span>Liber</span>
          </div>
          <div className="onb-aside-mark">{["道", "思", "入", "源", "诗"][step]}</div>
          <div className="onb-aside-copy">
            <div className="oa-kick">永存的开放图书馆</div>
            <p>
              “为往圣继绝学”——
              <br />
              把人类的公共经典，
              <br />
              放进一座删不掉的图书馆。
            </p>
          </div>
          <div className="onb-aside-foot">CC0 · 公共领域 · 去中心化存储</div>
        </div>
      </div>

      {/* right flow panel */}
      <div className="onb-main">
        <div className="onb-topbar">
          <div className="onb-dots">
            {Array.from({ length: total }).map((_, i) => (
              <span key={i} className={i === step ? "on" : i < step ? "done" : ""} />
            ))}
          </div>
          {step > 0 && step < 4 && (
            <button className="onb-skip" onClick={() => finish()}>
              跳过，先逛逛
            </button>
          )}
        </div>

        <div className="onb-stage">
          {/* 0 — welcome */}
          {step === 0 && (
            <div className="onb-card onb-welcome">
              <div className="ow-mark">
                <Mark size={46} />
              </div>
              <h1>欢迎来到 Liber</h1>
              <p className="ow-lede">
                一座为所有人开放、且永远不会消失的图书馆。
                <br />
                从这里开始，慢读一本好书。
              </p>
              <div className="onb-actions">
                <button className="btn btn-primary onb-cta" onClick={() => setStep(1)}>
                  开始 <span className="arr">→</span>
                </button>
                <button className="btn btn-ghost onb-cta" onClick={() => setStep(2)}>
                  我已有账户，直接登录
                </button>
              </div>
              <div className="ow-stats">
                <div>
                  <b>{catalogTotal.toLocaleString("zh-CN")}</b> 卷已入库
                </div>
                <span />
                <div>
                  <b>CC0 / PD</b> 公共版权
                </div>
                <span />
                <div>
                  <b>3</b> 重存储备份
                </div>
              </div>
            </div>
          )}

          {/* 1 — value props */}
          {step === 1 && (
            <div className="onb-card onb-values">
              <div className="onb-h">
                <div className="kicker">为什么是 Liber</div>
                <h2>三件我们想做对的事</h2>
              </div>
              <div className="val-grid">
                {VALUES.map((v, i) => (
                  <div className="val-item" key={i}>
                    <span className="val-seal">{v.seal}</span>
                    <div className="val-t">{v.title}</div>
                    <div className="val-d">{v.t}</div>
                  </div>
                ))}
              </div>
              <div className="onb-actions">
                <button className="btn btn-primary onb-cta" onClick={() => setStep(2)}>
                  登录，开始阅读 <span className="arr">→</span>
                </button>
              </div>
            </div>
          )}

          {/* 2 — sign in */}
          {step === 2 && (
            <div className="onb-card onb-signin">
              <div className="onb-h">
                <div className="kicker">登录 / 创建账户</div>
                <h2>翻开你的第一页</h2>
                <p className="onb-sub">
                  选一种方式登录。无论用哪种，Liber
                  都会在底层为你生成一个只属于你的身份——钥匙始终在你手里。
                </p>
              </div>

              {/* 快捷登录 — Google (GIS) + 通行密钥 */}
              <div className="signin-group">
                <div className="sg-head">快捷登录</div>
                <div
                  className="google-frame"
                  style={{ display: googleOn ? "flex" : "none", marginBottom: googleOn ? 9 : 0 }}
                >
                  <div className="google-host" ref={googleRef} />
                </div>
                <div className="auth-list">
                  <button
                    className={`auth-row ${connecting === "passkey" ? "connecting" : ""}`}
                    disabled={!!connecting}
                    onClick={() => passkey("signin")}
                  >
                    <span
                      className="ar-glyph"
                      style={{ background: "var(--accent)", color: "#fff", boxShadow: "none" }}
                    >
                      {PasskeyGlyph}
                    </span>
                    <span className="ar-mid">
                      <span className="ar-n">通行密钥登录</span>
                      <span className="ar-d">指纹 / 面容 · 免密登录</span>
                    </span>
                    {connecting === "passkey" ? (
                      <span className="ar-spin" />
                    ) : (
                      <span className="ar-arr">{I.right}</span>
                    )}
                  </button>
                </div>
                <button
                  className={`passkey-create ${connecting === "passkey-create" ? "connecting" : ""}`}
                  disabled={!!connecting}
                  onClick={() => passkey("create")}
                >
                  首次使用？<u>创建通行密钥</u>
                </button>
              </div>

              {/* 邮箱登录 — 验证码 */}
              <div className="signin-group">
                <div className="sg-head">邮箱登录</div>
                {emailStage === "code" ? (
                  <form
                    className="auth-email"
                    onSubmit={(e) => {
                      e.preventDefault();
                      emailVerify();
                    }}
                  >
                    <span className="ae-ic">{I.lock}</span>
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="输入 6 位验证码"
                      value={emailCode}
                      disabled={connecting === "email"}
                      onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="ae-send"
                      disabled={emailCode.length < 6 || !!connecting}
                    >
                      登录 <span className="arr">→</span>
                    </button>
                  </form>
                ) : (
                  <form
                    className="auth-email"
                    onSubmit={(e) => {
                      e.preventDefault();
                      emailStart();
                    }}
                  >
                    <span className="ae-ic">{I.mail}</span>
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="you@email.com"
                      value={email}
                      disabled={!!connecting}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="ae-send"
                      disabled={!emailValid || !!connecting}
                    >
                      发送验证码 <span className="arr">→</span>
                    </button>
                  </form>
                )}
                {emailHint && (
                  <div className="email-hint">
                    {emailHint}
                    {emailStage === "code" && (
                      <button
                        className="email-resend"
                        type="button"
                        disabled={!!connecting}
                        onClick={() => {
                          setEmailStage("input");
                          setEmailHint("");
                          setEmailCode("");
                        }}
                      >
                        换邮箱 / 重发
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Web3 钱包 — the app's real multi-chain wallets, as auth-rows */}
              <div className="signin-group">
                <div className="sg-head">Web3 钱包</div>
                <div className="auth-list">
                  {WALLETS.map((w) => (
                    <button
                      className={`auth-row ${connecting === w.k ? "connecting" : ""}`}
                      key={w.k}
                      disabled={!!connecting}
                      onClick={() => connect(w)}
                    >
                      <span
                        className="ar-glyph"
                        style={{
                          background: w.color,
                          color: "#fff",
                          boxShadow: "none",
                          fontSize: 21,
                        }}
                      >
                        {w.glyph}
                      </span>
                      <span className="ar-mid">
                        <span className="ar-n">{w.name}</span>
                        <span className="ar-d">{w.desc}</span>
                      </span>
                      {w.k === "sui" && connecting !== w.k && <span className="ar-tag">推荐</span>}
                      {connecting === w.k ? (
                        <span className="ar-spin" />
                      ) : (
                        <span className="ar-arr">{I.right}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {authError && (
                <div className="onb-auth-error" role="alert">
                  {authError}
                </div>
              )}
              <div className="onb-fine">
                私钥永不离开你的钱包 · 登录即同意以 CC0 协议共享你的公开批注。
              </div>
              <button
                className="btn-quiet signin-guest"
                disabled={!!connecting}
                onClick={() => finish()}
              >
                以访客身份先逛逛 →
              </button>
            </div>
          )}

          {/* 3 — interests */}
          {step === 3 && (
            <div className="onb-card onb-interests">
              <div className="onb-h">
                {account && (
                  <div className="acct-pill">
                    {I.lock} 已连接 · {account.wallet}
                  </div>
                )}
                <div className="kicker">个性化</div>
                <h2>你想读些什么？</h2>
                <p className="onb-sub">选几个方向，我们用它为你挑书、组织书库首页。随时能改。</p>
              </div>
              <div className="int-grid">
                {INTERESTS.map((it) => (
                  <button
                    className={`int-chip ${picks.includes(it.k) ? "on" : ""}`}
                    key={it.k}
                    onClick={() => togglePick(it.k)}
                  >
                    <span className="int-seal">{it.seal}</span>
                    {it.label}
                    {picks.includes(it.k) && <span className="int-check">✓</span>}
                  </button>
                ))}
              </div>
              <div className="onb-actions">
                <button
                  className="btn btn-primary onb-cta"
                  disabled={!picks.length}
                  onClick={() => setStep(4)}
                >
                  就这些，继续 <span className="arr">→</span>
                </button>
              </div>
            </div>
          )}

          {/* 4 — ready */}
          {step === 4 && (
            <div className="onb-card onb-ready">
              <div className="ready-seal">藏</div>
              <h1>你的图书馆已就绪</h1>
              <p className="ow-lede">
                {picks.length} 个方向、{catalogTotal.toLocaleString("zh-CN")} 卷图书，
                <br />
                和一位随时在旁的 AI 书友，等你翻开第一页。
              </p>
              <div className="onb-actions">
                <button className="btn btn-primary onb-cta" onClick={() => finish()}>
                  进入图书馆 <span className="arr">→</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { Onboarding };
