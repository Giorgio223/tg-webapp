import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

const KEY_STATE = "game:state";
const KEY_HISTORY = "game:history";

export async function POST() {
  try {
    const redis = getRedis();
    await redis.del(KEY_STATE);
    await redis.del(KEY_HISTORY);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
