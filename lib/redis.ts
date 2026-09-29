import { Redis } from "@upstash/redis";

// Upstash REST credentials. Null when not configured — callers must treat
// Redis as a best-effort enhancement; Postgres is the source of truth.
export const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;
