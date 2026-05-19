import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInUp, Layout, SlideInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { api } from "../src/api";
import type { Order, OrderStatus, RoutePoint } from "../src/types";
import { radius, shadows, spacing, theme } from "../src/theme";
import MapView from "../src/components/MapView";
import SwipeToConfirm from "../src/components/SwipeToConfirm";
import OtpModal from "../src/components/OtpModal";

const STAGE_TITLES: Record<OrderStatus, { title: string; subtitle: string; primary: string }> = {
  pending: { title: "New request", subtitle: "Reviewing order details", primary: "Continue" },
  accepted: { title: "Order accepted", subtitle: "Head to the pickup location", primary: "Start navigation" },
  enroute_pickup: { title: "Navigating to pickup", subtitle: "Drive safely to the restaurant", primary: "I've arrived" },
  arrived_pickup: { title: "Arrived at pickup", subtitle: "Verify and pick up the order", primary: "View pickup details" },
  picked_up: { title: "Order picked up", subtitle: "Head to the customer", primary: "Start delivery" },
  enroute_dropoff: { title: "Navigating to customer", subtitle: "On your way to the customer", primary: "I've arrived" },
  arrived_dropoff: { title: "Arrived at dropoff", subtitle: "Hand the order to the customer", primary: "Confirm delivery" },
  delivered: { title: "Delivered", subtitle: "Great work!", primary: "Done" },
  rejected: { title: "Rejected", subtitle: "", primary: "Back" },
};

