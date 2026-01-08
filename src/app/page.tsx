"use client";

import { useEffect, useMemo, useState } from "react";
import GraphCanvas, { GameState } from "@/components/GraphCanvas";

declare global {
  interface Window {
    Telegram?: any;
  }
}

type HistItem = { t: number; v: number };

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const calc = () => setM(window.innerWidth < 560);
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return m;
}

export default function Page() {
  const [isTelegram, setIsTelegram] = useState(false);
  const [state, setState] = useState<GameState | null>(null);
  const [history, setHistory] = useState<HistItem[]>([]);

  // ✅ для идеальной синхры времени
  const [serverNowBase, setServerNowBase] = useState<number>(Date.now());
  const [clientNowBase, setClientNowBase] = useState<number>(Date.now());

  const [balance] = useState<number>(0);

  const isMobile = useIsMobile();
  const graphHeight = useMemo(() => (isMobile ? 360 : 460), [isMobile]);

  async function refresh() {
    const clientNow = Date.now();
    const r = await fetch("/api/state", { cache: "no-store" });
    const j = await r.json();
    if (j.ok) {
      setState(j.state);
      setHistory(j.history ?? []);

      // ✅ фиксируем пару (serverNow, clientNow) в момент получения
      setServerNowBase(j.serverNow ?? clientNow);
      setClientNowBase(clientNow);
    }
  }

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      setIsTelegram(true);
      tg.ready();
      tg.expand();
    }

    refresh();
    const id = setInterval(() => refresh(), 500);
    return () => clearInterval(id);
  }, []);

  function onUp() {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
  }
  function onDown() {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
  }
  function onInsurance() {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
  }

  return (
    <main style={{ background: "#070b14", minHeight: "100vh", paddingBottom: 90 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? 12 : 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ color: "white", fontSize: 28, fontWeight: 900 }}>Game</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={topBtn()} onClick={() => console.log("deposit")}>Пополнение</button>
            <div style={pill()}>
              Баланс: <b style={{ marginLeft: 6 }}>{balance.toFixed(2)}</b>
            </div>
            <button style={topBtn()} onClick={() => console.log("bonus")}>Бонус</button>
          </div>
        </div>

        <div style={card()}>
          <GraphCanvas
            state={state}
            height={graphHeight}
            serverNowBase={serverNowBase}
            clientNowBase={clientNowBase}
          />

          {/* История: новые слева (newest-first) */}
          <div style={{ marginTop: 12, display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {history.map((h, idx) => {
              const v = Number(h.v);
              const bg = v >= 0 ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)";
              const bd = v >= 0 ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)";
              const col = v >= 0 ? "rgba(80,220,140,0.95)" : "rgba(255,90,90,0.95)";
              return (
                <div
                  key={idx}
                  style={{
                    minWidth: 72,
                    padding: "8px 10px",
                    borderRadius: 12,
                    background: bg,
                    border: `1px solid ${bd}`,
                    color: col,
                    fontWeight: 900,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                  }}
                >
                  {v.toFixed(0)}%
                </div>
              );
            })}
            {history.length === 0 && (
              <div style={{ color: "rgba(255,255,255,0.55)" }}>
                История появится после первых завершённых раундов
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 10, color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
          inside telegram: {isTelegram ? "YES" : "NO"} · phase: {state?.phase ?? "-"} · end: {typeof state?.endPercent === "number" ? `${state.endPercent.toFixed(0)}%` : "-"}
        </div>
      </div>

      <div style={bottomBar()}>
        <button onClick={onDown} style={btnDown()}>Down</button>
        <button onClick={onUp} style={btnUp()}>Up</button>
        <button onClick={onInsurance} style={btnIns()}>Insurance</button>
      </div>
    </main>
  );
}

function card(): React.CSSProperties {
  return {
    borderRadius: 18,
    padding: 14,
    background: "rgba(12,16,28,0.85)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
  };
}

function topBtn(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.92)",
    fontWeight: 900,
    cursor: "pointer",
  };
}

function pill(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.90)",
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
  };
}

function bottomBar(): React.CSSProperties {
  return {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 10,
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 10,
    background: "rgba(8,10,18,0.75)",
    borderTop: "1px solid rgba(255,255,255,0.10)",
    backdropFilter: "blur(10px)",
    zIndex: 50,
  };
}

function btnDown(): React.CSSProperties {
  return {
    height: 56,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(239,68,68,0.75)",
    color: "white",
    fontWeight: 1000,
    cursor: "pointer",
  };
}
function btnUp(): React.CSSProperties {
  return {
    height: 56,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(34,197,94,0.70)",
    color: "#071018",
    fontWeight: 1000,
    cursor: "pointer",
  };
}
function btnIns(): React.CSSProperties {
  return {
    height: 56,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(168,85,247,0.70)",
    color: "#071018",
    fontWeight: 1000,
    cursor: "pointer",
  };
}
