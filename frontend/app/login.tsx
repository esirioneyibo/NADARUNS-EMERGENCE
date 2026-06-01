import React, { useState, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";

import { api, setAuthToken } from "../src/api";
import { useAuth } from "../src/contexts/AuthContext";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

type UserRole = "driver" | "shipper" | "admin";

interface RoleOption {
  id: UserRole;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
  color: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    id: "driver",
    label: "Driver",
    icon: "bicycle",
    description: "Deliver orders and earn money",
    color: "#10B981",
  },
  {
    id: "shipper",
    label: "Business",
    icon: "storefront",
    description: "Ship your products",
    color: "#6366F1",
  },
  {
    id: "admin",
    label: "Admin",
    icon: "shield-checkmark",
    description: "Manage the platform",
    color: "#F59E0B",
  },
];

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { login, isAuthenticated } = useAuth();
  const { t } = useTranslation();
  
  const [selectedRole, setSelectedRole] = useState<UserRole>("driver");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const styles = createStyles(theme);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      // Redirect to appropriate home based on user type
      router.replace("/driver-home");
    }
  }, [isAuthenticated]);

  const handleDemoMode = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Demo mode goes to the appropriate home based on selected role
    if (selectedRole === "shipper") {
      router.replace("/shipper-home");
    } else if (selectedRole === "admin") {
      Alert.alert(t("login.adminAccessTitle"), t("login.adminAccessMsg"));
    } else {
      router.replace("/driver-home");
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert(t("common.error"), t("login.errorEmailPassword"));
      return;
    }
    
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    
    try {
      let response;
      
      if (selectedRole === "admin") {
        response = await api.adminLogin(email.trim(), password);
        setAuthToken(response.token);
        await login(response.token, {
          id: "admin",
          name: "Administrator",
          email: email.trim(),
          type: "admin",
        });
        router.replace("/admin");
      } else if (selectedRole === "shipper") {
        response = await api.shipperLogin(email.trim(), password);
        setAuthToken(response.token);
        await login(response.token, {
          id: response.shipper_id,
          name: response.business_name,
          email: email.trim(),
          type: "shipper",
        });
        router.replace("/shipper-home");
      } else {
        response = await api.login(email.trim(), password);
        setAuthToken(response.token);
        await login(response.token, {
          id: response.driver_id,
          name: response.name,
          email: email.trim(),
          type: "driver",
        });
        router.replace("/driver-home");
      }
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (error: any) {
      const message = error?.message || t("login.loginFailedMsg");
      Alert.alert(t("login.loginFailedTitle"), message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    // For drivers, redirect to the full onboarding flow
    if (selectedRole === "driver") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      router.push("/onboarding");
      return;
    }
    
    if (!email.trim() || !password.trim() || !name.trim()) {
      Alert.alert(t("common.error"), t("login.fillRequired"));
      return;
    }
    
    if (password.length < 6) {
      Alert.alert(t("common.error"), t("login.passwordMin"));
      return;
    }
    
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    
    try {
      // Shipper registration stays on this screen
      const response = await api.shipperRegister({
        business_name: name.trim(),
        email: email.trim(),
        password: password,
        phone: phone.trim(),
      });
      setAuthToken(response.token);
      await login(response.token, {
        id: response.shipper_id,
        name: response.business_name,
        email: email.trim(),
        type: "shipper",
      });
      router.replace("/shipper-home");
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(t("login.welcomeTitle"), t("login.shipperCreated"));
    } catch (error: any) {
      const message = error?.message || t("login.registrationFailedMsg");
      Alert.alert(t("login.registrationFailedTitle"), message);
    } finally {
      setLoading(false);
    }
  };

  const selectedRoleData = ROLE_OPTIONS.find(r => r.id === selectedRole)!;

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { paddingTop: insets.top }]} 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      testID="login-screen"
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Animated.View entering={FadeInDown.duration(400)} style={styles.header}>
          <View style={styles.logoContainer}>
            <View style={[styles.logoIcon, { backgroundColor: selectedRoleData.color }]}>
              <Ionicons name="flash" size={32} color="#fff" />
            </View>
          </View>
          <Text style={styles.title}>NadaRuns</Text>
          <Text style={styles.subtitle}>
            {isRegister ? t("login.createAccount") : t("login.signInToContinue")}
          </Text>
        </Animated.View>

        {/* Role Selector */}
        <Animated.View entering={FadeInUp.delay(100).duration(400)} style={styles.roleSection}>
          <Text style={styles.roleSectionTitle}>{t("login.iAmA")}</Text>
          <View style={styles.roleGrid}>
            {ROLE_OPTIONS.filter(r => isRegister ? r.id !== "admin" : true).map((role) => {
              const isSelected = selectedRole === role.id;
              const labelKey = role.id === "driver" ? "login.roleDriver" : role.id === "shipper" ? "login.roleBusiness" : "login.roleAdmin";
              const descKey = role.id === "driver" ? "login.roleDriverDesc" : role.id === "shipper" ? "login.roleBusinessDesc" : "login.roleAdminDesc";
              return (
                <TouchableOpacity
                  key={role.id}
                  style={[
                    styles.roleCard,
                    isSelected && { borderColor: role.color, backgroundColor: `${role.color}10` },
                  ]}
                  onPress={() => {
                    setSelectedRole(role.id);
                    Haptics.selectionAsync().catch(() => {});
                  }}
                  testID={`role-${role.id}`}
                >
                  <View style={[styles.roleIconWrap, { backgroundColor: isSelected ? role.color : theme.surfaceMuted }]}>
                    <Ionicons name={role.icon} size={24} color={isSelected ? "#fff" : theme.textSecondary} />
                  </View>
                  <Text style={[styles.roleLabel, isSelected && { color: role.color }]}>{t(labelKey)}</Text>
                  <Text style={styles.roleDesc}>{t(descKey)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>

        {/* Form */}
        <Animated.View entering={FadeInUp.delay(200).duration(400)} style={styles.form}>
          {isRegister && selectedRole === "shipper" && (
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t("login.businessName")}</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="storefront-outline" size={20} color={theme.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder={t("login.businessNamePlaceholder")}
                  placeholderTextColor={theme.textSecondary}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  testID="name-input"
                />
              </View>
            </View>
          )}

          {/* Only show email/password for login or shipper registration */}
          {(!isRegister || selectedRole === "shipper") && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t("login.email")}</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="mail-outline" size={20} color={theme.textSecondary} />
                  <TextInput
                    style={styles.input}
                    placeholder={t("login.emailPlaceholder")}
                    placeholderTextColor={theme.textSecondary}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="email-input"
                  />
                </View>
              </View>

              {isRegister && selectedRole === "shipper" && (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t("login.phoneOptional")}</Text>
                  <View style={styles.inputContainer}>
                    <Ionicons name="call-outline" size={20} color={theme.textSecondary} />
                    <TextInput
                      style={styles.input}
                      placeholder={t("login.phonePlaceholder")}
                      placeholderTextColor={theme.textSecondary}
                      value={phone}
                      onChangeText={setPhone}
                      keyboardType="phone-pad"
                      testID="phone-input"
                    />
                  </View>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t("login.password")}</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="lock-closed-outline" size={20} color={theme.textSecondary} />
                  <TextInput
                    style={styles.input}
                    placeholder="••••••••"
                    placeholderTextColor={theme.textSecondary}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    testID="password-input"
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                    <Ionicons 
                      name={showPassword ? "eye-off-outline" : "eye-outline"} 
                      size={20} 
                      color={theme.textSecondary} 
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {!isRegister && (
                <TouchableOpacity style={styles.forgotBtn} testID="forgot-password">
                  <Text style={styles.forgotText}>{t("login.forgotPassword")}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* Driver registration shows a message to go to onboarding */}
          {isRegister && selectedRole === "driver" && (
            <View style={styles.driverRegisterInfo}>
              <Ionicons name="information-circle" size={24} color={theme.primary} />
              <Text style={styles.driverRegisterText}>
                {t("login.driverRegisterInfo")}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: selectedRoleData.color }, loading && styles.submitBtnDisabled]}
            onPress={isRegister ? handleRegister : handleLogin}
            disabled={loading}
            testID="submit-button"
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.submitBtnText}>
                  {isRegister 
                    ? (selectedRole === "driver" ? t("login.startOnboarding") : t("login.createAccountBtn"))
                    : t("login.signIn")}
                </Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchModeBtn}
            onPress={() => {
              setIsRegister(!isRegister);
              setName("");
              setPhone("");
              if (selectedRole === "admin") setSelectedRole("driver");
              Haptics.selectionAsync().catch(() => {});
            }}
            testID="switch-mode"
          >
            <Text style={styles.switchModeText}>
              {isRegister ? t("login.alreadyHaveAccount") : t("login.dontHaveAccount")}
              <Text style={[styles.switchModeHighlight, { color: selectedRoleData.color }]}>
                {isRegister ? t("login.signIn") : t("login.register")}
              </Text>
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Demo Mode */}
        <Animated.View entering={FadeIn.delay(400).duration(400)} style={styles.demoSection}>
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t("login.or")}</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.demoBtn}
            onPress={handleDemoMode}
            testID="demo-mode-button"
          >
            <Ionicons name="play-circle-outline" size={22} color={theme.primary} />
            <Text style={styles.demoBtnText}>{t("login.continueDemoMode")}</Text>
          </TouchableOpacity>
          <Text style={styles.demoNote}>
            {t("login.demoNote")}
          </Text>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: spacing.xl },
  
  header: { alignItems: "center", marginBottom: spacing.xl },
  logoContainer: { marginBottom: spacing.lg },
  logoIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: theme.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: theme.textSecondary,
    marginTop: 6,
  },

  roleSection: { marginBottom: spacing.xl },
  roleSectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  roleGrid: {
    flexDirection: "row",
    gap: 10,
  },
  roleCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: "center",
  },
  roleIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  roleLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.textPrimary,
  },
  roleDesc: {
    fontSize: 10,
    color: theme.textSecondary,
    textAlign: "center",
    marginTop: 2,
  },

  form: {},
  inputGroup: { marginBottom: spacing.lg },
  inputLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.textPrimary,
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: theme.border,
    paddingHorizontal: spacing.md,
    height: 52,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: theme.textPrimary,
  },

  forgotBtn: { alignSelf: "flex-end", marginBottom: spacing.lg },
  forgotText: { color: theme.primary, fontSize: 13, fontWeight: "600" },

  driverRegisterInfo: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: theme.primaryLight,
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    gap: 12,
  },
  driverRegisterText: {
    flex: 1,
    fontSize: 14,
    color: theme.textSecondary,
    lineHeight: 20,
  },

  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: radius.lg,
    gap: 8,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },

  switchModeBtn: { alignItems: "center", marginTop: spacing.lg },
  switchModeText: { fontSize: 14, color: theme.textSecondary },
  switchModeHighlight: { fontWeight: "700" },

  demoSection: { marginTop: spacing.xl },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.border },
  dividerText: {
    paddingHorizontal: spacing.md,
    color: theme.textSecondary,
    fontSize: 13,
  },
  demoBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: theme.primary,
    gap: 8,
  },
  demoBtnText: { color: theme.primary, fontWeight: "700", fontSize: 15 },
  demoNote: {
    fontSize: 12,
    color: theme.textSecondary,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
