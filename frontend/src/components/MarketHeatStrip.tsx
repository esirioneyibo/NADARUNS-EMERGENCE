import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { api } from "../api";
import { useTheme } from "../contexts/ThemeContext";

type Region = {
  region: string;
  region_name?: string;
  demand: number;
  supply: number;
  heat: { label: string; icon: string; ratio: number };
};

/**
 * Horizontal "Market Heat" strip — shows demand pressure per region so drivers
 * can chase high-demand areas and cut empty runs. Self-fetching + best-effort.
 */
export default function MarketHeatStrip() {
  const { theme } = useTheme();
  const [regions, setRegions] = useState<Region[]>([]);
  const styles = createStyles(theme);

  useEffect(() => {
    let cancelled = false;
    api
      .getMarketHeat()
      .then((d: any) => {
        if (!cancelled) setRegions((d?.regions || []).filter((r: Region) => r.demand > 0 || r.supply > 0).slice(0, 6));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!regions.length) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Market heat</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {regions.map((r) => (
          <View key={r.region} style={styles.chip}>
            <Text style={styles.chipIcon}>{r.heat.icon}</Text>
            <Text style={styles.chipRegion} numberOfLines={1}>{r.region_name || r.region}</Text>
            <Text style={styles.chipHeat}>{r.heat.label}</Text>
            <Text style={styles.chipMeta}>{r.demand} jobs · {r.supply} drivers</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    wrap: { marginTop: 12 },
    title: { fontSize: 13, fontWeight: "800", color: theme.text, marginBottom: 8 },
    row: { gap: 10, paddingRight: 8 },
    chip: { backgroundColor: theme.surface, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, minWidth: 118, borderWidth: 1, borderColor: theme.border },
    chipIcon: { fontSize: 18 },
    chipRegion: { fontSize: 13.5, fontWeight: "800", color: theme.text, marginTop: 2 },
    chipHeat: { fontSize: 12.5, fontWeight: "700", color: theme.primary, marginTop: 1 },
    chipMeta: { fontSize: 11, color: theme.textSecondary, marginTop: 2 },
  });
