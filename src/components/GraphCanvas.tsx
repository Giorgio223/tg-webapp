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
  width?: number;
  height?: number;
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

// RNG
function makeRng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function GraphCanvas({ state, width, height = 480 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const historyRef = useRef<Point[]>([]);
  const currentRoundRef = useRef<string | null>(null);

  const rafRef = useRef<number | null>(null);
  const scaleAlphaRef = useRef<number>(1);

  // random walk state (переживает смены фаз, чтобы не было рывков)
  const walkRef = useRef<{
    seed: number;
    lastMs: number;
    v: number;
    vel: number;
    rng: () => number;
    // "характер" текущего раунда
    aggressive: boolean;
    // сглаженное значение (для отрисовки без резких ступеней)
    smoothV: number;
  } | null>(null);

  // запоминаем последнюю фазу для мягких переходов
  const prevPhaseRef = useRef<Phase>("BET");

  const view = useMemo(() => {
    return {
      windowMs: 26000,
      padL: 18,
      padR: 90,
      padT: 18,
      padB: 26,
    };
  }, []);

  useEffect(() => {
    if (!state) return;

    // новый раунд: обновим seed/характер, но НЕ сбрасываем v в ноль — берём текущую точку
    if (currentRoundRef.current !== state.roundId) {
      currentRoundRef.current = state.roundId;

      const seed = state.seed ?? Math.floor(Math.random() * 1_000_000_000);
      const rng = makeRng(seed);
      const aggressive = rng() < 0.40; // 40% раундов более резкие, но не “стена”

      const now = Date.now();
      const prev = walkRef.current;

      walkRef.current = {
        seed,
        lastMs: now,
        v: prev?.v ?? 0,
        vel: prev?.vel ?? 0,
        rng,
        aggressive,
        smoothV: prev?.smoothV ?? (prev?.v ?? 0),
      };
    }
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

      const phase: Phase = (state?.phase ?? "BET") as Phase;
      const seed = state?.seed ?? 1337;
      const end = typeof state?.endPercent === "number" ? state!.endPercent! : 0;
      const playMs = state?.playMs ?? 12000;
      const betMs = state?.betMs ?? 7000;
      const phaseStartedAt = state?.phaseStartedAt ?? Date.now();

      // шкала: скрыта в BET
      const showScale = phase !== "BET";
      const k = clamp(dt / 16.7, 0.8, 1.8);
      scaleAlphaRef.current = scaleAlphaRef.current + ((showScale ? 1 : 0) - scaleAlphaRef.current) * (0.10 * k);

      const now = Date.now();

      // walk init safeguard
      if (!walkRef.current) {
        const rng = makeRng(seed);
        walkRef.current = {
          seed,
          lastMs: now,
          v: 0,
          vel: 0,
          rng,
          aggressive: rng() < 0.40,
          smoothV: 0,
        };
      }

      const walk = walkRef.current;
      const rng = walk.rng;

      // ----------------------------
      // ЖИВОЙ ГРАФИК С МЯГКОСТЬЮ + МИКС
      // ----------------------------
      let vNow = walk.v;

      const step = clamp((now - walk.lastMs) / 16.7, 0.5, 2.5);
      walk.lastMs = now;

      if (phase === "BET") {
        // BET: колыбель от текущей точки + мягкий возврат к 0 (без рывка)
        // сила возврата
        const pullToZero = 0.015 * step; // очень мягко
        walk.v = walk.v + (0 - walk.v) * pullToZero;

        // лёгкий шум вокруг текущего v
        const noise = (rng() - 0.5) * 0.9; // меньше резкости
        walk.vel += noise * 0.08 * step;

        // ограничение скорости (BET очень спокойный)
        walk.vel = clamp(walk.vel, -0.9, 0.9);
        walk.v += walk.vel * 0.55 * step;

        // держим BET возле центра (но не в точке 0)
        walk.v = clamp(walk.v, -18, 18);

        vNow = walk.v;
      } else if (phase === "PLAY") {
        const t01 = clamp((now - phaseStartedAt) / playMs, 0, 1);

        // "характер": иногда спокойнее, иногда резче
        const aggressive = walk.aggressive;

        // базовая плавность: добавим трение (снимает резкость)
        const friction = aggressive ? 0.88 : 0.92;
        walk.vel *= Math.pow(friction, step);

        // дрейф направления (мягче чем раньше)
        const drift = (rng() - 0.5) * (aggressive ? 0.75 : 0.45);
        walk.vel += drift * 0.12 * step;

        // редкие “повороты” но без стены
        if (rng() < (aggressive ? 0.012 : 0.006)) {
          walk.vel *= -0.75;
          walk.v += (rng() - 0.5) * (aggressive ? 10 : 6);
        }

        // обновляем v
        const velMax = aggressive ? 2.2 : 1.6;
        walk.vel = clamp(walk.vel, -velMax, velMax);
        walk.v += walk.vel * (aggressive ? 1.25 : 0.95) * step;

        // мягкие границы
        const minV = -100;
        const maxV = 200;
        if (walk.v < minV) {
          walk.v = minV + (minV - walk.v) * 0.22;
          walk.vel *= -0.45;
        }
        if (walk.v > maxV) {
          walk.v = maxV - (walk.v - maxV) * 0.22;
          walk.vel *= -0.45;
        }

        // ---- МАГНИТ К КОНЦУ (позже и мягче, чтобы не "улетал сразу") ----
        // старт притяжения позже: 0.78
        const pullStart = 0.78;
        const pullT = clamp((t01 - pullStart) / (1 - pullStart), 0, 1);

        // плавный рост, без скачка
        const pull = pullT * pullT * (2.2 + pullT * 5.5);

        walk.v = walk.v + (end - walk.v) * (pull * 0.020);
        walk.vel *= (1 - pullT * 0.06);

        // последние 1.5% фиксируем
        if (t01 > 0.985) {
          walk.v = end;
          walk.vel = 0;
        }

        vNow = walk.v;
      } else {
        // END
        walk.v = end;
        walk.vel = 0;
        vNow = end;
      }

      // --------
      // СГЛАЖИВАНИЕ ОТРИСОВКИ (убирает резкие ступени, но сохраняет азарт)
      // --------
      // чем больше dt, тем быстрее догоняет
      const smoothAlpha = clamp(0.10 * k, 0.06, 0.18);
      walk.smoothV = walk.smoothV + (vNow - walk.smoothV) * smoothAlpha;
      vNow = walk.smoothV;

      vNow = clamp(vNow, -100, 200);

      // плавный переход PLAY->BET без "стены" в истории:
      // если фаза изменилась, добавим 2-3 интерполяционные точки
      const prevPhase = prevPhaseRef.current;
      if (prevPhase !== phase) {
        prevPhaseRef.current = phase;

        const lastP = historyRef.current[historyRef.current.length - 1];
        if (lastP) {
          const mid1 = lerp(lastP.v, vNow, 0.35);
          const mid2 = lerp(lastP.v, vNow, 0.70);
          historyRef.current.push({ t: now - 24, v: mid1 });
          historyRef.current.push({ t: now - 12, v: mid2 });
        }
      }

      // история линии
      historyRef.current.push({ t: now, v: vNow });
      const cutoff = now - view.windowMs;
      while (historyRef.current.length > 2 && historyRef.current[0].t < cutoff) {
        historyRef.current.shift();
      }

      // ----------------------------
      // РЕНДЕР
      // ----------------------------
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, cssW, cssH);

      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(plotL, plotT, plotW, plotH);

      // 0% dashed линия
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

      // цвет
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

      // кружок
      const xHead = plotR;
      const yHead = plotT + plotH / 2 - warpPercent(vNow) * (plotH * 0.46);
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(xHead, yHead, 5, 0, Math.PI * 2);
      ctx.fill();

      // бейдж % (только не в BET)
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

        ctx.fillStyle = lineColor;
        ctx.beginPath();
        ctx.arc(bx + 12, by + bh / 2, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeText, bx + 22, by + bh / 2);
      }

      // ---- BET таймер по центру: круг + цифра ----
      if (phase === "BET") {
        const elapsed = now - phaseStartedAt;
        const t01 = clamp(elapsed / betMs, 0, 1);
        const remaining = Math.max(0, Math.ceil((betMs - elapsed) / 1000));

        // цвет: зелёный -> жёлтый -> красный (последние 3 сек)
        let col = "rgba(80, 220, 140, 0.95)";
        if (remaining <= 3) col = "rgba(255, 90, 90, 0.95)";
        else if (t01 > 0.55) col = "rgba(255, 200, 60, 0.95)";

        const cx = plotL + plotW * 0.50;
        const cy = plotT + plotH * 0.50;
        const r = Math.min(plotW, plotH) * 0.10;

        // фон круга
        ctx.save();
        ctx.globalAlpha = 0.70;
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // прогресс дуга (идёт к 0)
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

        // цифра
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = `700 ${Math.max(18, Math.floor(r * 1.0))}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(remaining), cx, cy);
        ctx.restore();
      }

      // шкала справа
      const must = [-100, -50, -10, 0, 10, 50, 100, 150, 200];
      const items = must
        .map((v) => ({ v, y: plotT + plotH / 2 - warpPercent(v) * (plotH * 0.46) }))
        .sort((a, b) => a.y - b.y);

      const chosen: { v: number; y: number }[] = [];
      const minGap = 14;

      for (const it of items) {
        const critical = it.v === -100 || it.v === 0 || it.v === 200;
        const prev = chosen[chosen.length - 1];
        if (!prev) {
          chosen.push(it);
          continue;
        }
        if (it.y - prev.y >= minGap) chosen.push(it);
        else if (critical) chosen[chosen.length - 1] = it;
      }

      ctx.save();
      ctx.globalAlpha = scaleAlphaRef.current;
      ctx.font = "12px system-ui";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      for (const it of chosen) {
        let c = "rgba(255,255,255,0.65)";
        if (it.v > 0) c = "rgba(80, 220, 140, 0.9)";
        if (it.v < 0) c = "rgba(255, 90, 90, 0.9)";

        ctx.fillStyle = c;
        ctx.fillText(`${it.v}%`, cssW - 12, it.y);

        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.beginPath();
        ctx.moveTo(plotR, it.y);
        ctx.lineTo(plotR + 8, it.y);
        ctx.stroke();
      }
      ctx.restore();

      // подпись фазы
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
  }, [height, width, view.padB, view.padL, view.padR, view.padT, view.windowMs, state?.phase, state?.roundId]);

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
