import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";

import en from "./locales/en.json";
import fi from "./locales/fi.json";

export const SUPPORTED_LANGUAGES = ["en", "fi"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = "@nadaruns_language";

// Synchronously detect the device language so the very first render is already
// localized. The saved AsyncStorage preference (if any) is applied right after
// mount by the LanguageProvider.
function detectDeviceLanguage(): AppLanguage {
  try {
    const code = getLocales()?.[0]?.languageCode?.toLowerCase();
    if (code && (SUPPORTED_LANGUAGES as readonly string[]).includes(code)) {
      return code as AppLanguage;
    }
  } catch {
    // expo-localization can throw on some web environments – fall back to en.
  }
  return "en";
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      fi: { translation: fi },
    },
    lng: detectDeviceLanguage(),
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export default i18n;
