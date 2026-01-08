"use client";

import { useEffect, useMemo, useState } from "react";
import GraphCanvas, { GameState } from "@/components/GraphCanvas";

declare global {
  interface Window {
    Telegram?: any;
  }
}

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
  const [initData, setInitData] = useState<string>("");
  const [state, setState] = useState<GameState | null>(null);

  const [balance, setBalance] = useState<number>(0); // пока мок, подключим позже
  const [showDeposit, setShowDeposit] = useState(false);
  const [showBonus, setShowBonus] = useState(false);

  const isMobile = useIsMobile();

  const graphHeight = useMemo(() => {
    // адаптивно: на телефоне меньше, на десктопе больше
    return isMobile ? 380 : 460;
  }, [isMobile]);

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

  function onUp() {
    // позже: отправка ставки UP на сервер
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
    console.log("UP");
  }
  function onDown() {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
    console.log("DOWN");
  }
  function onInsurance() {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
    console.log("INSURANCE");
  }

  return (
    <main
      style={{
        padding: isMobile ? 12 : 16,
        fontFamily: "system-ui",
        background: "#070b14",
        minHeight: "100vh",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* TOP BAR */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <div style={{ color: "white", fontSize: 26, fontWeight: 900 }}>
            Game
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => setShowDeposit(true)}
              style={topBtnStyle()}
            >
              Пополнение
            </button>

            <div style={pillStyle()}>
              Баланс: <b style={{ marginLeft: 6 }}>{balance.toFixed(2)}</b>
            </div>

            <button
              onClick={() => setShowBonus(true)}
              style={topBtnStyle()}
            >
              Бонус
            </button>
          </div>
        </div>

        {/* GRAPH */}
        <GraphCanvas state={state} height={graphHeight} />

        {/* ACTION BUTTONS */}
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
            gap: 10,
          }}
        >
          <button onClick={onDown} style={actionBtnStyle("red")}>
            Down
          </button>
          <button onClick={onUp} style={actionBtnStyle("green")}>
            Up
          </button>
          <button onClick={onInsurance} style={actionBtnStyle("blue")}>
            Insurance
          </button>
        </div>

        {/* DEBUG (потом уберём) */}
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.12)",
            color: "rgba(255,255,255,0.85)",
            fontSize: 13,
          }}
        >
          <div><b>Inside Telegram:</b> {isTelegram ? "YES" : "NO"}</div>
          <div style={{ marginTop: 6 }}><b>phase:</b> {state?.phase ?? "-"}</div>
          <div><b>server percent:</b> {(state?.percent ?? 0).toFixed(2)}%</div>
          <div style={{ marginTop: 8, wordBreak: "break-all", opacity: 0.7 }}>
            <b>initData:</b> {initData ? initData : "(empty)"}
          </div>

          <button style={{ marginTop: 10, padding: "10px 14px" }} onClick={tick}>
            Manual tick
          </button>
        </div>
      </div>

      {/* DEPOSIT MODAL (пока заглушка, логику перенесём из твоего html) */}
      {showDeposit && (
        <Modal title="Пополнение" onClose={() => setShowDeposit(false)}>
          <div style={{ opacity: 0.85, marginBottom: 10 }}>
            Здесь подключим схему пополнения (перенесём из твоего проекта). :contentReference[oaicite:1]{index=1}
          </div>
          <button style={topBtnStyle()} onClick={() => setShowDeposit(false)}>
            Закрыть
          </button>
        </Modal>
      )}

      {/* BONUS MODAL */}
      {showBonus && (
        <Modal title="Бонус" onClose={() => setShowBonus(false)}>
          <div style={{ opacity: 0.85, marginBottom: 10 }}>
            Тут будет логика бонусов.
          </div>
          <button style={topBtnStyle()} onClick={() => setShowBonus(false)}>
            Закрыть
          </button>
        </Modal>
      )}
    </main>
  );
}

function topBtnStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.92)",
    fontWeight: 800,
    cursor: "pointer",
  };
}

function pillStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.90)",
    fontWeight: 800,
    display: "flex",
    alignItems: "center",
  };
}

function actionBtnStyle(kind: "red" | "green" | "blue"): React.CSSProperties {
  const base: React.CSSProperties = {
    height: 54,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    color: "white",
    fontWeight: 900,
    letterSpacing: 0.2,
    cursor: "pointer",
  };

  if (kind === "red") return { ...base, background: "rgba(225,29,72,0.85)" };
  if (kind === "green") return { ...base, background: "rgba(34,197,94,0.75)", color: "#0b1220" };
  return { ...base, background: "rgba(56,189,248,0.75)", color: "#0b1220" };
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 12,
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: "min(720px, 96vw)",
          borderRadius: "18px 18px 12px 12px",
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(14,18,30,0.96)",
          color: "rgba(255,255,255,0.92)",
          padding: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
          <button onClick={onClose} style={topBtnStyle()}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
