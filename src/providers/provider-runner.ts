import type { DictionaryProvider, DictionaryQuery, ProviderResult } from "../types.js";
import { ProviderError } from "../utils/errors.js";

export async function runProviders(
  providers: DictionaryProvider[],
  query: DictionaryQuery,
  signal: AbortSignal
): Promise<ProviderResult> {
  const errors: Array<{ provider: string; message: string }> = [];

  for (const provider of providers) {
    try {
      return await provider.lookup(query, signal);
    } catch (error) {
      errors.push({
        provider: provider.name,
        message: error instanceof Error ? error.message : "Unknown provider error"
      });
    }
  }

  throw new ProviderError("All dictionary providers failed", "ALL_PROVIDERS_FAILED", undefined, errors);
}
