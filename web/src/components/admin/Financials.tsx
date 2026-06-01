"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState } from "react";
import { Wallet, Receipt, BadgeEuro, HandCoins, Clock, CheckCircle2 } from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import { LineAreaChart } from "./charts";
import { Spinner, money, fmtDate } from "./ui";

const WD_STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  pending: { bg: "#FEF3C7", fg: "#B45309", label: "Pending" },
  approved: { bg: "#DBEAFE", fg: "#1D4ED8", label: "Approved" },
  paid: { bg: "#DCFCE7", fg: "#15803D", label: "Paid" },
  rejected: { bg: "#FEE2E2", fg: "#B91C1C", label: "Rejected" },
};

function Chip({ status }: { status: string }) {
  const m = WD_STATUS[status] || { bg: "#F1F5F9", fg: "#64748B", label: status };
  return <span style={{ background: m.bg, color: m.fg, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800 }}>{m.label}</span>;
}

export default function Financials({ notify }: { notify: (m: string, t?: "ok" | "err") => void }) {
  const [overview, setOverview] = useState<any>(null);
  const [authorized, setAuthorized] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [txns, setTxns] = useState<any[]>([]);
  const [wdFilter, setWdFilter] = useState<string>("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      setErr("");
      const [ov, az, wd, tx] = await Promise.all([
        adminApi.financialsOverview(),
        adminApi.authorizedPayments(),
        adminApi.withdrawals({ status: wdFilter || undefined, limit: 50 }),
        adminApi.financialsTransactions({ limit: 50 }),
      ]);
      setOverview(ov);
      setAuthorized(az.items || []);
      setWithdrawals(wd.items || []);
      setTxns(tx.items || []);
    } catch (e: any) {
      setErr(e.message || "Failed to load financials");
    }
  }, [wdFilter]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const capture = async (orderId: string) => {
    setBusy(orderId);
    try { await adminApi.capturePayment(orderId); notify("Payment captured"); await loadAll(); }
    catch (e: any) { notify(e.message || "Capture failed", "err"); }
    finally { setBusy(null); }
  };
  const release = async (orderId: string) => {
    setBusy(orderId);
    try { await adminApi.cancelAuthorization(orderId); notify("Authorization released"); await loadAll(); }
    catch (e: any) { notify(e.message || "Release failed", "err"); }
    finally { setBusy(null); }
  };
  const approve = async (id: string) => {
    setBusy(id);
    try { await adminApi.approveWithdrawal(id); notify("Cash-out approved"); await loadAll(); }
    catch (e: any) { notify(e.message || "Approve failed", "err"); }
    finally { setBusy(null); }
  };
  const pay = async (id: string) => {
    const ref = typeof window !== "undefined" ? window.prompt("Payment reference (bank/PayPal transaction id):", "") : "";
    setBusy(id);
    try { await adminApi.payWithdrawal(id, ref || undefined); notify("Cash-out marked paid"); await loadAll(); }
    catch (e: any) { notify(e.message || "Payout failed", "err"); }
    finally { setBusy(null); }
  };
  const reject = async (id: string) => {
    const reason = typeof window !== "undefined" ? window.prompt("Reason for rejection:", "") : "";
    setBusy(id);
    try { await adminApi.rejectWithdrawal(id, reason || undefined); notify("Cash-out rejected"); await loadAll(); }
    catch (e: any) { notify(e.message || "Reject failed", "err"); }
    finally { setBusy(null); }
  };

  if (err) return <div className="adm-card" style={{ color: "#991B1B" }}>{err}</div>;
  if (!overview) return <Spinner label="Loading financials…" />;

  const k = overview.kpis;
  const series = overview.series || [];
  const fmtDay = (d: string) => { try { return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return d; } };

  const kpis = [
    { label: "Total revenue", value: money(k.total_revenue), icon: BadgeEuro, bg: "#DCFCE7", fg: "#16A34A", sub: `${k.captured_payments} captured` },
    { label: "Platform commission", value: money(k.total_commission), icon: Wallet, bg: "#EDE9FE", fg: "#7C3AED" },
    { label: "Driver payouts", value: money(k.total_driver_payouts), icon: HandCoins, bg: "#DBEAFE", fg: "#2563EB" },
    { label: "Authorized (held)", value: money(k.authorized_amount), icon: Clock, bg: "#FEF3C7", fg: "#D97706", sub: `${k.authorized_count} awaiting` },
    { label: "Pending cash-outs", value: money(k.pending_withdrawals_amount), icon: Receipt, bg: "#FEE2E2", fg: "#DC2626", sub: `${k.pending_withdrawals_count} requests` },
    { label: "Paid out", value: money(k.paid_withdrawals_amount), icon: CheckCircle2, bg: "#DCFCE7", fg: "#16A34A", sub: `${k.paid_withdrawals_count} paid` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }} data-testid="financials-root">
      <div className="adm-kpis">
        {kpis.map((x, i) => (
          <div key={i} className="adm-kpi">
            <div className="adm-kpi-top">
              <div className="adm-kpi-icon" style={{ background: x.bg, color: x.fg }}><x.icon size={20} /></div>
            </div>
            <div className="adm-kpi-num">{x.value}</div>
            <div className="adm-kpi-label">
              {x.label}{x.sub ? <span style={{ color: "#94A3B8", fontWeight: 500 }}> · {x.sub}</span> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="adm-grid-2">
        <div className="adm-card">
          <div className="adm-card-title">Revenue — last 14 days</div>
          <LineAreaChart data={series.map((s: any) => ({ label: fmtDay(s.date), value: s.revenue }))} color="#6366F1" valuePrefix="€" />
        </div>
        <div className="adm-card">
          <div className="adm-card-title">Commission — last 14 days</div>
          <LineAreaChart data={series.map((s: any) => ({ label: fmtDay(s.date), value: s.commission }))} color="#7C3AED" valuePrefix="€" />
        </div>
      </div>

      {/* Payments awaiting capture */}
      <div className="adm-card">
        <div className="adm-card-title">Payments awaiting capture ({authorized.length})</div>
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead><tr><th>Order</th><th>Amount</th><th>Commission</th><th>Driver</th><th>Authorized</th><th>Actions</th></tr></thead>
            <tbody>
              {authorized.map((o) => (
                <tr key={o.order_id} data-testid={`authorized-${o.order_id}`}>
                  <td style={{ fontWeight: 700 }}>#{o.order_number || (o.order_id || "").slice(0, 6)}</td>
                  <td style={{ fontWeight: 700 }}>{money(o.payment_amount)}</td>
                  <td>{money(o.commission_amount)}</td>
                  <td>{money(o.driver_payout_amount)}</td>
                  <td style={{ color: "#94A3B8" }}>{fmtDate(o.authorized_at)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="adm-btn adm-btn-primary" data-testid={`capture-${o.order_id}`} disabled={busy === o.order_id} onClick={() => capture(o.order_id)}>Capture</button>
                      <button className="adm-btn" disabled={busy === o.order_id} onClick={() => release(o.order_id)}>Release</button>
                    </div>
                  </td>
                </tr>
              ))}
              {authorized.length === 0 && <tr><td colSpan={6} style={{ color: "#94A3B8" }}>No payments awaiting capture</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cash-out requests */}
      <div className="adm-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div className="adm-card-title" style={{ marginBottom: 0 }}>Cash-out requests</div>
          <select className="adm-input" data-testid="wd-filter" value={wdFilter} onChange={(e) => setWdFilter(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead><tr><th>Driver</th><th>Amount</th><th>Method</th><th>Account</th><th>Status</th><th>Requested</th><th>Actions</th></tr></thead>
            <tbody>
              {withdrawals.map((w) => (
                <tr key={w.id} data-testid={`withdrawal-${w.id}`}>
                  <td style={{ fontWeight: 700 }}>{w.driver_name || (w.driver_id || "").slice(0, 8)}</td>
                  <td style={{ fontWeight: 700 }}>{money(w.amount)}</td>
                  <td style={{ textTransform: "capitalize" }}>{(w.method || "").replace("_", " ")}</td>
                  <td style={{ fontSize: 12, color: "#64748B" }}>{w.account_details || "—"}</td>
                  <td><Chip status={w.status} /></td>
                  <td style={{ color: "#94A3B8" }}>{fmtDate(w.requested_at)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {w.status === "pending" && (
                        <>
                          <button className="adm-btn adm-btn-primary" data-testid={`approve-${w.id}`} disabled={busy === w.id} onClick={() => approve(w.id)}>Approve</button>
                          <button className="adm-btn" disabled={busy === w.id} onClick={() => reject(w.id)}>Reject</button>
                        </>
                      )}
                      {w.status === "approved" && (
                        <button className="adm-btn adm-btn-primary" data-testid={`pay-${w.id}`} disabled={busy === w.id} onClick={() => pay(w.id)}>Mark paid</button>
                      )}
                      {(w.status === "paid" || w.status === "rejected") && <span style={{ color: "#94A3B8", fontSize: 13 }}>{w.reference || w.note || "—"}</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {withdrawals.length === 0 && <tr><td colSpan={7} style={{ color: "#94A3B8" }}>No cash-out requests</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transaction history */}
      <div className="adm-card">
        <div className="adm-card-title">Payment history</div>
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead><tr><th>Order</th><th>Type</th><th>Gross</th><th>Commission</th><th>Driver</th><th>When</th></tr></thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 700 }}>#{t.order_number || (t.order_id || "").slice(0, 6)}</td>
                  <td style={{ textTransform: "capitalize" }}>{t.type}</td>
                  <td style={{ fontWeight: 700 }}>{money(t.gross_amount)}</td>
                  <td>{money(t.commission_amount)}</td>
                  <td>{money(t.driver_amount)}</td>
                  <td style={{ color: "#94A3B8" }}>{fmtDate(t.created_at)}</td>
                </tr>
              ))}
              {txns.length === 0 && <tr><td colSpan={6} style={{ color: "#94A3B8" }}>No transactions yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
