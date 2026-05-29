import Constants from "expo-constants";
import type { DirectionsResponse, Driver, DriverUpdate, Order, Wallet } from "./types";

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

// Token storage for authenticated requests
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
      // Parse error message from JSON if possible
      try {
        const err = JSON.parse(txt);
        throw new Error(err.detail || err.message || `API ${path} failed (${res.status})`);
      } catch {
        throw new Error(`API ${path} failed (${res.status}): ${txt}`);
      }
    }
    
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (error: any) {
    // Better error handling for network issues
    if (error.message === "Network request failed" || error.name === "TypeError") {
      console.error(`Network error calling ${url}:`, error);
      throw new Error(`Network request failed. Please check your internet connection and try again. (URL: ${url})`);
    }
    throw error;
  }
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
  
  // Available orders for map-based discovery
  getAvailableOrders: () => request<Order[]>("/orders/available"),
  
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
  
  simulateKYCApproval: () => request<any>("/driver/kyc/simulate-approval", { method: "POST" }),
  
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
};
