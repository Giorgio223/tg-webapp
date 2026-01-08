"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import GraphCanvas, { GameState } from "@/components/GraphCanvas";

type ApiResp =
  | { ok: true; state: GameState; history: { t: number; v: number }[]; serverNow: number }
  | { ok: false; error: string };

export default function Page() {
  const [state, setState] = useState<GameState | null>(null);
  const [history, setHistory] = useState<{ t: number; v: number }[]>([]);
  const [serverNowBase, setServerNowBase] = useState<number>(Date.now());
  const [clientNowBase, setClientNowBase] = useState<number>(Date.now());
  const [balance] = useState<number>(0);

  const fetchingRef = useRef(false);

  const isTelegram = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    return Boolean(w?.Telegram?.WebApp);
  }, []);

  const initData = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    return w?.Telegram?.WebApp?.initData || "";
  }, []);

  async function fetchState() {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    const clientNow = Date.now();

    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const data = (await res.json()) as ApiResp;

      if (data.ok) {
        setState(data.state);
        setHistory(Array.isArray(data.history) ? data.history : []);
        setServerNowBase(data.serverNow);
        setClientNowBase(clientNow);
      } else {
        console.error("API error:", data.error);
      }
    } catch (e) {
      console.error("Fetch error:", e);
    } finally {
      fetchingRef.current = false;
    }
  }

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const historyNewestFirst = history;

  return (
    <div style={{ minHeight: "100vh", background: "#070c14", color: "rgba(255,255,255,0.92)", padding: "18px 18px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: 0.2 }}>Game</div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button style={topBtnStyle} onClick={() => alert("Пополнение (заглушка)")}>Пополнение</button>
          <div style={{ ...topBtnStyle, cursor: "default" }}>Баланс: {balance.toFixed(2)}</div>
          <button style={topBtnStyle} onClick={() => alert("Бонус (заглушка)")}>Бонус</button>
        </div>
      </div>

      {/* Card */}
      <div
        style={{
          borderRadius: 22,
          background: "radial-gradient(1200px 600px at 30% 10%, rgba(34,65,120,0.22), rgba(0,0,0,0))",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 20px 70px rgba(0,0,0,0.45)",
          padding: 18,
        }}
      >
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 14, opacity: 0.75 }}>
            Inside Telegram: <b>{isTelegram ? "YES" : "NO"}</b>
          </div>
          <div style={{ fontSize: 14, opacity: 0.75 }}>
            initData: <span style={{ opacity: 0.6 }}>{initData ? "(present)" : "(empty)"}</span>
          </div>
        </div>

        <div style={{ borderRadius: 18, overflow: "hidden" }}>
          <GraphCanvas state={state} height={520} serverNowBase={serverNowBase} clientNowBase={clientNowBase} />
        </div>

        {/* History */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 10 }}>История (последние 8)</div>

          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6, scrollbarWidth: "thin" }}>
            {historyNewestFirst.length === 0 ? (
              <div style={{ opacity: 0.6, fontSize: 13 }}>Пока пусто…</div>
            ) : (
              historyNewestFirst.map((h, idx) => {
                const v = Number(h.v);
                const isUp = v >= 0;

                const bg = isUp ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)";
                const bd = isUp ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)";
                const col = isUp ? "rgba(80,220,140,0.95)" : "rgba(255,90,90,0.95)";

                const tri = isUp
                  ? "polygon(50% 0%, 0% 100%, 100% 100%)" // ▲
                  : "polygon(0% 0%, 100% 0%, 50% 100%)"; // ▼

                return (
                  <div
                    key={`${h.t}-${idx}`}
                    style={{
                      minWidth: 86,
                      padding: "10px 12px 9px",
                      borderRadius: 14,
                      background: bg,
                      border: `1px solid ${bd}`,
                      color: col,
                      fontWeight: 1000,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      position: "relative",
                      letterSpacing: 0.2,
                    }}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        background: "rgba(255,255,255,0.92)",
                        clipPath: tri,
                        position: "absolute",
                        left: "50%",
                        transform: "translateX(-50%)",
                        top: 6,
                        opacity: 0.95,
                      }}
                    />
                    <div style={{ paddingTop: 8 }}>{v.toFixed(0)}%</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        <button
          style={{ ...actionBtnStyle, background: "rgba(220,38,38,0.70)", border: "1px solid rgba(255,255,255,0.10)" }}
          onClick={() => alert("Down (заглушка)")}
        >
          Down
        </button>

        <button
          style={{
            ...actionBtnStyle,
            background: "rgba(22,163,74,0.72)",
            border: "1px solid rgba(255,255,255,0.10)",
            color: "rgba(0,0,0,0.85)",
            fontWeight: 900,
          }}
          onClick={() => alert("Up (заглушка)")}
        >
          Up
        </button>

        <button
          style={{ ...actionBtnStyle, background: "rgba(124,58,237,0.70)", border: "1px solid rgba(255,255,255,0.10)" }}
          onClick={() => alert("Insurance (заглушка)")}
        >
          Insurance
        </button>
      </div>
    </div>
  );
}

const topBtnStyle: React.CSSProperties = {
  padding: "12px 18px",
  borderRadius: 14,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.10)",
  color: "rgba(255,255,255,0.92)",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 10px 30px rgba(0,0,0,0.30)",
  backdropFilter: "blur(8px)",
};

const actionBtnStyle: React.CSSProperties = {
  height: 86,
  borderRadius: 18,
  fontSize: 18,
  fontWeight: 900,
  color: "rgba(255,255,255,0.95)",
  boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
  cursor: "pointer",
};