export default function OrderFlowScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [otpOpen, setOtpOpen] = useState<null | "pickup" | "dropoff">(null);
  const [otpError, setOtpError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const a = await api.getActive();
      setOrder(a);
      if (a) {
        try {
          const r = await api.getRoute(a.id);
          setRoutePoints(r.points);
        } catch (e) {
          console.warn("route load failed", e);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const advance = async () => {
    if (!order || busy) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const next = await api.advance(order.id);
      if (next.status === "delivered") {
        router.replace({ pathname: "/summary", params: { id: next.id } });
        return;
      }
      setOrder(next);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top }]}>
        <Text style={styles.empty}>No active delivery</Text>
        <TouchableOpacity onPress={() => router.replace("/")} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Back to dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const stage = STAGE_TITLES[order.status];
  const isNavStage = order.status === "enroute_pickup" || order.status === "enroute_dropoff";
  const isArrivedStage = order.status === "arrived_pickup" || order.status === "arrived_dropoff";
  const isPickupConfirm = order.status === "picked_up"; // After "arrived_pickup -> picked_up", swipe sets up the dropoff nav
  const targetIsPickup = ["accepted", "enroute_pickup", "arrived_pickup"].includes(order.status);

  return (
    <View style={styles.container} testID="order-flow-screen">
      <View style={StyleSheet.absoluteFill}>
        <MapView
          pickup={order.pickup}
          dropoff={order.dropoff}
          driver={targetIsPickup ? { lat: order.pickup.lat - 0.005, lng: order.pickup.lng - 0.004 } : order.pickup}
          routePoints={routePoints}
          showRoute
        />
      </View>

      {/* Top header */}
      <Animated.View
        entering={FadeIn}
        style={[styles.topRow, { top: insets.top + 12 }]}
      >
        <TouchableOpacity
          style={[styles.iconBtn, shadows.md]}
          onPress={() => router.replace("/")}
          testID="order-back-button"
        >
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>

        <View style={[styles.etaPill, shadows.md]}>
          <Ionicons name={isNavStage ? "navigate" : "time-outline"} size={14} color={theme.primary} />
          <Text style={styles.etaText}>
            {targetIsPickup ? "Pickup" : "Dropoff"} · {order.eta_minutes} min · {order.distance_km.toFixed(1)} km
          </Text>
        </View>

        <View style={{ width: 44 }} />
      </Animated.View>

      {/* Stage pill */}
      <Animated.View
        entering={FadeIn.delay(100)}
        layout={Layout.springify()}
        style={[styles.stagePill, { top: insets.top + 76 }, shadows.sm]}
        testID={`stage-${order.status}`}
      >
        <Text style={styles.stagePillText}>{stage.title.toUpperCase()}</Text>
      </Animated.View>

      {/* Bottom sheet */}
      <Animated.View
        key={order.status}
        entering={SlideInDown.springify().damping(18).mass(0.9)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 24 }, shadows.lg]}
        testID="order-action-sheet"
      >
        <View style={styles.handle} />

        <View style={styles.sheetHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetTitle}>{stage.title}</Text>
            <Text style={styles.sheetSubtitle}>{stage.subtitle}</Text>
          </View>
          <View style={styles.earnChip}>
            <Text style={styles.earnChipLabel}>EARNING</Text>
            <Text style={styles.earnChipValue}>${(order.earnings + order.tip).toFixed(2)}</Text>
          </View>
        </View>

        {/* Address block - swaps based on stage */}
        <View style={styles.addressBlock}>
          <View style={styles.addressRow}>
            <View style={[styles.dot, { backgroundColor: targetIsPickup ? theme.primary : "#CBD5E1" }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.addressLabel}>Pickup</Text>
              <Text style={styles.addressPrimary} numberOfLines={1}>{order.pickup.name}</Text>
              <Text style={styles.addressSecondary} numberOfLines={1}>{order.pickup.address}</Text>
            </View>
            {targetIsPickup ? <Ionicons name="locate" size={20} color={theme.primary} /> : <Ionicons name="checkmark-circle" size={20} color={theme.success} />}
          </View>

          <View style={styles.divider} />

          <View style={styles.addressRow}>
            <View style={[styles.dot, { backgroundColor: !targetIsPickup ? theme.secondary : "#CBD5E1" }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.addressLabel}>Dropoff</Text>
              <Text style={styles.addressPrimary} numberOfLines={1}>{order.customer.name}</Text>
              <Text style={styles.addressSecondary} numberOfLines={1}>
                {order.dropoff.address}{order.customer.apartment ? ` · ${order.customer.apartment}` : ""}
              </Text>
            </View>
            {!targetIsPickup ? <Ionicons name="locate" size={20} color={theme.secondary} /> : null}
          </View>
        </View>

        {/* Items list visible when arrived at pickup */}
        {isArrivedStage && order.status === "arrived_pickup" ? (
          <Animated.View entering={FadeInUp.duration(280)} style={styles.itemsBlock}>
            <Text style={styles.itemsTitle}>Order {order.order_number}</Text>
            <ScrollView style={{ maxHeight: 140 }} showsVerticalScrollIndicator={false}>
              {order.items.map((it, i) => (
                <View key={i} style={styles.itemRow}>
                  <Text style={styles.itemQty}>×{it.quantity}</Text>
                  <Text style={styles.itemName}>{it.name}</Text>
                </View>
              ))}
            </ScrollView>
            {order.customer.notes ? (
              <View style={styles.notesBlock}>
                <Ionicons name="chatbubble-ellipses-outline" size={14} color={theme.warning} />
                <Text style={styles.notesText}>Customer note: {order.customer.notes}</Text>
              </View>
            ) : null}
          </Animated.View>
        ) : null}

        {/* Dropoff details visible when arrived at dropoff */}
        {order.status === "arrived_dropoff" ? (
          <Animated.View entering={FadeInUp.duration(280)} style={styles.itemsBlock}>
            <View style={styles.itemRow}>
              <Ionicons name="business-outline" size={16} color={theme.textSecondary} />
              <Text style={styles.itemName}>{order.customer.apartment || "Main entrance"}</Text>
            </View>
            {order.customer.gate_code ? (
              <View style={styles.itemRow}>
                <Ionicons name="keypad-outline" size={16} color={theme.textSecondary} />
                <Text style={styles.itemName}>Gate code: {order.customer.gate_code}</Text>
              </View>
            ) : null}
            {order.customer.notes ? (
              <View style={styles.notesBlock}>
                <Ionicons name="chatbubble-ellipses-outline" size={14} color={theme.warning} />
                <Text style={styles.notesText}>{order.customer.notes}</Text>
              </View>
            ) : null}
          </Animated.View>
        ) : null}

        {/* Action */}
        {(order.status === "arrived_pickup" || order.status === "arrived_dropoff") ? (
          <SwipeToConfirm
            label={order.status === "arrived_pickup" ? "Swipe to confirm pickup" : "Swipe to complete delivery"}
            onComplete={() => {
              if (order.status === "arrived_pickup" && !order.pickup_otp_verified) {
                setOtpError(null);
                setOtpOpen("pickup");
                return;
              }
              if (order.status === "arrived_dropoff" && !order.dropoff_otp_verified) {
                setOtpError(null);
                setOtpOpen("dropoff");
                return;
              }
              advance();
            }}
            testID={order.status === "arrived_pickup" ? "swipe-confirm-pickup" : "swipe-confirm-delivery"}
            color={order.status === "arrived_dropoff" ? theme.success : theme.primary}
          />
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, busy && { opacity: 0.7 }]}
            onPress={advance}
            disabled={busy}
            testID="advance-button"
          >
            <Text style={styles.primaryBtnText}>{stage.primary}</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
        )}

        {/* Mini contact row */}
        <View style={styles.contactRow}>
          <TouchableOpacity style={styles.contactBtn} testID="call-customer-button">
            <Ionicons name="call-outline" size={18} color={theme.textPrimary} />
            <Text style={styles.contactText}>Call</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.contactBtn} testID="message-customer-button">
            <Ionicons name="chatbubble-outline" size={18} color={theme.textPrimary} />
            <Text style={styles.contactText}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.contactBtn} testID="support-button">
            <Ionicons name="help-circle-outline" size={20} color={theme.textPrimary} />
            <Text style={styles.contactText}>Support</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      <OtpModal
        visible={otpOpen !== null}
        kind={otpOpen || "pickup"}
        expectedHint={otpOpen === "pickup" ? order.pickup_otp : otpOpen === "dropoff" ? order.dropoff_otp : undefined}
        error={otpError}
        onClose={() => { setOtpOpen(null); setOtpError(null); }}
        onSubmit={async (otp) => {
          if (!otpOpen) return;
          try {
            const updated = await api.verifyOtp(order.id, otp, otpOpen);
            setOrder(updated);
            setOtpOpen(null);
            setOtpError(null);
            // After successful OTP verify, automatically advance to next stage
            await advance();
          } catch (e: any) {
            setOtpError("Incorrect code. Please try again.");
            throw e;
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background, gap: 16 },
  empty: { color: theme.textSecondary, fontSize: 16 },
  backBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: theme.primary, borderRadius: radius.pill },
  backBtnText: { color: "#fff", fontWeight: "700" },
  topRow: {
    position: "absolute",
    left: spacing.lg, right: spacing.lg,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    zIndex: 5,
  },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
  etaPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: theme.surface, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill,
  },
  etaText: { fontSize: 13, fontWeight: "700", color: theme.textPrimary },
  stagePill: {
    position: "absolute", alignSelf: "center",
    backgroundColor: theme.primary, paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill,
    zIndex: 4,
  },
  stagePillText: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: theme.surface,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.xl, paddingTop: spacing.md,
  },
  handle: { alignSelf: "center", width: 44, height: 5, backgroundColor: theme.border, borderRadius: 3, marginBottom: spacing.md },
  sheetHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.lg },
  sheetTitle: { fontSize: 22, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.5 },
  sheetSubtitle: { fontSize: 13, color: theme.textSecondary, marginTop: 3 },
  earnChip: { backgroundColor: theme.primaryLight, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, alignItems: "flex-end" },
  earnChipLabel: { fontSize: 9, color: theme.primary, fontWeight: "800", letterSpacing: 0.6 },
  earnChipValue: { fontSize: 18, fontWeight: "800", color: theme.primary, marginTop: 1 },
  addressBlock: { backgroundColor: theme.surfaceMuted, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: spacing.md, marginLeft: 24 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  addressLabel: { fontSize: 10, color: theme.textSecondary, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  addressPrimary: { fontSize: 15, fontWeight: "700", color: theme.textPrimary, marginTop: 2 },
  addressSecondary: { fontSize: 12, color: theme.textSecondary, marginTop: 1 },
  itemsBlock: { backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: theme.border },
  itemsTitle: { fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 },
  itemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 10 },
  itemQty: { fontSize: 14, fontWeight: "800", color: theme.primary, width: 28 },
  itemName: { fontSize: 14, color: theme.textPrimary, fontWeight: "500", flex: 1 },
  notesBlock: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, padding: 10, backgroundColor: "rgba(245,158,11,0.1)", borderRadius: radius.md },
  notesText: { fontSize: 12, color: theme.textPrimary, flex: 1 },
  primaryBtn: { height: 60, backgroundColor: theme.primary, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 17 },
  contactRow: { flexDirection: "row", justifyContent: "space-around", marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: theme.border },
  contactBtn: { alignItems: "center", gap: 4, paddingHorizontal: 16, paddingVertical: 4 },
  contactText: { fontSize: 11, fontWeight: "600", color: theme.textSecondary },
});
