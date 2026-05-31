export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode?: number,
    readonly cause?: unknown // upstream error or array of per-provider errors
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}
