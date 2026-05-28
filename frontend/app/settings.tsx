import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { api } from "../src/api";
import { useAuth } from "../src/contexts/AuthContext";
import { Driver, NotificationPrefs } from "../src/types";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme, ThemeMode } from "../src/contexts/ThemeContext";

const VEHICLE_CATEGORIES = [
  {
    category: "Medium Vehicles",
    vehicles: [
      { id: "cargo_van", label: "Cargo Van", icon: "car-outline", capacity: 1500 },
      { id: "box_truck", label: "Box Truck", icon: "bus-outline", capacity: 5000 },
      { id: "flatbed_truck", label: "Flatbed Truck", icon: "train-outline", capacity: 8000 },
    ],
  },
  {
    category: "Heavy Vehicles",
    vehicles: [
      { id: "semi_truck", label: "Semi-Truck", icon: "bus-outline", capacity: 20000 },
      { id: "trailer_truck", label: "Trailer Truck", icon: "train-outline", capacity: 25000 },
      { id: "container_truck", label: "Container Truck", icon: "cube-outline", capacity: 30000 },
      { id: "tanker", label: "Tanker", icon: "water-outline", capacity: 35000 },
    ],
  },
  {
    category: "Specialized",
    vehicles: [
      { id: "refrigerated", label: "Refrigerated", icon: "snow-outline", capacity: 15000 },
      { id: "crane_truck", label: "Crane Truck", icon: "construct-outline", capacity: 12000 },
      { id: "hazmat", label: "Hazmat Vehicle", icon: "warning-outline", capacity: 18000 },
    ],
  },
  {
    category: "Other",
    vehicles: [
      { id: "other", label: "Other", icon: "ellipsis-horizontal-outline", capacity: 10000 },
    ],
  },
];

// Flatten for easy lookup
const ALL_VEHICLES = VEHICLE_CATEGORIES.flatMap(cat => cat.vehicles);

