import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path, Defs, LinearGradient, Stop } from "react-native-svg";
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

// Classic teardrop map-pin path (viewBox 0 0 48 60), rounded head + point.
const PIN_PATH =
  "M24 1 C11.85 1 2 10.85 2 23 c0 15.4 19.2 33.4 21.1 35.1 a1.35 1.35 0 0 0 1.8 0 C26.8 56.4 46 38.4 46 23 46 10.85 36.15 1 24 1 Z";

/**
 * Custom map marker for available jobs.
 * Green teardrop pin with a clock glyph (jobs waiting to be picked up) and the
 * payout below. A count badge appears when several jobs share a location.
 */
export default function JobMarker({ count, earnings, isSelected = false }: JobMarkerProps) {
  const showBadge = count > 1;
  const size = isSelected ? 1.12 : 1;

  return (
    <View style={styles.container}>
      <View style={[styles.pinWrap, { transform: [{ scale: size }] }]}>
        <Svg width={48} height={60} viewBox="0 0 48 60">
          <Defs>
            <LinearGradient id="pinGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={GREEN} />
              <Stop offset="1" stopColor={isSelected ? GREEN_DEEP : GREEN_DARK} />
            </LinearGradient>
          </Defs>
          {/* White outline for contrast on the map */}
          <Path d={PIN_PATH} fill="#FFFFFF" />
          <Path d={PIN_PATH} fill="url(#pinGrad)" stroke="#FFFFFF" strokeWidth={2.5} />
        </Svg>

        {/* White head circle with clock icon */}
        <View style={styles.head}>
          <Ionicons name="time" size={22} color={GREEN_DARK} />
        </View>

        {showBadge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        )}
      </View>

      {/* Payout pill */}
      <View style={styles.pricePill}>
        <Text style={styles.priceText}>
          €{earnings >= 10 ? Math.round(earnings) : earnings.toFixed(0)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "flex-end",
  },
  pinWrap: {
    width: 48,
    height: 60,
    alignItems: "center",
  },
  head: {
    position: "absolute",
    top: 6,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  pricePill: {
    marginTop: -4,
    backgroundColor: GREEN_DEEP,
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  priceText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  badge: {
    position: "absolute",
    top: -2,
    right: 2,
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
