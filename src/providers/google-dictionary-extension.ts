import { config } from "../config/env.js";
import type {
  DictionaryProvider,
  DictionaryQuery,
  ProviderResult
} from "../types.js";
import { ProviderError } from "../utils/errors.js";
import { fetchJson } from "../utils/http.js";

const PROVIDER_NAME = "google-dictionary-extension";
const UPSTREAM_ORIGIN = "https://content-dictionaryextension-pa.googleapis.com";
const GOOGLE_DICTIONARY_API_KEY = "AIzaSyA6EEtrDCfBkHV8uU2lgGY-N383ZgAOo7Y";

export class GoogleDictionaryExtensionProvider implements DictionaryProvider {
  readonly name = PROVIDER_NAME;

  async lookup(query: DictionaryQuery, signal: AbortSignal): Promise<ProviderResult> {
    const url = new URL("/v1/dictionaryExtensionData", UPSTREAM_ORIGIN);
    url.searchParams.set("language", query.target);
    url.searchParams.set("key", GOOGLE_DICTIONARY_API_KEY);
    url.searchParams.set("term", query.text);
    url.searchParams.set("strategy", "2");

    const payload = await fetchJson(url, {
      timeoutMs: config.httpTimeoutMs,
      signal,
      headers: {
        "x-referer": "chrome-extension://mgijmajocgfcbeboacabfgobmjgjcoja"
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
  const translateResponse = readRecord(payload, "translateResponse");
  if (translateResponse) {
    const primaryTranslation = readString(translateResponse.translateText);
    if (primaryTranslation) {
      return primaryTranslation;
    }
  }

  return firstStringByKey(payload, [
    "translation",
    "translations",
    "translatedText",
    "term"
  ]) ?? "";
}

function firstStringByKey(value: unknown, keys: string[]): string | undefined {
  const wantedKeys = new Set(keys.map((key) => key.toLowerCase()));
  let result: string | undefined;

  walkJson(value, (key, nestedValue) => {
    if (result || !key || !wantedKeys.has(key.toLowerCase())) return;

    if (typeof nestedValue === "string") {
      const trimmed = nestedValue.trim();
      if (trimmed) result = trimmed;
      return;
    }

    if (Array.isArray(nestedValue)) {
      for (const item of nestedValue) {
        if (typeof item === "string") {
          const trimmed = item.trim();
          if (trimmed) { result = trimmed; return; }
        }
      }
    }
  });

  return result;
}

function readRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;

  const nested = (value as Record<string, unknown>)[key];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    return undefined;
  }

  return nested as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed || undefined;
}

function walkJson(
  value: unknown,
  visitor: (key: string | undefined, value: unknown) => void,
  key?: string
): void {
  visitor(key, value);

  if (Array.isArray(value)) {
    for (const item of value) {
      walkJson(item, visitor);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      walkJson(nestedValue, visitor, nestedKey);
    }
  }
}
