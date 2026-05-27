import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

interface JobMarkerProps {
  count: number;
  earnings: number;
  isSelected?: boolean;
}

/**
 * Custom map marker for job discovery.
 * Shows a teardrop pin with job count badge when multiple orders at same location.
 * 
 * Design: Orange/coral teardrop pin (NadaRuns brand color) with white center
 * When count > 1, shows badge with count number
 */
export default function JobMarker({ count, earnings, isSelected = false }: JobMarkerProps) {
  const showBadge = count > 1;
  
  return (
    <View style={styles.container}>
      {/* Main teardrop pin */}
      <View style={[
        styles.pin,
        isSelected && styles.pinSelected,
      ]}>
        {/* Inner white circle */}
        <View style={styles.pinInner}>
          <Text style={styles.priceText}>
            €{earnings >= 10 ? Math.round(earnings) : earnings.toFixed(0)}
          </Text>
        </View>
        
        {/* Pointer at bottom */}
        <View style={[
          styles.pinPointer,
          isSelected && styles.pinPointerSelected,
        ]} />
      </View>
      
      {/* Count badge (shown when multiple orders at same location) */}
      {showBadge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      )}
    </View>
  );
}

const BRAND_COLOR = "#F97316"; // NadaRuns orange
const BRAND_COLOR_DARK = "#EA580C"; // Darker orange for selected state

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "flex-end",
  },
  pin: {
    width: 48,
    height: 56,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 6,
  },
  pinSelected: {
    transform: [{ scale: 1.15 }],
  },
  pinInner: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: BRAND_COLOR,
    alignItems: "center",
    justifyContent: "center",
    // Shadow for depth
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
    // White border
    borderWidth: 3,
    borderColor: "#fff",
  },
  priceText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  pinPointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 12,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: BRAND_COLOR,
    marginTop: -3,
    // Shadow for pointer
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  pinPointerSelected: {
    borderTopColor: BRAND_COLOR_DARK,
  },
  badge: {
    position: "absolute",
    top: 0,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#EF4444", // Red badge
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    // White border
    borderWidth: 2,
    borderColor: "#fff",
    // Shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },
});
