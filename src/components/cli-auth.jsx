import React from "react";
import { api } from "../lib/api.js";

const { useState } = React;

function CliAuth({ deviceCode, userCode }) {
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  async function approve() {
    setStatus("working");
    setMessage("");
    try {
      const { walletLogin } = await import("../lib/wallet.js"); // heavy @mysten/sui — load on click
      const login = await walletLogin();
      await api.auth.cliApprove(deviceCode);
      setStatus("done");
      setMessage(`已授权 ${login.address.slice(0, 10)}... 使用 CLI 发布。可以回到终端。`);
    } catch (error) {
      setStatus("error");
      setMessage(error?.message || "授权失败");
    }
  }

  return (
    <main className="app-screen" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <section style={{ width: "min(520px, 100%)", border: "1px solid var(--hair)", background: "var(--paper)", padding: 28 }}>
        <div className="kicker" style={{ marginBottom: 14 }}>Liber CLI</div>
        <h1 className="display-s" style={{ margin: "0 0 12px" }}>授权终端发布</h1>
        <p className="muted" style={{ marginBottom: 22 }}>
          连接钱包并签名后，终端会收到一个发布令牌。令牌只能用于调用受 license gate 保护的入库接口。
        </p>
        <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink-2)", marginBottom: 20 }}>
          code: {userCode || deviceCode.slice(0, 8).toUpperCase()}
        </div>
        <button className="btn btn-primary" disabled={status === "working" || status === "done"} onClick={approve}>
          {status === "working" ? "等待钱包签名..." : status === "done" ? "已授权" : "连接钱包并授权"}
        </button>
        {message && (
          <p className={status === "error" ? "error" : "muted"} style={{ marginTop: 18 }}>
            {message}
          </p>
        )}
      </section>
    </main>
  );
}

export { CliAuth };
