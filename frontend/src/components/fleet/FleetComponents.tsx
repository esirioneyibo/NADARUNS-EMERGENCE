import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "../../api";
import { radius, shadows, spacing } from "../../theme";

export const VEHICLE_TYPE_OPTIONS = [
  { id: "cargo_van", label: "Cargo Van" },
  { id: "box_truck", label: "Box Truck" },
  { id: "flatbed_truck", label: "Flatbed Truck" },
  { id: "refrigerated", label: "Refrigerated" },
  { id: "semi_truck", label: "Semi Truck" },
  { id: "trailer_truck", label: "Trailer Truck" },
  { id: "container_truck", label: "Container Truck" },
  { id: "tanker", label: "Tanker" },
  { id: "crane_truck", label: "Crane Truck" },
  { id: "hazmat", label: "Hazmat" },
  { id: "other", label: "Other" },
];

export function Banner({ banner, theme }: any) {
  return (
    <View
      style={{
        marginHorizontal: spacing.lg,
        marginTop: 8,
        backgroundColor: banner.type === "ok" ? theme.success : theme.error,
        borderRadius: radius.md,
        paddingVertical: 10,
        paddingHorizontal: 14,
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>{banner.msg}</Text>
    </View>
  );
}

export function Field({ theme, label, ...props }: any) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          fontSize: 11,
          color: theme.textSecondary,
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: 0.6,
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      <TextInput
        style={{
          backgroundColor: theme.background,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.border,
          paddingHorizontal: 12,
          paddingVertical: 12,
          fontSize: 15,
          color: theme.textPrimary,
        }}
        placeholderTextColor={theme.textSecondary}
        {...props}
      />
    </View>
  );
}

