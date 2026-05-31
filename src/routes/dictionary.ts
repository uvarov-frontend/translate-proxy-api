import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { createDictionaryCacheKey, normalizeQuery } from "../cache/cache-key.js";
import type { DictionaryCache } from "../cache/dictionary-cache.js";
import { config } from "../config/env.js";
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  DictionaryProvider,
  DictionaryQuery
} from "../types.js";
import { ValidationError } from "../utils/errors.js";
import { runProviders } from "../providers/provider-runner.js";

type LookupResult = { response: ApiSuccessResponse; provider: string };

type BatchItemResult =
  | { ok: true; text: string; provider: string; cache: "HIT" | "STALE" | "MISS" }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

const BATCH_MAX_ITEMS = 50;

const inFlightLookups = new Map<string, Promise<LookupResult>>();

const dictionarySchema = {
  body: {
    type: "object",
    required: ["source", "target", "text"],
    properties: {
      source: { type: "string", maxLength: 32 },
      target: { type: "string", maxLength: 32 },
      text: { type: "string", maxLength: 2000 },
      provider: { type: "string", maxLength: 64 }
    },
    additionalProperties: false
  },
  response: {
    200: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        data: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"]
        }
      },
      required: ["ok", "data"]
    }
  }
};

const batchSchema = {
  body: {
    type: "array",
    minItems: 1,
    maxItems: BATCH_MAX_ITEMS,
    items: {
      type: "object",
      required: ["source", "target", "text"],
      properties: {
        source: { type: "string", maxLength: 32 },
        target: { type: "string", maxLength: 32 },
        text: { type: "string", maxLength: 2000 },
        provider: { type: "string", maxLength: 64 }
      },
      additionalProperties: false
    }
  }
};

export async function registerDictionaryRoutes(
  app: FastifyInstance,
  cache: DictionaryCache,
  providers: DictionaryProvider[],
  authenticate?: preHandlerHookHandler
): Promise<void> {
  app.post(
    "/translate/",
    {
      schema: dictionarySchema,
      config: { rateLimit: {} },
      ...(authenticate ? { onRequest: authenticate } : {})
    },
    handleDictionaryRequest(app, cache, providers)
  );

  app.post(
    "/translate/batch/",
    {
      schema: batchSchema,
      config: { rateLimit: {} },
      ...(authenticate ? { onRequest: authenticate } : {})
    },
    handleBatchRequest(app, cache, providers)
  );
}

function handleDictionaryRequest(
  app: FastifyInstance,
  cache: DictionaryCache,
  providers: DictionaryProvider[]
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    let query: DictionaryQuery;

    try {
      query = parseDictionaryRequestBody(request.body);
    } catch (error) {
      const response: ApiErrorResponse = {
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Invalid request",
          details: error instanceof ValidationError ? error.details : undefined
        }
      };

      return reply.code(400).send(response);
    }

    const { provider: providerParam } = request.body as { provider?: string };
    const pinnedProviderName = providerParam?.trim().toLowerCase();
    let activeProviders = providers;

    if (pinnedProviderName) {
      const pinned = providers.find((p) => p.name === pinnedProviderName);
      if (!pinned) {
        const response: ApiErrorResponse = {
          ok: false,
          error: {
            code: "BAD_REQUEST",
            message: `Unknown provider: "${pinnedProviderName}". Available: ${providers.map((p) => p.name).join(", ")}`
          }
        };
        return reply.code(400).send(response);
      }
      activeProviders = [pinned];
    }

    const cacheKey = createDictionaryCacheKey(query, pinnedProviderName);

    try {
      const cacheHit = await cache.get(cacheKey);

      if (cacheHit.kind === "fresh") {
        const maxAge = Math.max(0, Math.floor((cacheHit.freshUntil - Date.now()) / 1000));
        const cacheControl = `public, max-age=${maxAge}, stale-while-revalidate=${config.staleTtlSeconds}`;
        reply.header("X-Provider", cacheHit.provider);
        return sendWithETag(request, reply, cacheHit.response, "HIT", cacheControl);
      }

      if (cacheHit.kind === "stale" && isCacheableDictionaryResponse(cacheHit.response)) {
        revalidateInBackground(app, cache, cacheKey, query, activeProviders);
        reply.header("X-Provider", cacheHit.provider);
        return sendWithETag(request, reply, cacheHit.response, "STALE", "no-store");
      }
    } catch (error) {
      app.log.warn({ error, cacheKey }, "Dictionary cache read failed");
    }

    try {
      const { response, provider } = await coalescedLookup(cacheKey, query, activeProviders);
      persistToCache(app, cache, cacheKey, response, provider);

      const maxAge = isCacheableDictionaryResponse(response) ? config.cacheTtlSeconds : config.emptyCacheTtlSeconds;
      const cacheControl = `public, max-age=${maxAge}, stale-while-revalidate=${config.staleTtlSeconds}`;
      reply.header("X-Provider", provider);
      return sendWithETag(request, reply, response, "MISS", cacheControl);
    } catch (error) {
      const response: ApiErrorResponse = {
        ok: false,
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: "Dictionary provider is temporarily unavailable"
        }
      };

      return reply.code(502).send(response);
    }
  };
}

function isCacheableDictionaryResponse(response: ApiSuccessResponse): boolean {
  return response.data.text.length > 0;
}

