import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import i18n, { AppLanguage, LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from "../i18n";

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  en: "English",
  fi: "Suomi",
};

interface LanguageContextType {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
  supportedLanguages: readonly AppLanguage[];
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

interface LanguageProviderProps {
  children: ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [language, setLanguageState] = useState<AppLanguage>(
    (i18n.language as AppLanguage) || "en"
  );
  const [isLoaded, setIsLoaded] = useState(false);

  // Apply the persisted language preference (overrides the device default).
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (saved && (SUPPORTED_LANGUAGES as readonly string[]).includes(saved)) {
          if (saved !== i18n.language) {
            await i18n.changeLanguage(saved);
          }
          setLanguageState(saved as AppLanguage);
        }
      } catch (e) {
        console.warn("Failed to load language preference:", e);
      } finally {
        setIsLoaded(true);
      }
    })();
  }, []);

  const setLanguage = async (lang: AppLanguage) => {
    setLanguageState(lang);
    try {
      await i18n.changeLanguage(lang);
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch (e) {
      console.warn("Failed to save language preference:", e);
    }
  };

  if (!isLoaded) {
    return null;
  }

  return (
    <LanguageContext.Provider
      value={{ language, setLanguage, supportedLanguages: SUPPORTED_LANGUAGES }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
