import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Keyboard,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut, SlideInDown } from "react-native-reanimated";
import { radius, shadows, spacing } from "../theme";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// Helsinki center as default
const DEFAULT_REGION: Region = {
  latitude: 60.1699,
  longitude: 24.9384,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

interface LocationPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelectLocation: (address: string, coords: { latitude: number; longitude: number }) => void;
  title?: string;
  initialAddress?: string;
  theme: any;
}

interface SearchResult {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

export default function LocationPicker({
  visible,
  onClose,
  onSelectLocation,
  title = "Select Location",
  initialAddress = "",
  theme,
}: LocationPickerProps) {
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [selectedCoords, setSelectedCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [address, setAddress] = useState(initialAddress);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [locationPermission, setLocationPermission] = useState(false);

  // Request location permission and get current location
  useEffect(() => {
    if (visible) {
      (async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        setLocationPermission(status === "granted");
        
        if (status === "granted") {
          try {
            const location = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            const newRegion: Region = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            };
            setRegion(newRegion);
            setSelectedCoords({
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            });
            // Get address for current location
            reverseGeocode(location.coords.latitude, location.coords.longitude);
          } catch (e) {
            console.warn("Error getting location:", e);
          }
        }
      })();
    }
  }, [visible]);

  // Reverse geocode to get address from coordinates
  const reverseGeocode = useCallback(async (latitude: number, longitude: number) => {
    setIsLoadingAddress(true);
    try {
      const results = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (results.length > 0) {
        const loc = results[0];
        const parts = [
          loc.streetNumber,
          loc.street,
          loc.city,
          loc.postalCode,
        ].filter(Boolean);
        const formattedAddress = parts.join(", ") || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        setAddress(formattedAddress);
      }
    } catch (e) {
      console.warn("Reverse geocode error:", e);
      setAddress(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
    } finally {
      setIsLoadingAddress(false);
    }
  }, []);

  // Handle map press to select location
  const handleMapPress = useCallback((event: any) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCoords({ latitude, longitude });
    reverseGeocode(latitude, longitude);
  }, [reverseGeocode]);

  // Handle region change (when map is dragged)
  const handleRegionChangeComplete = useCallback((newRegion: Region) => {
    setRegion(newRegion);
  }, []);

