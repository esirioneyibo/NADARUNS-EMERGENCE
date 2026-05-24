import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const palette = {
  light: {
    background: "#F8FAFC",
    surface: "#FFFFFF",
    surfaceMuted: "#F1F5F9",
    primary: "#0C4A42",
    primaryActive: "#147B6D",
    primaryLight: "#E6F2F0",
    secondary: "#0F172A",
    textPrimary: "#0F172A",
    textSecondary: "#64748B",
    textInverse: "#FFFFFF",
    border: "#E2E8F0",
    success: "#10B981",
    warning: "#F59E0B",
    error: "#EF4444",
    routeLine: "#0C4A42",
    mapBg: "#E8EDE8",
    mapGrid: "#D9E2DC",
    mapRoad: "#FFFFFF",
  },
  dark: {
    background: "#0A0A0A",
    surface: "#1C1C1E",
    surfaceMuted: "#26262A",
    primary: "#1BB5A0",
    primaryActive: "#22D3B8",
    primaryLight: "rgba(27, 181, 160, 0.18)",
    secondary: "#F8FAFC",
    textPrimary: "#F8FAFC",
    textSecondary: "#94A3B8",
    textInverse: "#0A0A0A",
    border: "#2D2D30",
    success: "#34D399",
    warning: "#FBBF24",
    error: "#F87171",
    routeLine: "#1BB5A0",
    mapBg: "#101415",
    mapGrid: "#1A2022",
    mapRoad: "#23292C",
  },
};

export type ThemeColors = typeof palette.light;
export type ThemeMode = "light" | "dark" | "system";

interface ThemeContextType {
  theme: ThemeColors;
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = "@nadaruns_theme_mode";

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemColorScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [isLoaded, setIsLoaded] = useState(false);

  // Load saved theme preference on mount
  useEffect(() => {
    (async () => {
      try {
        const savedMode = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedMode && ["light", "dark", "system"].includes(savedMode)) {
          setModeState(savedMode as ThemeMode);
        }
      } catch (e) {
        console.warn("Failed to load theme preference:", e);
      } finally {
        setIsLoaded(true);
      }
    })();
  }, []);

  // Save theme preference when it changes
  const setMode = async (newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newMode);
    } catch (e) {
      console.warn("Failed to save theme preference:", e);
    }
  };

  // Determine if dark mode based on mode setting and system preference
  const isDark = mode === "dark" || (mode === "system" && systemColorScheme === "dark");

  // Select the appropriate theme colors
  const theme = isDark ? palette.dark : palette.light;

  // Don't render until we've loaded the saved preference
  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider value={{ theme, mode, isDark, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

// Export palette for direct access if needed
export { palette };
