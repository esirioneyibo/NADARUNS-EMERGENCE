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

import { api, setAuthToken } from "../src/api";
import { useAuth } from "../src/contexts/AuthContext";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { login } = useAuth();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const styles = createStyles(theme);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Please enter both email and password");
      return;
    }
    
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    
    try {
      const response = await api.login(email.trim(), password);
      
      // Set token for API calls
      setAuthToken(response.token);
      
      // Save auth state
      await login(response.token, {
        id: response.driver_id,
        name: response.name,
        email: email.trim(),
        type: "driver",
      });
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      
      // Navigate to home
      router.replace("/");
    } catch (error: any) {
      const message = error?.message || "Login failed. Please check your credentials.";
      Alert.alert("Login Failed", message);
    } finally {
      setLoading(false);
    }
  };

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
            <View style={styles.logoIcon}>
              <Ionicons name="flash" size={32} color="#fff" />
            </View>
          </View>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to continue delivering with NadaRuns</Text>
        </Animated.View>

        {/* Form */}
        <Animated.View entering={FadeInUp.delay(200).duration(400)} style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={20} color={theme.textSecondary} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={theme.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                testID="login-email-input"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color={theme.textSecondary} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor={theme.textSecondary}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                testID="login-password-input"
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

          <TouchableOpacity style={styles.forgotBtn}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.loginBtn, loading && { opacity: 0.7 }]}
            onPress={handleLogin}
            disabled={loading}
            testID="login-submit-button"
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.loginBtnText}>Sign In</Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Footer */}
        <Animated.View entering={FadeInUp.delay(400).duration(400)} style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account?</Text>
          <TouchableOpacity onPress={() => router.push("/onboarding")} testID="signup-link">
            <Text style={styles.signupLink}>Sign up</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Demo hint */}
        <Animated.View entering={FadeInUp.delay(500).duration(400)} style={styles.demoHint}>
          <Ionicons name="information-circle-outline" size={16} color={theme.textSecondary} />
          <Text style={styles.demoText}>
            Demo: Register a new account to test authentication
          </Text>
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
    justifyContent: "center",
  },
  header: {
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  logoContainer: {
    marginBottom: spacing.xl,
  },
  logoIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.lg,
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
    marginTop: 8,
    textAlign: "center",
  },
  form: {
    marginBottom: spacing.xl,
  },
  inputGroup: {
    marginBottom: spacing.lg,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.textSecondary,
    marginBottom: 8,
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
    paddingVertical: 16,
    fontSize: 16,
    fontWeight: "600",
    color: theme.textPrimary,
  },
  forgotBtn: {
    alignSelf: "flex-end",
    marginBottom: spacing.xl,
  },
  forgotText: {
    fontSize: 14,
    color: theme.primary,
    fontWeight: "600",
  },
  loginBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.primary,
    paddingVertical: 18,
    borderRadius: radius.lg,
    gap: 8,
    ...shadows.md,
  },
  loginBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 17,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.lg,
  },
  footerText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  signupLink: {
    fontSize: 14,
    color: theme.primary,
    fontWeight: "700",
  },
  demoHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  demoText: {
    fontSize: 12,
    color: theme.textSecondary,
    textAlign: "center",
  },
});
