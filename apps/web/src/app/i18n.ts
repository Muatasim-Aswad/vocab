import { createInstance, type i18n } from "i18next";
import { initReactI18next } from "react-i18next";

import { sessionMessages } from "../features/session/index.ts";
import { vocabularyMessages } from "../features/vocabulary/index.ts";
import { locales, type Locale } from "../infra/preferences.ts";
import { appMessages } from "./messages.ts";

const catalog = (locale: Locale) => ({
  ...appMessages[locale],
  session: sessionMessages[locale],
  vocab: vocabularyMessages[locale],
});

/** A synchronous i18next instance with every catalog bundled; locale plural rules come from Intl. */
export function createI18n(locale: Locale): i18n {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    lng: locale,
    fallbackLng: "en",
    supportedLngs: [...locales],
    resources: Object.fromEntries(locales.map((code) => [code, { translation: catalog(code) }])),
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}
