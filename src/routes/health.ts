import type { FastifyInstance } from "fastify";
import type { DictionaryCache } from "../cache/dictionary-cache.js";

export async function registerHealthRoutes(
  app: FastifyInstance,
  cache: DictionaryCache
): Promise<void> {
  app.get("/health/live", async (_request, reply) => {
    return reply.header("Cache-Control", "no-store").send({
      ok: true,
      service: "translate-proxy"
    });
  });

  app.get("/health/ready", async (_request, reply) => {
    const cacheReady = await cache.isReady();

    reply.header("Cache-Control", "no-store");

    if (!cacheReady) {
      return reply.code(503).send({
        ok: false,
        service: "translate-proxy",
        dependencies: { redis: "unavailable" }
      });
    }

    return reply.send({
      ok: true,
      service: "translate-proxy",
      dependencies: { redis: "ok" }
    });
  });
}
