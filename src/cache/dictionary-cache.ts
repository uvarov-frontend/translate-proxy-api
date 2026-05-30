import { Redis } from "ioredis";
import type { ApiSuccessResponse } from "../types.js";

type CacheEnvelope = {
  freshUntil: number;
  staleUntil: number;
  response: ApiSuccessResponse;
  provider: string;
};

export type CacheHit =
  | {
      kind: "fresh";
      response: ApiSuccessResponse;
      freshUntil: number;
      provider: string;
    }
  | {
      kind: "stale";
      response: ApiSuccessResponse;
      provider: string;
    }
  | {
      kind: "miss";
    };

export class DictionaryCache {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      enableReadyCheck: true,
      maxRetriesPerRequest: 1,
      lazyConnect: true
    });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }

  async isReady(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<CacheHit> {
    const raw = await this.redis.get(key);
    if (!raw) return { kind: "miss" };

    const envelope = JSON.parse(raw) as CacheEnvelope;
    const now = Date.now();

    if (envelope.freshUntil > now) {
      return { kind: "fresh", response: envelope.response, freshUntil: envelope.freshUntil, provider: envelope.provider };
    }

    if (envelope.staleUntil > now) {
      return { kind: "stale", response: envelope.response, provider: envelope.provider };
    }

    return { kind: "miss" };
  }

  async set(
    key: string,
    response: ApiSuccessResponse,
    provider: string,
    cacheTtlSeconds: number,
    staleTtlSeconds: number
  ): Promise<void> {
    const now = Date.now();
    const envelope: CacheEnvelope = {
      freshUntil: now + cacheTtlSeconds * 1000,
      staleUntil: now + staleTtlSeconds * 1000,
      response,
      provider
    };

    await this.redis.set(key, JSON.stringify(envelope), "EX", staleTtlSeconds);
  }
}
