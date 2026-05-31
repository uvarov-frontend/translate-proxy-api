# Translate Proxy API

Лёгкий self-hosted прокси-переводчик. Отправляете исходный язык, целевой язык и текст — получаете чистый перевод. Создан для встраивания в собственную инфраструктуру.

**Бесплатный** — поставляется с тремя встроенными провайдерами (два от Google, один от Яндекса), без API-ключей и оплаты. Можно подключить собственный провайдер.

Ответы кешируются в Redis, поэтому повторные запросы возвращаются менее чем за 1 мс без обращения к внешним сервисам.

**[Live demo →](https://uvarov-frontend.github.io/translate-proxy-api/)**

> **Важно:** демо-сервер `translate.uvarov.tech` предназначен исключительно для демонстрации. Он ограничен до 10 запросов в 30 минут на IP и может быть недоступен в любое время. Не используйте его в своих проектах — разверните собственный инстанс.

---

## Возможности

- **JWT-аутентификация** — включена по умолчанию; передаёте токен, который уже выдаёт ваш сервис авторизации, без дополнительных шагов
- **Batch-перевод** — до 50 текстов за один запрос; элементы обрабатываются с ограниченной конкурентностью (до 10 upstream-вызовов одновременно) и падают независимо друг от друга
- **Умное кеширование** — устаревшие ответы отдаются мгновенно, пока фоновый запрос тихо обновляет кеш
- **Схлопывание запросов** — десятки одинаковых одновременных запросов превращаются в один upstream-вызов
- **Цепочка провайдеров** — настраиваете несколько провайдеров по приоритету; следующий подключается автоматически при ошибке или пустом ответе
- **Circuit breaker** — провайдер, упавший 5 раз подряд, пропускается на 30 секунд и затем проверяется снова; остальные провайдеры продолжают работать без изменений
- **Выбор провайдера** — укажите конкретный провайдер в каждом запросе вместо использования цепочки fallback
- **Ограничение запросов** — по IP, общее для всех `/translate/` эндпоинтов, хранится в Redis; сбои limiter после запуска обрабатываются в режиме fail-open
- **Сжатие ответов** — brotli / gzip из коробки
- **ETag / 304** — клиент может пропустить загрузку ответа, который у него уже есть

---

## Быстрый старт

### Вариант А — готовый образ с Docker Hub

```bash
cp .env.example .env
# отредактируйте .env и настройте параметры
```

Создайте `docker-compose.yml`:

```yaml
services:
  app:
    image: uvarovfrontend/translate-proxy-api:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:3010:3000"
    env_file:
      - .env
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
cp .env.example .env
# отредактируйте .env и настройте параметры

docker compose up -d --build
```

Сервис доступен по адресу `http://127.0.0.1:3010`. Для TLS поставьте nginx или Caddy перед ним.

При проксировании через nginx принудительно задайте `X-Forwarded-For` из проверенного IP клиента, чтобы клиент не мог подменить адрес, используемый ограничителем запросов:

```nginx
location ^~ /translate/ {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

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

### POST /translate/

Перевод одного текста.

```bash
curl -X POST 'http://127.0.0.1:3010/translate/' \
  -H 'Authorization: Bearer <ваш_jwt>' \
  -H 'Content-Type: application/json' \
  --data '{"source":"en","target":"ru","text":"Good morning"}'
```

```json
{ "ok": true, "data": { "text": "Доброе утро" } }
```

Добавьте `-i` чтобы увидеть статус кеша, провайдер и директивы кеширования:

```
X-Cache: HIT
X-Provider: google-translate
Cache-Control: public, max-age=21340, stale-while-revalidate=604800
ETag: "3a1f9c2b4d6e8a0b"
```

**Тело запроса**

| Поле       | Тип    | Обязателен | Ограничение                              |
|------------|--------|------------|------------------------------------------|
| `source`   | string | да         | макс. 32 символа                         |
| `target`   | string | да         | макс. 32 символа                         |
| `text`     | string | да         | макс. 2000 символов                      |
| `provider` | string | нет        | Конкретный провайдер из `PROVIDER_ORDER` |

### POST /translate/batch/

Перевод до 50 текстов за один запрос. Элементы обрабатываются параллельно с лимитом в 10 одновременных upstream-вызовов — ошибка одного не отменяет остальные. Каждый элемент поддерживает те же поля, что и одиночный запрос, включая необязательный `"provider"`.

```bash
curl -X POST 'http://127.0.0.1:3010/translate/batch/' \
  -H 'Authorization: Bearer <ваш_jwt>' \
  -H 'Content-Type: application/json' \
  --data '[
    {"source":"en","target":"ru","text":"Good morning"},
    {"source":"en","target":"ru","text":"Good night","provider":"yandex-translate"}
  ]'
