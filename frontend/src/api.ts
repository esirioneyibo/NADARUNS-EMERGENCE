import Constants from "expo-constants";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { DirectionsResponse, Driver, DriverUpdate, Order, Wallet, PaymentSummary, DriverWallet, WithdrawalItem, Company, CompanyInfo, FleetDriver, FleetVehicle, JobAcceptanceMode } from "./types";

// Get BASE URL from environment with multiple fallback options
// Priority: 1. EXPO_PUBLIC_BACKEND_URL env var, 2. Extra config, 3. Hardcoded production URL
const getBaseUrl = (): string => {
  // Try environment variable first (works in development)
  if (process.env.EXPO_PUBLIC_BACKEND_URL) {
    return process.env.EXPO_PUBLIC_BACKEND_URL;
  }
  
  // Try Expo Constants extra config (works in EAS builds)
  const extra = Constants.expoConfig?.extra;
  if (extra?.backendUrl) {
    return extra.backendUrl;
  }
  
  // Fallback to production URL for standalone builds
  // IMPORTANT: Change this to your production API URL
  return "https://api.nadaruns.com";
};

const rawBase = getBaseUrl();
// Remove trailing slash if present
const BASE = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;

// API prefix - your backend routes are at /api/*
const API_PREFIX = "/api";

// Token storage for authenticated requests.
// The token also lives in SecureStore (native) / AsyncStorage (web). On a cold
// app launch or a deep-link, a screen may fire a request BEFORE AuthProvider has
// finished its async rehydration. To avoid a token race (401 on first load), the
// request() helper lazily rehydrates the token from storage when it isn't yet in
// memory. Keep this key in sync with AuthContext (TOKEN_KEY).
const TOKEN_KEY = "nadaruns_auth_token";
let authToken: string | null = null;
let tokenResolved = false;

async function readTokenFromStorage(): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      return await AsyncStorage.getItem(TOKEN_KEY);
    }
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

// Ensure we have attempted to load the persisted token at least once before a
// request goes out. After login/logout/AuthProvider hydration set it explicitly,
// tokenResolved short-circuits this so we never re-read stale storage.
async function ensureTokenLoaded(): Promise<void> {
  if (authToken || tokenResolved) return;
  authToken = await readTokenFromStorage();
  tokenResolved = true;
}

export function setAuthToken(token: string | null) {
  authToken = token;
  tokenResolved = true; // an explicit set (login/logout/hydrate) is authoritative
}

export function getAuthToken(): string | null {
  return authToken;
}

/**
 * Convert any failed HTTP response into a clean, human-friendly message.
 * Never leaks raw HTML gateway pages (502/nginx), URLs, or stack traces.
 */
