# Translate Proxy API

Лёгкий self-hosted прокси-переводчик. Отправляете исходный язык, целевой язык и текст — получаете чистый перевод. Создан для встраивания в собственную инфраструктуру.

**Бесплатный** — поставляется с двумя встроенными провайдерами от Google, без API-ключей и оплаты. Можно подключить собственный провайдер.

Ответы кешируются в Redis, поэтому повторные запросы возвращаются менее чем за 1 мс без обращения к внешним сервисам.

---

## Возможности

- **JWT-аутентификация** — включена по умолчанию; передаёте токен, который уже выдаёт ваш сервис авторизации, без дополнительных шагов
- **Умное кеширование** — устаревшие ответы отдаются мгновенно, пока фоновый запрос тихо обновляет кеш
- **Схлопывание запросов** — десятки одинаковых одновременных запросов превращаются в один upstream-вызов
- **Цепочка провайдеров** — настраиваете несколько провайдеров по приоритету; если один недоступен, автоматически подключается следующий
- **Ограничение запросов** — по IP, хранится в Redis, корректно работает на нескольких репликах
- **Сжатие ответов** — brotli / gzip из коробки

---

## Быстрый старт

### Вариант А — готовый образ с Docker Hub

```bash
cp .env.local.example .env.local
# задайте JWT_SECRET в .env.local
```

Создайте `docker-compose.yml`:

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

### Вариант Б — сборка из исходников

```bash
cp .env.local.example .env.local
# задайте JWT_SECRET в .env.local

docker compose up -d --build
```

Сервис доступен по адресу `http://127.0.0.1:3010`. Для TLS поставьте nginx или Caddy перед ним.

**Режим разработки** (автоперезапуск при изменении файлов):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

```bash
docker compose logs -f   # логи в реальном времени
docker compose down      # остановить всё
```

---

## Использование

### Перевод текста

```bash
curl -X POST 'http://127.0.0.1:3010/translate/' \
  -H 'Authorization: Bearer <ваш_jwt>' \
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

### Заголовки ответа

Добавьте `-i` чтобы увидеть статус кеша, провайдер и директивы кеширования:

```bash
curl -i -X POST 'http://127.0.0.1:3010/translate/' \
  -H 'Authorization: Bearer <ваш_jwt>' \
  -H 'Content-Type: application/json' \
  --data '{"source":"en","target":"ru","text":"Good morning"}'
