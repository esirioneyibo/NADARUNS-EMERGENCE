import React, { useState } from "react";
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
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";

import { friendlyError, setAuthToken } from "../src/api";
import { useAuth } from "../src/contexts/AuthContext";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function ShipperLoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { login } = useAuth();
  const { t } = useTranslation();
  
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const styles = createStyles(theme);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert(t("shipperLogin.errorTitle"), t("shipperLogin.errorEmailPassword"));
      return;
    }
    
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    
    try {
      const res = await fetch(`${BASE}/api/auth/shipper-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(friendlyError(res.status, txt));
      }
      
      const data = await res.json();
      
      setAuthToken(data.token);
      await login(data.token, {
        id: data.driver_id,
        name: data.name,
        email: email.trim(),
        type: "shipper",
      });
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace("/shipper-home");
    } catch (error: any) {
      const msg =
        error?.message === "Network request failed" || error?.name === "TypeError"
          ? t("shipperLogin.networkError")
          : error?.message || t("shipperLogin.loginFailedMsg");
      Alert.alert(t("shipperLogin.loginFailedTitle"), msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!companyName.trim() || !contactName.trim() || !email.trim() || !phone.trim() || !password.trim()) {
      Alert.alert(t("shipperLogin.errorTitle"), t("shipperLogin.errorAllFields"));
      return;
    }
    
    if (password.length < 6) {
      Alert.alert(t("shipperLogin.errorTitle"), t("shipperLogin.errorPasswordMin"));
      return;
    }
    
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    
    try {
      const res = await fetch(`${BASE}/api/shipper/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          contact_name: contactName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          password,
        }),
      });
      
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(friendlyError(res.status, txt));
      }
      
      const data = await res.json();
      
      setAuthToken(data.token);
      await login(data.token, {
        id: data.shipper_id,
        name: companyName.trim(),
        email: email.trim(),
        type: "shipper",
      });
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(t("shipperLogin.successTitle"), t("shipperLogin.accountCreated"), [
        { text: t("shipperLogin.continue"), onPress: () => router.replace("/shipper-home") }
      ]);
    } catch (error: any) {
      const msg =
        error?.message === "Network request failed" || error?.name === "TypeError"
          ? t("shipperLogin.networkError")
          : error?.message || t("shipperLogin.registrationFailedMsg");
      Alert.alert(t("shipperLogin.registrationFailedTitle"), msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { paddingTop: insets.top }]} 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      testID="shipper-login-screen"
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back to role selection */}
        <TouchableOpacity 
          style={styles.backBtn} 
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>

        {/* Header */}
        <Animated.View entering={FadeInDown.duration(400)} style={styles.header}>
          <View style={styles.logoContainer}>
            <View style={styles.logoIcon}>
              <Ionicons name="business" size={32} color="#fff" />
            </View>
          </View>
          <Text style={styles.title}>
            {isLogin ? t("shipperLogin.businessLogin") : t("shipperLogin.registerBusiness")}
          </Text>
          <Text style={styles.subtitle}>
            {isLogin 
              ? t("shipperLogin.signInSubtitle")
              : t("shipperLogin.registerSubtitle")
            }
          </Text>
        </Animated.View>

        {/* Form */}
        <Animated.View entering={FadeInUp.delay(200).duration(400)} style={styles.form}>
          {!isLogin && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t("shipperLogin.companyName")}</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="business-outline" size={20} color={theme.textSecondary} />
                  <TextInput
                    style={styles.input}
                    value={companyName}
                    onChangeText={setCompanyName}
                    placeholder={t("shipperLogin.companyNamePlaceholder")}
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t("shipperLogin.contactName")}</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="person-outline" size={20} color={theme.textSecondary} />
                  <TextInput
                    style={styles.input}
                    value={contactName}
                    onChangeText={setContactName}
                    placeholder={t("shipperLogin.contactNamePlaceholder")}
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t("shipperLogin.phone")}</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="call-outline" size={20} color={theme.textSecondary} />
                  <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="+358 40 123 4567"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>
            </>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{t("shipperLogin.email")}</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={20} color={theme.textSecondary} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder={t("shipperLogin.emailPlaceholder")}
                placeholderTextColor={theme.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{t("shipperLogin.password")}</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color={theme.textSecondary} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={isLogin ? t("shipperLogin.passwordPlaceholderLogin") : t("shipperLogin.passwordPlaceholderRegister")}
                placeholderTextColor={theme.textSecondary}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
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

          <TouchableOpacity
            style={[styles.submitBtn, loading && { opacity: 0.7 }]}
            onPress={isLogin ? handleLogin : handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.submitBtnText}>
                  {isLogin ? t("shipperLogin.signIn") : t("shipperLogin.createAccount")}
                </Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Toggle */}
        <Animated.View entering={FadeInUp.delay(400).duration(400)} style={styles.footer}>
          <Text style={styles.footerText}>
            {isLogin ? t("shipperLogin.noAccount") : t("shipperLogin.haveAccount")}
          </Text>
          <TouchableOpacity onPress={() => setIsLogin(!isLogin)}>
            <Text style={styles.toggleLink}>
              {isLogin ? t("shipperLogin.register") : t("shipperLogin.signIn")}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { 
    flexGrow: 1, 
    paddingHorizontal: spacing.xl,
  },
  backBtn: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  header: {
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  logoContainer: {
    marginBottom: spacing.lg,
  },
  logoIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "#6366F1",
    alignItems: "center",
    justifyContent: "center",
    ...shadows.lg,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: theme.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginTop: 6,
    textAlign: "center",
  },
  form: {
    marginBottom: spacing.xl,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.textSecondary,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderColor: theme.border,
    gap: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: "600",
    color: theme.textPrimary,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6366F1",
    paddingVertical: 16,
    borderRadius: radius.lg,
    gap: 8,
    marginTop: spacing.lg,
    ...shadows.md,
  },
  submitBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  footerText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  toggleLink: {
    fontSize: 14,
    color: "#6366F1",
    fontWeight: "700",
  },
  driverLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
  },
  driverLinkText: {
    fontSize: 14,
    color: theme.primary,
    fontWeight: "600",
  },
});
