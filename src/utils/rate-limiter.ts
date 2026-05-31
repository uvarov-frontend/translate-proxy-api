import type { Redis } from "ioredis";
import type { FastifyReply, FastifyRequest } from "fastify";

export type RateLimiterHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function createRateLimiter(
  redis: Redis | undefined,
  max: number,
  windowMs: number
): RateLimiterHook {
  const inMemory = new Map<string, { count: number; expires: number }>();

  return async function rateLimiter(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const key = `rl:translate:${request.ip}`;
    let current: number;
    let ttlMs: number;

    try {
      if (redis) {
        current = await redis.incr(key);
        if (current === 1) await redis.pexpire(key, windowMs);
        ttlMs = Math.max(0, await redis.pttl(key));
      } else {
        const now = Date.now();
        const entry = inMemory.get(key);
        if (!entry || entry.expires < now) {
          inMemory.set(key, { count: 1, expires: now + windowMs });
          current = 1;
          ttlMs = windowMs;
        } else {
          entry.count++;
          current = entry.count;
          ttlMs = entry.expires - now;
        }
      }
    } catch {
      // Redis error — allow request through, don't block users
      return;
    }

    const remaining = Math.max(0, max - current);
    const resetSecs = Math.ceil(ttlMs / 1000);

    reply.header("x-ratelimit-limit", max);
    reply.header("x-ratelimit-remaining", remaining);
    reply.header("x-ratelimit-reset", resetSecs);

    if (current > max) {
      reply.header("retry-after", resetSecs);
      return reply.code(429).send({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests — retry after ${resetSecs} seconds`
        }
      });
    }
  };
}
