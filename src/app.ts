import cors from "@fastify/cors";
import compress from "@fastify/compress";
import fastifyJwt from "@fastify/jwt";
import rateLimit, { type RateLimitPluginOptions } from "@fastify/rate-limit";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { Redis } from "ioredis";
import type { DictionaryCache } from "./cache/dictionary-cache.js";
import { config } from "./config/env.js";
import { buildProviderByName } from "./providers/registry.js";
import { registerDictionaryRoutes } from "./routes/dictionary.js";
import { registerHealthRoutes } from "./routes/health.js";

export async function buildApp(cache: DictionaryCache) {
  const app = Fastify({
    logger: {
      level: config.logLevel
    },
    trustProxy: true,
    bodyLimit: 16 * 1024
  });

  await app.register(compress, { global: true, threshold: 512 });

  let rateLimitRedis: Redis | undefined = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true
  });
  rateLimitRedis.on("error", (error) => {
    app.log.debug({ error }, "Rate limit Redis error");
  });
  await rateLimitRedis.connect().catch(() => {
    app.log.warn("Rate limit Redis unavailable — falling back to in-memory store");
    rateLimitRedis?.disconnect();
    rateLimitRedis = undefined;
  });
  app.addHook("onClose", async () => {
    if (rateLimitRedis) await rateLimitRedis.quit();
  });

  const rateLimitOptions: RateLimitPluginOptions = {
    global: false,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: `Too many requests — retry after ${Math.ceil(context.ttl / 1000)} seconds`
      }
    })
  };

  if (rateLimitRedis) {
    rateLimitOptions.redis = rateLimitRedis;
  }

  await app.register(rateLimit, rateLimitOptions);

  await app.register(cors, {
    origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
    methods: ["POST"],
    allowedHeaders: ["content-type", "authorization"],
    credentials: false,
    maxAge: 600
  });

  let authenticate: ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) | undefined;

  if (config.authEnabled) {
    await app.register(fastifyJwt, {
      secret: config.jwtSecret!,
      verify: { algorithms: ["HS256"] }
    });

    authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.code(401).send({
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid or missing authorization token"
          }
        });
      }
    };
  }

  const providers = config.providerOrder.map(buildProviderByName);

  app.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Route ${request.method}:${request.url} not found`
      }
    });
  });

  app.setErrorHandler(async (error, _request, reply) => {
    const appError = error as { message?: string; statusCode?: number };
    const statusCode =
      appError.statusCode && appError.statusCode >= 400 ? appError.statusCode : 500;

    return reply.code(statusCode).send({
      ok: false,
      error: {
        code: statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
        message: appError.message ?? "Unexpected error"
      }
    });
  });

  app.get("/", async (_request, reply) => {
    return reply.code(403).send({
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Use POST /translate/ with source, target and text JSON fields"
      },
    });
  });

  await registerHealthRoutes(app, cache);
  await registerDictionaryRoutes(app, cache, providers, authenticate);

  return app;
}
