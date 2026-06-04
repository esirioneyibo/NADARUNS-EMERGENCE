import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";

import { getAuthToken } from "../src/api";
import { useAuth } from "../src/contexts/AuthContext";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Shipment {
  id: string;
  order_number: string;
  status: string;
  pickup: { address: string; name: string };
  dropoff: { address: string; name: string };
  vehicle_type: string;
  cargo_weight_kg: number;
  price_quote: number;
  created_at: string;
  driver?: {
    name: string;
    phone: string;
    avatar: string;
    rating: number;
  };
}

interface ShipperProfile {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  total_shipments: number;
  avatar: string;
  preferred_vehicle_type?: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: "shipperHome.status.pending", color: "#F59E0B", icon: "time-outline" },
  accepted: { label: "shipperHome.status.accepted", color: "#6366F1", icon: "person-outline" },
  enroute_pickup: { label: "shipperHome.status.enroute_pickup", color: "#3B82F6", icon: "navigate-outline" },
  arrived_pickup: { label: "shipperHome.status.arrived_pickup", color: "#8B5CF6", icon: "location-outline" },
  picked_up: { label: "shipperHome.status.picked_up", color: "#10B981", icon: "cube-outline" },
  enroute_dropoff: { label: "shipperHome.status.enroute_dropoff", color: "#3B82F6", icon: "car-outline" },
  arrived_dropoff: { label: "shipperHome.status.arrived_dropoff", color: "#8B5CF6", icon: "flag-outline" },
  delivered: { label: "shipperHome.status.delivered", color: "#10B981", icon: "checkmark-circle-outline" },
  rejected: { label: "shipperHome.status.rejected", color: "#EF4444", icon: "close-circle-outline" },
};

const VEHICLE_ICONS: Record<string, string> = {
  cargo_van: "🚐",
  box_truck: "📦",
  flatbed_truck: "🚚",
  semi_truck: "🚛",
  trailer_truck: "🚜",
  container_truck: "📦",
  tanker: "🛢️",
  refrigerated: "❄️",
  crane_truck: "🏗️",
  hazmat: "⚠️",
  other: "🚚",
};

