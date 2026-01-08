import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

const KEY = "game:state";

export async function GET() {
  const redis = getRedis();
  const raw = await redis.get(KEY);
  const state = raw ? JSON.parse(raw) : null;
  return NextResponse.json({ state });
}
