import React, { useState } from "react";
import { StyleSheet, Text, View, LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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
import { radius, theme } from "../theme";

interface Props {
  label: string;
  onComplete: () => void;
  testID?: string;
  color?: string;
}

const THUMB = 56;

export default function SwipeToConfirm({ label, onComplete, testID, color }: Props) {
  const x = useSharedValue(0);
  const [width, setWidth] = useState(280);

  const trackColor = color || theme.primary;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const triggerComplete = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onComplete();
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      const max = Math.max(0, width - THUMB - 8);
      x.value = Math.min(Math.max(0, e.translationX), max);
    })
    .onEnd(() => {
      const max = Math.max(0, width - THUMB - 8);
      if (x.value > max * 0.85) {
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
    opacity: interpolate(x.value, [0, width / 2], [1, 0], Extrapolate.CLAMP),
  }));

  return (
    <View
      style={[styles.track, { backgroundColor: `${trackColor}22` }]}
      onLayout={onLayout}
      testID={testID}
    >
      <Animated.View
        style={[styles.fill, { backgroundColor: `${trackColor}33` }, fillStyle]}
      />
      <Animated.Text style={[styles.label, { color: trackColor }, labelStyle]} numberOfLines={1}>
        {label}
      </Animated.Text>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.thumb, { backgroundColor: trackColor }, thumbStyle]}
          testID={`${testID}-thumb`}
        >
          <Ionicons name="chevron-forward" size={26} color="#fff" />
          <Ionicons name="chevron-forward" size={26} color="#fff" style={styles.chev2} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 64,
    borderRadius: radius.pill,
    justifyContent: "center",
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  fill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.pill,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    marginLeft: 0,
  },
  chev2: {
    marginLeft: -18,
    opacity: 0.6,
  },
  label: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});

// Hide Text import warning – we use Animated.Text. Keep this just for clarity:
export const _Text = Text;
