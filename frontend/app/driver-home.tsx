import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
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
import * as Location from "expo-location";
import { useTranslation } from "react-i18next";

import i18n from "../src/i18n";
import { api } from "../src/api";
import { Driver, Order } from "../src/types";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";
import { useNotify } from "../src/contexts/NotificationContext";
import { useAuth } from "../src/contexts/AuthContext";
import MapView from "../src/components/MapView";
import SlideToGoOnline from "../src/components/SlideToGoOnline";
import { useDriverLocation } from "../src/hooks/useWebSocket";
import JobMarker from "../src/components/JobMarker";
import JobDetailSheet from "../src/components/JobDetailSheet";

// Helper to get greeting based on time of day
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return i18n.t("driverHome.greetingMorning");
  if (hour < 17) return i18n.t("driverHome.greetingAfternoon");
  return i18n.t("driverHome.greetingEvening");
}

// Format current date
function formatDate() {
  const locale = i18n.language === "fi" ? "fi-FI" : "en-US";
  return new Date().toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// Live driver status label keys derived from the active order's lifecycle state
const STATUS_LABEL_KEYS: Record<string, string> = {
  accepted: "driverHome.status.accepted",
  enroute_pickup: "driverHome.status.enroute_pickup",
  arrived_pickup: "driverHome.status.arrived_pickup",
  picked_up: "driverHome.status.picked_up",
  enroute_dropoff: "driverHome.status.enroute_dropoff",
  arrived_dropoff: "driverHome.status.arrived_dropoff",
};

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { notify } = useNotify();
  const { t } = useTranslation();
  const seenJobIdsRef = useRef<Set<string>>(new Set());
  const initialJobsLoadedRef = useRef(false);
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [pending, setPending] = useState<Order | null>(null);
  const [active, setActive] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [locationPermission, setLocationPermission] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  
  // Map-based job discovery state
  const [availableOrders, setAvailableOrders] = useState<Order[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Order[]>([]);
  const [showJobSheet, setShowJobSheet] = useState(false);
  // Last known driver coordinates, used to show only *nearby* available jobs.
  const driverCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  const styles = createStyles(theme);

  // WebSocket for sending driver location
  const { isConnected: wsConnected, sendLocation } = useDriverLocation({
    driverId: driver?.id || "",
    orderId: active?.id,
    enabled: !!driver?.id && !!active?.id,
  });

  // Request location permission and start tracking when driver has an active order
  useEffect(() => {
    let locationSubscription: Location.LocationSubscription | null = null;

    const startLocationTracking = async () => {
      if (!active || !driver?.is_online) return;

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.log('[Location] Permission denied');
          setLocationPermission(false);
          return;
        }
        setLocationPermission(true);

        // Battery-friendly throttling: only emit when the driver has moved a
        // meaningful distance or enough time has elapsed since the last send.
        let lastSent: { lat: number; lng: number; t: number } | null = null;
        const movedMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
          const R = 6371000;
          const dLat = ((b.lat - a.lat) * Math.PI) / 180;
          const dLng = ((b.lng - a.lng) * Math.PI) / 180;
          const h =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
          return 2 * R * Math.asin(Math.sqrt(h));
        };

        // Start watching location (balanced accuracy = lower battery drain)
        locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 8000, // Update every 8 seconds
            distanceInterval: 25, // Or when moved 25 meters
          },
          (location) => {
            const { latitude: lat, longitude: lng } = location.coords;
            const now = Date.now();

            // Throttle: skip if barely moved and sent recently.
            if (lastSent && movedMeters(lastSent, { lat, lng }) < 20 && now - lastSent.t < 8000) {
              return;
            }
            lastSent = { lat, lng, t: now };
            driverCoordsRef.current = { lat, lng };

            // Prefer WebSocket; fall back to HTTP only when WS is down.
            if (wsConnected) {
              sendLocation({ lat, lng });
            } else {
              api.updateDriverLocation({ lat, lng }, active.id).catch(() => {});
            }
          }
        );
      } catch (e) {
        console.warn('[Location] Error:', e);
      }
    };

    startLocationTracking();

    return () => {
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, [active?.id, driver?.is_online, wsConnected, sendLocation]);

  const load = useCallback(async () => {
    // Don't load if auth is still loading or user is not authenticated
    if (authLoading) {
      return;
    }
    
    if (!isAuthenticated) {
      setAuthError("Please login to continue");
      setLoading(false);
      return;
    }
    
    // Check if user is a driver
    if (user?.type !== "driver") {
      setAuthError(t("driverHome.loginAsDriver"));
      setLoading(false);
      return;
    }
    
    try {
      setAuthError(null);
      const [d, p, a, available] = await Promise.all([
        api.getDriver(), 
        api.getPending(), 
        api.getActive(),
        api.getAvailableOrders(driverCoordsRef.current ?? undefined),
      ]);
      setDriver(d);
      setPending(p);
      setActive(a);
      setAvailableOrders(available || []);
      setConnectionLost(false);
    } catch (e: any) {
      console.warn("Home load failed", e);
      // If 401 or 403, redirect to login
      if (e.message?.includes("401") || e.message?.includes("403") || e.message?.includes("Authentication")) {
        setAuthError(t("settings.sessionExpired"));
      } else {
        setConnectionLost(true);
      }
    } finally {
      setLoading(false);
    }
  }, [authLoading, isAuthenticated, user?.type]);

  // When the driver goes online (and isn't already tracking an active order),
  // grab an approximate location once so "jobs nearby" is filtered to the area.
  useEffect(() => {
    if (!driver?.is_online) return;
    let cancelled = false;
    (async () => {
      try {
        const current = await Location.getForegroundPermissionsAsync();
        let granted = current.status === "granted";
        if (!granted && current.canAskAgain) {
          const req = await Location.requestForegroundPermissionsAsync();
          granted = req.status === "granted";
        }
        if (!granted) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        driverCoordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        load(); // refresh available jobs with proximity applied
      } catch (e) {
        console.warn("[Location] one-time fetch failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [driver?.is_online, load]);

  useFocusEffect(
    useCallback(() => {
      if (!authLoading) {
        load();
      }
    }, [load, authLoading])
  );

  // Auto-poll for pending order AND active order AND available orders while online
  useEffect(() => {
    if (!driver?.is_online) return;
    const id = setInterval(async () => {
      try {
        const [p, a, available] = await Promise.all([
          api.getPending(), 
          api.getActive(),
          api.getAvailableOrders(driverCoordsRef.current ?? undefined),
        ]);
        setPending(p);
        setActive(a);
        setAvailableOrders(available || []);
        setConnectionLost(false);
      } catch {
        setConnectionLost(true);
      }
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

  // Cluster orders by location (same lat/lng within ~11m = same cluster)
  const clusteredLocations = useMemo(() => {
    const clusters = new Map<string, { key: string; lat: number; lng: number; orders: Order[] }>();
    
    for (const order of availableOrders) {
      const lat = Math.round(order.pickup.lat * 10000) / 10000;
      const lng = Math.round(order.pickup.lng * 10000) / 10000;
      const key = `${lat},${lng}`;
      
      if (clusters.has(key)) {
        clusters.get(key)!.orders.push(order);
      } else {
        clusters.set(key, { key, lat, lng, orders: [order] });
      }
    }
    
    return Array.from(clusters.values());
  }, [availableOrders]);

  // Handle marker press - show job detail sheet
  const handleMarkerPress = useCallback((orders: Order[]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSelectedOrders(orders);
    setShowJobSheet(true);
  }, []);

  // Handle job accept from sheet
  const handleAcceptJob = useCallback(async (orderId: string) => {
    try {
      await api.accept(orderId);
      notify("job_accepted");
      setShowJobSheet(false);
      setSelectedOrders([]);
      // Remove from available orders
      setAvailableOrders(prev => prev.filter(o => o.id !== orderId));
      router.push("/order");
    } catch (error: any) {
      const msg = String(error?.message || error?.detail || "").toLowerCase();
      if (msg.includes("kyc") || msg.includes("verification required") || msg.includes("403")) {
        Alert.alert(
          t("driverHome.kycRequiredTitle"),
          t("driverHome.kycRequiredMsg"),
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("driverHome.kycVerifyNow"), onPress: () => router.push("/kyc") },
          ]
        );
        return;
      }
      Alert.alert(t("driverHome.jobTakenTitle"), t("driverHome.jobTakenMsg"));
      // Refresh available orders
      const available = await api.getAvailableOrders(driverCoordsRef.current ?? undefined);
      setAvailableOrders(available || []);
    }
  }, [router, notify]);

  // Alert the driver when a NEW job appears nearby (online, no active order).
  useEffect(() => {
    if (!driver?.is_online) {
      seenJobIdsRef.current = new Set(availableOrders.map((o) => o.id));
      return;
    }
    const current = new Set(availableOrders.map((o) => o.id));
    if (!initialJobsLoadedRef.current) {
      initialJobsLoadedRef.current = true;
      seenJobIdsRef.current = current;
      return;
    }
    let hasNew = false;
    for (const jid of current) {
      if (!seenJobIdsRef.current.has(jid)) {
        hasNew = true;
        break;
      }
    }
    seenJobIdsRef.current = current;
    if (hasNew && !active) notify("new_job");
  }, [availableOrders, driver?.is_online, active, notify]);

  // Handle job sheet close
  const handleCloseJobSheet = useCallback(() => {
    setShowJobSheet(false);
    setSelectedOrders([]);
  }, []);

  // === ALL HOOKS MUST BE ABOVE THIS LINE ===
  
  // Show login prompt if not authenticated
  if (!authLoading && (!isAuthenticated || authError)) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xl }]}>
        <Ionicons name="person-circle-outline" size={80} color={theme.textSecondary} />
        <Text style={{ fontSize: 20, fontWeight: "700", color: theme.textPrimary, marginTop: spacing.lg, textAlign: "center" }}>
          {authError || t("common.loginRequired")}
        </Text>
        <Text style={{ fontSize: 14, color: theme.textSecondary, marginTop: spacing.sm, textAlign: "center" }}>
          {t("driverHome.loginDashboardPrompt")}
        </Text>
        <TouchableOpacity 
          style={{ 
            marginTop: spacing.xl, 
            backgroundColor: theme.primary, 
            paddingHorizontal: 40, 
            paddingVertical: 16, 
            borderRadius: radius.pill 
          }}
          onPress={() => router.push("/login")}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>{t("common.goToLogin")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading || !driver) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const showRequest = driver.is_online && pending && !active;
  const isOffline = !driver.is_online && !active;

  // Show OFFLINE welcome screen when driver is not online
  if (isOffline) {
    return (
      <View style={[styles.offlineContainer, { paddingTop: insets.top + 20 }]} testID="home-screen">
        <ScrollView 
          style={{ flex: 1 }} 
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header with avatar and brand */}
          <Animated.View entering={FadeInDown.duration(400)} style={styles.offlineTopRow}>
            <Image source={{ uri: driver.avatar }} style={styles.offlineAvatarLarge} />
            <View style={styles.brandBadge}>
              <Ionicons name="flash" size={14} color="#10B981" />
              <Text style={styles.brandBadgeText}>NadaRuns</Text>
            </View>
          </Animated.View>

          {/* Greeting */}
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.greetingSection}>
            <Text style={styles.greetingLight}>{getGreeting()},</Text>
            <Text style={styles.greetingBold}>{driver.name.split(" ")[0]}!</Text>
            <Text style={styles.greetingDate}>{formatDate()}</Text>
          </Animated.View>

          {/* Stats Cards */}
          <Animated.View entering={FadeInUp.delay(200).duration(400)} style={[styles.statsCardsRow, shadows.sm]}>
            <View style={styles.statCardItem}>
              <View style={[styles.statIconCircle, { backgroundColor: "#DBEAFE" }]}>
                <Ionicons name="wallet-outline" size={24} color="#3B82F6" />
              </View>
              <Text style={styles.statCardValue}>€{driver.earnings_today.toFixed(2)}</Text>
              <Text style={styles.statCardLabel}>{t("driverHome.todaysEarnings")}</Text>
            </View>
            
            <View style={styles.statCardItem}>
              <View style={[styles.statIconCircle, { backgroundColor: "#FEF3C7" }]}>
                <Ionicons name="bicycle-outline" size={24} color="#F59E0B" />
              </View>
              <Text style={styles.statCardValue}>{driver.deliveries_today}</Text>
              <Text style={styles.statCardLabel}>{t("driverHome.deliveries")}</Text>
            </View>
            
            <View style={styles.statCardItem}>
              <View style={[styles.statIconCircle, { backgroundColor: "#E0E7FF" }]}>
                <Ionicons name="star-outline" size={24} color="#6366F1" />
              </View>
              <Text style={styles.statCardValue}>{driver.rating.toFixed(2)}</Text>
              <Text style={styles.statCardLabel}>{t("driverHome.rating")}</Text>
            </View>
          </Animated.View>

          {/* Vehicle & Acceptance Info */}
          <Animated.View entering={FadeInUp.delay(300).duration(400)} style={[styles.vehicleInfoBar, shadows.sm]}>
            <View style={styles.vehicleInfoItem}>
              <Ionicons name="car-outline" size={18} color={theme.textPrimary} />
              <Text style={styles.vehicleInfoText}>{driver.vehicle || t("driverHome.noVehicleSet")}</Text>
            </View>
            <View style={styles.vehicleInfoDivider} />
            <View style={styles.vehicleInfoItem}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#10B981" />
              <Text style={styles.vehicleInfoText}>{t("driverHome.acceptance", { rate: driver.acceptance_rate.toFixed(0) })}</Text>
            </View>
          </Animated.View>

          {/* Performance dashboard entry */}
          <Animated.View entering={FadeInUp.delay(350).duration(400)}>
            <TouchableOpacity
              style={[styles.offlinePerfBtn, shadows.sm]}
              onPress={() => router.push("/earnings")}
              testID="open-performance-offline"
            >
              <View style={[styles.statIconCircle, { backgroundColor: "#EDE9FE", width: 40, height: 40, marginBottom: 0 }]}>
                <Ionicons name="stats-chart" size={20} color="#6366F1" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.offlinePerfTitle}>{t("driverHome.performanceEarnings")}</Text>
                <Text style={styles.offlinePerfSub}>{t("driverHome.performanceSub")}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </Animated.View>

          {/* Ready Message */}
          <Animated.View entering={FadeIn.delay(400).duration(400)} style={styles.readyMessageBox}>
            <Ionicons name="location-outline" size={22} color={theme.textSecondary} />
            <Text style={styles.readyMessageText}>
              {t("driverHome.readyMessage")}
            </Text>
          </Animated.View>

          {/* Slide to go online */}
          <Animated.View 
            entering={SlideInUp.delay(500).duration(350)}
            style={[styles.slideContainerOffline, { marginTop: spacing.xl }]}
          >
            <SlideToGoOnline 
              onGoOnline={goOnline} 
              disabled={toggling}
              testID="slide-to-go-online"
            />
          </Animated.View>
        </ScrollView>
      </View>
    );
  }

  // ONLINE STATE - show map view with job markers
  return (
    <View style={styles.container} testID="home-screen">
      <View style={StyleSheet.absoluteFill}>
        <MapView
          pickup={active?.pickup || pending?.pickup}
          dropoff={active?.dropoff || pending?.dropoff}
          showRoute={!!active || !!pending}
          customMarkers={
            !active && !showJobSheet ? clusteredLocations.map((cluster) => ({
              key: cluster.key,
              coordinate: { latitude: cluster.lat, longitude: cluster.lng },
              children: (
                <JobMarker
                  count={cluster.orders.length}
                  earnings={cluster.orders.reduce((sum, o) => sum + o.earnings, 0) / cluster.orders.length}
                  isSelected={selectedOrders.some(so => cluster.orders.some(co => co.id === so.id))}
                />
              ),
              onPress: () => handleMarkerPress(cluster.orders),
            })) : undefined
          }
        />
      </View>

      {/* Job count badge - only when online and no active order */}
      {!active && !showJobSheet && availableOrders.length > 0 && (
        <View style={styles.jobCountBadge}>
          <Text style={styles.jobCountText}>
            {availableOrders.length} job{availableOrders.length !== 1 ? "s" : ""} nearby
          </Text>
        </View>
      )}

      {/* Top bar - only show when online */}
      {!isOffline && (
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
      )}

      {/* Status pill - only show when online */}
      {!isOffline && (
        <Animated.View
          entering={FadeIn.delay(120)}
          style={[styles.statusPill, { top: insets.top + 90 }, shadows.sm]}
        >
          <View style={[styles.dot, { backgroundColor: active ? theme.warning : theme.success }]} />
          <Text style={styles.statusText}>
            {active ? t(STATUS_LABEL_KEYS[active.status] || "driverHome.onDelivery") : t("driverHome.youreOnline")}
          </Text>
          <View style={styles.brandSep} />
          <Text style={styles.brandText}>NadaRuns</Text>
        </Animated.View>
      )}

      {/* Reconnecting banner - shown when polling/load fails (offline recovery) */}
      {connectionLost && (
        <Animated.View entering={FadeInDown.duration(200)} style={[styles.reconnectBanner, { top: insets.top + 140 }]}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.reconnectText}>{t("driverHome.reconnecting")}</Text>
        </Animated.View>
      )}

      {/* Bottom card - only show when online */}
      {!isOffline && (
        <Animated.View
          entering={SlideInDown.duration(350)}
          style={[styles.bottomSheet, { paddingBottom: 20 }, shadows.lg]}
        >
          <View style={styles.handle} />

          {active ? (
            <Animated.View entering={FadeInUp} style={styles.activeBanner} testID="active-order-banner">
              <View style={{ flex: 1 }}>
                <Text style={styles.activeLabel}>{t("driverHome.activeDelivery")}</Text>
                <Text style={styles.activeTitle} numberOfLines={1}>
                  {active.pickup.name} → {active.customer.name}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleResume}
                style={styles.resumeBtn}
                testID="resume-order-button"
              >
                <Text style={styles.resumeBtnText}>{t("driverHome.resume")}</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <>
              <TouchableOpacity
                style={styles.statsRow}
                activeOpacity={0.7}
                onPress={() => router.push("/earnings")}
                testID="open-performance"
              >
                <View style={styles.statBox}>
                  <Text style={styles.statValue} testID="earnings-today">
                    €{driver.earnings_today.toFixed(2)}
                  </Text>
                  <Text style={styles.statLabel}>{"Today's earnings"}</Text>
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
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.perfLink}
                onPress={() => router.push("/earnings")}
                testID="open-performance-link"
              >
                <Ionicons name="stats-chart" size={15} color={theme.primary} />
                <Text style={styles.perfLinkText}>View performance &amp; earnings</Text>
                <Ionicons name="chevron-forward" size={15} color={theme.primary} />
              </TouchableOpacity>

              <View style={styles.waitingMessage}>
                <Ionicons name="map" size={20} color={theme.primary} />
                <Text style={styles.waitingText}>
                  {availableOrders.length > 0 
                    ? t("driverHome.tapMarker")
                    : t("driverHome.searchingJobs")}
                </Text>
              </View>
            </>
          )}
        </Animated.View>
      )}

      {/* Incoming order overlay - OLD FLOW (disabled in favor of map-based discovery) */}
      {/* Now using JobDetailSheet instead when user taps a marker */}
      {false && showRequest ? (
        <Animated.View
          entering={SlideInDown.duration(350)}
          style={[styles.requestOverlay, { paddingBottom: 20 }, shadows.lg]}
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
                try {
                  await api.accept(pending!.id);
                  router.push("/order");
                } catch (error: any) {
                  const msg = String(error?.message || error?.detail || "").toLowerCase();
                  if (msg.includes("kyc") || msg.includes("verification required") || msg.includes("403")) {
                    Alert.alert(
                      t("driverHome.kycRequiredTitle"),
                      t("driverHome.kycRequiredMsg"),
                      [
                        { text: t("common.cancel"), style: "cancel" },
                        { text: t("driverHome.kycVerifyNow"), onPress: () => router.push("/kyc") },
                      ]
                    );
                  } else {
                    Alert.alert(t("driverHome.jobTakenTitle"), t("driverHome.jobTakenMsg"));
                  }
                }
              }}
              testID="accept-order-button"
            >
              <Text style={styles.acceptText}>Accept</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </Pressable>
          </View>
        </Animated.View>
      ) : null}

      {/* Job Detail Sheet - Map-based job discovery */}
      <JobDetailSheet
        orders={selectedOrders}
        visible={showJobSheet}
        onClose={handleCloseJobSheet}
        onAccept={handleAcceptJob}
        theme={theme}
      />
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },
  
  // Job discovery badge
  jobCountBadge: {
    position: "absolute",
    top: 180,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.8)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 10,
  },
  jobCountText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  
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
  
  // OFFLINE SCREEN - Full page welcome layout (no map)
  offlineContainer: {
    flex: 1,
    backgroundColor: "#F0FDF4", // Light green tint background
    paddingHorizontal: spacing.xl,
  },
  offlineTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  offlineAvatarLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: theme.primary,
  },
  brandBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    gap: 6,
  },
  brandBadgeText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#10B981",
  },
  greetingSection: {
    marginBottom: spacing.xl,
  },
  greetingLight: {
    fontSize: 28,
    fontWeight: "400",
    color: theme.textSecondary,
  },
  greetingBold: {
    fontSize: 36,
    fontWeight: "800",
    color: theme.textPrimary,
    marginTop: -4,
  },
  greetingDate: {
    fontSize: 15,
    color: theme.textSecondary,
    marginTop: 6,
  },
  statsCardsRow: {
    flexDirection: "row",
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  statCardItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  statIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  vehicleInfoBar: {
    flexDirection: "row",
    backgroundColor: "#ECFDF5",
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: "center",
  },
  vehicleInfoItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  vehicleInfoDivider: {
    width: 1,
    height: 24,
    backgroundColor: "#A7F3D0",
    marginHorizontal: spacing.md,
  },
  vehicleInfoText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.textPrimary,
  },
  readyMessageBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: theme.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 12,
  },
  readyMessageText: {
    flex: 1,
    fontSize: 14,
    color: theme.textSecondary,
    lineHeight: 20,
  },
  slideContainerOffline: {
    paddingHorizontal: 0,
  },

  reconnectBanner: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#475569",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.pill,
    zIndex: 30,
  },
  reconnectText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  perfLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    marginTop: 2,
  },
  perfLinkText: { fontSize: 13, fontWeight: "700", color: theme.primary },

  offlinePerfBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  offlinePerfTitle: { fontSize: 15, fontWeight: "700", color: theme.textPrimary },
  offlinePerfSub: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
});
;
