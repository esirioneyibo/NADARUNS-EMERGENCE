import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Modal,
  Dimensions,
  TextInput,
} from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { SlideInDown } from "react-native-reanimated";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

interface MapLocationPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelectLocation: (address: string, coords: { latitude: number; longitude: number }) => void;
  title: string;
  initialCoords?: { latitude: number; longitude: number } | null;
  theme: any;
  markerColor?: string;
}

// Default to Helsinki
const DEFAULT_REGION = {
  latitude: 60.1699,
  longitude: 24.9384,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

export default function MapLocationPicker({
  visible,
  onClose,
  onSelectLocation,
  title,
  initialCoords,
  theme,
  markerColor = "#FF6B35",
}: MapLocationPickerProps) {
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(
    initialCoords
      ? { ...initialCoords, latitudeDelta: 0.01, longitudeDelta: 0.01 }
      : DEFAULT_REGION
  );
  const [markerCoords, setMarkerCoords] = useState<{ latitude: number; longitude: number }>(
    initialCoords || { latitude: DEFAULT_REGION.latitude, longitude: DEFAULT_REGION.longitude }
  );
  const [address, setAddress] = useState("");
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ address: string; coords: { latitude: number; longitude: number } }>>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (visible && !initialCoords) {
      getCurrentLocation();
    }
  }, [visible]);

  useEffect(() => {
    if (visible && markerCoords) {
      reverseGeocode(markerCoords);
    }
  }, [markerCoords, visible]);

  const getCurrentLocation = async () => {
    setIsGettingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        return;
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const newCoords = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
      setMarkerCoords(newCoords);
      setRegion({ ...newCoords, latitudeDelta: 0.005, longitudeDelta: 0.005 });
      mapRef.current?.animateToRegion({ ...newCoords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (error) {
      console.warn("Error getting location:", error);
    } finally {
      setIsGettingLocation(false);
    }
  };

  const reverseGeocode = async (coords: { latitude: number; longitude: number }) => {
    try {
      const results = await Location.reverseGeocodeAsync(coords);
      if (results.length > 0) {
        const loc = results[0];
        const formattedAddress = [loc.streetNumber, loc.street, loc.city, loc.region, loc.postalCode].filter(Boolean).join(", ");
        setAddress(formattedAddress || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      } else {
        setAddress(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      }
    } catch (error) {
      setAddress(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
    }
  };

  const handleMapPress = (event: any) => {
    const { coordinate } = event.nativeEvent;
    setMarkerCoords(coordinate);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const handleMarkerDragEnd = (event: any) => {
    const { coordinate } = event.nativeEvent;
    setMarkerCoords(coordinate);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };

  const handleSearch = async () => {
    if (searchQuery.length < 2) return;
    setIsSearching(true);
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
      setIsSearching(false);
    }
  };

  const selectSearchResult = (result: { address: string; coords: { latitude: number; longitude: number } }) => {
    setMarkerCoords(result.coords);
    setAddress(result.address);
    setSearchResults([]);
    setSearchQuery("");
    mapRef.current?.animateToRegion({ ...result.coords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const handleConfirm = () => {
    if (!address) return;
    onSelectLocation(address, markerCoords);
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

        <View style={styles.searchContainer}>
          <View style={styles.searchInputWrapper}>
            <Ionicons name="search" size={20} color={theme.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search address..."
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
          <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} disabled={isSearching}>
            {isSearching ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="search" size={20} color="#fff" />}
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

        <View style={styles.mapContainer}>
          <MapView ref={mapRef} style={styles.map} initialRegion={region} onPress={handleMapPress} showsUserLocation showsMyLocationButton={false} mapType="standard">
            <Marker coordinate={markerCoords} draggable onDragEnd={handleMarkerDragEnd}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, { backgroundColor: markerColor }]}>
                  <Ionicons name="location" size={24} color="#fff" />
                </View>
                <View style={[styles.markerShadow, { backgroundColor: markerColor }]} />
              </View>
            </Marker>
          </MapView>
          <View style={styles.centerIndicator} pointerEvents="none">
            <Text style={styles.centerIndicatorText}>Drag pin or tap map</Text>
          </View>
          <TouchableOpacity style={styles.myLocationBtn} onPress={getCurrentLocation} disabled={isGettingLocation}>
            {isGettingLocation ? <ActivityIndicator size="small" color={theme.primary} /> : <Ionicons name="locate" size={24} color={theme.primary} />}
          </TouchableOpacity>
        </View>

        <Animated.View entering={SlideInDown.duration(300)} style={styles.bottomSheet}>
          <View style={styles.addressPreview}>
            <View style={[styles.addressIcon, { backgroundColor: markerColor }]}>
              <Ionicons name="location" size={20} color="#fff" />
            </View>
            <View style={styles.addressTextContainer}>
              <Text style={styles.addressLabel}>Selected Location</Text>
              <Text style={styles.addressText} numberOfLines={2}>{address || "Tap on map to select location"}</Text>
              <Text style={styles.coordsText}>📍 {markerCoords.latitude.toFixed(5)}, {markerCoords.longitude.toFixed(5)}</Text>
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
    searchContainer: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, gap: 8, backgroundColor: theme.card },
    searchInputWrapper: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: theme.backgroundSecondary, borderRadius: 12, paddingHorizontal: 12, gap: 8 },
    searchInput: { flex: 1, fontSize: 16, color: theme.textPrimary, paddingVertical: 12 },
    searchBtn: { width: 48, height: 48, borderRadius: 12, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" },
    searchResults: { position: "absolute", top: Platform.OS === "ios" ? 160 : 120, left: 16, right: 16, backgroundColor: theme.card, borderRadius: 12, zIndex: 100, elevation: 5, maxHeight: 250 },
    searchResultItem: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
    searchResultBorder: { borderBottomWidth: 1, borderBottomColor: theme.border },
    searchResultText: { flex: 1, fontSize: 14, color: theme.textPrimary },
    mapContainer: { flex: 1, position: "relative" },
    map: { ...StyleSheet.absoluteFillObject },
    centerIndicator: { position: "absolute", top: 16, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
    centerIndicatorText: { color: "#fff", fontSize: 13, fontWeight: "500" },
    myLocationBtn: { position: "absolute", bottom: 200, right: 16, width: 50, height: 50, borderRadius: 25, backgroundColor: theme.card, alignItems: "center", justifyContent: "center", elevation: 4 },
    markerContainer: { alignItems: "center" },
    marker: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", elevation: 4 },
    markerShadow: { width: 20, height: 8, borderRadius: 10, opacity: 0.3, marginTop: -4 },
    bottomSheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 20, paddingBottom: Platform.OS === "ios" ? 40 : 24, elevation: 10 },
    addressPreview: { flexDirection: "row", alignItems: "flex-start", gap: 14, marginBottom: 20 },
    addressIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    addressTextContainer: { flex: 1 },
    addressLabel: { fontSize: 12, color: theme.textSecondary, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
    addressText: { fontSize: 16, fontWeight: "600", color: theme.textPrimary, lineHeight: 22 },
    coordsText: { fontSize: 12, color: theme.textSecondary, marginTop: 4 },
    confirmBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: theme.primary, paddingVertical: 16, borderRadius: 14, gap: 8 },
    confirmBtnDisabled: { opacity: 0.5 },
    confirmBtnText: { fontSize: 17, fontWeight: "700", color: "#fff" },
  });
