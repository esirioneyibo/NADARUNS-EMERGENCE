import { Platform } from "react-native";

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
    primary: "#147B6D",
    primaryActive: "#1BB5A0",
    primaryLight: "rgba(20, 123, 109, 0.22)",
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

export const theme = palette.light; // app uses light theme by default; could expand to system later

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 999,
};

export const shadows = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
  },
};

export const font = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "System",
}) as string;
