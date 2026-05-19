import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
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
import type { Driver, NotificationPrefs } from "../src/types";
import { radius, shadows, spacing, theme } from "../src/theme";

const VEHICLE_OPTIONS: Array<{ id: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: "bicycle", label: "Bicycle", icon: "bicycle-outline" },
  { id: "scooter", label: "Scooter", icon: "rocket-outline" },
  { id: "motorbike", label: "Motorbike", icon: "speedometer-outline" },
  { id: "car", label: "Car", icon: "car-outline" },
];

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicleType, setVehicleType] = useState("bicycle");
  const [notifications, setNotifications] = useState<NotificationPrefs>({
    push: true, sound: true, new_orders: true, earnings_summary: true,
  });
  const [savingField, setSavingField] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api.getDriver();
    setDriver(d);
    setName(d.name);
    setPlate(d.plate);
    setEmail(d.email);
    setPhone(d.phone);
    setVehicleType(d.vehicle_type || "bicycle");
    setNotifications(d.notifications);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const saveField = async (patch: Partial<Driver> & { notifications?: NotificationPrefs }, marker: string) => {
    setSavingField(marker);
    try {
      const updated = await api.updateDriver(patch);
      setDriver(updated);
    } finally {
      setSavingField(null);
    }
  };

  const toggleNotification = (key: keyof NotificationPrefs) => {
    Haptics.selectionAsync().catch(() => {});
    const next = { ...notifications, [key]: !notifications[key] };
    setNotifications(next);
    saveField({ notifications: next }, `notif-${key}`);
  };

  const selectVehicle = (id: string) => {
    const label = VEHICLE_OPTIONS.find((v) => v.id === id)?.label || "Bicycle";
    setVehicleType(id);
    saveField({ vehicle_type: id, vehicle: `${label} • ${plate || "—"}` }, "vehicle");
    Haptics.selectionAsync().catch(() => {});
  };

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

        {/* Personal info */}
        <SectionTitle title="Personal info" />
        <Animated.View entering={FadeInUp.delay(140)} style={[styles.card, shadows.sm]}>
          <InputRow
            icon="person-outline"
            label="Full name"
            value={name}
            onChangeText={setName}
            onBlur={() => saveField({ name }, "name")}
            saving={savingField === "name"}
            testID="settings-name-input"
          />
          <Divider />
          <InputRow
            icon="mail-outline"
            label="Email"
            value={email}
            onChangeText={setEmail}
            onBlur={() => saveField({ email }, "email")}
            saving={savingField === "email"}
            keyboardType="email-address"
            testID="settings-email-input"
          />
          <Divider />
          <InputRow
            icon="call-outline"
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            onBlur={() => saveField({ phone }, "phone")}
            saving={savingField === "phone"}
            keyboardType="phone-pad"
            testID="settings-phone-input"
          />
        </Animated.View>

        {/* Vehicle */}
        <SectionTitle title="Vehicle" />
        <Animated.View entering={FadeInUp.delay(200)} style={[styles.card, shadows.sm]}>
          <View style={styles.vehicleGrid}>
            {VEHICLE_OPTIONS.map((v) => {
              const selected = v.id === vehicleType;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.vehicleTile, selected && styles.vehicleTileSelected]}
                  onPress={() => selectVehicle(v.id)}
                  testID={`vehicle-${v.id}`}
                >
                  <Ionicons name={v.icon} size={22} color={selected ? "#fff" : theme.textPrimary} />
                  <Text style={[styles.vehicleLabel, selected && { color: "#fff" }]}>{v.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Divider />
          <InputRow
            icon="card-outline"
            label="License plate"
            value={plate}
            onChangeText={setPlate}
            onBlur={() => {
              const label = VEHICLE_OPTIONS.find((v) => v.id === vehicleType)?.label || "Bicycle";
              saveField({ plate, vehicle: `${label} • ${plate || "—"}` }, "plate");
            }}
            saving={savingField === "plate"}
            autoCapitalize="characters"
            testID="settings-plate-input"
          />
        </Animated.View>

        {/* Notifications */}
        <SectionTitle title="Notifications" />
        <Animated.View entering={FadeInUp.delay(260)} style={[styles.card, shadows.sm]}>
          <ToggleRow
            icon="notifications-outline"
            label="Push notifications"
            value={notifications.push}
            onToggle={() => toggleNotification("push")}
            testID="toggle-push"
          />
          <Divider />
          <ToggleRow
            icon="volume-high-outline"
            label="Notification sound"
            value={notifications.sound}
            onToggle={() => toggleNotification("sound")}
            testID="toggle-sound"
          />
          <Divider />
          <ToggleRow
            icon="cube-outline"
            label="New order alerts"
            value={notifications.new_orders}
            onToggle={() => toggleNotification("new_orders")}
            testID="toggle-new-orders"
          />
          <Divider />
          <ToggleRow
            icon="cash-outline"
            label="Daily earnings summary"
            value={notifications.earnings_summary}
            onToggle={() => toggleNotification("earnings_summary")}
            testID="toggle-earnings"
          />
        </Animated.View>

        {/* Payouts & Support */}
        <SectionTitle title="More" />
        <Animated.View entering={FadeInUp.delay(320)} style={[styles.card, shadows.sm]}>
          <LinkRow icon="card" label="Payouts & bank" badge="Weekly" testID="link-payouts" />
          <Divider />
          <LinkRow icon="document-text-outline" label="Tax documents" testID="link-tax" />
          <Divider />
          <LinkRow icon="help-circle-outline" label="Help & Support" testID="link-support" />
          <Divider />
          <LinkRow icon="shield-checkmark-outline" label="Privacy & terms" testID="link-privacy" />
        </Animated.View>

        {/* Sign out */}
        <TouchableOpacity
          style={[styles.signOutBtn, shadows.sm]}
          testID="sign-out-button"
          onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})}
        >
          <Ionicons name="log-out-outline" size={20} color={theme.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>Driver app v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>;
}

