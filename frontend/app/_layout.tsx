import React from "react";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { View, Platform, StyleSheet } from "react-native";
import { ThemeProvider, useTheme } from "../src/contexts/ThemeContext";
import { AuthProvider } from "../src/contexts/AuthContext";

function TabsNavigator() {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  
  // Android needs extra padding for the navigation bar
  // Samsung and other Android phones have software navigation buttons
  const isAndroid = Platform.OS === "android";
  const androidExtraPadding = isAndroid ? 16 : 0;
  const bottomPadding = Math.max(insets.bottom, isAndroid ? 24 : 8) + androidExtraPadding;
  const tabBarHeight = 64 + bottomPadding;

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
            paddingTop: 10,
            paddingBottom: bottomPadding,
            height: tabBarHeight,
            // Ensure tab bar is above Android navigation
            elevation: 8,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "600",
            marginTop: 4,
            marginBottom: isAndroid ? 10 : 0,
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

export default function RootLayout() {
  // @expo/vector-icons automatically loads and registers fonts on native platforms
  // No manual font loading needed - the package handles this internally
  // The web preview may show font errors but native devices should work
  
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
