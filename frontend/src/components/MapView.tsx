import React from "react";
import { Platform } from "react-native";
import SvgMapView from "./SvgMapView";
import NativeMapView from "./NativeMapView";

interface Point {
  lat: number;
  lng: number;
}

export interface MapProps {
  pickup?: Point | null;
  dropoff?: Point | null;
  driver?: Point | null;
  routePoints?: Point[] | null;
  showRoute?: boolean;
  height?: number | "100%";
}

/**
 * Cross-platform map.
 * - iOS / Android: native Google Maps via react-native-maps
 * - Web: stylized SVG fallback (react-native-maps doesn't render on web)
 */
export default function MapView(props: MapProps) {
  if (Platform.OS === "web") {
    return <SvgMapView {...props} />;
  }
  return <NativeMapView {...props} />;
}