export default function ShipperHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  
  const [profile, setProfile] = useState<ShipperProfile | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isDemo, setIsDemo] = useState(false);

  const styles = createStyles(theme);

  const loadData = useCallback(async () => {
    const token = getAuthToken();
    
    // If no token, use demo mode
    if (!token) {
      setIsDemo(true);
      // Set demo profile
      setProfile({
        id: "demo-shipper",
        company_name: "Demo Business",
        contact_name: "Demo User",
        email: "demo@nadaruns.com",
        total_shipments: 0,
        avatar: "https://api.dicebear.com/7.x/initials/png?seed=Demo",
      });
      setShipments([]);
      setLoading(false);
      return;
    }

    try {
      const [profileRes, shipmentsRes] = await Promise.all([
        fetch(`${BASE}/api/shipper/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${BASE}/api/shipper/shipments`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (profileRes.ok) {
        setProfile(await profileRes.json());
      }
      if (shipmentsRes.ok) {
        setShipments(await shipmentsRes.json());
      }
    } catch (e) {
      console.warn("Failed to load shipper data", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Auto-refresh for real-time updates
  useEffect(() => {
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleLogout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    Alert.alert(
      t("settings.signOutTitle"),
      t("settings.signOutConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.signOutTitle"),
          style: "destructive",
          onPress: async () => {
            await logout();
            router.replace("/login");
          },
        },
      ]
    );
  };

  const activeShipments = shipments.filter(s => !["delivered", "rejected"].includes(s.status));
  const completedShipments = shipments.filter(s => ["delivered", "rejected"].includes(s.status));

  if (loading) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    );
  }

  const renderShipmentCard = ({ item }: { item: Shipment }) => {
    const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
    const vehicleIcon = VEHICLE_ICONS[item.vehicle_type] || "📦";

    return (
      <TouchableOpacity
        style={[styles.shipmentCard, shadows.sm]}
        onPress={() => router.push(`/shipper-tracking?id=${item.id}`)}
        activeOpacity={0.8}
      >
        <View style={styles.shipmentHeader}>
          <View style={styles.shipmentOrderInfo}>
            <Text style={styles.shipmentNumber}>{item.order_number}</Text>
            <Text style={styles.shipmentDate}>
              {new Date(item.created_at).toLocaleDateString()}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + "20" }]}>
            <Ionicons name={statusConfig.icon as any} size={14} color={statusConfig.color} />
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {t(statusConfig.label)}
            </Text>
          </View>
        </View>

        <View style={styles.routeSection}>
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: "#6366F1" }]} />
            <Text style={styles.routeText} numberOfLines={1}>{item.pickup.address}</Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: "#10B981" }]} />
            <Text style={styles.routeText} numberOfLines={1}>{item.dropoff.address}</Text>
          </View>
        </View>

        <View style={styles.shipmentFooter}>
          <View style={styles.shipmentMeta}>
            <Text style={styles.vehicleIcon}>{vehicleIcon}</Text>
            <Text style={styles.metaText}>{item.cargo_weight_kg} kg</Text>
          </View>
          <Text style={styles.priceText}>€{item.price_quote?.toFixed(2)}</Text>
        </View>

        {item.driver && (
          <View style={styles.driverInfo}>
            <Image source={{ uri: item.driver.avatar }} style={styles.driverAvatar} />
            <View style={{ flex: 1 }}>
              <Text style={styles.driverName}>{item.driver.name}</Text>
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={12} color="#F59E0B" />
                <Text style={styles.ratingText}>{item.driver.rating?.toFixed(1)}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.callBtn}>
              <Ionicons name="call" size={18} color="#6366F1" />
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="shipper-home">
      {/* Header */}
      <Animated.View entering={FadeInDown.duration(300)} style={styles.header}>
        <View style={styles.headerLeft}>
          <Image 
            source={{ uri: profile?.avatar || "https://api.dicebear.com/7.x/initials/png?seed=Company" }} 
            style={styles.companyAvatar} 
          />
          <View>
            <Text style={styles.welcomeText}>{t("shipperHome.welcomeBack")}</Text>
            <Text style={styles.companyName}>{profile?.company_name || t("shipperHome.business")}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity 
            style={styles.logoutBtn} 
            onPress={() => router.push("/shipper-settings")}
          >
            <Ionicons name="settings-outline" size={22} color={theme.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={22} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      </Animated.View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6366F1" />
        }
      >
        {/* Stats */}
        <Animated.View entering={FadeInUp.delay(100)} style={styles.statsRow}>
          <View style={[styles.statCard, shadows.sm]}>
            <View style={[styles.statIconWrap, { backgroundColor: "#6366F120" }]}>
              <Ionicons name="cube-outline" size={22} color="#6366F1" />
            </View>
            <Text style={styles.statValue}>{profile?.total_shipments || 0}</Text>
            <Text style={styles.statLabel}>{t("shipperHome.totalShipments")}</Text>
          </View>
          <View style={[styles.statCard, shadows.sm]}>
            <View style={[styles.statIconWrap, { backgroundColor: "#F59E0B20" }]}>
              <Ionicons name="time-outline" size={22} color="#F59E0B" />
            </View>
            <Text style={styles.statValue}>{activeShipments.length}</Text>
            <Text style={styles.statLabel}>{t("shipperHome.active")}</Text>
          </View>
          <View style={[styles.statCard, shadows.sm]}>
            <View style={[styles.statIconWrap, { backgroundColor: "#10B98120" }]}>
              <Ionicons name="checkmark-circle-outline" size={22} color="#10B981" />
            </View>
            <Text style={styles.statValue}>{completedShipments.length}</Text>
            <Text style={styles.statLabel}>{t("shipperHome.completed")}</Text>
          </View>
        </Animated.View>

        {/* Create Shipment Button */}
        <Animated.View entering={FadeInUp.delay(200)} style={styles.createSection}>
          <TouchableOpacity
            style={[styles.createBtn, shadows.md]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              router.push("/shipper-create");
            }}
          >
            <Ionicons name="add-circle" size={24} color="#fff" />
            <Text style={styles.createBtnText}>{t("shipperHome.createNewShipment")}</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Active Shipments */}
        {activeShipments.length > 0 && (
          <Animated.View entering={FadeInUp.delay(300)} style={styles.section}>
            <Text style={styles.sectionTitle}>{t("shipperHome.activeShipments")}</Text>
            {activeShipments.map((item) => (
              <View key={item.id}>
                {renderShipmentCard({ item })}
              </View>
            ))}
          </Animated.View>
        )}

        {/* Recent Shipments */}
        {completedShipments.length > 0 && (
          <Animated.View entering={FadeInUp.delay(400)} style={styles.section}>
            <Text style={styles.sectionTitle}>{t("shipperHome.recentShipments")}</Text>
            {completedShipments.slice(0, 5).map((item) => (
              <View key={item.id}>
                {renderShipmentCard({ item })}
              </View>
            ))}
          </Animated.View>
        )}

        {shipments.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={64} color={theme.textSecondary} />
            <Text style={styles.emptyTitle}>{t("shipperHome.noShipmentsYet")}</Text>
            <Text style={styles.emptyText}>
              {t("shipperHome.createFirst")}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },
  
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  companyAvatar: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: theme.surfaceMuted,
  },
  welcomeText: {
    fontSize: 13,
    color: theme.textSecondary,
  },
  companyName: {
    fontSize: 18,
    fontWeight: "800",
    color: theme.textPrimary,
  },
  logoutBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.surface,
    alignItems: "center",
    justifyContent: "center",
  },

  statsRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.xl,
    gap: 12,
    marginBottom: spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: "center",
  },
  statIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "800",
    color: theme.textPrimary,
  },
  statLabel: {
    fontSize: 10,
    color: theme.textSecondary,
    marginTop: 2,
    textAlign: "center",
  },

  createSection: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xl,
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6366F1",
    paddingVertical: 16,
    borderRadius: radius.lg,
    gap: 10,
  },
  createBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
  },

  section: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.textSecondary,
    marginBottom: spacing.md,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  shipmentCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  shipmentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  shipmentOrderInfo: {},
  shipmentNumber: {
    fontSize: 16,
    fontWeight: "800",
    color: theme.textPrimary,
  },
  shipmentDate: {
    fontSize: 12,
    color: theme.textSecondary,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
  },

  routeSection: {
    backgroundColor: theme.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  routeLine: {
    width: 2,
    height: 16,
    backgroundColor: theme.border,
    marginLeft: 4,
    marginVertical: 4,
  },
  routeText: {
    flex: 1,
    fontSize: 13,
    color: theme.textPrimary,
  },

  shipmentFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  shipmentMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  vehicleIcon: {
    fontSize: 18,
  },
  metaText: {
    fontSize: 13,
    color: theme.textSecondary,
    fontWeight: "600",
  },
  priceText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#6366F1",
  },

  driverInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    gap: 12,
  },
  driverAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.surfaceMuted,
  },
  driverName: {
    fontSize: 14,
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
    fontSize: 12,
    color: theme.textSecondary,
  },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#6366F120",
    alignItems: "center",
    justifyContent: "center",
  },

  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xxl * 2,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.textPrimary,
    marginTop: spacing.lg,
  },
  emptyText: {
    fontSize: 14,
    color: theme.textSecondary,
    marginTop: 6,
    textAlign: "center",
  },
});
