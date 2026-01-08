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
  serverNowBase: number; // serverNow из /api/state
  clientNowBase: number; // Date.now() в момент fetch
};

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smoothstep = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

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

function warpPercent(p: number) {
  // Важно: работаем в диапазоне [-100..200]
  const x = clamp(p, -100, 200);
  // Лёгкая компрессия, чтобы визуально было похоже на “казино график”
  const k = x >= 0 ? 18 : 22;
  const w = Math.tanh(x / k);
  const gamma = 0.85;
  return Math.sign(w) * Math.pow(Math.abs(w), gamma);
}

// детерминированные фазы от seed
function ph(seed: number, k: number) {
  const s = (seed * 9301 + 49297 + k * 233280) % 233280;
  return (s / 233280) * Math.PI * 2;
}

// живой шум (детерминированный)
function n1(t: number, seed: number) {
  const p1 = ph(seed, 1);
  const p2 = ph(seed, 2);
  const p3 = ph(seed, 3);
  const p4 = ph(seed, 4);
  return (
    Math.sin(t * 0.95 + p1) * 0.55 +
    Math.sin(t * 1.90 + p2) * 0.28 +
    Math.sin(t * 3.70 + p3) * 0.12 +
    Math.sin(t * 6.40 + p4) * 0.05
  );
}

// редкий импульс (как “подшутить”)
function punch(t: number, seed: number) {
  const p = ph(seed, 9);
  const x = (t * 0.33 + p) % 1;
  const env = x < 0.07 ? (1 - x / 0.07) : 0;
  const dir = ((seed >> 5) & 1) ? 1 : -1;
  return env * dir;
}

function valueAt(ms: number, s: GameState) {
  const seed = s.seed ?? 1337;
  const phase = s.phase;
  const tGlobal = ms / 1000;

  if (phase === "END") return clamp(s.endPercent ?? 0, -100, 200);

  if (phase === "BET") {
    // ✅ BET колышется в ±10, без резких прыжков
    const t = (ms - s.phaseStartedAt) / 1000;
    const v = n1(tGlobal, seed) * 8.5;
    // легкое “затухание” в начале BET (чтобы не было скачка после END)
    const w = smoothstep(t / 0.9);
    return clamp(v * w, -10, 10);
  }

  // PLAY
  const end = clamp(s.endPercent ?? 0, -100, 200);
  const t01 = clamp((ms - s.phaseStartedAt) / s.playMs, 0, 1);
  const t = (ms - s.phaseStartedAt) / 1000;

  // “настроение” (агрессия/мягкость) детерминировано от seed
  const mood = (seed % 1000) / 1000;
  const aggressive = mood < 0.45;

  const mid = 1 - Math.abs(t01 * 2 - 1);
  const ampBase = aggressive ? 60 : 42;
  const amp = ampBase * (0.45 + mid * 0.95);

  const raw = n1(tGlobal, seed) * amp;

  const teaseW = smoothstep((t01 - 0.55) / 0.25) * (1 - smoothstep((t01 - 0.93) / 0.07));
  const teaseDir = ((seed >> 7) & 1) ? 1 : -1;
  const tease = teaseW * teaseDir * Math.sin(t * 4.8 + ph(seed, 7)) * (aggressive ? 16 : 11);

  const hit = punch(t, seed) * (aggressive ? 22 : 14) * (0.35 + mid * 0.65);

  const noisy = clamp(raw + tease + hit, -100, 200);

  // ✅ магнит к endPercent ближе к концу (без телепорта)
  const pull = smoothstep((t01 - 0.78) / 0.22);
  return clamp((1 - pull) * noisy + pull * end, -100, 200);
}

