import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

const KEY = "game:state";

export async function GET() {
  try {
    const redis = getRedis();
    const raw = await redis.get(KEY);
    const state = raw ? JSON.parse(raw) : null;
    return NextResponse.json({ ok: true, state });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
