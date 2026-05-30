# Translate Proxy API

[Русская версия](README.ru.md)

A lightweight self-hosted translation proxy. Send a source language, target language and text — get back a clean translation. Built for embedding into your own infrastructure.

**Free to use** — ships with two built-in Google providers, no API keys or billing required. You can also plug in your own provider.

Responses are cached in Redis so repeated lookups return in under 1 ms without hitting any upstream service.

---

## Features

- **JWT authentication** — enabled by default; pass the token your auth service already issues, no extra login step
- **Smart caching** — stale responses are served instantly while a background refresh runs silently
- **Request coalescing** — dozens of identical simultaneous requests result in a single upstream call
- **Fallback chain** — configure multiple providers in priority order; if one fails the next is tried automatically
- **Rate limiting** — per-IP, backed by Redis, works correctly across multiple instances
- **Response compression** — brotli / gzip out of the box

---

## Quick start

### Option A — prebuilt image from Docker Hub

```bash
cp .env.local.example .env.local
# set JWT_SECRET in .env.local
```

Create a `docker-compose.yml`:

```yaml
services:
  app:
    image: uvarovfrontend/translate-proxy-api:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:3010:3010"
    env_file:
      - .env
      - path: .env.local
        required: false
    depends_on:
      redis:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --maxmemory ${REDIS_MAXMEMORY:-256mb} --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
```

```bash
docker compose up -d
```

### Option B — build from source

```bash
cp .env.local.example .env.local
# set JWT_SECRET in .env.local

docker compose up -d --build
```

The service is available at `http://127.0.0.1:3010`. Put nginx or Caddy in front for TLS.

**Development** (auto-restart on file changes):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

```bash
docker compose logs -f   # stream logs
docker compose down      # stop everything
```

---

## Usage

### Translate text

```bash
curl -X POST 'http://127.0.0.1:3010/translate/' \
  -H 'Authorization: Bearer <your_jwt>' \
  -H 'Content-Type: application/json' \
  --data '{"source":"en","target":"ru","text":"Good morning"}'
```

```json
{
  "ok": true,
  "data": {
    "text": "Доброе утро"
  }
}
```

### Check response headers

Add `-i` to see cache status, provider and caching directives:

```bash
curl -i -X POST 'http://127.0.0.1:3010/translate/' \
  -H 'Authorization: Bearer <your_jwt>' \
  -H 'Content-Type: application/json' \
  --data '{"source":"en","target":"ru","text":"Good morning"}'
```

```
X-Cache: HIT
X-Provider: google-translate
Cache-Control: public, max-age=21340, stale-while-revalidate=604800
ETag: "3a1f9c2b4d6e8a0b"
```

### Request body

| Field    | Type   | Limit          |
|----------|--------|----------------|
| `source` | string | max 32 chars   |
| `target` | string | max 32 chars   |
| `text`   | string | max 2000 chars |

### Error responses

All errors follow the same shape:

```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing authorization token"
  }
}
```

| Code                   | HTTP | When                                    |
|------------------------|------|-----------------------------------------|
| `BAD_REQUEST`          | 400  | Missing, wrong-type or oversized fields |
| `UNAUTHORIZED`         | 401  | Missing or invalid JWT token            |
| `RATE_LIMITED`         | 429  | Too many requests from this IP          |
| `PROVIDER_UNAVAILABLE` | 502  | All upstream providers failed           |

---

## Authentication

Authentication is **enabled by default**. Every request must carry a JWT in the `Authorization` header:

```
Authorization: Bearer <your_jwt>
```

The proxy verifies the token signature locally using `JWT_SECRET` — no network call to your auth service on every request.

**Works with any JWT issuer that uses HS256**, including Strapi, custom auth servers, etc. Set `JWT_SECRET` to the same secret your issuer uses. Tokens using other signing algorithms are rejected.

### Setup

```bash
cp .env.local.example .env.local
```

