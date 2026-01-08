"use client";

import React, { useEffect, useMemo, useRef } from "react";

type Phase = "BET" | "PLAY" | "END";

export type GameState = {
  roundId: string;
  phase: Phase;
  phaseStartedAt: number;
  endPercent?: number;
  seed: number;
  betMs: number;
  playMs: number;
  endMs: number;
};

export type RoundMeta = {
  roundId: string;
  playStartedAt: number;
  endPercent: number;
  seed: number;
};

type Props = {
  state: GameState | null;
  rounds: RoundMeta[];
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
  const p4 = phaseFromSeed(seed, 4);
  return (
    Math.sin(t * 0.95 + p1) * 0.55 +
    Math.sin(t * 1.90 + p2) * 0.28 +
    Math.sin(t * 3.70 + p3) * 0.12 +
    Math.sin(t * 6.40 + p4) * 0.05
  );
}

function punch(t: number, seed: number) {
  const p = phaseFromSeed(seed, 9);
  const x = (t * 0.33 + p) % 1;
  const env = x < 0.07 ? (1 - x / 0.07) : 0;
  const dir = ((seed >> 5) & 1) ? 1 : -1;
  return env * dir;
}

function betPure(nowMs: number, seed: number) {
  const t = nowMs / 1000;
  return clamp(noise(t, seed) * 8.5, -10, 10);
}

function playValueAt(nowMs: number, playStartedAt: number, playMs: number, seed: number, endPercent: number) {
  const end = clamp(endPercent, -100, 200);
  const t01 = clamp((nowMs - playStartedAt) / playMs, 0, 1);
  const t = (nowMs - playStartedAt) / 1000;

  const mood = (seed % 1000) / 1000;
  const aggressive = mood < 0.45;

  const mid = 1 - Math.abs(t01 * 2 - 1);
  const ampBase = aggressive ? 60 : 42;
  const amp = ampBase * (0.45 + mid * 0.90);

  const raw = noise(t, seed) * amp;

  const teaseW = smoothstep((t01 - 0.55) / 0.25) * (1 - smoothstep((t01 - 0.93) / 0.07));
  const teaseDir = ((seed >> 7) & 1) ? 1 : -1;
  const tease = teaseW * teaseDir * Math.sin(t * 4.8 + phaseFromSeed(seed, 7)) * (aggressive ? 16 : 11);

  const hit = punch(t, seed) * (aggressive ? 22 : 14) * (0.35 + mid * 0.65);

  const noisy = clamp(raw + tease + hit, -100, 200);

  const pull = smoothstep((t01 - 0.78) / 0.22);
  return clamp((1 - pull) * noisy + pull * end, -100, 200);
}

