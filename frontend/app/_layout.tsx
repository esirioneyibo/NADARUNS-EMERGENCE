import React, { useEffect, useCallback, useState } from "react";
import { Tabs, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import { View, Platform, StyleSheet, Text, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { ThemeProvider, useTheme } from "../src/contexts/ThemeContext";
import { AuthProvider, useAuth } from "../src/contexts/AuthContext";
import { NotificationProvider } from "../src/contexts/NotificationContext";
import { LanguageProvider } from "../src/contexts/LanguageContext";
import "../src/i18n";

// Prevent splash screen from auto-hiding until app is ready
SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore errors if splash screen is already hidden
});

// ---- Background push (Emergent / SuprSend) — module scope, before any component ----
// Foreground handler: on Android suppress raw SuprSend data-only push (the native
// SuprSendMessagingService renders it in every app state); show iOS normally.
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data || {};
      if (Platform.OS === "android" && typeof data.supr_send_n_pl === "string") {
        return {
          shouldShowAlert: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: false,
          shouldShowList: false,
        };
      }
      return {
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      };
    },
  });
}

if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  }).catch(() => {});
}

function resolveDeeplink(data: Record<string, any>): string | undefined {
  let url = data.deeplink || data.action_url;
  if (!url && typeof data.supr_send_n_pl === "string") {
    try {
      const parsed = JSON.parse(data.supr_send_n_pl);
      url = parsed.deeplink || parsed.action_url;
    } catch {
      /* ignore malformed payload */
    }
  }
  return url;
}

function TabsNavigator() {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { user } = useAuth();
  const { t } = useTranslation();

  // Role-aware tabs: drivers and shippers each get their own bottom navigation.
  const role = user?.type;
  const isDriver = role === "driver";
  const isShipper = role === "shipper";
  
  // Simplified padding - use system insets directly
  // Add small extra padding for better visual spacing
  const bottomPadding = insets.bottom + 8;
  const tabBarHeight = 60 + bottomPadding;

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: theme.textSecondary,
          tabBarStyle: {
            backgroundColor: theme.surface,
            borderTopColor: theme.border,
            borderTopWidth: 1,
            paddingTop: 8,
            paddingBottom: bottomPadding,
            height: tabBarHeight,
            elevation: 8,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "600",
            marginTop: 2,
          },
          tabBarIconStyle: {
            marginTop: 4,
          },
        }}
      >
        {/* Welcome/Role Selection Screen - never in tab bar */}
        <Tabs.Screen
          name="index"
          options={{ href: null, tabBarStyle: { display: "none" } }}
        />

        {/* ---------- Driver tabs ---------- */}
        <Tabs.Screen
          name="driver-home"
          options={{
            title: t("tabs.home"),
            href: isDriver ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: t("tabs.history"),
            href: isDriver ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="wallet"
          options={{
            title: t("tabs.wallet"),
            href: isDriver ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t("tabs.profile"),
            href: isDriver ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
          }}
        />

        {/* ---------- Shipper (Business) tabs ---------- */}
        <Tabs.Screen
          name="shipper-home"
          options={{
            title: t("tabs.home"),
            href: isShipper ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="shipper-create"
          options={{
            title: t("tabs.new"),
            href: isShipper ? undefined : null,
            // Full-screen wizard: hide the tab bar while creating a shipment
            // so it doesn't collide with the wizard's fixed bottom action bar.
            tabBarStyle: { display: "none" },
            tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" size={size + 4} color={color} />,
          }}
        />
        <Tabs.Screen
          name="shipper-settings"
          options={{
            title: t("tabs.profile"),
            href: isShipper ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
          }}
        />

        {/* Hidden screens - accessible via navigation but not in tab bar */}
        <Tabs.Screen name="order" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="earnings" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="summary" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="kyc" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="onboarding" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="login" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="chat" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="shipper-login" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="shipper-tracking" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="shipper-payment-methods" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="admin" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="driver-edit" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="driver-vehicles" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="shipper-edit" options={{ href: null, tabBarStyle: { display: "none" } }} />
      </Tabs>
    </>
  );
}

function AppContent() {
  const { theme } = useTheme();
  
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <NotificationProvider>
            <TabsNavigator />
          </NotificationProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

// Loading screen component
function LoadingScreen() {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#0C4A42" />
      <Text style={styles.loadingText}>Loading NadaRuns...</Text>
    </View>
  );
}

export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  const router = useRouter();

  // Background-push tap handling (native only): route via deeplink/action_url.
  useEffect(() => {
    if (Platform.OS === "web") return;

    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data || {};
      const url = resolveDeeplink(data);
      if (!url) return;
      url.startsWith("http") ? Linking.openURL(url) : router.push(url);
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data || {};
      const url = resolveDeeplink(data);
      if (!url) return;
      url.startsWith("http") ? Linking.openURL(url) : router.push(url);
    });

    return () => {
      tapSub.remove();
    };
  }, [router]);

  // Hide splash screen after a short delay to ensure icons are loaded
  // @expo/vector-icons handles Ionicons font loading internally
  useEffect(() => {
    async function prepare() {
      try {
        // Give vector icons time to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (e) {
        console.warn('App initialization warning:', e);
      } finally {
        setAppIsReady(true);
      }
    }
    prepare();
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (appIsReady) {
      await SplashScreen.hideAsync().catch(() => {});
    }
  }, [appIsReady]);

  useEffect(() => {
    onLayoutRootView();
  }, [onLayoutRootView]);

  // Show loading screen until app is ready
  if (!appIsReady) {
    return <LoadingScreen />;
  }

  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
  loadingText: {
    marginTop: 16,
    color: "#64748B",
    fontSize: 14,
    fontWeight: "500",
  },
});
