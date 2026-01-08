"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    Telegram?: any;
  }
}

export default function Page() {
  const [isTelegram, setIsTelegram] = useState(false);
  const [initData, setInitData] = useState<string>("");

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      setIsTelegram(true);
      setInitData(tg.initData || "");
      tg.ready();
      tg.expand();
    }
  }, []);

  const onExpand = () => {
    const tg = window.Telegram?.WebApp;
    tg?.expand();
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Telegram WebApp</h1>

      <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #ccc" }}>
        <div><b>Inside Telegram:</b> {isTelegram ? "YES" : "NO"}</div>
        <div style={{ marginTop: 8, wordBreak: "break-all" }}>
          <b>initData:</b> {initData ? initData : "(empty)"}
        </div>
      </div>

      <button style={{ marginTop: 12, padding: "10px 14px" }} onClick={onExpand}>
        Expand
      </button>

      <p style={{ marginTop: 12, opacity: 0.7 }}>
        Сейчас проверяем, что WebApp API работает. Дальше подключим бота с кнопкой PLAY.
      </p>
    </main>
  );
}
