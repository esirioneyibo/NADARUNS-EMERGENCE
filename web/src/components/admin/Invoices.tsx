"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState } from "react";
import { Search, Settings as SettingsIcon } from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import { Spinner, StatusBadge, Drawer, money, fmtDate, InfoRow, EmptyState } from "./ui";

type Notify = (msg: string, type?: "ok" | "err") => void;
const STATUSES = ["all", "unpaid", "overdue", "paid", "cancelled"];

export default function Invoices({ notify }: { notify: Notify }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminApi.invoices({ q: search, status })); }
    catch (e: any) { notify(e.message, "err"); } finally { setLoading(false); }
  }, [search, status, notify]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const totals = data?.totals;
  const sel = data?.invoices?.find((i: any) => i.id === selId) || null;

  return (
    <div>
      {totals && (
        <div className="adm-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
          <KpiCard label="Total invoices" value={String(totals.count)} testId="inv-kpi-count" />
          <KpiCard label="Unpaid" value={String(totals.unpaid)} tone="#D97706" testId="inv-kpi-unpaid" />
          <KpiCard label="Overdue" value={String(totals.overdue)} tone="#DC2626" testId="inv-kpi-overdue" />
          <KpiCard label="Outstanding" value={money(totals.total_outstanding)} tone="#0F172A" testId="inv-kpi-outstanding" />
        </div>
      )}
      <div className="adm-toolbar">
        <div className="adm-search"><Search size={16} /><input className="adm-input" data-testid="invoices-search" placeholder="Search invoice #, company, email…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="adm-select" data-testid="invoices-status-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
        </select>
        <button className="adm-btn adm-btn-ghost" data-testid="invoices-settings-btn" onClick={() => setShowSettings(true)}><SettingsIcon size={15} /> Invoicing settings</button>
      </div>
      <div className="adm-table-wrap"><div className="adm-table-scroll">
        <table className="adm-table">
          <thead><tr><th>Invoice</th><th>Order</th><th>Company</th><th>Status</th><th>Total</th><th>Due</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6}><Spinner /></td></tr>}
            {!loading && data?.invoices?.length === 0 && <tr><td colSpan={6}><EmptyState title="No invoices found" /></td></tr>}
            {!loading && data?.invoices?.map((inv: any) => (
              <tr key={inv.id} data-testid={`invoice-row-${inv.id}`} className="adm-tr-click" onClick={() => setSelId(inv.id)}>
                <td style={{ fontWeight: 700 }}>{inv.invoice_number}</td>
                <td>#{inv.order_number || "—"}</td>
                <td style={{ maxWidth: 220, fontSize: 13 }}>{inv.shipper_company || inv.shipper_email || "—"}</td>
                <td><StatusBadge status={inv.status} /></td>
                <td style={{ fontWeight: 700 }}>{money(inv.total_amount)}</td>
                <td style={{ color: "#94A3B8" }}>{fmtDate(inv.due_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
      <InvoiceDrawer inv={sel} onClose={() => setSelId(null)} onChanged={load} notify={notify} />
      {showSettings && <SettingsDrawer onClose={() => setShowSettings(false)} notify={notify} />}
    </div>
  );
}

function KpiCard({ label, value, tone, testId }: { label: string; value: string; tone?: string; testId?: string }) {
  return (
    <div className="adm-card" data-testid={testId} style={{ padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: tone || "#0F172A", marginTop: 6 }}>{value}</div>
    </div>
  );
}

function InvoiceDrawer({ inv, onClose, onChanged, notify }: { inv: any; onClose: () => void; onChanged: () => void; notify: Notify }) {
  const [busy, setBusy] = useState(false);
  const run = async (label: string, fn: () => Promise<any>) => {
    if (!inv || busy) return;
    setBusy(true);
    try { await fn(); notify(label); onChanged(); }
    catch (e: any) { notify(e.message, "err"); }
    finally { setBusy(false); }
  };
  const isPaid = inv?.status === "paid";
  return (
    <Drawer open={!!inv} title="Invoice details" onClose={onClose}>
      {!inv ? <Spinner /> : (<>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{inv.invoice_number}</div><StatusBadge status={inv.status} />
        </div>
        <div className="adm-card">
          <div className="adm-card-title">Billing</div>
          <InfoRow label="Company" value={inv.shipper_company || "—"} />
          <InfoRow label="Contact" value={inv.shipper_contact || "—"} />
          <InfoRow label="Email" value={inv.shipper_email || "—"} />
          <InfoRow label="Phone" value={inv.shipper_phone || "—"} />
          {inv.shipper_address ? <InfoRow label="Address" value={inv.shipper_address} /> : null}
        </div>
        <div className="adm-card">
          <div className="adm-card-title">Order</div>
          <InfoRow label="Order #" value={inv.order_number || "—"} />
          <InfoRow label="Pickup" value={inv.pickup_address || "—"} />
          <InfoRow label="Dropoff" value={inv.dropoff_address || "—"} />
          <InfoRow label="Description" value={inv.description || "—"} />
        </div>
        <div className="adm-card">
          <div className="adm-card-title">Amounts</div>
          <InfoRow label="Order value" value={money(inv.order_value)} />
          <InfoRow label="Invoice fee" value={money(inv.invoice_fee)} />
          <InfoRow label="Total" value={<strong>{money(inv.total_amount)}</strong>} />
          <InfoRow label="Issued" value={fmtDate(inv.issued_at)} />
          <InfoRow label="Due" value={fmtDate(inv.due_date)} />
          {inv.paid_at ? <InfoRow label="Paid" value={fmtDate(inv.paid_at)} /> : null}
          {inv.last_sent_at ? <InfoRow label="Last sent" value={fmtDate(inv.last_sent_at)} /> : null}
        </div>
        <div className="adm-card">
          <div className="adm-card-title">Actions</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <a className="adm-btn adm-btn-ghost adm-btn-sm" data-testid="invoice-download-pdf" href={adminApi.invoicePdfUrl(inv.id)} target="_blank" rel="noreferrer">Download PDF</a>
            {!isPaid && <button className="adm-btn adm-btn-ghost adm-btn-sm" data-testid="invoice-mark-paid" disabled={busy} onClick={() => run("Invoice marked paid", () => adminApi.markInvoicePaid(inv.id))}>Mark paid</button>}
            {!isPaid && inv.status !== "overdue" && <button className="adm-btn adm-btn-ghost adm-btn-sm" data-testid="invoice-mark-overdue" disabled={busy} onClick={() => run("Invoice marked overdue", () => adminApi.markInvoiceOverdue(inv.id))}>Mark overdue</button>}
            <button className="adm-btn adm-btn-ghost adm-btn-sm" data-testid="invoice-resend" disabled={busy} onClick={() => run("Invoice re-sent", () => adminApi.resendInvoice(inv.id))}>Resend</button>
          </div>
        </div>
      </>)}
    </Drawer>
  );
}

function SettingsDrawer({ onClose, notify }: { onClose: () => void; notify: Notify }) {
  const [fee, setFee] = useState("");
  const [netDays, setNetDays] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    adminApi.invoicingSettings().then((s) => { setFee(String(s.invoice_fee)); setNetDays(String(s.net_days)); }).catch((e) => notify(e.message, "err")).finally(() => setLoading(false));
  }, [notify]);
  const save = async () => {
    setBusy(true);
    try {
      await adminApi.updateInvoicingSettings({ invoice_fee: parseFloat(fee) || 0, net_days: parseInt(netDays) || 14 });
      notify("Invoicing settings saved"); onClose();
    } catch (e: any) { notify(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Drawer open title="Invoicing settings" onClose={onClose}>
      {loading ? <Spinner /> : (<>
        <div className="adm-card">
          <div className="adm-card-title">Admin fee &amp; terms</div>
          <div className="adm-field" style={{ marginBottom: 14 }}>
            <label>Invoice admin fee (€)</label>
            <input className="adm-input" data-testid="invoicing-fee-input" type="number" value={fee} onChange={(e) => setFee(e.target.value)} />
          </div>
          <div className="adm-field" style={{ marginBottom: 14 }}>
            <label>Payment terms (net days)</label>
            <input className="adm-input" data-testid="invoicing-netdays-input" type="number" value={netDays} onChange={(e) => setNetDays(e.target.value)} />
          </div>
          <button className="adm-btn adm-btn-primary" data-testid="invoicing-save" onClick={save} disabled={busy} style={{ width: "100%", justifyContent: "center" }}>{busy ? "Saving…" : "Save settings"}</button>
        </div>
      </>)}
    </Drawer>
  );
}
