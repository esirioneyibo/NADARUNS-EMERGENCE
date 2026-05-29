import React, { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { api } from "../src/api";
import { DriverPerformance } from "../src/types";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

type Period = "today" | "week" | "total";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "total", label: "All time" },
];

function timeAgo(iso?: string) {
  if (!iso) return "";
  try {
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    const h = Math.floor(diff / 3_600_000);
    if (h < 1) return "Just now";
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  } catch {
    return "";
  }
}

export default function EarningsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = createStyles(theme);

  const [perf, setPerf] = useState<DriverPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<Period>("today");

  const load = useCallback(async () => {
    try {
      const data = await api.getDriverPerformance();
      setPerf(data);
    } catch (e) {
      console.warn("Performance load failed", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    Haptics.selectionAsync().catch(() => {});
    load();
  };

  const Skeleton = ({ h, w, style }: { h: number; w?: number | string; style?: any }) => (
    <View style={[styles.skeleton, { height: h, width: (w as any) ?? "100%" }, style]} />
  );

  const heroEarnings = perf ? perf.earnings[period] : 0;
  const heroDeliveries = perf ? perf.deliveries[period] : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Animated.View entering={FadeInDown.duration(240)} style={styles.header}>
        <TouchableOpacity style={[styles.iconBtn, shadows.sm]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>Performance</Text>
        <View style={{ width: 44 }} />
      </Animated.View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
      >
        {/* Period tabs */}
        <View style={styles.tabs}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.tab, period === p.id && styles.tabActive]}
              onPress={() => {
                setPeriod(p.id);
                Haptics.selectionAsync().catch(() => {});
              }}
            >
              <Text style={[styles.tabText, period === p.id && styles.tabTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Earnings hero */}
        <Animated.View entering={FadeInUp.duration(260)} style={[styles.hero, shadows.md]}>
          <Text style={styles.heroLabel}>{PERIODS.find((p) => p.id === period)?.label} earnings</Text>
          {loading ? (
            <Skeleton h={44} w={180} style={{ marginVertical: 8, alignSelf: "center" }} />
          ) : (
            <Text style={styles.heroValue}>€{heroEarnings.toFixed(2)}</Text>
          )}
          <View style={styles.heroMetaRow}>
            <Ionicons name="cube-outline" size={15} color="rgba(255,255,255,0.85)" />
            <Text style={styles.heroMeta}>
              {loading ? "—" : `${heroDeliveries} ${heroDeliveries === 1 ? "delivery" : "deliveries"}`}
            </Text>
          </View>
        </Animated.View>

        {/* Metrics grid */}
        <View style={styles.metricsGrid}>
          {[
            { icon: "checkmark-circle-outline", color: "#10B981", label: "Acceptance", value: perf ? `${perf.acceptance_rate.toFixed(0)}%` : null },
            { icon: "ribbon-outline", color: "#6366F1", label: "Completion", value: perf ? `${perf.completion_rate.toFixed(0)}%` : null },
            { icon: "star-outline", color: "#F59E0B", label: "Rating", value: perf ? perf.rating.toFixed(2) : null },
            { icon: "trophy-outline", color: "#3B82F6", label: "Total trips", value: perf ? `${perf.deliveries.total}` : null },
          ].map((m, i) => (
            <Animated.View key={i} entering={FadeInUp.delay(80 + i * 60).duration(260)} style={[styles.metricCard, shadows.sm]}>
              <View style={[styles.metricIcon, { backgroundColor: m.color + "1A" }]}>
                <Ionicons name={m.icon as any} size={20} color={m.color} />
              </View>
              {loading ? <Skeleton h={22} w={56} style={{ marginTop: 8 }} /> : <Text style={styles.metricValue}>{m.value}</Text>}
              <Text style={styles.metricLabel}>{m.label}</Text>
            </Animated.View>
          ))}
        </View>

        {/* Recent deliveries timeline */}
        <Text style={styles.sectionTitle}>Recent deliveries</Text>
        {loading ? (
          <View style={{ gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.timelineCard, shadows.sm]}>
                <Skeleton h={40} w={40} style={{ borderRadius: 20 }} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Skeleton h={14} w="70%" />
                  <Skeleton h={12} w="45%" />
                </View>
                <Skeleton h={18} w={50} />
              </View>
            ))}
          </View>
        ) : perf && perf.recent_deliveries.length > 0 ? (
          <View style={{ gap: 10 }}>
            {perf.recent_deliveries.map((d, i) => (
              <Animated.View key={i} entering={FadeInUp.delay(i * 40).duration(220)} style={[styles.timelineCard, shadows.sm]}>
                <View style={styles.timelineIcon}>
                  <Ionicons name="checkmark-done" size={18} color="#10B981" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.timelineTitle} numberOfLines={1}>
                    {d.pickup_name} → {d.dropoff_name}
                  </Text>
                  <Text style={styles.timelineSub}>
                    {d.order_number} · {Number(d.distance_km).toFixed(1)} km · {timeAgo(d.completed_at)}
                  </Text>
                </View>
                <Text style={styles.timelineAmount}>€{d.earnings.toFixed(2)}</Text>
              </Animated.View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={40} color={theme.textSecondary} />
            <Text style={styles.emptyTitle}>No deliveries yet</Text>
            <Text style={styles.emptySub}>Complete your first delivery to start tracking earnings and stats.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
    },
    iconBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    heading: { fontSize: 20, fontWeight: "800", color: theme.textPrimary },

    tabs: {
      flexDirection: "row",
      backgroundColor: theme.surfaceMuted,
      borderRadius: radius.pill,
      padding: 4,
      marginBottom: spacing.lg,
    },
    tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: radius.pill },
    tabActive: { backgroundColor: theme.surface, ...shadows.sm },
    tabText: { fontSize: 13, fontWeight: "700", color: theme.textSecondary },
    tabTextActive: { color: theme.primary },

    hero: {
      backgroundColor: theme.primary,
      borderRadius: radius.xl,
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.lg,
      alignItems: "center",
      marginBottom: spacing.lg,
    },
    heroLabel: { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: 0.5 },
    heroValue: { fontSize: 44, fontWeight: "800", color: "#fff", marginVertical: 6, letterSpacing: -1 },
    heroMetaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    heroMeta: { fontSize: 14, color: "rgba(255,255,255,0.9)", fontWeight: "600" },

    metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: spacing.lg },
    metricCard: {
      width: "47%",
      flexGrow: 1,
      backgroundColor: theme.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    metricIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    metricValue: { fontSize: 22, fontWeight: "800", color: theme.textPrimary, marginTop: 8 },
    metricLabel: { fontSize: 12, color: theme.textSecondary, marginTop: 2, fontWeight: "600" },

    sectionTitle: { fontSize: 17, fontWeight: "800", color: theme.textPrimary, marginBottom: spacing.md },
    timelineCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: theme.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    timelineIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "#10B9811A",
      alignItems: "center",
      justifyContent: "center",
    },
    timelineTitle: { fontSize: 14, fontWeight: "700", color: theme.textPrimary },
    timelineSub: { fontSize: 12, color: theme.textSecondary, marginTop: 3 },
    timelineAmount: { fontSize: 16, fontWeight: "800", color: "#10B981" },

    emptyState: { alignItems: "center", paddingVertical: 40, gap: 8 },
    emptyTitle: { fontSize: 16, fontWeight: "700", color: theme.textPrimary, marginTop: 4 },
    emptySub: { fontSize: 13, color: theme.textSecondary, textAlign: "center", paddingHorizontal: 30, lineHeight: 19 },

    skeleton: { backgroundColor: theme.surfaceMuted, borderRadius: 8, opacity: 0.7 },
  });
