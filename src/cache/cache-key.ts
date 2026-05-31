import { createHash } from "node:crypto";
import type { DictionaryQuery } from "../types.js";

export function normalizeQuery(query: DictionaryQuery): DictionaryQuery {
  return {
    source: query.source.trim().toLowerCase(),
    target: query.target.trim().toLowerCase(),
    text: query.text.trim().replace(/\s+/g, " ")
  };
}

export function createDictionaryCacheKey(query: DictionaryQuery, provider?: string): string {
  const textHash = createHash("sha1").update(query.text).digest("hex");
  const base = `dictionary:v1:${query.source}:${query.target}:${textHash}`;
  return provider ? `${base}:${provider}` : base;
}
