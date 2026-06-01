import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";

import { useLanguage, LANGUAGE_LABELS } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { radius, spacing } from "../theme";

interface LanguageSelectorProps {
  /** Accent color used for the selected tile (defaults to theme.primary). */
  accentColor?: string;
}

/**
 * A two-option language toggle (English / Suomi) that persists the choice and
 * switches the whole app instantly. Drop it inside any settings screen.
 */
export default function LanguageSelector({ accentColor }: LanguageSelectorProps) {
  const { theme } = useTheme();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const { t } = useTranslation();
  const accent = accentColor || theme.primary;
  const styles = createStyles(theme);

  return (
    <View style={styles.grid}>
      {supportedLanguages.map((lang) => {
        const selected = lang === language;
        return (
          <TouchableOpacity
            key={lang}
            style={[styles.tile, selected && { backgroundColor: accent, borderColor: accent }]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setLanguage(lang);
            }}
            testID={`language-${lang}`}
            accessibilityRole="button"
            accessibilityLabel={LANGUAGE_LABELS[lang]}
          >
            <Ionicons
              name="language"
              size={20}
              color={selected ? "#fff" : theme.textPrimary}
            />
            <Text style={[styles.label, selected && { color: "#fff" }]}>
              {LANGUAGE_LABELS[lang]}
            </Text>
            {selected ? (
              <Ionicons name="checkmark-circle" size={16} color="#fff" />
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    grid: { flexDirection: "row", gap: 8, paddingVertical: spacing.sm },
    tile: {
      flex: 1,
      flexDirection: "row",
      paddingVertical: 14,
      paddingHorizontal: 10,
      borderRadius: radius.lg,
      backgroundColor: theme.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: 1.5,
      borderColor: "transparent",
    },
    label: { fontSize: 14, color: theme.textPrimary, fontWeight: "600" },
  });
