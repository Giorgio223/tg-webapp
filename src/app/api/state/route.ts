import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

type Phase = "BET" | "PLAY" | "END";

type GameState = {
  roundId: string;
  phase: Phase;
  phaseStartedAt: number;

  endPercent?: number;
  seed?: number;

  betMs: number;
  playMs: number;
  endMs: number;
};

const KEY_STATE = "game:state";
const KEY_HISTORY = "game:history"; // newest-first (LPUSH)

const BET_MS = 7000;
const PLAY_MS = 12000;
const END_MS = 2500;

function newRound(startAt: number): GameState {
  return {
    roundId: crypto.randomUUID(),
    phase: "BET",
    phaseStartedAt: startAt,
    betMs: BET_MS,
    playMs: PLAY_MS,
    endMs: END_MS,
  };
}

// Твои шансы (нормализуем, т.к. 40+10+3+50=103):
// 50%: -100..0
// оставшиеся 50%: 0..50 (40/53), 51..150 (10/53), 150..200 (3/53)
function sampleEndPercent(): number {
  const r = Math.random();
  if (r < 0.5) return -100 + Math.random() * 100; // [-100..0]

  const w1 = 40, w2 = 10, w3 = 3;
  const sum = w1 + w2 + w3; // 53
  const u = Math.random() * sum;

  if (u < w1) return Math.random() * 50;              // 0..50
  if (u < w1 + w2) return 51 + Math.random() * 99;    // 51..150
  return 150 + Math.random() * 50;                    // 150..200
}

// Главная функция: догоняет состояние по серверному времени.
// ВАЖНО: переходы ставим на момент окончания фазы, а не "now" — так у всех одинаково.
async function ensureState(now: number) {
  const redis = getRedis();
  const raw = await redis.get(KEY_STATE);
  let state: GameState = raw ? JSON.parse(raw) : newRound(now);

  // защитимся от слишком большого "догоняния" одним запросом
  for (let i = 0; i < 50; i++) {
    const betMs = state.betMs ?? BET_MS;
    const playMs = state.playMs ?? PLAY_MS;
    const endMs = state.endMs ?? END_MS;

    const phaseDur =
      state.phase === "BET" ? betMs :
      state.phase === "PLAY" ? playMs :
      endMs;

    const phaseEndAt = state.phaseStartedAt + phaseDur;

    // если ещё не закончилась текущая фаза — готово
    if (now < phaseEndAt) break;

    // иначе переходим в следующую фазу (в момент phaseEndAt)
    if (state.phase === "BET") {
      state = {
        ...state,
        phase: "PLAY",
        phaseStartedAt: phaseEndAt,
        endPercent: sampleEndPercent(),
        seed: Math.floor(Math.random() * 1_000_000_000),
      };
      continue;
    }

    if (state.phase === "PLAY") {
      const endPercent = typeof state.endPercent === "number" ? state.endPercent : 0;

      // фиксируем END
      state = {
        ...state,
        phase: "END",
        phaseStartedAt: phaseEndAt,
        endPercent,
      };

      // добавляем в историю (newest-first)
      await redis.lpush(KEY_HISTORY, JSON.stringify({ t: phaseEndAt, v: endPercent }));
      await redis.ltrim(KEY_HISTORY, 0, 11);

      continue;
    }

    // END -> новый раунд BET
    state = newRound(phaseEndAt);
  }

  await redis.set(KEY_STATE, JSON.stringify(state));

  const histRaw = await redis.lrange(KEY_HISTORY, 0, 11);
  const history = histRaw.map((x) => {
    try { return JSON.parse(x); } catch { return null; }
  }).filter(Boolean);

  return { state, history };
}

export async function GET() {
  try {
    const now = Date.now();
    const { state, history } = await ensureState(now);
    return NextResponse.json({ ok: true, state, history, serverNow: now });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
