import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedis() {
  if (redis) return redis;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is missing");

  redis = new Redis(url);
  return redis;
}