function computeETag(text: string): string {
  return `"${createHash("sha1").update(text).digest("hex").slice(0, 16)}"`;
}

function sendWithETag(
  request: FastifyRequest,
  reply: FastifyReply,
  response: ApiSuccessResponse,
  xCache: string,
  cacheControl: string
) {
  const etag = computeETag(response.data.text);
  reply.header("ETag", etag).header("Cache-Control", cacheControl);

  if (request.headers["if-none-match"] === etag) {
    return reply.code(304).send();
  }

  return reply.header("X-Cache", xCache).send(response);
}

function revalidateInBackground(
  app: FastifyInstance,
  cache: DictionaryCache,
  cacheKey: string,
  query: DictionaryQuery,
  providers: DictionaryProvider[]
): void {
  coalescedLookup(cacheKey, query, providers)
    .then(({ response, provider }) => persistToCache(app, cache, cacheKey, response, provider))
    .catch((error) => app.log.warn({ error, cacheKey }, "Background revalidation failed"));
}

async function persistToCache(
  app: FastifyInstance,
  cache: DictionaryCache,
  cacheKey: string,
  response: ApiSuccessResponse,
  provider: string
): Promise<void> {
  const [ttl, staleTtl] = isCacheableDictionaryResponse(response)
    ? [config.cacheTtlSeconds, config.staleTtlSeconds]
    : [config.emptyCacheTtlSeconds, config.emptyCacheTtlSeconds];

  if (ttl === 0) return;

  try {
    await cache.set(cacheKey, response, provider, ttl, staleTtl);
  } catch (error) {
    app.log.warn({ error, cacheKey }, "Dictionary cache write failed");
  }
}

async function coalescedLookup(
  cacheKey: string,
  query: DictionaryQuery,
  providers: DictionaryProvider[]
): Promise<LookupResult> {
  const existing = inFlightLookups.get(cacheKey);
  if (existing) return existing;

  const promise = lookup(query, providers, AbortSignal.timeout(config.httpTimeoutMs * providers.length)).finally(() => {
    inFlightLookups.delete(cacheKey);
  });

  inFlightLookups.set(cacheKey, promise);
  return promise;
}

async function lookup(
  query: DictionaryQuery,
  providers: DictionaryProvider[],
  signal: AbortSignal
): Promise<LookupResult> {
  const result = await runProviders(providers, query, signal);

  return {
    response: { ok: true, data: result.data },
    provider: result.provider
  };
}

function handleBatchRequest(
  app: FastifyInstance,
  cache: DictionaryCache,
  providers: DictionaryProvider[]
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const items = request.body as Array<{
      source: string; target: string; text: string; provider?: string
    }>;

    const results = await Promise.all(
      items.map((item): Promise<BatchItemResult> => translateItem(app, cache, providers, item))
    );

    return reply.send({ ok: true, data: results });
  };
}

async function translateItem(
  app: FastifyInstance,
  cache: DictionaryCache,
  providers: DictionaryProvider[],
  item: { source: string; target: string; text: string; provider?: string }
): Promise<BatchItemResult> {
  let query: DictionaryQuery;

  try {
    query = parseDictionaryRequestBody(item);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : "Invalid item",
        details: error instanceof ValidationError ? error.details : undefined
      }
    };
  }

  const pinnedProviderName = item.provider?.trim().toLowerCase();
  let activeProviders = providers;

  if (pinnedProviderName) {
    const pinned = providers.find((p) => p.name === pinnedProviderName);
    if (!pinned) {
      return {
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: `Unknown provider: "${pinnedProviderName}". Available: ${providers.map((p) => p.name).join(", ")}`
        }
      };
    }
    activeProviders = [pinned];
  }

  const cacheKey = createDictionaryCacheKey(query, pinnedProviderName);

  try {
    const cacheHit = await cache.get(cacheKey);

    if (cacheHit.kind === "fresh") {
      return { ok: true, text: cacheHit.response.data.text, provider: cacheHit.provider, cache: "HIT" };
    }

    if (cacheHit.kind === "stale" && isCacheableDictionaryResponse(cacheHit.response)) {
      revalidateInBackground(app, cache, cacheKey, query, activeProviders);
      return { ok: true, text: cacheHit.response.data.text, provider: cacheHit.provider, cache: "STALE" };
    }
  } catch (error) {
    app.log.warn({ error, cacheKey }, "Dictionary cache read failed");
  }

  try {
    const { response, provider } = await coalescedLookup(cacheKey, query, activeProviders);
    persistToCache(app, cache, cacheKey, response, provider);
    return { ok: true, text: response.data.text, provider, cache: "MISS" };
  } catch {
    return {
      ok: false,
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: "Dictionary provider is temporarily unavailable"
      }
    };
  }
}

function parseDictionaryRequestBody(rawBody: unknown): DictionaryQuery {
  // Types, maxLengths and required fields are validated by Fastify schema before reaching here.
  // Only remaining check: fields must be non-empty after normalization.
  const body = rawBody as { source: string; target: string; text: string };
  const query = normalizeQuery(body);

  const missing = (["source", "target", "text"] as const).filter((k) => !query[k]);
  if (missing.length > 0) {
    throw new ValidationError("Required body fields are missing or empty", { missing });
  }

  return query;
}
