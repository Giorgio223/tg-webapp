import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

type Phase = "BET" | "PLAY" | "END";

type GameState = {
  roundId: string;
  phase: Phase;
  phaseStartedAt: number;
  endPercent?: number;
  seed: number;
};

type RoundMeta = {
  roundId: string;
  playStartedAt: number;
  endPercent: number;
  seed: number;
};

const KEY_STATE = "game:state";
const KEY_HISTORY = "game:history"; // оставим как было (end results)
const KEY_ROUNDS = "game:rounds";   // ✅ мета раундов для одинакового графика всем

const BET_MS = 7000;
const PLAY_MS = 15000;
const END_MS = 2500;

const HISTORY_LIMIT = 8;
const ROUNDS_LIMIT = 8;

function newRound(startAt: number): GameState {
  return {
    roundId: crypto.randomUUID(),
    phase: "BET",
    phaseStartedAt: startAt,
    seed: Math.floor(Math.random() * 1_000_000_000),
  };
}

// шансы
function sampleEndPercent(): number {
  const r = Math.random();
  if (r < 0.5) return -100 + Math.random() * 100; // [-100..0]

  const w1 = 40, w2 = 10, w3 = 3;
  const sum = w1 + w2 + w3; // 53
  const u = Math.random() * sum;

  if (u < w1) return Math.random() * 50;           // 0..50
  if (u < w1 + w2) return 51 + Math.random() * 99; // 51..150
  return 150 + Math.random() * 50;                 // 150..200
}

async function ensureState(now: number) {
  const redis = getRedis();
  const raw = await redis.get(KEY_STATE);
  let state: GameState = raw ? JSON.parse(raw) : newRound(now);

  // если дата “в будущем” — чиним
  if (state.phaseStartedAt > now + 2000) state.phaseStartedAt = now;

  for (let i = 0; i < 120; i++) {
    const dur =
      state.phase === "BET" ? BET_MS :
      state.phase === "PLAY" ? PLAY_MS :
      END_MS;

    const phaseEndAt = state.phaseStartedAt + dur;
    if (now < phaseEndAt) break;

    if (state.phase === "BET") {
      // BET -> PLAY
      state = {
        ...state,
        phase: "PLAY",
        phaseStartedAt: phaseEndAt,
        endPercent: sampleEndPercent(),
      };
      continue;
    }

    if (state.phase === "PLAY") {
      // PLAY -> END
      const endPercent = typeof state.endPercent === "number" ? state.endPercent : 0;

      state = {
        ...state,
        phase: "END",
        phaseStartedAt: phaseEndAt,
        endPercent,
      };

      // история результатов (для UI)
      await redis.lpush(KEY_HISTORY, JSON.stringify({ t: phaseEndAt, v: endPercent }));
      await redis.ltrim(KEY_HISTORY, 0, HISTORY_LIMIT - 1);

      // ✅ мета-раунд (для одинакового пути графика)
      const meta: RoundMeta = {
        roundId: state.roundId,
        playStartedAt: phaseEndAt - END_MS - PLAY_MS, // начало PLAY
        endPercent,
        seed: state.seed,
      };
      await redis.lpush(KEY_ROUNDS, JSON.stringify(meta));
      await redis.ltrim(KEY_ROUNDS, 0, ROUNDS_LIMIT - 1);

      continue;
    }

    // END -> новый BET
    state = newRound(phaseEndAt);
  }

  await redis.set(KEY_STATE, JSON.stringify(state));

  const histRaw = await redis.lrange(KEY_HISTORY, 0, HISTORY_LIMIT - 1);
  const history = histRaw
    .map((x) => { try { return JSON.parse(x); } catch { return null; } })
    .filter(Boolean);

  const roundsRaw = await redis.lrange(KEY_ROUNDS, 0, ROUNDS_LIMIT - 1);
  const rounds = roundsRaw
    .map((x) => { try { return JSON.parse(x); } catch { return null; } })
    .filter(Boolean);

  return { state, history, rounds };
}

export async function GET() {
  try {
    const now = Date.now();
    const { state, history, rounds } = await ensureState(now);

    return NextResponse.json({
      ok: true,
      state: { ...state, betMs: BET_MS, playMs: PLAY_MS, endMs: END_MS },
      history,
      rounds, // ✅ для одинакового графика всем
      serverNow: now,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
