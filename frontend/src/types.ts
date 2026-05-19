export type OrderStatus =
  | "pending"
  | "accepted"
  | "enroute_pickup"
  | "arrived_pickup"
  | "picked_up"
  | "enroute_dropoff"
  | "arrived_dropoff"
  | "delivered"
  | "rejected";

export interface GeoPoint {
  lat: number;
  lng: number;
  address: string;
  name?: string | null;
}

export interface OrderItem {
  name: string;
  quantity: number;
  note?: string | null;
}

export interface Customer {
  name: string;
  rating: number;
  avatar?: string | null;
  phone?: string | null;
  apartment?: string | null;
  gate_code?: string | null;
  notes?: string | null;
}

export interface Order {
  id: string;
  order_number: string;
  status: OrderStatus;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  customer: Customer;
  items: OrderItem[];
  distance_km: number;
  eta_minutes: number;
  earnings: number;
  tip: number;
  pickup_otp: string;
  dropoff_otp: string;
  pickup_otp_verified: boolean;
  dropoff_otp_verified: boolean;
  created_at: string;
  completed_at?: string | null;
  rating_given?: number | null;
  feedback?: string | null;
}

export interface WalletTransaction {
  id: string;
  type: "delivery" | "tip" | "payout" | "bonus";
  amount: number;
  description: string;
  timestamp: string;
}

export interface Wallet {
  available_balance: number;
  pending_balance: number;
  payout_schedule: string;
  next_payout_date: string;
  transactions: WalletTransaction[];
}

export interface NotificationPrefs {
  push: boolean;
  sound: boolean;
  new_orders: boolean;
  earnings_summary: boolean;
}

export interface Driver {
  id: string;
  name: string;
  rating: number;
  avatar: string;
  vehicle: string;
  vehicle_type: string;
  plate: string;
  email: string;
  phone: string;
  is_online: boolean;
  earnings_today: number;
  deliveries_today: number;
  acceptance_rate: number;
  notifications: NotificationPrefs;
}

export interface DriverUpdate {
  name?: string;
  vehicle?: string;
  vehicle_type?: string;
  plate?: string;
  email?: string;
  phone?: string;
  notifications?: NotificationPrefs;
}

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface DirectionsResponse {
  points: RoutePoint[];
  distance_meters: number;
  duration_seconds: number;
  source: "google" | "fallback";
}
