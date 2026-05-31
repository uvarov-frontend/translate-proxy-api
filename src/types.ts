export type DictionaryQuery = {
  source: string;
  target: string;
  text: string;
};

export type TranslationData = {
  text: string;
};

export type ApiSuccessResponse = {
  ok: true;
  data: TranslationData;
};

export type ApiErrorResponse = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type ApiResponse = ApiSuccessResponse | ApiErrorResponse;

export type ProviderResult = {
  provider: string;
  data: TranslationData;
};

export interface DictionaryProvider {
  readonly name: string;
  lookup(query: DictionaryQuery, signal: AbortSignal): Promise<ProviderResult>;
}
