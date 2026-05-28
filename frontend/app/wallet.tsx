import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";

import { api } from "../src/api";
import type { Wallet, WalletTransaction } from "../src/types";
import { radius, shadows, spacing, theme } from "../src/theme";
import { useAuth } from "../src/contexts/AuthContext";

function formatDate(iso?: string | null) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function txnIcon(t: WalletTransaction["type"]): keyof typeof Ionicons.glyphMap {
  if (t === "tip") return "gift-outline";
  if (t === "payout") return "card-outline";
  if (t === "bonus") return "trophy-outline";
  return "cube-outline";
}

export default function WalletScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setError("Please login to view your wallet");
      return;
    }
    try {
      setError(null);
      const w = await api.getWallet();
      setWallet(w);
    } catch (e: any) {
      console.warn("wallet load failed", e);
      setError(e.message || "Failed to load wallet");
    }
  }, [isAuthenticated]);

  useFocusEffect(useCallback(() => { 
    if (!authLoading) {
      load(); 
    }
  }, [load, authLoading]));

  // Show loading while auth is initializing
  if (authLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  // Show error if not authenticated
  if (error || !isAuthenticated) {
    return (
      <View style={[styles.loading, { paddingHorizontal: spacing.xl }]}>
        <Ionicons name="wallet-outline" size={64} color={theme.textSecondary} />
        <Text style={styles.errorText}>{error || "Please login to view your wallet"}</Text>
        <TouchableOpacity 
          style={styles.loginBtn} 
          onPress={() => router.push("/login")}
        >
          <Text style={styles.loginBtnText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!wallet) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="wallet-screen">
      <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
        <TouchableOpacity
          style={[styles.iconBtn, shadows.sm]}
          onPress={() => router.back()}
          testID="wallet-back-button"
        >
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>Wallet</Text>
        <View style={{ width: 44 }} />
      </Animated.View>

      <FlatList
        data={wallet.transactions}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 40 }}
        ListHeaderComponent={() => (
          <>
            <Animated.View entering={FadeInUp.delay(80)} style={[styles.balanceCard, shadows.lg]}>
              <Text style={styles.balanceLabel}>Available balance</Text>
              <Text style={styles.balanceAmount} testID="wallet-balance">
                €{wallet.available_balance.toFixed(2)}
              </Text>
              <View style={styles.pendingRow}>
                <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.65)" />
                <Text style={styles.pendingText}>
                  €{wallet.pending_balance.toFixed(2)} pending · clears in 48h
                </Text>
              </View>

              <TouchableOpacity style={styles.payoutBtn} testID="cash-out-button">
                <Ionicons name="cash-outline" size={18} color={theme.primary} />
                <Text style={styles.payoutBtnText}>Cash out now</Text>
              </TouchableOpacity>
            </Animated.View>

            <Animated.View entering={FadeInUp.delay(140)} style={[styles.payoutInfoCard, shadows.sm]}>
              <View style={styles.payoutInfoRow}>
                <Ionicons name="calendar-outline" size={20} color={theme.primary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.payoutSchedule}>{wallet.payout_schedule}</Text>
                  <Text style={styles.payoutNext}>Next payout: {wallet.next_payout_date}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              </View>
            </Animated.View>

            <Text style={styles.sectionTitle}>RECENT ACTIVITY</Text>
          </>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="wallet-outline" size={48} color={theme.textSecondary} />
            <Text style={styles.emptyText}>No transactions yet</Text>
          </View>
        )}
        renderItem={({ item, index }) => (
          <Animated.View
            entering={FadeInUp.delay(160 + index * 30).duration(280)}
            style={[styles.txnCard, shadows.sm]}
            testID={`txn-${index}`}
          >
            <View style={[styles.txnIcon, item.amount < 0 && styles.txnIconNeg]}>
              <Ionicons
                name={txnIcon(item.type)}
                size={18}
                color={item.amount < 0 ? theme.textSecondary : theme.primary}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.txnDesc} numberOfLines={1}>{item.description}</Text>
              <Text style={styles.txnTime}>{formatDate(item.timestamp)}</Text>
            </View>
            <Text style={[styles.txnAmount, item.amount < 0 && { color: theme.textSecondary }]}>
              {item.amount >= 0 ? "+" : "-"}€{Math.abs(item.amount).toFixed(2)}
            </Text>
          </Animated.View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 20, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.3 },
  balanceCard: { backgroundColor: theme.primary, borderRadius: radius.xxl, padding: spacing.xl, alignItems: "center" },
  balanceLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 },
  balanceAmount: { color: "#fff", fontSize: 48, fontWeight: "900", letterSpacing: -1.5, marginTop: 8 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  pendingText: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600" },
  payoutBtn: { marginTop: spacing.lg, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", paddingHorizontal: 22, paddingVertical: 14, borderRadius: radius.pill },
  payoutBtnText: { color: theme.primary, fontWeight: "800", fontSize: 15 },
  payoutInfoCard: { marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg },
  payoutInfoRow: { flexDirection: "row", alignItems: "center" },
  payoutSchedule: { fontSize: 15, fontWeight: "700", color: theme.textPrimary },
  payoutNext: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
  sectionTitle: { fontSize: 11, fontWeight: "800", color: theme.textSecondary, letterSpacing: 1.2, marginTop: spacing.xxl, marginBottom: spacing.md, paddingHorizontal: 4 },
  txnCard: { flexDirection: "row", alignItems: "center", backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md },
  txnIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.primaryLight, alignItems: "center", justifyContent: "center" },
  txnIconNeg: { backgroundColor: theme.surfaceMuted },
  txnDesc: { fontSize: 14, fontWeight: "600", color: theme.textPrimary },
  txnTime: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
  txnAmount: { fontSize: 16, fontWeight: "800", color: theme.primary },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 80, gap: 12 },
  emptyText: { color: theme.textSecondary, fontSize: 14 },
  errorText: { color: theme.textSecondary, fontSize: 16, textAlign: "center", marginTop: spacing.lg },
  loginBtn: { marginTop: spacing.xl, backgroundColor: theme.primary, paddingHorizontal: 32, paddingVertical: 14, borderRadius: radius.pill },
  loginBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
