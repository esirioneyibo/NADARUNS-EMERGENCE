import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { theme } from "../theme";

interface Point {
  lat: number;
  lng: number;
}

interface Props {
  pickup?: Point | null;
  dropoff?: Point | null;
  driver?: Point | null;
  routePoints?: Point[] | null;
  showRoute?: boolean;
  height?: number | "100%";
}

/**
 * Native Google Maps view (iOS / Android).
 * Renders pickup + dropoff markers, the driver marker, and a polyline route.
 * The polyline is fetched by the parent from /api/orders/{id}/route (Google Directions).
 */
export default function NativeMapView({
  pickup,
  dropoff,
  driver,
  routePoints,
  showRoute = true,
}: Props) {
  const mapRef = useRef<MapView | null>(null);

  const toLatLng = (p?: Point | null) =>
    p ? { latitude: p.lat, longitude: p.lng } : null;

  const pickupLL = toLatLng(pickup);
  const dropoffLL = toLatLng(dropoff);
  const driverLL = toLatLng(driver) || pickupLL;
  const routeLL = (routePoints || []).map((p) => ({ latitude: p.lat, longitude: p.lng }));

  useEffect(() => {
    if (!mapRef.current) return;
    const coords = routeLL.length > 1 ? routeLL : [pickupLL, dropoffLL].filter(Boolean) as { latitude: number; longitude: number }[];
    if (coords.length < 2) return;
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 120, right: 60, bottom: 360, left: 60 },
        animated: true,
      });
    }, 400);
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, routePoints?.length]);

  const initialRegion = pickupLL
    ? { latitude: pickupLL.latitude, longitude: pickupLL.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : { latitude: 59.33, longitude: 18.07, latitudeDelta: 0.1, longitudeDelta: 0.1 };

  return (
    <View style={styles.container} testID="map-view">
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
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

        {pickupLL ? (
          <Marker coordinate={pickupLL} anchor={{ x: 0.5, y: 0.5 }} identifier="pickup">
            <View style={[styles.markerRing, { backgroundColor: "rgba(12,74,66,0.18)" }]}>
              <View style={[styles.markerDot, { backgroundColor: theme.primary }]}>
                <View style={styles.markerInner} />
              </View>
            </View>
          </Marker>
        ) : null}

        {dropoffLL ? (
          <Marker coordinate={dropoffLL} anchor={{ x: 0.5, y: 0.5 }} identifier="dropoff">
            <View style={[styles.markerRing, { backgroundColor: "rgba(15,23,42,0.18)" }]}>
              <View style={[styles.markerDot, { backgroundColor: theme.secondary }]}>
                <View style={styles.markerInner} />
              </View>
            </View>
          </Marker>
        ) : null}

        {driverLL ? (
          <Marker coordinate={driverLL} anchor={{ x: 0.5, y: 0.5 }} identifier="driver">
            <View style={[styles.markerRing, { backgroundColor: "rgba(20,123,109,0.22)", width: 32, height: 32 }]}>
              <View style={[styles.markerDot, { backgroundColor: theme.primaryActive, width: 18, height: 18, borderRadius: 9 }]} />
            </View>
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.mapBg },
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
