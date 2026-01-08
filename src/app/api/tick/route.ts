import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

type Phase = "BET" | "PLAY" | "END";

type GameState = {
  roundId: string;
  phase: Phase;
  phaseStartedAt: number;
  percent: number;

  // цель на раунд (выбираем при старте PLAY)
  endPercent?: number;
  betMs?: number;
  playMs?: number;
  endMs?: number;
};

const KEY = "game:state";

// Длительности фаз (можешь менять)
const BET_MS = 7000;
const PLAY_MS = 9000;
const END_MS = 2500;

function easeOutQuint(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 5);
}

// Твоя схема вероятностей:
// - 50%: отрицательный исход 0..-100
// - 40%: 0..50
// - 10%: 51..150
// - 3% : 150..200
//
// Так как сумма = 103%, делаем корректно:
// 50% отрицательный
// оставшиеся 50% делим пропорционально (40/53, 10/53, 3/53)
function sampleEndPercent(): number {
  const r = Math.random();

  // 50% шанс уйти вниз до -100%
  if (r < 0.5) {
    // равномерно от -100 до 0 (не включая 0 можно, но не критично)
    return -100 + Math.random() * 100;
  }

  // позитивная ветка (50%), внутри — пропорции 40/10/3
  const w1 = 40;
  const w2 = 10;
  const w3 = 3;
  const sum = w1 + w2 + w3; // 53

  const u = Math.random() * sum;

  if (u < w1) {
    // 0..50
    return Math.random() * 50;
  }
  if (u < w1 + w2) {
    // 51..150
    return 51 + Math.random() * (150 - 51);
  }
  // 150..200
  return 150 + Math.random() * (200 - 150);
}

function newRoundState(now: number): GameState {
  return {
    roundId: crypto.randomUUID(),
    phase: "BET",
    phaseStartedAt: now,
    percent: 0,
    betMs: BET_MS,
    playMs: PLAY_MS,
    endMs: END_MS,
  };
}

export async function POST() {
  try {
    const redis = getRedis();

    const now = Date.now();
    const raw = await redis.get(KEY);

    let state: GameState = raw ? JSON.parse(raw) : newRoundState(now);

    const betMs = state.betMs ?? BET_MS;
    const playMs = state.playMs ?? PLAY_MS;
    const endMs = state.endMs ?? END_MS;

    const elapsed = now - state.phaseStartedAt;

    if (state.phase === "BET") {
      // В BET проценты "не считаются": всегда 0 на сервере.
      // (визуальная волна у тебя рисуется на клиенте)
      state.percent = 0;

      if (elapsed >= betMs) {
        // старт PLAY: выбираем итог на раунд
        const endPercent = sampleEndPercent();
        state = {
          ...state,
          phase: "PLAY",
          phaseStartedAt: now,
          percent: 0,
          endPercent,
        };
      }
    } else if (state.phase === "PLAY") {
      const endPercent = typeof state.endPercent === "number" ? state.endPercent : sampleEndPercent();

      // плавное движение к цели за PLAY_MS
      const t = Math.min(1, elapsed / playMs);
      state.percent = easeOutQuint(t) * endPercent;

      if (elapsed >= playMs) {
        // фиксируем финал
        state = {
          ...state,
          phase: "END",
          phaseStartedAt: now,
          percent: endPercent,
        };
      }
    } else if (state.phase === "END") {
      // держим финал
      state.percent = state.percent ?? 0;

      if (elapsed >= endMs) {
        // новый раунд
        state = newRoundState(now);
      }
    }

    await redis.set(KEY, JSON.stringify(state));
    return NextResponse.json({ ok: true, state });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
