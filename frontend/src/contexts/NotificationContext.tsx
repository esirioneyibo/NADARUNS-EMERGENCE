import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";

import { AlertEvent, ALERT_META, playAlertSound, primeAudio, triggerHaptic } from "../services/alerts";

interface BannerData {
  event: AlertEvent;
  title: string;
  body: string;
}

interface NotificationCtx {
  /** Fire an in-app alert: distinct sound + haptic + floating banner. */
  notify: (event: AlertEvent, override?: { title?: string; body?: string }) => void;
}

const Ctx = createContext<NotificationCtx>({ notify: () => {} });

export const useNotify = () => useContext(Ctx);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [banner, setBanner] = useState<BannerData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    primeAudio();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const notify = useCallback<NotificationCtx["notify"]>((event, override) => {
    const meta = ALERT_META[event];
    if (!meta) return;
    playAlertSound(event);
    triggerHaptic(meta.haptic);
    setBanner({
      event,
      title: override?.title || meta.title,
      body: override?.body || meta.body,
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setBanner(null), 4500);
  }, []);

  const meta = banner ? ALERT_META[banner.event] : null;

  return (
    <Ctx.Provider value={{ notify }}>
      {children}
      {banner && meta && (
        <Animated.View
          entering={FadeInUp.duration(260)}
          exiting={FadeOutUp.duration(200)}
          style={[styles.banner, { top: insets.top + 8 }]}
          pointerEvents="box-none"
        >
          <View style={[styles.icon, { backgroundColor: meta.color }]}>
            <Ionicons name={meta.icon as any} size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {banner.title}
            </Text>
            <Text style={styles.body} numberOfLines={2}>
              {banner.body}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setBanner(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        </Animated.View>
      )}
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 14.5, fontWeight: "800", color: "#111827" },
  body: { fontSize: 12.5, color: "#6B7280", marginTop: 2 },
});
