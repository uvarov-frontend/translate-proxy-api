import type { Redis } from "ioredis";
import type { FastifyReply, FastifyRequest } from "fastify";

export type RateLimiterHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Atomic Lua script: INCR + conditional PEXPIRE + PTTL in a single round-trip.
 * Eliminates the race condition where a key could be left without a TTL
 * if the process crashed between INCR and PEXPIRE.
 */
const LUA_RATE_LIMIT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

export function createRateLimiter(
  redis: Redis | undefined,
  max: number,
  windowMs: number
): RateLimiterHook {
  const inMemory = new Map<string, { count: number; expires: number }>();

  // Purge expired entries every 5 minutes to prevent unbounded memory growth
  // when the in-memory fallback is active (i.e. Redis is unavailable).
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of inMemory) {
      if (v.expires < now) inMemory.delete(k);
    }
  }, 5 * 60_000);
  cleanupInterval.unref(); // don't keep the event loop alive just for cleanup

  return async function rateLimiter(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const key = `rl:translate:${request.ip}`;
    let current: number;
    let ttlMs: number;

    try {
      if (redis) {
        const result = (await redis.eval(LUA_RATE_LIMIT, 1, key, String(windowMs))) as [
          number,
          number
        ];
        current = result[0];
        ttlMs = Math.max(0, result[1]);
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
