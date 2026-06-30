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
  assignOrder: (id: string, driver_id: string) =>
    req<any>(`/admin/manage/orders/${id}/assign`, { method: "POST", body: JSON.stringify({ driver_id }) }),
  unassignOrder: (id: string, reason?: string) =>
    req<any>(`/admin/manage/orders/${id}/unassign`, { method: "POST", body: JSON.stringify({ reason }) }),
  restoreOrder: (id: string) => req<any>(`/admin/manage/orders/${id}/restore`, { method: "POST" }),
  pauseOrder: (id: string) => req<any>(`/admin/manage/orders/${id}/pause`, { method: "POST" }),
  completeOrder: (id: string) => req<any>(`/admin/manage/orders/${id}/complete`, { method: "POST" }),
  failOrder: (id: string, reason?: string) =>
    req<any>(`/admin/manage/orders/${id}/fail`, { method: "POST", body: JSON.stringify({ reason }) }),
  addOrderNote: (id: string, note: string) =>
    req<any>(`/admin/manage/orders/${id}/notes`, { method: "POST", body: JSON.stringify({ note }) }),
  assignmentHistory: (id: string) => req<{ history: any[] }>(`/admin/manage/orders/${id}/assignment-history`),

  // Invoices
  invoices: (p: { status?: string; q?: string }) =>
    req<{ invoices: any[]; totals: any }>(`/admin/invoices${qs(p)}`),
  markInvoicePaid: (id: string) => req<any>(`/admin/invoices/${id}/mark-paid`, { method: "POST" }),
  markInvoiceOverdue: (id: string) => req<any>(`/admin/invoices/${id}/mark-overdue`, { method: "POST" }),
  resendInvoice: (id: string) => req<any>(`/admin/invoices/${id}/resend`, { method: "POST" }),
  invoicingSettings: () => req<{ invoice_fee: number; net_days: number }>("/admin/settings/invoicing"),
  updateInvoicingSettings: (body: { invoice_fee: number; net_days: number }) =>
    req<{ invoice_fee: number; net_days: number }>("/admin/settings/invoicing", { method: "POST", body: JSON.stringify(body) }),
  invoicePdfUrl: (id: string) => `${API_BASE}/api/invoices/${id}/pdf?token=${getToken() || ""}`,

  // Receipts (payment receipts + withdrawal invoices/receipts)
  receipts: (p: { doc_type?: string; q?: string }) =>
    req<{ receipts: any[]; totals: any }>(`/admin/receipts${qs(p)}`),
  resendReceipt: (id: string) => req<any>(`/admin/receipts/${id}/resend`, { method: "POST" }),
  receiptPdfUrl: (id: string) => `${API_BASE}/api/receipts/${id}/pdf?token=${getToken() || ""}`,

  // Email logs (delivery audit trail)
  emailLogs: (p: { category?: string; status?: string; q?: string; limit?: number }) =>
    req<{ logs: any[]; totals: any }>(`/admin/email-logs${qs(p)}`),

  // Email templates (preview + test send)
  emailTemplates: () =>
    req<{ templates: any[]; provider: string; sender: string; dry_run: boolean; configured: boolean }>(`/admin/email-templates`),
  emailTemplatePreview: (key: string) =>
    req<{ key: string; label: string; category: string; subject: string; html: string }>(`/admin/email-templates/${key}/preview`),
  emailTemplateTestSend: (key: string, to_email: string) =>
    req<any>(`/admin/email-templates/${key}/test-send`, { method: "POST", body: JSON.stringify({ to_email }) }),

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

  // ---- Fleet (Phase 5) ----
  fleetCompanies: (p?: Record<string, string | number | undefined>) =>
    req<{ items: any[]; total: number }>(`/admin/fleet/companies${qs(p || {})}`),
  fleetCompany: (id: string) => req<any>(`/admin/fleet/companies/${id}`),
  suspendCompany: (id: string) => req<any>(`/admin/fleet/companies/${id}/suspend`, { method: "POST" }),
  activateCompany: (id: string) => req<any>(`/admin/fleet/companies/${id}/activate`, { method: "POST" }),
  fleetPayouts: (p?: Record<string, string | number | undefined>) =>
    req<{ payouts: any[]; totals: any }>(`/admin/fleet/payouts${qs(p || {})}`),
  approveCompanyPayout: (id: string) => req<any>(`/admin/fleet/payouts/${id}/approve`, { method: "POST" }),
  payCompanyPayout: (id: string, reference?: string) =>
    req<any>(`/admin/fleet/payouts/${id}/pay`, { method: "POST", body: JSON.stringify({ reference }) }),
  rejectCompanyPayout: (id: string, reason?: string) =>
    req<any>(`/admin/fleet/payouts/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),

  // ---- Pricing console (versioned) ----
  getPricing: () => req<any>("/admin/pricing"),
  getPricingDefaults: () => req<any>("/admin/pricing/defaults"),
  savePricing: (config: any, note?: string) =>
    req<any>("/admin/pricing", { method: "POST", body: JSON.stringify({ config, note }) }),
  activatePricing: (version: number) =>
    req<any>(`/admin/pricing/activate/${version}`, { method: "POST" }),
  previewPricing: (config: any, sample: any) =>
    req<any>("/admin/pricing/preview", { method: "POST", body: JSON.stringify({ config, sample }) }),
  getPricingSignals: () => req<any>("/admin/pricing/signals"),
};
