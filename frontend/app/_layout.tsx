import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { View, ActivityIndicator } from "react-native";
import { theme } from "../src/theme";

export default function RootLayout() {
  // Explicitly preload Ionicons font to avoid Expo Go race condition
  // ("Font file for ionicons is empty" CodedError on cold start over tunnel)
  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
  });

  // Render anyway after font attempt — if it fails, icons will fall back
  // to whatever the system can render rather than blocking the whole app.
  if (!fontsLoaded && !fontError) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.background }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.background },
            animation: "fade",
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