```

```
X-Cache: HIT
X-Provider: google-translate
Cache-Control: public, max-age=21340, stale-while-revalidate=604800
ETag: "3a1f9c2b4d6e8a0b"
```

### Тело запроса

| Поле     | Тип    | Ограничение      |
|----------|--------|------------------|
| `source` | string | макс. 32 символа |
| `target` | string | макс. 32 символа |
| `text`   | string | макс. 2000 символов |

### Ошибки

Все ошибки имеют единый формат:

```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing authorization token"
  }
}
```

| Код                    | HTTP | Когда                                        |
|------------------------|------|----------------------------------------------|
| `BAD_REQUEST`          | 400  | Отсутствуют, неверный тип или превышен лимит |
| `UNAUTHORIZED`         | 401  | Отсутствует или недействительный JWT          |
| `RATE_LIMITED`         | 429  | Слишком много запросов с этого IP             |
| `PROVIDER_UNAVAILABLE` | 502  | Все провайдеры недоступны                     |

---

## Аутентификация

Аутентификация **включена по умолчанию**. Каждый запрос должен содержать JWT в заголовке `Authorization`:

```
Authorization: Bearer <ваш_jwt>
```

Прокси проверяет подпись токена локально с помощью `JWT_SECRET` — без сетевого обращения к вашему сервису авторизации на каждый запрос.

**Работает с любым JWT-провайдером на основе HS256** — Strapi, собственный auth-сервер и т.д. Задайте `JWT_SECRET` равным секрету, который использует ваш провайдер. Токены с другими алгоритмами подписи отклоняются.

### Настройка

```bash
cp .env.local.example .env.local
```

Откройте `.env.local` и задайте `JWT_SECRET`. Для Strapi это значение `JWT_SECRET` из вашего окружения Strapi.

Сгенерировать надёжный секрет:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Отключить аутентификацию

Для публичных или полностью внутренних развёртываний добавьте в `.env`:

```
AUTH_ENABLED=false
```

---

## Конфигурация

Публичные настройки хранятся в `.env`. Секреты — в `.env.local` (добавлен в `.gitignore`, никогда не коммитится).

| Переменная               | По умолчанию                                   | Описание                                                       |
|--------------------------|------------------------------------------------|----------------------------------------------------------------|
| `AUTH_ENABLED`           | `true`                                         | `false` — отключить JWT-аутентификацию                         |
| `JWT_SECRET`             | —                                              | Обязателен при `AUTH_ENABLED=true`. Задать в `.env.local`      |
| `LOG_LEVEL`              | `info`                                         | `trace` `debug` `info` `warn` `error`                          |
| `REDIS_URL`              | `redis://127.0.0.1:6379/0`                     | Адрес подключения к Redis                                      |
| `REDIS_MAXMEMORY`        | `256mb`                                        | Лимит памяти Redis; политика вытеснения — `allkeys-lru`        |
| `CACHE_TTL_SECONDS`      | `21600` (6 ч)                                  | Время жизни свежего кеша                                       |
| `STALE_TTL_SECONDS`      | `604800` (7 д)                                 | Как долго устаревший ответ можно отдавать пока идёт обновление |
| `EMPTY_CACHE_TTL_SECONDS`| `60`                                           | TTL для пустых переводов; `0` — не кешировать пустые ответы    |
| `HTTP_TIMEOUT_MS`        | `5000`                                         | Таймаут запроса к upstream в миллисекундах                     |
| `CORS_ORIGINS`           | `*`                                            | Разрешённые origins через запятую, или `*` для всех            |
| `RATE_LIMIT_MAX`         | `60`                                           | Макс. запросов за окно на один IP                              |
| `RATE_LIMIT_WINDOW_MS`   | `60000` (1 мин)                                | Размер окна для rate limiting в миллисекундах                  |
| `PROVIDER_ORDER`         | `google-translate,google-dictionary-extension` | Список провайдеров по приоритету через запятую                 |

---

## Кеширование

Каждый перевод кешируется в Redis. Повторный запрос возвращается менее чем за 1 мс.

**Как это работает:**

1. **Fresh (свежий)** — закеширован недавно, отдаётся мгновенно. Обращения к upstream нет.
2. **Stale (устаревший)** — кеш старый, но ещё пригоден. Отдаётся мгновенно. Фоновый запрос тихо обновляет его для следующего вызова.
3. **Miss (промах)** — не закеширован. Делается запрос к upstream, результат кешируется и возвращается.

Заголовок `X-Cache` показывает какой случай произошёл: `HIT`, `STALE` или `MISS`.

**Очистка кеша:**

```bash
# очистить всё
docker compose exec redis redis-cli FLUSHDB

# очистить только ключи переводов (если Redis общий с другими сервисами)
docker compose exec redis redis-cli --scan --pattern "dictionary:v1:*" | xargs docker compose exec -T redis redis-cli DEL
```

---

## Провайдеры

Из коробки доступны два провайдера:

| Имя                           | Описание                           |
|-------------------------------|------------------------------------|
| `google-translate`            | Неофициальный Google Translate API |
| `google-dictionary-extension` | Google Dictionary Extension API    |

`PROVIDER_ORDER` задаёт приоритет. Первый провайдер пробуется первым; если он недоступен — автоматически подключается следующий:

```
# один провайдер
PROVIDER_ORDER=google-translate

# с автоматическим fallback
PROVIDER_ORDER=google-translate,google-dictionary-extension
```

**Добавить собственный провайдер:**

1. Создайте `src/providers/my-provider.ts`, реализовав интерфейс `DictionaryProvider`:

```typescript
interface DictionaryProvider {
  readonly name: string;
  lookup(query: DictionaryQuery, signal: AbortSignal): Promise<ProviderResult>;
}
```

2. Зарегистрируйте его в `src/providers/registry.ts`.
3. Укажите `PROVIDER_ORDER=my-provider` или добавьте в цепочку fallback.

> **Важно:** при смене основного провайдера увеличьте версию кеш-ключа в `src/cache/cache-key.ts` (`v1` → `v2`), чтобы не отдавать старые ответы от предыдущего провайдера.

---

## Лицензия

MIT © [Yury Uvarov](https://frontend.uvarov.tech)
