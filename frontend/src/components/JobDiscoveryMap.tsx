import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";
import * as Location from "expo-location";
import { Order } from "../types";
import JobMarker from "./JobMarker";
import { theme } from "../theme";

interface Point {
  lat: number;
  lng: number;
}

interface ClusteredLocation {
  key: string;
  lat: number;
  lng: number;
  orders: Order[];
  totalEarnings: number;
}

interface Props {
  orders: Order[];
  onMarkerPress: (orders: Order[]) => void;
  selectedOrderIds?: string[];
  height?: number | "100%";
}

/**
 * Map view for job discovery.
 * Clusters orders at the same location and shows custom markers with count badges.
 */
export default function JobDiscoveryMap({
  orders,
  onMarkerPress,
  selectedOrderIds = [],
  height = "100%",
}: Props) {
  const mapRef = useRef<MapView | null>(null);
  const [userLocation, setUserLocation] = useState<Point | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);

  // Request location permission and start tracking
  useEffect(() => {
    let isMounted = true;

    const startLocationTracking = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        
        if (status !== "granted") {
          if (isMounted) {
            setIsLoading(false);
          }
          return;
        }

        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
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
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 10000,
            distanceInterval: 50,
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

    return () => {
      isMounted = false;
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
    };
  }, []);

  // Cluster orders by location (same lat/lng = same cluster)
  const clusteredLocations = useMemo(() => {
    const clusters = new Map<string, ClusteredLocation>();
    
    for (const order of orders) {
      // Round to 4 decimal places (~11m accuracy) for clustering
      const lat = Math.round(order.pickup.lat * 10000) / 10000;
      const lng = Math.round(order.pickup.lng * 10000) / 10000;
      const key = `${lat},${lng}`;
      
      if (clusters.has(key)) {
        const cluster = clusters.get(key)!;
        cluster.orders.push(order);
        cluster.totalEarnings += order.earnings;
      } else {
        clusters.set(key, {
          key,
          lat,
          lng,
          orders: [order],
          totalEarnings: order.earnings,
        });
      }
    }
    
    return Array.from(clusters.values());
  }, [orders]);

  // Fit map to show all markers when orders change
  useEffect(() => {
    if (!mapRef.current || clusteredLocations.length === 0) return;

    const coords = clusteredLocations.map((c) => ({
      latitude: c.lat,
      longitude: c.lng,
    }));

    // Include user location
    if (userLocation) {
      coords.push({
        latitude: userLocation.lat,
        longitude: userLocation.lng,
      });
    }

    if (coords.length >= 1) {
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 100, right: 50, bottom: 400, left: 50 },
          animated: true,
        });
      }, 500);
    }
  }, [clusteredLocations, userLocation]);

  const handleMarkerPress = useCallback((cluster: ClusteredLocation) => {
    onMarkerPress(cluster.orders);
    
    // Animate to the marker
    mapRef.current?.animateToRegion({
      latitude: cluster.lat,
      longitude: cluster.lng,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }, 300);
  }, [onMarkerPress]);

  const initialRegion: Region = userLocation
    ? {
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : {
        latitude: 60.1699,
        longitude: 24.9384,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      };

  // For web, show a placeholder
  if (Platform.OS === "web") {
    return (
      <View style={[styles.container, { height }]}>
        <View style={styles.webPlaceholder}>
          <Text style={styles.webPlaceholderText}>
            Map view available on mobile app
          </Text>
          <Text style={styles.webPlaceholderSubtext}>
            {orders.length} jobs available
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>Finding nearby jobs...</Text>
        </View>
      )}

      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        showsCompass={false}
        showsMyLocationButton={false}
        showsUserLocation={true}
        followsUserLocation={false}
        toolbarEnabled={false}
        mapPadding={{ top: 0, right: 0, bottom: 350, left: 0 }}
      >
        {clusteredLocations.map((cluster) => {
          const isSelected = cluster.orders.some((o) =>
            selectedOrderIds.includes(o.id)
          );

          return (
            <Marker
              key={cluster.key}
              coordinate={{
                latitude: cluster.lat,
                longitude: cluster.lng,
              }}
              anchor={{ x: 0.5, y: 1 }}
              onPress={() => handleMarkerPress(cluster)}
            >
              <JobMarker
                count={cluster.orders.length}
                earnings={cluster.totalEarnings / cluster.orders.length}
                isSelected={isSelected}
              />
            </Marker>
          );
        })}
      </MapView>

      {/* Job count badge */}
      <View style={styles.jobCountBadge}>
        <Text style={styles.jobCountText}>
          {orders.length} job{orders.length !== 1 ? "s" : ""} nearby
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.mapBg,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.95)",
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
  jobCountBadge: {
    position: "absolute",
    top: 100,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  jobCountText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  webPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
  },
  webPlaceholderText: {
    fontSize: 16,
    color: "#6B7280",
    fontWeight: "600",
  },
  webPlaceholderSubtext: {
    fontSize: 14,
    color: "#9CA3AF",
    marginTop: 8,
  },
});
