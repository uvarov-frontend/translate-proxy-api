import type { DictionaryProvider } from "../types.js";
import { ProviderError } from "../utils/errors.js";
import { GoogleDictionaryExtensionProvider } from "./google-dictionary-extension.js";
import { GoogleTranslateProvider } from "./google-translate.js";
import { YandexTranslateProvider } from "./yandex-translate.js";

export function buildProviderByName(name: string): DictionaryProvider {
  if (name === "google-translate") {
    return new GoogleTranslateProvider();
  }

  if (name === "google-dictionary-extension") {
    return new GoogleDictionaryExtensionProvider();
  }

  if (name === "yandex-translate") {
    return new YandexTranslateProvider();
  }

  throw new ProviderError(`Unknown provider: ${name}`, "UNKNOWN_PROVIDER");
}
