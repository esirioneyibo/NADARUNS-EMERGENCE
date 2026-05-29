import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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

import { getAuthToken } from "../src/api";
import { useAuth } from "../src/contexts/AuthContext";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

// Logistics Vehicle Types
const VEHICLE_CATEGORIES = [
  {
    category: "Medium Vehicles",
    vehicles: [
      { id: "cargo_van", name: "Cargo Van", icon: "car-outline" as keyof typeof Ionicons.glyphMap, capacity: 1500 },
      { id: "box_truck", name: "Box Truck", icon: "bus-outline" as keyof typeof Ionicons.glyphMap, capacity: 5000 },
      { id: "flatbed_truck", name: "Flatbed Truck", icon: "train-outline" as keyof typeof Ionicons.glyphMap, capacity: 8000 },
    ],
  },
  {
    category: "Heavy Vehicles",
    vehicles: [
      { id: "semi_truck", name: "Semi-Truck", icon: "bus-outline" as keyof typeof Ionicons.glyphMap, capacity: 20000 },
      { id: "trailer_truck", name: "Trailer Truck", icon: "train-outline" as keyof typeof Ionicons.glyphMap, capacity: 25000 },
      { id: "container_truck", name: "Container Truck", icon: "cube-outline" as keyof typeof Ionicons.glyphMap, capacity: 30000 },
      { id: "tanker", name: "Tanker", icon: "water-outline" as keyof typeof Ionicons.glyphMap, capacity: 35000 },
    ],
  },
  {
    category: "Specialized",
    vehicles: [
      { id: "refrigerated", name: "Refrigerated", icon: "snow-outline" as keyof typeof Ionicons.glyphMap, capacity: 15000 },
      { id: "crane_truck", name: "Crane Truck", icon: "construct-outline" as keyof typeof Ionicons.glyphMap, capacity: 12000 },
      { id: "hazmat", name: "Hazmat", icon: "warning-outline" as keyof typeof Ionicons.glyphMap, capacity: 18000 },
    ],
  },
  {
    category: "Other",
    vehicles: [
      { id: "other", name: "Other", icon: "ellipsis-horizontal-outline" as keyof typeof Ionicons.glyphMap, capacity: 10000 },
    ],
  },
];

// Flatten for easy lookup
const ALL_VEHICLES = VEHICLE_CATEGORIES.flatMap(cat => cat.vehicles);

interface ShipperProfile {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  address?: string;
  tax_id?: string;
  total_shipments: number;
  avatar?: string;
  preferred_vehicle_type?: string;
}

