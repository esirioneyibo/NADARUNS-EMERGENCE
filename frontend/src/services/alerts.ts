import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

// expo-audio is native + web capable. Require defensively so a load hiccup
// never crashes the app (sound is an enhancement, not a hard dependency).
let createAudioPlayer: any = null;
let setAudioModeAsync: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const audio = require("expo-audio");
  createAudioPlayer = audio.createAudioPlayer;
  setAudioModeAsync = audio.setAudioModeAsync;
} catch {
  /* audio unavailable - alerts fall back to banner + haptics only */
}

export type AlertEvent =
  | "new_job"
  | "job_accepted"
  | "driver_assigned"
  | "arrived_pickup"
  | "arrived_dropoff"
  | "delivered";

// Distinct bundled tone per event.
const SOURCES: Record<AlertEvent, any> = {
  new_job: require("../../assets/sounds/new_job.wav"),
  job_accepted: require("../../assets/sounds/job_accepted.wav"),
  driver_assigned: require("../../assets/sounds/driver_assigned.wav"),
  arrived_pickup: require("../../assets/sounds/arrived_pickup.wav"),
  arrived_dropoff: require("../../assets/sounds/arrived_dropoff.wav"),
  delivered: require("../../assets/sounds/delivered.wav"),
};

export const ALERT_META: Record<
  AlertEvent,
  { title: string; body: string; icon: string; color: string; haptic: "success" | "warning" | "light" }
> = {
  new_job: {
    title: "New job available",
    body: "A delivery request just came in near you.",
    icon: "cube",
    color: "#F59E0B",
    haptic: "warning",
  },
  job_accepted: {
    title: "Job accepted",
    body: "You're on the way — drive safe!",
    icon: "checkmark-circle",
    color: "#10B981",
    haptic: "success",
  },
  driver_assigned: {
    title: "Driver assigned",
    body: "A driver is on the way to your pickup.",
    icon: "car",
    color: "#6366F1",
    haptic: "success",
  },
  arrived_pickup: {
    title: "Driver at pickup",
    body: "Your driver has arrived at the pickup location.",
    icon: "location",
    color: "#FF6B35",
    haptic: "light",
  },
  arrived_dropoff: {
    title: "Arrived at drop-off",
    body: "Your driver has arrived at the drop-off location.",
    icon: "flag",
    color: "#10B981",
    haptic: "light",
  },
  delivered: {
    title: "Delivered",
    body: "The shipment has been delivered successfully.",
    icon: "checkmark-done",
    color: "#22C55E",
    haptic: "success",
  },
};

const players: Partial<Record<AlertEvent, any>> = {};
let audioPrimed = false;

/** Allow alert sounds to play even when the device is on silent (native only). */
export async function primeAudio() {
  if (audioPrimed) return;
  audioPrimed = true;
  if (Platform.OS !== "web" && setAudioModeAsync) {
    try {
      await setAudioModeAsync({ playsInSilentMode: true });
    } catch {
      /* non-fatal */
    }
  }
}

export function playAlertSound(event: AlertEvent) {
  try {
    if (!createAudioPlayer || !SOURCES[event]) return;
    let p = players[event];
    if (!p) {
      p = createAudioPlayer(SOURCES[event]);
      players[event] = p;
    }
    try {
      p.seekTo(0);
    } catch {
      /* some platforms can't seek before first play */
    }
    p.play();
  } catch {
    /* never let a sound failure break the flow */
  }
}

export function triggerHaptic(kind: "success" | "warning" | "light") {
  if (Platform.OS === "web") return;
  try {
    if (kind === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === "warning") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    /* non-fatal */
  }
}
