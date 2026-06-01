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
  pickup_photo?: string | null;
  delivery_photo?: string | null;
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

export type PaymentStatus =
  | "unpaid" | "pending" | "authorized" | "captured" | "payment_failed" | "refunded" | "canceled";

export interface PaymentSummary {
  order_id: string;
  order_number?: string;
  payment_status: PaymentStatus;
  payment_amount?: number | null;
  commission_amount?: number | null;
  driver_payout_amount?: number | null;
  currency: string;
  stripe_payment_intent_id?: string | null;
  authorized_at?: string | null;
  captured_at?: string | null;
}

export interface WalletEarning {
  order_id: string;
  order_number?: string;
  amount: number;
  gross_amount: number;
  commission_amount: number;
  created_at: string;
}

export interface WithdrawalItem {
  id: string;
  driver_id: string;
  amount: number;
  currency: string;
  method: string;
  account_details?: string | null;
  status: "pending" | "approved" | "paid" | "rejected";
  reference?: string | null;
  note?: string | null;
  requested_at: string;
  processed_at?: string | null;
}

export interface DriverWallet {
  available_balance: number;
  pending_balance: number;
  total_earned: number;
  total_withdrawn: number;
  currency: string;
  earnings: WalletEarning[];
  withdrawals: WithdrawalItem[];
}

export interface NotificationPrefs {
  push: boolean;
  sound: boolean;
  new_orders: boolean;
  earnings_summary: boolean;
}

export interface Vehicle {
  id: string;
  vehicle_type: string;
  label: string;
  plate: string;
  capacity_kg: number;
  is_primary: boolean;
}

export interface Driver {
  id: string;
  name: string;
  rating: number;
  avatar: string;
  vehicle: string;
  vehicle_type: string;
  vehicle_capacity_kg: number;
  plate: string;
  vehicles: Vehicle[];
  email: string;
  phone: string;
  is_online: boolean;
  earnings_today: number;
  deliveries_today: number;
  acceptance_rate: number;
  completion_rate?: number;
  notifications: NotificationPrefs;
}

export interface DriverPerformance {
  status: "offline" | "online" | "busy" | string;
  is_online: boolean;
  rating: number;
  acceptance_rate: number;
  completion_rate: number;
  earnings: { today: number; week: number; total: number };
  deliveries: { today: number; week: number; total: number };
  recent_deliveries: {
    order_number: string;
    pickup_name: string;
    dropoff_name: string;
    earnings: number;
    distance_km: number;
    completed_at: string;
  }[];
}

export interface DriverUpdate {
  name?: string;
  vehicle?: string;
  vehicle_type?: string;
  vehicle_capacity_kg?: number;
  plate?: string;
  email?: string;
  phone?: string;
  avatar?: string;
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
