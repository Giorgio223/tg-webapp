import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

type Phase = "BET" | "PLAY" | "END";

type GameState = {
  roundId: string;
  phase: Phase;
  phaseStartedAt: number;

  // Сервер больше не "рисует" график. Он задаёт конечный результат и параметры.
  endPercent?: number; // итог раунда (зафиксирован в PLAY/END)
  seed?: number;       // для "характера" траектории на клиенте

  betMs: number;
  playMs: number;
  endMs: number;
};

const KEY_STATE = "game:state";
const KEY_HISTORY = "game:history"; // список последних исходов

const BET_MS = 7000;
const PLAY_MS = 12000; // чуть дольше — меньше ощущение "рывка"
const END_MS = 2500;

function newRound(now: number): GameState {
  return {
    roundId: crypto.randomUUID(),
    phase: "BET",
    phaseStartedAt: now,
    betMs: BET_MS,
    playMs: PLAY_MS,
    endMs: END_MS,
  };
}

// Твои шансы (нормализуем, т.к. 40+10+3+50=103):
// 50%: 0..-100
// оставшиеся 50%: 0..50 (40/53), 51..150 (10/53), 150..200 (3/53)
function sampleEndPercent(): number {
  const r = Math.random();

  if (r < 0.5) {
    // вниз до -100
    return -100 + Math.random() * 100; // [-100..0]
  }

  const w1 = 40, w2 = 10, w3 = 3;
  const sum = w1 + w2 + w3; // 53
  const u = Math.random() * sum;

  if (u < w1) return Math.random() * 50;               // 0..50
  if (u < w1 + w2) return 51 + Math.random() * 99;     // 51..150
  return 150 + Math.random() * 50;                     // 150..200
}

export async function POST() {
  try {
    const redis = getRedis();
    const now = Date.now();

    const raw = await redis.get(KEY_STATE);
    let state: GameState = raw ? JSON.parse(raw) : newRound(now);

    const elapsed = now - state.phaseStartedAt;

    if (state.phase === "BET") {
      if (elapsed >= state.betMs) {
        // старт PLAY: выбираем итог и seed
        state = {
          ...state,
          phase: "PLAY",
          phaseStartedAt: now,
          endPercent: sampleEndPercent(),
          seed: Math.floor(Math.random() * 1_000_000_000),
        };
      }
    } else if (state.phase === "PLAY") {
      if (elapsed >= state.playMs) {
        // фиксируем END
        const endPercent = typeof state.endPercent === "number" ? state.endPercent : 0;

        state = {
          ...state,
          phase: "END",
          phaseStartedAt: now,
          endPercent,
        };

        // записываем историю (последние 12)
        await redis.lpush(KEY_HISTORY, JSON.stringify({ t: now, v: endPercent }));
        await redis.ltrim(KEY_HISTORY, 0, 11);
      }
    } else if (state.phase === "END") {
      if (elapsed >= state.endMs) {
        state = newRound(now);
      }
    }

    await redis.set(KEY_STATE, JSON.stringify(state));

    // отдадим историю вместе с tick, чтобы UI мог рисовать
    const histRaw = await redis.lrange(KEY_HISTORY, 0, 11);
    const history = histRaw.map((x) => {
      try { return JSON.parse(x); } catch { return null; }
    }).filter(Boolean);

    return NextResponse.json({ ok: true, state, history });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