export function friendlyError(status: number, rawText: string): string {
  // Prefer a clean JSON detail from our backend, if present and not HTML.
  try {
    const parsed = JSON.parse(rawText);
    const detail = parsed?.detail ?? parsed?.message;
    if (typeof detail === "string" && detail.trim() && !/<[a-z!/]/i.test(detail)) {
      return detail;
    }
    if (Array.isArray(detail) && detail[0]?.msg) {
      return String(detail[0].msg);
    }
  } catch {
    /* Not JSON (e.g. an HTML 502/nginx page) — fall through to status mapping. */
  }
  switch (true) {
    case status === 400:
      return "Something in your request wasn't right. Please review and try again.";
    case status === 401:
    case status === 403:
      return "Your email or password is incorrect.";
    case status === 404:
      return "We couldn't find what you were looking for.";
    case status === 408:
      return "The request timed out. Please try again.";
    case status === 409:
      return "That conflicts with existing data. Please try again.";
    case status === 422:
      return "Some details look invalid. Please review and try again.";
    case status === 429:
      return "Too many attempts. Please wait a moment and try again.";
    case status === 502 || status === 503 || status === 504:
      return "The server is temporarily unavailable. Please try again in a moment.";
    case status >= 500:
      return "Something went wrong on our end. Please try again shortly.";
    default:
      return "Something went wrong. Please try again.";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Rehydrate the persisted token if a request races AuthProvider on cold load.
  await ensureTokenLoaded();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  
  // Add auth token if available
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  
  const url = `${BASE}${API_PREFIX}${path}`;
  
  try {
    const res = await fetch(url, {
      headers,
      ...init,
    });
    
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(friendlyError(res.status, txt));
    }
    
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (error: any) {
    // Network/connection failures never expose internal URLs to the user.
    if (
      error?.message === "Network request failed" ||
      error?.name === "TypeError" ||
      error?.message === "Failed to fetch"
    ) {
      throw new Error("Couldn't reach the server. Please check your connection and try again.");
    }
    throw error;
  }
}

// Register a native device push token with the backend (Emergent push relay).
export async function registerPushToken(body: {
  user_id: string;
  platform: string;
  device_token: string;
}): Promise<{ status: string }> {
  return request("/register-push", { method: "POST", body: JSON.stringify(body) });
}

// Auth types
export interface LoginResponse {
  token: string;
  driver_id: string;
  name: string;
  is_admin: boolean;
}

export interface ShipperLoginResponse {
  token: string;
  shipper_id: string;
  business_name: string;
}

export interface RegisterResponse {
  driver_id: string;
  message: string;
  token: string;
  kyc_required: boolean;
  name: string;
}

export interface ShipperRegisterResponse {
  shipper_id: string;
  message: string;
  token: string;
  business_name: string;
}

export const api = {
  // Authentication
  login: (email: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  
  adminLogin: (email: string, password: string) =>
    request<LoginResponse>("/auth/admin-login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  
  shipperLogin: (email: string, password: string) =>
    request<ShipperLoginResponse>("/auth/shipper-login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  
  getMe: () => request<{ id: string; type: string; email?: string; driver?: Driver }>("/auth/me"),
  
  // Registration
  driverRegister: (data: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }) => request<RegisterResponse>("/auth/driver-register", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  
  shipperRegister: (data: {
    business_name: string;
    email: string;
    password: string;
    phone?: string;
  }) => request<ShipperRegisterResponse>("/auth/shipper-register", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  
  registerDriver: (data: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    password: string;
    vehicle_type: string;
    city: string;
    license_plate?: string;
    vehicle_capacity_kg?: number;
  }) => request<RegisterResponse>("/driver/register", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  
  // Driver
  getDriver: () => request<Driver>("/driver/me"),
  toggleOnline: () => request<Driver>("/driver/toggle-online", { method: "POST" }),
  updateDriver: (update: DriverUpdate) =>
    request<Driver>("/driver/me", { method: "PATCH", body: JSON.stringify(update) }),
  getDriverPerformance: () => request<DriverPerformance>("/driver/performance"),

  // Driver vehicles (multi-vehicle garage)
  addVehicle: (body: { vehicle_type: string; plate?: string; capacity_kg?: number; make_primary?: boolean }) =>
    request<Driver>("/driver/vehicles", { method: "POST", body: JSON.stringify(body) }),
  updateVehicle: (
    id: string,
    body: { vehicle_type: string; plate?: string; capacity_kg?: number; make_primary?: boolean }
  ) => request<Driver>(`/driver/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  setPrimaryVehicle: (id: string) =>
    request<Driver>(`/driver/vehicles/${id}/primary`, { method: "POST" }),
  deleteVehicle: (id: string) =>
    request<Driver>(`/driver/vehicles/${id}`, { method: "DELETE" }),

  // Shipper profile
  getShipper: () => request<any>("/shipper/me"),
  updateShipper: (update: Record<string, any>) =>
    request<any>("/shipper/me", { method: "PATCH", body: JSON.stringify(update) }),

  // Account: authenticated password change (driver or shipper)
  changePassword: (current_password: string, new_password: string) =>
    request<{ status: string; message: string }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),
  
  // Orders
  getPending: () => request<Order | null>("/orders/pending"),
  getActive: () => request<Order | null>("/orders/active"),
  getHistory: () => request<Order[]>("/orders/history"),
  accept: (id: string) => request<Order>(`/orders/${id}/accept`, { method: "POST" }),
  reject: (id: string) => request<Order>(`/orders/${id}/reject`, { method: "POST" }),
  advance: (id: string) =>
    request<Order>(`/orders/${id}/advance`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  rate: (id: string, rating: number, feedback?: string) =>
    request<Order>(`/orders/${id}/rate`, {
      method: "POST",
      body: JSON.stringify({ rating, feedback }),
    }),
  // Shipper rates the driver (1-5 stars, one-time)
  rateDriver: (id: string, rating: number, review?: string) =>
    request<{ success: boolean; driver_rating: number; driver_average_rating: number | null }>(
      `/shipper/shipments/${id}/rate-driver`,
      { method: "POST", body: JSON.stringify({ rating, review }) },
    ),
  // Driver rates the shipper (1-5 stars, one-time)
  rateShipper: (id: string, rating: number, review?: string) =>
    request<{ success: boolean; shipper_rating: number; shipper_average_rating: number | null }>(
      `/orders/${id}/rate-shipper`,
      { method: "POST", body: JSON.stringify({ rating, review }) },
    ),
  seedNewPending: () => request<Order>(`/orders/seed-new-pending`, { method: "POST" }),
  getRoute: (orderId: string) => request<DirectionsResponse>(`/orders/${orderId}/route`),
  verifyOtp: (orderId: string, otp: string, kind: "pickup" | "dropoff") =>
    request<Order>(`/orders/${orderId}/verify-otp`, {
      method: "POST",
      body: JSON.stringify({ otp, kind }),
    }),
  attachDeliveryPhoto: (orderId: string, photo: string) =>
    request<Order>(`/orders/${orderId}/photo`, {
      method: "POST",
      body: JSON.stringify({ photo }),
    }),
  attachPickupPhoto: (orderId: string, photo: string) =>
    request<Order>(`/orders/${orderId}/pickup-photo`, {
      method: "POST",
      body: JSON.stringify({ photo }),
    }),
  
  // Available orders for map-based discovery (optionally proximity-filtered)
  getAvailableOrders: (coords?: { lat: number; lng: number }, radiusKm?: number) => {
    const params = new URLSearchParams();
    if (coords) {
      params.append("lat", String(coords.lat));
      params.append("lng", String(coords.lng));
      if (radiusKm) params.append("radius_km", String(radiusKm));
    }
    const qs = params.toString();
    return request<Order[]>(`/orders/available${qs ? `?${qs}` : ""}`);
  },
  
  // Available orders filtered by vehicle type
  getAvailableOrdersFiltered: (vehicleType?: string, minCapacityKg?: number) => {
    const params = new URLSearchParams();
    if (vehicleType) params.append("vehicle_type", vehicleType);
    if (minCapacityKg) params.append("min_capacity_kg", minCapacityKg.toString());
    const queryString = params.toString();
    return request<Order[]>(`/orders/available${queryString ? `?${queryString}` : ""}`);
  },
  
  // Get orders matched to driver's vehicle type and capacity
  getMatchedOrders: () => request<Order[]>("/orders/available/matched"),
  
  // Wallet
  getWallet: () => request<Wallet>("/driver/wallet"),

  // ---- Payments (Stripe auth -> capture) ----
  getPaymentConfig: () =>
    request<{ configured: boolean; test_mode: boolean; currency: string }>("/payments/config"),
  createPaymentCheckout: (orderId: string, urls?: { success_url?: string; cancel_url?: string }) =>
    request<{ url: string; session_id: string; payment_status: string }>(
      `/payments/orders/${orderId}/checkout`,
      { method: "POST", body: JSON.stringify(urls || {}) }
    ),
  getPaymentStatus: (orderId: string) =>
    request<PaymentSummary>(`/payments/orders/${orderId}/status`),
  // Invoicing ("Accept Invoice" flow)
  acceptInvoice: (orderId: string) =>
    request<any>(`/shipper/shipments/${orderId}/accept-invoice`, { method: "POST" }),
  getShipperInvoices: () => request<any[]>("/shipper/invoices"),
  getInvoice: (invoiceId: string) => request<any>(`/invoices/${invoiceId}`),
  // Saved payment methods (Stripe SetupIntent via hosted Checkout)
  createSetupCheckout: (urls?: { success_url?: string; cancel_url?: string }) =>
    request<{ url: string; session_id: string }>("/shipper/payment-methods/setup-checkout", {
      method: "POST",
      body: JSON.stringify(urls || {}),
    }),
  getPaymentMethods: () =>
    request<{ customer_id: string | null; payment_methods: any[] }>("/shipper/payment-methods"),
  setDefaultPaymentMethod: (pmId: string) =>
    request<any>(`/shipper/payment-methods/${pmId}/default`, { method: "POST" }),
  deletePaymentMethod: (pmId: string) =>
    request<any>(`/shipper/payment-methods/${pmId}`, { method: "DELETE" }),
  payWithSavedCard: (orderId: string, paymentMethodId: string) =>
    request<PaymentSummary>(`/payments/orders/${orderId}/pay-with-saved-card`, {
      method: "POST",
      body: JSON.stringify({ payment_method_id: paymentMethodId }),
    }),
  authorizePaymentTest: (orderId: string) =>
    request<PaymentSummary>(`/payments/orders/${orderId}/authorize-test`, { method: "POST" }),

  // ---- Driver wallet & cash-out (financial module) ----
  getDriverWallet: () => request<DriverWallet>("/wallet/driver"),
  requestWithdrawal: (body: { amount: number; method?: string; account_details?: string }) =>
    request<DriverWallet & { withdrawal: WithdrawalItem }>("/wallet/withdraw", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getWithdrawals: () => request<{ withdrawals: WithdrawalItem[] }>("/wallet/withdrawals"),
  
  // KYC
  getKYCStatus: () => request<{
    driver_id: string;
    license_front: string | null;
    license_back: string | null;
    selfie: string | null;
    overall_status: string;
    submitted_at: string | null;
    reviewed_at: string | null;
  }>("/driver/kyc-status"),
  
  uploadKYCDocument: (document_type: string, image_data: string) =>
    request<any>("/driver/kyc/upload", {
      method: "POST",
      body: JSON.stringify({ document_type, image_data }),
    }),
  
  submitKYCDocuments: (license_front: string, license_back: string, selfie: string) =>
    request<any>("/driver/kyc/submit", {
      method: "POST",
      body: JSON.stringify({ license_front, license_back, selfie }),
    }),
  
  // Real-time location tracking
  updateDriverLocation: (location: { lat: number; lng: number }, orderId?: string) =>
    request<{ status: string }>("/driver/location", {
      method: "POST",
      body: JSON.stringify({ location, order_id: orderId }),
    }),
  
  getDriverLocation: (orderId: string) =>
    request<{
      driver_id: string | null;
      driver_name: string | null;
      driver_location: { lat: number; lng: number } | null;
      location_updated_at: string | null;
    }>(`/orders/${orderId}/driver-location`),

  // ---- Fleet / Company management (Phase 1) ----
  getMyCompany: () => request<CompanyInfo>("/company/me"),
  createCompany: (body: {
    company_name: string;
    business_id?: string;
    phone?: string;
    email?: string;
    address?: string;
  }) => request<{ company: Company; role: string }>("/company", { method: "POST", body: JSON.stringify(body) }),
  updateCompany: (body: Partial<{
    company_name: string;
    business_id: string;
    phone: string;
    email: string;
    address: string;
    job_acceptance_mode: JobAcceptanceMode;
  }>) => request<{ company: Company }>("/company", { method: "PATCH", body: JSON.stringify(body) }),

  getCompanyDrivers: () => request<{ drivers: FleetDriver[] }>("/company/drivers"),
  addCompanyDriver: (body: {
    first_name: string;
    last_name?: string;
    email: string;
    phone?: string;
    password: string;
    license_class?: string;
    vehicle_type?: string;
  }) => request<{ driver: FleetDriver }>("/company/drivers", { method: "POST", body: JSON.stringify(body) }),
  suspendCompanyDriver: (id: string) =>
    request<{ success: boolean }>(`/company/drivers/${id}/suspend`, { method: "PATCH" }),
  activateCompanyDriver: (id: string) =>
    request<{ success: boolean }>(`/company/drivers/${id}/activate`, { method: "PATCH" }),
  removeCompanyDriver: (id: string) =>
    request<{ success: boolean }>(`/company/drivers/${id}`, { method: "DELETE" }),

  getCompanyVehicles: () => request<{ vehicles: FleetVehicle[] }>("/company/vehicles"),
  addCompanyVehicle: (body: {
    registration_number: string;
    vehicle_type: string;
    capacity_kg?: number;
    max_weight_kg?: number;
    length_cm?: number;
    width_cm?: number;
    height_cm?: number;
  }) => request<{ vehicle: FleetVehicle }>("/company/vehicles", { method: "POST", body: JSON.stringify(body) }),
  updateCompanyVehicle: (id: string, body: Partial<{
    registration_number: string;
    vehicle_type: string;
    status: "active" | "disabled";
  }>) => request<{ vehicle: FleetVehicle }>(`/company/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  assignVehicleDriver: (id: string, driver_id: string) =>
    request<{ vehicle: FleetVehicle }>(`/company/vehicles/${id}/assign`, { method: "POST", body: JSON.stringify({ driver_id }) }),
  unassignVehicleDriver: (id: string) =>
    request<{ vehicle: FleetVehicle }>(`/company/vehicles/${id}/unassign`, { method: "POST" }),
  deleteCompanyVehicle: (id: string) =>
    request<{ success: boolean }>(`/company/vehicles/${id}`, { method: "DELETE" }),
};