export default function GraphCanvas({ state, rounds, width, height = 520, serverNowBase, clientNowBase }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const historyRef = useRef<Point[]>([]);
  const lastTRef = useRef<number>(0);

  // монотонное время
  const monoStartPerfRef = useRef<number>(performance.now());
  const monoStartRealRef = useRef<number>(Date.now());

  // offset сглаженный
  const offsetRef = useRef<number>(0);

  // камера
  const cameraEndXRatio = 0.85;

  // шкала плавно
  const scaleAlphaRef = useRef<number>(1);

  // ✅ slew-rate (ограничение скорости, убирает “стенки”)
  const smoothVRef = useRef<number>(0);

  // ✅ soft landing в BET (НЕ зависит от phaseStartedAt)
  const phaseRef = useRef<Phase>("BET");
  const betLandingRef = useRef<{ active: boolean; startMs: number; startV: number; durMs: number }>({
    active: false,
    startMs: 0,
    startV: 0,
    durMs: 2200,
  });

  // ✅ чтобы один раз предзаполнить путь прошлыми раундами
  const prefillDoneRef = useRef(false);

  const view = useMemo(() => ({ windowMs: 26000, padL: 18, padR: 90, padT: 18, padB: 26 }), []);

  useEffect(() => {
    // ✅ предзаполнение прошлыми раундами, чтобы новый юзер видел “как было”
    if (prefillDoneRef.current) return;
    if (!rounds || rounds.length === 0) return;

    // рисуем от старых к новым
    const ordered = [...rounds].reverse();
    const pts: Point[] = [];
    const stepMs = 140; // достаточно гладко

    for (const r of ordered) {
      const start = r.playStartedAt;
      const end = r.playStartedAt + 15000;

      for (let t = start; t <= end; t += stepMs) {
        const v = playValueAt(t, start, 15000, r.seed, r.endPercent);
        pts.push({ t, v });
      }
    }

    if (pts.length) {
      historyRef.current = pts;
      lastTRef.current = pts[pts.length - 1].t;
      smoothVRef.current = pts[pts.length - 1].v;
      prefillDoneRef.current = true;
    }
  }, [rounds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let last = performance.now();

    const draw = () => {
      const ts = performance.now();
      const dt = ts - last;
      last = ts;
      const kdt = clamp(dt / 16.7, 0.5, 2.2);

      const monoNow = monoStartRealRef.current + (performance.now() - monoStartPerfRef.current);
      const targetOffset = serverNowBase - clientNowBase;

      // мягкая подтяжка offset
      const maxStep = 16 * kdt;
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

      const phase: Phase = (state?.phase ?? "BET") as Phase;

      // переход в BET — включаем soft landing
      if (phaseRef.current !== phase) {
        if (phase === "BET") {
          betLandingRef.current = {
            active: true,
            startMs: now,
            startV: smoothVRef.current,
            durMs: 2200,
          };
        }
        phaseRef.current = phase;
      }

      const showScale = phase !== "BET";
      scaleAlphaRef.current += ((showScale ? 1 : 0) - scaleAlphaRef.current) * (0.10 * kdt);

      // сырой v
      let vRaw = 0;

      if (!state) {
        vRaw = 0;
      } else if (phase === "BET") {
        const target = betPure(now, state.seed);

        if (betLandingRef.current.active) {
          const t01 = clamp((now - betLandingRef.current.startMs) / betLandingRef.current.durMs, 0, 1);
          const w = smoothstep(t01);
          vRaw = (1 - w) * betLandingRef.current.startV + w * target;
          if (t01 >= 1) betLandingRef.current.active = false;
        } else {
          vRaw = target;
        }
      } else if (phase === "PLAY") {
        const endP = typeof state.endPercent === "number" ? state.endPercent : 0;
        vRaw = playValueAt(now, state.phaseStartedAt, state.playMs, state.seed, endP);
      } else {
        vRaw = clamp(state.endPercent ?? 0, -100, 200);
      }

      // ✅ ограничение скорости (убирает “стенки/телепорты”)
      const maxPerSecBase = phase === "PLAY" ? 140 : 55; // %/sec
      // ближе к концу PLAY — разрешаем быстрее, чтобы точно попасть в endPercent
      let extra = 0;
      if (phase === "PLAY" && state) {
        const t01 = clamp((now - state.phaseStartedAt) / state.playMs, 0, 1);
        extra = smoothstep((t01 - 0.78) / 0.22) * 220; // ускорение к финалу
      }
      const maxStepV = ((maxPerSecBase + extra) * dt) / 1000;
      const dv = vRaw - smoothVRef.current;
      smoothVRef.current += clamp(dv, -maxStepV, maxStepV);

      const vNow = clamp(smoothVRef.current, -100, 200);

      // пушим в историю
      if (now >= lastTRef.current) {
        historyRef.current.push({ t: now, v: vNow });
        lastTRef.current = now;
      }

      // окно камеры
      const windowMs = view.windowMs;
      const windowStart = now - windowMs * cameraEndXRatio;

      // чистка
      const cutoff = windowStart - 2500;
      while (historyRef.current.length > 2 && historyRef.current[0].t < cutoff) historyRef.current.shift();

      // рисование фона
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, cssW, cssH);

      // рамка
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(plotL, plotT, plotW, plotH);

      // 0%
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

      const hist = historyRef.current;

      // линия + glow
      ctx.save();
      ctx.shadowColor = lineColor;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = lineColor;

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

      // наконечник
      const xHead = plotL + ((now - windowStart) / windowMs) * plotW;
      const yHead = plotT + plotH / 2 - warpPercent(vNow) * (plotH * 0.46);

      // ореол
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

      // шар
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

      requestAnimationFrame(draw);
    };

    requestAnimationFrame(draw);
  }, [height, width, state?.roundId, state?.phase, serverNowBase, clientNowBase, rounds, view]);

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
