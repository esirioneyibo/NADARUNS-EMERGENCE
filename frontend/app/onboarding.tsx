import React, { useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
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
import Animated, { FadeInDown, FadeInRight, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { api, setAuthToken } from "../src/api";
import { useAuth } from "../src/contexts/AuthContext";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface FormData {
  accountType: "individual" | "fleet";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  vehicleType: string;
  licensePlate: string;
  licenseClass: string;
  city: string;
  vehicleCapacity: string;
  // Fleet / company
  companyName: string;
  businessId: string;
  companyPhone: string;
  companyEmail: string;
  companyAddress: string;
}

// Logistics Vehicle Categories
const VEHICLE_CATEGORIES = [
  {
    category: "Medium Vehicles",
    vehicles: [
      { id: "cargo_van", label: "Cargo Van", icon: "car-outline" as const, desc: "Up to 1,500 kg", capacity: "1500" },
      { id: "box_truck", label: "Box Truck", icon: "bus-outline" as const, desc: "Up to 5,000 kg", capacity: "5000" },
      { id: "flatbed_truck", label: "Flatbed Truck", icon: "train-outline" as const, desc: "Open cargo bed", capacity: "8000" },
    ],
  },
  {
    category: "Heavy Vehicles",
    vehicles: [
      { id: "semi_truck", label: "Semi-Truck", icon: "bus-outline" as const, desc: "Long haul", capacity: "20000" },
      { id: "trailer_truck", label: "Trailer Truck", icon: "train-outline" as const, desc: "Large cargo", capacity: "25000" },
      { id: "container_truck", label: "Container Truck", icon: "cube-outline" as const, desc: "Container shipping", capacity: "30000" },
      { id: "tanker", label: "Tanker", icon: "water-outline" as const, desc: "Liquid cargo", capacity: "35000" },
    ],
  },
  {
    category: "Specialized",
    vehicles: [
      { id: "refrigerated", label: "Refrigerated", icon: "snow-outline" as const, desc: "Temperature controlled", capacity: "15000" },
      { id: "crane_truck", label: "Crane Truck", icon: "construct-outline" as const, desc: "Heavy lifting", capacity: "12000" },
      { id: "hazmat", label: "Hazmat Vehicle", icon: "warning-outline" as const, desc: "Dangerous goods", capacity: "18000" },
    ],
  },
  {
    category: "Other",
    vehicles: [
      { id: "other", label: "Other", icon: "ellipsis-horizontal-outline" as const, desc: "Specify below", capacity: "0" },
    ],
  },
];

// Flatten for easy lookup
const ALL_VEHICLES = VEHICLE_CATEGORIES.flatMap(cat => cat.vehicles);

const CITIES = ["Helsinki", "Espoo", "Tampere", "Turku", "Oulu"];

const LICENSE_CLASSES = ["B", "BE", "C1", "C", "CE", "D"];

const ACCOUNT_TYPES = [
  {
    id: "individual" as const,
    label: "Individual driver",
    desc: "I drive and deliver myself",
    icon: "person-outline" as const,
  },
  {
    id: "fleet" as const,
    label: "Fleet / Company",
    desc: "I run a company with one or more drivers",
    icon: "business-outline" as const,
  },
];

// Field tooltips (shown via an info icon → alert)
const TOOLTIPS: Record<string, { title: string; body: string }> = {
  licenseClass: { title: "Driving licence class", body: "The class on your licence. B = car/van, C = truck, CE = truck + trailer. Pick the highest you hold." },
  businessId: { title: "Business ID (Y-tunnus)", body: "Your Finnish company registration number, e.g. 1234567-8. Used on invoices and payouts. Optional but recommended." },
  companyName: { title: "Company name", body: "Your registered trading name. This appears on jobs, invoices and payout receipts." },
  capacity: { title: "Vehicle capacity", body: "Maximum cargo weight your vehicle can legally carry, in kilograms." },
  plate: { title: "Licence plate", body: "Your vehicle's registration plate. You can add more vehicles later from the Fleet screen." },
};

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { login } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({
    accountType: "individual",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    vehicleType: "",
    licensePlate: "",
    licenseClass: "",
    city: "",
    vehicleCapacity: "",
    companyName: "",
    businessId: "",
    companyPhone: "",
    companyEmail: "",
    companyAddress: "",
  });

  const styles = createStyles(theme);

  // Dynamic steps: the company step only appears for fleet accounts.
  const stepKeys: string[] = [
    "account",
    "name",
    "contact",
    ...(formData.accountType === "fleet" ? ["company"] : []),
    "vehicle",
    "review",
  ];
  const totalSteps = stepKeys.length;
  const currentKey = stepKeys[step - 1];

  const showTooltip = (key: string) => {
    if (TOOLTIPS[key]) setActiveTooltip(key);
  };

  const Tooltip = ({ field }: { field: string }) => (
    <TouchableOpacity
      onPress={() => showTooltip(field)}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      testID={`tooltip-${field}`}
    >
      <Ionicons name="information-circle-outline" size={16} color={theme.textSecondary} style={{ marginLeft: 6 }} />
    </TouchableOpacity>
  );

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const nextStep = () => {
    if (step < totalSteps) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setStep(step + 1);
    }
  };

  const prevStep = () => {
    if (step > 1) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setStep(step - 1);
    } else {
      router.back();
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    try {
      const response = await api.registerDriver({
        first_name: formData.firstName,
        last_name: formData.lastName,
        email: formData.email,
        phone: formData.phone,
        password: formData.password,
        vehicle_type: formData.vehicleType,
        city: formData.city,
        license_plate: formData.licensePlate || undefined,
        license_class: formData.licenseClass || undefined,
        vehicle_capacity_kg: formData.vehicleCapacity ? parseInt(formData.vehicleCapacity) : undefined,
        account_type: formData.accountType,
        company_name: formData.accountType === "fleet" ? formData.companyName : undefined,
        business_id: formData.accountType === "fleet" ? (formData.businessId || undefined) : undefined,
        company_phone: formData.accountType === "fleet" ? (formData.companyPhone || undefined) : undefined,
        company_email: formData.accountType === "fleet" ? (formData.companyEmail || undefined) : undefined,
        company_address: formData.accountType === "fleet" ? (formData.companyAddress || undefined) : undefined,
      });
      
      // Set auth token in API module
      setAuthToken(response.token);
      
      // Save to auth context
      await login(response.token, {
        id: response.driver_id,
        name: `${formData.firstName} ${formData.lastName}`,
        email: formData.email,
        type: "driver",
      });
      
      // Navigate straight to KYC. (Don't gate navigation behind an Alert
      // button — react-native-web does not fire Alert button callbacks.)
      router.replace("/kyc");
    } catch (error: any) {
      const message = error?.message || "Registration failed. Please try again.";
      Alert.alert("Error", message);
    } finally {
      setLoading(false);
    }
  };

  const isStepValid = () => {
    switch (currentKey) {
      case "account":
        return !!formData.accountType;
      case "name":
        return !!(formData.firstName.trim() && formData.lastName.trim());
      case "contact":
        return formData.email.includes("@") && formData.phone.length >= 8 && formData.password.length >= 6;
      case "company":
        return !!(formData.companyName.trim().length >= 2);
      case "vehicle":
        return !!(formData.vehicleType && formData.city);
      case "review":
        return true;
      default:
        return false;
    }
  };

  const renderStep = () => {
    switch (currentKey) {
      case "account":
        return (
          <Animated.View entering={FadeInRight.duration(300)} key="account" style={styles.stepContent}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>How will you use NadaRuns?</Text>
              <Text style={styles.stepSubtitle}>You can add drivers &amp; vehicles later either way</Text>
            </View>
            {ACCOUNT_TYPES.map((opt) => {
              const selected = formData.accountType === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.accountCard, selected && styles.accountCardSelected]}
                  onPress={() => { updateField("accountType", opt.id); Haptics.selectionAsync().catch(() => {}); }}
                  testID={`account-${opt.id}`}
                  activeOpacity={0.85}
                >
                  <View style={[styles.accountIcon, selected && styles.accountIconSelected]}>
                    <Ionicons name={opt.icon} size={26} color={selected ? "#fff" : theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.accountLabel, selected && { color: theme.primary }]}>{opt.label}</Text>
                    <Text style={styles.accountDesc}>{opt.desc}</Text>
                  </View>
                  <Ionicons
                    name={selected ? "radio-button-on" : "radio-button-off"}
                    size={22}
                    color={selected ? theme.primary : theme.textSecondary}
                  />
                </TouchableOpacity>
              );
            })}
          </Animated.View>
        );

      case "name":
        return (
          <Animated.View entering={FadeInRight.duration(300)} key="name" style={styles.stepContent}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>{formData.accountType === "fleet" ? "About the owner" : "What's your name?"}</Text>
              <Text style={styles.stepSubtitle}>Let&apos;s start with the basics</Text>
            </View>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>First name</Text>
              <TextInput
                style={styles.input}
                value={formData.firstName}
                onChangeText={(v) => updateField("firstName", v)}
                placeholder="Enter your first name"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                testID="input-first-name"
              />
            </View>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Last name</Text>
              <TextInput
                style={styles.input}
                value={formData.lastName}
                onChangeText={(v) => updateField("lastName", v)}
                placeholder="Enter your last name"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                testID="input-last-name"
              />
            </View>
          </Animated.View>
        );

      case "contact":
        return (
          <Animated.View entering={FadeInRight.duration(300)} key="contact" style={styles.stepContent}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Contact details</Text>
              <Text style={styles.stepSubtitle}>How can we reach you?</Text>
            </View>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email address</Text>
              <View style={styles.inputWithIcon}>
                <Ionicons name="mail-outline" size={20} color={theme.textSecondary} />
                <TextInput
                  style={styles.inputInner}
                  value={formData.email}
                  onChangeText={(v) => updateField("email", v)}
                  placeholder="you@example.com"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  testID="input-email"
                />
              </View>
            </View>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Phone number</Text>
              <View style={styles.inputWithIcon}>
                <Ionicons name="call-outline" size={20} color={theme.textSecondary} />
                <TextInput
                  style={styles.inputInner}
                  value={formData.phone}
                  onChangeText={(v) => updateField("phone", v)}
                  placeholder="+358 40 123 4567"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="phone-pad"
                  testID="input-phone"
                />
              </View>
            </View>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.inputWithIcon}>
                <Ionicons name="lock-closed-outline" size={20} color={theme.textSecondary} />
                <TextInput
                  style={styles.inputInner}
                  value={formData.password}
                  onChangeText={(v) => updateField("password", v)}
                  placeholder="Min. 6 characters"
                  placeholderTextColor={theme.textSecondary}
                  secureTextEntry
                  autoCapitalize="none"
                  testID="input-password"
                />
              </View>
            </View>
          </Animated.View>
        );

      case "company":
        return (
          <Animated.View entering={FadeInRight.duration(300)} key="company" style={styles.stepContent}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Company details</Text>
              <Text style={styles.stepSubtitle}>This sets up your fleet workspace</Text>
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.inputLabel}>Company name *</Text>
                <Tooltip field="companyName" />
              </View>
              <View style={styles.inputWithIcon}>
                <Ionicons name="business-outline" size={20} color={theme.textSecondary} />
                <TextInput
                  style={styles.inputInner}
                  value={formData.companyName}
                  onChangeText={(v) => updateField("companyName", v)}
                  placeholder="e.g. Nordic Freight Oy"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  testID="input-company-name"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.inputLabel}>Business ID (Y-tunnus)</Text>
                <Tooltip field="businessId" />
              </View>
              <View style={styles.inputWithIcon}>
                <Ionicons name="card-outline" size={20} color={theme.textSecondary} />
                <TextInput
                  style={styles.inputInner}
                  value={formData.businessId}
                  onChangeText={(v) => updateField("businessId", v)}
                  placeholder="1234567-8"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  testID="input-business-id"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Company email</Text>
              <View style={styles.inputWithIcon}>
                <Ionicons name="mail-outline" size={20} color={theme.textSecondary} />
                <TextInput
                  style={styles.inputInner}
                  value={formData.companyEmail}
                  onChangeText={(v) => updateField("companyEmail", v)}
                  placeholder="billing@company.com"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  testID="input-company-email"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Company address</Text>
              <View style={styles.inputWithIcon}>
                <Ionicons name="location-outline" size={20} color={theme.textSecondary} />
                <TextInput
                  style={styles.inputInner}
                  value={formData.companyAddress}
                  onChangeText={(v) => updateField("companyAddress", v)}
                  placeholder="Street, City"
                  placeholderTextColor={theme.textSecondary}
                  testID="input-company-address"
                />
              </View>
            </View>
          </Animated.View>
        );

      case "vehicle":
        return (
          <Animated.View entering={FadeInRight.duration(300)} key="vehicle" style={styles.stepContent}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Your vehicle</Text>
              <Text style={styles.stepSubtitle}>Select your logistics vehicle type</Text>
            </View>
            
            <ScrollView 
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 240 }}
              nestedScrollEnabled
            >
              {VEHICLE_CATEGORIES.map((category) => (
                <View key={category.category} style={styles.vehicleCategory}>
                  <Text style={styles.vehicleCategoryTitle}>{category.category}</Text>
                  <View style={styles.vehicleGrid}>
                    {category.vehicles.map((v) => {
                      const selected = formData.vehicleType === v.id;
                      return (
                        <TouchableOpacity
                          key={v.id}
                          style={[styles.vehicleCard, selected && styles.vehicleCardSelected]}
                          onPress={() => {
                            updateField("vehicleType", v.id);
                            updateField("vehicleCapacity", v.capacity);
                            Haptics.selectionAsync().catch(() => {});
                          }}
                          testID={`vehicle-${v.id}`}
                        >
                          <Ionicons 
                            name={v.icon} 
                            size={28} 
                            color={selected ? "#fff" : theme.textPrimary} 
                          />
                          <Text style={[styles.vehicleLabel, selected && { color: "#fff" }]} numberOfLines={1}>
                            {v.label}
                          </Text>
                          <Text style={[styles.vehicleDesc, selected && { color: "rgba(255,255,255,0.7)" }]} numberOfLines={1}>
                            {v.desc}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>

            {/* Custom capacity input for "Other" vehicle type */}
            {formData.vehicleType === "other" && (
              <View style={[styles.inputGroup, { marginTop: spacing.md }]}>
                <View style={styles.labelRow}>
                  <Text style={styles.inputLabel}>Vehicle Capacity (kg)</Text>
                  <Tooltip field="capacity" />
                </View>
                <View style={styles.inputWrapper}>
                  <Ionicons name="cube-outline" size={20} color={theme.textSecondary} />
                  <TextInput
                    style={styles.input}
                    placeholder="Enter capacity in kg"
                    placeholderTextColor={theme.textSecondary}
                    value={formData.vehicleCapacity}
                    onChangeText={(v) => updateField("vehicleCapacity", v.replace(/[^0-9]/g, ""))}
                    keyboardType="number-pad"
                  />
                </View>
              </View>
            )}

            {/* Optional plate + licence class */}
            <View style={styles.rowTwo}>
              <View style={[styles.inputGroup, { flex: 1, marginTop: spacing.md }]}>
                <View style={styles.labelRow}>
                  <Text style={styles.inputLabel}>Plate</Text>
                  <Tooltip field="plate" />
                </View>
                <TextInput
                  style={styles.input}
                  value={formData.licensePlate}
                  onChangeText={(v) => updateField("licensePlate", v.toUpperCase())}
                  placeholder="ABC-123"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="characters"
                  testID="input-plate"
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1, marginTop: spacing.md }]}>
                <View style={styles.labelRow}>
                  <Text style={styles.inputLabel}>Licence class</Text>
                  <Tooltip field="licenseClass" />
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cityScroll}>
                  {LICENSE_CLASSES.map((lc) => {
                    const selected = formData.licenseClass === lc;
                    return (
                      <TouchableOpacity
                        key={lc}
                        style={[styles.cityChip, selected && styles.cityChipSelected]}
                        onPress={() => { updateField("licenseClass", lc); Haptics.selectionAsync().catch(() => {}); }}
                        testID={`license-${lc}`}
                      >
                        <Text style={[styles.cityText, selected && { color: "#fff" }]}>{lc}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>

            <View style={[styles.inputGroup, { marginTop: spacing.md }]}>
              <Text style={styles.inputLabel}>Delivery city</Text>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.cityScroll}
              >
                {CITIES.map((city) => {
                  const selected = formData.city === city;
                  return (
                    <TouchableOpacity
                      key={city}
                      style={[styles.cityChip, selected && styles.cityChipSelected]}
                      onPress={() => {
                        updateField("city", city);
                        Haptics.selectionAsync().catch(() => {});
                      }}
                    >
                      <Text style={[styles.cityText, selected && { color: "#fff" }]}>
                        {city}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </Animated.View>
        );

      case "review":
        const selectedVehicle = ALL_VEHICLES.find(v => v.id === formData.vehicleType);
        return (
          <Animated.View entering={FadeInRight.duration(300)} key="review" style={styles.stepContent}>
            <View style={styles.stepHeader}>
              <View style={styles.successIcon}>
                <Ionicons name="checkmark-circle" size={64} color={theme.success} />
              </View>
              <Text style={styles.stepTitle}>You&apos;re all set!</Text>
              <Text style={styles.stepSubtitle}>Review your information below</Text>
            </View>
            
            <View style={[styles.summaryCard, shadows.sm]}>
              <View style={styles.summaryRow}>
                <Ionicons name={formData.accountType === "fleet" ? "business" : "person"} size={20} color={theme.textSecondary} />
                <Text style={styles.summaryLabel}>Account</Text>
                <Text style={styles.summaryValue}>{formData.accountType === "fleet" ? "Fleet / Company" : "Individual"}</Text>
              </View>
              <View style={styles.summaryDivider} />
              {formData.accountType === "fleet" && (
                <>
                  <View style={styles.summaryRow}>
                    <Ionicons name="business-outline" size={20} color={theme.textSecondary} />
                    <Text style={styles.summaryLabel}>Company</Text>
                    <Text style={styles.summaryValue} numberOfLines={1}>{formData.companyName || "—"}</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                </>
              )}
              <View style={styles.summaryRow}>
                <Ionicons name="person" size={20} color={theme.textSecondary} />
                <Text style={styles.summaryLabel}>Name</Text>
                <Text style={styles.summaryValue}>{formData.firstName} {formData.lastName}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Ionicons name="mail" size={20} color={theme.textSecondary} />
                <Text style={styles.summaryLabel}>Email</Text>
                <Text style={styles.summaryValue} numberOfLines={1}>{formData.email}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Ionicons name="call" size={20} color={theme.textSecondary} />
                <Text style={styles.summaryLabel}>Phone</Text>
                <Text style={styles.summaryValue}>{formData.phone}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Ionicons 
                  name={selectedVehicle?.icon || "bus-outline"} 
                  size={20} 
                  color={theme.textSecondary} 
                />
                <Text style={styles.summaryLabel}>Vehicle</Text>
                <Text style={styles.summaryValue}>
                  {selectedVehicle?.label || "—"}{formData.licenseClass ? ` · ${formData.licenseClass}` : ""}
                </Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Ionicons name="location" size={20} color={theme.textSecondary} />
                <Text style={styles.summaryLabel}>City</Text>
                <Text style={styles.summaryValue}>{formData.city || "—"}</Text>
              </View>
            </View>
            
            <View style={[styles.noteCard, shadows.sm]}>
              <Ionicons name="information-circle" size={20} color={theme.primary} />
              <Text style={styles.noteText}>
                After registration, you&apos;ll need to complete KYC verification before you can start accepting deliveries.
              </Text>
            </View>
          </Animated.View>
        );

      default:
        return null;
    }
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { paddingTop: insets.top }]} 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      testID="onboarding-screen"
    >
      {/* Header */}
      <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
        <TouchableOpacity
          style={[styles.iconBtn, shadows.sm]}
          onPress={prevStep}
          testID="onboarding-back-button"
        >
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        
        <View style={styles.brand}>
          <Ionicons name="flash" size={18} color={theme.primary} />
          <Text style={styles.brandText}>NadaRuns</Text>
        </View>
        
        <View style={{ width: 44 }} />
      </Animated.View>

      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <Animated.View 
            style={[
              styles.progressFill, 
              { width: `${(step / totalSteps) * 100}%` }
            ]} 
          />
        </View>
        <Text style={styles.progressText}>Step {step} of {totalSteps}</Text>
      </View>

      {/* Content */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ 
          flexGrow: 1, 
          paddingHorizontal: spacing.xl, 
          paddingBottom: insets.bottom + 120 
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderStep()}
      </ScrollView>

      {/* Bottom button */}
      <Animated.View 
        entering={FadeInUp.delay(200)}
        style={[styles.bottomBar, { paddingBottom: insets.bottom + 20 }]}
      >
        <TouchableOpacity
          style={[
            styles.continueBtn,
            !isStepValid() && styles.continueBtnDisabled
          ]}
          onPress={step === totalSteps ? handleSubmit : nextStep}
          disabled={!isStepValid() || loading}
          testID="onboarding-continue-button"
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Text style={styles.continueBtnText}>
                {step === totalSteps ? "Create Account" : "Continue"}
              </Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </>
          )}
        </TouchableOpacity>
      </Animated.View>

      {/* Cross-platform tooltip popover */}
      <Modal visible={!!activeTooltip} transparent animationType="fade" onRequestClose={() => setActiveTooltip(null)}>
        <TouchableOpacity style={styles.tooltipBackdrop} activeOpacity={1} onPress={() => setActiveTooltip(null)} testID="tooltip-close">
          <View style={[styles.tooltipCard, shadows.lg]}>
            <View style={styles.tooltipHeader}>
              <Ionicons name="information-circle" size={22} color={theme.primary} />
              <Text style={styles.tooltipTitle}>{activeTooltip ? TOOLTIPS[activeTooltip]?.title : ""}</Text>
            </View>
            <Text style={styles.tooltipBody}>{activeTooltip ? TOOLTIPS[activeTooltip]?.body : ""}</Text>
            <TouchableOpacity style={styles.tooltipBtn} onPress={() => setActiveTooltip(null)}>
              <Text style={styles.tooltipBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
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
    paddingVertical: spacing.md 
  },
  iconBtn: { 
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    backgroundColor: theme.surface, 
    alignItems: "center", 
    justifyContent: "center" 
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  brandText: { 
    fontSize: 16, 
    fontWeight: "800", 
    color: theme.primary, 
    letterSpacing: 0.5 
  },
  
  progressContainer: { 
    paddingHorizontal: spacing.xl, 
    marginBottom: spacing.lg 
  },
  progressBar: {
    height: 4,
    backgroundColor: theme.surfaceMuted,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.primary,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: theme.textSecondary,
    marginTop: 8,
    textAlign: "center",
  },
  
  stepContent: { flex: 1 },
  stepHeader: { marginBottom: spacing.xxl },

  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    marginBottom: spacing.md,
  },
  accountCardSelected: {
    borderColor: theme.primary,
    backgroundColor: theme.primary + "12",
  },
  accountIcon: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: "center", justifyContent: "center",
    backgroundColor: theme.primary + "18",
  },
  accountIconSelected: { backgroundColor: theme.primary },
  accountLabel: { fontSize: 16, fontWeight: "800", color: theme.textPrimary },
  accountDesc: { fontSize: 13, color: theme.textSecondary, marginTop: 2 },
  labelRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  rowTwo: { flexDirection: "row", gap: spacing.md },

  tooltipBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center", padding: spacing.xl,
  },
  tooltipCard: {
    backgroundColor: theme.surface, borderRadius: radius.lg,
    padding: spacing.lg, width: "100%", maxWidth: 360,
  },
  tooltipHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm },
  tooltipTitle: { fontSize: 16, fontWeight: "800", color: theme.textPrimary, flex: 1 },
  tooltipBody: { fontSize: 14, lineHeight: 20, color: theme.textSecondary },
  tooltipBtn: {
    marginTop: spacing.lg, alignSelf: "flex-end",
    paddingVertical: 8, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, backgroundColor: theme.primary,
  },
  tooltipBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  stepTitle: { 
    fontSize: 28, 
    fontWeight: "800", 
    color: theme.textPrimary, 
    letterSpacing: -0.5 
  },
  stepSubtitle: { 
    fontSize: 15, 
    color: theme.textSecondary, 
    marginTop: 6 
  },
  
  inputGroup: { marginBottom: spacing.xl },
  inputLabel: { 
    fontSize: 12, 
    fontWeight: "700", 
    color: theme.textSecondary, 
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
    fontSize: 16,
    fontWeight: "600",
    color: theme.textPrimary,
    borderWidth: 1.5,
    borderColor: theme.border,
  },
  inputWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderColor: theme.border,
    gap: 12,
  },
  inputInner: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
    fontWeight: "600",
    color: theme.textPrimary,
  },
  
  vehicleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: spacing.xl,
  },
  vehicleCard: {
    width: (SCREEN_WIDTH - spacing.xl * 2 - 12) / 2,
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: "center",
    borderWidth: 2,
    borderColor: theme.border,
  },
  vehicleCardSelected: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  vehicleLabel: { 
    fontSize: 15, 
    fontWeight: "700", 
    color: theme.textPrimary, 
    marginTop: 8 
  },
  vehicleDesc: { 
    fontSize: 11, 
    color: theme.textSecondary, 
    marginTop: 2 
  },
  
  cityScroll: { gap: 8 },
  cityChip: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: theme.surface,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: theme.border,
  },
  cityChipSelected: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  cityText: { 
    fontSize: 14, 
    fontWeight: "600", 
    color: theme.textPrimary 
  },
  
  successIcon: { 
    alignItems: "center", 
    marginBottom: spacing.lg 
  },
  
  summaryCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  summaryLabel: { 
    flex: 1, 
    marginLeft: 12, 
    fontSize: 14, 
    color: theme.textSecondary 
  },
  summaryValue: { 
    fontSize: 14, 
    fontWeight: "700", 
    color: theme.textPrimary 
  },
  summaryDivider: { 
    height: 1, 
    backgroundColor: theme.border, 
    marginLeft: 32 
  },
  
  noteCard: {
    flexDirection: "row",
    backgroundColor: theme.primaryLight,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 12,
  },
  noteText: { 
    flex: 1, 
    fontSize: 13, 
    color: theme.textSecondary, 
    lineHeight: 18 
  },
  
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    backgroundColor: theme.background,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  continueBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.primary,
    paddingVertical: 18,
    borderRadius: radius.lg,
    gap: 8,
  },
  continueBtnDisabled: { opacity: 0.5 },
  continueBtnText: { 
    color: "#fff", 
    fontWeight: "800", 
    fontSize: 17 
  },
});
