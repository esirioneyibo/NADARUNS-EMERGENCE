import React from "react";
import {
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from "react-native";
import { useRouter, Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";

import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";
import { useAuth } from "../src/contexts/AuthContext";

const { width } = Dimensions.get("window");

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { isAuthenticated, user, isLoading } = useAuth();
  const { t } = useTranslation();

  const styles = createStyles(theme);

  // Auth guard: a logged-in user must NEVER see the role-selection screen.
  // Even if a back action lands here, immediately redirect to their home.
  if (isLoading) {
    return (
      <View style={[styles.container, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }
  if (isAuthenticated && user) {
    const home =
      user.type === "shipper" ? "/shipper-home" : user.type === "admin" ? "/admin" : "/driver-home";
    return <Redirect href={home} />;
  }

  const handleDriverPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push("/driver-home");
  };

  const handleShipperPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push("/shipper-home");
  };

  const handleLoginPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push("/login");
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
      {/* Logo & Header */}
      <Animated.View entering={FadeInDown.duration(500)} style={styles.header}>
        <View style={styles.logoContainer}>
          <View style={styles.logo}>
            <Ionicons name="flash" size={40} color="#fff" />
          </View>
        </View>
        <Text style={styles.appName}>NadaRuns</Text>
        <Text style={styles.tagline}>{t("welcome.tagline")}</Text>
      </Animated.View>

      {/* Role Selection */}
      <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.roleSection}>
        <Text style={styles.sectionTitle}>{t("welcome.howToUse")}</Text>

        {/* Driver Card */}
        <TouchableOpacity
          style={[styles.roleCard, styles.driverCard]}
          onPress={handleDriverPress}
          activeOpacity={0.9}
          testID="driver-role-button"
        >
          <View style={styles.roleCardContent}>
            <View style={[styles.roleIconContainer, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
              <Ionicons name="bicycle" size={36} color="#fff" />
            </View>
            <View style={styles.roleTextContainer}>
              <Text style={styles.roleTitle}>{t("welcome.driverTitle")}</Text>
              <Text style={styles.roleDescription}>
                {t("welcome.driverDescription")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="rgba(255,255,255,0.8)" />
          </View>
          <View style={styles.roleFeatures}>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={16} color="rgba(255,255,255,0.9)" />
              <Text style={styles.featureText}>{t("welcome.driverFeature1")}</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={16} color="rgba(255,255,255,0.9)" />
              <Text style={styles.featureText}>{t("welcome.driverFeature2")}</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={16} color="rgba(255,255,255,0.9)" />
              <Text style={styles.featureText}>{t("welcome.driverFeature3")}</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Shipper/Business Card */}
        <TouchableOpacity
          style={[styles.roleCard, styles.shipperCard]}
          onPress={handleShipperPress}
          activeOpacity={0.9}
          testID="shipper-role-button"
        >
          <View style={styles.roleCardContent}>
            <View style={[styles.roleIconContainer, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
              <Ionicons name="storefront" size={36} color="#fff" />
            </View>
            <View style={styles.roleTextContainer}>
              <Text style={styles.roleTitle}>{t("welcome.businessTitle")}</Text>
              <Text style={styles.roleDescription}>
                {t("welcome.businessDescription")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="rgba(255,255,255,0.8)" />
          </View>
          <View style={styles.roleFeatures}>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={16} color="rgba(255,255,255,0.9)" />
              <Text style={styles.featureText}>{t("welcome.businessFeature1")}</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={16} color="rgba(255,255,255,0.9)" />
              <Text style={styles.featureText}>{t("welcome.businessFeature2")}</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={16} color="rgba(255,255,255,0.9)" />
              <Text style={styles.featureText}>{t("welcome.businessFeature3")}</Text>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>

      {/* Footer */}
      <Animated.View entering={FadeIn.delay(400).duration(500)} style={styles.footer}>
        <Text style={styles.footerText}>{t("welcome.alreadyHaveAccount")}</Text>
        <TouchableOpacity onPress={handleLoginPress} testID="login-button">
          <Text style={styles.loginLink}>{t("common.signIn")}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
    paddingHorizontal: spacing.xl,
  },

  header: {
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  logoContainer: {
    marginBottom: spacing.lg,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.lg,
  },
  appName: {
    fontSize: 32,
    fontWeight: "900",
    color: theme.textPrimary,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 16,
    color: theme.textSecondary,
    marginTop: 4,
  },

  roleSection: {
    flex: 1,
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.textPrimary,
    textAlign: "center",
    marginBottom: spacing.xl,
  },

  roleCard: {
    borderRadius: radius.xxl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.lg,
  },
  driverCard: {
    backgroundColor: "#10B981", // Green for drivers
  },
  shipperCard: {
    backgroundColor: "#6366F1", // Purple/indigo for business
  },
  roleCardContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  roleIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  roleTextContainer: {
    flex: 1,
  },
  roleTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fff",
  },
  roleDescription: {
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
    marginTop: 4,
    lineHeight: 18,
  },

  roleFeatures: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.2)",
    gap: 12,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  featureText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.9)",
    fontWeight: "600",
  },

  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.lg,
  },
  footerText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  loginLink: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.primary,
  },
});
