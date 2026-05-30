import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Linking, Platform } from "react-native";

import { api } from "../src/api";
import { Driver } from "../src/types";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

export default function DriverEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = createStyles(theme);

  const [driver, setDriver] = useState<Driver | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [avatar, setAvatar] = useState("");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ msg: string; ok: boolean } | null>(null);

  // Password fields
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.getDriver();
      setDriver(d);
      setName(d.name);
      setEmail(d.email);
      setPhone(d.phone);
      setAvatar(d.avatar);
    } catch (e) {
      console.warn("driver-edit load failed", e);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const flash = (msg: string, ok = true) => {
    setBanner({ msg, ok });
    setTimeout(() => setBanner(null), 2600);
  };

  const pickAvatar = async () => {
    Haptics.selectionAsync().catch(() => {});
    try {
      const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      let granted = perm.granted;
      if (!granted && perm.canAskAgain) {
        const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
        granted = req.granted;
      }
      if (!granted) {
        flash("Photo access denied. Enable it in Settings.", false);
        if (Platform.OS !== "web") Linking.openSettings().catch(() => {});
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
        base64: true,
      });
      if (!result.canceled && result.assets?.[0]?.base64) {
        const uri = `data:image/jpeg;base64,${result.assets[0].base64}`;
        setAvatar(uri);
      }
    } catch (e) {
      console.warn("pick avatar failed", e);
      flash("Could not open gallery.", false);
    }
  };

  const save = async () => {
    if (!name.trim()) { flash("Name can't be empty.", false); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSaving(true);
    try {
      await api.updateDriver({ name: name.trim(), email: email.trim(), phone: phone.trim(), avatar });
      flash("Profile updated");
      setTimeout(() => router.back(), 700);
    } catch (e) {
      flash("Failed to save. Try again.", false);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (newPw.length < 8) { flash("New password must be 8+ characters.", false); return; }
    if (newPw !== confirmPw) { flash("Passwords don't match.", false); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setChangingPw(true);
    try {
      await api.changePassword(curPw, newPw);
      setCurPw(""); setNewPw(""); setConfirmPw("");
      flash("Password changed");
    } catch (e: any) {
      flash(e?.message?.includes("incorrect") ? "Current password is incorrect." : "Couldn't change password.", false);
    } finally {
      setChangingPw(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={[styles.iconBtn, shadows.sm]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>Edit Profile</Text>
        <View style={{ width: 44 }} />
      </View>

      {banner && (
        <View style={[styles.banner, { backgroundColor: banner.ok ? theme.success : theme.error }]}>
          <Ionicons name={banner.ok ? "checkmark-circle" : "alert-circle"} size={16} color="#fff" />
          <Text style={styles.bannerText}>{banner.msg}</Text>
        </View>
      )}

      {!driver ? (
        <View style={styles.loading}><ActivityIndicator size="large" color={theme.primary} /></View>
      ) : (
        <KeyboardAwareScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 60 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bottomOffset={20}
        >
          {/* Avatar */}
          <View style={styles.avatarWrap}>
            <Image source={{ uri: avatar || driver.avatar }} style={styles.avatar} />
            <TouchableOpacity style={[styles.avatarBtn, shadows.md]} onPress={pickAvatar}>
              <Ionicons name="camera" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
          <Text style={styles.avatarHint}>Tap the camera to change your photo</Text>

          {/* Personal info */}
          <Text style={styles.sectionTitle}>PERSONAL INFO</Text>
          <View style={[styles.card, shadows.sm]}>
            <Field label="Full name" icon="person-outline" value={name} onChangeText={setName} theme={theme} />
            <Divider theme={theme} />
            <Field label="Email" icon="mail-outline" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" theme={theme} />
            <Divider theme={theme} />
            <Field label="Phone" icon="call-outline" value={phone} onChangeText={setPhone} keyboardType="phone-pad" theme={theme} />
          </View>

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save changes</Text>}
          </TouchableOpacity>

          {/* Change password */}
          <Text style={styles.sectionTitle}>CHANGE PASSWORD</Text>
          <View style={[styles.card, shadows.sm]}>
            <Field label="Current password" icon="lock-closed-outline" value={curPw} onChangeText={setCurPw} secureTextEntry theme={theme} />
            <Divider theme={theme} />
            <Field label="New password" icon="key-outline" value={newPw} onChangeText={setNewPw} secureTextEntry theme={theme} />
            <Divider theme={theme} />
            <Field label="Confirm new password" icon="key-outline" value={confirmPw} onChangeText={setConfirmPw} secureTextEntry theme={theme} />
          </View>
          <TouchableOpacity style={[styles.outlineBtn, changingPw && { opacity: 0.7 }]} onPress={changePassword} disabled={changingPw}>
            {changingPw ? <ActivityIndicator color={theme.primary} /> : <Text style={styles.outlineBtnText}>Update password</Text>}
          </TouchableOpacity>
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

function Field(props: any) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.md }}>
      <Ionicons name={props.icon} size={20} color={props.theme.textSecondary} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ fontSize: 11, color: props.theme.textSecondary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }}>{props.label}</Text>
        <TextInput
          style={{ fontSize: 16, color: props.theme.textPrimary, fontWeight: "600", paddingVertical: 4, marginTop: 2 }}
          value={props.value}
          onChangeText={props.onChangeText}
          keyboardType={props.keyboardType}
          autoCapitalize={props.autoCapitalize}
          secureTextEntry={props.secureTextEntry}
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
  avatarWrap: { alignSelf: "center", marginTop: spacing.md },
  avatar: { width: 110, height: 110, borderRadius: 55, borderWidth: 3, borderColor: theme.primaryLight },
  avatarBtn: { position: "absolute", bottom: 0, right: 0, width: 38, height: 38, borderRadius: 19, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: theme.background },
  avatarHint: { textAlign: "center", color: theme.textSecondary, fontSize: 12.5, marginTop: spacing.sm },
  sectionTitle: { fontSize: 11, fontWeight: "800", color: theme.textSecondary, letterSpacing: 1.2, marginTop: spacing.xxl, marginBottom: spacing.md, paddingHorizontal: 4 },
  card: { backgroundColor: theme.surface, borderRadius: radius.xl, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  saveBtn: { marginTop: spacing.lg, backgroundColor: theme.primary, paddingVertical: 16, borderRadius: radius.lg, alignItems: "center" },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  outlineBtn: { marginTop: spacing.lg, paddingVertical: 16, borderRadius: radius.lg, alignItems: "center", borderWidth: 1.5, borderColor: theme.primary },
  outlineBtnText: { color: theme.primary, fontWeight: "800", fontSize: 16 },
});
