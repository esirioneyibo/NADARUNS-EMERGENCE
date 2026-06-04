import React, { useState } from "react";
import { StyleSheet, Text, View, LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import Animated, {
  Extrapolate,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { radius, theme } from "../theme";

interface Props {
  onGoOnline: () => void;
  disabled?: boolean;
  testID?: string;
}

const THUMB = 64;

export default function SlideToGoOnline({ onGoOnline, disabled, testID }: Props) {
  const { t } = useTranslation();
  const x = useSharedValue(0);
  const [width, setWidth] = useState(320);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const triggerComplete = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onGoOnline();
  };

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .onUpdate((e) => {
      const max = Math.max(0, width - THUMB - 8);
      x.value = Math.min(Math.max(0, e.translationX), max);
    })
    .onEnd(() => {
      const max = Math.max(0, width - THUMB - 8);
      if (x.value > max * 0.8) {
        x.value = withTiming(max, { duration: 120 }, (finished) => {
          if (finished) {
            runOnJS(triggerComplete)();
            x.value = withTiming(0, { duration: 300 });
          }
        });
      } else {
        x.value = withSpring(0, { damping: 14 });
      }
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: x.value + THUMB + 4,
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, width / 3], [1, 0], Extrapolate.CLAMP),
  }));

  const arrowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, width / 4], [1, 0.3], Extrapolate.CLAMP),
  }));

  return (
    <View
      style={[styles.track, disabled && { opacity: 0.6 }]}
      onLayout={onLayout}
      testID={testID}
    >
      <LinearGradient
        colors={[theme.primary, "#147B6D"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[styles.fill, fillStyle]} />
      <Animated.View style={[styles.labelContainer, labelStyle]}>
        <Text style={styles.label}>{t("driverHome.slideToGoOnline")}</Text>
        <Animated.View style={arrowStyle}>
          <Ionicons name="arrow-forward" size={20} color="rgba(255,255,255,0.7)" />
        </Animated.View>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.thumb, thumbStyle]} testID={`${testID}-thumb`}>
          <View style={styles.thumbInner}>
            <Ionicons name="power" size={28} color={theme.primary} />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  fill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 36,
  },
  labelContainer: {
    position: "absolute",
    left: THUMB + 16,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  label: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  thumbInner: {
    width: THUMB - 8,
    height: THUMB - 8,
    borderRadius: (THUMB - 8) / 2,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
});
