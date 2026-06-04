import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { useTranslation } from "react-i18next";

import i18n from "../src/i18n";
import { api } from "../src/api";
import type { Order } from "../src/types";
import { radius, shadows, spacing, theme } from "../src/theme";

function formatDate(iso?: string | null) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const locale = i18n.language === "fi" ? "fi-FI" : "en-US";
    return d.toLocaleDateString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

export default function HistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [orders, setOrders] = useState<Order[] | null>(null);

  const load = useCallback(async () => {
    const list = await api.getHistory();
    setOrders(list);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!orders) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  const total = orders.reduce((sum, o) => sum + o.earnings + (o.tip || 0), 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="history-screen">
      <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
        <TouchableOpacity
          style={[styles.iconBtn, shadows.sm]}
          onPress={() => router.back()}
          testID="history-back-button"
        >
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>{t("history.title")}</Text>
        <View style={{ width: 44 }} />
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(120)} style={[styles.summaryCard, shadows.md]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryLabel}>{t("history.lifetimeEarnings")}</Text>
          <Text style={styles.summaryAmount} testID="history-total">€{total.toFixed(2)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <Text style={styles.summaryLabel}>{t("history.deliveries")}</Text>
          <Text style={styles.summaryAmount}>{orders.length}</Text>
        </View>
      </Animated.View>

      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.md, paddingBottom: insets.bottom + 40 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={48} color={theme.textSecondary} />
            <Text style={styles.emptyText}>{t("history.noDeliveriesYet")}</Text>
          </View>
        )}
        renderItem={({ item, index }) => (
          <Animated.View
            entering={FadeInUp.delay(80 + index * 50).duration(360)}
            style={[styles.itemCard, shadows.sm]}
            testID={`history-item-${index}`}
          >
            <View style={styles.itemHeader}>
              <Text style={styles.itemOrder}>{item.order_number}</Text>
              <Text style={styles.itemAmount}>+€{(item.earnings + (item.tip || 0)).toFixed(2)}</Text>
            </View>
            <View style={styles.itemBody}>
              <View style={styles.routeBlock}>
                <View style={styles.routeRow}>
                  <View style={[styles.dot, { backgroundColor: theme.primary }]} />
                  <Text style={styles.routeText} numberOfLines={1}>{item.pickup.name}</Text>
                </View>
                <View style={styles.routeLink} />
                <View style={styles.routeRow}>
                  <View style={[styles.dot, { backgroundColor: theme.secondary }]} />
                  <Text style={styles.routeText} numberOfLines={1}>{item.dropoff.address}</Text>
                </View>
              </View>
              {item.delivery_photo ? (
                <View style={styles.proofWrap} testID={`history-proof-${index}`}>
                  <Image source={{ uri: item.delivery_photo }} style={styles.proofImg} />
                  <View style={styles.proofBadge}>
                    <Ionicons name="shield-checkmark" size={10} color="#fff" />
                  </View>
                </View>
              ) : null}
            </View>
            <View style={styles.itemFooter}>
              <View style={styles.metaItem}>
                <Ionicons name="navigate-outline" size={13} color={theme.textSecondary} />
                <Text style={styles.metaText}>{item.distance_km.toFixed(1)} km</Text>
              </View>
              <View style={styles.metaItem}>
                <Ionicons name="time-outline" size={13} color={theme.textSecondary} />
                <Text style={styles.metaText}>{formatDate(item.completed_at)}</Text>
              </View>
              {item.rating_given === 1 ? (
                <Ionicons name="thumbs-up" size={14} color={theme.success} />
              ) : item.rating_given === -1 ? (
                <Ionicons name="thumbs-down" size={14} color={theme.error} />
              ) : null}
            </View>
          </Animated.View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 20, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.3 },
  summaryCard: { flexDirection: "row", alignItems: "center", marginHorizontal: spacing.xl, marginTop: spacing.sm, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: theme.surface },
  summaryDivider: { width: 1, height: 32, backgroundColor: theme.border, marginHorizontal: spacing.lg },
  summaryLabel: { fontSize: 11, color: theme.textSecondary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  summaryAmount: { fontSize: 24, fontWeight: "800", color: theme.textPrimary, marginTop: 4, letterSpacing: -0.5 },
  itemCard: { backgroundColor: theme.surface, borderRadius: radius.xl, padding: spacing.lg, borderWidth: 1, borderColor: theme.border },
  itemHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  itemBody: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: spacing.md },
  itemOrder: { fontSize: 12, color: theme.textSecondary, fontWeight: "700", letterSpacing: 0.8 },
  itemAmount: { fontSize: 18, fontWeight: "800", color: theme.primary },
  routeBlock: { flex: 1 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  routeLink: { width: 2, height: 14, backgroundColor: theme.border, marginLeft: 5, marginVertical: 3 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  routeText: { fontSize: 14, color: theme.textPrimary, fontWeight: "500", flex: 1 },
  proofWrap: { position: "relative" },
  proofImg: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: theme.surfaceMuted },
  proofBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.success,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: theme.surface,
  },
  itemFooter: { flexDirection: "row", alignItems: "center", gap: 16, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: theme.border },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, color: theme.textSecondary, fontWeight: "500" },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 80, gap: 12 },
  emptyText: { color: theme.textSecondary, fontSize: 14 },
});
