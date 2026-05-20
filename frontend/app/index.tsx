import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown, FadeInUp, SlideInDown, SlideInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";

import { api } from "../src/api";
import type { Driver, Order } from "../src/types";
import { radius, shadows, spacing, theme } from "../src/theme";
import MapView from "../src/components/MapView";
import SlideToGoOnline from "../src/components/SlideToGoOnline";

// Helper to get greeting based on time of day
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// Format current date
function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [pending, setPending] = useState<Order | null>(null);
  const [active, setActive] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, p, a] = await Promise.all([api.getDriver(), api.getPending(), api.getActive()]);
      setDriver(d);
      setPending(p);
      setActive(a);
    } catch (e) {
      console.warn("Home load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Auto-poll for pending order while online
  useEffect(() => {
    if (!driver?.is_online) return;
    const id = setInterval(async () => {
      try {
        const p = await api.getPending();
        setPending(p);
      } catch {}
    }, 4000);
    return () => clearInterval(id);
  }, [driver?.is_online]);

  const goOnline = async () => {
    if (driver?.is_online) return;
    setToggling(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    try {
      const d = await api.toggleOnline();
      setDriver(d);
    } finally {
      setToggling(false);
    }
  };

  const goOffline = async () => {
    setToggling(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const d = await api.toggleOnline();
      setDriver(d);
    } finally {
      setToggling(false);
    }
  };

  const handleResume = () => {
    router.push("/order");
  };

  if (loading || !driver) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const showRequest = driver.is_online && pending && !active;

  // OFFLINE STATE: Show welcome screen
  if (!driver.is_online && !active) {
    return (
      <View style={styles.container} testID="home-screen">
        <LinearGradient
          colors={[theme.background, "#E8F5F3"]}
          style={StyleSheet.absoluteFill}
        />
        
        <ScrollView 
          contentContainerStyle={[styles.welcomeContent, { paddingTop: insets.top + 20, paddingBottom: 100 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View entering={FadeInDown.duration(400)} style={styles.welcomeHeader}>
            <View style={styles.welcomeAvatarRow}>
              <Image source={{ uri: driver.avatar }} style={styles.welcomeAvatar} />
              <View style={styles.welcomeBrand}>
                <Ionicons name="flash" size={16} color={theme.primary} />
                <Text style={styles.welcomeBrandText}>NadaRuns</Text>
              </View>
            </View>
            
            <Animated.View entering={FadeInDown.delay(100).duration(400)}>
              <Text style={styles.welcomeGreeting}>{getGreeting()},</Text>
              <Text style={styles.welcomeName}>{driver.name.split(" ")[0]}!</Text>
            </Animated.View>
            
            <Animated.View entering={FadeInDown.delay(200).duration(400)}>
              <Text style={styles.welcomeDate}>{formatDate()}</Text>
            </Animated.View>
          </Animated.View>

          {/* Stats Cards */}
          <Animated.View entering={FadeInUp.delay(300).duration(400)} style={styles.statsCards}>
            <View style={[styles.statCard, shadows.sm]}>
              <View style={[styles.statIconWrap, { backgroundColor: theme.primaryLight }]}>
                <Ionicons name="cash-outline" size={22} color={theme.primary} />
              </View>
              <Text style={styles.statCardValue}>€{driver.earnings_today.toFixed(2)}</Text>
              <Text style={styles.statCardLabel}>Today's earnings</Text>
            </View>
            
            <View style={[styles.statCard, shadows.sm]}>
              <View style={[styles.statIconWrap, { backgroundColor: "#FEF3C7" }]}>
                <Ionicons name="bicycle-outline" size={22} color="#D97706" />
              </View>
              <Text style={styles.statCardValue}>{driver.deliveries_today}</Text>
              <Text style={styles.statCardLabel}>Deliveries</Text>
            </View>
            
            <View style={[styles.statCard, shadows.sm]}>
              <View style={[styles.statIconWrap, { backgroundColor: "#DBEAFE" }]}>
                <Ionicons name="star-outline" size={22} color="#2563EB" />
              </View>
              <Text style={styles.statCardValue}>{driver.rating.toFixed(2)}</Text>
              <Text style={styles.statCardLabel}>Rating</Text>
            </View>
          </Animated.View>

          {/* Quick Info */}
          <Animated.View entering={FadeInUp.delay(400).duration(400)} style={[styles.infoCard, shadows.sm]}>
            <View style={styles.infoRow}>
              <Ionicons name="car-outline" size={20} color={theme.textSecondary} />
              <Text style={styles.infoText}>{driver.vehicle}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Ionicons name="checkmark-circle-outline" size={20} color={theme.success} />
              <Text style={styles.infoText}>{driver.acceptance_rate.toFixed(0)}% acceptance</Text>
            </View>
          </Animated.View>

          {/* Ready message */}
          <Animated.View entering={FadeInUp.delay(500).duration(400)} style={styles.readyMessage}>
            <Ionicons name="location-outline" size={24} color={theme.textSecondary} />
            <Text style={styles.readyText}>
              Ready to start earning? Slide below to go online and receive delivery requests nearby.
            </Text>
          </Animated.View>
        </ScrollView>

        {/* Slide to go online - fixed at bottom, above tab bar */}
        <Animated.View 
          entering={SlideInUp.delay(600).springify()}
          style={[styles.slideContainer, { bottom: 16 }]}
        >
          <SlideToGoOnline 
            onGoOnline={goOnline} 
            disabled={toggling}
            testID="slide-to-go-online"
          />
        </Animated.View>
      </View>
    );
  }

  // ONLINE STATE: Show map with orders
  return (
    <View style={styles.container} testID="home-screen">
      <View style={StyleSheet.absoluteFill}>
        <MapView
          pickup={pending?.pickup}
          dropoff={pending?.dropoff}
          showRoute={!!pending}
        />
      </View>

      {/* Top bar */}
      <Animated.View
        entering={FadeInDown.duration(400)}
        style={[styles.topBar, { top: insets.top + 12 }]}
      >
        <View style={[styles.profileChip, shadows.md]}>
          <Image source={{ uri: driver.avatar }} style={styles.avatar} />
          <View style={{ marginLeft: 10 }}>
            <Text style={styles.profileName} numberOfLines={1}>{driver.name}</Text>
            <View style={styles.rowCenter}>
              <Ionicons name="star" size={12} color={theme.warning} />
              <Text style={styles.profileMeta}>  {driver.rating.toFixed(2)} · {driver.vehicle}</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.offlineBtn, shadows.md]}
          onPress={goOffline}
          disabled={toggling}
          testID="go-offline-button"
        >
          <Ionicons name="power" size={18} color={theme.error} />
        </TouchableOpacity>
      </Animated.View>

      {/* Status pill */}
      <Animated.View
        entering={FadeIn.delay(120)}
        style={[styles.statusPill, { top: insets.top + 90 }, shadows.sm]}
      >
        <View style={[styles.dot, { backgroundColor: theme.success }]} />
        <Text style={styles.statusText}>You're online</Text>
        <View style={styles.brandSep} />
        <Text style={styles.brandText}>NadaRuns</Text>
      </Animated.View>

      {/* Bottom card */}
      <Animated.View
        entering={SlideInDown.springify().damping(18)}
        style={[styles.bottomSheet, { paddingBottom: 20 }, shadows.lg]}
      >
        <View style={styles.handle} />

        {active ? (
          <Animated.View entering={FadeInUp} style={styles.activeBanner} testID="active-order-banner">
            <View style={{ flex: 1 }}>
              <Text style={styles.activeLabel}>Active delivery</Text>
              <Text style={styles.activeTitle} numberOfLines={1}>
                {active.pickup.name} → {active.customer.name}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleResume}
              style={styles.resumeBtn}
              testID="resume-order-button"
            >
              <Text style={styles.resumeBtnText}>Resume</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statValue} testID="earnings-today">
                  €{driver.earnings_today.toFixed(2)}
                </Text>
                <Text style={styles.statLabel}>Today's earnings</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{driver.deliveries_today}</Text>
                <Text style={styles.statLabel}>Deliveries</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{driver.acceptance_rate.toFixed(0)}%</Text>
                <Text style={styles.statLabel}>Accept rate</Text>
              </View>
            </View>

            <View style={styles.waitingMessage}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={styles.waitingText}>Waiting for delivery requests...</Text>
            </View>
          </>
        )}
      </Animated.View>

      {/* Incoming order overlay */}
      {showRequest ? (
        <Animated.View
          entering={SlideInDown.springify().damping(16).mass(0.9)}
          style={[styles.requestOverlay, { paddingBottom: insets.bottom + 90 }, shadows.lg]}
          testID="incoming-order-card"
        >
          <View style={styles.requestHeader}>
            <View style={styles.pulse} />
            <Text style={styles.requestLabel}>New delivery request</Text>
            <Text style={styles.requestEta}>{pending!.eta_minutes} min</Text>
          </View>

          <View style={styles.earningsRow}>
            <Text style={styles.earningsAmount} testID="incoming-earnings">
              €{pending!.earnings.toFixed(2)}
            </Text>
            {pending!.tip > 0 ? (
              <View style={styles.tipBadge}>
                <Ionicons name="cash-outline" size={12} color={theme.success} />
                <Text style={styles.tipText}>+€{pending!.tip.toFixed(2)} tip</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.routeBlock}>
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: theme.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routePrimary} numberOfLines={1}>{pending!.pickup.name}</Text>
                <Text style={styles.routeSecondary} numberOfLines={1}>{pending!.pickup.address}</Text>
              </View>
            </View>
            <View style={styles.routeLink} />
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: theme.secondary }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routePrimary} numberOfLines={1}>{pending!.dropoff.name}</Text>
                <Text style={styles.routeSecondary} numberOfLines={1}>{pending!.dropoff.address}</Text>
              </View>
            </View>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="navigate-outline" size={16} color={theme.textSecondary} />
              <Text style={styles.metaText}>{pending!.distance_km.toFixed(1)} km</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="star" size={15} color={theme.warning} />
              <Text style={styles.metaText}>{pending!.customer.rating.toFixed(1)}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="person-circle-outline" size={16} color={theme.textSecondary} />
              <Text style={styles.metaText}>{pending!.customer.name}</Text>
            </View>
          </View>

          <View style={styles.actionsRow}>
            <Pressable
              style={({ pressed }) => [styles.rejectBtn, pressed && { opacity: 0.7 }]}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                await api.reject(pending!.id);
                const p = await api.getPending();
                setPending(p);
              }}
              testID="reject-order-button"
            >
              <Text style={styles.rejectText}>Decline</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.acceptBtn, pressed && { opacity: 0.85 }]}
              onPress={async () => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                await api.accept(pending!.id);
                router.push("/order");
              }}
              testID="accept-order-button"
            >
              <Text style={styles.acceptText}>Accept</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },
  
  // Welcome screen styles
  welcomeContent: {
    paddingHorizontal: spacing.xl,
  },
  welcomeHeader: {
    marginBottom: spacing.xl,
  },
  welcomeAvatarRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  welcomeAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.surfaceMuted,
    borderWidth: 3,
    borderColor: theme.primary,
  },
  welcomeBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  welcomeBrandText: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.primary,
    letterSpacing: 0.5,
  },
  welcomeGreeting: {
    fontSize: 28,
    fontWeight: "400",
    color: theme.textSecondary,
  },
  welcomeName: {
    fontSize: 36,
    fontWeight: "800",
    color: theme.textPrimary,
    letterSpacing: -1,
    marginTop: -4,
  },
  welcomeDate: {
    fontSize: 15,
    color: theme.textSecondary,
    marginTop: 8,
  },
  statsCards: {
    flexDirection: "row",
    gap: 12,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: "center",
  },
  statIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  statCardValue: {
    fontSize: 20,
    fontWeight: "800",
    color: theme.textPrimary,
  },
  statCardLabel: {
    fontSize: 11,
    color: theme.textSecondary,
    marginTop: 2,
    textAlign: "center",
  },
  infoCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  infoRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
  },
  infoDivider: {
    width: 1,
    height: 24,
    backgroundColor: theme.border,
  },
  infoText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.textPrimary,
  },
  readyMessage: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: theme.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  readyText: {
    flex: 1,
    fontSize: 14,
    color: theme.textSecondary,
    lineHeight: 20,
  },
  slideContainer: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    bottom: 0,
  },

  // Online state styles
  topBar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 5,
  },
  profileChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    paddingVertical: 8,
    paddingHorizontal: 10,
    paddingRight: 16,
    borderRadius: radius.pill,
    maxWidth: 240,
  },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surfaceMuted },
  profileName: { fontSize: 14, fontWeight: "700", color: theme.textPrimary },
  profileMeta: { fontSize: 11, color: theme.textSecondary, marginTop: 1 },
  rowCenter: { flexDirection: "row", alignItems: "center" },
  offlineBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: theme.surface,
    alignItems: "center", justifyContent: "center",
  },
  statusPill: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    zIndex: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusText: { fontSize: 13, fontWeight: "600", color: theme.textPrimary },
  brandSep: { width: 1, height: 12, backgroundColor: theme.border, marginHorizontal: 10 },
  brandText: { fontSize: 12, fontWeight: "800", color: theme.primary, letterSpacing: 0.6 },
  bottomSheet: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    backgroundColor: theme.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  handle: { alignSelf: "center", width: 44, height: 5, backgroundColor: theme.border, borderRadius: 3, marginBottom: spacing.lg },
  statsRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  statBox: { flex: 1, alignItems: "center" },
  statDivider: { width: 1, height: 32, backgroundColor: theme.border },
  statValue: { fontSize: 22, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: theme.textSecondary, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  waitingMessage: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: spacing.md,
    backgroundColor: theme.surfaceMuted,
    borderRadius: radius.lg,
  },
  waitingText: {
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: "500",
  },
  activeBanner: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  activeLabel: { fontSize: 11, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "700" },
  activeTitle: { fontSize: 17, fontWeight: "700", color: theme.textPrimary, marginTop: 4 },
  resumeBtn: { flexDirection: "row", alignItems: "center", backgroundColor: theme.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.pill, gap: 6 },
  resumeBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  requestOverlay: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    backgroundColor: theme.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    zIndex: 10,
  },
  requestHeader: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  pulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.success, marginRight: 8 },
  requestLabel: { flex: 1, fontSize: 13, color: theme.textSecondary, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8 },
  requestEta: { fontSize: 13, fontWeight: "700", color: theme.primary },
  earningsRow: { flexDirection: "row", alignItems: "baseline", marginBottom: spacing.lg },
  earningsAmount: { fontSize: 44, fontWeight: "800", color: theme.textPrimary, letterSpacing: -1.2 },
  tipBadge: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(16,185,129,0.12)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginLeft: 12, gap: 4 },
  tipText: { color: theme.success, fontWeight: "700", fontSize: 12 },
  routeBlock: { backgroundColor: theme.surfaceMuted, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  routeRow: { flexDirection: "row", alignItems: "center" },
  routeDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  routeLink: { width: 2, height: 18, backgroundColor: theme.border, marginLeft: 5, marginVertical: 4 },
  routePrimary: { fontSize: 15, fontWeight: "700", color: theme.textPrimary },
  routeSecondary: { fontSize: 12, color: theme.textSecondary, marginTop: 1 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.xl, paddingHorizontal: 4 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 14, fontWeight: "600", color: theme.textPrimary },
  actionsRow: { flexDirection: "row", gap: 12 },
  rejectBtn: { flex: 1, height: 56, borderRadius: 16, backgroundColor: theme.surfaceMuted, alignItems: "center", justifyContent: "center" },
  rejectText: { fontSize: 16, fontWeight: "700", color: theme.textPrimary },
  acceptBtn: { flex: 2, height: 56, borderRadius: 16, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  acceptText: { color: "#fff", fontWeight: "800", fontSize: 17 },
});
