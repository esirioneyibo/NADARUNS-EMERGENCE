import React, { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Dimensions,
  Animated as RNAnimated,
} from "react-native";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { radius, shadows, spacing, theme } from "../theme";

interface Props {
  visible: boolean;
  kind: "pickup" | "dropoff";
  expectedHint?: string;
  onClose: () => void;
  onSubmit: (otp: string) => Promise<void>;
  error?: string | null;
}

const OTP_LENGTH = 4;
const { height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function OtpModal({ visible, kind, expectedHint, onClose, onSubmit, error }: Props) {
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [submitting, setSubmitting] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const inputs = useRef<Array<TextInput | null>>([]);
  const translateY = useRef(new RNAnimated.Value(0)).current;

  // Track keyboard height and animate sheet position
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => {
        const height = e.endCoordinates.height;
        setKeyboardHeight(height);
        // Animate sheet up when keyboard shows
        RNAnimated.timing(translateY, {
          toValue: -height,
          duration: Platform.OS === "ios" ? 250 : 150,
          useNativeDriver: true,
        }).start();
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        setKeyboardHeight(0);
        // Animate sheet back down when keyboard hides
        RNAnimated.timing(translateY, {
          toValue: 0,
          duration: Platform.OS === "ios" ? 250 : 150,
          useNativeDriver: true,
        }).start();
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [translateY]);

  useEffect(() => {
    if (visible) {
      setDigits(Array(OTP_LENGTH).fill(""));
      // Delay focus to allow modal animation to complete
      setTimeout(() => inputs.current[0]?.focus(), 300);
    }
  }, [visible]);

  const handleChange = (val: string, idx: number) => {
    if (val.length > 1) {
      const split = val.replace(/\D/g, "").slice(0, OTP_LENGTH).split("");
      const next = Array(OTP_LENGTH).fill("");
      split.forEach((d, i) => { next[i] = d; });
      setDigits(next);
      if (split.length === OTP_LENGTH) tryConfirm(next.join(""));
      else inputs.current[Math.min(split.length, OTP_LENGTH - 1)]?.focus();
      return;
    }
    const clean = val.replace(/\D/g, "").slice(0, 1);
    const next = [...digits];
    next[idx] = clean;
    setDigits(next);
    if (clean && idx < OTP_LENGTH - 1) inputs.current[idx + 1]?.focus();
    if (next.every((d) => d.length === 1)) tryConfirm(next.join(""));
  };

  const handleKeyPress = (e: { nativeEvent: { key: string } }, idx: number) => {
    if (e.nativeEvent.key === "Backspace" && !digits[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    }
  };

  const tryConfirm = async (otp: string) => {
    if (otp.length < OTP_LENGTH || submitting) return;
    setSubmitting(true);
    Keyboard.dismiss();
    try {
      await onSubmit(otp);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setDigits(Array(OTP_LENGTH).fill(""));
      setTimeout(() => inputs.current[0]?.focus(), 50);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackdropPress = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        {/* Backdrop - dismisses on press */}
        <Pressable style={styles.backdrop} onPress={handleBackdropPress} testID="otp-backdrop">
          <Animated.View entering={FadeIn.duration(180)} style={StyleSheet.absoluteFill} />
        </Pressable>
        
        {/* Bottom sheet that animates up with keyboard */}
        <RNAnimated.View 
          style={[
            styles.sheetContainer,
            { transform: [{ translateY }] }
          ]}
        >
          <Animated.View
            entering={SlideInDown.springify().damping(16)}
            style={[styles.sheet, shadows.lg]}
            testID="otp-modal"
          >
            <Pressable onPress={() => Keyboard.dismiss()} style={styles.sheetContent}>
              <View style={styles.handle} />
              
              <View style={styles.iconWrap}>
                <Ionicons
                  name={kind === "pickup" ? "key-outline" : "lock-closed-outline"}
                  size={28}
                  color={theme.primary}
                />
              </View>
              
              <Text style={styles.title}>
                {kind === "pickup" ? "Enter pickup code" : "Enter delivery code"}
              </Text>
              
              <Text style={styles.subtitle}>
                {kind === "pickup"
                  ? "Ask the merchant for the 4-digit pickup code"
                  : "Ask the customer for the 4-digit delivery code"}
              </Text>

              <View style={styles.digitsRow}>
                {digits.map((d, i) => (
                  <TextInput
                    key={i}
                    ref={(r) => { inputs.current[i] = r; }}
                    style={[
                      styles.digit, 
                      !!d && styles.digitFilled, 
                      !!error && styles.digitError
                    ]}
                    value={d}
                    onChangeText={(v) => handleChange(v, i)}
                    onKeyPress={(e) => handleKeyPress(e, i)}
                    keyboardType="number-pad"
                    maxLength={1}
                    returnKeyType="done"
                    selectTextOnFocus
                    autoComplete="off"
                    testID={`otp-digit-${i}`}
                  />
                ))}
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              {expectedHint ? (
                <View style={styles.hintBox}>
                  <Ionicons name="information-circle-outline" size={14} color={theme.textSecondary} />
                  <Text style={styles.hintText}>Demo code: {expectedHint}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={onClose}
                testID="otp-cancel-button"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Animated.View>
        </RNAnimated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheetContainer: {
    width: "100%",
  },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === "android" ? spacing.xl : spacing.huge,
    width: "100%",
  },
  sheetContent: {
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  handle: { 
    alignSelf: "center", 
    width: 44, 
    height: 5, 
    backgroundColor: theme.border, 
    borderRadius: 3, 
    marginBottom: spacing.lg 
  },
  iconWrap: {
    width: 60, 
    height: 60, 
    borderRadius: 30,
    backgroundColor: theme.primaryLight,
    alignItems: "center", 
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { 
    fontSize: 22, 
    fontWeight: "800", 
    color: theme.textPrimary, 
    letterSpacing: -0.4, 
    textAlign: "center" 
  },
  subtitle: { 
    fontSize: 13, 
    color: theme.textSecondary, 
    marginTop: 6, 
    textAlign: "center", 
    paddingHorizontal: spacing.lg 
  },
  digitsRow: { 
    flexDirection: "row", 
    gap: 12, 
    marginTop: spacing.xl, 
    marginBottom: spacing.md 
  },
  digit: {
    width: 56, 
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: theme.surfaceMuted,
    borderWidth: 1.5, 
    borderColor: theme.border,
    textAlign: "center", 
    fontSize: 26, 
    fontWeight: "800",
    color: theme.textPrimary,
  },
  digitFilled: { 
    borderColor: theme.primary, 
    backgroundColor: theme.primaryLight 
  },
  digitError: { 
    borderColor: theme.error, 
    backgroundColor: "rgba(239,68,68,0.08)" 
  },
  errorText: { 
    color: theme.error, 
    fontSize: 13, 
    fontWeight: "600", 
    marginTop: 6 
  },
  hintBox: { 
    flexDirection: "row", 
    alignItems: "center", 
    gap: 6, 
    marginTop: 14, 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    backgroundColor: theme.surfaceMuted, 
    borderRadius: radius.pill 
  },
  hintText: { 
    fontSize: 12, 
    color: theme.textSecondary, 
    fontWeight: "600" 
  },
  cancelBtn: { 
    marginTop: spacing.lg, 
    paddingVertical: 10, 
    paddingHorizontal: 20 
  },
  cancelText: { 
    color: theme.textSecondary, 
    fontWeight: "600", 
    fontSize: 14 
  },
});
