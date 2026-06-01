import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface JobMarkerProps {
  count: number;
  earnings: number;
  isSelected?: boolean;
}

// NadaRuns brand green
const GREEN = "#10B981";
const GREEN_DARK = "#0C8C66";
const GREEN_DEEP = "#0C4A42";

/**
 * Elevated "price bubble" map marker for available jobs.
 *
 * The bubble acts as a container for real-time info (payout, job count) and
 * stands out from the map via a baked drop-shadow (works on Android too, where
 * elevation shadows are not captured inside the marker bitmap). A downward
 * pointer tip is the lowest pixel of the view, so combined with the marker's
 * anchor={{ x: 0.5, y: 1 }} the tip sits exactly on the coordinate.
 */
export default function JobMarker({ count, earnings, isSelected = false }: JobMarkerProps) {
  const showBadge = count > 1;
  const scale = isSelected ? 1.08 : 1;
  const bg = isSelected ? GREEN_DEEP : GREEN;
  const label = `€${earnings >= 10 ? Math.round(earnings) : earnings.toFixed(0)}`;

  return (
    <View style={styles.container}>
      <View style={[styles.wrap, { transform: [{ scale }] }]}>
        {/* Baked soft shadow so the marker lifts off the map on every platform */}
        <View style={styles.shadowBlob} />

        {/* Info bubble */}
        <View style={[styles.bubble, { backgroundColor: bg }]}>
          <View style={styles.iconCircle}>
            <Ionicons name="time" size={12} color={GREEN_DARK} />
          </View>
          <Text style={styles.priceText}>{label}</Text>
        </View>

        {/* Pointer tip (white outline + colored inner) — bottom = the coordinate */}
        <View style={styles.pointerWrap}>
          <View style={styles.pointerOuter} />
          <View style={[styles.pointerInner, { borderTopColor: bg }]} />
        </View>

        {showBadge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "flex-end",
    // padding gives the iOS shadow room so it isn't clipped by the marker bounds
    paddingTop: 6,
    paddingHorizontal: 8,
  },
  wrap: {
    alignItems: "center",
  },
  shadowBlob: {
    position: "absolute",
    top: 6,
    left: 4,
    right: 4,
    height: 30,
    borderRadius: 16,
    backgroundColor: "rgba(8, 47, 42, 0.35)",
  },
  bubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    // iOS native shadow (captured in the marker snapshot on iOS)
    shadowColor: GREEN_DEEP,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 8,
  },
  iconCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  priceText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  pointerWrap: {
    marginTop: -2,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  // White outline triangle (slightly larger, sits behind the colored one)
  pointerOuter: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 13,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#FFFFFF",
  },
  // Colored inner triangle (matches the bubble) — its tip is the marker point
  pointerInner: {
    position: "absolute",
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 9,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: "#fff",
    elevation: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },
});