export default function GraphCanvas({ state, width, height = 520, serverNowBase, clientNowBase }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ✅ монотонное время (убирает микродёрги iOS)
  const monoStartPerf = useRef<number>(performance.now());
  const monoStartReal = useRef<number>(Date.now());

  // ✅ мягкий offset (serverNow - clientNow)
  const offsetRef = useRef<number>(0);

  // показывать шкалу плавно (BET скрываем)
  const scaleAlpha = useRef<number>(1);

  const view = useMemo(
    () => ({
      padL: 18,
      padR: 90,
      padT: 18,
      padB: 26,
      windowMs: 26000,
      headXRatio: 0.85,
      samples: 260, // ✅ фикс. число точек, нет накопления => нет “столбов”
    }),
    []
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let last = performance.now();
    let raf = 0;

    const frame = () => {
      const nowPerf = performance.now();
      const dt = nowPerf - last;
      last = nowPerf;
      const kdt = clamp(dt / 16.7, 0.6, 2.5);

      // монотонный now
      const monoNow = monoStartReal.current + (performance.now() - monoStartPerf.current);

      // подтяжка offset
      const targetOffset = serverNowBase - clientNowBase;
      const maxStep = 18 * kdt;
      const diff = targetOffset - offsetRef.current;
      offsetRef.current += clamp(diff, -maxStep, maxStep);

      const now = monoNow + offsetRef.current;

      const parent = canvas.parentElement;
      const containerW = parent?.clientWidth ?? 900;
      const cssW = width ?? Math.max(320, Math.min(1500, containerW));
      const cssH = height;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const plotL = view.padL;
      const plotT = view.padT;
      const plotW = Math.max(1, cssW - view.padL - view.padR);
      const plotH = Math.max(1, cssH - view.padT - view.padB);
      const plotR = plotL + plotW;

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, cssW, cssH);

      // рамка
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(plotL, plotT, plotW, plotH);

      // 0 dashed
      const yZero = plotT + plotH / 2;
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.moveTo(plotL, yZero);
      ctx.lineTo(plotR, yZero);
      ctx.stroke();
      ctx.restore();

      if (!state) {
        raf = requestAnimationFrame(frame);
        return;
      }

      const phase = state.phase;
      const vNow = valueAt(now, state);

      // шкала fade (BET скрываем)
      const showScale = phase !== "BET";
      scaleAlpha.current += ((showScale ? 1 : 0) - scaleAlpha.current) * (0.12 * kdt);

      // цвет линии
      let lineColor = "rgba(255, 90, 90, 1)";
      if (vNow > 0) lineColor = "rgba(80, 220, 140, 1)";
      if (vNow > 110) lineColor = "rgba(255, 180, 60, 1)";

      // ✅ камера/окно: наконечник на 85% ширины
      const windowStart = now - view.windowMs * view.headXRatio;

      // ✅ рисуем линию фиксированным числом точек (нет накопления => нет столбов)
      const samples = view.samples;
      const step = view.windowMs / (samples - 1);

      ctx.save();
      ctx.shadowColor = lineColor;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 3.2;

      ctx.beginPath();
      for (let i = 0; i < samples; i++) {
        const tMs = windowStart + i * step;
        const v = valueAt(tMs, state);
        const x = plotL + (i / (samples - 1)) * plotW;
        const y = plotT + plotH / 2 - warpPercent(v) * (plotH * 0.46);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      // наконечник
      const xHead = plotL + ((now - windowStart) / view.windowMs) * plotW;
      const yHead = plotT + plotH / 2 - warpPercent(vNow) * (plotH * 0.46);

      // белый ореол “баллончиком”
      ctx.save();
      ctx.globalAlpha = 0.38;
      const halo = ctx.createRadialGradient(xHead, yHead, 2, xHead, yHead, 28);
      halo.addColorStop(0, "rgba(255,255,255,0.98)");
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(xHead, yHead, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // белый шар
      const g = ctx.createRadialGradient(xHead - 2, yHead - 2, 2, xHead, yHead, 10);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.55, "rgba(248,248,255,0.95)");
      g.addColorStop(1, "rgba(200,200,220,0.20)");

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(xHead, yHead, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(xHead - 2.6, yHead - 2.6, 1.8, 0, Math.PI * 2);
      ctx.fill();

      // бейдж % — только не в BET
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

      // BET таймер (7 сек), зел->желт->красн
      if (phase === "BET") {
        const elapsed = now - state.phaseStartedAt;
        const t01 = clamp(elapsed / state.betMs, 0, 1);
        const maxSec = Math.max(1, Math.ceil(state.betMs / 1000));
        const remaining = clamp(Math.ceil((state.betMs - elapsed) / 1000), 0, maxSec);

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

      // шкала (BET скрыта)
      const ticks = [-100, -80, -60, -40, -20, 0, 50, 150, 200];
      ctx.save();
      ctx.globalAlpha = scaleAlpha.current;
      ctx.font = "12px system-ui";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      for (const v of ticks) {
        const y = plotT + plotH / 2 - warpPercent(v) * (plotH * 0.46);
        let c = "rgba(255,255,255,0.65)";
        if (v > 0) c = "rgba(80, 220, 140, 0.9)";
        if (v < 0) c = "rgba(255, 90, 90, 0.9)";
        if (v === 0) c = "rgba(255,255,255,0.75)";

        ctx.fillStyle = c;
        ctx.fillText(`${v}%`, cssW - 12, y);

        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.beginPath();
        ctx.moveTo(plotR, y);
        ctx.lineTo(plotR + 8, y);
        ctx.stroke();
      }
      ctx.restore();

      // подпись фазы
      ctx.font = "12px system-ui";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(phase, plotL, cssH - 10);

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [clientNowBase, serverNowBase, height, width, state?.roundId, state?.phase, view]);

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
