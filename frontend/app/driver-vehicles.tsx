import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { api } from "../src/api";
import { Driver, Vehicle } from "../src/types";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

const VEHICLE_CATEGORIES = [
  { category: "Medium", vehicles: [
    { id: "cargo_van", label: "Cargo Van", icon: "car-outline", capacity: 1500 },
    { id: "box_truck", label: "Box Truck", icon: "bus-outline", capacity: 5000 },
    { id: "flatbed_truck", label: "Flatbed", icon: "train-outline", capacity: 8000 },
  ]},
  { category: "Heavy", vehicles: [
    { id: "semi_truck", label: "Semi-Truck", icon: "bus-outline", capacity: 20000 },
    { id: "trailer_truck", label: "Trailer", icon: "train-outline", capacity: 25000 },
    { id: "container_truck", label: "Container", icon: "cube-outline", capacity: 30000 },
    { id: "tanker", label: "Tanker", icon: "water-outline", capacity: 35000 },
  ]},
  { category: "Specialized", vehicles: [
    { id: "refrigerated", label: "Refrigerated", icon: "snow-outline", capacity: 15000 },
    { id: "crane_truck", label: "Crane", icon: "construct-outline", capacity: 12000 },
    { id: "hazmat", label: "Hazmat", icon: "warning-outline", capacity: 18000 },
    { id: "other", label: "Other", icon: "ellipsis-horizontal-outline", capacity: 10000 },
  ]},
];
const ALL = VEHICLE_CATEGORIES.flatMap((c) => c.vehicles);
const iconFor = (t: string) => ALL.find((v) => v.id === t)?.icon || "bus-outline";

