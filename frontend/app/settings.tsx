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
import { useTranslation } from "react-i18next";

import { api } from "../src/api";
import { useAuth } from "../src/contexts/AuthContext";
import { Driver, NotificationPrefs } from "../src/types";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme, ThemeMode } from "../src/contexts/ThemeContext";
import LanguageSelector from "../src/components/LanguageSelector";

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
  const { t } = useTranslation();
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
  const [kycStatus, setKycStatus] = useState<string>("incomplete");

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
      if (window.confirm(t("settings.signOutConfirm"))) {
        doLogout();
      }
    } else {
      Alert.alert(
        t("settings.signOutTitle"),
        t("settings.signOutConfirm"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("settings.signOutTitle"),
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
      setLoadError(t("settings.loginPrompt"));
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
      setLoadError(t("settings.sessionExpired"));
    }
  }, [authLoading, isAuthenticated]);

  // KYC status is fetched in its own effect (independent of the profile load)
  // so the verification badge stays correct even if the profile call changes.
  const loadKyc = useCallback(async () => {
    if (authLoading || !isAuthenticated) return;
    try {
      const k = await api.getKYCStatus();
      setKycStatus(k.overall_status || "incomplete");
    } catch (e) {
      console.warn("KYC status fetch failed:", e);
    }
  }, [authLoading, isAuthenticated]);

  useFocusEffect(useCallback(() => { 
    if (!authLoading) { load(); loadKyc(); }
  }, [load, loadKyc, authLoading]));

  // Show login prompt if not authenticated
  if (!authLoading && (!isAuthenticated || loadError)) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xl }}>
        <Ionicons name="person-circle-outline" size={80} color={theme.textSecondary} />
        <Text style={{ fontSize: 20, fontWeight: "700", color: theme.textPrimary, marginTop: spacing.lg, textAlign: "center" }}>
          {loadError || t("common.loginRequired")}
        </Text>
        <TouchableOpacity 
          style={{ marginTop: spacing.xl, backgroundColor: theme.primary, paddingHorizontal: 40, paddingVertical: 16, borderRadius: radius.pill }}
          onPress={() => router.push("/login")}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>{t("common.goToLogin")}</Text>
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
        <Text style={styles.heading}>{t("settings.title")}</Text>
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
              <Text style={styles.metaPillText}>{t("settings.deliveriesToday", { count: driver.deliveries_today })}</Text>
            </View>
          </View>
        </Animated.View>

        {/* Appearance / Theme */}
        <SectionTitle title={t("settings.appearance")} theme={theme} />
        <Animated.View entering={FadeInUp.delay(100)} style={[styles.card, shadows.sm]}>
          <View style={styles.themeGrid}>
            {THEME_OPTIONS.map((opt) => {
              const selected = opt.id === mode;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.themeTile, selected && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                  onPress={() => selectTheme(opt.id)}
                  testID={`theme-${opt.id}`}
                >
                  <Ionicons name={opt.icon} size={22} color={selected ? "#fff" : theme.textPrimary} />
                  <Text style={[styles.themeLabel, selected && { color: "#fff" }]}>{t(`settings.theme${opt.label}`)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>

        {/* Language */}
        <SectionTitle title={t("language.title")} theme={theme} />
        <Animated.View entering={FadeInUp.delay(120)} style={[styles.card, shadows.sm]}>
          <LanguageSelector accentColor={theme.primary} />
        </Animated.View>

        {/* Account */}
        <SectionTitle title={t("settings.account")} theme={theme} />
        <Animated.View entering={FadeInUp.delay(140)} style={[styles.card, shadows.sm]}>
          <LinkRow
            icon="person-outline"
            label={t("settings.editProfile")}
            testID="link-edit-profile"
            onPress={() => router.push("/driver-edit")}
            theme={theme}
          />
          <Divider theme={theme} />
          <LinkRow
            icon="car-sport-outline"
            label={t("settings.myVehicles")}
            badge={`${driver.vehicles?.length || 1}`}
            testID="link-vehicles"
            onPress={() => router.push("/driver-vehicles")}
            theme={theme}
          />
          <Divider theme={theme} />
          <LinkRow
            icon="lock-closed-outline"
            label={t("settings.changePassword")}
            testID="link-password"
            onPress={() => router.push("/driver-edit")}
            theme={theme}
          />
        </Animated.View>

        {/* Notifications */}
        <SectionTitle title={t("settings.notifications")} theme={theme} />
        <Animated.View entering={FadeInUp.delay(260)} style={[styles.card, shadows.sm]}>
          <ToggleRow
            icon="notifications-outline"
            label={t("settings.pushNotifications")}
            value={notifications.push}
            onToggle={() => toggleNotification("push")}
            testID="toggle-push"
            theme={theme}
          />
          <Divider theme={theme} />
          <ToggleRow
            icon="volume-high-outline"
            label={t("settings.notificationSound")}
            value={notifications.sound}
            onToggle={() => toggleNotification("sound")}
            testID="toggle-sound"
            theme={theme}
          />
          <Divider theme={theme} />
          <ToggleRow
            icon="cube-outline"
            label={t("settings.newOrderAlerts")}
            value={notifications.new_orders}
            onToggle={() => toggleNotification("new_orders")}
            testID="toggle-new-orders"
            theme={theme}
          />
          <Divider theme={theme} />
          <ToggleRow
            icon="cash-outline"
            label={t("settings.dailyEarningsSummary")}
            value={notifications.earnings_summary}
            onToggle={() => toggleNotification("earnings_summary")}
            testID="toggle-earnings"
            theme={theme}
          />
        </Animated.View>

        {/* Documents & More */}
        <SectionTitle title={t("settings.documents")} theme={theme} />
        <Animated.View entering={FadeInUp.delay(300)} style={[styles.card, shadows.sm]}>
          <LinkRow 
            icon="document-text-outline" 
            label={t("settings.kycVerification")} 
            badge={
              kycStatus === "approved" ? t("settings.kycVerified")
              : kycStatus === "pending" ? t("settings.kycPending")
              : kycStatus === "rejected" ? t("settings.kycRejected")
              : t("settings.kycRequired")
            }
            badgeColor={
              kycStatus === "approved" ? theme.success
              : kycStatus === "pending" ? theme.warning
              : kycStatus === "rejected" ? theme.error
              : theme.warning
            }
            testID="link-kyc" 
            onPress={() => router.push("/kyc")}
            theme={theme}
          />
          <Divider theme={theme} />
          <LinkRow icon="card" label={t("settings.payoutsBank")} badge={t("settings.payoutsWeekly")} testID="link-payouts" onPress={() => router.push("/wallet")} theme={theme} />
          <Divider theme={theme} />
          <LinkRow icon="receipt-outline" label={t("settings.taxDocuments")} testID="link-tax" theme={theme} />
        </Animated.View>

        {/* Support */}
        <SectionTitle title={t("settings.support")} theme={theme} />
        <Animated.View entering={FadeInUp.delay(340)} style={[styles.card, shadows.sm]}>
          <LinkRow icon="help-circle-outline" label={t("settings.helpSupport")} testID="link-support" theme={theme} />
          <Divider theme={theme} />
          <LinkRow icon="shield-checkmark-outline" label={t("settings.privacyTerms")} testID="link-privacy" theme={theme} />
        </Animated.View>

        {/* Sign out */}
        <TouchableOpacity
          style={[styles.signOutBtn, shadows.sm]}
          testID="sign-out-button"
          onPress={handleSignOut}
        >
          <Ionicons name="log-out-outline" size={20} color={theme.error} />
          <Text style={styles.signOutText}>{t("common.signOut")}</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>{t("settings.driverAppVersion")}</Text>
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
