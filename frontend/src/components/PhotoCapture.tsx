import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInUp, ZoomIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { radius, spacing, theme } from "../theme";

interface Props {
  /** existing data-URI base64 photo (if any) */
  photo?: string | null;
  /** invoked with a base64 data URI after capture; component is uncontrolled until parent updates `photo` */
  onCapture: (dataUri: string) => Promise<void> | void;
  /** caller can render in disabled state e.g. during network upload */
  busy?: boolean;
  /** Custom title for the component */
  title?: string;
  /** Custom subtitle when no photo */
  subtitle?: string;
  testID?: string;
}

export default function PhotoCapture({ photo, onCapture, busy, title, subtitle, testID }: Props) {
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    if (requesting || busy) return;
    setError(null);
    setRequesting(true);
    try {
      Haptics.selectionAsync().catch(() => {});

      // On native, try camera first; gracefully fall back to library if user denies camera.
      let result: ImagePicker.ImagePickerResult | null = null;

      if (Platform.OS !== "web") {
        const cam = await ImagePicker.requestCameraPermissionsAsync();
        if (cam.granted) {
          result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.55,
            base64: true,
            allowsEditing: false,
            cameraType: ImagePicker.CameraType.back,
          });
        }
      }

      // Web (or camera denied) → image library / file picker
      if (!result) {
        const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!lib.granted && Platform.OS !== "web") {
          setError("Camera and library permissions are required");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.55,
          base64: true,
          allowsEditing: false,
        });
      }

      if (!result || result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      let dataUri: string | null = null;
      if (asset.base64) {
        const mime = asset.mimeType || "image/jpeg";
        dataUri = `data:${mime};base64,${asset.base64}`;
      } else if (asset.uri && asset.uri.startsWith("data:")) {
        dataUri = asset.uri;
      } else if (asset.uri && Platform.OS === "web") {
        // Fetch the blob and convert to base64 (web fallback when base64 wasn't supplied)
        const blob = await (await fetch(asset.uri)).blob();
        dataUri = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onerror = () => reject(new Error("Failed to read file"));
          r.onloadend = () => resolve(String(r.result));
          r.readAsDataURL(blob);
        });
      }

      if (!dataUri) {
        setError("Could not read the selected image");
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await onCapture(dataUri);
    } catch (e: any) {
      setError(e?.message || "Failed to capture photo");
    } finally {
      setRequesting(false);
    }
  };

  const showBusy = requesting || busy;

  return (
    <Animated.View
      entering={FadeInUp.duration(260)}
      style={styles.wrap}
      testID={testID || "photo-capture"}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerIcon}>
          <Ionicons name="camera-outline" size={16} color={theme.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title || "Delivery proof"}</Text>
          <Text style={styles.subtitle}>
            {photo ? "Photo attached" : (subtitle || "Snap a photo of the handed-over order")}
          </Text>
        </View>
        {photo ? (
          <Animated.View entering={ZoomIn.springify().damping(14)}>
            <Ionicons name="checkmark-circle" size={22} color={theme.success} />
          </Animated.View>
        ) : null}
      </View>

      {photo ? (
        <View style={styles.previewRow}>
          <Animated.View entering={FadeIn.duration(220)}>
            <Image source={{ uri: photo }} style={styles.thumb} testID="photo-thumb" />
          </Animated.View>
          <TouchableOpacity
            onPress={pick}
            disabled={showBusy}
            style={styles.retakeBtn}
            testID="photo-retake"
          >
            {showBusy ? (
              <ActivityIndicator color={theme.primary} size="small" />
            ) : (
              <>
                <Ionicons name="refresh" size={16} color={theme.primary} />
                <Text style={styles.retakeText}>Retake</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={pick}
          disabled={showBusy}
          style={[styles.captureBtn, showBusy && { opacity: 0.7 }]}
          testID="photo-capture-button"
        >
          {showBusy ? (
            <ActivityIndicator color={theme.primary} />
          ) : (
            <>
              <Ionicons name="camera" size={22} color={theme.primary} />
              <Text style={styles.captureText}>Take photo</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: theme.border,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: spacing.sm,
  },
  headerIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 14, fontWeight: "700", color: theme.textPrimary },
  subtitle: { fontSize: 11, color: theme.textSecondary, marginTop: 1 },
  captureBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: theme.primaryLight,
    borderWidth: 1,
    borderColor: theme.primary + "40",
    borderStyle: "dashed",
  },
  captureText: { fontSize: 14, fontWeight: "700", color: theme.primary },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  thumb: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    backgroundColor: theme.surfaceMuted,
  },
  retakeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.primaryLight,
    borderRadius: radius.pill,
  },
  retakeText: { fontSize: 13, fontWeight: "700", color: theme.primary },
  error: {
    marginTop: 8,
    fontSize: 12,
    color: theme.error,
    fontWeight: "600",
  },
});
