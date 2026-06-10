"use client";
import React from "react";
import { X } from "lucide-react";

export function Badge({ tone = "gray", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`adm-badge adm-badge-${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<string, string> = {
  pending: "amber",
  assigned: "blue",
  accepted: "blue",
  picked_up: "purple",
  in_transit: "purple",
  delivered: "green",
  completed: "green",
  cancelled: "gray",
  rejected: "red",
  paused: "amber",
  failed: "red",
  unpaid: "amber",
  overdue: "red",
  paid: "green",
  invoiced: "blue",
  online: "green",
  offline: "gray",
  suspended: "red",
  approved: "green",
};

export function StatusBadge({ status }: { status?: string }) {
  const s = status || "unknown";
  return <Badge tone={STATUS_TONE[s] || "gray"}>{s.replace(/_/g, " ")}</Badge>;
}

export function Avatar({ src, name, size = 40 }: { src?: string; name?: string; size?: number }) {
  const initials = (name || "?")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="adm-avatar" src={src} alt={name || ""} style={{ width: size, height: size }} />;
  }
  return (
    <div className="adm-avatar" style={{ width: size, height: size }}>
      {initials}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div style={{ padding: 50, textAlign: "center", color: "#94A3B8" }}>
      <div className="adm-spin" />
      <div style={{ marginTop: 12, fontSize: 14 }}>{label || "Loading\u2026"}</div>
    </div>
  );
}

export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ padding: 50, textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#334155" }}>{title}</div>
      {sub && <div style={{ fontSize: 14, color: "#94A3B8", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="adm-overlay" onClick={onClose}>
      <div className="adm-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="adm-drawer-head">
          <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
          <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={onClose} style={{ padding: 8 }}>
            <X size={18} />
          </button>
        </div>
        <div className="adm-drawer-body">{children}</div>
      </div>
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="adm-row-info">
      <span>{label}</span>
      <span>{value ?? "\u2014"}</span>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="adm-field">
      <label>{label}</label>
      <input className="adm-input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function money(n?: number): string {
  return "\u20ac" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(s?: string): string {
  if (!s) return "\u2014";
  try {
    return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return s;
  }
}

export function Pager({
  page,
  total,
  limit,
  onPage,
}: {
  page: number;
  total: number;
  limit: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="adm-pager">
      <span>
        {total === 0 ? "0" : (page - 1) * limit + 1}{"\u2013"}{Math.min(page * limit, total)} of {total}
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="adm-btn adm-btn-ghost adm-btn-sm" data-testid="pager-prev" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </button>
        <span style={{ alignSelf: "center" }}>
          {page} / {pages}
        </span>
        <button className="adm-btn adm-btn-ghost adm-btn-sm" data-testid="pager-next" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
