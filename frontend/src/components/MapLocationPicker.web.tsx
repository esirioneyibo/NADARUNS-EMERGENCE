import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Modal,
  TextInput,
  ScrollView,
} from "react-native";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { SlideInDown } from "react-native-reanimated";

interface MapLocationPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelectLocation: (address: string, coords: { latitude: number; longitude: number }) => void;
  title: string;
  initialCoords?: { latitude: number; longitude: number } | null;
  theme: any;
  markerColor?: string;
}

const DEFAULT_COORDS = { latitude: 60.1699, longitude: 24.9384 };

export default function MapLocationPicker({
  visible,
  onClose,
  onSelectLocation,
  title,
  initialCoords,
  theme,
  markerColor = "#FF6B35",
}: MapLocationPickerProps) {
  const [coords, setCoords] = useState<{ latitude: number; longitude: number }>(initialCoords || DEFAULT_COORDS);
  const [address, setAddress] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ address: string; coords: { latitude: number; longitude: number } }>>([]);

  useEffect(() => {
    if (visible && !initialCoords) {
      getCurrentLocation();
    }
  }, [visible]);

  useEffect(() => {
    if (visible && coords) {
      reverseGeocode(coords);
    }
  }, [coords.latitude, coords.longitude, visible]);

  const getCurrentLocation = async () => {
    setIsGettingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const newCoords = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      setCoords(newCoords);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (error) {
      console.warn("Error getting location:", error);
    } finally {
      setIsGettingLocation(false);
    }
  };

  const reverseGeocode = async (coordsToGeocode: { latitude: number; longitude: number }) => {
    try {
      const results = await Location.reverseGeocodeAsync(coordsToGeocode);
      if (results.length > 0) {
        const loc = results[0];
        const formattedAddress = [loc.streetNumber, loc.street, loc.city, loc.region, loc.postalCode].filter(Boolean).join(", ");
        setAddress(formattedAddress || `${coordsToGeocode.latitude.toFixed(5)}, ${coordsToGeocode.longitude.toFixed(5)}`);
      } else {
        setAddress(`${coordsToGeocode.latitude.toFixed(5)}, ${coordsToGeocode.longitude.toFixed(5)}`);
      }
    } catch (error) {
      setAddress(`${coordsToGeocode.latitude.toFixed(5)}, ${coordsToGeocode.longitude.toFixed(5)}`);
    }
  };

  const handleSearch = async () => {
    if (searchQuery.length < 2) return;
    setIsLoading(true);
    try {
      const results = await Location.geocodeAsync(searchQuery);
      if (results.length > 0) {
        const searchResultsList = await Promise.all(
          results.slice(0, 5).map(async (result) => {
            const reverseResults = await Location.reverseGeocodeAsync({ latitude: result.latitude, longitude: result.longitude });
            let addressStr = searchQuery;
            if (reverseResults.length > 0) {
              const loc = reverseResults[0];
              addressStr = [loc.streetNumber, loc.street, loc.city, loc.postalCode].filter(Boolean).join(", ") || searchQuery;
            }
            return { address: addressStr, coords: { latitude: result.latitude, longitude: result.longitude } };
          })
        );
        setSearchResults(searchResultsList);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const selectSearchResult = (result: { address: string; coords: { latitude: number; longitude: number } }) => {
    setCoords(result.coords);
    setAddress(result.address);
    setSearchResults([]);
    setSearchQuery("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const handleConfirm = () => {
    if (!address) return;
    onSelectLocation(address, coords);
    onClose();
  };

  const styles = createStyles(theme, markerColor);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.currentLocationBtn} onPress={getCurrentLocation} disabled={isGettingLocation}>
            {isGettingLocation ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <>
                <View style={[styles.iconCircle, { backgroundColor: markerColor }]}>
                  <Ionicons name="locate" size={20} color="#fff" />
                </View>
                <Text style={styles.currentLocationText}>Use my current location</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.searchContainer}>
            <View style={styles.searchInputWrapper}>
              <Ionicons name="search" size={20} color={theme.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search for an address..."
                placeholderTextColor={theme.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleSearch}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => { setSearchQuery(""); setSearchResults([]); }}>
                  <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} disabled={isLoading}>
              {isLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.searchBtnText}>Search</Text>}
            </TouchableOpacity>
          </View>

          {searchResults.length > 0 && (
            <View style={styles.searchResults}>
              {searchResults.map((result, index) => (
                <TouchableOpacity
                  key={index}
                  style={[styles.searchResultItem, index < searchResults.length - 1 && styles.searchResultBorder]}
                  onPress={() => selectSearchResult(result)}
                >
                  <Ionicons name="location" size={18} color={markerColor} />
                  <Text style={styles.searchResultText} numberOfLines={2}>{result.address}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.mapPlaceholder}>
            <View style={[styles.mapMarker, { backgroundColor: markerColor }]}>
              <Ionicons name="location" size={32} color="#fff" />
            </View>
            <Text style={styles.mapNote}>Interactive map available on mobile app</Text>
            <Text style={styles.coordsDisplay}>Lat: {coords.latitude.toFixed(5)}, Lng: {coords.longitude.toFixed(5)}</Text>
          </View>

          <View style={styles.manualEntry}>
            <Text style={styles.sectionLabel}>Or enter coordinates manually:</Text>
            <View style={styles.coordInputRow}>
              <View style={styles.coordInputWrapper}>
                <Text style={styles.coordLabel}>Latitude</Text>
                <TextInput
                  style={styles.coordInput}
                  value={coords.latitude.toString()}
                  onChangeText={(val) => { const num = parseFloat(val); if (!isNaN(num)) setCoords(prev => ({ ...prev, latitude: num })); }}
                  keyboardType="numeric"
                  placeholder="60.1699"
                  placeholderTextColor={theme.textSecondary}
                />
              </View>
              <View style={styles.coordInputWrapper}>
                <Text style={styles.coordLabel}>Longitude</Text>
                <TextInput
                  style={styles.coordInput}
                  value={coords.longitude.toString()}
                  onChangeText={(val) => { const num = parseFloat(val); if (!isNaN(num)) setCoords(prev => ({ ...prev, longitude: num })); }}
                  keyboardType="numeric"
                  placeholder="24.9384"
                  placeholderTextColor={theme.textSecondary}
                />
              </View>
            </View>
          </View>
        </ScrollView>

        <Animated.View entering={SlideInDown.duration(300)} style={styles.bottomSheet}>
          <View style={styles.addressPreview}>
            <View style={[styles.addressIcon, { backgroundColor: markerColor }]}>
              <Ionicons name="location" size={20} color="#fff" />
            </View>
            <View style={styles.addressTextContainer}>
              <Text style={styles.addressLabel}>Selected Location</Text>
              <Text style={styles.addressText} numberOfLines={2}>{address || "Search or use current location"}</Text>
            </View>
          </View>
          <TouchableOpacity style={[styles.confirmBtn, !address && styles.confirmBtnDisabled]} onPress={handleConfirm} disabled={!address}>
            <Ionicons name="checkmark" size={22} color="#fff" />
            <Text style={styles.confirmBtnText}>Confirm Location</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: any, markerColor: string) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: theme.card, borderBottomWidth: 1, borderBottomColor: theme.border, paddingTop: Platform.OS === "ios" ? 50 : 12 },
    closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.backgroundSecondary, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "700", color: theme.textPrimary },
    content: { flex: 1, padding: 16 },
    currentLocationBtn: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, padding: 16, borderRadius: 12, marginBottom: 16, gap: 12, borderWidth: 1, borderColor: theme.border },
    iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    currentLocationText: { fontSize: 16, fontWeight: "600", color: theme.textPrimary },
    searchContainer: { flexDirection: "row", gap: 8, marginBottom: 16 },
    searchInputWrapper: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: 12, paddingHorizontal: 12, gap: 8, borderWidth: 1, borderColor: theme.border },
    searchInput: { flex: 1, fontSize: 16, color: theme.textPrimary, paddingVertical: 14 },
    searchBtn: { paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" },
    searchBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
    searchResults: { backgroundColor: theme.card, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: theme.border },
    searchResultItem: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
    searchResultBorder: { borderBottomWidth: 1, borderBottomColor: theme.border },
    searchResultText: { flex: 1, fontSize: 14, color: theme.textPrimary },
    mapPlaceholder: { height: 200, backgroundColor: theme.card, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: theme.border, borderStyle: "dashed", marginBottom: 16 },
    mapMarker: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", marginBottom: 12 },
    mapNote: { fontSize: 14, color: theme.textSecondary, marginBottom: 8 },
    coordsDisplay: { fontSize: 12, color: theme.textSecondary },
    manualEntry: { marginBottom: 20 },
    sectionLabel: { fontSize: 14, fontWeight: "600", color: theme.textSecondary, marginBottom: 12 },
    coordInputRow: { flexDirection: "row", gap: 12 },
    coordInputWrapper: { flex: 1 },
    coordLabel: { fontSize: 12, color: theme.textSecondary, marginBottom: 6 },
    coordInput: { backgroundColor: theme.card, borderRadius: 10, padding: 14, fontSize: 15, color: theme.textPrimary, borderWidth: 1, borderColor: theme.border },
    bottomSheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 20, paddingBottom: Platform.OS === "ios" ? 40 : 24, borderTopWidth: 1, borderTopColor: theme.border },
    addressPreview: { flexDirection: "row", alignItems: "flex-start", gap: 14, marginBottom: 20 },
    addressIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    addressTextContainer: { flex: 1 },
    addressLabel: { fontSize: 12, color: theme.textSecondary, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
    addressText: { fontSize: 16, fontWeight: "600", color: theme.textPrimary, lineHeight: 22 },
    confirmBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: theme.primary, paddingVertical: 16, borderRadius: 14, gap: 8 },
    confirmBtnDisabled: { opacity: 0.5 },
    confirmBtnText: { fontSize: 17, fontWeight: "700", color: "#fff" },
  });
