import type { DirectionsResponse, Driver, DriverUpdate, Order, Wallet } from "./types";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API ${path} failed (${res.status}): ${txt}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  getDriver: () => request<Driver>("/driver/me"),
  toggleOnline: () => request<Driver>("/driver/toggle-online", { method: "POST" }),
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
  updateDriver: (update: DriverUpdate) =>
    request<Driver>("/driver/me", { method: "PATCH", body: JSON.stringify(update) }),
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
  getWallet: () => request<Wallet>("/driver/wallet"),
  
  // Registration
  registerDriver: (data: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    vehicle_type: string;
    city: string;
    license_plate?: string;
  }) => request<{ driver_id: string; message: string; kyc_required: boolean }>("/driver/register", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  
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
};
