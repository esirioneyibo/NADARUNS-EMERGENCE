import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

import { api, getAuthToken } from "../src/api";
import { calculatePrice, haversineKm } from "../src/utils/pricing";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";
import { storage } from "../src/utils/storage";
import MapLocationPicker from "../src/components/MapLocationPicker";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

const ACCENT = "#6366F1";
const PICKUP_COLOR = "#FF6B35";
const DROPOFF_COLOR = "#10B981";

const DRAFT_KEY = "shipper_create_draft_v1";
const SAVED_ADDR_KEY = "shipper_saved_addresses_v1";

const STEPS = [
  { id: 1, label: "Pickup" },
  { id: 2, label: "Dropoff" },
  { id: 3, label: "Package" },
  { id: 4, label: "Price" },
  { id: 5, label: "When" },
  { id: 6, label: "Review" },
];
const TOTAL_STEPS = STEPS.length;

// Logistics Vehicle Types for Shippers
const VEHICLE_CATEGORIES = [
  {
    category: "Medium Vehicles",
    vehicles: [
      { id: "cargo_van", name: "Cargo Van", icon: "car", capacity: "Up to 1,500 kg", maxWeight: 1500 },
      { id: "box_truck", name: "Box Truck", icon: "bus", capacity: "Up to 5,000 kg", maxWeight: 5000 },
      { id: "flatbed_truck", name: "Flatbed", icon: "train", capacity: "Up to 8,000 kg", maxWeight: 8000 },
    ],
  },
  {
    category: "Heavy Vehicles",
    vehicles: [
      { id: "semi_truck", name: "Semi-Truck", icon: "bus", capacity: "Up to 20,000 kg", maxWeight: 20000 },
      { id: "trailer_truck", name: "Trailer Truck", icon: "train", capacity: "Up to 25,000 kg", maxWeight: 25000 },
      { id: "container_truck", name: "Container", icon: "cube", capacity: "Up to 30,000 kg", maxWeight: 30000 },
      { id: "tanker", name: "Tanker", icon: "water", capacity: "Up to 35,000 kg", maxWeight: 35000 },
    ],
  },
  {
    category: "Specialized",
    vehicles: [
      { id: "refrigerated", name: "Refrigerated", icon: "snow", capacity: "Up to 15,000 kg", maxWeight: 15000 },
      { id: "crane_truck", name: "Crane Truck", icon: "construct", capacity: "Up to 12,000 kg", maxWeight: 12000 },
      { id: "hazmat", name: "Hazmat", icon: "warning", capacity: "Up to 18,000 kg", maxWeight: 18000 },
    ],
  },
  {
    category: "Other",
    vehicles: [
      { id: "other", name: "Other", icon: "ellipsis-horizontal", capacity: "Custom", maxWeight: 10000 },
    ],
  },
];
const ALL_VEHICLES = VEHICLE_CATEGORIES.flatMap((cat) => cat.vehicles);
const getVehicle = (id: string) => ALL_VEHICLES.find((v) => v.id === id) || ALL_VEHICLES[0];

const CARGO_TYPES = [
  { id: "general", name: "General", icon: "cube-outline" },
  { id: "fragile", name: "Fragile", icon: "wine-outline" },
  { id: "perishable", name: "Perishable", icon: "snow-outline" },
  { id: "hazardous", name: "Hazardous", icon: "warning-outline" },
  { id: "liquid", name: "Liquid", icon: "water-outline" },
  { id: "oversized", name: "Oversized", icon: "resize-outline" },
];

const SPECIAL_REQUIREMENTS = [
  { id: "tail_lift", name: "Tail lift", icon: "swap-vertical-outline" },
  { id: "forklift", name: "Forklift", icon: "construct-outline" },
  { id: "straps", name: "Straps", icon: "git-merge-outline" },
  { id: "refrigeration", name: "Refrigeration", icon: "snow-outline" },
  { id: "hazmat_certified", name: "Hazmat cert.", icon: "shield-outline" },
  { id: "covered_transport", name: "Covered", icon: "umbrella-outline" },
];

// Simple unique id for the Idempotency-Key header (avoids duplicate jobs on retry)
const genId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// Build scheduling preset slots relative to "now".
const buildScheduleSlots = () => {
  const now = new Date();
  const at = (d: Date) => d.toISOString();
  const plus = (mins: number) => {
    const d = new Date(now.getTime() + mins * 60000);
    return d;
  };
  const todayAt = (h: number) => {
    const d = new Date(now);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const tomorrowAt = (h: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const slots: { id: string; label: string; sub: string; iso: string | null }[] = [
    { id: "asap", label: "As soon as possible", sub: "Driver assigned immediately", iso: null },
    { id: "1h", label: "In 1 hour", sub: plus(60).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), iso: at(plus(60)) },
    { id: "2h", label: "In 2 hours", sub: plus(120).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), iso: at(plus(120)) },
  ];
  if (now.getHours() < 18) {
    slots.push({ id: "evening", label: "This evening", sub: "18:00", iso: at(todayAt(18)) });
  }
  slots.push({ id: "tmrw_am", label: "Tomorrow morning", sub: "09:00", iso: at(tomorrowAt(9)) });
  slots.push({ id: "tmrw_pm", label: "Tomorrow afternoon", sub: "14:00", iso: at(tomorrowAt(14)) });
  slots.push({ id: "custom", label: "Pick a date & time", sub: "Choose an exact day and time", iso: null });
  return slots;
};

// Next 14 selectable days for the custom scheduler.
const buildDayOptions = () => {
  const days: { id: string; label: string; date: Date }[] = [];
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(0, 0, 0, 0);
    const label =
      i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    days.push({ id: d.toISOString().slice(0, 10), label, date: d });
  }
  return days;
};

