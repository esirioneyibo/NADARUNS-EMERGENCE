import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useTranslation } from "react-i18next";

import { api } from "../src/api";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

const ACCENT = "#6366F1";

const BRAND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  visa: "card",
  mastercard: "card",
  amex: "card",
  discover: "card",
};

interface CardPM {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
}

export default function ShipperPaymentMethodsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(theme);

  const [cards, setCards] = useState<CardPM[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getPaymentMethods();
      setCards(res.payment_methods || []);
    } catch (e) {
      console.warn("load payment methods error", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const addCard = async () => {
    setAdding(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const origin = window.location.origin;
        const back = `${origin}/shipper-payment-methods`;
        const { url } = await api.createSetupCheckout({
          success_url: `${back}?saved=1`,
          cancel_url: `${back}?cancelled=1`,
        });
        window.location.href = url;
        return;
      }
      const returnUrl = Linking.createURL("shipper-payment-methods");
      const base = process.env.EXPO_PUBLIC_BACKEND_URL;
      const { url } = await api.createSetupCheckout({
        success_url: `${base}/api/payments/return?status=success&redirect=${encodeURIComponent(returnUrl)}`,
        cancel_url: `${base}/api/payments/return?status=cancel&redirect=${encodeURIComponent(returnUrl)}`,
      });
      await WebBrowser.openAuthSessionAsync(url, returnUrl);
      await load();
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || t("paymentMethods.addError"));
    } finally {
      setAdding(false);
    }
  };

  const makeDefault = async (id: string) => {
    setBusyId(id);
    Haptics.selectionAsync().catch(() => {});
    try {
      await api.setDefaultPaymentMethod(id);
      await load();
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || t("paymentMethods.defaultError"));
    } finally {
      setBusyId(null);
    }
  };

  const removeCard = (card: CardPM) => {
    const doDelete = async () => {
      setBusyId(card.id);
      try {
        await api.deletePaymentMethod(card.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        await load();
      } catch (e: any) {
        Alert.alert(t("common.error"), e?.message || t("paymentMethods.deleteError"));
      } finally {
        setBusyId(null);
      }
    };
    const label = `${card.brand.toUpperCase()} •••• ${card.last4}`;
    if (typeof window !== "undefined" && (window as any).confirm) {
      if ((window as any).confirm(t("paymentMethods.deleteConfirm", { card: label }))) doDelete();
    } else {
      Alert.alert(t("paymentMethods.deleteTitle"), t("paymentMethods.deleteConfirm", { card: label }), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: doDelete },
      ]);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="payment-methods-back">
          <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("paymentMethods.title")}</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingHorizontal: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.subtitle}>{t("paymentMethods.subtitle")}</Text>

        {loading ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}>
            <ActivityIndicator size="large" color={ACCENT} />
          </View>
        ) : cards.length === 0 ? (
          <Animated.View entering={FadeInUp.duration(260)} style={[styles.emptyCard, shadows.sm]}>
            <Ionicons name="card-outline" size={36} color={theme.textSecondary} />
            <Text style={styles.emptyTitle}>{t("paymentMethods.emptyTitle")}</Text>
            <Text style={styles.emptySub}>{t("paymentMethods.emptySub")}</Text>
          </Animated.View>
        ) : (
          cards.map((card, i) => (
            <Animated.View
              key={card.id}
              entering={FadeInUp.delay(i * 50).duration(240)}
              style={[styles.cardRow, shadows.sm]}
              testID={`payment-method-${card.id}`}
            >
              <View style={styles.cardIcon}>
                <Ionicons name={BRAND_ICON[card.brand] || "card"} size={22} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardBrand}>
                  {card.brand.charAt(0).toUpperCase() + card.brand.slice(1)} •••• {card.last4}
                </Text>
                <Text style={styles.cardExp}>
                  {t("paymentMethods.expires")} {String(card.exp_month).padStart(2, "0")}/{String(card.exp_year).slice(-2)}
                </Text>
              </View>
              {card.is_default ? (
                <View style={styles.defaultBadge}>
                  <Ionicons name="checkmark-circle" size={13} color="#fff" />
                  <Text style={styles.defaultBadgeText}>{t("paymentMethods.default")}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.makeDefaultBtn}
                  onPress={() => makeDefault(card.id)}
                  disabled={busyId === card.id}
                  testID={`payment-method-default-${card.id}`}
                >
                  {busyId === card.id ? (
                    <ActivityIndicator size="small" color={ACCENT} />
                  ) : (
                    <Text style={styles.makeDefaultText}>{t("paymentMethods.makeDefault")}</Text>
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => removeCard(card)}
                disabled={busyId === card.id}
                testID={`payment-method-delete-${card.id}`}
              >
                <Ionicons name="trash-outline" size={18} color="#EF4444" />
              </TouchableOpacity>
            </Animated.View>
          ))
        )}

        <TouchableOpacity
          style={[styles.addBtn, adding && { opacity: 0.7 }]}
          onPress={addCard}
          disabled={adding}
          testID="payment-methods-add"
        >
          {adding ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="add-circle-outline" size={22} color="#fff" />
              <Text style={styles.addBtnText}>{t("paymentMethods.addCard")}</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.secureRow}>
          <Ionicons name="lock-closed" size={13} color={theme.textSecondary} />
          <Text style={styles.secureText}>{t("paymentMethods.securedByStripe")}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { fontSize: 18, fontWeight: "700", color: theme.textPrimary },
    subtitle: { fontSize: 14, color: theme.textSecondary, marginBottom: spacing.lg, marginTop: spacing.xs },
    emptyCard: {
      backgroundColor: theme.surface,
      borderRadius: radius.xl,
      padding: spacing.xl,
      alignItems: "center",
      gap: 6,
    },
    emptyTitle: { fontSize: 16, fontWeight: "700", color: theme.textPrimary, marginTop: 6 },
    emptySub: { fontSize: 13, color: theme.textSecondary, textAlign: "center" },
    cardRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.surface,
      borderRadius: radius.xl,
      padding: spacing.md,
      marginBottom: spacing.md,
      gap: 12,
    },
    cardIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: ACCENT,
      alignItems: "center",
      justifyContent: "center",
    },
    cardBrand: { fontSize: 15, fontWeight: "700", color: theme.textPrimary },
    cardExp: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
    defaultBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: "#10B981",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    defaultBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
    makeDefaultBtn: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1.5,
      borderColor: ACCENT,
    },
    makeDefaultText: { color: ACCENT, fontSize: 12, fontWeight: "700" },
    deleteBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: "rgba(239,68,68,0.1)",
      alignItems: "center",
      justifyContent: "center",
    },
    addBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: ACCENT,
      paddingVertical: 16,
      borderRadius: radius.lg,
      marginTop: spacing.md,
      gap: 8,
    },
    addBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
    secureRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginTop: spacing.lg,
    },
    secureText: { fontSize: 12, color: theme.textSecondary },
  });
