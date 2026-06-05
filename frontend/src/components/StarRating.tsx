import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

interface StarRatingProps {
  value: number;
  onChange?: (rating: number) => void;
  size?: number;
  color?: string;
  emptyColor?: string;
  readonly?: boolean;
  gap?: number;
  testIDPrefix?: string;
}

/**
 * Reusable 1-5 star rating control. Interactive when `onChange` is provided and
 * `readonly` is false; otherwise renders as a static display (supports halves
 * for aggregate averages).
 */
export default function StarRating({
  value,
  onChange,
  size = 36,
  color = "#F59E0B",
  emptyColor = "#D1D5DB",
  readonly = false,
  gap = 8,
  testIDPrefix = "star",
}: StarRatingProps) {
  const interactive = !readonly && typeof onChange === "function";

  const handlePress = (n: number) => {
    if (!interactive) return;
    Haptics.selectionAsync().catch(() => {});
    onChange?.(n);
  };

  return (
    <View style={[styles.row, { gap }]}>
      {[1, 2, 3, 4, 5].map((n) => {
        // For static display, support half stars from a fractional average.
        let iconName: keyof typeof Ionicons.glyphMap = "star";
        let filled = value >= n;
        if (!interactive && !filled && value >= n - 0.5) {
          iconName = "star-half";
          filled = true;
        }
        const Star = (
          <Ionicons
            name={filled ? iconName : "star-outline"}
            size={size}
            color={filled ? color : emptyColor}
          />
        );
        if (!interactive) {
          return (
            <View key={n} testID={`${testIDPrefix}-${n}`}>
              {Star}
            </View>
          );
        }
        return (
          <TouchableOpacity
            key={n}
            onPress={() => handlePress(n)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            testID={`${testIDPrefix}-${n}`}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${n} star${n > 1 ? "s" : ""}`}
          >
            {Star}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