function Divider() {
  return <View style={styles.divider} />;
}

function InputRow(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  onBlur?: () => void;
  saving?: boolean;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  testID?: string;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={props.icon} size={20} color={theme.textSecondary} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.rowLabel}>{props.label}</Text>
        <TextInput
          style={styles.input}
          value={props.value}
          onChangeText={props.onChangeText}
          onBlur={props.onBlur}
          keyboardType={props.keyboardType}
          autoCapitalize={props.autoCapitalize}
          placeholderTextColor={theme.textSecondary}
          testID={props.testID}
        />
      </View>
      {props.saving ? <ActivityIndicator size="small" color={theme.primary} /> : null}
    </View>
  );
}

function ToggleRow(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  onToggle: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={props.icon} size={20} color={theme.textSecondary} />
      <Text style={[styles.rowLabel, { flex: 1, marginLeft: 12, fontSize: 15, color: theme.textPrimary }]}>
        {props.label}
      </Text>
      <Switch
        value={props.value}
        onValueChange={props.onToggle}
        trackColor={{ true: theme.primary, false: "#CBD5E1" }}
        thumbColor="#FFFFFF"
        testID={props.testID}
      />
    </View>
  );
}

function LinkRow(props: { icon: keyof typeof Ionicons.glyphMap; label: string; badge?: string; testID?: string }) {
  return (
    <TouchableOpacity style={styles.row} testID={props.testID}>
      <Ionicons name={props.icon} size={20} color={theme.textSecondary} />
      <Text style={[styles.rowLabel, { flex: 1, marginLeft: 12, fontSize: 15, color: theme.textPrimary }]}>
        {props.label}
      </Text>
      {props.badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{props.badge}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
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
  sectionTitle: { fontSize: 11, fontWeight: "800", color: theme.textSecondary, letterSpacing: 1.2, marginTop: spacing.xxl, marginBottom: spacing.md, paddingHorizontal: 4 },
  card: { backgroundColor: theme.surface, borderRadius: radius.xl, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md },
  rowLabel: { fontSize: 11, color: theme.textSecondary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  input: { fontSize: 16, color: theme.textPrimary, fontWeight: "600", paddingVertical: 4, marginTop: 2 },
  divider: { height: 1, backgroundColor: theme.border, marginLeft: 32 },
  vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: spacing.md },
  vehicleTile: { flexGrow: 1, flexBasis: "47%", paddingVertical: 14, paddingHorizontal: 10, borderRadius: radius.lg, backgroundColor: theme.surfaceMuted, alignItems: "center", flexDirection: "row", gap: 10, borderWidth: 1.5, borderColor: "transparent" },
  vehicleTileSelected: { backgroundColor: theme.primary, borderColor: theme.primary },
  vehicleLabel: { fontSize: 14, color: theme.textPrimary, fontWeight: "600" },
  badge: { backgroundColor: theme.primaryLight, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, marginRight: 6 },
  badgeText: { color: theme.primary, fontSize: 11, fontWeight: "700" },
  signOutBtn: { marginTop: spacing.xxl, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: theme.surface, paddingVertical: 16, borderRadius: radius.lg, gap: 8 },
  signOutText: { color: theme.error, fontWeight: "700", fontSize: 16 },
  versionText: { textAlign: "center", color: theme.textSecondary, fontSize: 12, marginTop: spacing.xl },
});
