"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState } from "react";
import { Search, Mail } from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import { Spinner, money, fmtDate, EmptyState } from "./ui";

type Notify = (msg: string, type?: "ok" | "err") => void;

const DOC_TYPES = [
  { key: "all", label: "All documents" },
  { key: "payment_receipt", label: "Payment receipts" },
  { key: "withdrawal_invoice", label: "Withdrawal invoices" },
  { key: "withdrawal_receipt", label: "Payout receipts" },
];

const DOC_LABEL: Record<string, string> = {
  payment_receipt: "Payment receipt",
  withdrawal_invoice: "Withdrawal invoice",
  withdrawal_receipt: "Payout receipt",
};

const DOC_TONE: Record<string, { bg: string; fg: string }> = {
  payment_receipt: { bg: "#DCFCE7", fg: "#15803D" },
  withdrawal_invoice: { bg: "#FEF3C7", fg: "#B45309" },
  withdrawal_receipt: { bg: "#DBEAFE", fg: "#1D4ED8" },
};

function TypeChip({ t }: { t: string }) {
  const m = DOC_TONE[t] || { bg: "#F1F5F9", fg: "#64748B" };
  return <span style={{ background: m.bg, color: m.fg, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800 }}>{DOC_LABEL[t] || t}</span>;
}

export default function Receipts({ notify }: { notify: Notify }) {
  const [tab, setTab] = useState<"docs" | "emails">("docs");
  return (
    <div>
      <div className="adm-toolbar" style={{ marginBottom: 16 }}>
        <button className={`adm-btn ${tab === "docs" ? "adm-btn-primary" : "adm-btn-ghost"}`} data-testid="receipts-tab-docs" onClick={() => setTab("docs")}>Receipts &amp; documents</button>
        <button className={`adm-btn ${tab === "emails" ? "adm-btn-primary" : "adm-btn-ghost"}`} data-testid="receipts-tab-emails" onClick={() => setTab("emails")}><Mail size={15} /> Email log</button>
      </div>
      {tab === "docs" ? <DocsTable notify={notify} /> : <EmailLog notify={notify} />}
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

function DocsTable({ notify }: { notify: Notify }) {
  const [search, setSearch] = useState("");
  const [docType, setDocType] = useState("all");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminApi.receipts({ q: search, doc_type: docType })); }
    catch (e: any) { notify(e.message, "err"); } finally { setLoading(false); }
  }, [search, docType, notify]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const resend = async (id: string) => {
    setBusy(id);
    try { await adminApi.resendReceipt(id); notify("Document re-sent"); await load(); }
    catch (e: any) { notify(e.message || "Resend failed", "err"); }
    finally { setBusy(null); }
  };

  const totals = data?.totals;
  return (
    <div>
      {totals && (
        <div className="adm-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
          <KpiCard label="Documents" value={String(totals.count)} testId="rcp-kpi-count" />
          <KpiCard label="Payment receipts" value={String(totals.payment_receipts)} tone="#15803D" testId="rcp-kpi-payment" />
          <KpiCard label="Payout receipts" value={String(totals.withdrawal_receipts)} tone="#1D4ED8" testId="rcp-kpi-payout" />
          <KpiCard label="Total value" value={money(totals.total_amount)} tone="#0F172A" testId="rcp-kpi-total" />
        </div>
      )}
      <div className="adm-toolbar">
        <div className="adm-search"><Search size={16} /><input className="adm-input" data-testid="receipts-search" placeholder="Search number, name, email…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="adm-select" data-testid="receipts-type-filter" value={docType} onChange={(e) => setDocType(e.target.value)}>
          {DOC_TYPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <div className="adm-table-wrap"><div className="adm-table-scroll">
        <table className="adm-table">
          <thead><tr><th>Number</th><th>Type</th><th>Recipient</th><th>Reference</th><th>Amount</th><th>Issued</th><th>Actions</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7}><Spinner /></td></tr>}
            {!loading && data?.receipts?.length === 0 && <tr><td colSpan={7}><EmptyState title="No documents yet" /></td></tr>}
            {!loading && data?.receipts?.map((r: any) => (
              <tr key={r.id} data-testid={`receipt-row-${r.id}`}>
                <td style={{ fontWeight: 700 }}>{r.receipt_number}</td>
                <td><TypeChip t={r.doc_type} /></td>
                <td style={{ maxWidth: 200, fontSize: 13 }}>{r.user_name || r.user_email || "—"}</td>
                <td style={{ fontSize: 12, color: "#64748B" }}>{r.order_number ? `#${r.order_number}` : (r.reference || "—")}</td>
                <td style={{ fontWeight: 700 }}>{money(r.amount)}</td>
                <td style={{ color: "#94A3B8" }}>{fmtDate(r.issued_at)}</td>
                <td>
                  <div style={{ display: "flex", gap: 8 }}>
                    <a className="adm-btn adm-btn-ghost adm-btn-sm" data-testid={`receipt-pdf-${r.id}`} href={adminApi.receiptPdfUrl(r.id)} target="_blank" rel="noreferrer">PDF</a>
                    <button className="adm-btn adm-btn-ghost adm-btn-sm" data-testid={`receipt-resend-${r.id}`} disabled={busy === r.id} onClick={() => resend(r.id)}>Resend</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </div>
  );
}

const EMAIL_STATUS: Record<string, { bg: string; fg: string }> = {
  sent: { bg: "#DCFCE7", fg: "#15803D" },
  failed: { bg: "#FEE2E2", fg: "#B91C1C" },
  dry_run: { bg: "#E2E8F0", fg: "#475569" },
  pending: { bg: "#FEF3C7", fg: "#B45309" },
};

function EmailStatus({ s }: { s: string }) {
  const m = EMAIL_STATUS[s] || { bg: "#F1F5F9", fg: "#64748B" };
  return <span style={{ background: m.bg, color: m.fg, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800 }}>{s}</span>;
}

function EmailLog({ notify }: { notify: Notify }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminApi.emailLogs({ q: search, status, limit: 200 })); }
    catch (e: any) { notify(e.message, "err"); } finally { setLoading(false); }
  }, [search, status, notify]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const totals = data?.totals;
  return (
    <div>
      {totals && (
        <div className="adm-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
          <KpiCard label="Emails" value={String(totals.count)} testId="eml-kpi-count" />
          <KpiCard label="Sent" value={String(totals.sent)} tone="#15803D" testId="eml-kpi-sent" />
          <KpiCard label="Failed" value={String(totals.failed)} tone="#DC2626" testId="eml-kpi-failed" />
          <KpiCard label="Dry-run" value={String(totals.dry_run)} tone="#475569" testId="eml-kpi-dry" />
        </div>
      )}
      <div className="adm-toolbar">
        <div className="adm-search"><Search size={16} /><input className="adm-input" data-testid="emaillog-search" placeholder="Search recipient or subject…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="adm-select" data-testid="emaillog-status-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
          {["all", "sent", "failed", "dry_run", "pending"].map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
        </select>
      </div>
      <div className="adm-table-wrap"><div className="adm-table-scroll">
        <table className="adm-table">
          <thead><tr><th>To</th><th>Subject</th><th>Category</th><th>Status</th><th>Sent</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5}><Spinner /></td></tr>}
            {!loading && data?.logs?.length === 0 && <tr><td colSpan={5}><EmptyState title="No emails sent yet" /></td></tr>}
            {!loading && data?.logs?.map((l: any) => (
              <tr key={l.id} data-testid={`email-row-${l.id}`}>
                <td style={{ fontSize: 13 }}>{l.to_email}</td>
                <td style={{ maxWidth: 280, fontSize: 13 }}>{l.subject}</td>
                <td style={{ fontSize: 12, color: "#64748B" }}>{l.category}</td>
                <td><EmailStatus s={l.status} /></td>
                <td style={{ color: "#94A3B8" }}>{fmtDate(l.sent_at || l.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </div>
  );
}
