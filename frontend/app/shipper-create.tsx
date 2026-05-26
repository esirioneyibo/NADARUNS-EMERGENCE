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
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp, FadeIn, SlideInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";

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
  const [pickupCoords, setPickupCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [pickupName, setPickupName] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");
  const [pickupNotes, setPickupNotes] = useState("");
  
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [dropoffCoords, setDropoffCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [dropoffName, setDropoffName] = useState("");
  const [dropoffPhone, setDropoffPhone] = useState("");
  const [dropoffNotes, setDropoffNotes] = useState("");
  
  const [vehicleType, setVehicleType] = useState("car");
  const [cargoWeight, setCargoWeight] = useState("");
  const [cargoDescription, setCargoDescription] = useState("");
  
  // Location picker modals
  const [showPickupPicker, setShowPickupPicker] = useState(false);
  const [showDropoffPicker, setShowDropoffPicker] = useState(false);
  
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
        <TouchableOpacity 
          style={styles.addressSelectButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowPickupPicker(true);
          }}
        >
          <View style={styles.addressSelectIcon}>
            <Ionicons name="location" size={20} color="#fff" />
          </View>
          <View style={styles.addressSelectContent}>
            {pickupAddress ? (
              <>
                <Text style={styles.addressSelectText} numberOfLines={2}>{pickupAddress}</Text>
                {pickupCoords && (
                  <Text style={styles.addressSelectCoords}>
                    📍 {pickupCoords.latitude.toFixed(5)}, {pickupCoords.longitude.toFixed(5)}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.addressSelectPlaceholder}>Tap to select on map</Text>
            )}
          </View>
          <Ionicons name="map" size={24} color={theme.primary} />
        </TouchableOpacity>
        
        {/* Manual entry option */}
        <View style={[styles.inputContainer, { marginTop: spacing.sm }]}>
          <Ionicons name="create-outline" size={18} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="Or type address manually..."
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
        <TouchableOpacity 
          style={styles.addressSelectButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowDropoffPicker(true);
          }}
        >
          <View style={[styles.addressSelectIcon, { backgroundColor: "#10B981" }]}>
            <Ionicons name="flag" size={20} color="#fff" />
          </View>
          <View style={styles.addressSelectContent}>
            {dropoffAddress ? (
              <>
                <Text style={styles.addressSelectText} numberOfLines={2}>{dropoffAddress}</Text>
                {dropoffCoords && (
                  <Text style={styles.addressSelectCoords}>
                    📍 {dropoffCoords.latitude.toFixed(5)}, {dropoffCoords.longitude.toFixed(5)}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.addressSelectPlaceholder}>Tap to select on map</Text>
            )}
          </View>
          <Ionicons name="map" size={24} color="#10B981" />
        </TouchableOpacity>
        
        {/* Manual entry option */}
        <View style={[styles.inputContainer, { marginTop: spacing.sm }]}>
          <Ionicons name="create-outline" size={18} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="Or type address manually..."
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
      
      {/* Location Picker Modals - Web-compatible using expo-location */}
      <LocationPickerModal
        visible={showPickupPicker}
        onClose={() => setShowPickupPicker(false)}
        onSelectLocation={(address, coords) => {
          setPickupAddress(address);
          setPickupCoords(coords);
        }}
        title="Select Pickup Location"
        initialAddress={pickupAddress}
        theme={theme}
      />
      
      <LocationPickerModal
        visible={showDropoffPicker}
        onClose={() => setShowDropoffPicker(false)}
        onSelectLocation={(address, coords) => {
          setDropoffAddress(address);
          setDropoffCoords(coords);
        }}
        title="Select Dropoff Location"
        initialAddress={dropoffAddress}
        theme={theme}
      />
    </KeyboardAvoidingView>
  );
}

// Inline LocationPicker Modal - Web compatible using expo-location
interface LocationPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectLocation: (address: string, coords: { latitude: number; longitude: number }) => void;
  title: string;
  initialAddress: string;
  theme: any;
}

