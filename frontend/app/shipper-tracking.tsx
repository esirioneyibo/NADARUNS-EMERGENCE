import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { getAuthToken } from "../src/api";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";
import { useNotify } from "../src/contexts/NotificationContext";
import MapView from "../src/components/MapView";
import { useOrderTracking } from "../src/hooks/useWebSocket";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

interface ShipmentDetails {
  id: string;
  order_number: string;
  status: string;
  pickup: {
    address: string;
    name: string;
    phone: string;
    lat: number;
    lng: number;
  };
  dropoff: {
    address: string;
    name: string;
    phone: string;
    lat: number;
    lng: number;
  };
  vehicle_type: string;
  cargo_weight_kg: number;
  cargo_description: string;
  price_quote: number;
  created_at: string;
  pickup_code?: string;
  dropoff_code?: string;
  driver?: {
    id: string;
    name: string;
    phone: string;
    avatar: string;
    rating: number;
    vehicle: string;
    plate: string;
    location?: {
      lat: number;
      lng: number;
    };
  };
  timeline: Array<{
    status: string;
    timestamp: string;
    note?: string;
  }>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string; description: string }> = {
  pending: { label: "Finding Driver", color: "#F59E0B", icon: "search", description: "Looking for available drivers..." },
  accepted: { label: "Driver Assigned", color: "#6366F1", icon: "person", description: "A driver has accepted your shipment" },
  enroute_pickup: { label: "Driver En Route", color: "#3B82F6", icon: "navigate", description: "Driver is heading to pickup location" },
  arrived_pickup: { label: "Driver Arrived", color: "#8B5CF6", icon: "location", description: "Driver has arrived at pickup point" },
  picked_up: { label: "Picked Up", color: "#10B981", icon: "cube", description: "Your package has been collected" },
  enroute_dropoff: { label: "In Transit", color: "#3B82F6", icon: "car", description: "Package is on its way to destination" },
  arrived_dropoff: { label: "Arrived", color: "#8B5CF6", icon: "flag", description: "Driver has arrived at delivery location" },
  delivered: { label: "Delivered", color: "#10B981", icon: "checkmark-circle", description: "Package successfully delivered!" },
  rejected: { label: "Cancelled", color: "#EF4444", icon: "close-circle", description: "This shipment was cancelled" },
};

