import type { DictionaryProvider, DictionaryQuery, ProviderResult } from "../types.js";
import { ProviderError } from "../utils/errors.js";
import {
  isProviderAvailable,
  recordProviderSuccess,
  recordProviderFailure
} from "../utils/circuit-breaker.js";

export async function runProviders(
  providers: DictionaryProvider[],
  query: DictionaryQuery,
  signal: AbortSignal
): Promise<ProviderResult> {
  const errors: Array<{ provider: string; message: string }> = [];

  // Saved for the case where every provider returns an empty translation —
  // that is a legitimate result (unsupported language pair), not a failure.
  let emptyResult: ProviderResult | undefined;

  for (const provider of providers) {
    if (!isProviderAvailable(provider.name)) {
      errors.push({ provider: provider.name, message: "Circuit open — provider temporarily skipped" });
      continue;
    }

    try {
      const result = await provider.lookup(query, signal);

      if (result.data.text) {
        // Non-empty translation — accept immediately.
        recordProviderSuccess(provider.name);
        return result;
      }

      // Empty translation — remember the first one and try the next provider.
      // Do NOT count as a circuit-breaker failure: the HTTP call itself succeeded.
      recordProviderSuccess(provider.name);
      if (!emptyResult) emptyResult = result;
      errors.push({ provider: provider.name, message: "Provider returned empty translation" });
    } catch (error) {
      recordProviderFailure(provider.name);
      errors.push({
        provider: provider.name,
        message: error instanceof Error ? error.message : "Unknown provider error"
      });
    }
  }

  // All providers failed with errors, but at least one returned an empty string —
  // return the empty result rather than a 502 (it means "no translation found").
  if (emptyResult) return emptyResult;

  throw new ProviderError("All dictionary providers failed", "ALL_PROVIDERS_FAILED", undefined, errors);
}