function LocationPickerModal({
  visible,
  onClose,
  onSelectLocation,
  title,
  initialAddress,
  theme,
}: LocationPickerModalProps) {
  const [address, setAddress] = useState(initialAddress);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    if (visible) {
      setAddress(initialAddress);
      setCoords(null);
    }
  }, [visible, initialAddress]);

  const searchAddress = async (query: string) => {
    setAddress(query);
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }
    
    try {
      const results = await Location.geocodeAsync(query);
      if (results.length > 0) {
        // Generate suggestions based on geocode results
        const suggestionList = results.slice(0, 3).map((r, i) => 
          `${query} (Location ${i + 1})`
        );
        setSuggestions(suggestionList);
        
        // Auto-set first result coords
        setCoords({
          latitude: results[0].latitude,
          longitude: results[0].longitude,
        });
      }
    } catch (e) {
      console.warn("Geocode error:", e);
    }
  };

  const useCurrentLocation = async () => {
    setIsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Required", "Location permission is needed to use current location");
        return;
      }
      
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      
      const results = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      
      if (results.length > 0) {
        const loc = results[0];
        const formattedAddress = [
          loc.streetNumber,
          loc.street,
          loc.city,
          loc.postalCode,
        ].filter(Boolean).join(", ");
        
        setAddress(formattedAddress);
        setCoords({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (e) {
      console.warn("Location error:", e);
      Alert.alert("Error", "Could not get current location");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!address.trim()) return;
    
    // If we don't have coords yet, geocode the address
    if (!coords) {
      setIsLoading(true);
      Location.geocodeAsync(address)
        .then((results) => {
          if (results.length > 0) {
            onSelectLocation(address, {
              latitude: results[0].latitude,
              longitude: results[0].longitude,
            });
          } else {
            // Fallback to Helsinki center if geocoding fails
            onSelectLocation(address, { latitude: 60.1699, longitude: 24.9384 });
          }
          onClose();
        })
        .catch(() => {
          onSelectLocation(address, { latitude: 60.1699, longitude: 24.9384 });
          onClose();
        })
        .finally(() => setIsLoading(false));
    } else {
      onSelectLocation(address, coords);
      onClose();
    }
  };

  const modalStyles = createModalStyles(theme);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={modalStyles.overlay}>
        <Animated.View entering={SlideInDown.duration(300)} style={modalStyles.container}>
          <View style={modalStyles.header}>
            <TouchableOpacity onPress={onClose} style={modalStyles.closeButton}>
              <Ionicons name="close" size={24} color={theme.text} />
            </TouchableOpacity>
            <Text style={modalStyles.headerTitle}>{title}</Text>
            <View style={{ width: 44 }} />
          </View>

          <ScrollView style={modalStyles.content} keyboardShouldPersistTaps="handled">
            {/* Current Location Button */}
            <TouchableOpacity style={modalStyles.currentLocationBtn} onPress={useCurrentLocation} disabled={isLoading}>
              {isLoading ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <>
                  <View style={modalStyles.currentLocationIcon}>
                    <Ionicons name="locate" size={20} color="#fff" />
                  </View>
                  <Text style={modalStyles.currentLocationText}>Use my current location</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Address Input */}
            <View style={modalStyles.inputGroup}>
              <Text style={modalStyles.inputLabel}>Enter Address</Text>
              <View style={modalStyles.inputContainer}>
                <Ionicons name="search" size={20} color={theme.textSecondary} />
                <TextInput
                  style={modalStyles.input}
                  placeholder="Search for an address..."
                  placeholderTextColor={theme.textSecondary}
                  value={address}
                  onChangeText={searchAddress}
                  multiline
                />
                {address.length > 0 && (
                  <TouchableOpacity onPress={() => { setAddress(""); setSuggestions([]); setCoords(null); }}>
                    <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Suggestions */}
            {suggestions.length > 0 && (
              <View style={modalStyles.suggestions}>
                {suggestions.map((suggestion, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[modalStyles.suggestionItem, i < suggestions.length - 1 && modalStyles.suggestionBorder]}
                    onPress={() => {
                      setAddress(suggestion.replace(/ \(Location \d+\)$/, ""));
                      setSuggestions([]);
                    }}
                  >
                    <Ionicons name="location" size={18} color={theme.primary} />
                    <Text style={modalStyles.suggestionText}>{suggestion}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Coordinates Display */}
            {coords && (
              <View style={modalStyles.coordsBox}>
                <Ionicons name="pin" size={18} color={theme.primary} />
                <Text style={modalStyles.coordsText}>
                  📍 {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
                </Text>
              </View>
            )}

            <Text style={modalStyles.tipText}>
              💡 Enter a full address including street number and city for best accuracy
            </Text>
          </ScrollView>

          {/* Footer */}
          <View style={modalStyles.footer}>
            <TouchableOpacity style={modalStyles.cancelButton} onPress={onClose}>
              <Text style={modalStyles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[modalStyles.confirmButton, !address.trim() && modalStyles.confirmButtonDisabled]}
              onPress={handleConfirm}
              disabled={!address.trim() || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={modalStyles.confirmButtonText}>Confirm</Text>
                  <Ionicons name="checkmark" size={20} color="#fff" />
                </>
              )}
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const createModalStyles = (theme: any) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  container: {
    backgroundColor: theme.card || theme.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.text || theme.textPrimary,
  },
  content: {
    padding: spacing.lg,
    maxHeight: 400,
  },
  currentLocationBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.primaryLight || "#E0F2FE",
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  currentLocationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  currentLocationText: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.primary,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.text || theme.textPrimary,
    marginBottom: spacing.sm,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface || "#F9FAFB",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: theme.text || theme.textPrimary,
    minHeight: 44,
  },
  suggestions: {
    backgroundColor: theme.surface || "#F9FAFB",
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: theme.border,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    gap: spacing.sm,
  },
  suggestionBorder: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  suggestionText: {
    fontSize: 14,
    color: theme.text || theme.textPrimary,
  },
  coordsBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: "#D1FAE5",
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  coordsText: {
    fontSize: 13,
    color: "#065F46",
    fontWeight: "500",
  },
  tipText: {
    fontSize: 13,
    color: theme.textSecondary,
    fontStyle: "italic",
    marginTop: spacing.sm,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: Platform.OS === "ios" ? 34 : spacing.lg,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.textSecondary,
  },
  confirmButton: {
    flex: 1,
    flexDirection: "row",
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});

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
  
  // Address select button styles
  addressSelectButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: theme.primary,
    borderStyle: "dashed",
    padding: spacing.md,
    gap: spacing.md,
  },
  addressSelectIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  addressSelectContent: {
    flex: 1,
  },
  addressSelectText: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.textPrimary,
    lineHeight: 20,
  },
  addressSelectCoords: {
    fontSize: 12,
    color: theme.textSecondary,
    marginTop: 4,
  },
  addressSelectPlaceholder: {
    fontSize: 15,
    color: theme.textSecondary,
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
