"use client";

import { useEffect, useState } from "react";
import GraphCanvas, { GameState } from "@/components/GraphCanvas";

declare global {
  interface Window {
    Telegram?: any;
  }
}

export default function Page() {
  const [isTelegram, setIsTelegram] = useState(false);
  const [initData, setInitData] = useState<string>("");
  const [state, setState] = useState<GameState | null>(null);

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
    const id = setInterval(() => tick(), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <main
      style={{
        padding: 16,
        fontFamily: "system-ui",
        background: "#070b14",
        minHeight: "100vh",
      }}
    >
      {/* адаптивная ширина: на телефоне 100%, на ПК ограничение */}
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ color: "white", fontSize: 28, fontWeight: 800, marginBottom: 14 }}>
          Game
        </div>

        {/* График: сам растягивается на ширину контейнера */}
        <GraphCanvas state={state} height={480} />

        {/* Инфо-блок: на телефоне занимает всю ширину */}
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.12)",
            color: "rgba(255,255,255,0.85)",
          }}
        >
          <div>
            <b>Inside Telegram:</b> {isTelegram ? "YES" : "NO"}
          </div>
          <div style={{ marginTop: 6 }}>
            <b>phase:</b> {state?.phase ?? "-"}
          </div>
          <div>
            <b>percent:</b> {(state?.percent ?? 0).toFixed(2)}%
          </div>

          <div style={{ marginTop: 8, wordBreak: "break-all", opacity: 0.7 }}>
            <b>initData:</b> {initData ? initData : "(empty)"}
          </div>

          <button style={{ marginTop: 12, padding: "10px 14px" }} onClick={tick}>
            Manual tick
          </button>
        </div>
      </div>
    </main>
  );
}
