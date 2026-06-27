import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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
import { useTranslation } from "react-i18next";

import { api } from "../src/api";
import { CompanyInfo, CompanyJob, CompanyPayout, CompanyWallet, CompanyWalletTxn, FleetDriver, FleetVehicle, JobAcceptanceMode } from "../src/types";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";
import { Banner, Field, DriverCard, VehicleCard, JobCard, AddDriverModal, AddVehicleModal, PayoutModal, PayoutRow } from "../src/components/fleet/FleetComponents";


export default function FleetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const s = makeStyles(theme);

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<CompanyInfo | null>(null);
  const [tab, setTab] = useState<"drivers" | "vehicles" | "jobs" | "wallet">("drivers");
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [jobs, setJobs] = useState<CompanyJob[]>([]);
  const [jobStats, setJobStats] = useState<{ active: number; completed: number; completed_earnings: number } | null>(null);
  const [wallet, setWallet] = useState<CompanyWallet | null>(null);
  const [walletTxns, setWalletTxns] = useState<CompanyWalletTxn[]>([]);
  const [walletPayouts, setWalletPayouts] = useState<CompanyPayout[]>([]);
  const [showPayout, setShowPayout] = useState(false);
  const [banner, setBanner] = useState<{ msg: string; type: "ok" | "err" } | null>(null);

  // Create company form
  const [coName, setCoName] = useState("");
  const [coPhone, setCoPhone] = useState("");
  const [creating, setCreating] = useState(false);

  // Modals
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [assignFor, setAssignFor] = useState<FleetVehicle | null>(null);
  const [confirm, setConfirm] = useState<{ msg: string; onYes: () => void } | null>(null);

  const flash = (msg: string, type: "ok" | "err" = "ok") => {
    setBanner({ msg, type });
    setTimeout(() => setBanner(null), 2600);
  };

  const load = useCallback(async () => {
    try {
      const ci = await api.getMyCompany();
      setInfo(ci);
      if (ci.company && ci.role === "owner") {
        const [d, v, j, w] = await Promise.all([
          api.getCompanyDrivers(),
          api.getCompanyVehicles(),
          api.getCompanyJobs(),
          api.getCompanyWallet(),
        ]);
        setDrivers(d.drivers);
        setVehicles(v.vehicles);
        setJobs(j.jobs);
        setJobStats(j.stats);
        setWallet(w.wallet);
        setWalletTxns(w.transactions);
        setWalletPayouts(w.payouts);
      }
    } catch (e: any) {
      flash(e?.message || "Failed to load", "err");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const refreshOwnerData = async () => {
    const [d, v, ci, j, w] = await Promise.all([
      api.getCompanyDrivers(),
      api.getCompanyVehicles(),
      api.getMyCompany(),
      api.getCompanyJobs(),
      api.getCompanyWallet(),
    ]);
    setDrivers(d.drivers);
    setVehicles(v.vehicles);
    setInfo(ci);
    setJobs(j.jobs);
    setJobStats(j.stats);
    setWallet(w.wallet);
    setWalletTxns(w.transactions);
    setWalletPayouts(w.payouts);
  };

  const onCreateCompany = async () => {
    if (coName.trim().length < 2) return flash(t("fleet.required"), "err");
    setCreating(true);
    try {
      await api.createCompany({ company_name: coName.trim(), phone: coPhone.trim() || undefined });
      setCoName("");
      setCoPhone("");
      setLoading(true);
      await load();
      flash(t("fleet.added"));
    } catch (e: any) {
      flash(e?.message || "Failed", "err");
    } finally {
      setCreating(false);
    }
  };

  const setMode = async (mode: JobAcceptanceMode) => {
    if (info?.company?.job_acceptance_mode === mode) return;
    try {
      const r = await api.updateCompany({ job_acceptance_mode: mode });
      setInfo((prev) => (prev ? { ...prev, company: r.company } : prev));
    } catch (e: any) {
      flash(e?.message || "Failed", "err");
    }
  };

  // -------- render helpers --------
  const Header = (
    <View style={[s.header, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="fleet-back">
        <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={s.headerTitle}>{t("fleet.title")}</Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={[s.screen, s.center]}>
        {Header}
        <ActivityIndicator size="large" color={theme.primary} style={{ marginTop: 80 }} />
        <Text style={s.muted}>{t("fleet.loading")}</Text>
      </View>
    );
  }

  // No company -> create
  if (!info?.company) {
    return (
      <KeyboardAvoidingView
        style={s.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {Header}
        {banner && <Banner banner={banner} theme={theme} />}
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
          <View style={[s.card, shadows.sm, { alignItems: "center", paddingVertical: spacing.xl }]}>
            <View style={s.iconCircle}>
              <Ionicons name="business" size={34} color={theme.primary} />
            </View>
            <Text style={s.bigTitle}>{t("fleet.createTitle")}</Text>
            <Text style={[s.muted, { textAlign: "center", marginTop: 6 }]}>
              {t("fleet.createSubtitle")}
            </Text>
          </View>

          <View style={[s.card, shadows.sm, { marginTop: spacing.md }]}>
            <Field
              theme={theme}
              label={t("fleet.companyName")}
              placeholder={t("fleet.companyNamePh")}
              value={coName}
              onChangeText={setCoName}
              testID="company-name-input"
            />
            <Field
              theme={theme}
              label={t("fleet.phone")}
              value={coPhone}
              onChangeText={setCoPhone}
              keyboardType="phone-pad"
              testID="company-phone-input"
            />
            <TouchableOpacity
              style={[s.primaryBtn, creating && { opacity: 0.6 }]}
              onPress={onCreateCompany}
              disabled={creating}
              testID="create-company-btn"
            >
              {creating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.primaryBtnText}>{t("fleet.createBtn")}</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Member (non-owner) view
  if (info.role !== "owner") {
    return (
      <View style={s.screen}>
        {Header}
        <View style={{ padding: spacing.lg }}>
          <View style={[s.card, shadows.sm, { alignItems: "center", paddingVertical: spacing.xl }]}>
            <View style={s.iconCircle}>
              <Ionicons name="people" size={32} color={theme.primary} />
            </View>
            <Text style={s.bigTitle}>{t("fleet.memberTitle")}</Text>
            <Text style={[s.muted, { textAlign: "center", marginTop: 8 }]}>
              {t("fleet.memberBody", { name: info.company.company_name })}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // Owner view
  const company = info.company;
  return (
    <View style={s.screen}>
      {Header}
      {banner && <Banner banner={banner} theme={theme} />}
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}>
        {/* Company summary */}
        <View style={[s.card, shadows.sm]}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={s.iconCircleSm}>
              <Ionicons name="business" size={20} color={theme.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.coName}>{company.company_name}</Text>
              <Text style={s.muted}>
                {info.driver_count ?? drivers.length} · {info.vehicle_count ?? vehicles.length} ·{" "}
                {t("fleet.owner")}
              </Text>
            </View>
          </View>

          {/* Job acceptance mode */}
          <Text style={s.sectionLabel}>{t("fleet.acceptanceMode")}</Text>
          <View style={s.modeRow}>
            {(["self_accept", "owner_assign", "hybrid"] as JobAcceptanceMode[]).map((m) => {
              const active = company.job_acceptance_mode === m;
              const label =
                m === "self_accept"
                  ? t("fleet.modeSelfAccept")
                  : m === "owner_assign"
                  ? t("fleet.modeOwnerAssign")
                  : t("fleet.modeHybrid");
              return (
                <TouchableOpacity
                  key={m}
                  style={[s.modeChip, active && s.modeChipActive]}
                  onPress={() => setMode(m)}
                  testID={`mode-${m}`}
                >
                  <Text style={[s.modeChipText, active && s.modeChipTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[s.muted, { marginTop: 6, fontSize: 12 }]}>{t("fleet.modeHint")}</Text>
        </View>

        {/* Tabs */}
        <View style={s.tabs}>
          <TouchableOpacity
            style={[s.tab, tab === "drivers" && s.tabActive]}
            onPress={() => setTab("drivers")}
            testID="tab-drivers"
          >
            <Text style={[s.tabText, tab === "drivers" && s.tabTextActive]}>
              {t("fleet.tabDrivers")} ({drivers.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, tab === "vehicles" && s.tabActive]}
            onPress={() => setTab("vehicles")}
            testID="tab-vehicles"
          >
            <Text style={[s.tabText, tab === "vehicles" && s.tabTextActive]}>
              {t("fleet.tabVehicles")} ({vehicles.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, tab === "jobs" && s.tabActive]}
            onPress={() => setTab("jobs")}
            testID="tab-jobs"
          >
            <Text style={[s.tabText, tab === "jobs" && s.tabTextActive]}>
              {t("fleet.tabJobs")} ({jobs.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, tab === "wallet" && s.tabActive]}
            onPress={() => setTab("wallet")}
            testID="tab-wallet"
          >
            <Text style={[s.tabText, tab === "wallet" && s.tabTextActive]}>
              {t("fleet.tabWallet")}
            </Text>
          </TouchableOpacity>
        </View>

        {tab === "drivers" ? (
          <View style={{ marginTop: spacing.md }}>
            <TouchableOpacity
              style={[s.addBtn]}
              onPress={() => setShowAddDriver(true)}
              testID="add-driver-btn"
            >
              <Ionicons name="person-add" size={18} color={theme.primary} />
              <Text style={s.addBtnText}>{t("fleet.addDriver")}</Text>
            </TouchableOpacity>

            {drivers.length === 0 ? (
              <Text style={[s.muted, { textAlign: "center", marginTop: 24 }]}>
                {t("fleet.noDrivers")}
              </Text>
            ) : (
              drivers.map((d) => (
                <DriverCard
                  key={d.id}
                  d={d}
                  theme={theme}
                  t={t}
                  s={s}
                  onSuspend={async () => {
                    try {
                      if (d.is_suspended) {
                        await api.activateCompanyDriver(d.id);
                      } else {
                        await api.suspendCompanyDriver(d.id);
                      }
                      await refreshOwnerData();
                    } catch (e: any) {
                      flash(e?.message || "Failed", "err");
                    }
                  }}
                  onRemove={() =>
                    setConfirm({
                      msg: t("fleet.removeDriverConfirm", { name: d.name }),
                      onYes: async () => {
                        try {
                          await api.removeCompanyDriver(d.id);
                          await refreshOwnerData();
                          flash(t("fleet.added"));
                        } catch (e: any) {
                          flash(e?.message || "Failed", "err");
                        }
                      },
                    })
                  }
                />
              ))
            )}
          </View>
        ) : tab === "vehicles" ? (
          <View style={{ marginTop: spacing.md }}>
            <TouchableOpacity
              style={[s.addBtn]}
              onPress={() => setShowAddVehicle(true)}
              testID="add-vehicle-btn"
            >
              <Ionicons name="car" size={18} color={theme.primary} />
              <Text style={s.addBtnText}>{t("fleet.addVehicle")}</Text>
            </TouchableOpacity>

            {vehicles.length === 0 ? (
              <Text style={[s.muted, { textAlign: "center", marginTop: 24 }]}>
                {t("fleet.noVehicles")}
              </Text>
            ) : (
              vehicles.map((v) => (
                <VehicleCard
                  key={v.id}
                  v={v}
                  theme={theme}
                  t={t}
                  s={s}
                  onAssign={() => setAssignFor(v)}
                  onUnassign={async () => {
                    try {
                      await api.unassignVehicleDriver(v.id);
                      await refreshOwnerData();
                    } catch (e: any) {
                      flash(e?.message || "Failed", "err");
                    }
                  }}
                  onToggleStatus={async () => {
                    try {
                      await api.updateCompanyVehicle(v.id, {
                        status: v.status === "active" ? "disabled" : "active",
                      });
                      await refreshOwnerData();
                    } catch (e: any) {
                      flash(e?.message || "Failed", "err");
                    }
                  }}
                  onDelete={() =>
                    setConfirm({
                      msg: t("fleet.deleteVehicleConfirm", { reg: v.registration_number }),
                      onYes: async () => {
                        try {
                          await api.deleteCompanyVehicle(v.id);
                          await refreshOwnerData();
                        } catch (e: any) {
                          flash(e?.message || "Failed", "err");
                        }
                      },
                    })
                  }
                />
              ))
            )}
          </View>
        ) : tab === "jobs" ? (
          <View style={{ marginTop: spacing.md }}>
            {jobStats && (
              <View style={s.statsRow}>
                <View style={s.statBox}>
                  <Text style={s.statNum}>{jobStats.active}</Text>
                  <Text style={s.statLabel}>{t("fleet.jobsActiveLabel")}</Text>
                </View>
                <View style={s.statBox}>
                  <Text style={s.statNum}>{jobStats.completed}</Text>
                  <Text style={s.statLabel}>{t("fleet.jobsDoneLabel")}</Text>
                </View>
                <View style={[s.statBox, { marginRight: 0 }]}>
                  <Text style={s.statNum}>€{jobStats.completed_earnings.toFixed(0)}</Text>
                  <Text style={s.statLabel}>{t("fleet.jobsEarnedLabel")}</Text>
                </View>
              </View>
            )}
            {jobs.length === 0 ? (
              <Text style={[s.muted, { textAlign: "center", marginTop: 24 }]}>{t("fleet.noJobs")}</Text>
            ) : (
              jobs.map((j) => <JobCard key={j.id} j={j} theme={theme} t={t} s={s} />)
            )}
          </View>
        ) : (
          <View style={{ marginTop: spacing.md }}>
            <View style={s.walletGrid}>
              <View style={s.walletBox}>
                <Text style={s.walletNum}>€{(wallet?.available_balance ?? 0).toFixed(2)}</Text>
                <Text style={s.statLabel}>{t("fleet.walletAvailable")}</Text>
              </View>
              <View style={s.walletBox}>
                <Text style={s.walletNum}>€{(wallet?.pending_balance ?? 0).toFixed(2)}</Text>
                <Text style={s.statLabel}>{t("fleet.walletPending")}</Text>
              </View>
              <View style={s.walletBox}>
                <Text style={s.walletNum}>€{(wallet?.total_earnings ?? 0).toFixed(2)}</Text>
                <Text style={s.statLabel}>{t("fleet.walletTotalEarned")}</Text>
              </View>
              <View style={s.walletBox}>
                <Text style={s.walletNum}>€{(wallet?.total_withdrawn ?? 0).toFixed(2)}</Text>
                <Text style={s.statLabel}>{t("fleet.walletWithdrawn")}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[s.primaryBtn, (!wallet || wallet.available_balance <= 0) && { opacity: 0.5 }]}
              disabled={!wallet || wallet.available_balance <= 0}
              onPress={() => setShowPayout(true)}
              testID="request-payout-btn"
            >
              <Text style={s.primaryBtnText}>{t("fleet.requestPayout")}</Text>
            </TouchableOpacity>

            <Text style={s.sectionLabel}>{t("fleet.payoutHistory")}</Text>
            {walletPayouts.length === 0 ? (
              <Text style={s.muted}>{t("fleet.noPayouts")}</Text>
            ) : (
              walletPayouts.map((p) => <PayoutRow key={p.id} p={p} theme={theme} t={t} s={s} />)
            )}

            <Text style={s.sectionLabel}>{t("fleet.recentTxns")}</Text>
            {walletTxns.filter((x) => x.type === "earning").length === 0 ? (
              <Text style={s.muted}>{t("fleet.noTxns")}</Text>
            ) : (
              walletTxns
                .filter((x) => x.type === "earning")
                .slice(0, 15)
                .map((x) => (
                  <View key={x.id} style={s.txnRow}>
                    <Text style={[s.muted, { flex: 1 }]} numberOfLines={1}>
                      {x.order_number || "—"}
                    </Text>
                    <Text style={{ color: theme.success, fontWeight: "800" }}>
                      +€{x.amount.toFixed(2)}
                    </Text>
                  </View>
                ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Add Driver modal */}
      <AddDriverModal
        visible={showAddDriver}
        theme={theme}
        t={t}
        s={s}
        onClose={() => setShowAddDriver(false)}
        onDone={async () => {
          setShowAddDriver(false);
          await refreshOwnerData();
          flash(t("fleet.added"));
        }}
        onError={(m) => flash(m, "err")}
      />

      {/* Add Vehicle modal */}
      <AddVehicleModal
        visible={showAddVehicle}
        theme={theme}
        t={t}
        s={s}
        onClose={() => setShowAddVehicle(false)}
        onDone={async () => {
          setShowAddVehicle(false);
          await refreshOwnerData();
          flash(t("fleet.added"));
        }}
        onError={(m) => flash(m, "err")}
      />

      {/* Assign driver modal */}
      <Modal visible={!!assignFor} transparent animationType="slide" onRequestClose={() => setAssignFor(null)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { backgroundColor: theme.surface }]}>
            <Text style={s.modalTitle}>{t("fleet.pickDriver")}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {drivers.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={s.pickRow}
                  testID={`assign-pick-${d.id}`}
                  onPress={async () => {
                    const vid = assignFor!.id;
                    setAssignFor(null);
                    try {
                      await api.assignVehicleDriver(vid, d.id);
                      await refreshOwnerData();
                    } catch (e: any) {
                      flash(e?.message || "Failed", "err");
                    }
                  }}
                >
                  <Ionicons name="person-circle-outline" size={22} color={theme.textSecondary} />
                  <Text style={s.pickText}>{d.name}</Text>
                  {d.company_role === "owner" && (
                    <Text style={s.ownerTag}>{t("fleet.owner")}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.ghostBtn} onPress={() => setAssignFor(null)}>
              <Text style={s.ghostBtnText}>{t("fleet.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Confirm modal */}
      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={s.modalOverlay}>
          <View style={[s.confirmCard, { backgroundColor: theme.surface }]}>
            <Text style={s.confirmText}>{confirm?.msg}</Text>
            <View style={{ flexDirection: "row", marginTop: 18 }}>
              <TouchableOpacity style={[s.ghostBtn, { flex: 1, marginRight: 8 }]} onPress={() => setConfirm(null)}>
                <Text style={s.ghostBtnText}>{t("fleet.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.dangerBtn, { flex: 1 }]}
                testID="confirm-yes"
                onPress={() => {
                  const fn = confirm?.onYes;
                  setConfirm(null);
                  fn?.();
                }}
              >
                <Text style={s.dangerBtnText}>{t("fleet.remove")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <PayoutModal
        visible={showPayout}
        wallet={wallet}
        theme={theme}
        t={t}
        s={s}
        onClose={() => setShowPayout(false)}
        onDone={async () => {
          setShowPayout(false);
          await refreshOwnerData();
          flash(t("fleet.added"));
        }}
        onError={(m) => flash(m, "err")}
      />
    </View>
  );
}

// ---------------- styles ----------------
const makeStyles = (theme: any) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    center: { alignItems: "center" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingBottom: 12,
      backgroundColor: theme.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    backBtn: { padding: 4, marginRight: 4 },
    headerTitle: { fontSize: 20, fontWeight: "800", color: theme.textPrimary },
    card: {
      backgroundColor: theme.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
    },
    iconCircle: {
      width: 64, height: 64, borderRadius: 32,
      backgroundColor: theme.primaryLight,
      alignItems: "center", justifyContent: "center", marginBottom: 10,
    },
    iconCircleSm: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: theme.primaryLight,
      alignItems: "center", justifyContent: "center",
    },
    bigTitle: { fontSize: 18, fontWeight: "800", color: theme.textPrimary },
    coName: { fontSize: 16, fontWeight: "800", color: theme.textPrimary },
    muted: { fontSize: 13, color: theme.textSecondary },
    sectionLabel: {
      fontSize: 11, color: theme.textSecondary, fontWeight: "700",
      textTransform: "uppercase", letterSpacing: 0.6, marginTop: 18, marginBottom: 8,
    },
    modeRow: { flexDirection: "row", flexWrap: "wrap" },
    modeChip: {
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill,
      borderWidth: 1, borderColor: theme.border, marginRight: 8, marginBottom: 8,
    },
    modeChipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
    modeChipText: { fontSize: 12, fontWeight: "700", color: theme.textSecondary },
    modeChipTextActive: { color: "#fff" },
    tabs: {
      flexDirection: "row", marginTop: spacing.lg,
      backgroundColor: theme.surface, borderRadius: radius.pill, padding: 4,
      borderWidth: 1, borderColor: theme.border,
    },
    tab: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, alignItems: "center" },
    tabActive: { backgroundColor: theme.primary },
    tabText: { fontSize: 12, fontWeight: "700", color: theme.textSecondary },
    tabTextActive: { color: "#fff" },
    addBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      backgroundColor: theme.primaryLight, borderRadius: radius.md, paddingVertical: 12, marginBottom: 12,
    },
    addBtnText: { color: theme.primary, fontWeight: "800", marginLeft: 8, fontSize: 14 },
    itemCard: { backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: 12 },
    avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    itemTitle: { fontSize: 15, fontWeight: "800", color: theme.textPrimary, marginRight: 8 },
    ownerTag: {
      fontSize: 10, fontWeight: "800", color: theme.primary, backgroundColor: theme.primaryLight,
      paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden", marginRight: 6,
    },
    actionRow: { flexDirection: "row", marginTop: 12, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10 },
    actionBtn: { marginRight: 18 },
    actionText: { fontSize: 13, fontWeight: "700", color: theme.primary },
    primaryBtn: {
      backgroundColor: theme.primary, borderRadius: radius.md, paddingVertical: 14,
      alignItems: "center", justifyContent: "center", marginTop: 6,
    },
    primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
    ghostBtn: {
      borderRadius: radius.md, paddingVertical: 14, alignItems: "center",
      justifyContent: "center", borderWidth: 1, borderColor: theme.border,
    },
    ghostBtnText: { color: theme.textSecondary, fontWeight: "700" },
    dangerBtn: { backgroundColor: theme.error, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
    dangerBtnText: { color: "#fff", fontWeight: "800" },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: 32 },
    modalTitle: { fontSize: 18, fontWeight: "800", color: theme.textPrimary, marginBottom: 16 },
    confirmCard: { margin: spacing.lg, borderRadius: radius.lg, padding: spacing.lg, alignSelf: "stretch" },
    confirmText: { fontSize: 15, color: theme.textPrimary, lineHeight: 22 },
    pickRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border },
    pickText: { fontSize: 15, color: theme.textPrimary, fontWeight: "600", marginLeft: 10, flex: 1 },
    typeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, marginRight: 8 },
    typeChipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
    typeChipText: { fontSize: 13, fontWeight: "700", color: theme.textSecondary },
    typeChipTextActive: { color: "#fff" },
    statsRow: { flexDirection: "row", marginBottom: 14 },
    statBox: {
      flex: 1, backgroundColor: theme.surface, borderRadius: radius.md,
      paddingVertical: 14, marginRight: 8, alignItems: "center",
      borderWidth: 1, borderColor: theme.border,
    },
    statNum: { fontSize: 18, fontWeight: "800", color: theme.textPrimary },
    statLabel: { fontSize: 11, color: theme.textSecondary, fontWeight: "600", marginTop: 2 },
    statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
    statusPillText: { fontSize: 11, fontWeight: "800", textTransform: "capitalize" },
    walletGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 14 },
    walletBox: {
      width: "48%", marginHorizontal: "1%", marginBottom: 8,
      backgroundColor: theme.surface, borderRadius: radius.md, paddingVertical: 16,
      alignItems: "center", borderWidth: 1, borderColor: theme.border,
    },
    walletNum: { fontSize: 18, fontWeight: "800", color: theme.textPrimary },
    txnRow: {
      flexDirection: "row", alignItems: "center", paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: theme.border,
    },
  });
