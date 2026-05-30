import { createHash } from "node:crypto";
import type { DictionaryQuery } from "../types.js";

export function normalizeQuery(query: DictionaryQuery): DictionaryQuery {
  return {
    source: query.source.trim().toLowerCase(),
    target: query.target.trim().toLowerCase(),
    text: query.text.trim().replace(/\s+/g, " ")
  };
}

export function createDictionaryCacheKey(query: DictionaryQuery): string {
  const n = normalizeQuery(query);
  const textHash = createHash("sha1").update(n.text).digest("hex");
  return `dictionary:v1:${n.source}:${n.target}:${textHash}`;
}
