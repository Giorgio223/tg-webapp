import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { randomUUID } from "crypto";

const KEY = "game:state";

// длительности фаз (мс)
const BET_MS = 8000;
const PLAY_MS = 20000;
const END_MS = 3000;

type Phase = "BET" | "PLAY" | "END";

type State = {
  roundId: string;
  phase: Phase;
  phaseStartedAt: number;
  percent: number;
};

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function now() {
  return Date.now();
}

function newRound(): State {
  return {
    roundId: randomUUID(),
    phase: "BET",
    phaseStartedAt: now(),
    percent: 0,
  };
}

export async function POST() {
  const redis = getRedis();
  const raw = await redis.get(KEY);
  const state: State = raw ? JSON.parse(raw) : newRound();

  const t = now() - state.phaseStartedAt;

  // переходы фаз
  if (state.phase === "BET" && t >= BET_MS) {
    state.phase = "PLAY";
    state.phaseStartedAt = now();
    state.percent = 0; // PLAY всегда стартует с 0%
  } else if (state.phase === "PLAY" && t >= PLAY_MS) {
    state.phase = "END";
    state.phaseStartedAt = now();
  } else if (state.phase === "END" && t >= END_MS) {
    const nr = newRound();
    await redis.set(KEY, JSON.stringify(nr));
    return NextResponse.json({ ok: true, state: nr });
  }

  // обновление процента
  if (state.phase === "BET") {
    // "колыбель" вокруг 0
    const wobble = (Math.random() - 0.5) * 6; // ±3
    state.percent = clamp(wobble, -12, 12);
  } else if (state.phase === "PLAY") {
    // движение (можно потом заменить на твою модель)
    const step = (Math.random() - 0.45) * 8;
    state.percent = clamp(state.percent + step, -60, 200);
  } else {
    // END — фиксируем
  }

  await redis.set(KEY, JSON.stringify(state));
  return NextResponse.json({ ok: true, state });
}
