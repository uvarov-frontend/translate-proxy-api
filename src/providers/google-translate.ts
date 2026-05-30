import { config } from "../config/env.js";
import type { DictionaryProvider, DictionaryQuery, ProviderResult } from "../types.js";
import { fetchJson } from "../utils/http.js";

const PROVIDER_NAME = "google-translate";
const UPSTREAM_ORIGIN = "https://translate.googleapis.com";

export class GoogleTranslateProvider implements DictionaryProvider {
  readonly name = PROVIDER_NAME;

  async lookup(query: DictionaryQuery, signal: AbortSignal): Promise<ProviderResult> {
    const url = new URL("/translate_a/single", UPSTREAM_ORIGIN);
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", query.source);
    url.searchParams.set("tl", query.target);
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", query.text);

    const payload = await fetchJson(url, {
      timeoutMs: config.httpTimeoutMs,
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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
  // Response format: [[["translated seg 1","original seg 1"], ["translated seg 2", ...]], ...]
  // Multiple segments appear when the text is long — join them all.
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return "";

  return payload[0]
    .map((segment: unknown) => (Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : ""))
    .join("")
    .trim();
}