```

```json
{
  "ok": true,
  "data": [
    { "ok": true, "text": "Доброе утро" },
    { "ok": true, "text": "Спокойной ночи" }
  ]
}
```

Если элемент не удался, остальные всё равно возвращаются — он получает `ok: false` внутри массива:

```json
{
  "ok": true,
  "data": [
    { "ok": true,  "text": "Доброе утро" },
    { "ok": false, "error": { "code": "PROVIDER_UNAVAILABLE", "message": "Dictionary provider is temporarily unavailable" } }
  ]
}
```

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
cp .env.example .env
```

Откройте `.env` и задайте `JWT_SECRET`. Для Strapi это значение `JWT_SECRET` из вашего окружения Strapi.

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

Все настройки хранятся в `.env` (добавлен в `.gitignore`, никогда не коммитится). Скопируйте `.env.example` для начала работы.

| Переменная               | По умолчанию                                   | Описание                                                       |
|--------------------------|------------------------------------------------|----------------------------------------------------------------|
| `AUTH_ENABLED`           | `true`                                         | `false` — отключить JWT-аутентификацию                         |
| `JWT_SECRET`             | —                                              | Обязателен при `AUTH_ENABLED=true`. Задать в `.env`            |
| `LOG_LEVEL`              | `info`                                         | `trace` `debug` `info` `warn` `error`                          |
| `REDIS_URL`              | `redis://127.0.0.1:6379/0`                     | Адрес подключения к Redis                                      |
| `REDIS_MAXMEMORY`        | `256mb`                                        | Лимит памяти Redis; политика вытеснения — `allkeys-lru`        |
| `CACHE_TTL_SECONDS`      | `21600` (6 ч)                                  | Время жизни свежего кеша                                       |
| `STALE_TTL_SECONDS`      | `604800` (7 д)                                 | Как долго устаревший ответ можно отдавать пока идёт обновление |
| `EMPTY_CACHE_TTL_SECONDS`| `60`                                           | TTL для пустых переводов; `0` — не кешировать пустые ответы    |
| `HTTP_TIMEOUT_MS`        | `5000`                                         | Таймаут запроса к upstream в миллисекундах                     |
| `CORS_ORIGINS`           | `*`                                            | Разрешённые origins через запятую, или `*` для всех            |
| `RATE_LIMIT_MAX`         | `60`                                           | Макс. запросов за окно на один IP, общий для всех `/translate/` эндпоинтов |
| `RATE_LIMIT_WINDOW_MS`   | `60000` (1 мин)                                | Размер окна для rate limiting в миллисекундах                  |
| `PROVIDER_ORDER`         | `google-translate,google-dictionary-extension` | Список провайдеров по приоритету через запятую                 |

Redis необходим при запуске приложения, так как от него зависит кеш переводов. Если rate limiter потеряет соединение с Redis после запуска, запросы будут пропускаться до восстановления Redis. Такое fail-open поведение сохраняет доступность переводов при runtime-сбое Redis.

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

Из коробки доступны три провайдера:

| Имя                           | Описание                            |
|-------------------------------|-------------------------------------|
| `google-translate`            | Неофициальный Google Translate API  |
| `google-dictionary-extension` | Google Dictionary Extension API     |
| `yandex-translate`            | Неофициальный Yandex Translate API  |

`PROVIDER_ORDER` задаёт приоритет. Первый провайдер пробуется первым; если он недоступен **или вернул пустой перевод** — автоматически подключается следующий:

```
# один провайдер
PROVIDER_ORDER=google-translate

# с автоматическим fallback
PROVIDER_ORDER=google-translate,google-dictionary-extension

# три провайдера, максимальная надёжность
PROVIDER_ORDER=google-translate,google-dictionary-extension,yandex-translate
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
