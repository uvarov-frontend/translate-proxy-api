import { randomBytes } from "node:crypto";
import { config } from "../config/env.js";
import type { DictionaryProvider, DictionaryQuery, ProviderResult } from "../types.js";
import { fetchJson } from "../utils/http.js";

const PROVIDER_NAME = "yandex-translate";
const UPSTREAM_ORIGIN = "https://translate.yandex.net";

export class YandexTranslateProvider implements DictionaryProvider {
  readonly name = PROVIDER_NAME;

  async lookup(query: DictionaryQuery, signal: AbortSignal): Promise<ProviderResult> {
    const url = new URL("/api/v1/tr.json/translate", UPSTREAM_ORIGIN);
    url.searchParams.set("srv", "tr-url-widget");
    url.searchParams.set("id", `${randomBytes(16).toString("hex")}-0-0`);
    url.searchParams.set("lang", `${query.source}-${query.target}`);
    url.searchParams.set("text", query.text);

    const payload = await fetchJson(url, {
      method: "GET",
      timeoutMs: config.httpTimeoutMs,
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://translate.yandex.com/"
      }
    });

    return {
      provider: this.name,
      data: {
        text: normalizeProviderPayload(payload)
      }
    };
  }
}

function normalizeProviderPayload(payload: unknown): string {
  // Response: { code: 200, lang: "en-ru", text: ["Привет"] }
  if (!payload || typeof payload !== "object") return "";

  const text = (payload as Record<string, unknown>).text;
  if (!Array.isArray(text)) return "";

  return text
    .filter((t: unknown) => typeof t === "string")
    .join("")
    .trim();
}
