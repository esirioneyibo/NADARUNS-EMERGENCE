import React, { useEffect, useRef, useState, ReactNode } from "react";
import { ActivityIndicator, Alert, Platform, StyleSheet, View, Text, TouchableOpacity } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import { theme } from "../theme";

interface Point {
  lat: number;
  lng: number;
}

interface CustomMarker {
  key: string;
  coordinate: { latitude: number; longitude: number };
  children: ReactNode;
  onPress?: () => void;
}

interface Props {
  pickup?: Point | null;
  dropoff?: Point | null;
  driver?: Point | null;
  routePoints?: Point[] | null;
  showRoute?: boolean;
  height?: number | "100%";
  customMarkers?: CustomMarker[];
}

/**
 * Native Google Maps view (iOS / Android).
 * Renders pickup + dropoff markers, the driver marker (user's real location), and a polyline route.
 * Uses expo-location for real-time device tracking.
 * Supports custom markers for job discovery.
 */
export default function NativeMapView({
  pickup,
  dropoff,
  driver,
  routePoints,
  showRoute = true,
  customMarkers,
}: Props) {
  const mapRef = useRef<MapView | null>(null);
  const [userLocation, setUserLocation] = useState<Point | null>(null);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);

  // Request location permission and start tracking
  useEffect(() => {
    let isMounted = true;

    const startLocationTracking = async () => {
      try {
        // Request foreground permission
        const { status } = await Location.requestForegroundPermissionsAsync();
        
        if (status !== "granted") {
          if (isMounted) {
            setLocationPermission(false);
            setIsLoading(false);
          }
          Alert.alert(
            "Location Permission Required",
            "Please enable location access to see your position on the map.",
            [{ text: "OK" }]
          );
          return;
        }

        if (isMounted) {
          setLocationPermission(true);
        }

        // Get initial location
        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        if (isMounted) {
          setUserLocation({
            lat: currentLocation.coords.latitude,
            lng: currentLocation.coords.longitude,
          });
          setIsLoading(false);
        }

        // Subscribe to location updates
        locationSubscription.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 3000, // Update every 3 seconds
            distanceInterval: 5, // Or when moved 5 meters
          },
          (location) => {
            if (isMounted) {
              setUserLocation({
                lat: location.coords.latitude,
                lng: location.coords.longitude,
              });
            }
          }
        );
      } catch (error) {
        console.warn("Location tracking error:", error);
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    startLocationTracking();

    // Cleanup subscription on unmount
    return () => {
      isMounted = false;
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
    };
  }, []);

  const toLatLng = (p?: Point | null) =>
    p ? { latitude: p.lat, longitude: p.lng } : null;

  const pickupLL = toLatLng(pickup);
  const dropoffLL = toLatLng(dropoff);
  
  // Use real user location for driver marker, fallback to provided driver prop or pickup
  const driverLL = userLocation 
    ? { latitude: userLocation.lat, longitude: userLocation.lng }
    : toLatLng(driver) || pickupLL;
  
  const routeLL = (routePoints || []).map((p) => ({ latitude: p.lat, longitude: p.lng }));

  // Fit map to coordinates when data changes
  useEffect(() => {
    if (!mapRef.current) return;
    
    const coords: { latitude: number; longitude: number }[] = [];
    
    // Add route points if available
    if (routeLL.length > 1) {
      coords.push(...routeLL);
    } else {
      if (pickupLL) coords.push(pickupLL);
      if (dropoffLL) coords.push(dropoffLL);
    }
    
    // Include user location for better map framing
    if (driverLL) {
      coords.push(driverLL);
    }

    if (coords.length < 2) return;

    setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 120, right: 60, bottom: 360, left: 60 },
        animated: true,
      });
    }, 400);
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, routePoints?.length, userLocation?.lat]);

  // Initial region - prefer user location, then pickup, then Helsinki center
  const initialRegion = userLocation
    ? { latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : pickupLL
      ? { latitude: pickupLL.latitude, longitude: pickupLL.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }
      : { latitude: 60.1699, longitude: 24.9384, latitudeDelta: 0.1, longitudeDelta: 0.1 }; // Helsinki center

  return (
    <View style={styles.container} testID="map-view">
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>Getting your location...</Text>
        </View>
      )}
      
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        showsCompass={false}
        showsMyLocationButton={false}
        showsUserLocation={locationPermission === true}
        followsUserLocation={false}
        toolbarEnabled={false}
      >
        {/* Route polyline with shadow effect */}
        {showRoute && routeLL.length > 1 ? (
          <>
            <Polyline
              coordinates={routeLL}
              strokeColor="rgba(12, 74, 66, 0.25)"
              strokeWidth={9}
              lineCap="round"
              lineJoin="round"
            />
            <Polyline
              coordinates={routeLL}
              strokeColor={theme.routeLine}
              strokeWidth={5}
              lineCap="round"
              lineJoin="round"
            />
          </>
        ) : null}

        {/* Pickup marker */}
        {pickupLL ? (
          <Marker coordinate={pickupLL} anchor={{ x: 0.5, y: 0.5 }} identifier="pickup">
            <View style={[styles.markerRing, { backgroundColor: "rgba(12,74,66,0.18)" }]}>
              <View style={[styles.markerDot, { backgroundColor: theme.primary }]}>
                <View style={styles.markerInner} />
              </View>
            </View>
          </Marker>
        ) : null}

        {/* Dropoff marker */}
        {dropoffLL ? (
          <Marker coordinate={dropoffLL} anchor={{ x: 0.5, y: 0.5 }} identifier="dropoff">
            <View style={[styles.markerRing, { backgroundColor: "rgba(15,23,42,0.18)" }]}>
              <View style={[styles.markerDot, { backgroundColor: theme.secondary }]}>
                <View style={styles.markerInner} />
              </View>
            </View>
          </Marker>
        ) : null}

        {/* Driver marker - using real location when available */}
        {driverLL && !locationPermission ? (
          <Marker coordinate={driverLL} anchor={{ x: 0.5, y: 0.5 }} identifier="driver">
            <View style={[styles.markerRing, { backgroundColor: "rgba(20,123,109,0.22)", width: 32, height: 32 }]}>
              <View style={[styles.markerDot, { backgroundColor: theme.primaryActive, width: 18, height: 18, borderRadius: 9 }]} />
            </View>
          </Marker>
        ) : null}

        {/* Custom markers for job discovery */}
        {customMarkers?.map((marker) => (
          <Marker
            key={marker.key}
            coordinate={marker.coordinate}
            anchor={{ x: 0.5, y: 1 }}
            onPress={marker.onPress}
          >
            {marker.children}
          </Marker>
        ))}
      </MapView>
      
      {/* Location permission denied indicator */}
      {locationPermission === false && (
        <View style={styles.permissionBanner}>
          <Text style={styles.permissionText}>Location access denied</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.mapBg },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: "600",
  },
  permissionBanner: {
    position: "absolute",
    top: 120,
    left: 16,
    right: 16,
    backgroundColor: "rgba(239,68,68,0.9)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
    zIndex: 5,
  },
  permissionText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  markerRing: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  markerDot: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#fff",
  },
  markerInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
});