  // Search for places
  const searchPlaces = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }
    
    setIsSearching(true);
    try {
      // Use Expo Location geocoding for simplicity
      const results = await Location.geocodeAsync(query);
      if (results.length > 0) {
        // Convert to search results format
        const formattedResults: SearchResult[] = results.slice(0, 5).map((r, i) => ({
          place_id: `place_${i}`,
          description: query,
          structured_formatting: {
            main_text: query.split(",")[0] || query,
            secondary_text: query.split(",").slice(1).join(",") || "Finland",
          },
        }));
        setSearchResults(formattedResults);
        
        // Also update map to first result
        if (results[0]) {
          const newRegion: Region = {
            latitude: results[0].latitude,
            longitude: results[0].longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          };
          setRegion(newRegion);
          setSelectedCoords({
            latitude: results[0].latitude,
            longitude: results[0].longitude,
          });
          mapRef.current?.animateToRegion(newRegion, 500);
        }
      }
    } catch (e) {
      console.warn("Search error:", e);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Center on user's current location
  const centerOnUserLocation = useCallback(async () => {
    if (!locationPermission) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      setLocationPermission(true);
    }
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const newRegion: Region = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setRegion(newRegion);
      setSelectedCoords({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      mapRef.current?.animateToRegion(newRegion, 500);
      reverseGeocode(location.coords.latitude, location.coords.longitude);
    } catch (e) {
      console.warn("Error getting location:", e);
    }
  }, [locationPermission, reverseGeocode]);

  // Confirm selection
  const handleConfirm = useCallback(() => {
    if (selectedCoords && address) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSelectLocation(address, selectedCoords);
      onClose();
    }
  }, [selectedCoords, address, onSelectLocation, onClose]);

  // Select from center of map (drag to select)
  const selectFromCenter = useCallback(() => {
    const { latitude, longitude } = region;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCoords({ latitude, longitude });
    reverseGeocode(latitude, longitude);
  }, [region, reverseGeocode]);

  const styles = createStyles(theme);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: Platform.OS === "ios" ? 50 : 20 }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={28} color={theme.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={{ width: 44 }} />
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputContainer}>
            <Ionicons name="search" size={20} color={theme.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search address..."
              placeholderTextColor={theme.textSecondary}
              value={searchQuery}
              onChangeText={(text) => {
                setSearchQuery(text);
                setShowSearch(true);
                searchPlaces(text);
              }}
              onFocus={() => setShowSearch(true)}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => {
                setSearchQuery("");
                setSearchResults([]);
                setShowSearch(false);
                Keyboard.dismiss();
              }}>
                <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          
          {/* Search Results Dropdown */}
          {showSearch && searchResults.length > 0 && (
            <Animated.View entering={FadeIn.duration(200)} style={styles.searchResults}>
              {searchResults.map((result, index) => (
                <TouchableOpacity
                  key={result.place_id}
                  style={[styles.searchResultItem, index < searchResults.length - 1 && styles.searchResultBorder]}
                  onPress={async () => {
                    setSearchQuery(result.description);
                    setShowSearch(false);
                    setSearchResults([]);
                    Keyboard.dismiss();
                    
                    // Geocode and move to location
                    try {
                      const results = await Location.geocodeAsync(result.description);
                      if (results[0]) {
                        const newRegion: Region = {
                          latitude: results[0].latitude,
                          longitude: results[0].longitude,
                          latitudeDelta: 0.005,
                          longitudeDelta: 0.005,
                        };
                        setRegion(newRegion);
                        setSelectedCoords({
                          latitude: results[0].latitude,
                          longitude: results[0].longitude,
                        });
                        setAddress(result.description);
                        mapRef.current?.animateToRegion(newRegion, 500);
                      }
                    } catch (e) {
                      console.warn("Geocode error:", e);
                    }
                  }}
                >
                  <Ionicons name="location" size={20} color={theme.primary} />
                  <View style={styles.searchResultText}>
                    <Text style={styles.searchResultMain}>{result.structured_formatting.main_text}</Text>
                    <Text style={styles.searchResultSecondary}>{result.structured_formatting.secondary_text}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </Animated.View>
          )}
        </View>

        {/* Map */}
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={PROVIDER_GOOGLE}
            initialRegion={region}
            region={region}
            onRegionChangeComplete={handleRegionChangeComplete}
            onPress={handleMapPress}
            showsUserLocation
            showsMyLocationButton={false}
            showsCompass={false}
          >
            {selectedCoords && (
              <Marker
                coordinate={selectedCoords}
                anchor={{ x: 0.5, y: 1 }}
              >
                <View style={styles.markerContainer}>
                  <View style={styles.marker}>
                    <Ionicons name="location" size={24} color="#fff" />
                  </View>
                  <View style={styles.markerShadow} />
                </View>
              </Marker>
            )}
          </MapView>

          {/* Center Pin (for drag to select) */}
          {!selectedCoords && (
            <View style={styles.centerPin} pointerEvents="none">
              <View style={styles.centerPinMarker}>
                <Ionicons name="location" size={32} color={theme.primary} />
              </View>
            </View>
          )}

          {/* My Location Button */}
          <TouchableOpacity style={styles.myLocationButton} onPress={centerOnUserLocation}>
            <Ionicons name="locate" size={24} color={theme.primary} />
          </TouchableOpacity>

          {/* Select from center button */}
          {!selectedCoords && (
            <TouchableOpacity style={styles.selectCenterButton} onPress={selectFromCenter}>
              <Text style={styles.selectCenterText}>Select this location</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Bottom Sheet - Address Display & Confirm */}
        <Animated.View entering={SlideInDown.duration(300)} style={styles.bottomSheet}>
          <View style={styles.addressContainer}>
            <View style={styles.addressIconContainer}>
              <Ionicons name="location" size={24} color="#fff" />
            </View>
            <View style={styles.addressTextContainer}>
              <Text style={styles.addressLabel}>Selected Address</Text>
              {isLoadingAddress ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Text style={styles.addressText} numberOfLines={2}>
                  {address || "Tap on map to select location"}
                </Text>
              )}
            </View>
          </View>

          {/* Manual Entry Toggle */}
          <TouchableOpacity
            style={styles.manualEntryButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowSearch(true);
            }}
          >
            <Ionicons name="create-outline" size={20} color={theme.primary} />
            <Text style={styles.manualEntryText}>Enter address manually</Text>
          </TouchableOpacity>

          {/* Confirm Button */}
          <TouchableOpacity
            style={[styles.confirmButton, (!selectedCoords || !address) && styles.confirmButtonDisabled]}
            onPress={handleConfirm}
            disabled={!selectedCoords || !address}
          >
            <Text style={styles.confirmButtonText}>Confirm Location</Text>
            <Ionicons name="checkmark-circle" size={22} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: theme.background,
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
    color: theme.text,
  },
  searchContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: theme.background,
    zIndex: 100,
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.card,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    ...shadows.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: theme.text,
    paddingVertical: spacing.xs,
  },
  searchResults: {
    position: "absolute",
    top: 70,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: theme.card,
    borderRadius: radius.lg,
    ...shadows.lg,
    zIndex: 1000,
  },
  searchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    gap: spacing.md,
  },
  searchResultBorder: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  searchResultText: {
    flex: 1,
  },
  searchResultMain: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.text,
  },
  searchResultSecondary: {
    fontSize: 13,
    color: theme.textSecondary,
    marginTop: 2,
  },
  mapContainer: {
    flex: 1,
    position: "relative",
  },
  map: {
    flex: 1,
  },
  markerContainer: {
    alignItems: "center",
  },
  marker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.lg,
  },
  markerShadow: {
    width: 12,
    height: 6,
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 6,
    marginTop: -2,
  },
  centerPin: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -16,
    marginTop: -32,
    zIndex: 10,
  },
  centerPinMarker: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  myLocationButton: {
    position: "absolute",
    bottom: 120,
    right: spacing.lg,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.card,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.lg,
  },
  selectCenterButton: {
    position: "absolute",
    bottom: 180,
    alignSelf: "center",
    backgroundColor: theme.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    ...shadows.lg,
  },
  selectCenterText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  bottomSheet: {
    backgroundColor: theme.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: Platform.OS === "ios" ? 34 : spacing.lg,
    ...shadows.lg,
  },
  addressContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  addressIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  addressTextContainer: {
    flex: 1,
  },
  addressLabel: {
    fontSize: 12,
    color: theme.textSecondary,
    marginBottom: 2,
  },
  addressText: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.text,
    lineHeight: 20,
  },
  manualEntryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  manualEntryText: {
    color: theme.primary,
    fontWeight: "600",
    fontSize: 14,
  },
  confirmButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
});
