import React, { useState } from "react";
import { Alert, Linking, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { radius, shadows, theme } from "../theme";

interface Props {
  destination: {
    lat: number;
    lng: number;
    address?: string;
    name?: string;
  };
  label?: string;
  testID?: string;
}

/**
 * Opens the driver's preferred navigation app (Google Maps, Waze, or Apple Maps)
 * for turn-by-turn navigation. Presents a chooser so drivers can hand off to
 * whichever app they prefer.
 */
export default function NavigateButton({ destination, label, testID }: Props) {
  const [showOptions, setShowOptions] = useState(false);
  const { lat, lng } = destination;

  const open = async (url: string, fallback?: string) => {
    setShowOptions(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const can = await Linking.canOpenURL(url);
      if (can) {
        await Linking.openURL(url);
      } else if (fallback) {
        await Linking.openURL(fallback);
      } else {
        throw new Error("cannot open");
      }
    } catch {
      Alert.alert("Navigation", "Could not open the selected maps app. Is it installed?");
    }
  };

  const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  const wazeUrl = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  const appleUrl = `maps://app?daddr=${lat},${lng}&dirflg=d`;

  const options = [
    { key: "google", name: "Google Maps", icon: "navigate" as const, color: "#4285F4", onPress: () => open(googleUrl) },
    { key: "waze", name: "Waze", icon: "car-sport" as const, color: "#33CCFF", onPress: () => open(wazeUrl, googleUrl) },
  ];
  if (Platform.OS === "ios") {
    options.push({ key: "apple", name: "Apple Maps", icon: "map" as const, color: "#34C759", onPress: () => open(appleUrl, googleUrl) });
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.button, shadows.md]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          setShowOptions(true);
        }}
        activeOpacity={0.85}
        testID={testID || "navigate-button"}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="navigate" size={20} color="#fff" />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.label}>{label || "Navigate"}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            Choose your maps app
          </Text>
        </View>
        <Ionicons name="chevron-up" size={18} color={theme.primary} />
      </TouchableOpacity>

      <Modal visible={showOptions} transparent animationType="fade" onRequestClose={() => setShowOptions(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowOptions(false)}>
          <View style={[styles.sheet, shadows.lg]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Navigate with</Text>
            {options.map((o) => (
              <TouchableOpacity
                key={o.key}
                style={styles.optionRow}
                onPress={o.onPress}
                testID={`navigate-${o.key}`}
              >
                <View style={[styles.optionIcon, { backgroundColor: o.color }]}>
                  <Ionicons name={o.icon} size={20} color="#fff" />
                </View>
                <Text style={styles.optionName}>{o.name}</Text>
                <Ionicons name="open-outline" size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowOptions(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.primary + "30",
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: { flex: 1 },
  label: { fontSize: 15, fontWeight: "700", color: theme.textPrimary },
  subtitle: { fontSize: 12, color: theme.textSecondary, marginTop: 1 },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: 20,
    paddingBottom: 36,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.border,
    marginBottom: 16,
  },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: theme.textPrimary, marginBottom: 12 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  optionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  optionName: { flex: 1, fontSize: 16, fontWeight: "700", color: theme.textPrimary },
  cancelBtn: { marginTop: 16, paddingVertical: 14, alignItems: "center", borderRadius: radius.lg, backgroundColor: theme.surfaceMuted },
  cancelText: { fontSize: 16, fontWeight: "700", color: theme.textPrimary },
});