Open `.env.local` and set `JWT_SECRET`. For Strapi this is the `JWT_SECRET` value from your Strapi environment.

To generate a strong secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Disable authentication

For public or fully internal deployments, set in `.env`:

```
AUTH_ENABLED=false
```

---

## Configuration

Public settings live in `.env`. Secrets go in `.env.local` (gitignored, never committed).

| Variable                 | Default                                        | Description                                                   |
|--------------------------|------------------------------------------------|---------------------------------------------------------------|
| `AUTH_ENABLED`           | `true`                                         | Set to `false` to disable JWT authentication                  |
| `JWT_SECRET`             | —                                              | Required when `AUTH_ENABLED=true`. Set in `.env.local`        |
| `LOG_LEVEL`              | `info`                                         | `trace` `debug` `info` `warn` `error`                         |
| `REDIS_URL`              | `redis://127.0.0.1:6379/0`                     | Redis connection URL                                          |
| `REDIS_MAXMEMORY`        | `256mb`                                        | Redis memory cap; eviction policy is `allkeys-lru`            |
| `CACHE_TTL_SECONDS`      | `21600` (6 h)                                  | How long a response is considered fresh                       |
| `STALE_TTL_SECONDS`      | `604800` (7 d)                                 | How long a stale entry can be served while refreshing         |
| `EMPTY_CACHE_TTL_SECONDS`| `60`                                           | TTL for empty results; `0` disables caching of empty results  |
| `HTTP_TIMEOUT_MS`        | `5000`                                         | Upstream request timeout in milliseconds                      |
| `CORS_ORIGINS`           | `*`                                            | Allowed origins, comma-separated, or `*` for all              |
| `RATE_LIMIT_MAX`         | `60`                                           | Max requests per window per IP                                |
| `RATE_LIMIT_WINDOW_MS`   | `60000` (1 min)                                | Rate limit window in milliseconds                             |
| `PROVIDER_ORDER`         | `google-translate,google-dictionary-extension` | Provider priority list, comma-separated                       |

---

## Caching

Every translation is cached in Redis. The same query returns in under 1 ms on subsequent calls.

**How it works:**

1. **Fresh** — cached recently, returned instantly. No upstream call.
2. **Stale** — cache is old but still usable. Returned instantly. A background request silently refreshes it for the next caller.
3. **Miss** — not cached yet. Upstream is called, result is cached and returned.

The `X-Cache` response header tells you which case applied: `HIT`, `STALE`, or `MISS`.

**Flush the cache:**

```bash
# flush everything
docker compose exec redis redis-cli FLUSHDB

# flush only translation keys (if Redis is shared with other services)
docker compose exec redis redis-cli --scan --pattern "dictionary:v1:*" | xargs docker compose exec -T redis redis-cli DEL
```

---

## Providers

The proxy ships with two providers out of the box:

| Name                          | Description                     |
|-------------------------------|---------------------------------|
| `google-translate`            | Unofficial Google Translate API |
| `google-dictionary-extension` | Google Dictionary Extension API |

`PROVIDER_ORDER` controls priority. The first provider is tried; if it fails the next one takes over automatically:

```
# single provider
PROVIDER_ORDER=google-translate

# with automatic fallback
PROVIDER_ORDER=google-translate,google-dictionary-extension
```

**Adding a custom provider:**

1. Create `src/providers/my-provider.ts` implementing the `DictionaryProvider` interface:

```typescript
interface DictionaryProvider {
  readonly name: string;
  lookup(query: DictionaryQuery, signal: AbortSignal): Promise<ProviderResult>;
}
```

2. Register it in `src/providers/registry.ts`.
3. Set `PROVIDER_ORDER=my-provider` or add it to the fallback chain.

> **Note:** when switching the primary provider, bump the cache key version in `src/cache/cache-key.ts` (`v1` → `v2`) so old cached responses from the previous provider are not served.

---

## License

MIT © [Yury Uvarov](https://frontend.uvarov.tech)
