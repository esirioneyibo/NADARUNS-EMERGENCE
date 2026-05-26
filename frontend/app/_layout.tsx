import React, { useEffect, useCallback } from "react";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { View, Platform, StyleSheet, Text, ActivityIndicator } from "react-native";
import { ThemeProvider, useTheme } from "../src/contexts/ThemeContext";
import { AuthProvider } from "../src/contexts/AuthContext";

// Prevent splash screen from auto-hiding until fonts are loaded
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
        <Tabs.Screen
          name="index"
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
        <Tabs.Screen name="summary" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="kyc" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="onboarding" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="login" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="shipper-home" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="shipper-login" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="shipper-create" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="shipper-tracking" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="admin" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="+html" options={{ href: null }} />
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
  // CRITICAL: Preload Ionicons font before rendering any UI
  // This prevents the "white circles" issue on Android
  const [fontsLoaded, fontError] = useFonts({
    // Load Ionicons directly from the @expo/vector-icons package
    // This is the correct path that works in Expo Go on both iOS and Android
    ...Ionicons.font,
  });

  // Hide splash screen once fonts are loaded
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    onLayoutRootView();
  }, [onLayoutRootView]);

  // Log font errors for debugging but don't block the app
  useEffect(() => {
    if (fontError) {
      console.warn('Font loading error:', fontError.message);
    }
  }, [fontError]);

  // IMPORTANT: Return null/loading while fonts are loading
  // This ensures icons are ready before UI renders
  if (!fontsLoaded && !fontError) {
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
