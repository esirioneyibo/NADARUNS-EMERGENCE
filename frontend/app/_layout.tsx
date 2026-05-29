import React, { useEffect, useCallback, useState } from "react";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as SplashScreen from "expo-splash-screen";
import { View, Platform, StyleSheet, Text, ActivityIndicator } from "react-native";
import { ThemeProvider, useTheme } from "../src/contexts/ThemeContext";
import { AuthProvider } from "../src/contexts/AuthContext";

// Prevent splash screen from auto-hiding until app is ready
SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore errors if splash screen is already hidden
});

function TabsNavigator() {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  
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
        {/* Welcome/Role Selection Screen - No tab bar */}
        <Tabs.Screen
          name="index"
          options={{
            href: null,
            tabBarStyle: { display: "none" },
          }}
        />
        
        {/* Driver App Screens */}
        <Tabs.Screen
          name="driver-home"
          options={{
            title: "Home",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: "History",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="time-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="wallet"
          options={{
            title: "Wallet",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="wallet-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Profile",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-outline" size={size} color={color} />
            ),
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
        <Tabs.Screen name="shipper-home" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="shipper-login" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="shipper-create" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="shipper-tracking" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="shipper-settings" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="admin" options={{ href: null, tabBarStyle: { display: "none" } }} />
      </Tabs>
    </>
  );
}

function AppContent() {
  const { theme } = useTheme();
  
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.background }}>
      <SafeAreaProvider>
        <TabsNavigator />
      </SafeAreaProvider>
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
      <AuthProvider>
        <AppContent />
      </AuthProvider>
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
