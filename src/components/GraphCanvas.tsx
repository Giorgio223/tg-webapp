"use client";

import React, { useEffect, useMemo, useRef } from "react";

type Phase = "BET" | "PLAY" | "END";

export type GameState = {
  roundId: string;
  phase: Phase;
  phaseStartedAt: number;
  percent: number;
};

type Props = {
  state: GameState | null;
  width?: number;   // если не задано — 100% ширины контейнера
  height?: number;  // px
};

type Point = { t: number; v: number };

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

// Усиливает движение около 0
function warpPercent(p: number) {
  const x = clamp(p, -100, 200);
  const k = x >= 0 ? 18 : 22;
  const w = Math.tanh(x / k);
  const gamma = 0.85;
  return Math.sign(w) * Math.pow(Math.abs(w), gamma); // ~[-1..1]
}

function organicNoise(tMs: number) {
  const t = tMs / 1000;
  return (
    Math.sin(t * 1.7) * 0.55 +
    Math.sin(t * 3.1 + 1.2) * 0.28 +
    Math.sin(t * 6.3 + 0.4) * 0.17
  );
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

export default function GraphCanvas({ state, width, height = 480 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const historyRef = useRef<Point[]>([]);
  const currentRoundRef = useRef<string | null>(null);

  const targetRef = useRef<number>(0);
  const smoothRef = useRef<number>(0);

  const scaleAlphaRef = useRef<number>(1);
  const rafRef = useRef<number | null>(null);

  const view = useMemo(() => {
    return {
      windowMs: 26000,
      padL: 18,
      padR: 86, // чуть больше под шкалу
      padT: 18,
      padB: 26,
    };
  }, []);

  useEffect(() => {
    if (!state) return;

    if (currentRoundRef.current !== state.roundId) {
      currentRoundRef.current = state.roundId;
      targetRef.current = 0;
    }

    targetRef.current = state.percent;
  }, [state]);

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

      // адаптивная ширина:
      // - на телефоне почти вся ширина
      // - на десктопе до 1200px
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
      const plotB = plotT + plotH;

      const k = clamp(dt / 16.7, 0.8, 1.8);
      const alpha = 0.14 * k;
      smoothRef.current = smoothRef.current + (targetRef.current - smoothRef.current) * alpha;

      const phase = state?.phase ?? "BET";

      const wobbleAmp = phase === "BET" ? 1.4 : phase === "PLAY" ? 0.55 : 0.0;
      const vNow = smoothRef.current + organicNoise(Date.now()) * wobbleAmp;

      const now = Date.now();
      historyRef.current.push({ t: now, v: vNow });

      const cutoff = now - view.windowMs;
      while (historyRef.current.length > 2 && historyRef.current[0].t < cutoff) {
        historyRef.current.shift();
      }

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, cssW, cssH);

      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(plotL, plotT, plotW, plotH);

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

      const showScale = phase !== "BET";
      const targetAlpha = showScale ? 1 : 0;
      scaleAlphaRef.current = scaleAlphaRef.current + (targetAlpha - scaleAlphaRef.current) * (0.10 * k);

      let lineColor = "rgba(255, 90, 90, 1)";
      if (vNow > 0) lineColor = "rgba(80, 220, 140, 1)";
      if (vNow > 110) lineColor = "rgba(255, 180, 60, 1)";

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

      const xHead = plotR;
      const yHead = plotT + plotH / 2 - warpPercent(vNow) * (plotH * 0.46);
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(xHead, yHead, 5, 0, Math.PI * 2);
      ctx.fill();

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

      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(bx + 12, by + bh / 2, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.textBaseline = "middle";
      ctx.fillText(badgeText, bx + 22, by + bh / 2);

      // ---- шкала справа: добавлены 50/100/150 и -100/-50/-10 ----
      const ticks = [200, 150, 100, 50, 30, 10, 0, -10, -50, -100];

      const tickItems = ticks
        .map((v) => ({
          v,
          y: plotT + plotH / 2 - warpPercent(v) * (plotH * 0.46),
        }))
        .sort((a, b) => a.y - b.y);

      // если тесно — показываем меньше, но НЕ двигаем y (честно)
      const chosen: { v: number; y: number }[] = [];
      const minGap = 14;

      for (const it of tickItems) {
        if (it.y < plotT + 8 || it.y > plotB - 8) continue;
        const prev = chosen[chosen.length - 1];
        if (!prev || it.y - prev.y >= minGap) chosen.push(it);
      }

      // 0% обязателен
      if (!chosen.some((x) => x.v === 0)) {
        const zero = tickItems.find((x) => x.v === 0);
        if (zero) {
          chosen.push(zero);
          chosen.sort((a, b) => a.y - b.y);
        }
      }

      ctx.save();
      ctx.globalAlpha = scaleAlphaRef.current;
      ctx.font = "12px system-ui";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      for (const it of chosen) {
        let col = "rgba(255,255,255,0.65)";
        if (it.v > 0) col = "rgba(80, 220, 140, 0.9)";
        if (it.v < 0) col = "rgba(255, 90, 90, 0.9)";

        ctx.fillStyle = col;
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
  }, [height, width, view.padB, view.padL, view.padR, view.padT, view.windowMs, state?.phase]);

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
