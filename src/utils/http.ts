import { ProviderError } from "./errors.js";

export async function fetchJson(
  url: URL,
  options: {
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
    signal: AbortSignal;
  }
): Promise<unknown> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal
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
  }
}
