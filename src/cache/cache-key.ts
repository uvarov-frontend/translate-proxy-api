import { createHash } from "node:crypto";
import type { DictionaryQuery } from "../types.js";

export function normalizeQuery(query: { source: string; target: string; text: string }): DictionaryQuery {
  return {
    source: query.source.trim().toLowerCase(),
    target: query.target.trim().toLowerCase(),
    // Only trim leading/trailing whitespace — preserve internal structure (newlines,
    // paragraph breaks) so providers receive the text as the user intended it.
    text: query.text.trim()
  };
}

export function createDictionaryCacheKey(query: DictionaryQuery, provider?: string): string {
  // Hash the exact text sent upstream. Internal whitespace can affect translation,
  // so multiline and single-line inputs must never share a cached response.
  const textHash = createHash("sha1").update(query.text).digest("hex");
  const base = `dictionary:v1:${query.source}:${query.target}:${textHash}`;
  return provider ? `${base}:${provider}` : base;
}
