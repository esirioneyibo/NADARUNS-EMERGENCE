import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { registerPushToken } from "../api";

/**
 * Register this device's native push token (FCM/APNs) with the backend, which
 * relays it to the Emergent push service. Native-only; safely no-ops on web.
 *
 * Permission is requested FIRST (respecting canAskAgain), then the device token
 * is fetched and posted to /api/register-push. Any failure is swallowed so push
 * registration never blocks login or app open.
 */
export async function registerForPush(userId: string): Promise<void> {
  if (Platform.OS === "web" || !userId) return;
  try {
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== "granted" && current.canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return;

    const tokenResp = await Notifications.getDevicePushTokenAsync();
    await registerPushToken({
      user_id: userId,
      platform: Platform.OS,
      device_token: String(tokenResp.data),
    });
  } catch (e) {
    console.warn("Push registration failed (non-fatal):", e);
  }
}
