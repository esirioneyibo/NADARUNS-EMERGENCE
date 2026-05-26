import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Request permission and get the Expo push token
 */
export async function registerForPushNotifications(): Promise<string | null> {
  let token: string | null = null;

  // Must use physical device for push notifications
  if (!Device.isDevice) {
    console.log('[Notifications] Must use physical device for push notifications');
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permission if not granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Notifications] Permission not granted');
    return null;
  }

  // Get Expo push token
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    
    if (!projectId) {
      console.log('[Notifications] No project ID found, using development token');
      // For development, generate a mock token
      token = `ExponentPushToken[development-${Date.now()}]`;
    } else {
      const pushToken = await Notifications.getExpoPushTokenAsync({
        projectId,
      });
      token = pushToken.data;
    }
    
    console.log('[Notifications] Push token:', token);
  } catch (error) {
    console.error('[Notifications] Error getting push token:', error);
  }

  // Android-specific channel setup
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0C4A42',
    });

    await Notifications.setNotificationChannelAsync('orders', {
      name: 'Orders',
      description: 'Notifications about new orders and deliveries',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 500, 200, 500],
      lightColor: '#10B981',
    });

    await Notifications.setNotificationChannelAsync('chat', {
      name: 'Messages',
      description: 'Chat messages from customers and drivers',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250],
      lightColor: '#6366F1',
    });
  }

  return token;
}

/**
 * Register the push token with the backend
 */
export async function registerPushTokenWithBackend(
  token: string,
  userId: string,
  userType: 'driver' | 'shipper'
): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/api/notifications/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        push_token: token,
        user_id: userId,
        user_type: userType,
        platform: Platform.OS,
      }),
    });

    if (response.ok) {
      console.log('[Notifications] Token registered with backend');
      return true;
    } else {
      console.error('[Notifications] Failed to register token');
      return false;
    }
  } catch (error) {
    console.error('[Notifications] Error registering token:', error);
    return false;
  }
}

/**
 * Listen for incoming notifications
 */
export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void
) {
  return Notifications.addNotificationReceivedListener(callback);
}

/**
 * Listen for notification responses (when user taps notification)
 */
export function addNotificationResponseListener(
  callback: (response: Notifications.NotificationResponse) => void
) {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

/**
 * Schedule a local notification (for testing or offline alerts)
 */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: Record<string, any>,
  seconds: number = 1
) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data || {},
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
    },
  });
}

/**
 * Cancel all scheduled notifications
 */
export async function cancelAllNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Get the badge count
 */
export async function getBadgeCount(): Promise<number> {
  return await Notifications.getBadgeCountAsync();
}

/**
 * Set the badge count
 */
export async function setBadgeCount(count: number) {
  await Notifications.setBadgeCountAsync(count);
}

export default {
  registerForPushNotifications,
  registerPushTokenWithBackend,
  addNotificationReceivedListener,
  addNotificationResponseListener,
  scheduleLocalNotification,
  cancelAllNotifications,
  getBadgeCount,
  setBadgeCount,
};
