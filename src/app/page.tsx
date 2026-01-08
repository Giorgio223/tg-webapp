"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    Telegram?: any;
  }
}

type State = {
  roundId: string;
  phase: "BET" | "PLAY" | "END";
  phaseStartedAt: number;
  percent: number;
};

export default function Page() {
  const [isTelegram, setIsTelegram] = useState(false);
  const [initData, setInitData] = useState<string>("");
  const [state, setState] = useState<State | null>(null);

  async function refresh() {
    const r = await fetch("/api/state", { cache: "no-store" });
    const j = await r.json();
    setState(j.state);
  }

  async function tick() {
    const r = await fetch("/api/tick", { method: "POST" });
    const j = await r.json();
    setState(j.state);
  }

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      setIsTelegram(true);
      setInitData(tg.initData || "");
      tg.ready();
      tg.expand();
    }
    refresh();
    const id = setInterval(() => {
      tick();
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Game MVP</h1>

      <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #ccc" }}>
        <div><b>Inside Telegram:</b> {isTelegram ? "YES" : "NO"}</div>
        <div style={{ marginTop: 8, wordBreak: "break-all" }}>
          <b>initData:</b> {initData ? initData : "(empty)"}
        </div>
      </div>

      <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #ccc" }}>
        <div><b>roundId:</b> {state?.roundId ?? "-"}</div>
        <div><b>phase:</b> {state?.phase ?? "-"}</div>
        <div><b>percent:</b> {state?.percent?.toFixed(2) ?? "-"}%</div>
      </div>

      <button style={{ marginTop: 12, padding: "10px 14px" }} onClick={tick}>
        Manual tick
      </button>
    </main>
  );
}
