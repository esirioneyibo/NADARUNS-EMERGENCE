import React from "react";
import { Alert, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
 * Opens native maps app (Google Maps or Apple Maps) for turn-by-turn navigation.
 */
export default function NavigateButton({ destination, label, testID }: Props) {
  const openNavigation = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    const { lat, lng, name } = destination;
    const encodedName = encodeURIComponent(name || "Destination");
    
    // Google Maps URL (works on both iOS and Android)
    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    
    // Apple Maps URL (iOS only)
    const appleMapsUrl = `maps://app?daddr=${lat},${lng}&dirflg=d`;
    
    // For iOS, try Apple Maps first, then Google Maps
    // For Android, use Google Maps directly
    try {
      if (Platform.OS === "ios") {
        const canOpenAppleMaps = await Linking.canOpenURL(appleMapsUrl);
        if (canOpenAppleMaps) {
          await Linking.openURL(appleMapsUrl);
          return;
        }
      }
      
      // Fallback to Google Maps (web URL works on all platforms)
      const canOpenGoogle = await Linking.canOpenURL(googleMapsUrl);
      if (canOpenGoogle) {
        await Linking.openURL(googleMapsUrl);
      } else {
        // Last resort: open in browser
        await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
      }
    } catch (error) {
      Alert.alert(
        "Navigation Error",
        "Could not open maps app. Please make sure you have a maps app installed.",
        [{ text: "OK" }]
      );
    }
  };

  return (
    <TouchableOpacity
      style={[styles.button, shadows.md]}
      onPress={openNavigation}
      activeOpacity={0.85}
      testID={testID || "navigate-button"}
    >
      <View style={styles.iconWrap}>
        <Ionicons name="navigate" size={20} color="#fff" />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.label}>{label || "Navigate"}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          Open in Maps
        </Text>
      </View>
      <Ionicons name="open-outline" size={18} color={theme.primary} />
    </TouchableOpacity>
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
  textWrap: {
    flex: 1,
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: theme.textSecondary,
    marginTop: 1,
  },
});
