"use client";

import React, { useEffect, useMemo, useRef } from "react";

type Phase = "BET" | "PLAY" | "END";

export type GameState = {
  roundId: string;
  phase: Phase;
  phaseStartedAt: number;
  endPercent?: number;
  seed?: number;
  betMs: number;
  playMs: number;
  endMs: number;
};

type Props = {
  state: GameState | null;
  height?: number;
  width?: number;
  serverNowBase: number;
  clientNowBase: number;
};

type Point = { t: number; v: number };

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function warpPercent(p: number) {
  const x = clamp(p, -100, 200);
  const k = x >= 0 ? 18 : 22;
  const w = Math.tanh(x / k);
  const gamma = 0.85;
  return Math.sign(w) * Math.pow(Math.abs(w), gamma);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function smoothstep(x: number) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

// детерминированные фазы
function phaseFromSeed(seed: number, k: number) {
  const s = (seed * 9301 + 49297 + k * 233280) % 233280;
  return (s / 233280) * Math.PI * 2;
}

function baseNoise(t: number, seed: number) {
  const p1 = phaseFromSeed(seed, 1);
  const p2 = phaseFromSeed(seed, 2);
  const p3 = phaseFromSeed(seed, 3);
  const p4 = phaseFromSeed(seed, 4);
  return (
    Math.sin(t * 1.05 + p1) * 0.55 +
    Math.sin(t * 2.05 + p2) * 0.28 +
    Math.sin(t * 4.35 + p3) * 0.12 +
    Math.sin(t * 7.10 + p4) * 0.05
  );
}

// редкие "удары" (но детерминированные по seed)
function punch(t: number, seed: number) {
  const p = phaseFromSeed(seed, 9);
  // пилообразная огибающая: короткий "тычок"
  const x = (t * 0.35 + p) % 1; // 0..1
  const env = x < 0.06 ? (1 - x / 0.06) : 0; // быстрый спад
  const dir = ((seed >> 5) & 1) ? 1 : -1;
  return env * dir;
}

// PLAY: “живое” движение (детерминированно) + магнит к end
function playValue(nowMs: number, state: GameState) {
  const seed = state.seed ?? 1337;
  const end = clamp(state.endPercent ?? 0, -100, 200);

  const t01 = clamp((nowMs - state.phaseStartedAt) / state.playMs, 0, 1);
  const t = (nowMs - state.phaseStartedAt) / 1000;

  const mood = (seed % 1000) / 1000;
  const aggressive = mood < 0.40;

  const mid = 1 - Math.abs(t01 * 2 - 1); // 0..1
  const ampBase = aggressive ? 58 : 40;
  const amp = ampBase * (0.40 + mid * 0.85);

  const raw = baseNoise(t, seed) * amp;

  // "пошутить" иногда
  const teaseW = smoothstep((t01 - 0.60) / 0.25) * (1 - smoothstep((t01 - 0.93) / 0.07));
  const tease = teaseW * Math.sin(t * 5.0 + phaseFromSeed(seed, 7)) * (aggressive ? 16 : 10);

  // редкие удары
  const p = punch(t, seed) * (aggressive ? 22 : 14) * (0.35 + mid * 0.65);

  const noisy = clamp(raw + tease + p, -100, 200);

  // магнит в финале (последние 23%)
  const pull = smoothstep((t01 - 0.77) / 0.23);
  const v = (1 - pull) * noisy + pull * end;

  return clamp(v, -100, 200);
}

// BET: только ±10%
function betValue(nowMs: number, state: GameState) {
  const seed = state.seed ?? 1337;
  const t = nowMs / 1000;
  return clamp(baseNoise(t, seed) * 8.5, -10, 10);
}

export default function GraphCanvas({ state, width, height = 480, serverNowBase, clientNowBase }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<Point[]>([]);
  const lastTRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const scaleAlphaRef = useRef<number>(1);

  const view = useMemo(() => ({ windowMs: 26000, padL: 18, padR: 90, padT: 18, padB: 26 }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let last = performance.now();

    const draw = (ts: number) => {
      const dt = ts - last;
      last = ts;

      const parent = canvas.parentElement;
      const containerW = parent?.clientWidth ?? 900;
      const cssW = width ?? Math.max(320, Math.min(1200, containerW));
      const cssH = height;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const plotL = view.padL;
      const plotT = view.padT;
      const plotW = cssW - view.padL - view.padR;
      const plotH = cssH - view.padT - view.padB;
      const plotR = plotL + plotW;

      // ✅ монотонное “серверное” время
      const now = serverNowBase + (Date.now() - clientNowBase);

      const phase: Phase = (state?.phase ?? "BET") as Phase;

      const showScale = phase !== "BET";
      const k = clamp(dt / 16.7, 0.8, 1.8);
      scaleAlphaRef.current = scaleAlphaRef.current + ((showScale ? 1 : 0) - scaleAlphaRef.current) * (0.10 * k);

      let vNow = 0;
      if (!state) vNow = 0;
      else if (phase === "BET") vNow = betValue(now, state);
      else if (phase === "PLAY") vNow = playValue(now, state);
      else vNow = clamp(state.endPercent ?? 0, -100, 200);

      // ✅ защита от телепорта (если вдруг now пошёл назад — не пишем в историю)
      if (now >= lastTRef.current) {
        historyRef.current.push({ t: now, v: vNow });
        lastTRef.current = now;
      }

      const cutoff = now - view.windowMs;
      while (historyRef.current.length > 2 && historyRef.current[0].t < cutoff) historyRef.current.shift();

      // фон
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, cssW, cssH);

      // рамка
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(plotL, plotT, plotW, plotH);

      // 0% dashed
      const yZero = plotT + plotH / 2;
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotL, yZero);
      ctx.lineTo(plotR, yZero);
      ctx.stroke();
      ctx.restore();

      // цвет линии
      let lineColor = "rgba(255, 90, 90, 1)";
      if (vNow > 0) lineColor = "rgba(80, 220, 140, 1)";
      if (vNow > 110) lineColor = "rgba(255, 180, 60, 1)";

      // линия
      const hist = historyRef.current;
      const localCutoff = now - view.windowMs;

      ctx.lineWidth = 2;
      ctx.strokeStyle = lineColor;
      ctx.beginPath();
      for (let i = 0; i < hist.length; i++) {
        const p = hist[i];
        const x = plotL + ((p.t - localCutoff) / view.windowMs) * plotW;
        const y = plotT + plotH / 2 - warpPercent(p.v) * (plotH * 0.46);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // БЕЛЫЙ "БЛЕСТЯЩИЙ" кружок
      const xHead = plotR;
      const yHead = plotT + plotH / 2 - warpPercent(vNow) * (plotH * 0.46);

      const g = ctx.createRadialGradient(xHead - 2, yHead - 2, 2, xHead, yHead, 10);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.45, "rgba(245,245,255,0.95)");
      g.addColorStop(1, "rgba(200,200,220,0.25)");

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(xHead, yHead, 6, 0, Math.PI * 2);
      ctx.fill();

      // маленький блик
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(xHead - 2.5, yHead - 2.5, 1.7, 0, Math.PI * 2);
      ctx.fill();

      // бейдж % — не в BET
      if (phase !== "BET") {
        const badgeText = `${vNow.toFixed(0)}%`;
        ctx.font = "14px system-ui";
        const tw = ctx.measureText(badgeText).width;
        const bx = plotR - tw - 32;
        const by = 10;
        const bw = tw + 26;
        const bh = 30;

        ctx.fillStyle = "rgba(10,10,16,0.55)";
        roundRect(ctx, bx, by, bw, bh, 14);
        ctx.fill();

        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeText, bx + 14, by + bh / 2);
      }

      // BET таймер круг (если вдруг state кривой — remaining всё равно будет 0..7)
      if (state && phase === "BET") {
        const elapsed = now - state.phaseStartedAt;
        const t01 = clamp(elapsed / state.betMs, 0, 1);
        const remaining = clamp(Math.ceil((state.betMs - elapsed) / 1000), 0, Math.ceil(state.betMs / 1000));

        let col = "rgba(80, 220, 140, 0.95)";
        if (remaining <= 3) col = "rgba(255, 90, 90, 0.95)";
        else if (t01 > 0.55) col = "rgba(255, 200, 60, 0.95)";

        const cx = plotL + plotW * 0.50;
        const cy = plotT + plotH * 0.50;
        const r = Math.min(plotW, plotH) * 0.10;

        ctx.save();
        ctx.globalAlpha = 0.70;
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        const start = -Math.PI / 2;
        const endA = start + (1 - t01) * Math.PI * 2;

        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, endA, false);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = `700 ${Math.max(18, Math.floor(r * 1.0))}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(remaining), cx, cy);
        ctx.restore();
      }

      // ✅ НОВАЯ ШКАЛА
      const ticks = [-100, -80, -60, -40, -20, 0, 50, 150, 200];
      const items = ticks
        .map((v) => ({ v, y: plotT + plotH / 2 - warpPercent(v) * (plotH * 0.46) }))
        .sort((a, b) => a.y - b.y);

      ctx.save();
      ctx.globalAlpha = scaleAlphaRef.current;
      ctx.font = "12px system-ui";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      for (const it of items) {
        let c = "rgba(255,255,255,0.65)";
        if (it.v > 0) c = "rgba(80, 220, 140, 0.9)";
        if (it.v < 0) c = "rgba(255, 90, 90, 0.9)";
        if (it.v === 0) c = "rgba(255,255,255,0.75)";

        ctx.fillStyle = c;
        ctx.fillText(`${it.v}%`, cssW - 12, it.y);

        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.beginPath();
        ctx.moveTo(plotR, it.y);
        ctx.lineTo(plotR + 8, it.y);
        ctx.stroke();
      }
      ctx.restore();

      ctx.font = "12px system-ui";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(phase, plotL, cssH - 10);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [height, width, view.padB, view.padL, view.padR, view.padT, view.windowMs, state?.roundId, state?.phase, serverNowBase, clientNowBase]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: width ? `${width}px` : "100%",
        height: `${height}px`,
        borderRadius: 16,
        display: "block",
      }}
    />
  );
}