export default function ShipperTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { notify } = useNotify();
  const prevStatusRef = useRef<string | null>(null);

  const [shipment, setShipment] = useState<ShipmentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [liveDriverLocation, setLiveDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [tracking, setTracking] = useState<{
    eta_minutes: number | null;
    remaining_km: number | null;
    off_route: boolean;
    target: string | null;
  } | null>(null);

  const styles = createStyles(theme);

  // Alert the shipper on key lifecycle transitions (distinct sound + banner).
  useEffect(() => {
    const status = shipment?.status;
    if (!status) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === null || prev === status) return; // skip first load & no-change
    const STATUS_EVENTS = {
      accepted: "driver_assigned",
      arrived_pickup: "arrived_pickup",
      arrived_dropoff: "arrived_dropoff",
      delivered: "delivered",
    } as const;
    const ev = STATUS_EVENTS[status as keyof typeof STATUS_EVENTS];
    if (ev) notify(ev);
  }, [shipment?.status, notify]);

  // Real-time tracking via WebSocket
  const { isConnected: wsConnected, driverLocation: wsDriverLocation, orderStatus: wsOrderStatus } = useOrderTracking({
    orderId: id || "",
    enabled: !!id && !loading,
    onLocationUpdate: (location, driverId) => {
      console.log("[Tracking] Real-time location update:", location);
      setLiveDriverLocation(location);
    },
    onStatusUpdate: (status, data) => {
      console.log("[Tracking] Status update:", status);
      // Refresh shipment data when status changes
      loadShipment();
    },
  });

  // Use WebSocket location if available, fallback to polled location
  const currentDriverLocation = liveDriverLocation || wsDriverLocation || shipment?.driver?.location;

  const loadShipment = useCallback(async () => {
    try {
      const token = getAuthToken();
      const res = await fetch(`${BASE}/api/shipper/shipments/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setShipment(await res.json());
        setError(false);
      } else {
        setError(true);
      }
    } catch (e) {
      console.warn("Load shipment error:", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadShipment();
    // Poll for status updates every 10 seconds as a fallback (WebSocket is realtime)
    const interval = setInterval(loadShipment, 10000);
    return () => clearInterval(interval);
  }, [loadShipment]);

  // Live ETA / route-deviation polling (HTTP fallback + ETA source).
  const trackableStatuses = ["accepted", "enroute_pickup", "arrived_pickup", "picked_up", "enroute_dropoff", "arrived_dropoff"];
  useEffect(() => {
    if (!id || !shipment || !trackableStatuses.includes(shipment.status)) return;
    let alive = true;
    const pollLocation = async () => {
      try {
        const token = getAuthToken();
        const res = await fetch(`${BASE}/api/orders/${id}/driver-location`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && alive) {
          const data = await res.json();
          if (data.driver_location) setLiveDriverLocation(data.driver_location);
          setTracking({
            eta_minutes: data.eta_minutes ?? null,
            remaining_km: data.remaining_km ?? null,
            off_route: !!data.off_route,
            target: data.target ?? null,
          });
        }
      } catch {
        /* keep last known tracking; WS may still deliver */
      }
    };
    pollLocation();
    const iv = setInterval(pollLocation, 8000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, shipment?.status]);

  const handleCall = (phone: string) => {
    Linking.openURL(`tel:${phone}`);
  };

  const handleCancel = () => {
    Alert.alert(
      "Cancel Shipment",
      "Are you sure you want to cancel this shipment? This action cannot be undone.",
      [
        { text: "No, Keep It", style: "cancel" },
        {
          text: "Yes, Cancel",
          style: "destructive",
          onPress: async () => {
            setCancelling(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            
            try {
              const token = getAuthToken();
              const res = await fetch(`${BASE}/api/shipper/shipments/${id}/cancel`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
              });
              
              if (res.ok) {
                Alert.alert("Cancelled", "Your shipment has been cancelled.", [
                  { text: "OK", onPress: () => router.back() }
                ]);
              } else {
                const err = await res.json();
                Alert.alert("Error", err.detail || "Failed to cancel shipment");
              }
            } catch (e) {
              Alert.alert("Error", "Failed to cancel shipment");
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  if (error && !shipment) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]} testID="tracking-error">
        <Ionicons name="cloud-offline-outline" size={48} color={theme.textSecondary} />
        <Text style={styles.errorTitle}>Couldn't load shipment</Text>
        <Text style={styles.errorSub}>Check your connection and try again.</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          testID="tracking-retry"
          onPress={() => {
            setLoading(true);
            setError(false);
            loadShipment();
          }}
        >
          <Ionicons name="refresh" size={16} color="#fff" />
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={styles.errorBack}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading || !shipment) {
    const Sk = ({ h, w, mt }: { h: number; w?: any; mt?: number }) => (
      <View style={[styles.sk, { height: h, width: w ?? "100%", marginTop: mt ?? 0 }]} />
    );
    return (
      <View style={[styles.container, { paddingTop: insets.top }]} testID="tracking-skeleton">
        <View style={styles.header}>
          <View style={[styles.iconBtn, { backgroundColor: theme.surfaceMuted }]} />
          <Sk h={18} w={120} />
          <View style={{ width: 44 }} />
        </View>
        <View style={{ paddingHorizontal: spacing.xl, gap: spacing.lg, marginTop: spacing.md }}>
          <View style={[styles.sk, { height: 200, borderRadius: radius.xl }]} />
          <View style={[styles.sk, { height: 120, borderRadius: radius.xl }]} />
          <View style={[styles.sk, { height: 90, borderRadius: radius.xl }]} />
          <View style={[styles.sk, { height: 140, borderRadius: radius.xl }]} />
        </View>
      </View>
    );
  }

  const statusConfig = STATUS_CONFIG[shipment.status] || STATUS_CONFIG.pending;
  const isActive = !["delivered", "rejected"].includes(shipment.status);
  const canCancel = ["pending", "accepted"].includes(shipment.status);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
        <TouchableOpacity
          style={[styles.iconBtn, shadows.sm]}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.heading}>{shipment.order_number}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + "20" }]}>
            <Ionicons name={statusConfig.icon as any} size={12} color={statusConfig.color} />
            <Text style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
          </View>
        </View>
        <View style={{ width: 44 }} />
      </Animated.View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Map */}
        {isActive && (
          <Animated.View entering={FadeInUp.delay(100)} style={styles.mapContainer}>
            <MapView
              pickup={{ lat: shipment.pickup.lat, lng: shipment.pickup.lng }}
              dropoff={{ lat: shipment.dropoff.lat, lng: shipment.dropoff.lng }}
              driverLocation={currentDriverLocation}
              style={styles.map}
            />
            {wsConnected && (
              <View style={styles.liveIndicator}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
          </Animated.View>
        )}

        {/* Off-route warning */}
        {isActive && tracking?.off_route && (
          <Animated.View entering={FadeInDown.duration(220)} style={styles.offRouteBanner} testID="off-route-banner">
            <Ionicons name="warning" size={18} color="#fff" />
            <Text style={styles.offRouteText}>Driver appears to be off the expected route</Text>
          </Animated.View>
        )}

        {/* Live ETA */}
        {isActive && tracking && tracking.eta_minutes != null && (
          <Animated.View entering={FadeInUp.delay(120)} style={[styles.etaCard, shadows.sm]} testID="eta-card">
            <View style={styles.etaIcon}>
              <Ionicons name="time" size={22} color="#6366F1" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.etaValue}>
                {tracking.eta_minutes} min{" "}
                <Text style={styles.etaUnit}>{tracking.target === "dropoff" ? "to dropoff" : "to pickup"}</Text>
              </Text>
              <Text style={styles.etaSub}>
                {tracking.remaining_km != null ? `${tracking.remaining_km.toFixed(1)} km remaining` : "Calculating…"}
              </Text>
            </View>
            <View style={styles.etaLive}>
              <View style={styles.liveDot} />
              <Text style={styles.etaLiveText}>LIVE</Text>
            </View>
          </Animated.View>
        )}

        {/* Status Card */}
        <Animated.View entering={FadeInUp.delay(150)} style={[styles.statusCard, shadows.sm]}>
          <View style={[styles.statusIcon, { backgroundColor: statusConfig.color + "20" }]}>
            <Ionicons name={statusConfig.icon as any} size={28} color={statusConfig.color} />
          </View>
          <Text style={styles.statusTitle}>{statusConfig.label}</Text>
          <Text style={styles.statusDescription}>{statusConfig.description}</Text>
        </Animated.View>

        {/* Driver Info */}
        {shipment.driver && (
          <Animated.View entering={FadeInUp.delay(200)} style={[styles.card, shadows.sm]}>
            <Text style={styles.cardTitle}>Your Driver</Text>
            <View style={styles.driverRow}>
              <Image source={{ uri: shipment.driver.avatar }} style={styles.driverAvatar} />
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{shipment.driver.name}</Text>
                <View style={styles.ratingRow}>
                  <Ionicons name="star" size={14} color="#F59E0B" />
                  <Text style={styles.ratingText}>{shipment.driver.rating?.toFixed(1)}</Text>
                </View>
                <Text style={styles.vehicleText}>{shipment.driver.vehicle}</Text>
              </View>
              <TouchableOpacity
                style={styles.callBtn}
                onPress={() => handleCall(shipment.driver!.phone)}
              >
                <Ionicons name="call" size={22} color="#6366F1" />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Verification Codes */}
        {(shipment.pickup_code || shipment.dropoff_code) && (
          <Animated.View entering={FadeInUp.delay(250)} style={[styles.card, shadows.sm]}>
            <Text style={styles.cardTitle}>Verification Codes</Text>
            <View style={styles.codesRow}>
              {shipment.pickup_code && (
                <View style={styles.codeBox}>
                  <Text style={styles.codeLabel}>Pickup Code</Text>
                  <Text style={styles.codeValue}>{shipment.pickup_code}</Text>
                </View>
              )}
              {shipment.dropoff_code && (
                <View style={styles.codeBox}>
                  <Text style={styles.codeLabel}>Delivery Code</Text>
                  <Text style={styles.codeValue}>{shipment.dropoff_code}</Text>
                </View>
              )}
            </View>
            <Text style={styles.codeNote}>Share these codes with the driver for verification</Text>
          </Animated.View>
        )}

        {/* Route Details */}
        <Animated.View entering={FadeInUp.delay(300)} style={[styles.card, shadows.sm]}>
          <Text style={styles.cardTitle}>Route Details</Text>
          
          <View style={styles.routeItem}>
            <View style={[styles.routeDot, { backgroundColor: "#6366F1" }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>Pickup</Text>
              <Text style={styles.routeAddress}>{shipment.pickup.address}</Text>
              <Text style={styles.routeContact}>{shipment.pickup.name}</Text>
            </View>
          </View>
          
          <View style={styles.routeLine} />
          
          <View style={styles.routeItem}>
            <View style={[styles.routeDot, { backgroundColor: "#10B981" }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>Dropoff</Text>
              <Text style={styles.routeAddress}>{shipment.dropoff.address}</Text>
              <Text style={styles.routeContact}>{shipment.dropoff.name}</Text>
            </View>
          </View>
        </Animated.View>

        {/* Package Info */}
        <Animated.View entering={FadeInUp.delay(350)} style={[styles.card, shadows.sm]}>
          <Text style={styles.cardTitle}>Package Details</Text>
          <View style={styles.detailsGrid}>
            <View style={styles.detailItem}>
              <Ionicons name="cube-outline" size={20} color={theme.textSecondary} />
              <Text style={styles.detailValue}>{shipment.cargo_weight_kg} kg</Text>
              <Text style={styles.detailLabel}>Weight</Text>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="car-outline" size={20} color={theme.textSecondary} />
              <Text style={styles.detailValue}>{shipment.vehicle_type}</Text>
              <Text style={styles.detailLabel}>Vehicle</Text>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="pricetag-outline" size={20} color={theme.textSecondary} />
              <Text style={[styles.detailValue, { color: "#6366F1" }]}>€{shipment.price_quote?.toFixed(2)}</Text>
              <Text style={styles.detailLabel}>Price</Text>
            </View>
          </View>
          {shipment.cargo_description && (
            <View style={styles.descriptionBox}>
              <Text style={styles.descriptionLabel}>Description</Text>
              <Text style={styles.descriptionText}>{shipment.cargo_description}</Text>
            </View>
          )}
        </Animated.View>

        {/* Timeline */}
        {shipment.timeline && shipment.timeline.length > 0 && (
          <Animated.View entering={FadeInUp.delay(400)} style={[styles.card, shadows.sm]}>
            <Text style={styles.cardTitle}>Timeline</Text>
            {shipment.timeline.map((event, idx) => {
              const eventConfig = STATUS_CONFIG[event.status] || STATUS_CONFIG.pending;
              return (
                <View key={idx} style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: eventConfig.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.timelineStatus}>{eventConfig.label}</Text>
                    <Text style={styles.timelineTime}>
                      {new Date(event.timestamp).toLocaleString()}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Animated.View>
        )}
      </ScrollView>

      {/* Bottom Action */}
      {canCancel && (
        <View style={[styles.bottomAction, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity
            style={[styles.cancelBtn, cancelling && { opacity: 0.6 }]}
            onPress={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <>
                <Ionicons name="close-circle-outline" size={20} color="#EF4444" />
                <Text style={styles.cancelBtnText}>Cancel Shipment</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },

  // Skeleton + error/empty states
  sk: { backgroundColor: theme.surfaceMuted, borderRadius: 8, opacity: 0.7 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: theme.background, gap: 6 },
  errorTitle: { fontSize: 18, fontWeight: "800", color: theme.textPrimary, marginTop: 8 },
  errorSub: { fontSize: 14, color: theme.textSecondary, textAlign: "center", marginBottom: 8 },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#6366F1", paddingHorizontal: 24, paddingVertical: 12, borderRadius: radius.pill, marginTop: 8 },
  retryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  errorBack: { color: theme.textSecondary, fontWeight: "700", fontSize: 14 },

  // Off-route banner
  offRouteBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F59E0B",
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
  },
  offRouteText: { flex: 1, color: "#fff", fontSize: 13.5, fontWeight: "700" },

  // Live ETA card
  etaCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: theme.surface,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
  },
  etaIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" },
  etaValue: { fontSize: 20, fontWeight: "800", color: theme.textPrimary },
  etaUnit: { fontSize: 14, fontWeight: "600", color: theme.textSecondary },
  etaSub: { fontSize: 13, color: theme.textSecondary, marginTop: 2 },
  etaLive: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#10B98115", paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.pill },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#10B981" },
  etaLiveText: { fontSize: 10, fontWeight: "800", color: "#10B981", letterSpacing: 0.5 },
  
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
  headerCenter: { alignItems: "center" },
  heading: { fontSize: 18, fontWeight: "800", color: theme.textPrimary },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    marginTop: 4,
  },
  statusText: { fontSize: 11, fontWeight: "700" },
  
  mapContainer: {
    height: 200,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    borderRadius: radius.xl,
    overflow: "hidden",
    position: "relative",
  },
  map: { flex: 1 },
  liveIndicator: {
    position: "absolute",
    top: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    gap: 4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
  },
  liveText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  
  statusCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    alignItems: "center",
  },
  statusIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: theme.textPrimary,
  },
  statusDescription: {
    fontSize: 14,
    color: theme.textSecondary,
    marginTop: 4,
    textAlign: "center",
  },
  
  card: {
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.textPrimary,
    marginBottom: spacing.md,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  
  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  driverAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.surfaceMuted,
  },
  driverName: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.textPrimary,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  ratingText: {
    fontSize: 13,
    color: theme.textSecondary,
    fontWeight: "600",
  },
  vehicleText: {
    fontSize: 12,
    color: theme.textSecondary,
    marginTop: 2,
  },
  callBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#6366F120",
    alignItems: "center",
    justifyContent: "center",
  },
  
  codesRow: {
    flexDirection: "row",
    gap: 12,
  },
  codeBox: {
    flex: 1,
    backgroundColor: theme.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: "center",
  },
  codeLabel: {
    fontSize: 11,
    color: theme.textSecondary,
    fontWeight: "600",
  },
  codeValue: {
    fontSize: 24,
    fontWeight: "800",
    color: "#6366F1",
    marginTop: 4,
    letterSpacing: 4,
  },
  codeNote: {
    fontSize: 11,
    color: theme.textSecondary,
    textAlign: "center",
    marginTop: spacing.md,
  },
  
  routeItem: {
    flexDirection: "row",
    gap: 12,
  },
  routeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  routeLine: {
    width: 2,
    height: 24,
    backgroundColor: theme.border,
    marginLeft: 5,
    marginVertical: 4,
  },
  routeLabel: {
    fontSize: 11,
    color: theme.textSecondary,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  routeAddress: {
    fontSize: 14,
    color: theme.textPrimary,
    fontWeight: "600",
    marginTop: 2,
  },
  routeContact: {
    fontSize: 12,
    color: theme.textSecondary,
    marginTop: 2,
  },
  
  detailsGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  detailItem: {
    alignItems: "center",
  },
  detailValue: {
    fontSize: 16,
    fontWeight: "800",
    color: theme.textPrimary,
    marginTop: 6,
  },
  detailLabel: {
    fontSize: 11,
    color: theme.textSecondary,
    marginTop: 2,
  },
  descriptionBox: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  descriptionLabel: {
    fontSize: 11,
    color: theme.textSecondary,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  descriptionText: {
    fontSize: 14,
    color: theme.textPrimary,
    marginTop: 4,
  },
  
  timelineItem: {
    flexDirection: "row",
    gap: 12,
    marginBottom: spacing.md,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  timelineStatus: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.textPrimary,
  },
  timelineTime: {
    fontSize: 12,
    color: theme.textSecondary,
    marginTop: 2,
  },
  
  bottomAction: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.xl,
    backgroundColor: theme.background,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: "#EF4444",
    gap: 8,
  },
  cancelBtnText: {
    color: "#EF4444",
    fontWeight: "700",
    fontSize: 16,
  },
});
