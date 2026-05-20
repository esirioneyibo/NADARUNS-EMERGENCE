import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { api } from "../src/api";
import type { Order } from "../src/types";
import { radius, shadows, spacing, theme } from "../src/theme";

export default function SummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [rating, setRating] = useState<1 | -1 | 0>(0);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const animated = useSharedValue(0);
  const animatedAmount = useRef("");

  useEffect(() => {
    (async () => {
      // pull from history (the order is now delivered)
      const list = await api.getHistory();
      const found = list.find((o) => o.id === id) || list[0];
      setOrder(found || null);
      if (found) {
        animatedAmount.current = (found.earnings + found.tip).toFixed(2);
        animated.value = 0;
        animated.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) });
      }
    })();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [id, animated]);

  const animatedNumStyle = useAnimatedStyle(() => ({ opacity: 0.4 + animated.value * 0.6 }));

  const submit = async (rate?: 1 | -1) => {
    if (!order) return;
    setSubmitting(true);
    try {
      if (rate) await api.rate(order.id, rate, feedback || undefined);
      router.replace("/");
    } finally {
      setSubmitting(false);
    }
  };

  if (!order) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  const total = order.earnings + order.tip;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]} testID="summary-screen">
      <Animated.View entering={FadeInDown.duration(400)} style={styles.checkWrap}>
        <View style={styles.checkCircle}>
          <Ionicons name="checkmark" size={56} color="#fff" />
        </View>
      </Animated.View>

      <Animated.Text entering={FadeInUp.delay(120)} style={styles.title}>
        Delivery complete
      </Animated.Text>
      <Animated.Text entering={FadeInUp.delay(180)} style={styles.subtitle}>
        Great work, {order.customer.name.split(" ")[0]}'s order was delivered safely
      </Animated.Text>

      <Animated.View entering={FadeInUp.delay(240)} style={[styles.earnCard, shadows.lg]}>
        <Text style={styles.earnLabel}>You earned</Text>
        <Animated.Text style={[styles.earnAmount, animatedNumStyle]} testID="earned-amount">
          €{total.toFixed(2)}
        </Animated.Text>
        <View style={styles.breakdownRow}>
          <View style={styles.breakdownItem}>
            <Text style={styles.breakdownLabel}>Base pay</Text>
            <Text style={styles.breakdownValue}>${order.earnings.toFixed(2)}</Text>
          </View>
          <View style={styles.vDivider} />
          <View style={styles.breakdownItem}>
            <Text style={styles.breakdownLabel}>Tip</Text>
            <Text style={[styles.breakdownValue, { color: theme.success }]}>
              €{order.tip.toFixed(2)}
            </Text>
          </View>
          <View style={styles.vDivider} />
          <View style={styles.breakdownItem}>
            <Text style={styles.breakdownLabel}>Distance</Text>
            <Text style={styles.breakdownValue}>{order.distance_km.toFixed(1)} km</Text>
          </View>
        </View>
      </Animated.View>

      {order.delivery_photo ? (
        <Animated.View entering={FadeInUp.delay(280)} style={styles.proofCard} testID="summary-proof-card">
          <Image source={{ uri: order.delivery_photo }} style={styles.proofThumb} />
          <View style={{ flex: 1 }}>
            <Text style={styles.proofTitle}>Proof of delivery captured</Text>
            <Text style={styles.proofSub}>Saved with this order</Text>
          </View>
          <Ionicons name="shield-checkmark" size={22} color={theme.success} />
        </Animated.View>
      ) : null}

      <Animated.View entering={FadeInUp.delay(320)} style={styles.ratingCard}>
        <Text style={styles.ratingTitle}>How was the customer?</Text>
        <View style={styles.thumbsRow}>
          <TouchableOpacity
            style={[styles.thumbBtn, rating === -1 && styles.thumbBtnSelected]}
            onPress={() => { setRating(-1); Haptics.selectionAsync().catch(() => {}); }}
            testID="rate-down-button"
          >
            <Ionicons name="thumbs-down" size={28} color={rating === -1 ? theme.error : theme.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.thumbBtn, rating === 1 && styles.thumbBtnPos]}
            onPress={() => { setRating(1); Haptics.selectionAsync().catch(() => {}); }}
            testID="rate-up-button"
          >
            <Ionicons name="thumbs-up" size={28} color={rating === 1 ? theme.success : theme.textSecondary} />
          </TouchableOpacity>
        </View>

        {rating !== 0 ? (
          <Animated.View entering={FadeInUp.duration(220)}>
            <TextInput
              value={feedback}
              onChangeText={setFeedback}
              placeholder="Add a note (optional)"
              placeholderTextColor={theme.textSecondary}
              style={styles.input}
              multiline
              testID="feedback-input"
            />
          </Animated.View>
        ) : null}
      </Animated.View>

      <View style={{ flex: 1 }} />

      <Animated.View entering={FadeInUp.delay(380)} style={{ gap: 10 }}>
        <TouchableOpacity
          style={[styles.primaryBtn, submitting && { opacity: 0.7 }]}
          onPress={() => submit(rating === 0 ? undefined : (rating as 1 | -1))}
          disabled={submitting}
          testID="summary-done-button"
        >
          <Text style={styles.primaryBtnText}>{rating === 0 ? "Skip & continue" : "Submit & continue"}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/history")} testID="view-history-link">
          <Text style={styles.linkText}>View delivery history →</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.xl, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },
  checkWrap: { alignItems: "center", marginTop: spacing.xl },
  checkCircle: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: theme.success,
    alignItems: "center", justifyContent: "center",
    ...shadows.lg,
  },
  title: { fontSize: 28, fontWeight: "800", color: theme.textPrimary, textAlign: "center", marginTop: spacing.xl, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: theme.textSecondary, textAlign: "center", marginTop: 6, paddingHorizontal: spacing.xl },
  earnCard: {
    backgroundColor: theme.primary, borderRadius: radius.xxl, padding: spacing.xl,
    marginTop: spacing.xxl, alignItems: "center",
  },
  earnLabel: { fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: "600", textTransform: "uppercase", letterSpacing: 1.2 },
  earnAmount: { fontSize: 56, fontWeight: "900", color: "#fff", letterSpacing: -2, marginVertical: 6 },
  breakdownRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.md, width: "100%" },
  breakdownItem: { flex: 1, alignItems: "center" },
  breakdownLabel: { fontSize: 11, color: "rgba(255,255,255,0.6)", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 },
  breakdownValue: { color: "#fff", fontWeight: "700", fontSize: 16, marginTop: 4 },
  vDivider: { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.18)" },
  ratingCard: { marginTop: spacing.xl, padding: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: theme.border },
  proofCard: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: theme.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  proofThumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: theme.surfaceMuted },
  proofTitle: { fontSize: 14, fontWeight: "700", color: theme.textPrimary },
  proofSub: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
  ratingTitle: { fontSize: 16, fontWeight: "700", color: theme.textPrimary, textAlign: "center" },
  thumbsRow: { flexDirection: "row", justifyContent: "center", gap: 16, marginTop: spacing.md },
  thumbBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.surfaceMuted, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "transparent" },
  thumbBtnSelected: { backgroundColor: "rgba(239,68,68,0.1)", borderColor: theme.error },
  thumbBtnPos: { backgroundColor: "rgba(16,185,129,0.1)", borderColor: theme.success },
  input: { marginTop: spacing.md, backgroundColor: theme.surfaceMuted, borderRadius: radius.md, padding: spacing.md, fontSize: 14, color: theme.textPrimary, minHeight: 60 },
  primaryBtn: { height: 60, backgroundColor: theme.primary, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 17 },
  linkText: { color: theme.primary, textAlign: "center", fontWeight: "600", fontSize: 14, paddingVertical: 8 },
});
