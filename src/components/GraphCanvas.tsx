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

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

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

const smoothstep = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

function phaseFromSeed(seed: number, k: number) {
  const s = (seed * 9301 + 49297 + k * 233280) % 233280;
  return (s / 233280) * Math.PI * 2;
}

function noise(t: number, seed: number) {
  const p1 = phaseFromSeed(seed, 1);
  const p2 = phaseFromSeed(seed, 2);
  const p3 = phaseFromSeed(seed, 3);
  return (
    Math.sin(t * 1.05 + p1) * 0.62 +
    Math.sin(t * 2.10 + p2) * 0.26 +
    Math.sin(t * 4.20 + p3) * 0.12
  );
}

function punch(t: number, seed: number) {
  const p = phaseFromSeed(seed, 9);
  const x = (t * 0.33 + p) % 1;
  const env = x < 0.06 ? (1 - x / 0.06) : 0;
  const dir = ((seed >> 5) & 1) ? 1 : -1;
  return env * dir;
}

function betValue(nowMs: number, state: GameState) {
  const seed = state.seed ?? 1337;
  const t = nowMs / 1000;
  return clamp(noise(t, seed) * 8.5, -10, 10);
}

function playValue(nowMs: number, state: GameState) {
  const seed = state.seed ?? 1337;
  const end = clamp(state.endPercent ?? 0, -100, 200);

  const t01 = clamp((nowMs - state.phaseStartedAt) / state.playMs, 0, 1);
  const t = (nowMs - state.phaseStartedAt) / 1000;

  const mood = (seed % 1000) / 1000;
  const aggressive = mood < 0.40;

  const mid = 1 - Math.abs(t01 * 2 - 1);
  const ampBase = aggressive ? 55 : 40;
  const amp = ampBase * (0.45 + mid * 0.80);

  const raw = noise(t, seed) * amp;
  const teaseW = smoothstep((t01 - 0.62) / 0.24) * (1 - smoothstep((t01 - 0.93) / 0.07));
  const tease = teaseW * Math.sin(t * 5.0 + phaseFromSeed(seed, 7)) * (aggressive ? 14 : 9);
  const hit = punch(t, seed) * (aggressive ? 18 : 12) * (0.35 + mid * 0.65);

  const noisy = clamp(raw + tease + hit, -100, 200);

  const pull = smoothstep((t01 - 0.78) / 0.22); // мягче в конце
  return clamp((1 - pull) * noisy + pull * end, -100, 200);
}

export default function GraphCanvas({ state, width, height = 480, serverNowBase, clientNowBase }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const historyRef = useRef<Point[]>([]);
  const lastTRef = useRef<number>(0);

  // ✅ сглаженный offset, чтобы не было телепортов на мобиле
  const offsetRef = useRef<number>(0);

  // ✅ камера: чтобы наконечник был ~85% ширины (а не в упор справа)
  const cameraEndXRatio = 0.85;

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
      const kdt = clamp(dt / 16.7, 0.5, 2.2);

      const parent = canvas.parentElement;
      const containerW = parent?.clientWidth ?? 900;
      const cssW = width ?? Math.max(320, Math.min(1400, containerW));
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

      // ✅ targetOffset = serverNowBase - clientNowBase (на момент fetch)
      const targetOffset = serverNowBase - clientNowBase;

      // ✅ плавно тянем offset (чтобы на телефоне не прыгало)
      // скорость изменения ограничиваем
      const maxStep = 25 * kdt; // мс за кадр
      const diff = targetOffset - offsetRef.current;
      offsetRef.current += clamp(diff, -maxStep, maxStep);

      const now = Date.now() + offsetRef.current;

      const phase: Phase = (state?.phase ?? "BET") as Phase;
      const showScale = phase !== "BET";
      scaleAlphaRef.current += ((showScale ? 1 : 0) - scaleAlphaRef.current) * (0.10 * kdt);

      let vNow = 0;
      if (!state) vNow = 0;
      else if (phase === "BET") vNow = betValue(now, state);
      else if (phase === "PLAY") vNow = playValue(now, state);
      else vNow = clamp(state.endPercent ?? 0, -100, 200);

      // ✅ анти-teleport: не пишем если время “назад”
      if (now >= lastTRef.current) {
        historyRef.current.push({ t: now, v: vNow });
        lastTRef.current = now;
      }

      // ✅ если история пустая — добавим 1 точку
      if (historyRef.current.length === 0) {
        historyRef.current.push({ t: now, v: vNow });
        lastTRef.current = now;
      }

      // камера: хотим, чтобы now был на 85% окна
      const windowMs = view.windowMs;
      const windowStart = now - windowMs * cameraEndXRatio;

      // чистим историю по окну (+ запас)
      const cutoff = windowStart - 2000;
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

      // ✅ glow линии (чтобы “нитка” всегда видна)
      ctx.save();
      ctx.shadowColor = lineColor;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = lineColor;

      const hist = historyRef.current;
      ctx.beginPath();
      for (let i = 0; i < hist.length; i++) {
        const p = hist[i];
        const x = plotL + ((p.t - windowStart) / windowMs) * plotW;
        const y = plotT + plotH / 2 - warpPercent(p.v) * (plotH * 0.46);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      // наконечник координаты
      const xHead = plotL + ((now - windowStart) / windowMs) * plotW;
      const yHead = plotT + plotH / 2 - warpPercent(vNow) * (plotH * 0.46);

      // ✅ большой белый "баллончик" ореол
      ctx.save();
      ctx.globalAlpha = 0.35;
      const halo = ctx.createRadialGradient(xHead, yHead, 2, xHead, yHead, 26);
      halo.addColorStop(0, "rgba(255,255,255,0.95)");
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(xHead, yHead, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ✅ белый блестящий шар
      const g = ctx.createRadialGradient(xHead - 2, yHead - 2, 2, xHead, yHead, 10);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.5, "rgba(248,248,255,0.95)");
      g.addColorStop(1, "rgba(200,200,220,0.25)");

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(xHead, yHead, 6, 0, Math.PI * 2);
      ctx.fill();

      // блик
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(xHead - 2.6, yHead - 2.6, 1.8, 0, Math.PI * 2);
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

      // BET таймер
      if (state && phase === "BET") {
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

      // шкала
      const ticks = [-100, -80, -60, -40, -20, 0, 50, 150, 200];
      ctx.save();
      ctx.globalAlpha = scaleAlphaRef.current;
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
  }, [height, width, view.windowMs, view.padB, view.padL, view.padR, view.padT, state?.roundId, state?.phase, serverNowBase, clientNowBase]);

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
