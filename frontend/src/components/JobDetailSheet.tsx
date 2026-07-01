import React, { useRef, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Order } from "../types";
import { radius, shadows, spacing } from "../theme";
import SwipeToConfirm from "./SwipeToConfirm";
import { api } from "../api";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
// Flexible bottom sheet: caps at 85% of screen so the pinned Accept button
// always stays visible even when marketplace / bundle cards add content.
const SHEET_MAX_HEIGHT = Math.min(640, SCREEN_HEIGHT * 0.85);
const SLIDE_DISTANCE = SHEET_MAX_HEIGHT;

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
  const translateY = useRef(new Animated.Value(SLIDE_DISTANCE)).current;
  const [accepting, setAccepting] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // Auto-decline timer (30 seconds)
  const [timeLeft, setTimeLeft] = useState(30);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const styles = createStyles(theme);

  // Bottom fade / "scroll for more" hint — shown only when the scrollable
  // body has content below the fold and isn't scrolled to the bottom yet.
  const [showScrollHint, setShowScrollHint] = useState(false);
  const scrollDims = useRef({ contentH: 0, layoutH: 0 });
  const evalHint = (contentH: number, layoutH: number, offsetY: number) => {
    const scrollable = contentH > layoutH + 4;
    const atBottom = offsetY >= contentH - layoutH - 16;
    setShowScrollHint(scrollable && !atBottom);
  };
  const onBodyScroll = (e: any) => {
    const { contentSize, layoutMeasurement, contentOffset } = e.nativeEvent;
    scrollDims.current = { contentH: contentSize.height, layoutH: layoutMeasurement.height };
    evalHint(contentSize.height, layoutMeasurement.height, contentOffset.y);
  };
  const onBodyContentSize = (_w: number, h: number) => {
    scrollDims.current.contentH = h;
    evalHint(h, scrollDims.current.layoutH, 0);
  };
  const onBodyLayout = (e: any) => {
    const h = e.nativeEvent.layout.height;
    scrollDims.current.layoutH = h;
    evalHint(scrollDims.current.contentH, h, 0);
  };

  // Phase B/C: per-driver marketplace pricing (empty-run + route-match + heat).
  const [match, setMatch] = useState<any>(null);
  const [bundle, setBundle] = useState<any>(null);
  const [emptyOverride, setEmptyOverride] = useState(false);
  const currentOrderId = orders[currentIndex]?.id;
  useEffect(() => { setEmptyOverride(false); }, [currentOrderId]);
  useEffect(() => {
    let cancelled = false;
    setMatch(null);
    if (visible && currentOrderId) {
      api.getJobMatch(currentOrderId, emptyOverride)
        .then((m) => { if (!cancelled) setMatch(m); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [visible, currentOrderId, emptyOverride]);
  useEffect(() => {
    let cancelled = false;
    setBundle(null);
    if (visible && currentOrderId) {
      api.getBundleSuggestions(currentOrderId)
        .then((b) => { if (!cancelled) setBundle(b); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [visible, currentOrderId]);

  useEffect(() => {
    if (visible) {
      // Slide up - smooth easing, no bounce
      Animated.timing(translateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
      
      // Start timer
      setTimeLeft(30);
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
        toValue: SLIDE_DISTANCE,
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
  const timerProgress = timeLeft / 30;

  // Cargo / package summary
  const pkg = (currentOrder.items || [])
    .map((i) => `${i.quantity}× ${i.name}`)
    .join(", ") || "Package";
  const cargoMeta = [
    currentOrder.cargo_type,
    currentOrder.cargo_weight_kg ? `${currentOrder.cargo_weight_kg} kg` : null,
    currentOrder.vehicle_type ? currentOrder.vehicle_type.replace(/_/g, " ") : null,
  ].filter(Boolean).join("  ·  ");

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY }],
        },
      ]}
    >
      {/* Handle bar (drag to dismiss) */}
      <View style={styles.handleContainer} {...panResponder.panHandlers}>
        <View style={styles.handle} />
      </View>

      {/* Timer bar */}
      <View style={styles.timerContainer}>
        <View style={[styles.timerBar, { width: `${timerProgress * 100}%` }]} />
        <Text style={styles.timerText}>{timeLeft}s to accept</Text>
      </View>

      {/* Scrollable body so the pinned Accept button is always reachable */}
      <View style={styles.scrollWrap}>
      <ScrollView
        style={styles.scrollBody}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
        onScroll={onBodyScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onBodyContentSize}
        onLayout={onBodyLayout}
      >
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

      {/* Marketplace intelligence: empty-run / route-match + market heat */}
      {match && (match.marketplace?.heat || (match.discounts?.empty_run_pct ?? 0) > 0 || (match.discounts?.route_match_pct ?? 0) > 0) && (
        <View style={styles.mktCard}>
          {match.marketplace?.heat && (
            <Text style={styles.mktHeat}>{match.marketplace.heat.icon} {match.marketplace.region_name || "Market"} · {match.marketplace.heat.label}</Text>
          )}
          {((match.discounts?.empty_run_pct ?? 0) > 0 || (match.discounts?.route_match_pct ?? 0) > 0) && (
            <Text style={styles.mktTag}>
              {(match.discounts?.empty_run_pct ?? 0) > 0 ? "♻️ Empty-run match" : "🧭 On your route"} · you earn €{match.driver_earnings?.toFixed(2)}
            </Text>
          )}
          <TouchableOpacity style={styles.mktToggle} onPress={() => setEmptyOverride((v) => !v)} testID="empty-run-toggle">
            <Ionicons name={emptyOverride ? "checkbox" : "square-outline"} size={16} color={theme.primary} />
            <Text style={styles.mktToggleText}>I&apos;m returning empty</Text>
          </TouchableOpacity>
        </View>
      )}

      {bundle && bundle.bundle_count > 0 && (
        <View style={styles.mktCard}>
          <Text style={styles.mktHeat}>🧩 Bundle {bundle.bundle_count} nearby load{bundle.bundle_count > 1 ? "s" : ""} · +€{(bundle.extra_earnings_if_all || 0).toFixed(0)}</Text>
          {bundle.suggestions.slice(0, 3).map((s: any, i: number) => (
            <Text key={i} style={styles.mktToggleText}>+{s.extra_distance_km} km · {s.dropoff_name || "Nearby"} · earn €{(s.driver_earnings || 0).toFixed(0)}</Text>
          ))}
        </View>
      )}

      {/* Geo + payout chips */}
      {(currentOrder.pickup_distance_km != null || currentOrder.payout_per_km != null) && (
        <View style={styles.chipsRow}>
          {currentOrder.pickup_distance_km != null && (
            <View style={styles.chip}>
              <Ionicons name="navigate" size={13} color={theme.primary} />
              <Text style={styles.chipText}>{currentOrder.pickup_distance_km} km to pickup</Text>
            </View>
          )}
          {currentOrder.payout_per_km != null && (
            <View style={styles.chip}>
              <Ionicons name="cash-outline" size={13} color={theme.primary} />
              <Text style={styles.chipText}>€{currentOrder.payout_per_km.toFixed(2)}/km</Text>
            </View>
          )}
        </View>
      )}

      {/* Cargo / package details */}
      <View style={styles.cargoRow}>
        <Ionicons name="cube" size={16} color={theme.textSecondary} />
        <Text testID="cargo" style={styles.cargoText} numberOfLines={2}>
          {pkg}{cargoMeta ? `  ·  ${cargoMeta}` : ""}
        </Text>
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
      </ScrollView>
      {showScrollHint && (
        <View pointerEvents="none" style={styles.scrollHint}>
          <LinearGradient
            colors={["rgba(0,0,0,0)", theme.surface]}
            style={styles.scrollHintGradient}
          />
          <View style={styles.scrollHintChip}>
            <Ionicons name="chevron-down" size={13} color={theme.primary} />
            <Text style={styles.scrollHintText}>Scroll for more</Text>
          </View>
        </View>
      )}
      </View>

      {/* Action buttons - swipe to accept prevents accidental taps */}
      <View style={styles.actions}>
        {accepting === currentOrder.id ? (
          <View style={styles.acceptingRow}>
            <ActivityIndicator color="#10B981" size="small" />
            <Text style={styles.acceptingText}>Accepting…</Text>
          </View>
        ) : (
          <SwipeToConfirm
            label="Swipe to accept"
            color="#10B981"
            onComplete={() => handleAccept(currentOrder.id)}
            testID="swipe-to-accept"
          />
        )}
        <TouchableOpacity
          style={styles.declineLink}
          onPress={handleClose}
          disabled={accepting !== null}
          testID="decline-order-button"
        >
          <Ionicons name="close" size={16} color={theme.error} />
          <Text style={styles.declineBtnText}>Decline</Text>
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
      maxHeight: SHEET_MAX_HEIGHT,
      backgroundColor: theme.surface,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      ...shadows.lg,
    },
    scrollWrap: {
      flexShrink: 1,
      position: "relative",
    },
    scrollBody: {
      flexShrink: 1,
    },
    scrollContent: {
      paddingBottom: spacing.sm,
    },
    scrollHint: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: 44,
      alignItems: "center",
      justifyContent: "flex-end",
    },
    scrollHintGradient: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: 44,
    },
    scrollHintChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: radius.pill,
      marginBottom: 2,
    },
    scrollHintText: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.primary,
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
    chipsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.pill,
    },
    chipText: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.primary,
    },
    cargoRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },
    cargoText: {
      flex: 1,
      fontSize: 13,
      fontWeight: "600",
      color: theme.textPrimary,
      textTransform: "capitalize",
      lineHeight: 18,
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
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs,
      paddingBottom: spacing.lg,
      gap: 10,
    },
    acceptingRow: {
      height: 64,
      borderRadius: radius.pill,
      backgroundColor: "#10B98122",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
    },
    acceptingText: { fontSize: 16, fontWeight: "700", color: "#10B981" },
    mktCard: { marginTop: spacing.sm, marginHorizontal: spacing.lg, backgroundColor: "#ECFDF5", borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: "#A7F3D0" },
    mktHeat: { fontSize: 13, fontWeight: "800", color: theme.text },
    mktTag: { fontSize: 13, fontWeight: "700", color: "#047857", marginTop: 4 },
    mktToggle: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
    mktToggleText: { fontSize: 12.5, color: theme.textSecondary, fontWeight: "600" },
    declineLink: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 10,
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
