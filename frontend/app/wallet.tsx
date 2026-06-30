import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { useTranslation } from "react-i18next";

import i18n from "../src/i18n";
import { api } from "../src/api";
import type { DriverWallet, WithdrawalItem } from "../src/types";
import { radius, shadows, spacing, theme } from "../src/theme";
import { useAuth } from "../src/contexts/AuthContext";

function formatDate(iso?: string | null) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const locale = i18n.language === "fi" ? "fi-FI" : "en-US";
    return d.toLocaleDateString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

const STATUS_META: Record<WithdrawalItem["status"], { color: string; bg: string; label: string }> = {
  pending: { color: "#b45309", bg: "#fef3c7", label: "wallet.status.pending" },
  approved: { color: "#1d4ed8", bg: "#dbeafe", label: "wallet.status.approved" },
  paid: { color: "#15803d", bg: "#dcfce7", label: "wallet.status.paid" },
  rejected: { color: "#b91c1c", bg: "#fee2e2", label: "wallet.status.rejected" },
};

export default function WalletScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [wallet, setWallet] = useState<DriverWallet | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [savedIban, setSavedIban] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setError(t("wallet.loginPrompt"));
      return;
    }
    try {
      setError(null);
      const w = await api.getDriverWallet();
      setWallet(w);
      // Prefill cash-out IBAN from saved bank details (set once on first load).
      try {
        const d = await api.getDriver();
        const iban = d.bank_details?.iban || null;
        setSavedIban(iban);
        if (iban) setAccount((prev) => prev || iban);
      } catch {}
    } catch (e: any) {
      console.warn("wallet load failed", e);
      setError(e.message || t("wallet.loadError"));
    }
  }, [isAuthenticated]);

  useFocusEffect(useCallback(() => {
    if (!authLoading) load();
  }, [load, authLoading]));

  const submitWithdraw = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setBanner({ kind: "error", text: t("wallet.enterValidAmount") });
      return;
    }
    if (wallet && amt > wallet.available_balance) {
      setBanner({ kind: "error", text: t("wallet.maxAvailable", { max: wallet.available_balance.toFixed(2) }) });
      return;
    }
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await api.requestWithdrawal({ amount: amt, method: "bank_transfer", account_details: account || undefined });
      setWallet((prev) => prev ? { ...prev, ...res } : prev);
      // Persist the IBAN so it's pre-filled next time (no re-typing).
      const cleanIban = account.trim().replace(/\s+/g, "").toUpperCase();
      if (cleanIban && cleanIban !== savedIban) {
        try { await api.updateDriver({ bank_details: { iban: cleanIban } }); setSavedIban(cleanIban); } catch {}
      }
      setModalOpen(false);
      setAmount("");
      setBanner({ kind: "success", text: t("wallet.cashOutRequested", { amount: amt.toFixed(2) }) });
      await load();
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message || t("wallet.cashOutFailed") });
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return <View style={styles.loading}><ActivityIndicator color={theme.primary} size="large" /></View>;
  }

  if (error || !isAuthenticated) {
    return (
      <View style={[styles.loading, { paddingHorizontal: spacing.xl }]}>
        <Ionicons name="wallet-outline" size={64} color={theme.textSecondary} />
        <Text style={styles.errorText}>{error || t("wallet.loginPrompt")}</Text>
        <TouchableOpacity style={styles.loginBtn} onPress={() => router.push("/login")}>
          <Text style={styles.loginBtnText}>{t("common.goToLogin")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!wallet) {
    return <View style={styles.loading}><ActivityIndicator color={theme.primary} size="large" /></View>;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="wallet-screen">
      <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
        <TouchableOpacity style={[styles.iconBtn, shadows.sm]} onPress={() => router.back()} testID="wallet-back-button">
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>{t("wallet.title")}</Text>
        <View style={{ width: 44 }} />
      </Animated.View>

      {banner && (
        <View style={[styles.banner, banner.kind === "success" ? styles.bannerOk : styles.bannerErr]}>
          <Ionicons name={banner.kind === "success" ? "checkmark-circle" : "alert-circle"} size={18} color="#fff" />
          <Text style={styles.bannerText}>{banner.text}</Text>
        </View>
      )}

      <FlatList
        data={wallet.earnings}
        keyExtractor={(t, i) => `${t.order_id}-${i}`}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 40 }}
        ListHeaderComponent={() => (
          <>
            <Animated.View entering={FadeInUp.delay(80)} style={[styles.balanceCard, shadows.lg]}>
              <Text style={styles.balanceLabel}>{t("wallet.availableBalance")}</Text>
              <Text style={styles.balanceAmount} testID="wallet-balance">€{wallet.available_balance.toFixed(2)}</Text>
              <View style={styles.pendingRow}>
                <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.65)" />
                <Text style={styles.pendingText}>{t("wallet.pendingClears", { amount: wallet.pending_balance.toFixed(2) })}</Text>
              </View>
              <TouchableOpacity
                style={[styles.payoutBtn, wallet.available_balance < 10 && { opacity: 0.5 }]}
                disabled={wallet.available_balance < 10}
                onPress={() => { setBanner(null); setModalOpen(true); }}
                testID="cash-out-button"
              >
                <Ionicons name="cash-outline" size={18} color={theme.primary} />
                <Text style={styles.payoutBtnText}>{t("wallet.cashOutNow")}</Text>
              </TouchableOpacity>
            </Animated.View>

            <View style={styles.statsRow}>
              <View style={[styles.statCard, shadows.sm]}>
                <Text style={styles.statValue}>€{wallet.total_earned.toFixed(2)}</Text>
                <Text style={styles.statLabel}>{t("wallet.totalEarned")}</Text>
              </View>
              <View style={[styles.statCard, shadows.sm]}>
                <Text style={styles.statValue}>€{wallet.total_withdrawn.toFixed(2)}</Text>
                <Text style={styles.statLabel}>{t("wallet.withdrawn")}</Text>
              </View>
            </View>

            {wallet.withdrawals.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t("wallet.cashOutRequests")}</Text>
                {wallet.withdrawals.map((w) => {
                  const m = STATUS_META[w.status];
                  return (
                    <View key={w.id} style={[styles.txnCard, shadows.sm]} testID={`withdrawal-${w.id}`}>
                      <View style={[styles.txnIcon]}>
                        <Ionicons name="card-outline" size={18} color={theme.primary} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.txnDesc}>€{w.amount.toFixed(2)} · {w.method.replace("_", " ")}</Text>
                        <Text style={styles.txnTime}>{formatDate(w.requested_at)}{w.reference ? ` · ${w.reference}` : ""}</Text>
                      </View>
                      <View style={[styles.statusChip, { backgroundColor: m.bg }]}>
                        <Text style={[styles.statusChipText, { color: m.color }]}>{t(m.label)}</Text>
                      </View>
                    </View>
                  );
                })}
              </>
            )}

            <Text style={styles.sectionTitle}>{t("wallet.deliveryEarnings")}</Text>
          </>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={48} color={theme.textSecondary} />
            <Text style={styles.emptyText}>{t("wallet.noPaidDeliveries")}</Text>
          </View>
        )}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInUp.delay(120 + index * 25).duration(260)} style={[styles.txnCard, shadows.sm]} testID={`earning-${index}`}>
            <View style={styles.txnIcon}>
              <Ionicons name="cube-outline" size={18} color={theme.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.txnDesc} numberOfLines={1}>{item.order_number || t("wallet.delivery")}</Text>
              <Text style={styles.txnTime}>{formatDate(item.created_at)} · {t("wallet.feeLabel", { fee: item.commission_amount.toFixed(2) })}</Text>
            </View>
            <Text style={styles.txnAmount}>+€{item.amount.toFixed(2)}</Text>
          </Animated.View>
        )}
      />

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalRoot}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t("wallet.cashOut")}</Text>
            <Text style={styles.sheetSub}>{t("wallet.availableMin", { available: wallet.available_balance.toFixed(2) })}</Text>

            <Text style={styles.inputLabel}>{t("wallet.amountEur")}</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={theme.textSecondary}
              testID="withdraw-amount-input"
            />
            <Text style={styles.inputLabel}>{t("wallet.bankIban")}</Text>
            <TextInput
              style={styles.input}
              value={account}
              onChangeText={setAccount}
              placeholder="FI00 0000 0000 0000"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="characters"
              testID="withdraw-account-input"
            />
            {savedIban && account.trim().replace(/\s+/g, "").toUpperCase() === savedIban.toUpperCase() ? (
              <Text style={styles.savedHint}>{t("wallet.usingSavedBank", { defaultValue: "Using your saved bank account" })}</Text>
            ) : null}

            <TouchableOpacity
              style={[styles.confirmBtn, submitting && { opacity: 0.6 }]}
              onPress={submitWithdraw}
              disabled={submitting}
              testID="withdraw-confirm-button"
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmBtnText}>{t("wallet.requestCashOut")}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalOpen(false)} disabled={submitting}>
              <Text style={styles.cancelBtnText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 20, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.3 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: spacing.xl, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  bannerOk: { backgroundColor: "#16a34a" },
  bannerErr: { backgroundColor: "#dc2626" },
  bannerText: { color: "#fff", fontWeight: "700", fontSize: 13, flex: 1 },
  balanceCard: { backgroundColor: theme.primary, borderRadius: radius.xxl, padding: spacing.xl, alignItems: "center" },
  balanceLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 },
  balanceAmount: { color: "#fff", fontSize: 48, fontWeight: "900", letterSpacing: -1.5, marginTop: 8 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  pendingText: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600" },
  payoutBtn: { marginTop: spacing.lg, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", paddingHorizontal: 22, paddingVertical: 14, borderRadius: radius.pill },
  payoutBtnText: { color: theme.primary, fontWeight: "800", fontSize: 15 },
  statsRow: { flexDirection: "row", gap: 12, marginTop: spacing.lg },
  statCard: { flex: 1, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "900", color: theme.textPrimary, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: theme.textSecondary, marginTop: 4, fontWeight: "600" },
  sectionTitle: { fontSize: 11, fontWeight: "800", color: theme.textSecondary, letterSpacing: 1.2, marginTop: spacing.xxl, marginBottom: spacing.md, paddingHorizontal: 4 },
  txnCard: { flexDirection: "row", alignItems: "center", backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: 8 },
  txnIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.primaryLight, alignItems: "center", justifyContent: "center" },
  txnDesc: { fontSize: 14, fontWeight: "600", color: theme.textPrimary },
  txnTime: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
  txnAmount: { fontSize: 16, fontWeight: "800", color: theme.primary },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  statusChipText: { fontSize: 11, fontWeight: "800" },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  emptyText: { color: theme.textSecondary, fontSize: 14 },
  errorText: { color: theme.textSecondary, fontSize: 16, textAlign: "center", marginTop: spacing.lg },
  loginBtn: { marginTop: spacing.xl, backgroundColor: theme.primary, paddingHorizontal: 32, paddingVertical: 14, borderRadius: radius.pill },
  loginBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: theme.background, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: spacing.xl },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border, marginBottom: spacing.lg },
  sheetTitle: { fontSize: 22, fontWeight: "900", color: theme.textPrimary, letterSpacing: -0.5 },
  sheetSub: { fontSize: 13, color: theme.textSecondary, marginTop: 4, marginBottom: spacing.lg },
  inputLabel: { fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginTop: spacing.md, marginBottom: 6 },
  savedHint: { fontSize: 12, color: theme.primary, fontWeight: "700", marginTop: 8 },
  input: { backgroundColor: theme.surface, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: theme.textPrimary, borderWidth: 1, borderColor: theme.border },
  confirmBtn: { marginTop: spacing.xl, backgroundColor: theme.primary, paddingVertical: 16, borderRadius: radius.pill, alignItems: "center" },
  confirmBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  cancelBtn: { marginTop: spacing.md, paddingVertical: 12, alignItems: "center" },
  cancelBtnText: { color: theme.textSecondary, fontWeight: "700", fontSize: 14 },
});