// 06:00 → 21:30 in 30-minute steps.
const buildTimeOptions = () => {
  const times: string[] = [];
  for (let h = 6; h <= 21; h++) {
    for (const m of [0, 30]) {
      times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return times;
};

type Coords = { latitude: number; longitude: number } | null;

interface Quote {
  distance_km: number;
  estimated_duration_minutes: number;
  base_price: number;
  weight_surcharge: number;
  total_price: number;
  base_fee?: number;
  distance_fee?: number;
  weight_fee?: number;
  fuel_surcharge?: number;
  estimate_low?: number;
  estimate_high?: number;
}

export default function ShipperCreateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  // Pay Now / Accept Invoice choice modal (shown after a shipment is created)
  const [payChoice, setPayChoice] = useState<{ orderId: string; orderNum: string; total: number } | null>(null);
  const [payBusy, setPayBusy] = useState<null | "pay" | "invoice">(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const idempotencyKey = useRef<string>(genId());
  // Refs for auto-advancing focus to the next field within a step.
  const pickupPhoneRef = useRef<TextInput>(null);
  const dropoffPhoneRef = useRef<TextInput>(null);
  const cargoDescRef = useRef<TextInput>(null);

  // Pickup
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupCoords, setPickupCoords] = useState<Coords>(null);
  const [pickupName, setPickupName] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");
  const [pickupNotes, setPickupNotes] = useState("");

  // Dropoff
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [dropoffCoords, setDropoffCoords] = useState<Coords>(null);
  const [dropoffName, setDropoffName] = useState("");
  const [dropoffPhone, setDropoffPhone] = useState("");
  const [dropoffNotes, setDropoffNotes] = useState("");

  // Package
  const [vehicleType, setVehicleType] = useState("cargo_van");
  const [cargoWeight, setCargoWeight] = useState("");
  const [cargoType, setCargoType] = useState("general");
  const [cargoDescription, setCargoDescription] = useState("");
  const [dimL, setDimL] = useState("");
  const [dimW, setDimW] = useState("");
  const [dimH, setDimH] = useState("");
  const [priority, setPriority] = useState(false);
  const [specialReqs, setSpecialReqs] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Pricing: urgency tier + optional bonus the shipper adds on top of the base.
  const [urgency, setUrgency] = useState("standard");
  const [shipperOffer, setShipperOffer] = useState("");

  // Scheduling
  const scheduleSlots = useRef(buildScheduleSlots()).current;
  const [scheduleSlotId, setScheduleSlotId] = useState("asap");
  const dayOptions = useRef(buildDayOptions()).current;
  const timeOptions = useRef(buildTimeOptions()).current;
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [customTime, setCustomTime] = useState<string | null>(null);

  // Saved addresses
  const [savedAddresses, setSavedAddresses] = useState<{ address: string; coords: Coords }[]>([]);

  // Cross-platform feedback banner (RN Web doesn't render Alert.alert)
  const [banner, setBanner] = useState<{ msg: string; type: "error" | "success" | "info" } | null>(null);
  const bannerTimer = useRef<any>(null);
  const showBanner = useCallback(
    (msg: string, type: "error" | "success" | "info" = "info", autoHide = true) => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      setBanner({ msg, type });
      if (autoHide) bannerTimer.current = setTimeout(() => setBanner(null), 3200);
    },
    [],
  );

  // Picker modals
  const [showPickupPicker, setShowPickupPicker] = useState(false);
  const [showDropoffPicker, setShowDropoffPicker] = useState(false);

  const styles = createStyles(theme);

  // ---------- Draft hydration ----------
  useEffect(() => {
    (async () => {
      const raw = await storage.getItem(DRAFT_KEY, "");
      if (raw) {
        try {
          const d = JSON.parse(raw as string);
          setPickupAddress(d.pickupAddress || "");
          setPickupCoords(d.pickupCoords || null);
          setPickupName(d.pickupName || "");
          setPickupPhone(d.pickupPhone || "");
          setPickupNotes(d.pickupNotes || "");
          setDropoffAddress(d.dropoffAddress || "");
          setDropoffCoords(d.dropoffCoords || null);
          setDropoffName(d.dropoffName || "");
          setDropoffPhone(d.dropoffPhone || "");
          setDropoffNotes(d.dropoffNotes || "");
          setVehicleType(d.vehicleType || "cargo_van");
          setCargoWeight(d.cargoWeight || "");
          setCargoType(d.cargoType || "general");
          setCargoDescription(d.cargoDescription || "");
          setDimL(d.dimL || "");
          setDimW(d.dimW || "");
          setDimH(d.dimH || "");
          setPriority(!!d.priority);
          setSpecialReqs(Array.isArray(d.specialReqs) ? d.specialReqs : []);
          setScheduleSlotId(d.scheduleSlotId || "asap");
        } catch {}
      }
      const addrRaw = await storage.getItem(SAVED_ADDR_KEY, "");
      if (addrRaw) {
        try {
          const list = JSON.parse(addrRaw as string);
          if (Array.isArray(list)) setSavedAddresses(list);
        } catch {}
      }
      setHydrated(true);
    })();
  }, []);

  // ---------- Draft auto-save ----------
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      storage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          pickupAddress, pickupCoords, pickupName, pickupPhone, pickupNotes,
          dropoffAddress, dropoffCoords, dropoffName, dropoffPhone, dropoffNotes,
          vehicleType, cargoWeight, cargoType, cargoDescription,
          dimL, dimW, dimH, priority, specialReqs, scheduleSlotId,
        }),
      );
    }, 400);
    return () => clearTimeout(t);
  }, [
    hydrated, pickupAddress, pickupCoords, pickupName, pickupPhone, pickupNotes,
    dropoffAddress, dropoffCoords, dropoffName, dropoffPhone, dropoffNotes,
    vehicleType, cargoWeight, cargoType, cargoDescription,
    dimL, dimW, dimH, priority, specialReqs, scheduleSlotId,
  ]);

  const persistSavedAddress = useCallback(
    async (address: string, coords: Coords) => {
      if (!address) return;
      const exists = savedAddresses.some((a) => a.address === address);
      if (exists) return;
      const next = [{ address, coords }, ...savedAddresses].slice(0, 6);
      setSavedAddresses(next);
      await storage.setItem(SAVED_ADDR_KEY, JSON.stringify(next));
      Haptics.selectionAsync().catch(() => {});
    },
    [savedAddresses],
  );

  const clearDraft = async () => {
    await storage.removeItem(DRAFT_KEY);
  };

  // ---------- Pricing (instant client estimate + server reconcile) ----------
  // The price is pure math (distance x rate + fees), so we compute it INSTANTLY
  // on-device first — no spinner, works even if the backend is slow/unreachable.
  // Then we reconcile with the authoritative server quote (with a hard timeout)
  // so the two never diverge. The server always recomputes the real price at
  // creation time, so this estimate is safe to show immediately.
  const fetchQuote = useCallback(async () => {
    const weight = parseFloat(cargoWeight) || 0;
    const fallback = { latitude: 60.1699, longitude: 24.9384 };
    const p = pickupCoords || fallback;
    const d = dropoffCoords || fallback;
    const special = specialReqs.length > 0 || cargoType === "oversized";

    // 1) Instant local estimate — display right away.
    const distanceKm = haversineKm(p.latitude, p.longitude, d.latitude, d.longitude);
    const local = calculatePrice({
      vehicleType,
      distanceKm,
      weightKg: weight,
      urgency,
      specialHandling: special,
    });
    setQuote(local);
    setQuoteLoading(false);

    // 2) Reconcile with the authoritative server quote (best-effort, 7s timeout).
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const token = getAuthToken();
      const res = await fetch(`${BASE}/api/shipper/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          pickup_lat: p.latitude,
          pickup_lng: p.longitude,
          dropoff_lat: d.latitude,
          dropoff_lng: d.longitude,
          vehicle_type: vehicleType,
          cargo_weight_kg: weight,
          urgency,
          special_handling: special,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        setQuote({
          distance_km: data.distance_km,
          estimated_duration_minutes: data.estimated_duration_minutes,
          base_price: data.base_price,
          weight_surcharge: data.weight_surcharge,
          total_price: data.total_price,
          base_fee: data.base_fee,
          distance_fee: data.distance_fee,
          weight_fee: data.weight_fee,
          fuel_surcharge: data.fuel_surcharge,
          estimate_low: data.estimate_low,
          estimate_high: data.estimate_high,
        });
      }
    } catch (e) {
      // Network slow/unreachable — keep the instant local estimate. No spinner.
      console.warn("Quote reconcile skipped:", e);
    }
  }, [BASE, pickupCoords, dropoffCoords, vehicleType, cargoWeight, urgency, specialReqs, cargoType]);

  useEffect(() => {
    if (step === 4) fetchQuote();
  }, [step, fetchQuote]);

  // ---------- Validation per step ----------
  const weightNum = parseFloat(cargoWeight) || 0;
  const vehicle = getVehicle(vehicleType);
  const overCapacity = weightNum > vehicle.maxWeight;

  const validateStep = (s: number): string | null => {
    if (s === 1) {
      if (!pickupAddress.trim()) return "Please select or enter the pickup address.";
      if (!pickupName.trim()) return "Please add the pickup contact name.";
    }
    if (s === 2) {
      if (!dropoffAddress.trim()) return "Please select or enter the dropoff address.";
      if (!dropoffName.trim()) return "Please add the recipient name.";
    }
    if (s === 3) {
      if (!weightNum || weightNum <= 0) return "Please enter the cargo weight in kg.";
      if (overCapacity)
        return `Weight (${weightNum} kg) exceeds ${vehicle.name} capacity (${vehicle.maxWeight} kg). Pick a bigger vehicle.`;
      if (!cargoDescription.trim()) return "Please briefly describe the cargo.";
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      showBanner(err, "error");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  };

  const goBack = () => {
    if (step > 1) {
      setStep((s) => s - 1);
      Haptics.selectionAsync().catch(() => {});
    } else {
      router.back();
    }
  };

  const toggleSpecialReq = (id: string) => {
    Haptics.selectionAsync().catch(() => {});
    setSpecialReqs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Reset the whole wizard so a brand-new shipment starts blank.
  const resetForm = useCallback(() => {
    setPickupAddress("");
    setPickupCoords(null);
    setPickupName("");
    setPickupPhone("");
    setPickupNotes("");
    setDropoffAddress("");
    setDropoffCoords(null);
    setDropoffName("");
    setDropoffPhone("");
    setDropoffNotes("");
    setVehicleType("cargo_van");
    setCargoWeight("");
    setCargoType("general");
    setCargoDescription("");
    setDimL("");
    setDimW("");
    setDimH("");
    setPriority(false);
    setSpecialReqs([]);
    setShowAdvanced(false);
    setScheduleSlotId("asap");
    setUrgency("standard");
    setShipperOffer("");
    setQuote(null);
    setStep(1);
  }, []);

  // ---------- Submit ----------
  const handleSubmit = async () => {
    for (let s = 1; s <= 3; s++) {
      const err = validateStep(s);
      if (err) {
        showBanner(err, "error");
        setStep(s);
        return;
      }
    }

    const token = getAuthToken();
    if (!token) {
      showBanner("Please sign in to create shipments.", "error");
      setTimeout(() => router.push("/shipper-login"), 900);
      return;
    }

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    try {
      const fallback = { latitude: 60.1699, longitude: 24.9384 };
      const fp = pickupCoords || fallback;
      const fd = dropoffCoords || fallback;
      const slot = scheduleSlots.find((sl) => sl.id === scheduleSlotId);
      let scheduledIso: string | null = slot?.iso || null;
      if (scheduleSlotId === "custom" && customDate && customTime) {
        const [hh, mm] = customTime.split(":").map(Number);
        const cd = new Date(customDate);
        cd.setHours(hh, mm, 0, 0);
        scheduledIso = cd.toISOString();
      }
      const dims = dimL && dimW && dimH ? `${dimL}x${dimW}x${dimH}` : null;
      const reqs = [...specialReqs];
      if (priority && !reqs.includes("priority")) reqs.push("priority");

      const res = await fetch(`${BASE}/api/shipper/shipments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          pickup_address: pickupAddress,
          pickup_lat: fp.latitude,
          pickup_lng: fp.longitude,
          pickup_contact_name: pickupName,
          pickup_contact_phone: pickupPhone || "",
          pickup_notes: pickupNotes || null,
          dropoff_address: dropoffAddress,
          dropoff_lat: fd.latitude,
          dropoff_lng: fd.longitude,
          dropoff_contact_name: dropoffName,
          dropoff_contact_phone: dropoffPhone || "",
          dropoff_notes: dropoffNotes || null,
          vehicle_type: vehicleType,
          cargo_weight_kg: weightNum || 100,
          cargo_dimensions: dims,
          cargo_type: cargoType,
          cargo_description: cargoDescription || "General cargo",
          special_requirements: reqs.length ? reqs : null,
          scheduled_pickup: scheduledIso,
          urgency,
          shipper_offer: parseFloat(shipperOffer) || 0,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        await clearDraft();
        idempotencyKey.current = genId(); // fresh key for next shipment
        resetForm(); // clear the wizard so a new shipment starts blank

        const orderId: string | undefined = data.order_id;
        const orderNum: string | undefined = data.order_number;

        // The job is now live for drivers. Ask the shipper how they want to settle
        // payment: Pay Now (Stripe) or Accept Invoice (Net-14 invoice).
        if (orderId) {
          const settleTotal = quote
            ? quote.total_price + Math.max(0, parseFloat(shipperOffer) || 0)
            : Math.max(0, parseFloat(shipperOffer) || 0);
          setPayChoice({
            orderId,
            orderNum: orderNum || "",
            total: settleTotal,
          });
        } else {
          showBanner(`Shipment ${orderNum || ""} created!`, "success", false);
          setTimeout(() => router.replace("/shipper-home"), 700);
        }
        return;
      } else {
        const err = await res.json().catch(() => ({}));
        showBanner(err.detail || "Failed to create shipment", "error");
      }
    } catch (e) {
      console.warn("Create shipment error:", e);
      showBanner("Failed to create shipment. Please check your connection and try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handlePayNow = async () => {
    if (!payChoice) return;
    const { orderId, orderNum } = payChoice;
    setPayBusy("pay");
    try {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const origin = window.location.origin;
        const { url } = await api.createPaymentCheckout(orderId, {
          success_url: `${origin}/shipper-home?paid=1&order=${encodeURIComponent(orderNum)}&oid=${orderId}`,
          cancel_url: `${origin}/shipper-tracking?id=${orderId}&pay=1`,
        });
        window.location.href = url;
        return;
      }
      const returnUrl = Linking.createURL("payment-complete");
      const { url } = await api.createPaymentCheckout(orderId, {
        success_url: `${BASE}/api/payments/return?status=success&order_id=${orderId}&redirect=${encodeURIComponent(returnUrl)}`,
        cancel_url: `${BASE}/api/payments/return?status=cancel&order_id=${orderId}&redirect=${encodeURIComponent(returnUrl)}`,
      });
      await WebBrowser.openAuthSessionAsync(url, returnUrl);
      setPayChoice(null);
      router.replace(`/shipper-home?paid=1&order=${encodeURIComponent(orderNum)}&oid=${orderId}`);
    } catch (e: any) {
      setPayChoice(null);
      showBanner(e?.message || "Could not start payment. You can pay later from tracking.", "error", false);
      setTimeout(() => router.replace(`/shipper-tracking?id=${orderId}&pay=1`), 800);
    } finally {
      setPayBusy(null);
    }
  };

  const handleAcceptInvoice = async () => {
    if (!payChoice) return;
    const { orderId, orderNum } = payChoice;
    setPayBusy("invoice");
    try {
      const inv = await api.acceptInvoice(orderId);
      setPayChoice(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace(
        `/shipper-home?invoiced=1&order=${encodeURIComponent(orderNum)}&inv=${encodeURIComponent(inv?.invoice_number || "")}`,
      );
    } catch (e: any) {
      showBanner(e?.message || "Could not create invoice. Please try again.", "error", false);
    } finally {
      setPayBusy(null);
    }
  };

  // ---------- Reusable bits ----------
  const SavedAddressRow = ({ onPick }: { onPick: (a: string, c: Coords) => void }) =>
    savedAddresses.length > 0 ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
        style={{ marginBottom: spacing.sm }}
      >
        {savedAddresses.map((a, i) => (
          <TouchableOpacity key={i} style={styles.savedChip} onPress={() => onPick(a.address, a.coords)}>
            <Ionicons name="bookmark" size={13} color={ACCENT} />
            <Text style={styles.savedChipText} numberOfLines={1}>
              {a.address}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    ) : null;

  const Toggle = ({ value }: { value: boolean }) => (
    <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
      <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
    </View>
  );

  // ---------- Steps ----------
  const renderStep1 = () => (
    <Animated.View entering={FadeInUp.duration(280)}>
      <Text style={styles.stepTitle}>Pickup location</Text>
      <Text style={styles.stepDescription}>Where should the driver collect the cargo?</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Pickup address *</Text>
        <SavedAddressRow
          onPick={(a, c) => {
            setPickupAddress(a);
            setPickupCoords(c);
          }}
        />
        <TouchableOpacity
          style={styles.addressSelectButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            setShowPickupPicker(true);
          }}
        >
          <View style={styles.addressSelectIcon}>
            <Ionicons name="location" size={20} color="#fff" />
          </View>
          <View style={styles.addressSelectContent}>
            {pickupAddress ? (
              <>
                <Text style={styles.addressSelectText} numberOfLines={2}>
                  {pickupAddress}
                </Text>
                {pickupCoords && (
                  <Text style={styles.addressSelectCoords}>
                    📍 {pickupCoords.latitude.toFixed(5)}, {pickupCoords.longitude.toFixed(5)}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.addressSelectPlaceholder}>Tap to select on map</Text>
            )}
          </View>
          <Ionicons name="map" size={24} color={ACCENT} />
        </TouchableOpacity>

        <View style={[styles.inputContainer, { marginTop: spacing.sm }]}>
          <Ionicons name="create-outline" size={18} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="Or type address manually..."
            placeholderTextColor={theme.textSecondary}
            value={pickupAddress}
            onChangeText={setPickupAddress}
            multiline
          />
        </View>
        {pickupAddress ? (
          <TouchableOpacity
            style={styles.saveAddrLink}
            onPress={() => persistSavedAddress(pickupAddress, pickupCoords)}
          >
            <Ionicons name="bookmark-outline" size={14} color={ACCENT} />
            <Text style={styles.saveAddrLinkText}>Save this address</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Contact name *</Text>
        <View style={styles.inputContainer}>
          <Ionicons name="person-outline" size={20} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="Who hands over the cargo?"
            placeholderTextColor={theme.textSecondary}
            value={pickupName}
            onChangeText={setPickupName}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => pickupPhoneRef.current?.focus()}
          />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Contact phone</Text>
        <View style={styles.inputContainer}>
          <Ionicons name="call-outline" size={20} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="+358 40 123 4567"
            placeholderTextColor={theme.textSecondary}
            value={pickupPhone}
            onChangeText={setPickupPhone}
            keyboardType="phone-pad"
            ref={pickupPhoneRef}
            returnKeyType="done"
          />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Pickup notes</Text>
        <View style={[styles.inputContainer, { alignItems: "flex-start", paddingVertical: 12 }]}>
          <Ionicons name="document-text-outline" size={20} color={theme.textSecondary} style={{ marginTop: 2 }} />
          <TextInput
            style={[styles.input, { minHeight: 60 }]}
            placeholder="E.g., 'Loading dock B', 'Ask for warehouse manager'"
            placeholderTextColor={theme.textSecondary}
            value={pickupNotes}
            onChangeText={setPickupNotes}
            multiline
          />
        </View>
      </View>
    </Animated.View>
  );

  const renderStep2 = () => (
    <Animated.View entering={FadeInUp.duration(280)}>
      <Text style={styles.stepTitle}>Dropoff location</Text>
      <Text style={styles.stepDescription}>Where should the cargo be delivered?</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Dropoff address *</Text>
        <SavedAddressRow
          onPick={(a, c) => {
            setDropoffAddress(a);
            setDropoffCoords(c);
          }}
        />
        <TouchableOpacity
          style={styles.addressSelectButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            setShowDropoffPicker(true);
          }}
        >
          <View style={[styles.addressSelectIcon, { backgroundColor: DROPOFF_COLOR }]}>
            <Ionicons name="flag" size={20} color="#fff" />
          </View>
          <View style={styles.addressSelectContent}>
            {dropoffAddress ? (
              <>
                <Text style={styles.addressSelectText} numberOfLines={2}>
                  {dropoffAddress}
                </Text>
                {dropoffCoords && (
                  <Text style={styles.addressSelectCoords}>
                    📍 {dropoffCoords.latitude.toFixed(5)}, {dropoffCoords.longitude.toFixed(5)}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.addressSelectPlaceholder}>Tap to select on map</Text>
            )}
          </View>
          <Ionicons name="map" size={24} color={DROPOFF_COLOR} />
        </TouchableOpacity>

        <View style={[styles.inputContainer, { marginTop: spacing.sm }]}>
          <Ionicons name="create-outline" size={18} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="Or type address manually..."
            placeholderTextColor={theme.textSecondary}
            value={dropoffAddress}
            onChangeText={setDropoffAddress}
            multiline
          />
        </View>
        {dropoffAddress ? (
          <TouchableOpacity
            style={styles.saveAddrLink}
            onPress={() => persistSavedAddress(dropoffAddress, dropoffCoords)}
          >
            <Ionicons name="bookmark-outline" size={14} color={ACCENT} />
            <Text style={styles.saveAddrLinkText}>Save this address</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Recipient name *</Text>
        <View style={styles.inputContainer}>
          <Ionicons name="person-outline" size={20} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="Who receives the cargo?"
            placeholderTextColor={theme.textSecondary}
            value={dropoffName}
            onChangeText={setDropoffName}
          />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Recipient phone</Text>
        <View style={styles.inputContainer}>
          <Ionicons name="call-outline" size={20} color={theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="+358 40 123 4567"
            placeholderTextColor={theme.textSecondary}
            value={dropoffPhone}
            onChangeText={setDropoffPhone}
            keyboardType="phone-pad"
            ref={dropoffPhoneRef}
            returnKeyType="done"
          />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Delivery notes</Text>
        <View style={[styles.inputContainer, { alignItems: "flex-start", paddingVertical: 12 }]}>
          <Ionicons name="document-text-outline" size={20} color={theme.textSecondary} style={{ marginTop: 2 }} />
          <TextInput
            style={[styles.input, { minHeight: 60 }]}
            placeholder="E.g., 'Leave at reception', 'Call on arrival'"
            placeholderTextColor={theme.textSecondary}
            value={dropoffNotes}
            onChangeText={setDropoffNotes}
            multiline
          />
        </View>
      </View>
    </Animated.View>
  );

  const renderStep3 = () => (
    <Animated.View entering={FadeInUp.duration(280)}>
      <Text style={styles.stepTitle}>Package details</Text>
      <Text style={styles.stepDescription}>Tell us what you are shipping</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Required vehicle type *</Text>
        <ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {VEHICLE_CATEGORIES.map((category) => (
            <View key={category.category} style={styles.vehicleCategory}>
              <Text style={styles.vehicleCategoryTitle}>{category.category}</Text>
              <View style={styles.vehicleGrid}>
                {category.vehicles.map((v) => (
                  <TouchableOpacity
                    key={v.id}
                    style={[styles.vehicleCard, vehicleType === v.id && styles.vehicleCardSelected]}
                    onPress={() => {
                      setVehicleType(v.id);
                      Haptics.selectionAsync().catch(() => {});
                    }}
                  >
                    <Ionicons
                      name={`${v.icon}-outline` as any}
                      size={22}
                      color={vehicleType === v.id ? "#fff" : theme.textSecondary}
                    />
                    <Text
                      style={[styles.vehicleName, vehicleType === v.id && styles.vehicleNameSelected]}
                      numberOfLines={1}
                    >
                      {v.name}
                    </Text>
                    <Text style={[styles.vehicleCapacity, vehicleType === v.id && styles.vehicleCapacitySelected]}>
                      {v.capacity}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Cargo weight (kg) *</Text>
        <View style={[styles.inputContainer, overCapacity && styles.inputContainerError]}>
          <Ionicons name="scale-outline" size={20} color={overCapacity ? "#EF4444" : theme.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="e.g., 250"
            placeholderTextColor={theme.textSecondary}
            value={cargoWeight}
            onChangeText={setCargoWeight}
            keyboardType="numeric"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => cargoDescRef.current?.focus()}
          />
        </View>
        {overCapacity && (
          <Text style={styles.errorText}>
            Exceeds {vehicle.name} capacity ({vehicle.maxWeight.toLocaleString()} kg). Choose a bigger vehicle.
          </Text>
        )}
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Cargo type *</Text>
        <View style={styles.chipWrap}>
          {CARGO_TYPES.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.chip, cargoType === c.id && styles.chipSelected]}
              onPress={() => {
                setCargoType(c.id);
                Haptics.selectionAsync().catch(() => {});
              }}
            >
              <Ionicons name={c.icon as any} size={15} color={cargoType === c.id ? "#fff" : theme.textSecondary} />
              <Text style={[styles.chipText, cargoType === c.id && styles.chipTextSelected]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Description *</Text>
        <View style={[styles.inputContainer, { alignItems: "flex-start", paddingVertical: 12 }]}>
          <Ionicons name="cube-outline" size={20} color={theme.textSecondary} style={{ marginTop: 2 }} />
          <TextInput
            style={[styles.input, { minHeight: 56 }]}
            placeholder="What's inside? (e.g., '5 pallets of electronics')"
            placeholderTextColor={theme.textSecondary}
            value={cargoDescription}
            onChangeText={setCargoDescription}
            ref={cargoDescRef}
            multiline
          />
        </View>
      </View>

      {/* Priority toggle */}
      <TouchableOpacity
        style={styles.toggleRow}
        activeOpacity={0.8}
        onPress={() => {
          setPriority((p) => !p);
          Haptics.selectionAsync().catch(() => {});
        }}
      >
        <View style={styles.toggleRowLeft}>
          <Ionicons name="flash" size={18} color={priority ? ACCENT : theme.textSecondary} />
          <View>
            <Text style={styles.toggleRowTitle}>Priority delivery</Text>
            <Text style={styles.toggleRowSub}>Drivers see this job first</Text>
          </View>
        </View>
        <Toggle value={priority} />
      </TouchableOpacity>

      {/* Advanced (progressive disclosure) */}
      <TouchableOpacity
        style={styles.advancedToggle}
        onPress={() => {
          setShowAdvanced((s) => !s);
          Haptics.selectionAsync().catch(() => {});
        }}
      >
        <Text style={styles.advancedToggleText}>
          {showAdvanced ? "Hide extra details" : "Add dimensions & handling needs"}
        </Text>
        <Ionicons name={showAdvanced ? "chevron-up" : "chevron-down"} size={16} color={ACCENT} />
      </TouchableOpacity>

      {showAdvanced && (
        <Animated.View entering={FadeInUp.duration(200)}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Dimensions (cm)</Text>
            <View style={styles.dimRow}>
              {[
                { v: dimL, set: setDimL, ph: "L" },
                { v: dimW, set: setDimW, ph: "W" },
                { v: dimH, set: setDimH, ph: "H" },
              ].map((d, i) => (
                <View key={i} style={[styles.inputContainer, { flex: 1 }]}>
                  <TextInput
                    style={[styles.input, { textAlign: "center" }]}
                    placeholder={d.ph}
                    placeholderTextColor={theme.textSecondary}
                    value={d.v}
                    onChangeText={d.set}
                    keyboardType="numeric"
                  />
                </View>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Special handling</Text>
            <View style={styles.chipWrap}>
              {SPECIAL_REQUIREMENTS.map((r) => {
                const on = specialReqs.includes(r.id);
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.chip, on && styles.chipSelected]}
                    onPress={() => toggleSpecialReq(r.id)}
                  >
                    <Ionicons name={r.icon as any} size={15} color={on ? "#fff" : theme.textSecondary} />
                    <Text style={[styles.chipText, on && styles.chipTextSelected]}>{r.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </Animated.View>
      )}
    </Animated.View>
  );

  const renderStep4 = () => {
    const offerNum = parseFloat(shipperOffer) || 0;
    const finalTotal = quote ? quote.total_price + Math.max(0, offerNum) : 0;
    const URGENCIES: { id: string; label: string; sub?: string }[] = [
      { id: "standard", label: "Standard" },
      { id: "express", label: "Express", sub: "+30%" },
      { id: "priority", label: "Priority", sub: "+50%" },
      { id: "emergency", label: "Emergency", sub: "×2" },
    ];
    return (
    <Animated.View entering={FadeInUp.duration(280)}>
      <Text style={styles.stepTitle}>Price estimate</Text>
      <Text style={styles.stepDescription}>Fair, transparent pricing — add a bonus to go faster</Text>

      {/* Urgency selector */}
      <Text style={styles.fieldLabel}>Delivery speed</Text>
      <View style={styles.urgencyRow}>
        {URGENCIES.map((u) => (
          <TouchableOpacity
            key={u.id}
            style={[styles.urgencyChip, urgency === u.id && styles.urgencyChipActive]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setUrgency(u.id);
            }}
          >
            <Text style={[styles.urgencyChipText, urgency === u.id && styles.urgencyChipTextActive]}>
              {u.label}
            </Text>
            {u.sub ? (
              <Text style={[styles.urgencyChipSub, urgency === u.id && styles.urgencyChipTextActive]}>
                {u.sub}
              </Text>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.priceCard, shadows.md]}>
        {quoteLoading ? (
          <View style={{ paddingVertical: 28, alignItems: "center" }}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={[styles.quoteNote, { marginTop: 10 }]}>Calculating your price…</Text>
          </View>
        ) : quote ? (
          <>
            <Text style={styles.priceLabel}>Estimated total</Text>
            <Text style={styles.priceBig}>€{finalTotal.toFixed(2)}</Text>
            {quote.estimate_low ? (
              <Text style={styles.priceRange}>
                Typically €{quote.estimate_low?.toFixed(0)}–€{quote.estimate_high?.toFixed(0)}
              </Text>
            ) : null}

            <View style={styles.priceMetaRow}>
              <View style={styles.priceMeta}>
                <Ionicons name="navigate-outline" size={15} color={theme.textSecondary} />
                <Text style={styles.priceMetaText}>{quote.distance_km.toFixed(1)} km</Text>
              </View>
              <View style={styles.priceMeta}>
                <Ionicons name="time-outline" size={15} color={theme.textSecondary} />
                <Text style={styles.priceMetaText}>~{quote.estimated_duration_minutes} min</Text>
              </View>
              <View style={styles.priceMeta}>
                <Ionicons name={`${vehicle.icon}-outline` as any} size={15} color={theme.textSecondary} />
                <Text style={styles.priceMetaText}>{vehicle.name}</Text>
              </View>
            </View>

            <View style={styles.breakdown}>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Base fee</Text>
                <Text style={styles.breakdownValue}>€{(quote.base_fee ?? 0).toFixed(2)}</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Distance ({quote.distance_km.toFixed(1)} km)</Text>
                <Text style={styles.breakdownValue}>€{(quote.distance_fee ?? 0).toFixed(2)}</Text>
              </View>
              {(quote.weight_fee ?? 0) > 0 && (
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Weight surcharge</Text>
                  <Text style={styles.breakdownValue}>€{(quote.weight_fee ?? 0).toFixed(2)}</Text>
                </View>
              )}
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Fuel surcharge (8%)</Text>
                <Text style={styles.breakdownValue}>€{(quote.fuel_surcharge ?? 0).toFixed(2)}</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>NadaRuns base price</Text>
                <Text style={styles.breakdownValue}>€{quote.total_price.toFixed(2)}</Text>
              </View>
              {offerNum > 0 && (
                <View style={styles.breakdownRow}>
                  <Text style={[styles.breakdownLabel, { color: ACCENT }]}>Your bonus</Text>
                  <Text style={[styles.breakdownValue, { color: ACCENT }]}>+€{offerNum.toFixed(2)}</Text>
                </View>
              )}
              <View style={[styles.breakdownRow, styles.breakdownTotalRow]}>
                <Text style={styles.breakdownTotalLabel}>Total</Text>
                <Text style={styles.breakdownTotalValue}>€{finalTotal.toFixed(2)}</Text>
              </View>
            </View>

            {/* Optional shipper bonus */}
            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Add a bonus (optional)</Text>
            <View style={styles.offerRow}>
              <Text style={styles.offerCurrency}>€</Text>
              <TextInput
                style={styles.offerInput}
                value={shipperOffer}
                onChangeText={(t) => setShipperOffer(t.replace(/[^0-9.]/g, ""))}
                placeholder="0"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
            </View>
            <Text style={styles.offerHint}>
              A bonus goes 100% to the driver and helps your job get accepted faster.
            </Text>
          </>
        ) : (
          <View style={{ paddingVertical: 24, alignItems: "center" }}>
            <Ionicons name="cloud-offline-outline" size={28} color={theme.textSecondary} />
            <Text style={[styles.quoteNote, { marginTop: 8 }]}>Couldn&apos;t load price.</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={fetchQuote}>
              <Ionicons name="refresh" size={15} color={ACCENT} />
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Animated.View>
    );
  };

  const renderStep5 = () => (
    <Animated.View entering={FadeInUp.duration(280)}>
      <Text style={styles.stepTitle}>When to pick up?</Text>
      <Text style={styles.stepDescription}>Choose immediate or schedule for later</Text>

      <View style={{ gap: 10, marginTop: spacing.sm }}>
        {scheduleSlots.map((slot) => {
          const on = scheduleSlotId === slot.id;
          return (
            <TouchableOpacity
              key={slot.id}
              style={[styles.slotCard, on && styles.slotCardSelected]}
              onPress={() => {
                setScheduleSlotId(slot.id);
                if (slot.id === "custom") {
                  setCustomDate((prev) => prev || dayOptions[0].date);
                  setCustomTime((prev) => prev || "09:00");
                }
                Haptics.selectionAsync().catch(() => {});
              }}
            >
              <View style={[styles.slotIcon, on && styles.slotIconSelected]}>
                <Ionicons
                  name={slot.id === "asap" ? "flash" : "calendar-outline"}
                  size={18}
                  color={on ? "#fff" : ACCENT}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.slotLabel, on && styles.slotLabelSelected]}>{slot.label}</Text>
                <Text style={styles.slotSub}>{slot.sub}</Text>
              </View>
              {on && <Ionicons name="checkmark-circle" size={22} color={ACCENT} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {scheduleSlotId === "custom" && (
        <View style={{ marginTop: spacing.lg }}>
          <Text style={styles.inputLabel}>Select a day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {dayOptions.map((d) => {
              const on = customDate?.toDateString() === d.date.toDateString();
              return (
                <TouchableOpacity
                  key={d.id}
                  style={[styles.dayChip, on && styles.dayChipActive]}
                  onPress={() => { setCustomDate(d.date); Haptics.selectionAsync().catch(() => {}); }}
                >
                  <Text style={[styles.dayChipText, on && styles.dayChipTextActive]}>{d.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={[styles.inputLabel, { marginTop: spacing.md }]}>Select a time</Text>
          <View style={styles.timeWrap}>
            {timeOptions.map((tm) => {
              const on = customTime === tm;
              return (
                <TouchableOpacity
                  key={tm}
                  style={[styles.timeChip, on && styles.timeChipActive]}
                  onPress={() => { setCustomTime(tm); Haptics.selectionAsync().catch(() => {}); }}
                >
                  <Text style={[styles.timeChipText, on && styles.timeChipTextActive]}>{tm}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {customDate && customTime ? (
            <Text style={[styles.slotSub, { marginTop: spacing.md }]}>
              Scheduled for {customDate.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} at {customTime}
            </Text>
          ) : (
            <Text style={[styles.slotSub, { marginTop: spacing.md, color: "#dc2626" }]}>Please choose a day and time</Text>
          )}
        </View>
      )}
    </Animated.View>
  );

  const SummarySection = ({
    icon,
    color,
    title,
    editStep,
    children,
  }: {
    icon: any;
    color: string;
    title: string;
    editStep: number;
    children: React.ReactNode;
  }) => (
    <View style={styles.summaryCard}>
      <View style={styles.summaryHeader}>
        <View style={styles.summaryHeaderLeft}>
          <View style={[styles.summaryDot, { backgroundColor: color }]} />
          <Text style={styles.summaryTitle}>{title}</Text>
        </View>
        <TouchableOpacity style={styles.editBtn} onPress={() => setStep(editStep)}>
          <Ionicons name="pencil" size={13} color={ACCENT} />
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>
      {children}
    </View>
  );

  const renderStep6 = () => {
    const slot = scheduleSlots.find((sl) => sl.id === scheduleSlotId);
    const offerNum = Math.max(0, parseFloat(shipperOffer) || 0);
    const reviewTotal = quote ? quote.total_price + offerNum : 0;
    const warnings: string[] = [];
    if (quote && quote.distance_km > 100)
      warnings.push(`Long-distance delivery (~${quote.distance_km.toFixed(0)} km). Allow extra time.`);
    if (quote && quote.total_price > 200) warnings.push(`High-value order (€${quote.total_price.toFixed(0)}).`);
    if (weightNum > vehicle.maxWeight * 0.9 && !overCapacity)
      warnings.push("Cargo weight is close to the vehicle's capacity.");
    if (cargoType === "hazardous" && !specialReqs.includes("hazmat_certified"))
      warnings.push("Hazardous cargo — consider requiring hazmat certification.");

    return (
      <Animated.View entering={FadeInUp.duration(280)}>
        <Text style={styles.stepTitle}>Review &amp; confirm</Text>
        <Text style={styles.stepDescription}>Check everything before we dispatch</Text>

        <SummarySection icon="location" color={PICKUP_COLOR} title="Pickup" editStep={1}>
          <Text style={styles.summaryMain}>{pickupAddress}</Text>
          <Text style={styles.summarySub}>
            {pickupName}
            {pickupPhone ? ` · ${pickupPhone}` : ""}
          </Text>
          {pickupNotes ? <Text style={styles.summaryNote}>📝 {pickupNotes}</Text> : null}
        </SummarySection>

        <SummarySection icon="flag" color={DROPOFF_COLOR} title="Dropoff" editStep={2}>
          <Text style={styles.summaryMain}>{dropoffAddress}</Text>
          <Text style={styles.summarySub}>
            {dropoffName}
            {dropoffPhone ? ` · ${dropoffPhone}` : ""}
          </Text>
          {dropoffNotes ? <Text style={styles.summaryNote}>📝 {dropoffNotes}</Text> : null}
        </SummarySection>

        <SummarySection icon="cube" color={ACCENT} title="Package" editStep={3}>
          <Text style={styles.summaryMain}>
            {vehicle.name} · {weightNum.toLocaleString()} kg · {CARGO_TYPES.find((c) => c.id === cargoType)?.name}
          </Text>
          <Text style={styles.summarySub}>{cargoDescription}</Text>
          {(dimL && dimW && dimH) || specialReqs.length > 0 || priority ? (
            <Text style={styles.summaryNote}>
              {dimL && dimW && dimH ? `📐 ${dimL}×${dimW}×${dimH} cm  ` : ""}
              {priority ? "⚡ Priority  " : ""}
              {specialReqs.length ? `🔧 ${specialReqs.map((r) => SPECIAL_REQUIREMENTS.find((s) => s.id === r)?.name).join(", ")}` : ""}
            </Text>
          ) : null}
        </SummarySection>

        <SummarySection icon="time" color="#F59E0B" title="Schedule" editStep={5}>
          <Text style={styles.summaryMain}>
            {scheduleSlotId === "custom" && customDate
              ? customDate.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })
              : slot?.label}
          </Text>
          {scheduleSlotId === "custom"
            ? (customTime ? <Text style={styles.summarySub}>at {customTime}</Text> : null)
            : (slot?.sub ? <Text style={styles.summarySub}>{slot.sub}</Text> : null)}
        </SummarySection>

        {/* Price (immutable) */}
        <View style={[styles.priceCard, { marginTop: spacing.sm }]}>
          <View style={styles.summaryHeader}>
            <View style={styles.summaryHeaderLeft}>
              <View style={[styles.summaryDot, { backgroundColor: "#22C55E" }]} />
              <Text style={styles.summaryTitle}>Total price</Text>
            </View>
            <TouchableOpacity style={styles.editBtn} onPress={() => setStep(4)}>
              <Ionicons name="receipt-outline" size={13} color={ACCENT} />
              <Text style={styles.editBtnText}>Details</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.priceBigSmall}>€{quote ? reviewTotal.toFixed(2) : "--"}</Text>
          {quote && (
            <Text style={styles.summarySub}>
              {quote.distance_km.toFixed(1)} km · ~{quote.estimated_duration_minutes} min
              {offerNum > 0 ? ` · incl. €${offerNum.toFixed(2)} bonus` : ""}
            </Text>
          )}
        </View>

        {warnings.length > 0 && (
          <View style={styles.warnBox}>
            <Ionicons name="alert-circle" size={18} color="#B45309" />
            <View style={{ flex: 1 }}>
              {warnings.map((w, i) => (
                <Text key={i} style={styles.warnText}>
                  {w}
                </Text>
              ))}
            </View>
          </View>
        )}
      </Animated.View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <Animated.View entering={FadeInDown.duration(260)} style={styles.header}>
        <TouchableOpacity style={[styles.iconBtn, shadows.sm]} onPress={goBack}>
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>New Shipment</Text>
        <Text style={styles.stepCounter}>
          {step}/{TOTAL_STEPS}
        </Text>
      </Animated.View>

      {/* Progress */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(step / TOTAL_STEPS) * 100}%` }]} />
        </View>
        <View style={styles.progressLabels}>
          {STEPS.map((s) => (
            <Text
              key={s.id}
              style={[styles.progressLabel, step >= s.id && styles.progressLabelActive]}
              numberOfLines={1}
            >
              {s.label}
            </Text>
          ))}
        </View>
      </View>

      {banner && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          style={[
            styles.banner,
            banner.type === "error" && styles.bannerError,
            banner.type === "success" && styles.bannerSuccess,
            banner.type === "info" && styles.bannerInfo,
          ]}
        >
          <Ionicons
            name={
              banner.type === "success"
                ? "checkmark-circle"
                : banner.type === "error"
                ? "alert-circle"
                : "information-circle"
            }
            size={18}
            color="#fff"
          />
          <Text style={styles.bannerText}>{banner.msg}</Text>
        </Animated.View>
      )}

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing.xl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={90}
      >
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}
        {step === 6 && renderStep6()}
      </KeyboardAwareScrollView>

      {/* Bottom Action (sticks above keyboard) */}
      <KeyboardStickyView>
      <View style={[styles.bottomAction, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.bottomRow}>
          {step > 1 && (
            <TouchableOpacity style={styles.backBtn} onPress={goBack}>
              <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
            </TouchableOpacity>
          )}
          {step < TOTAL_STEPS ? (
            <TouchableOpacity style={styles.nextBtn} onPress={goNext}>
              <Text style={styles.nextBtnText}>Continue</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.nextBtn, loading && styles.nextBtnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.nextBtnText}>Confirm &amp; Create</Text>
                  <Ionicons name="checkmark" size={20} color="#fff" />
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
      </KeyboardStickyView>

      {/* Map pickers */}
      <MapLocationPicker
        visible={showPickupPicker}
        onClose={() => setShowPickupPicker(false)}
        onSelectLocation={(address: string, coords: any) => {
          setPickupAddress(address);
          setPickupCoords(coords);
        }}
        title="Select Pickup Location"
        initialCoords={pickupCoords}
        theme={theme}
        markerColor={PICKUP_COLOR}
      />

      <MapLocationPicker
        visible={showDropoffPicker}
        onClose={() => setShowDropoffPicker(false)}
        onSelectLocation={(address: string, coords: any) => {
          setDropoffAddress(address);
          setDropoffCoords(coords);
        }}
        title="Select Dropoff Location"
        initialCoords={dropoffCoords}
        theme={theme}
        markerColor={DROPOFF_COLOR}
      />

      {/* Pay Now / Accept Invoice choice modal */}
      <Modal
        visible={!!payChoice}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!payBusy && payChoice) {
            const oid = payChoice.orderId;
            setPayChoice(null);
            router.replace(`/shipper-tracking?id=${oid}&pay=1`);
          }
        }}
      >
        <View style={styles.payOverlay} testID="pay-choice-modal">
          <Animated.View entering={FadeInUp.duration(220)} style={styles.paySheet}>
            <View style={styles.paySuccessBadge}>
              <Ionicons name="checkmark-circle" size={28} color="#22C55E" />
            </View>
            <Text style={styles.payTitle}>Shipment created!</Text>
            <Text style={styles.paySubtitle}>
              {payChoice?.orderNum ? `Order ${payChoice.orderNum} is live for drivers. ` : ""}
              How would you like to settle payment?
            </Text>

            <View style={styles.payTotalCard}>
              <Text style={styles.payTotalLabel}>Total due</Text>
              <Text style={styles.payTotalValue}>€{(payChoice?.total ?? 0).toFixed(2)}</Text>
            </View>

            {/* Option A — Pay Now */}
            <TouchableOpacity
              style={[styles.payOptionPrimary, payBusy && styles.payOptionDisabled]}
              onPress={handlePayNow}
              disabled={!!payBusy}
              testID="pay-now-button"
            >
              {payBusy === "pay" ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="card" size={20} color="#fff" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payOptionPrimaryTitle}>Pay now</Text>
                    <Text style={styles.payOptionPrimarySub}>Secure card payment via Stripe</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </>
              )}
            </TouchableOpacity>

            {/* Option B — Accept Invoice */}
            <TouchableOpacity
              style={[styles.payOptionSecondary, payBusy && styles.payOptionDisabled]}
              onPress={handleAcceptInvoice}
              disabled={!!payBusy}
              testID="accept-invoice-button"
            >
              {payBusy === "invoice" ? (
                <ActivityIndicator size="small" color={ACCENT} />
              ) : (
                <>
                  <Ionicons name="document-text" size={20} color={ACCENT} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payOptionSecondaryTitle}>Accept invoice</Text>
                    <Text style={styles.payOptionSecondarySub}>Net-14 terms · PDF invoice emailed</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={18} color={ACCENT} />
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.payLaterLink}
              disabled={!!payBusy}
              onPress={() => {
                if (!payChoice) return;
                const oid = payChoice.orderId;
                setPayChoice(null);
                router.replace(`/shipper-tracking?id=${oid}&pay=1`);
              }}
              testID="pay-later-button"
            >
              <Text style={styles.payLaterText}>Decide later</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },

    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
    },
    iconBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    heading: { fontSize: 20, fontWeight: "800", color: theme.textPrimary },
    stepCounter: {
      width: 44,
      textAlign: "right",
      fontSize: 13,
      fontWeight: "700",
      color: theme.textSecondary,
    },

    progressContainer: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
    progressBar: { height: 4, backgroundColor: theme.surfaceMuted, borderRadius: 2, overflow: "hidden" },
    progressFill: { height: "100%", backgroundColor: ACCENT, borderRadius: 2 },
    progressLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
    progressLabel: { fontSize: 10, color: theme.textSecondary, fontWeight: "600", flex: 1, textAlign: "center" },
    progressLabelActive: { color: ACCENT, fontWeight: "800" },

    stepTitle: { fontSize: 22, fontWeight: "800", color: theme.textPrimary, marginBottom: 6 },
    stepDescription: { fontSize: 14, color: theme.textSecondary, marginBottom: spacing.xl },

    inputGroup: { marginBottom: spacing.lg },
    inputLabel: { fontSize: 13, fontWeight: "700", color: theme.textPrimary, marginBottom: 8 },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.surface,
      borderRadius: radius.lg,
      borderWidth: 1.5,
      borderColor: theme.border,
      paddingHorizontal: spacing.md,
      minHeight: 52,
      gap: 10,
    },
    inputContainerError: { borderColor: "#EF4444" },
    input: { flex: 1, fontSize: 15, color: theme.textPrimary },
    errorText: { fontSize: 12, color: "#EF4444", marginTop: 6, fontWeight: "600" },

    addressSelectButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.surface,
      borderRadius: radius.lg,
      borderWidth: 2,
      borderColor: ACCENT,
      borderStyle: "dashed",
      padding: spacing.md,
      gap: spacing.md,
    },
    addressSelectIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: PICKUP_COLOR,
      alignItems: "center",
      justifyContent: "center",
    },
    addressSelectContent: { flex: 1 },
    addressSelectText: { fontSize: 15, fontWeight: "600", color: theme.textPrimary, lineHeight: 20 },
    addressSelectCoords: { fontSize: 12, color: theme.textSecondary, marginTop: 4 },
    addressSelectPlaceholder: { fontSize: 15, color: theme.textSecondary },

    saveAddrLink: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8, alignSelf: "flex-start" },
    saveAddrLinkText: { fontSize: 12, color: ACCENT, fontWeight: "700" },

    savedChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.md,
      paddingHorizontal: 10,
      paddingVertical: 8,
      maxWidth: 220,
    },
    savedChipText: { fontSize: 12, color: theme.textPrimary, fontWeight: "600", flexShrink: 1 },

    vehicleCategory: { marginBottom: spacing.md },
    vehicleCategoryTitle: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.textSecondary,
      marginBottom: spacing.xs,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    vehicleCard: {
      width: "31%",
      padding: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: theme.surface,
      borderWidth: 1.5,
      borderColor: theme.border,
      alignItems: "center",
    },
    vehicleCardSelected: { backgroundColor: ACCENT, borderColor: ACCENT },
    vehicleName: { fontSize: 12, fontWeight: "700", color: theme.textPrimary, marginTop: 6 },
    vehicleNameSelected: { color: "#fff" },
    vehicleCapacity: { fontSize: 9, color: theme.textSecondary, marginTop: 2, textAlign: "center" },
    vehicleCapacitySelected: { color: "rgba(255,255,255,0.8)" },

    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: radius.md,
      backgroundColor: theme.surface,
      borderWidth: 1.5,
      borderColor: theme.border,
    },
    chipSelected: { backgroundColor: ACCENT, borderColor: ACCENT },
    chipText: { fontSize: 12.5, fontWeight: "700", color: theme.textPrimary },
    chipTextSelected: { color: "#fff" },

    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: theme.surface,
      borderWidth: 1.5,
      borderColor: theme.border,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    toggleRowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
    toggleRowTitle: { fontSize: 14, fontWeight: "700", color: theme.textPrimary },
    toggleRowSub: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
    toggleTrack: {
      width: 46,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
      padding: 3,
      justifyContent: "center",
    },
    toggleTrackOn: { backgroundColor: ACCENT },
    toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
    toggleThumbOn: { alignSelf: "flex-end" },

    advancedToggle: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 12,
      marginBottom: spacing.sm,
    },
    advancedToggleText: { fontSize: 13.5, fontWeight: "700", color: ACCENT },

    dimRow: { flexDirection: "row", gap: 8 },

    priceCard: {
      backgroundColor: theme.surface,
      borderRadius: radius.xl,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: theme.border,
    },
    priceLabel: { fontSize: 13, fontWeight: "700", color: theme.textSecondary, textAlign: "center" },
    priceBig: { fontSize: 44, fontWeight: "800", color: ACCENT, textAlign: "center", marginVertical: 4 },
    priceRange: { fontSize: 12.5, color: theme.textSecondary, textAlign: "center", marginBottom: 4, fontWeight: "600" },
    fieldLabel: { fontSize: 13, fontWeight: "700", color: theme.textPrimary, marginBottom: 8 },
    urgencyRow: { flexDirection: "row", gap: 8, marginBottom: spacing.lg },
    urgencyChip: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: "center",
    },
    urgencyChipActive: { borderColor: ACCENT, backgroundColor: theme.primaryLight || "rgba(16,185,129,0.12)" },
    urgencyChipText: { fontSize: 12.5, fontWeight: "700", color: theme.textPrimary },
    urgencyChipSub: { fontSize: 10.5, fontWeight: "700", color: theme.textSecondary, marginTop: 1 },
    urgencyChipTextActive: { color: ACCENT },
    offerRow: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1.5,
      borderColor: theme.border,
      borderRadius: 12,
      backgroundColor: theme.surface,
      paddingHorizontal: 14,
    },
    offerCurrency: { fontSize: 18, fontWeight: "800", color: theme.textSecondary, marginRight: 6 },
    offerInput: { flex: 1, fontSize: 17, fontWeight: "700", color: theme.textPrimary, paddingVertical: 12 },
    offerHint: { fontSize: 12, color: theme.textSecondary, marginTop: 6, lineHeight: 16 },
    priceBigSmall: { fontSize: 30, fontWeight: "800", color: ACCENT, marginTop: 4 },
    priceMetaRow: { flexDirection: "row", justifyContent: "center", gap: 18, marginTop: 6, marginBottom: spacing.md },
    priceMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
    priceMetaText: { fontSize: 12.5, color: theme.textSecondary, fontWeight: "600" },

    breakdown: {
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: spacing.md,
      gap: 8,
    },
    breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    breakdownLabel: { fontSize: 13, color: theme.textSecondary },
    breakdownValue: { fontSize: 13, color: theme.textPrimary, fontWeight: "600" },
    breakdownTotalRow: { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8, marginTop: 2 },
    breakdownTotalLabel: { fontSize: 15, color: theme.textPrimary, fontWeight: "800" },
    breakdownTotalValue: { fontSize: 17, color: ACCENT, fontWeight: "800" },

    lockNote: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 7,
      marginTop: spacing.md,
      backgroundColor: theme.surfaceMuted,
      borderRadius: radius.md,
      padding: 10,
    },
    lockNoteText: { flex: 1, fontSize: 11.5, color: theme.textSecondary, lineHeight: 16 },
    quoteNote: { fontSize: 13, color: theme.textSecondary, textAlign: "center" },
    retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
    retryBtnText: { fontSize: 13, fontWeight: "700", color: ACCENT },

    slotCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: theme.surface,
      borderWidth: 1.5,
      borderColor: theme.border,
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    slotCardSelected: { borderColor: ACCENT, backgroundColor: theme.surfaceMuted },
    slotIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    slotIconSelected: { backgroundColor: ACCENT },
    slotLabel: { fontSize: 15, fontWeight: "700", color: theme.textPrimary },
    slotLabelSelected: { color: theme.textPrimary },
    slotSub: { fontSize: 12.5, color: theme.textSecondary, marginTop: 2 },

    summaryCard: {
      backgroundColor: theme.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: theme.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    summaryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    summaryHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
    summaryDot: { width: 10, height: 10, borderRadius: 5 },
    summaryTitle: { fontSize: 13, fontWeight: "800", color: theme.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
    editBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    editBtnText: { fontSize: 12.5, fontWeight: "700", color: ACCENT },
    summaryMain: { fontSize: 15, fontWeight: "700", color: theme.textPrimary, lineHeight: 20 },
    summarySub: { fontSize: 13, color: theme.textSecondary, marginTop: 3 },
    summaryNote: { fontSize: 12.5, color: theme.textSecondary, marginTop: 6 },

    warnBox: {
      flexDirection: "row",
      gap: 10,
      backgroundColor: "#FEF3C7",
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.sm,
    },
    warnText: { fontSize: 12.5, color: "#92400E", fontWeight: "600", lineHeight: 18 },

    bottomAction: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      backgroundColor: theme.background,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    bottomRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    backBtn: {
      width: 52,
      height: 52,
      borderRadius: radius.lg,
      backgroundColor: theme.surface,
      borderWidth: 1.5,
      borderColor: theme.border,
      alignItems: "center",
      justifyContent: "center",
    },
    nextBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: ACCENT,
      paddingVertical: 16,
      borderRadius: radius.lg,
      gap: 8,
    },
    nextBtnDisabled: { opacity: 0.6 },
    nextBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },

    banner: {
      position: "absolute",
      top: spacing.xl * 3.2,
      left: spacing.xl,
      right: spacing.xl,
      zIndex: 100,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: radius.lg,
      backgroundColor: "#334155",
      ...shadows.md,
    },
    bannerError: { backgroundColor: "#DC2626" },
    bannerSuccess: { backgroundColor: "#16A34A" },
    bannerInfo: { backgroundColor: "#334155" },
    bannerText: { flex: 1, color: "#fff", fontSize: 13.5, fontWeight: "700", lineHeight: 18 },

    // ---- Pay / Invoice choice modal ----
    payOverlay: {
      flex: 1,
      backgroundColor: "rgba(15, 23, 42, 0.55)",
      justifyContent: "flex-end",
    },
    paySheet: {
      backgroundColor: theme.background,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      padding: spacing.xl,
      paddingBottom: spacing.xl * 1.6,
      gap: spacing.md,
      ...shadows.lg,
    },
    paySuccessBadge: {
      alignSelf: "center",
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: "rgba(34, 197, 94, 0.12)",
      alignItems: "center",
      justifyContent: "center",
    },
    payTitle: { fontSize: 22, fontWeight: "800", color: theme.textPrimary, textAlign: "center" },
    paySubtitle: {
      fontSize: 14,
      color: theme.textSecondary,
      textAlign: "center",
      lineHeight: 20,
      marginBottom: spacing.xs,
    },
    payTotalCard: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: theme.surface,
      borderRadius: radius.lg,
      borderWidth: 1.5,
      borderColor: theme.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    payTotalLabel: { fontSize: 14, fontWeight: "700", color: theme.textSecondary },
    payTotalValue: { fontSize: 22, fontWeight: "800", color: theme.textPrimary },
    payOptionPrimary: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: ACCENT,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.lg,
      paddingVertical: 16,
      minHeight: 64,
      ...shadows.sm,
    },
    payOptionPrimaryTitle: { fontSize: 16, fontWeight: "800", color: "#fff" },
    payOptionPrimarySub: { fontSize: 12.5, fontWeight: "600", color: "rgba(255,255,255,0.85)", marginTop: 2 },
    payOptionSecondary: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: theme.surface,
      borderRadius: radius.lg,
      borderWidth: 1.5,
      borderColor: ACCENT,
      paddingHorizontal: spacing.lg,
      paddingVertical: 16,
      minHeight: 64,
    },
    payOptionSecondaryTitle: { fontSize: 16, fontWeight: "800", color: theme.textPrimary },
    payOptionSecondarySub: { fontSize: 12.5, fontWeight: "600", color: theme.textSecondary, marginTop: 2 },
    payOptionDisabled: { opacity: 0.6 },
    payLaterLink: { alignSelf: "center", paddingVertical: spacing.sm },
    payLaterText: { fontSize: 14, fontWeight: "700", color: theme.textSecondary },
  });
