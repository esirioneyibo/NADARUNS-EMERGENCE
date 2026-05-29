import React, { useCallback, useState, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { useAuth } from "../src/contexts/AuthContext";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

interface DashboardStats {
  total_drivers: number;
  active_drivers: number;
  total_shippers: number;
  total_orders: number;
  pending_orders: number;
  completed_orders: number;
  total_revenue: number;
  pending_kyc: number;
}

interface KYCApplication {
  driver_id: string;
  driver_name: string;
  email: string;
  phone: string;
  submitted_at: string;
  overall_status: string;
}

interface Driver {
  id: string;
  name: string;
  email: string;
  is_online: boolean;
  rating: number;
  deliveries_today: number;
}

interface Shipper {
  id: string;
  company_name: string;
  email: string;
  total_orders: number;
}

export default function AdminScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { user, token, logout } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [kycApplications, setKycApplications] = useState<KYCApplication[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [shippers, setShippers] = useState<Shipper[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "kyc" | "drivers" | "shippers">("overview");

  const styles = createStyles(theme);

  const fetchData = useCallback(async () => {
    try {
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      };

      // Fetch dashboard stats
      const statsRes = await fetch(`${BASE}/api/admin/stats`, { headers });
      if (statsRes.ok) {
        setStats(await statsRes.json());
      } else {
        // Generate mock stats if endpoint doesn't exist yet
        setStats({
          total_drivers: 12,
          active_drivers: 5,
          total_shippers: 8,
          total_orders: 156,
          pending_orders: 3,
          completed_orders: 148,
          total_revenue: 4520.50,
          pending_kyc: 2,
        });
      }

      // Fetch KYC applications
      const kycRes = await fetch(`${BASE}/api/admin/kyc-applications`, { headers });
      if (kycRes.ok) {
        setKycApplications(await kycRes.json());
      }

      // Fetch drivers
      const driversRes = await fetch(`${BASE}/api/admin/drivers`, { headers });
      if (driversRes.ok) {
        setDrivers(await driversRes.json());
      }

      // Fetch shippers
      const shippersRes = await fetch(`${BASE}/api/admin/shippers`, { headers });
      if (shippersRes.ok) {
        setShippers(await shippersRes.json());
      }

    } catch (error) {
      console.warn("Failed to fetch admin data:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    // Check if user is admin
    if (!user || user.type !== "admin") {
      Alert.alert("Access Denied", "You must be an admin to access this page.", [
        { text: "OK", onPress: () => router.replace("/login") }
      ]);
      return;
    }
    fetchData();
  }, [user, fetchData]);

  const handleKYCAction = async (driverId: string, action: "approve" | "reject") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    try {
      const res = await fetch(`${BASE}/api/admin/kyc/${driverId}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
      });
      
      if (res.ok) {
        Alert.alert("Success", `KYC ${action}d successfully`);
        fetchData();
      } else {
        const err = await res.json();
        Alert.alert("Error", err.detail || `Failed to ${action} KYC`);
      }
    } catch (error) {
      Alert.alert("Error", `Failed to ${action} KYC`);
    }
  };

  const handleLogout = () => {
    const doLogout = async () => {
      await logout();
      router.replace("/");
    };

    // On web, Alert might not work properly, so handle it gracefully
    if (typeof window !== "undefined" && window.confirm) {
      if (window.confirm("Are you sure you want to logout?")) {
        doLogout();
      }
    } else {
      Alert.alert("Logout", "Are you sure you want to logout?", [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Logout", 
          style: "destructive",
          onPress: doLogout,
        }
      ]);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="admin-screen">
      <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.adminBadge}>
            <Ionicons name="shield-checkmark" size={20} color="#fff" />
          </View>
          <View>
            <Text style={styles.headerTitle}>Admin Dashboard</Text>
            <Text style={styles.headerSubtitle}>Welcome, {user?.name || "Admin"}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={22} color={theme.error} />
        </TouchableOpacity>
      </Animated.View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {[
          { id: "overview", label: "Overview", icon: "grid-outline" },
          { id: "kyc", label: "KYC", icon: "document-text-outline" },
          { id: "drivers", label: "Drivers", icon: "bicycle" },
          { id: "shippers", label: "Shippers", icon: "storefront-outline" },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            onPress={() => {
              setActiveTab(tab.id as any);
              Haptics.selectionAsync().catch(() => {});
            }}
          >
            <Ionicons 
              name={tab.icon as any} 
              size={18} 
              color={activeTab === tab.id ? theme.primary : theme.textSecondary} 
            />
            <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />
        }
      >
        {activeTab === "overview" && stats && (
          <>
            {/* Stats Grid */}
            <Text style={styles.sectionTitle}>PLATFORM OVERVIEW</Text>
            <View style={styles.statsGrid}>
              <StatCard
                icon="people"
                label="Total Drivers"
                value={stats.total_drivers.toString()}
                color="#10B981"
                theme={theme}
              />
              <StatCard
                icon="radio-button-on"
                label="Active Now"
                value={stats.active_drivers.toString()}
                color="#3B82F6"
                theme={theme}
              />
              <StatCard
                icon="storefront"
                label="Shippers"
                value={stats.total_shippers.toString()}
                color="#6366F1"
                theme={theme}
              />
              <StatCard
                icon="document-text"
                label="Pending KYC"
                value={stats.pending_kyc.toString()}
                color="#F59E0B"
                theme={theme}
              />
            </View>

            <Text style={styles.sectionTitle}>ORDERS</Text>
            <View style={styles.statsGrid}>
              <StatCard
                icon="cube"
                label="Total Orders"
                value={stats.total_orders.toString()}
                color="#8B5CF6"
                theme={theme}
              />
              <StatCard
                icon="time"
                label="Pending"
                value={stats.pending_orders.toString()}
                color="#F59E0B"
                theme={theme}
              />
              <StatCard
                icon="checkmark-circle"
                label="Completed"
                value={stats.completed_orders.toString()}
                color="#10B981"
                theme={theme}
              />
              <StatCard
                icon="cash"
                label="Revenue"
                value={`€${stats.total_revenue.toFixed(0)}`}
                color="#EC4899"
                theme={theme}
              />
            </View>
          </>
        )}

        {activeTab === "kyc" && (
          <>
            <Text style={styles.sectionTitle}>PENDING KYC APPLICATIONS</Text>
            {kycApplications.length === 0 ? (
              <View style={[styles.emptyCard, shadows.sm]}>
                <Ionicons name="checkmark-done-circle" size={48} color={theme.success} />
                <Text style={styles.emptyText}>No pending KYC applications</Text>
              </View>
            ) : (
              kycApplications.map((app, idx) => (
                <Animated.View 
                  key={app.driver_id} 
                  entering={FadeInUp.delay(idx * 80)}
                  style={[styles.kycCard, shadows.sm]}
                >
                  <View style={styles.kycHeader}>
                    <View style={styles.kycAvatar}>
                      <Ionicons name="person" size={24} color={theme.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.kycName}>{app.driver_name}</Text>
                      <Text style={styles.kycEmail}>{app.email}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: `${theme.warning}20` }]}>
                      <Text style={[styles.statusText, { color: theme.warning }]}>Pending</Text>
                    </View>
                  </View>
                  <Text style={styles.kycDate}>
                    Submitted: {new Date(app.submitted_at).toLocaleDateString()}
                  </Text>
                  <View style={styles.kycActions}>
                    <TouchableOpacity
                      style={[styles.kycBtn, styles.kycBtnReject]}
                      onPress={() => handleKYCAction(app.driver_id, "reject")}
                    >
                      <Ionicons name="close" size={18} color={theme.error} />
                      <Text style={[styles.kycBtnText, { color: theme.error }]}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.kycBtn, styles.kycBtnApprove]}
                      onPress={() => handleKYCAction(app.driver_id, "approve")}
                    >
                      <Ionicons name="checkmark" size={18} color="#fff" />
                      <Text style={[styles.kycBtnText, { color: "#fff" }]}>Approve</Text>
                    </TouchableOpacity>
                  </View>
                </Animated.View>
              ))
            )}
          </>
        )}

        {activeTab === "drivers" && (
          <>
            <Text style={styles.sectionTitle}>REGISTERED DRIVERS</Text>
            {drivers.length === 0 ? (
              <View style={[styles.emptyCard, shadows.sm]}>
                <Ionicons name="bicycle" size={48} color={theme.textSecondary} />
                <Text style={styles.emptyText}>No drivers registered yet</Text>
              </View>
            ) : (
              drivers.map((driver, idx) => (
                <Animated.View 
                  key={driver.id} 
                  entering={FadeInUp.delay(idx * 80)}
                  style={[styles.listCard, shadows.sm]}
                >
                  <View style={[styles.listAvatar, { backgroundColor: driver.is_online ? `${theme.success}20` : theme.surfaceMuted }]}>
                    <Ionicons name="bicycle" size={22} color={driver.is_online ? theme.success : theme.textSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listName}>{driver.name}</Text>
                    <Text style={styles.listEmail}>{driver.email}</Text>
                  </View>
                  <View style={styles.listStats}>
                    <View style={styles.listStat}>
                      <Ionicons name="star" size={12} color={theme.warning} />
                      <Text style={styles.listStatText}>{driver.rating.toFixed(1)}</Text>
                    </View>
                    <View style={[styles.onlineBadge, { backgroundColor: driver.is_online ? theme.success : theme.textSecondary }]}>
                      <Text style={styles.onlineText}>{driver.is_online ? "Online" : "Offline"}</Text>
                    </View>
                  </View>
                </Animated.View>
              ))
            )}
          </>
        )}

        {activeTab === "shippers" && (
          <>
            <Text style={styles.sectionTitle}>REGISTERED SHIPPERS</Text>
            {shippers.length === 0 ? (
              <View style={[styles.emptyCard, shadows.sm]}>
                <Ionicons name="storefront" size={48} color={theme.textSecondary} />
                <Text style={styles.emptyText}>No shippers registered yet</Text>
              </View>
            ) : (
              shippers.map((shipper, idx) => (
                <Animated.View 
                  key={shipper.id} 
                  entering={FadeInUp.delay(idx * 80)}
                  style={[styles.listCard, shadows.sm]}
                >
                  <View style={[styles.listAvatar, { backgroundColor: `${theme.primary}20` }]}>
                    <Ionicons name="storefront" size={22} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listName}>{shipper.company_name}</Text>
                    <Text style={styles.listEmail}>{shipper.email}</Text>
                  </View>
                  <View style={styles.listStats}>
                    <View style={styles.listStat}>
                      <Ionicons name="cube-outline" size={12} color={theme.textSecondary} />
                      <Text style={styles.listStatText}>{shipper.total_orders} orders</Text>
                    </View>
                  </View>
                </Animated.View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatCard({ icon, label, value, color, theme }: { icon: string; label: string; value: string; color: string; theme: any }) {
  return (
    <View style={[createStyles(theme).statCard, shadows.sm]}>
      <View style={[createStyles(theme).statIcon, { backgroundColor: `${color}15` }]}>
        <Ionicons name={icon as any} size={22} color={color} />
      </View>
      <Text style={createStyles(theme).statValue}>{value}</Text>
      <Text style={createStyles(theme).statLabel}>{label}</Text>
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  adminBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.warning,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: theme.textPrimary },
  headerSubtitle: { fontSize: 12, color: theme.textSecondary },
  logoutBtn: { padding: 8 },

  tabBar: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  tabActive: { backgroundColor: `${theme.primary}15` },
  tabLabel: { fontSize: 12, fontWeight: "600", color: theme.textSecondary },
  tabLabelActive: { color: theme.primary },

  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: theme.textSecondary,
    letterSpacing: 1.2,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: spacing.lg,
  },
  statCard: {
    width: "47%",
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    alignItems: "center",
  },
  statIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  statValue: { fontSize: 24, fontWeight: "800", color: theme.textPrimary },
  statLabel: { fontSize: 11, color: theme.textSecondary, fontWeight: "600", marginTop: 2 },

  emptyCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    alignItems: "center",
  },
  emptyText: { fontSize: 14, color: theme.textSecondary, marginTop: spacing.md },

  kycCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  kycHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  kycAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: `${theme.primary}15`,
    alignItems: "center",
    justifyContent: "center",
  },
  kycName: { fontSize: 16, fontWeight: "700", color: theme.textPrimary },
  kycEmail: { fontSize: 12, color: theme.textSecondary },
  kycDate: { fontSize: 11, color: theme.textSecondary, marginTop: 8 },
  kycActions: { flexDirection: "row", gap: 10, marginTop: spacing.md },
  kycBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: radius.lg,
    gap: 6,
  },
  kycBtnReject: { backgroundColor: `${theme.error}15` },
  kycBtnApprove: { backgroundColor: theme.success },
  kycBtnText: { fontSize: 14, fontWeight: "700" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: "700" },

  listCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  listAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  listName: { fontSize: 15, fontWeight: "700", color: theme.textPrimary },
  listEmail: { fontSize: 12, color: theme.textSecondary },
  listStats: { alignItems: "flex-end", gap: 4 },
  listStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  listStatText: { fontSize: 12, color: theme.textSecondary, fontWeight: "600" },
  onlineBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  onlineText: { fontSize: 10, fontWeight: "700", color: "#fff" },
});
