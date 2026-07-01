import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";

import { api } from "../src/api";
import { Driver, PayoutItem, PayoutDocument, BankDetails } from "../src/types";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

function maskIban(iban?: string | null): string {
  if (!iban) return "•••• •••• •••• ••••";
  const clean = iban.replace(/\s+/g, "");
  const last4 = clean.slice(-4);
  return `•••• •••• •••• ${last4 || "••••"}`;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export default function DriverPayoutsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(theme);

  const [driver, setDriver] = useState<Driver | null>(null);
  const [payouts, setPayouts] = useState<PayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ msg: string; ok: boolean } | null>(null);

  // Bank form state
  const [accountHolder, setAccountHolder] = useState("");
  const [iban, setIban] = useState("");
  const [bankName, setBankName] = useState("");
  const [swiftBic, setSwiftBic] = useState("");

  const hydrateForm = (b?: BankDetails | null) => {
    setAccountHolder(b?.account_holder || "");
    setIban(b?.iban || "");
    setBankName(b?.bank_name || "");
    setSwiftBic(b?.swift_bic || "");
  };

  const load = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([api.getDriver(), api.getPayouts()]);
      setDriver(d);
      hydrateForm(d.bank_details);
      setPayouts(p.payouts || []);
    } catch (e) {
      console.warn("payouts load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const flash = (msg: string, ok = true) => {
    setBanner({ msg, ok });
    setTimeout(() => setBanner(null), 2600);
  };

  const hasBank = !!(driver?.bank_details?.iban || driver?.bank_details?.account_holder);

  const startEdit = () => {
    Haptics.selectionAsync().catch(() => {});
    hydrateForm(driver?.bank_details);
    setEditing(true);
  };

  const cancelEdit = () => {
    hydrateForm(driver?.bank_details);
    setEditing(false);
  };

  const saveBank = async () => {
    if (!accountHolder.trim()) { flash(t("payouts.holderRequired"), false); return; }
    if (!iban.trim()) { flash(t("payouts.ibanRequired"), false); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSaving(true);
    try {
      const updated = await api.updateDriver({
        bank_details: {
          account_holder: accountHolder.trim() || null,
          iban: iban.trim().replace(/\s+/g, "").toUpperCase() || null,
          bank_name: bankName.trim() || null,
          swift_bic: swiftBic.trim().toUpperCase() || null,
        },
      });
      setDriver(updated);
      hydrateForm(updated.bank_details);
      setEditing(false);
      flash(t("payouts.saved"));
    } catch (e) {
      flash(t("payouts.saveFailed"), false);
    } finally {
      setSaving(false);
    }
  };

  const openPdf = async (doc: PayoutDocument) => {
    Haptics.selectionAsync().catch(() => {});
    try {
      const url = api.receiptPdfUrl(doc.id);
      await Linking.openURL(url);
    } catch (e) {
      flash(t("payouts.pdfFailed"), false);
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "paid": return theme.success;
      case "approved": return theme.primaryActive;
      case "rejected": return theme.error;
      default: return theme.warning; // pending
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={[styles.iconBtn, shadows.sm]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>{t("payouts.title")}</Text>
        <View style={{ width: 44 }} />
      </View>

      {banner && (
        <View style={[styles.banner, { backgroundColor: banner.ok ? theme.success : theme.error }]}>
          <Ionicons name={banner.ok ? "checkmark-circle" : "alert-circle"} size={16} color="#fff" />
          <Text style={styles.bannerText}>{banner.msg}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loading}><ActivityIndicator size="large" color={theme.primary} /></View>
      ) : (
        <KeyboardAwareScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 60 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bottomOffset={20}
        >
          {/* Payout account — bank card visual */}
          <Text style={styles.sectionTitle}>{t("payouts.payoutAccount")}</Text>

          <LinearGradient
            colors={[theme.primaryActive, theme.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.bankCard, shadows.lg]}
          >
            <View style={styles.bankCardTop}>
              <View style={styles.chip} />
              <Ionicons name="wifi" size={20} color="rgba(255,255,255,0.65)" style={{ transform: [{ rotate: "90deg" }] }} />
            </View>

            <Text style={styles.bankCardNumber}>{maskIban(driver?.bank_details?.iban)}</Text>

            <View style={styles.bankCardBottom}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bankCardLabel}>{t("payouts.accountHolder")}</Text>
                <Text style={styles.bankCardValue} numberOfLines={1}>
                  {driver?.bank_details?.account_holder || t("payouts.notSet")}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.bankCardLabel}>{t("payouts.bank")}</Text>
                <Text style={styles.bankCardValue} numberOfLines={1}>
                  {driver?.bank_details?.bank_name || "—"}
                </Text>
              </View>
            </View>

            <Text style={styles.bankCardBrand}>NADARUNS · PAYOUT</Text>
          </LinearGradient>

          {!editing && (
            <TouchableOpacity style={styles.editRow} onPress={startEdit} activeOpacity={0.85}>
              <Ionicons name={hasBank ? "create-outline" : "add-circle-outline"} size={18} color={theme.primary} />
              <Text style={styles.editRowText}>
                {hasBank ? t("payouts.editAccount") : t("payouts.addAccount")}
              </Text>
            </TouchableOpacity>
          )}

          {/* Inline edit form */}
          {editing && (
            <View style={[styles.card, shadows.sm]}>
              <BankField label={t("payouts.accountHolder")} icon="person-circle-outline" value={accountHolder} onChangeText={setAccountHolder} placeholder="e.g. Eero Virtanen" theme={theme} />
              <Divider theme={theme} />
              <BankField label="IBAN" icon="card-outline" value={iban} onChangeText={setIban} placeholder="FI00 0000 0000 0000" autoCapitalize="characters" theme={theme} />
              <Divider theme={theme} />
              <BankField label={t("payouts.bankName")} icon="business-outline" value={bankName} onChangeText={setBankName} placeholder="e.g. Nordea" theme={theme} />
              <Divider theme={theme} />
              <BankField label="SWIFT / BIC" icon="globe-outline" value={swiftBic} onChangeText={setSwiftBic} placeholder="NDEAFIHH" autoCapitalize="characters" theme={theme} />

              <View style={styles.formActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={cancelEdit} disabled={saving}>
                  <Text style={styles.cancelBtnText}>{t("payouts.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={saveBank} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{t("payouts.save")}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.secureNote}>
            <Ionicons name="lock-closed" size={13} color={theme.textSecondary} />
            <Text style={styles.secureNoteText}>{t("payouts.secureNote")}</Text>
          </View>

          {/* Payout history */}
          <Text style={styles.sectionTitle}>{t("payouts.history")}</Text>

          {payouts.length === 0 ? (
            <View style={[styles.card, shadows.sm, styles.emptyState]}>
              <Ionicons name="receipt-outline" size={34} color={theme.textSecondary} />
              <Text style={styles.emptyTitle}>{t("payouts.noPayouts")}</Text>
              <Text style={styles.emptySub}>{t("payouts.noPayoutsSub")}</Text>
            </View>
          ) : (
            payouts.map((p) => (
              <View key={p.id} style={[styles.card, shadows.sm, styles.payoutRow]}>
                <View style={styles.payoutHead}>
                  <View>
                    <Text style={styles.payoutAmount}>€{p.amount.toFixed(2)}</Text>
                    <Text style={styles.payoutDate}>{fmtDate(p.requested_at)}</Text>
                  </View>
                  <View style={[styles.statusChip, { backgroundColor: statusColor(p.status) + "22" }]}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor(p.status) }]} />
                    <Text style={[styles.statusText, { color: statusColor(p.status) }]}>
                      {t(`payouts.status_${p.status}`)}
                    </Text>
                  </View>
                </View>

                {p.documents && p.documents.length > 0 && (
                  <View style={styles.docList}>
                    {p.documents.map((doc) => {
                      const isReceipt = doc.doc_type === "payout_receipt";
                      return (
                        <TouchableOpacity key={doc.id} style={styles.docBtn} onPress={() => openPdf(doc)} activeOpacity={0.85}>
                          <Ionicons name="document-text-outline" size={16} color={theme.primary} />
                          <Text style={styles.docText}>
                            {isReceipt ? t("payouts.proofReceipt") : t("payouts.invoice")}
                          </Text>
                          <Ionicons name="download-outline" size={16} color={theme.primary} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            ))
          )}
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

function BankField(props: any) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.md }}>
      <Ionicons name={props.icon} size={20} color={props.theme.textSecondary} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ fontSize: 11, color: props.theme.textSecondary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }}>{props.label}</Text>
        <TextInput
          style={{ fontSize: 16, color: props.theme.textPrimary, fontWeight: "600", paddingVertical: 4, marginTop: 2 }}
          value={props.value}
          onChangeText={props.onChangeText}
          autoCapitalize={props.autoCapitalize}
          placeholder={props.placeholder}
          placeholderTextColor={props.theme.textSecondary}
        />
      </View>
    </View>
  );
}

function Divider({ theme }: any) {
  return <View style={{ height: 1, backgroundColor: theme.border, marginLeft: 32 }} />;
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 20, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.3 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: spacing.xl, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  bannerText: { color: "#fff", fontWeight: "700", fontSize: 13.5, flex: 1 },
  sectionTitle: { fontSize: 11, fontWeight: "800", color: theme.textSecondary, letterSpacing: 1.2, marginTop: spacing.xl, marginBottom: spacing.md, paddingHorizontal: 4 },

  // Bank card
  bankCard: { borderRadius: radius.xl, padding: spacing.xl, minHeight: 190, justifyContent: "space-between" },
  bankCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chip: { width: 40, height: 30, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.35)" },
  bankCardNumber: { color: "#fff", fontSize: 21, fontWeight: "700", letterSpacing: 2, marginVertical: spacing.md },
  bankCardBottom: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  bankCardLabel: { color: "rgba(255,255,255,0.7)", fontSize: 9.5, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  bankCardValue: { color: "#fff", fontSize: 14, fontWeight: "700", marginTop: 3 },
  bankCardBrand: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginTop: spacing.md },

  editRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: spacing.md, paddingVertical: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: theme.primary },
  editRowText: { color: theme.primary, fontWeight: "800", fontSize: 15 },

  card: { backgroundColor: theme.surface, borderRadius: radius.xl, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, marginTop: spacing.md },
  formActions: { flexDirection: "row", gap: 12, marginVertical: spacing.md },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.lg, alignItems: "center", borderWidth: 1.5, borderColor: theme.border },
  cancelBtnText: { color: theme.textSecondary, fontWeight: "800", fontSize: 15 },
  saveBtn: { flex: 1.4, backgroundColor: theme.primary, paddingVertical: 14, borderRadius: radius.lg, alignItems: "center" },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  secureNote: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, paddingHorizontal: 4 },
  secureNoteText: { color: theme.textSecondary, fontSize: 12, flex: 1 },

  emptyState: { alignItems: "center", paddingVertical: spacing.xxl, gap: 6 },
  emptyTitle: { color: theme.textPrimary, fontWeight: "800", fontSize: 15, marginTop: 4 },
  emptySub: { color: theme.textSecondary, fontSize: 13, textAlign: "center", paddingHorizontal: spacing.lg },

  payoutRow: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  payoutHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  payoutAmount: { color: theme.textPrimary, fontSize: 18, fontWeight: "800" },
  payoutDate: { color: theme.textSecondary, fontSize: 12.5, marginTop: 2 },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  docList: { marginTop: spacing.md, gap: 8, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: spacing.md },
  docBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.primaryLight, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md },
  docText: { color: theme.primary, fontWeight: "700", fontSize: 13.5, flex: 1 },
});
