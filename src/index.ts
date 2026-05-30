import { DictionaryCache } from "./cache/dictionary-cache.js";
import { config } from "./config/env.js";
import { buildApp } from "./app.js";

const cache = new DictionaryCache(config.redisUrl);

async function main(): Promise<void> {
  await cache.connect();

  const app = await buildApp(cache);

  const shutdown = async () => {
    app.log.info("Shutting down");
    await app.close();
    await cache.disconnect();
  };

  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });

  await app.listen({
    host: config.host,
    port: config.port
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
