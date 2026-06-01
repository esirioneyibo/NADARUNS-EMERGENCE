const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://api.nadaruns.com";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("admin_token");
}

export function setToken(t: string) {
  if (typeof window !== "undefined") localStorage.setItem("admin_token", t);
}
export function clearToken() {
  if (typeof window !== "undefined") localStorage.removeItem("admin_token");
}
export function hasToken(): boolean {
  return !!getToken();
}

async function req<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const t = getToken();
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      msg = j.detail || j.message || msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "" && v !== null) sp.append(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export interface Paged<T> { items: T[]; total: number; page: number; limit: number; }

export const adminApi = {
  login: (email: string, password: string) =>
    req<{ token: string; name: string; is_admin: boolean }>("/auth/admin-login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  overview: () => req<any>("/admin/overview"),

  // Drivers
  drivers: (p: { search?: string; status?: string; page?: number; limit?: number }) =>
    req<Paged<any>>(`/admin/manage/drivers${qs(p)}`),
  driver: (id: string) => req<any>(`/admin/manage/drivers/${id}`),
  updateDriver: (id: string, body: Record<string, unknown>) =>
    req<any>(`/admin/manage/drivers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  suspendDriver: (id: string) => req<any>(`/admin/manage/drivers/${id}/suspend`, { method: "POST" }),
  activateDriver: (id: string) => req<any>(`/admin/manage/drivers/${id}/activate`, { method: "POST" }),

  // Shippers
  shippers: (p: { search?: string; status?: string; page?: number; limit?: number }) =>
    req<Paged<any>>(`/admin/manage/shippers${qs(p)}`),
  shipper: (id: string) => req<any>(`/admin/manage/shippers/${id}`),
  updateShipper: (id: string, body: Record<string, unknown>) =>
    req<any>(`/admin/manage/shippers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  suspendShipper: (id: string) => req<any>(`/admin/manage/shippers/${id}/suspend`, { method: "POST" }),
  activateShipper: (id: string) => req<any>(`/admin/manage/shippers/${id}/activate`, { method: "POST" }),

  // Orders
  orders: (p: { search?: string; status?: string; page?: number; limit?: number }) =>
    req<Paged<any>>(`/admin/manage/orders${qs(p)}`),
  order: (id: string) => req<any>(`/admin/manage/orders/${id}`),
  cancelOrder: (id: string) => req<any>(`/admin/manage/orders/${id}/cancel`, { method: "POST" }),
  reassignOrder: (id: string, driver_id: string) =>
    req<any>(`/admin/manage/orders/${id}/reassign`, { method: "POST", body: JSON.stringify({ driver_id }) }),

  // Vehicles
  vehicles: (p: { search?: string; vehicle_type?: string }) =>
    req<{ items: any[]; total: number }>(`/admin/manage/vehicles${qs(p)}`),

  // KYC
  kyc: () => req<any[]>("/admin/kyc-applications"),
  kycApprove: (id: string) => req<any>(`/admin/kyc/${id}/approve`, { method: "POST" }),
  kycReject: (id: string, reason: string) =>
    req<any>(`/admin/kyc/${id}/reject?reason=${encodeURIComponent(reason)}`, { method: "POST" }),

  // Financials
  financialsOverview: () => req<any>("/admin/financials/overview"),
  financialsTransactions: (p: { type?: string; page?: number; limit?: number }) =>
    req<Paged<any>>(`/admin/financials/transactions${qs(p)}`),
  authorizedPayments: () => req<{ items: any[]; total: number }>("/admin/payments/authorized"),
  capturePayment: (orderId: string) =>
    req<any>(`/payments/orders/${orderId}/capture`, { method: "POST", body: JSON.stringify({}) }),
  cancelAuthorization: (orderId: string) =>
    req<any>(`/payments/orders/${orderId}/cancel-authorization`, { method: "POST" }),
  withdrawals: (p: { status?: string; page?: number; limit?: number }) =>
    req<Paged<any>>(`/admin/financials/withdrawals${qs(p)}`),
  approveWithdrawal: (id: string) =>
    req<any>(`/admin/financials/withdrawals/${id}/approve`, { method: "POST" }),
  payWithdrawal: (id: string, reference?: string) =>
    req<any>(`/admin/financials/withdrawals/${id}/pay`, { method: "POST", body: JSON.stringify({ reference }) }),
  rejectWithdrawal: (id: string, reason?: string) =>
    req<any>(`/admin/financials/withdrawals/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),

  // Stripe settings (test/live keys + mode)
  getStripeSettings: () => req<any>("/admin/settings/stripe"),
  updateStripeSettings: (body: { test_secret_key?: string; live_secret_key?: string; mode?: string; webhook_secret?: string }) =>
    req<any>("/admin/settings/stripe", { method: "POST", body: JSON.stringify(body) }),

  // Live dispatch map
  dispatchMap: () => req<any>("/admin/dispatch/map"),
};