export default function ShipperSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme, mode, setMode } = useTheme();
  const { logout } = useAuth();

  const [profile, setProfile] = useState<ShipperProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Form fields
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  const [preferredVehicle, setPreferredVehicle] = useState<string | null>(null);

  const styles = createStyles(theme);

  const selectTheme = (newMode: "light" | "dark" | "system") => {
    setMode(newMode);
    Haptics.selectionAsync().catch(() => {});
  };

  const loadProfile = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    try {
      const res = await fetch(`${BASE}/api/shipper/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Failed to load profile");

      const data = await res.json();
      setProfile(data);
      setCompanyName(data.company_name || "");
      setContactName(data.contact_name || "");
      setPhone(data.phone || "");
      setAddress(data.address || "");
      setTaxId(data.tax_id || "");
      setPreferredVehicle(data.preferred_vehicle_type || null);
    } catch (e) {
      console.warn("Error loading profile:", e);
      Alert.alert("Error", "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const saveProfile = async () => {
    const token = getAuthToken();
    if (!token) return;

    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/shipper/me`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company_name: companyName,
          contact_name: contactName,
          phone,
          address,
          tax_id: taxId,
          preferred_vehicle_type: preferredVehicle,
        }),
      });

      if (!res.ok) throw new Error("Failed to save profile");

      const data = await res.json();
      setProfile(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert("Success", "Profile updated successfully");
    } catch (e) {
      console.warn("Error saving profile:", e);
      Alert.alert("Error", "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const selectVehicle = (vehicleId: string) => {
    Haptics.selectionAsync().catch(() => {});
    setPreferredVehicle(preferredVehicle === vehicleId ? null : vehicleId);
  };

  const handleLogout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    const doLogout = async () => {
      await logout();
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

  if (loading) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    );
  }

  const selectedVehicle = ALL_VEHICLES.find(v => v.id === preferredVehicle);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Business Settings</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100, paddingHorizontal: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Card */}
        <Animated.View entering={FadeInUp.delay(50)} style={[styles.profileCard, shadows.md]}>
          <View style={styles.avatarWrap}>
            {profile?.avatar ? (
              <Image source={{ uri: profile.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="business" size={32} color="#fff" />
              </View>
            )}
          </View>
          <Text style={styles.profileEmail}>{profile?.email}</Text>
          <View style={styles.profileBadge}>
            <Ionicons name="cube" size={14} color="#fff" />
            <Text style={styles.badgeText}>{profile?.total_shipments || 0} Shipments</Text>
          </View>
        </Animated.View>

        {/* Appearance Section */}
        <Animated.View entering={FadeInUp.delay(75)}>
          <Text style={styles.sectionTitle}>Appearance</Text>
          <View style={[styles.card, shadows.sm]}>
            <View style={styles.themeGrid}>
              {[
                { id: "light" as const, label: "Light", icon: "sunny-outline" as const },
                { id: "dark" as const, label: "Dark", icon: "moon-outline" as const },
                { id: "system" as const, label: "System", icon: "phone-portrait-outline" as const },
              ].map((t) => {
                const selected = t.id === mode;
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.themeTile, selected && { backgroundColor: "#6366F1", borderColor: "#6366F1" }]}
                    onPress={() => selectTheme(t.id)}
                    testID={`theme-${t.id}`}
                  >
                    <Ionicons name={t.icon} size={22} color={selected ? "#fff" : theme.textPrimary} />
                    <Text style={[styles.themeLabel, selected && { color: "#fff" }]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </Animated.View>

        {/* Company Info Section */}
        <Animated.View entering={FadeInUp.delay(100)}>
          <Text style={styles.sectionTitle}>Company Information</Text>
          <View style={[styles.card, shadows.sm]}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Company Name</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="business-outline" size={18} color={theme.textSecondary} />
                <TextInput
                  style={styles.input}
                  value={companyName}
                  onChangeText={setCompanyName}
                  placeholder="Your company name"
                  placeholderTextColor={theme.textSecondary}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Contact Name</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="person-outline" size={18} color={theme.textSecondary} />
                <TextInput
                  style={styles.input}
                  value={contactName}
                  onChangeText={setContactName}
                  placeholder="Your name"
                  placeholderTextColor={theme.textSecondary}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Phone</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="call-outline" size={18} color={theme.textSecondary} />
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+358..."
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="phone-pad"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Business Address</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="location-outline" size={18} color={theme.textSecondary} />
                <TextInput
                  style={styles.input}
                  value={address}
                  onChangeText={setAddress}
                  placeholder="Your business address"
                  placeholderTextColor={theme.textSecondary}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Tax ID / VAT Number</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="document-text-outline" size={18} color={theme.textSecondary} />
                <TextInput
                  style={styles.input}
                  value={taxId}
                  onChangeText={setTaxId}
                  placeholder="FI12345678"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="characters"
                />
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Preferred Vehicle Section */}
        <Animated.View entering={FadeInUp.delay(200)}>
          <Text style={styles.sectionTitle}>Preferred Vehicle Type</Text>
          <Text style={styles.sectionDescription}>
            Set your default vehicle preference for new shipments
          </Text>
          
          <View style={[styles.card, shadows.sm]}>
            {/* Current Selection */}
            {selectedVehicle ? (
              <View style={styles.currentVehicleInfo}>
                <View style={styles.vehicleIconWrap}>
                  <Ionicons name={selectedVehicle.icon} size={24} color={theme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.currentVehicleLabel}>{selectedVehicle.name}</Text>
                  <Text style={styles.currentVehicleCapacity}>
                    Up to {selectedVehicle.capacity.toLocaleString()} kg
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setPreferredVehicle(null)}>
                  <Ionicons name="close-circle" size={24} color={theme.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.noVehicleSelected}>
                <Ionicons name="help-circle-outline" size={24} color={theme.textSecondary} />
                <Text style={styles.noVehicleText}>No preference set (any vehicle)</Text>
              </View>
            )}

            <View style={styles.divider} />

            {/* Vehicle Selection by Category */}
            <ScrollView
              horizontal={false}
              nestedScrollEnabled
              style={{ maxHeight: 220 }}
              showsVerticalScrollIndicator={false}
            >
              {VEHICLE_CATEGORIES.map((category) => (
                <View key={category.category} style={styles.vehicleCategory}>
                  <Text style={styles.vehicleCategoryTitle}>{category.category}</Text>
                  <View style={styles.vehicleGrid}>
                    {category.vehicles.map((v) => {
                      const selected = v.id === preferredVehicle;
                      return (
                        <TouchableOpacity
                          key={v.id}
                          style={[
                            styles.vehicleTile,
                            selected && { backgroundColor: theme.primary, borderColor: theme.primary },
                          ]}
                          onPress={() => selectVehicle(v.id)}
                        >
                          <Ionicons name={v.icon} size={18} color={selected ? "#fff" : theme.textPrimary} />
                          <Text
                            style={[styles.vehicleLabel, selected && { color: "#fff" }]}
                            numberOfLines={1}
                          >
                            {v.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </Animated.View>

        {/* Save Button */}
        <Animated.View entering={FadeInUp.delay(300)}>
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.7 }]}
            onPress={saveProfile}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={22} color="#fff" />
                <Text style={styles.saveBtnText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Sign Out */}
        <Animated.View entering={FadeInUp.delay(400)}>
          <TouchableOpacity style={styles.signOutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={22} color="#EF4444" />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    profileCard: {
      backgroundColor: "#6366F1",
      borderRadius: radius.xxl,
      padding: spacing.xl,
      alignItems: "center",
      marginBottom: spacing.xl,
    },
    avatarWrap: { marginBottom: spacing.md },
    avatar: { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: "rgba(255,255,255,0.3)" },
    avatarPlaceholder: { backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
    profileEmail: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
    profileBadge: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "rgba(255,255,255,0.15)",
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      marginTop: spacing.sm,
      gap: 6,
    },
    badgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
    // Theme grid styles
    themeGrid: { flexDirection: "row", gap: 8, paddingVertical: spacing.sm },
    themeTile: { flex: 1, paddingVertical: 14, borderRadius: radius.lg, backgroundColor: theme.surfaceMuted, alignItems: "center", gap: 6, borderWidth: 1.5, borderColor: "transparent" },
    themeLabel: { fontSize: 12, color: theme.textPrimary, fontWeight: "600" },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: theme.textPrimary,
      marginBottom: spacing.xs,
      marginTop: spacing.md,
    },
    sectionDescription: {
      fontSize: 13,
      color: theme.textSecondary,
      marginBottom: spacing.md,
    },
    card: {
      backgroundColor: theme.surface,
      borderRadius: radius.xl,
      padding: spacing.lg,
    },
    inputGroup: { marginBottom: spacing.md },
    inputLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.textSecondary,
      marginBottom: spacing.xs,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.surfaceMuted,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      gap: 10,
    },
    input: {
      flex: 1,
      fontSize: 15,
      color: theme.textPrimary,
      paddingVertical: 14,
    },
    divider: {
      height: 1,
      backgroundColor: theme.border,
      marginVertical: spacing.md,
    },
    currentVehicleInfo: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    vehicleIconWrap: {
      width: 48,
      height: 48,
      borderRadius: 12,
      backgroundColor: `${theme.primary}20`,
      alignItems: "center",
      justifyContent: "center",
    },
    currentVehicleLabel: {
      fontSize: 16,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    currentVehicleCapacity: {
      fontSize: 13,
      color: theme.textSecondary,
      marginTop: 2,
    },
    noVehicleSelected: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    noVehicleText: {
      fontSize: 14,
      color: theme.textSecondary,
    },
    vehicleCategory: { marginBottom: spacing.sm },
    vehicleCategoryTitle: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.textSecondary,
      marginBottom: spacing.xs,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    vehicleGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    vehicleTile: {
      flexGrow: 1,
      flexBasis: "30%",
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: radius.md,
      backgroundColor: theme.surfaceMuted,
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
      borderWidth: 1.5,
      borderColor: "transparent",
    },
    vehicleLabel: {
      fontSize: 11,
      color: theme.textPrimary,
      fontWeight: "600",
      flexShrink: 1,
    },
    saveBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#6366F1",
      paddingVertical: 16,
      borderRadius: radius.lg,
      marginTop: spacing.xl,
      gap: 8,
    },
    saveBtnText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "700",
    },
    signOutBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surface,
      paddingVertical: 16,
      borderRadius: radius.lg,
      marginTop: spacing.lg,
      gap: 8,
    },
    signOutText: {
      color: "#EF4444",
      fontSize: 16,
      fontWeight: "700",
    },
  });
