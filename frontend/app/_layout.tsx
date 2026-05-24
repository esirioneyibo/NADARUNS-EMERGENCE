import React, { useEffect, useState } from "react";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Font from "expo-font";
import { View, ActivityIndicator, Platform } from "react-native";
import { ThemeProvider, useTheme } from "../src/contexts/ThemeContext";
import { AuthProvider } from "../src/contexts/AuthContext";

function TabsNavigator() {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  
  // Calculate proper bottom padding based on device safe area
  const bottomPadding = Math.max(insets.bottom, 8);
  const tabBarHeight = 56 + bottomPadding;

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
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "600",
            marginTop: 2,
            marginBottom: 0,
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
        <Tabs.Screen
          name="order"
          options={{
            href: null,
            tabBarStyle: { display: "none" },
          }}
        />
        <Tabs.Screen
          name="summary"
          options={{
            href: null,
            tabBarStyle: { display: "none" },
          }}
        />
        <Tabs.Screen
          name="kyc"
          options={{
            href: null,
            tabBarStyle: { display: "none" },
          }}
        />
        <Tabs.Screen
          name="onboarding"
          options={{
            href: null,
            tabBarStyle: { display: "none" },
          }}
        />
        <Tabs.Screen
          name="login"
          options={{
            href: null,
            tabBarStyle: { display: "none" },
          }}
        />
        <Tabs.Screen
          name="+html"
          options={{
            href: null,
          }}
        />
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
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    // On native platforms, @expo/vector-icons loads fonts automatically
    // We only need to ensure the app is ready
    async function prepare() {
      try {
        // For native Android/iOS, vector icons are bundled and load automatically
        // No need to explicitly load Ionicons.font which can cause issues
        if (Platform.OS === "web") {
          // Only load fonts explicitly on web if needed
          await Font.loadAsync({
            ...Ionicons.font,
          });
        }
      } catch (e) {
        // Font loading failed but we can continue - icons may fallback
        console.warn("Font loading warning:", e);
      } finally {
        setFontsLoaded(true);
      }
    }
    prepare();
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F8FAFC" }}>
        <ActivityIndicator size="large" color="#0C4A42" />
      </View>
    );
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
