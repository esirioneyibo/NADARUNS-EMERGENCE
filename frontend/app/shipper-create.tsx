import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { getAuthToken } from "../src/api";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

interface VehicleType {
  id: string;
  name: string;
  icon: string;
  capacity: string;
  base_price: number;
}

const VEHICLE_TYPES: VehicleType[] = [
  { id: "bicycle", name: "Bicycle", icon: "bicycle", capacity: "Up to 5 kg", base_price: 5 },
  { id: "motorcycle", name: "Motorcycle", icon: "bicycle", capacity: "Up to 20 kg", base_price: 8 },
  { id: "car", name: "Car", icon: "car", capacity: "Up to 100 kg", base_price: 15 },
  { id: "sprinter_van", name: "Sprinter Van", icon: "bus", capacity: "Up to 500 kg", base_price: 35 },
  { id: "box_truck", name: "Box Truck", icon: "cube", capacity: "Up to 2000 kg", base_price: 75 },
];

export default function ShipperCreateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [priceQuote, setPriceQuote] = useState<number | null>(null);
  
  // Form data
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupName, setPickupName] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");
  const [pickupNotes, setPickupNotes] = useState("");
  
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [dropoffName, setDropoffName] = useState("");
  const [dropoffPhone, setDropoffPhone] = useState("");
  const [dropoffNotes, setDropoffNotes] = useState("");
  
  const [vehicleType, setVehicleType] = useState("car");
  const [cargoWeight, setCargoWeight] = useState("");
  const [cargoDescription, setCargoDescription] = useState("");
  
  const styles = createStyles(theme);

  const getQuote = async () => {
    if (!pickupAddress || !dropoffAddress || !cargoWeight) {
      return;
    }
    
    setQuoteLoading(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`${BASE}/api/shipper/quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pickup_address: pickupAddress,
          dropoff_address: dropoffAddress,
          vehicle_type: vehicleType,
          cargo_weight_kg: parseFloat(cargoWeight) || 0,
        }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setPriceQuote(data.price);
      }
    } catch (e) {
      console.warn("Quote error:", e);
    } finally {
      setQuoteLoading(false);
    }
  };

  useEffect(() => {
    if (step === 3) {
      getQuote();
    }
  }, [step, vehicleType]);

  const handleSubmit = async () => {
    if (!pickupAddress || !dropoffAddress || !pickupName || !dropoffName) {
      Alert.alert("Missing Information", "Please fill in all required fields.");
      return;
    }
    
    const token = getAuthToken();
    if (!token) {
      Alert.alert(
        "Sign In Required",
        "Please sign in or register to create shipments.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign In", onPress: () => router.push("/login") },
        ]
      );
      return;
    }
    
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    try {
      const token = getAuthToken();
      const res = await fetch(`${BASE}/api/shipper/shipments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pickup_address: pickupAddress,
          pickup_contact_name: pickupName,
          pickup_contact_phone: pickupPhone,
          pickup_notes: pickupNotes,
          dropoff_address: dropoffAddress,
          dropoff_contact_name: dropoffName,
          dropoff_contact_phone: dropoffPhone,
          dropoff_notes: dropoffNotes,
          vehicle_type: vehicleType,
          cargo_weight_kg: parseFloat(cargoWeight) || 0,
          cargo_description: cargoDescription,
        }),
      });
      
      if (res.ok) {
        const data = await res.json();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert(
          "Shipment Created!",
          `Your shipment ${data.order_number} has been created. We're finding a driver for you.`,
          [{ text: "OK", onPress: () => router.back() }]
        );
      } else {
        const err = await res.json();
        Alert.alert("Error", err.detail || "Failed to create shipment");
      }
    } catch (e) {
      console.warn("Create shipment error:", e);
      Alert.alert("Error", "Failed to create shipment. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => (
    <Animated.View entering={FadeInUp.duration(300)}>
      <Text style={styles.stepTitle}>Pickup Location</Text>
      <Text style={styles.stepDescription}>Where should the driver pick up the package?</Text>
      
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Pickup Address *</Text>
        <View style={styles.inputContainer}>
          <Ionicons name="location" size={20} color={theme.primary} />
          <TextInput
            style={styles.input}
            placeholder="Enter pickup address"
            placeholderTextColor={theme.textSecondary}
            value={pickupAddress}
            onChangeText={setPickupAddress}
            multiline
          />
        </View>
      </View>
      
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Contact Name *</Text>
        <View style={styles.inputContainer}>
          <Ionicons name="person-outline" size={20} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="Who will hand over the package?"
            placeholderTextColor={theme.textSecondary}
            value={pickupName}
            onChangeText={setPickupName}
          />
        </View>
      </View>
      
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Contact Phone</Text>
        <View style={styles.inputContainer}>
          <Ionicons name="call-outline" size={20} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="+358 40 123 4567"
            placeholderTextColor={theme.textSecondary}
            value={pickupPhone}
            onChangeText={setPickupPhone}
            keyboardType="phone-pad"
          />
        </View>
      </View>
      
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Pickup Notes</Text>
        <View style={[styles.inputContainer, { alignItems: "flex-start", paddingVertical: 12 }]}>
          <Ionicons name="document-text-outline" size={20} color={theme.textSecondary} style={{ marginTop: 2 }} />
          <TextInput
            style={[styles.input, { minHeight: 60 }]}
            placeholder="E.g., 'Ring doorbell', 'Ask for John'"
            placeholderTextColor={theme.textSecondary}
            value={pickupNotes}
            onChangeText={setPickupNotes}
            multiline
          />
        </View>
      </View>
    </Animated.View>
  );

  const renderStep2 = () => (
    <Animated.View entering={FadeInUp.duration(300)}>
      <Text style={styles.stepTitle}>Dropoff Location</Text>
      <Text style={styles.stepDescription}>Where should the package be delivered?</Text>
      
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Dropoff Address *</Text>
        <View style={styles.inputContainer}>
          <Ionicons name="flag" size={20} color="#10B981" />
          <TextInput
            style={styles.input}
            placeholder="Enter delivery address"
            placeholderTextColor={theme.textSecondary}
            value={dropoffAddress}
            onChangeText={setDropoffAddress}
            multiline
          />
        </View>
      </View>
      
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Recipient Name *</Text>
        <View style={styles.inputContainer}>
          <Ionicons name="person-outline" size={20} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="Who will receive the package?"
            placeholderTextColor={theme.textSecondary}
            value={dropoffName}
            onChangeText={setDropoffName}
          />
        </View>
      </View>
      
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Recipient Phone</Text>
        <View style={styles.inputContainer}>
          <Ionicons name="call-outline" size={20} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="+358 40 123 4567"
            placeholderTextColor={theme.textSecondary}
            value={dropoffPhone}
            onChangeText={setDropoffPhone}
            keyboardType="phone-pad"
          />
        </View>
      </View>
      
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Delivery Notes</Text>
        <View style={[styles.inputContainer, { alignItems: "flex-start", paddingVertical: 12 }]}>
          <Ionicons name="document-text-outline" size={20} color={theme.textSecondary} style={{ marginTop: 2 }} />
          <TextInput
            style={[styles.input, { minHeight: 60 }]}
            placeholder="E.g., 'Leave at door', 'Call on arrival'"
            placeholderTextColor={theme.textSecondary}
            value={dropoffNotes}
            onChangeText={setDropoffNotes}
            multiline
          />
        </View>
      </View>
    </Animated.View>
  );

  const renderStep3 = () => (
    <Animated.View entering={FadeInUp.duration(300)}>
      <Text style={styles.stepTitle}>Package Details</Text>
      <Text style={styles.stepDescription}>Tell us about what you're shipping</Text>
      
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Vehicle Type *</Text>
        <View style={styles.vehicleGrid}>
          {VEHICLE_TYPES.map((v) => (
            <TouchableOpacity
              key={v.id}
              style={[
                styles.vehicleCard,
                vehicleType === v.id && styles.vehicleCardSelected,
              ]}
              onPress={() => {
                setVehicleType(v.id);
                Haptics.selectionAsync().catch(() => {});
              }}
            >
              <Ionicons 
                name={v.icon as any} 
                size={24} 
                color={vehicleType === v.id ? "#fff" : theme.textSecondary} 
              />
              <Text style={[
                styles.vehicleName,
                vehicleType === v.id && styles.vehicleNameSelected,
              ]}>
                {v.name}
              </Text>
              <Text style={[
                styles.vehicleCapacity,
                vehicleType === v.id && styles.vehicleCapacitySelected,
              ]}>
                {v.capacity}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Cargo Weight (kg) *</Text>
        <View style={styles.inputContainer}>
          <Ionicons name="scale-outline" size={20} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="e.g., 25"
            placeholderTextColor={theme.textSecondary}
            value={cargoWeight}
            onChangeText={setCargoWeight}
            keyboardType="numeric"
          />
        </View>
      </View>
      
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Cargo Description</Text>
        <View style={[styles.inputContainer, { alignItems: "flex-start", paddingVertical: 12 }]}>
          <Ionicons name="cube-outline" size={20} color={theme.textSecondary} style={{ marginTop: 2 }} />
          <TextInput
            style={[styles.input, { minHeight: 60 }]}
            placeholder="What are you shipping? (e.g., 'Electronics', 'Furniture')"
            placeholderTextColor={theme.textSecondary}
            value={cargoDescription}
            onChangeText={setCargoDescription}
            multiline
          />
        </View>
      </View>
      
      {/* Price Quote */}
      <View style={[styles.quoteCard, shadows.sm]}>
        <View style={styles.quoteHeader}>
          <Ionicons name="pricetag" size={20} color="#6366F1" />
          <Text style={styles.quoteTitle}>Estimated Price</Text>
        </View>
        {quoteLoading ? (
          <ActivityIndicator size="small" color="#6366F1" />
        ) : priceQuote ? (
          <Text style={styles.quotePrice}>€{priceQuote.toFixed(2)}</Text>
        ) : (
          <Text style={styles.quotePlaceholder}>Enter all details to see price</Text>
        )}
        <Text style={styles.quoteNote}>Final price may vary based on actual distance and conditions</Text>
      </View>
    </Animated.View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
        <TouchableOpacity
          style={[styles.iconBtn, shadows.sm]}
          onPress={() => {
            if (step > 1) {
              setStep(step - 1);
            } else {
              router.back();
            }
          }}
        >
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>New Shipment</Text>
        <View style={{ width: 44 }} />
      </Animated.View>
      
      {/* Progress */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(step / 3) * 100}%` }]} />
        </View>
        <View style={styles.progressSteps}>
          {[1, 2, 3].map((s) => (
            <View
              key={s}
              style={[
                styles.progressDot,
                s <= step && styles.progressDotActive,
              ]}
            >
              <Text style={[styles.progressDotText, s <= step && styles.progressDotTextActive]}>
                {s}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.progressLabels}>
          <Text style={[styles.progressLabel, step >= 1 && styles.progressLabelActive]}>Pickup</Text>
          <Text style={[styles.progressLabel, step >= 2 && styles.progressLabelActive]}>Dropoff</Text>
          <Text style={[styles.progressLabel, step >= 3 && styles.progressLabelActive]}>Details</Text>
        </View>
      </View>
      
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </ScrollView>
      
      {/* Bottom Action */}
      <View style={[styles.bottomAction, { paddingBottom: insets.bottom + 16 }]}>
        {step < 3 ? (
          <TouchableOpacity
            style={styles.nextBtn}
            onPress={() => {
              if (step === 1 && (!pickupAddress || !pickupName)) {
                Alert.alert("Missing Information", "Please fill in the pickup address and contact name.");
                return;
              }
              if (step === 2 && (!dropoffAddress || !dropoffName)) {
                Alert.alert("Missing Information", "Please fill in the dropoff address and recipient name.");
                return;
              }
              setStep(step + 1);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }}
          >
            <Text style={styles.nextBtnText}>Continue</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.nextBtn, loading && styles.nextBtnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.nextBtnText}>Create Shipment</Text>
                <Ionicons name="checkmark" size={20} color="#fff" />
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
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
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: { fontSize: 20, fontWeight: "800", color: theme.textPrimary },
  
  progressContainer: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.lg,
  },
  progressBar: {
    height: 4,
    backgroundColor: theme.surfaceMuted,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#6366F1",
    borderRadius: 2,
  },
  progressSteps: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -8,
  },
  progressDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  progressDotActive: {
    backgroundColor: "#6366F1",
  },
  progressDotText: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.textSecondary,
  },
  progressDotTextActive: {
    color: "#fff",
  },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  progressLabel: {
    fontSize: 11,
    color: theme.textSecondary,
    fontWeight: "600",
  },
  progressLabelActive: {
    color: "#6366F1",
  },
  
  stepTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: theme.textPrimary,
    marginBottom: 6,
  },
  stepDescription: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: spacing.xl,
  },
  
  inputGroup: { marginBottom: spacing.lg },
  inputLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.textPrimary,
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: theme.border,
    paddingHorizontal: spacing.md,
    minHeight: 52,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: theme.textPrimary,
  },
  
  vehicleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  vehicleCard: {
    width: "31%",
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: "center",
  },
  vehicleCardSelected: {
    backgroundColor: "#6366F1",
    borderColor: "#6366F1",
  },
  vehicleName: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.textPrimary,
    marginTop: 6,
  },
  vehicleNameSelected: {
    color: "#fff",
  },
  vehicleCapacity: {
    fontSize: 9,
    color: theme.textSecondary,
    marginTop: 2,
    textAlign: "center",
  },
  vehicleCapacitySelected: {
    color: "rgba(255,255,255,0.8)",
  },
  
  quoteCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginTop: spacing.lg,
    alignItems: "center",
  },
  quoteHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: spacing.sm,
  },
  quoteTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.textPrimary,
  },
  quotePrice: {
    fontSize: 36,
    fontWeight: "800",
    color: "#6366F1",
  },
  quotePlaceholder: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  quoteNote: {
    fontSize: 11,
    color: theme.textSecondary,
    marginTop: spacing.sm,
    textAlign: "center",
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
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6366F1",
    paddingVertical: 16,
    borderRadius: radius.lg,
    gap: 8,
  },
  nextBtnDisabled: { opacity: 0.6 },
  nextBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
