import React, { useEffect } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { radius, shadows, theme } from "../theme";

interface Props {
  children: React.ReactNode;
  visible?: boolean;
  style?: ViewStyle;
  testID?: string;
}

/**
 * Lightweight animated bottom sheet driven by `visible` prop.
 * Slides up with a spring animation. Heights are content-driven.
 */
export default function BottomSheet({ children, visible = true, style, testID }: Props) {
  const offset = useSharedValue(visible ? 0 : 600);

  useEffect(() => {
    offset.value = withSpring(visible ? 0 : 600, {
      damping: 18,
      stiffness: 160,
      mass: 0.9,
    });
  }, [visible, offset]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  return (
    <Animated.View style={[styles.sheet, shadows.lg, animatedStyle, style]} testID={testID}>
      <View style={styles.handle} />
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    backgroundColor: theme.border,
    borderRadius: 3,
    marginBottom: 14,
  },
});