export function DriverCard({ d, theme, t, s, onSuspend, onRemove }: any) {
  const isOwner = d.company_role === "owner";
  return (
    <View style={[s.itemCard, shadows.sm]}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={[s.avatar, { backgroundColor: theme.primaryLight }]}>
          <Ionicons name="person" size={20} color={theme.primary} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
            <Text style={s.itemTitle}>{d.name}</Text>
            {isOwner && <Text style={s.ownerTag}>{t("fleet.owner")}</Text>}
            {d.is_suspended && (
              <Text style={[s.ownerTag, { backgroundColor: `${theme.error}20`, color: theme.error }]}>
                {t("fleet.suspended")}
              </Text>
            )}
          </View>
          <Text style={s.muted}>{d.email}</Text>
        </View>
      </View>
      {!isOwner && (
        <View style={s.actionRow}>
          <TouchableOpacity style={s.actionBtn} onPress={onSuspend} testID={`suspend-${d.id}`}>
            <Text style={s.actionText}>
              {d.is_suspended ? t("fleet.activate") : t("fleet.suspend")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={onRemove} testID={`remove-${d.id}`}>
            <Text style={[s.actionText, { color: theme.error }]}>{t("fleet.remove")}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export function VehicleCard({ v, theme, t, s, onAssign, onUnassign, onToggleStatus, onDelete }: any) {
  const disabled = v.status === "disabled";
  return (
    <View style={[s.itemCard, shadows.sm, disabled && { opacity: 0.6 }]}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={[s.avatar, { backgroundColor: theme.primaryLight }]}>
          <Ionicons name="car" size={20} color={theme.primary} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.itemTitle}>{v.registration_number}</Text>
          <Text style={s.muted}>
            {v.vehicle_type} ·{" "}
            {v.assigned_driver_name
              ? t("fleet.assignedTo", { name: v.assigned_driver_name })
              : t("fleet.unassigned")}
          </Text>
        </View>
      </View>
      <View style={s.actionRow}>
        {v.assigned_driver_id ? (
          <TouchableOpacity style={s.actionBtn} onPress={onUnassign} testID={`unassign-${v.id}`}>
            <Text style={s.actionText}>{t("fleet.unassign")}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.actionBtn} onPress={onAssign} testID={`assign-${v.id}`}>
            <Text style={s.actionText}>{t("fleet.assignDriver")}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.actionBtn} onPress={onToggleStatus} testID={`toggle-${v.id}`}>
          <Text style={s.actionText}>{disabled ? t("fleet.enable") : t("fleet.disable")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionBtn} onPress={onDelete} testID={`delete-${v.id}`}>
          <Text style={[s.actionText, { color: theme.error }]}>{t("fleet.delete")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function JobCard({ j, theme, t, s }: any) {
  const done = j.status === "delivered";
  const cancelled = j.status === "cancelled" || j.status === "canceled" || j.status === "failed";
  const color = done ? theme.success : cancelled ? theme.error : theme.primary;
  const label = String(j.status || "").replace(/_/g, " ");
  return (
    <View style={[s.itemCard, shadows.sm]}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={s.itemTitle}>{j.order_number || j.id?.slice(0, 8)}</Text>
          <Text style={s.muted} numberOfLines={1}>
            {(j.pickup || "—")} → {(j.dropoff || "—")}
          </Text>
        </View>
        <View style={[s.statusPill, { backgroundColor: `${color}20` }]}>
          <Text style={[s.statusPillText, { color }]}>{label}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
        <Ionicons name="person-outline" size={14} color={theme.textSecondary} />
        <Text style={[s.muted, { marginLeft: 4, flex: 1 }]} numberOfLines={1}>
          {j.driver_name ? t("fleet.jobBy", { name: j.driver_name }) : t("fleet.jobUnassigned")}
          {j.vehicle_reg ? ` · ${j.vehicle_reg}` : ""}
        </Text>
        <Text style={[s.itemTitle, { marginRight: 0 }]}>€{Number(j.earnings || 0).toFixed(2)}</Text>
      </View>
    </View>
  );
}

export function VehicleTypePicker({ theme, t, value, onChange, s }: any) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          fontSize: 11,
          color: theme.textSecondary,
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: 0.6,
          marginBottom: 6,
        }}
      >
        {t("fleet.vehicleType")}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {VEHICLE_TYPE_OPTIONS.map((o) => {
          const active = value === o.id;
          return (
            <TouchableOpacity
              key={o.id}
              style={[s.typeChip, active && s.typeChipActive]}
              onPress={() => onChange(o.id)}
            >
              <Text style={[s.typeChipText, active && s.typeChipTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function AddDriverModal({ visible, theme, t, s, onClose, onDone, onError }: any) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [vType, setVType] = useState("cargo_van");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFirst(""); setLast(""); setEmail(""); setPhone(""); setPassword(""); setVType("cargo_van");
  };

  const submit = async () => {
    if (!first.trim() || !email.trim() || password.length < 6) return onError(t("fleet.required"));
    setSaving(true);
    try {
      await api.addCompanyDriver({
        first_name: first.trim(),
        last_name: last.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        password,
        vehicle_type: vType,
      });
      reset();
      onDone();
    } catch (e: any) {
      onError(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[s.modalSheet, { backgroundColor: theme.surface }]}>
          <Text style={s.modalTitle}>{t("fleet.addDriver")}</Text>
          <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
            <Field theme={theme} label={t("fleet.firstName")} value={first} onChangeText={setFirst} testID="d-first" />
            <Field theme={theme} label={t("fleet.lastName")} value={last} onChangeText={setLast} testID="d-last" />
            <Field theme={theme} label={t("fleet.email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" testID="d-email" />
            <Field theme={theme} label={t("fleet.phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="d-phone" />
            <Field theme={theme} label={t("fleet.password")} value={password} onChangeText={setPassword} secureTextEntry testID="d-password" />
            <VehicleTypePicker theme={theme} t={t} value={vType} onChange={setVType} s={s} />
          </ScrollView>
          <View style={{ flexDirection: "row", marginTop: 8 }}>
            <TouchableOpacity style={[s.ghostBtn, { flex: 1, marginRight: 8 }]} onPress={onClose}>
              <Text style={s.ghostBtnText}>{t("fleet.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.primaryBtn, { flex: 1, marginTop: 0 }, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving} testID="d-save">
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>{t("fleet.save")}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function AddVehicleModal({ visible, theme, t, s, onClose, onDone, onError }: any) {
  const [reg, setReg] = useState("");
  const [vType, setVType] = useState("cargo_van");
  const [cap, setCap] = useState("");
  const [maxW, setMaxW] = useState("");
  const [len, setLen] = useState("");
  const [wid, setWid] = useState("");
  const [hei, setHei] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setReg(""); setVType("cargo_van"); setCap(""); setMaxW(""); setLen(""); setWid(""); setHei("");
  };

  const num = (x: string) => (x.trim() ? Number(x) : undefined);

  const submit = async () => {
    if (!reg.trim()) return onError(t("fleet.required"));
    setSaving(true);
    try {
      await api.addCompanyVehicle({
        registration_number: reg.trim(),
        vehicle_type: vType,
        capacity_kg: num(cap),
        max_weight_kg: num(maxW),
        length_cm: num(len),
        width_cm: num(wid),
        height_cm: num(hei),
      });
      reset();
      onDone();
    } catch (e: any) {
      onError(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[s.modalSheet, { backgroundColor: theme.surface }]}>
          <Text style={s.modalTitle}>{t("fleet.addVehicle")}</Text>
          <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
            <Field theme={theme} label={t("fleet.registration")} placeholder={t("fleet.registrationPh")} value={reg} onChangeText={setReg} autoCapitalize="characters" testID="v-reg" />
            <VehicleTypePicker theme={theme} t={t} value={vType} onChange={setVType} s={s} />
            <Field theme={theme} label={t("fleet.capacity")} value={cap} onChangeText={setCap} keyboardType="numeric" testID="v-cap" />
            <Field theme={theme} label={t("fleet.maxWeight")} value={maxW} onChangeText={setMaxW} keyboardType="numeric" testID="v-maxw" />
            <Field theme={theme} label={t("fleet.length")} value={len} onChangeText={setLen} keyboardType="numeric" testID="v-len" />
            <Field theme={theme} label={t("fleet.width")} value={wid} onChangeText={setWid} keyboardType="numeric" testID="v-wid" />
            <Field theme={theme} label={t("fleet.height")} value={hei} onChangeText={setHei} keyboardType="numeric" testID="v-hei" />
          </ScrollView>
          <View style={{ flexDirection: "row", marginTop: 8 }}>
            <TouchableOpacity style={[s.ghostBtn, { flex: 1, marginRight: 8 }]} onPress={onClose}>
              <Text style={s.ghostBtnText}>{t("fleet.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.primaryBtn, { flex: 1, marginTop: 0 }, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving} testID="v-save">
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>{t("fleet.save")}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function PayoutModal({ visible, wallet, theme, t, s, onClose, onDone, onError }: any) {
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return onError(t("fleet.required"));
    if (wallet && amt > wallet.available_balance) return onError(t("fleet.insufficientBalance"));
    setSaving(true);
    try {
      await api.requestCompanyPayout({ amount: amt, account_details: account.trim() || undefined });
      setAmount("");
      setAccount("");
      onDone();
    } catch (e: any) {
      onError(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.modalSheet, { backgroundColor: theme.surface }]}>
          <Text style={s.modalTitle}>{t("fleet.requestPayout")}</Text>
          <Text style={[s.muted, { marginBottom: 12 }]}>
            {t("fleet.walletAvailable")}: €{(wallet?.available_balance ?? 0).toFixed(2)}
          </Text>
          <Field theme={theme} label={t("fleet.payoutAmount")} value={amount} onChangeText={setAmount} keyboardType="numeric" testID="payout-amount" />
          <Field theme={theme} label={t("fleet.payoutAccount")} value={account} onChangeText={setAccount} testID="payout-account" />
          <View style={{ flexDirection: "row", marginTop: 8 }}>
            <TouchableOpacity style={[s.ghostBtn, { flex: 1, marginRight: 8 }]} onPress={onClose}>
              <Text style={s.ghostBtnText}>{t("fleet.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.primaryBtn, { flex: 1, marginTop: 0 }, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving} testID="payout-submit">
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>{t("fleet.payoutSubmit")}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function PayoutRow({ p, theme, t, s }: any) {
  const map: any = {
    pending: { c: theme.warning, l: t("fleet.payoutPending") },
    approved: { c: theme.primary, l: t("fleet.payoutApproved") },
    paid: { c: theme.success, l: t("fleet.payoutPaid") },
    rejected: { c: theme.error, l: t("fleet.payoutRejected") },
  };
  const st = map[p.status] || map.pending;
  return (
    <View style={s.itemCard}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={s.itemTitle}>€{Number(p.amount).toFixed(2)}</Text>
          <Text style={s.muted}>{p.reference || p.id?.slice(0, 8)}</Text>
        </View>
        <View style={[s.statusPill, { backgroundColor: `${st.c}20` }]}>
          <Text style={[s.statusPillText, { color: st.c }]}>{st.l}</Text>
        </View>
      </View>
    </View>
  );
}