export default function DriverVehiclesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = createStyles(theme);

  const [driver, setDriver] = useState<Driver | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState("cargo_van");
  const [newPlate, setNewPlate] = useState("");
  const [adding, setAdding] = useState(false);
  const [banner, setBanner] = useState<{ msg: string; ok: boolean } | null>(null);

  const flash = (msg: string, ok = true) => { setBanner({ msg, ok }); setTimeout(() => setBanner(null), 2400); };

  const load = useCallback(async () => {
    try { setDriver(await api.getDriver()); } catch (e) { console.warn("vehicles load failed", e); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const vehicles: Vehicle[] = driver?.vehicles || [];

  const setPrimary = async (id: string) => {
    Haptics.selectionAsync().catch(() => {});
    setBusyId(id);
    try { setDriver(await api.setPrimaryVehicle(id)); flash("Active vehicle updated"); }
    catch { flash("Couldn't update.", false); }
    finally { setBusyId(null); }
  };

  const remove = async (id: string) => {
    if (vehicles.length <= 1) { flash("Keep at least one vehicle.", false); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setBusyId(id);
    try { setDriver(await api.deleteVehicle(id)); flash("Vehicle removed"); }
    catch { flash("Couldn't remove.", false); }
    finally { setBusyId(null); }
  };

  const addVehicle = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setAdding(true);
    try {
      const cap = ALL.find((v) => v.id === newType)?.capacity;
      const updated = await api.addVehicle({ vehicle_type: newType, plate: newPlate.trim(), capacity_kg: cap });
      setDriver(updated);
      setShowAdd(false); setNewPlate(""); setNewType("cargo_van");
      flash("Vehicle added");
    } catch { flash("Couldn't add vehicle.", false); }
    finally { setAdding(false); }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={[styles.iconBtn, shadows.sm]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>My Vehicles</Text>
        <View style={{ width: 44 }} />
      </View>

      {banner && (
        <View style={[styles.banner, { backgroundColor: banner.ok ? theme.success : theme.error }]}>
          <Ionicons name={banner.ok ? "checkmark-circle" : "alert-circle"} size={16} color="#fff" />
          <Text style={styles.bannerText}>{banner.msg}</Text>
        </View>
      )}

      {!driver ? (
        <View style={styles.loading}><ActivityIndicator size="large" color={theme.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 60 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.subtle}>The vehicle marked Active is used to match you with jobs.</Text>

          {vehicles.map((v, i) => (
            <Animated.View key={v.id} entering={FadeInUp.delay(i * 60)} style={[styles.vCard, shadows.sm, v.is_primary && { borderColor: theme.primary, borderWidth: 1.5 }]}>
              <View style={styles.vIcon}>
                <Ionicons name={iconFor(v.vehicle_type) as any} size={24} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={styles.vLabel}>{v.label || v.vehicle_type}</Text>
                  {v.is_primary && (
                    <View style={styles.activePill}><Text style={styles.activePillText}>ACTIVE</Text></View>
                  )}
                </View>
                <Text style={styles.vMeta}>{v.plate ? `${v.plate} · ` : ""}{(v.capacity_kg || 0).toLocaleString()} kg</Text>
              </View>
              {busyId === v.id ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {!v.is_primary && (
                    <TouchableOpacity style={styles.smallBtn} onPress={() => setPrimary(v.id)}>
                      <Ionicons name="checkmark-circle-outline" size={20} color={theme.primary} />
                    </TouchableOpacity>
                  )}
                  {vehicles.length > 1 && (
                    <TouchableOpacity style={styles.smallBtn} onPress={() => remove(v.id)}>
                      <Ionicons name="trash-outline" size={19} color={theme.error} />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </Animated.View>
          ))}

          {!showAdd ? (
            <TouchableOpacity style={styles.addBtn} onPress={() => { Haptics.selectionAsync().catch(() => {}); setShowAdd(true); }}>
              <Ionicons name="add-circle-outline" size={20} color={theme.primary} />
              <Text style={styles.addBtnText}>Add a vehicle</Text>
            </TouchableOpacity>
          ) : (
            <Animated.View entering={FadeInUp} style={[styles.addCard, shadows.sm]}>
              <Text style={styles.addTitle}>New vehicle</Text>
              {VEHICLE_CATEGORIES.map((cat) => (
                <View key={cat.category} style={{ marginBottom: spacing.sm }}>
                  <Text style={styles.catTitle}>{cat.category}</Text>
                  <View style={styles.grid}>
                    {cat.vehicles.map((v) => {
                      const sel = v.id === newType;
                      return (
                        <TouchableOpacity key={v.id} style={[styles.tile, sel && { backgroundColor: theme.primary, borderColor: theme.primary }]} onPress={() => { setNewType(v.id); Haptics.selectionAsync().catch(() => {}); }}>
                          <Ionicons name={v.icon as any} size={16} color={sel ? "#fff" : theme.textPrimary} />
                          <Text style={[styles.tileText, sel && { color: "#fff" }]} numberOfLines={1}>{v.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
              <TextInput
                style={styles.plateInput}
                value={newPlate}
                onChangeText={setNewPlate}
                placeholder="License plate (optional)"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="characters"
              />
              <View style={{ flexDirection: "row", gap: 10, marginTop: spacing.md }}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.confirmBtn, adding && { opacity: 0.7 }]} onPress={addVehicle} disabled={adding}>
                  {adding ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Add vehicle</Text>}
                </TouchableOpacity>
              </View>
            </Animated.View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 20, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.3 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: spacing.xl, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  bannerText: { color: "#fff", fontWeight: "700", fontSize: 13.5, flex: 1 },
  subtle: { color: theme.textSecondary, fontSize: 13, marginBottom: spacing.md, lineHeight: 18 },
  vCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.surface, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1.5, borderColor: "transparent" },
  vIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: theme.primaryLight, alignItems: "center", justifyContent: "center" },
  vLabel: { fontSize: 16, fontWeight: "700", color: theme.textPrimary },
  vMeta: { fontSize: 13, color: theme.textSecondary, marginTop: 2 },
  activePill: { backgroundColor: theme.primary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  activePillText: { color: "#fff", fontSize: 9.5, fontWeight: "800", letterSpacing: 0.5 },
  smallBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.surfaceMuted, alignItems: "center", justifyContent: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: radius.lg, borderWidth: 1.5, borderColor: theme.primary, borderStyle: "dashed", marginTop: spacing.sm },
  addBtnText: { color: theme.primary, fontWeight: "800", fontSize: 15 },
  addCard: { backgroundColor: theme.surface, borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.sm },
  addTitle: { fontSize: 16, fontWeight: "800", color: theme.textPrimary, marginBottom: spacing.md },
  catTitle: { fontSize: 11, fontWeight: "700", color: theme.textSecondary, marginBottom: spacing.xs, textTransform: "uppercase", letterSpacing: 0.5 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tile: { flexGrow: 1, flexBasis: "30%", paddingVertical: 10, paddingHorizontal: 8, borderRadius: radius.md, backgroundColor: theme.surfaceMuted, alignItems: "center", flexDirection: "row", gap: 6, borderWidth: 1.5, borderColor: "transparent" },
  tileText: { fontSize: 11, color: theme.textPrimary, fontWeight: "600", flexShrink: 1 },
  plateInput: { marginTop: spacing.md, borderWidth: 1.5, borderColor: theme.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: theme.textPrimary, backgroundColor: theme.surfaceMuted },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", backgroundColor: theme.surfaceMuted },
  cancelText: { color: theme.textPrimary, fontWeight: "700" },
  confirmBtn: { flex: 2, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", backgroundColor: theme.primary },
  confirmText: { color: "#fff", fontWeight: "800" },
});
