import { ProviderError } from "./errors.js";

export async function fetchJson(
  url: URL,
  options: {
    headers?: Record<string, string>;
    timeoutMs: number;
    signal: AbortSignal;
  }
): Promise<unknown> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), options.timeoutMs);

  const relayAbort = () => timeoutController.abort();
  options.signal.addEventListener("abort", relayAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: options.headers,
      signal: timeoutController.signal
    });

    if (!response.ok) {
      throw new ProviderError(
        `Upstream responded with ${response.status}`,
        "UPSTREAM_BAD_STATUS",
        response.status
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }

    throw new ProviderError("Upstream request failed", "UPSTREAM_REQUEST_FAILED", undefined, error);
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", relayAbort);
  }
}
