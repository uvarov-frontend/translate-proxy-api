export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode?: number,
    readonly cause?: unknown
  ) {
    super(message);
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}
