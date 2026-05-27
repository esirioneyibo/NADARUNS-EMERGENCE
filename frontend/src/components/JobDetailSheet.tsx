import React, { useRef, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Order } from "../types";
import { radius, shadows, spacing } from "../theme";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_HEIGHT = 360;

interface JobDetailSheetProps {
  orders: Order[];
  visible: boolean;
  onClose: () => void;
  onAccept: (orderId: string) => Promise<void>;
  theme: any;
}

/**
 * Bottom sheet showing job details when driver taps a marker.
 * If multiple orders at same location, shows a horizontal scroll of order cards.
 */
export default function JobDetailSheet({
  orders,
  visible,
  onClose,
  onAccept,
  theme,
}: JobDetailSheetProps) {
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const [accepting, setAccepting] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // Auto-decline timer (15 seconds)
  const [timeLeft, setTimeLeft] = useState(15);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const styles = createStyles(theme);

  useEffect(() => {
    if (visible) {
      // Slide up - smooth easing, no bounce
      Animated.timing(translateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
      
      // Start timer
      setTimeLeft(15);
      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            // Auto-close when timer reaches 0
            handleClose();
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    } else {
      // Slide down
      Animated.timing(translateY, {
        toValue: SHEET_HEIGHT,
        duration: 200,
        useNativeDriver: true,
      }).start();
      
      // Clear timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [visible]);

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    onClose();
  };

  const handleAccept = async (orderId: string) => {
    setAccepting(orderId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    try {
      await onAccept(orderId);
    } finally {
      setAccepting(null);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 5,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 100) {
          handleClose();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  if (!visible || orders.length === 0) return null;

  const currentOrder = orders[currentIndex] || orders[0];
  const hasMultiple = orders.length > 1;

  // Calculate timer progress
  const timerProgress = timeLeft / 15;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      {/* Handle bar */}
      <View style={styles.handleContainer}>
        <View style={styles.handle} />
      </View>

      {/* Timer bar */}
      <View style={styles.timerContainer}>
        <View style={[styles.timerBar, { width: `${timerProgress * 100}%` }]} />
        <Text style={styles.timerText}>{timeLeft}s to accept</Text>
      </View>

      {/* Order count indicator (if multiple) */}
      {hasMultiple && (
        <View style={styles.countRow}>
          <Ionicons name="layers" size={16} color={theme.primary} />
          <Text style={styles.countText}>
            {orders.length} orders at this location
          </Text>
          {orders.length > 1 && (
            <View style={styles.pagination}>
              {orders.map((_, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.pageDot, i === currentIndex && styles.pageDotActive]}
                  onPress={() => setCurrentIndex(i)}
                />
              ))}
            </View>
          )}
        </View>
      )}

      {/* Main stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text style={styles.statValue}>€{currentOrder.earnings.toFixed(2)}</Text>
          <Text style={styles.statLabel}>Earnings</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBlock}>
          <Text style={styles.statValue}>{currentOrder.distance_km} km</Text>
          <Text style={styles.statLabel}>Distance</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBlock}>
          <Text style={styles.statValue}>{currentOrder.eta_minutes} min</Text>
          <Text style={styles.statLabel}>ETA</Text>
        </View>
      </View>

      {/* Addresses */}
      <View style={styles.addressSection}>
        <View style={styles.addressRow}>
          <View style={[styles.addressDot, { backgroundColor: theme.primary }]} />
          <View style={styles.addressInfo}>
            <Text style={styles.addressLabel}>PICKUP</Text>
            <Text style={styles.addressName}>{currentOrder.pickup.name}</Text>
            <Text style={styles.addressText} numberOfLines={1}>
              {currentOrder.pickup.address}
            </Text>
          </View>
        </View>
        
        <View style={styles.addressLine} />
        
        <View style={styles.addressRow}>
          <View style={[styles.addressDot, { backgroundColor: theme.secondary }]} />
          <View style={styles.addressInfo}>
            <Text style={styles.addressLabel}>DROPOFF</Text>
            <Text style={styles.addressName}>{currentOrder.dropoff.name}</Text>
            <Text style={styles.addressText} numberOfLines={1}>
              {currentOrder.dropoff.address}
            </Text>
          </View>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.declineBtn}
          onPress={handleClose}
          disabled={accepting !== null}
        >
          <Ionicons name="close" size={24} color={theme.error} />
          <Text style={styles.declineBtnText}>Decline</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.acceptBtn, accepting && styles.acceptBtnDisabled]}
          onPress={() => handleAccept(currentOrder.id)}
          disabled={accepting !== null}
        >
          {accepting === currentOrder.id ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="checkmark" size={24} color="#fff" />
              <Text style={styles.acceptBtnText}>Accept</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: SHEET_HEIGHT,
      backgroundColor: theme.surface,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      ...shadows.lg,
    },
    handleContainer: {
      alignItems: "center",
      paddingTop: 12,
      paddingBottom: 8,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.border,
    },
    timerContainer: {
      height: 24,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      backgroundColor: theme.surfaceMuted,
      borderRadius: radius.pill,
      overflow: "hidden",
      position: "relative",
      justifyContent: "center",
    },
    timerBar: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: "#10B981",
      borderRadius: radius.pill,
    },
    timerText: {
      textAlign: "center",
      fontSize: 12,
      fontWeight: "700",
      color: theme.textPrimary,
      zIndex: 1,
    },
    countRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      gap: 6,
    },
    countText: {
      flex: 1,
      fontSize: 13,
      fontWeight: "600",
      color: theme.textSecondary,
    },
    pagination: {
      flexDirection: "row",
      gap: 6,
    },
    pageDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.border,
    },
    pageDotActive: {
      backgroundColor: theme.primary,
      width: 20,
    },
    statsRow: {
      flexDirection: "row",
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },
    statBlock: {
      flex: 1,
      alignItems: "center",
    },
    statDivider: {
      width: 1,
      backgroundColor: theme.border,
    },
    statValue: {
      fontSize: 22,
      fontWeight: "800",
      color: theme.textPrimary,
      letterSpacing: -0.5,
    },
    statLabel: {
      fontSize: 12,
      color: theme.textSecondary,
      fontWeight: "500",
      marginTop: 2,
    },
    addressSection: {
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.lg,
    },
    addressRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },
    addressDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      marginTop: 4,
    },
    addressLine: {
      width: 2,
      height: 16,
      backgroundColor: theme.border,
      marginLeft: 5,
      marginVertical: 2,
    },
    addressInfo: {
      flex: 1,
    },
    addressLabel: {
      fontSize: 10,
      fontWeight: "700",
      color: theme.textSecondary,
      letterSpacing: 1,
    },
    addressName: {
      fontSize: 15,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    addressText: {
      fontSize: 13,
      color: theme.textSecondary,
    },
    actions: {
      flexDirection: "row",
      paddingHorizontal: spacing.lg,
      gap: 12,
    },
    declineBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 16,
      borderRadius: radius.lg,
      backgroundColor: theme.surfaceMuted,
      gap: 8,
    },
    declineBtnText: {
      fontSize: 16,
      fontWeight: "700",
      color: theme.error,
    },
    acceptBtn: {
      flex: 2,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 16,
      borderRadius: radius.lg,
      backgroundColor: "#10B981",
      gap: 8,
    },
    acceptBtnDisabled: {
      opacity: 0.7,
    },
    acceptBtnText: {
      fontSize: 16,
      fontWeight: "700",
      color: "#fff",
    },
  });
