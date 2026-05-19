import React, { useMemo } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Svg, { Path, Circle, Defs, Pattern, Rect, G, Line } from "react-native-svg";
import { theme } from "../theme";

interface Point {
  lat: number;
  lng: number;
}

interface Props {
  pickup?: Point | null;
  dropoff?: Point | null;
  driver?: Point | null; // current driver position; defaults to pickup if not provided
  showRoute?: boolean;
  height?: number | "100%";
}

const { width: SCREEN_W } = Dimensions.get("window");

/**
 * Stylized map visualization (cross-platform, no API keys).
 * Translates geo coordinates into a viewBox using simple lat/lng projection.
 * Renders roads as a hand-drawn-ish network, then plots pickup/dropoff/driver markers.
 */
export default function MapView({
  pickup,
  dropoff,
  driver,
  showRoute = true,
  height = "100%",
}: Props) {
  const points = useMemo(() => {
    const all: Point[] = [];
    if (pickup) all.push(pickup);
    if (dropoff) all.push(dropoff);
    if (driver) all.push(driver);
    if (all.length === 0) {
      // Stockholm default
      all.push({ lat: 59.33, lng: 18.07 });
    }
    return all;
  }, [pickup, dropoff, driver]);

  // Project lat/lng into a 0..100 viewBox with padding.
  const projection = useMemo(() => {
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats) - 0.01;
    const maxLat = Math.max(...lats) + 0.01;
    const minLng = Math.min(...lngs) - 0.012;
    const maxLng = Math.max(...lngs) + 0.012;
    const latSpan = Math.max(maxLat - minLat, 0.02);
    const lngSpan = Math.max(maxLng - minLng, 0.024);
    return (p: Point) => ({
      x: ((p.lng - minLng) / lngSpan) * 100,
      y: 100 - ((p.lat - minLat) / latSpan) * 100, // y inverted
    });
  }, [points]);

  const pickupXY = pickup ? projection(pickup) : null;
  const dropoffXY = dropoff ? projection(dropoff) : null;
  const driverXY = driver ? projection(driver) : pickupXY;

  // Build a curvy route path between pickup & dropoff
  const routePath = useMemo(() => {
    if (!pickupXY || !dropoffXY) return "";
    const mx = (pickupXY.x + dropoffXY.x) / 2;
    const my = (pickupXY.y + dropoffXY.y) / 2;
    const cx1 = pickupXY.x + (mx - pickupXY.x) * 0.3 + 8;
    const cy1 = pickupXY.y + (my - pickupXY.y) * 0.3 - 5;
    const cx2 = dropoffXY.x - (dropoffXY.x - mx) * 0.3 - 6;
    const cy2 = dropoffXY.y - (dropoffXY.y - my) * 0.3 + 8;
    return `M ${pickupXY.x} ${pickupXY.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${dropoffXY.x} ${dropoffXY.y}`;
  }, [pickupXY, dropoffXY]);

  return (
    <View style={[styles.container, { height }]} testID="map-view">
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          <Pattern id="grid" width="8" height="8" patternUnits="userSpaceOnUse">
            <Path d="M 8 0 L 0 0 0 8" fill="none" stroke={theme.mapGrid} strokeWidth="0.3" />
          </Pattern>
        </Defs>
        {/* base */}
        <Rect width="100" height="100" fill={theme.mapBg} />
        <Rect width="100" height="100" fill="url(#grid)" />

        {/* stylized blocks (parks / water) */}
        <Rect x="6" y="62" width="22" height="16" rx="2" fill="#CFE2D0" opacity={0.55} />
        <Rect x="68" y="10" width="26" height="20" rx="2" fill="#C5DDE9" opacity={0.55} />
        <Rect x="40" y="78" width="18" height="14" rx="2" fill="#CFE2D0" opacity={0.45} />

        {/* roads */}
        <G stroke={theme.mapRoad} strokeLinecap="round">
          <Line x1="0" y1="32" x2="100" y2="38" strokeWidth="3.2" />
          <Line x1="0" y1="68" x2="100" y2="62" strokeWidth="3.2" />
          <Line x1="22" y1="0" x2="28" y2="100" strokeWidth="3" />
          <Line x1="70" y1="0" x2="76" y2="100" strokeWidth="3" />
          <Line x1="48" y1="0" x2="50" y2="100" strokeWidth="2.4" />
          <Line x1="0" y1="50" x2="100" y2="50" strokeWidth="1.6" opacity={0.6} />
          <Line x1="0" y1="14" x2="100" y2="18" strokeWidth="1.6" opacity={0.6} />
          <Line x1="0" y1="84" x2="100" y2="82" strokeWidth="1.6" opacity={0.6} />
        </G>

        {/* route */}
        {showRoute && routePath ? (
          <>
            <Path
              d={routePath}
              stroke="rgba(12, 74, 66, 0.18)"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
            />
            <Path
              d={routePath}
              stroke={theme.routeLine}
              strokeWidth="2.6"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="0.1 0"
            />
          </>
        ) : null}

        {/* markers */}
        {pickupXY ? (
          <G>
            <Circle cx={pickupXY.x} cy={pickupXY.y} r="4.2" fill={theme.primary} />
            <Circle cx={pickupXY.x} cy={pickupXY.y} r="1.6" fill="#fff" />
          </G>
        ) : null}
        {dropoffXY ? (
          <G>
            <Circle cx={dropoffXY.x} cy={dropoffXY.y} r="4.2" fill={theme.secondary} />
            <Circle cx={dropoffXY.x} cy={dropoffXY.y} r="1.6" fill="#fff" />
          </G>
        ) : null}
        {driverXY ? (
          <G>
            <Circle cx={driverXY.x} cy={driverXY.y} r="6.5" fill="rgba(20, 123, 109, 0.18)" />
            <Circle cx={driverXY.x} cy={driverXY.y} r="3.2" fill={theme.primaryActive} stroke="#fff" strokeWidth="1.1" />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    backgroundColor: theme.mapBg,
    overflow: "hidden",
  },
});