const THEME_OPTIONS = [
  { id: "light", label: "Light", icon: "sunny-outline" },
  { id: "dark", label: "Dark", icon: "moon-outline" },
  { id: "system", label: "System", icon: "phone-portrait-outline" },
];

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme, mode, setMode, isDark } = useTheme();
  const { logout, isAuthenticated, isLoading: authLoading } = useAuth();
  const [driver, setDriver] = useState(null);
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicleType, setVehicleType] = useState("cargo_van");
  const [vehicleCapacity, setVehicleCapacity] = useState(1500);
  const [notifications, setNotifications] = useState({
    push: true, sound: true, new_orders: true, earnings_summary: true,
  });
  const [savingField, setSavingField] = useState(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleSignOut = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    
    const doLogout = async () => {
      try {
        await logout();
      } catch (e) {
        // Ignore errors
      }
      router.replace("/");
    };

    // On web, Alert might not work properly, so handle it gracefully
    if (typeof window !== "undefined" && window.confirm) {
      if (window.confirm("Are you sure you want to sign out?")) {
        doLogout();
      }
    } else {
      Alert.alert(
        "Sign Out",
        "Are you sure you want to sign out?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Sign Out",
            style: "destructive",
            onPress: doLogout,
          },
        ]
      );
    }
  };

  const load = useCallback(async () => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setLoadError("Please login to view settings");
      return;
    }
    try {
      setLoadError(null);
      const d = await api.getDriver();
      setDriver(d);
      setName(d.name);
      setPlate(d.plate);
      setEmail(d.email);
      setPhone(d.phone);
      setVehicleType(d.vehicle_type || "cargo_van");
      setVehicleCapacity(d.vehicle_capacity_kg || 1500);
      setNotifications(d.notifications);
    } catch (e: any) {
      console.warn("Settings load failed:", e);
      setLoadError("Session expired. Please login again.");
    }
  }, [authLoading, isAuthenticated]);

  useFocusEffect(useCallback(() => { 
    if (!authLoading) load(); 
  }, [load, authLoading]));

  // Show login prompt if not authenticated
  if (!authLoading && (!isAuthenticated || loadError)) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xl }}>
        <Ionicons name="person-circle-outline" size={80} color={theme.textSecondary} />
        <Text style={{ fontSize: 20, fontWeight: "700", color: theme.textPrimary, marginTop: spacing.lg, textAlign: "center" }}>
          {loadError || "Login Required"}
        </Text>
        <TouchableOpacity 
          style={{ marginTop: spacing.xl, backgroundColor: theme.primary, paddingHorizontal: 40, paddingVertical: 16, borderRadius: radius.pill }}
          onPress={() => router.push("/login")}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const saveField = async (patch, marker) => {
    setSavingField(marker);
    try {
      const updated = await api.updateDriver(patch);
      setDriver(updated);
    } finally {
      setSavingField(null);
    }
  };

  const toggleNotification = (key) => {
    Haptics.selectionAsync().catch(() => {});
    const next = { ...notifications, [key]: !notifications[key] };
    setNotifications(next);
    saveField({ notifications: next }, `notif-${key}`);
  };

  const selectVehicle = (id) => {
    const vehicle = ALL_VEHICLES.find((v) => v.id === id);
    const label = vehicle?.label || "Cargo Van";
    const capacity = vehicle?.capacity || 1500;
    setVehicleType(id);
    setVehicleCapacity(capacity);
    saveField({ 
      vehicle_type: id, 
      vehicle_capacity_kg: capacity,
      vehicle: `${label} • ${plate || "—"}` 
    }, "vehicle");
    Haptics.selectionAsync().catch(() => {});
  };

  const selectTheme = (newMode) => {
    setMode(newMode);
    Haptics.selectionAsync().catch(() => {});
  };

  const styles = createStyles(theme);

  if (!driver) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="settings-screen">
      <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
        <TouchableOpacity
          style={[styles.iconBtn, shadows.sm]}
          onPress={() => router.back()}
          testID="settings-back-button"
        >
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>Account</Text>
        <View style={{ width: 44 }} />
      </Animated.View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <Animated.View entering={FadeInUp.delay(80)} style={[styles.profileCard, shadows.md]}>
          <Image source={{ uri: driver.avatar }} style={styles.avatar} />
          <Text style={styles.profileName}>{driver.name}</Text>
          <View style={styles.profileMetaRow}>
            <View style={styles.metaPill}>
              <Ionicons name="star" size={13} color={theme.warning} />
              <Text style={styles.metaPillText}>{driver.rating.toFixed(2)}</Text>
            </View>
            <View style={styles.metaPill}>
              <Ionicons name="checkmark-circle" size={13} color={theme.success} />
              <Text style={styles.metaPillText}>{driver.acceptance_rate.toFixed(0)}%</Text>
            </View>
            <View style={styles.metaPill}>
              <Ionicons name="cube-outline" size={13} color={theme.primary} />
              <Text style={styles.metaPillText}>{driver.deliveries_today} today</Text>
            </View>
          </View>
        </Animated.View>

        {/* Appearance / Theme */}
        <SectionTitle title="Appearance" theme={theme} />
        <Animated.View entering={FadeInUp.delay(100)} style={[styles.card, shadows.sm]}>
          <View style={styles.themeGrid}>
            {THEME_OPTIONS.map((t) => {
              const selected = t.id === mode;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.themeTile, selected && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                  onPress={() => selectTheme(t.id)}
                  testID={`theme-${t.id}`}
                >
                  <Ionicons name={t.icon} size={22} color={selected ? "#fff" : theme.textPrimary} />
                  <Text style={[styles.themeLabel, selected && { color: "#fff" }]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>

        {/* Personal info */}
        <SectionTitle title="Personal info" theme={theme} />
        <Animated.View entering={FadeInUp.delay(140)} style={[styles.card, shadows.sm]}>
          <InputRow
            icon="person-outline"
            label="Full name"
            value={name}
            onChangeText={setName}
            onBlur={() => saveField({ name }, "name")}
            saving={savingField === "name"}
            testID="settings-name-input"
            theme={theme}
          />
          <Divider theme={theme} />
          <InputRow
            icon="mail-outline"
            label="Email"
            value={email}
            onChangeText={setEmail}
            onBlur={() => saveField({ email }, "email")}
            saving={savingField === "email"}
            keyboardType="email-address"
            testID="settings-email-input"
            theme={theme}
          />
          <Divider theme={theme} />
          <InputRow
            icon="call-outline"
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            onBlur={() => saveField({ phone }, "phone")}
            saving={savingField === "phone"}
            keyboardType="phone-pad"
            testID="settings-phone-input"
            theme={theme}
          />
        </Animated.View>

        {/* Vehicle */}
        <SectionTitle title="Vehicle" theme={theme} />
        <Animated.View entering={FadeInUp.delay(200)} style={[styles.card, shadows.sm]}>
          {/* Current Vehicle Info */}
          <View style={styles.currentVehicleInfo}>
            <View style={styles.vehicleIconWrap}>
              <Ionicons 
                name={ALL_VEHICLES.find(v => v.id === vehicleType)?.icon || "bus-outline"} 
                size={24} 
                color={theme.primary} 
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.currentVehicleLabel}>
                {ALL_VEHICLES.find(v => v.id === vehicleType)?.label || "Select Vehicle"}
              </Text>
              <Text style={styles.currentVehicleCapacity}>
                Capacity: {vehicleCapacity.toLocaleString()} kg
              </Text>
            </View>
            {savingField === "vehicle" && <ActivityIndicator size="small" color={theme.primary} />}
          </View>
          
          <Divider theme={theme} />
          
          {/* Vehicle Selection by Category */}
          <ScrollView 
            horizontal={false} 
            nestedScrollEnabled 
            style={{ maxHeight: 200 }}
            showsVerticalScrollIndicator={false}
          >
            {VEHICLE_CATEGORIES.map((category) => (
              <View key={category.category} style={styles.vehicleCategory}>
                <Text style={styles.vehicleCategoryTitle}>{category.category}</Text>
                <View style={styles.vehicleGrid}>
                  {category.vehicles.map((v) => {
                    const selected = v.id === vehicleType;
                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[styles.vehicleTile, selected && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                        onPress={() => selectVehicle(v.id)}
                        testID={`vehicle-${v.id}`}
                      >
                        <Ionicons name={v.icon} size={18} color={selected ? "#fff" : theme.textPrimary} />
                        <Text style={[styles.vehicleLabel, selected && { color: "#fff" }]} numberOfLines={1}>{v.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
          
          <Divider theme={theme} />
          <InputRow
            icon="card-outline"
            label="License plate"
            value={plate}
            onChangeText={setPlate}
            onBlur={() => {
              const label = ALL_VEHICLES.find((v) => v.id === vehicleType)?.label || "Cargo Van";
              saveField({ plate, vehicle: `${label} • ${plate || "—"}` }, "plate");
            }}
            saving={savingField === "plate"}
            autoCapitalize="characters"
            testID="settings-plate-input"
            theme={theme}
          />
        </Animated.View>

        {/* Notifications */}
        <SectionTitle title="Notifications" theme={theme} />
        <Animated.View entering={FadeInUp.delay(260)} style={[styles.card, shadows.sm]}>
          <ToggleRow
            icon="notifications-outline"
            label="Push notifications"
            value={notifications.push}
            onToggle={() => toggleNotification("push")}
            testID="toggle-push"
            theme={theme}
          />
          <Divider theme={theme} />
          <ToggleRow
            icon="volume-high-outline"
            label="Notification sound"
            value={notifications.sound}
            onToggle={() => toggleNotification("sound")}
            testID="toggle-sound"
            theme={theme}
          />
          <Divider theme={theme} />
          <ToggleRow
            icon="cube-outline"
            label="New order alerts"
            value={notifications.new_orders}
            onToggle={() => toggleNotification("new_orders")}
            testID="toggle-new-orders"
            theme={theme}
          />
          <Divider theme={theme} />
          <ToggleRow
            icon="cash-outline"
            label="Daily earnings summary"
            value={notifications.earnings_summary}
            onToggle={() => toggleNotification("earnings_summary")}
            testID="toggle-earnings"
            theme={theme}
          />
        </Animated.View>

        {/* Documents & More */}
        <SectionTitle title="Documents" theme={theme} />
        <Animated.View entering={FadeInUp.delay(300)} style={[styles.card, shadows.sm]}>
          <LinkRow 
            icon="document-text-outline" 
            label="KYC Verification" 
            badge="Required"
            badgeColor={theme.warning}
            testID="link-kyc" 
            onPress={() => router.push("/kyc")}
            theme={theme}
          />
          <Divider theme={theme} />
          <LinkRow icon="card" label="Payouts & bank" badge="Weekly" testID="link-payouts" onPress={() => router.push("/wallet")} theme={theme} />
          <Divider theme={theme} />
          <LinkRow icon="receipt-outline" label="Tax documents" testID="link-tax" theme={theme} />
        </Animated.View>

        {/* Support */}
        <SectionTitle title="Support" theme={theme} />
        <Animated.View entering={FadeInUp.delay(340)} style={[styles.card, shadows.sm]}>
          <LinkRow icon="help-circle-outline" label="Help & Support" testID="link-support" theme={theme} />
          <Divider theme={theme} />
          <LinkRow icon="shield-checkmark-outline" label="Privacy & terms" testID="link-privacy" theme={theme} />
        </Animated.View>

        {/* Sign out */}
        <TouchableOpacity
          style={[styles.signOutBtn, shadows.sm]}
          testID="sign-out-button"
          onPress={handleSignOut}
        >
          <Ionicons name="log-out-outline" size={20} color={theme.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>Driver app v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

function SectionTitle({ title, theme }) {
  return <Text style={{ fontSize: 11, fontWeight: "800", color: theme.textSecondary, letterSpacing: 1.2, marginTop: spacing.xxl, marginBottom: spacing.md, paddingHorizontal: 4 }}>{title.toUpperCase()}</Text>;
}

function Divider({ theme }) {
  return <View style={{ height: 1, backgroundColor: theme.border, marginLeft: 32 }} />;
}

function InputRow(props) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.md }}>
      <Ionicons name={props.icon} size={20} color={props.theme.textSecondary} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ fontSize: 11, color: props.theme.textSecondary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }}>{props.label}</Text>
        <TextInput
          style={{ fontSize: 16, color: props.theme.textPrimary, fontWeight: "600", paddingVertical: 4, marginTop: 2 }}
          value={props.value}
          onChangeText={props.onChangeText}
          onBlur={props.onBlur}
          keyboardType={props.keyboardType}
          autoCapitalize={props.autoCapitalize}
          placeholderTextColor={props.theme.textSecondary}
          testID={props.testID}
        />
      </View>
      {props.saving ? <ActivityIndicator size="small" color={props.theme.primary} /> : null}
    </View>
  );
}

function ToggleRow(props) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.md }}>
      <Ionicons name={props.icon} size={20} color={props.theme.textSecondary} />
      <Text style={{ flex: 1, marginLeft: 12, fontSize: 15, color: props.theme.textPrimary, fontWeight: "500" }}>
        {props.label}
      </Text>
      <Switch
        value={props.value}
        onValueChange={props.onToggle}
        trackColor={{ true: props.theme.primary, false: "#CBD5E1" }}
        thumbColor="#FFFFFF"
        testID={props.testID}
      />
    </View>
  );
}

function LinkRow(props) {
  return (
    <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.md }} testID={props.testID} onPress={props.onPress}>
      <Ionicons name={props.icon} size={20} color={props.theme.textSecondary} />
      <Text style={{ flex: 1, marginLeft: 12, fontSize: 15, color: props.theme.textPrimary, fontWeight: "500" }}>
        {props.label}
      </Text>
      {props.badge ? (
        <View style={{ backgroundColor: props.badgeColor ? `${props.badgeColor}20` : props.theme.primaryLight, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, marginRight: 6 }}>
          <Text style={{ color: props.badgeColor || props.theme.primary, fontSize: 11, fontWeight: "700" }}>{props.badge}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={props.theme.textSecondary} />
    </TouchableOpacity>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 20, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.3 },
  profileCard: { backgroundColor: theme.primary, borderRadius: radius.xxl, padding: spacing.xl, alignItems: "center" },
  avatar: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: "rgba(255,255,255,0.4)" },
  profileName: { fontSize: 22, fontWeight: "800", color: "#fff", marginTop: spacing.md, letterSpacing: -0.4 },
  profileMetaRow: { flexDirection: "row", gap: 8, marginTop: spacing.md },
  metaPill: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, gap: 4 },
  metaPillText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  card: { backgroundColor: theme.surface, borderRadius: radius.xl, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  themeGrid: { flexDirection: "row", gap: 8, paddingVertical: spacing.md },
  themeTile: { flex: 1, paddingVertical: 14, borderRadius: radius.lg, backgroundColor: theme.surfaceMuted, alignItems: "center", gap: 6, borderWidth: 1.5, borderColor: "transparent" },
  themeLabel: { fontSize: 12, color: theme.textPrimary, fontWeight: "600" },
  // Vehicle styles
  currentVehicleInfo: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, gap: 12 },
  vehicleIconWrap: { width: 48, height: 48, borderRadius: 12, backgroundColor: theme.primaryLight, alignItems: "center", justifyContent: "center" },
  currentVehicleLabel: { fontSize: 16, fontWeight: "700", color: theme.textPrimary },
  currentVehicleCapacity: { fontSize: 13, color: theme.textSecondary, marginTop: 2 },
  vehicleCategory: { marginBottom: spacing.sm },
  vehicleCategoryTitle: { fontSize: 11, fontWeight: "700", color: theme.textSecondary, marginBottom: spacing.xs, textTransform: "uppercase", letterSpacing: 0.5 },
  vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  vehicleTile: { flexGrow: 1, flexBasis: "30%", paddingVertical: 10, paddingHorizontal: 8, borderRadius: radius.md, backgroundColor: theme.surfaceMuted, alignItems: "center", flexDirection: "row", gap: 6, borderWidth: 1.5, borderColor: "transparent" },
  vehicleLabel: { fontSize: 11, color: theme.textPrimary, fontWeight: "600", flexShrink: 1 },
  signOutBtn: { marginTop: spacing.xxl, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: theme.surface, paddingVertical: 16, borderRadius: radius.lg, gap: 8 },
  signOutText: { color: theme.error, fontWeight: "700", fontSize: 16 },
  versionText: { textAlign: "center", color: theme.textSecondary, fontSize: 12, marginTop: spacing.xl },
});
