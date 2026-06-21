"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState } from "react";
import { Building2, Users, Car, Wallet, Check, X, BadgeEuro, ArrowLeft } from "lucide-react";
import { adminApi } from "@/lib/adminApi";

const euro = (n: any) => `€${Number(n || 0).toFixed(2)}`;

const STATUS_COLORS: Record<string, string> = {
  pending: "#D97706",
  approved: "#2563EB",
  paid: "#16A34A",
  rejected: "#DC2626",
  active: "#16A34A",
  suspended: "#DC2626",
};

function Pill({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || "#64748B";
  return (
    <span style={{ background: `${c}1A`, color: c, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, textTransform: "capitalize" }}>
      {status}
    </span>
  );
}

export default function FleetCompanies({ notify }: { notify: (m: string, t?: "ok" | "err") => void }) {
  const [tab, setTab] = useState<"companies" | "payouts">("companies");
  const [companies, setCompanies] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [payoutTotals, setPayoutTotals] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadCompanies = useCallback(async () => {
    try {
      const d = await adminApi.fleetCompanies(search ? { search } : {});
      setCompanies(d.items || []);
    } catch (e: any) {
      notify(e.message || "Failed to load companies", "err");
    } finally {
      setLoading(false);
    }
  }, [search, notify]);

  const loadPayouts = useCallback(async () => {
    try {
      const d = await adminApi.fleetPayouts(statusFilter ? { status: statusFilter } : {});
      setPayouts(d.payouts || []);
      setPayoutTotals(d.totals || null);
    } catch (e: any) {
      notify(e.message || "Failed to load payouts", "err");
    }
  }, [statusFilter, notify]);

  useEffect(() => {
    if (tab === "companies") loadCompanies();
    else loadPayouts();
  }, [tab, loadCompanies, loadPayouts]);

  const openDetail = async (id: string) => {
    try {
      const d = await adminApi.fleetCompany(id);
      setDetail(d);
    } catch (e: any) {
      notify(e.message || "Failed", "err");
    }
  };

  const toggleSuspend = async (c: any) => {
    try {
      if (c.status === "suspended") await adminApi.activateCompany(c.id);
      else await adminApi.suspendCompany(c.id);
      notify("Updated");
      await loadCompanies();
      if (detail?.company?.id === c.id) await openDetail(c.id);
    } catch (e: any) {
      notify(e.message || "Failed", "err");
    }
  };

  const act = async (id: string, action: "approve" | "pay" | "reject") => {
    try {
      if (action === "approve") await adminApi.approveCompanyPayout(id);
      else if (action === "pay") await adminApi.payCompanyPayout(id, "BANK-" + id.slice(0, 6).toUpperCase());
      else await adminApi.rejectCompanyPayout(id, "Rejected by admin");
      notify("Payout " + action + "d");
      await loadPayouts();
    } catch (e: any) {
      notify(e.message || "Failed", "err");
    }
  };

  // ----- Detail panel -----
  if (detail) {
    const c = detail.company;
    const w = detail.wallet || {};
    return (
      <div>
        <button className="adm-btn" data-testid="fleet-detail-back" onClick={() => setDetail(null)} style={{ marginBottom: 16 }}>
          <ArrowLeft size={16} /> Back to companies
        </button>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800 }}>{c.company_name}</h2>
            <div style={{ color: "#64748B", fontSize: 13 }}>
              Owner: {detail.drivers?.find((d: any) => d.company_role === "owner")?.name || "—"} · <Pill status={c.status} />
            </div>
          </div>
          <button
            className={`adm-btn ${c.status === "suspended" ? "adm-btn-primary" : ""}`}
            data-testid="fleet-toggle-suspend"
            onClick={() => toggleSuspend(c)}
          >
            {c.status === "suspended" ? "Reactivate company" : "Suspend company"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 20 }}>
          <Stat label="Available" value={euro(w.available_balance)} />
          <Stat label="Pending" value={euro(w.pending_balance)} />
          <Stat label="Total earned" value={euro(w.total_earnings)} />
          <Stat label="Withdrawn" value={euro(w.total_withdrawn)} />
          <Stat label="Completed jobs" value={detail.stats?.completed_jobs ?? 0} />
          <Stat label="Active jobs" value={detail.stats?.active_jobs ?? 0} />
        </div>

        <Section title={`Drivers (${detail.drivers?.length || 0})`} icon={<Users size={16} />}>
          <table className="adm-table" style={{ width: "100%" }}>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>
              {(detail.drivers || []).map((d: any) => (
                <tr key={d.id}>
                  <td>{d.name}</td><td>{d.email}</td><td style={{ textTransform: "capitalize" }}>{d.company_role}</td>
                  <td>{d.is_suspended ? <Pill status="suspended" /> : <Pill status="active" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={`Vehicles (${detail.vehicles?.length || 0})`} icon={<Car size={16} />}>
          <table className="adm-table" style={{ width: "100%" }}>
            <thead><tr><th>Registration</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>
              {(detail.vehicles || []).map((v: any) => (
                <tr key={v.id}>
                  <td>{v.registration_number}</td><td>{v.vehicle_type}</td>
                  <td>{v.status === "disabled" ? <Pill status="suspended" /> : <Pill status="active" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={`Payout requests (${detail.payouts?.length || 0})`} icon={<BadgeEuro size={16} />}>
          <table className="adm-table" style={{ width: "100%" }}>
            <thead><tr><th>Reference</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {(detail.payouts || []).map((p: any) => (
                <tr key={p.id}>
                  <td>{p.reference}</td><td>{euro(p.amount)}</td><td><Pill status={p.status} /></td>
                  <td>{new Date(p.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    );
  }

  // ----- List view -----
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <button className={`adm-btn ${tab === "companies" ? "adm-btn-primary" : ""}`} data-testid="fleet-tab-companies" onClick={() => setTab("companies")}>
          <Building2 size={16} /> Companies
        </button>
        <button className={`adm-btn ${tab === "payouts" ? "adm-btn-primary" : ""}`} data-testid="fleet-tab-payouts" onClick={() => setTab("payouts")}>
          <Wallet size={16} /> Payout requests
        </button>
      </div>

      {tab === "companies" ? (
        <>
          <div style={{ marginBottom: 14 }}>
            <input
              className="adm-input"
              data-testid="fleet-search"
              placeholder="Search company name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 320 }}
            />
          </div>
          {loading ? (
            <div style={{ color: "#64748B" }}>Loading…</div>
          ) : companies.length === 0 ? (
            <div style={{ color: "#64748B" }}>No fleet companies yet.</div>
          ) : (
            <table className="adm-table" style={{ width: "100%" }}>
              <thead>
                <tr><th>Company</th><th>Owner</th><th>Drivers</th><th>Vehicles</th><th>Available</th><th>Earned</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} data-testid={`fleet-company-${c.id}`}>
                    <td style={{ fontWeight: 700 }}>{c.company_name}</td>
                    <td>{c.owner_name || "—"}</td>
                    <td>{c.driver_count}</td>
                    <td>{c.vehicle_count}</td>
                    <td>{euro(c.available_balance)}</td>
                    <td>{euro(c.total_earnings)}</td>
                    <td><Pill status={c.status} /></td>
                    <td><button className="adm-btn" data-testid={`fleet-view-${c.id}`} onClick={() => openDetail(c.id)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
            <select className="adm-input" data-testid="fleet-payout-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
              <option value="rejected">Rejected</option>
            </select>
            {payoutTotals && (
              <span style={{ color: "#64748B", fontSize: 13 }}>
                Pending: {payoutTotals.pending} · Approved: {payoutTotals.approved} · Paid: {euro(payoutTotals.paid_amount)}
              </span>
            )}
          </div>
          {payouts.length === 0 ? (
            <div style={{ color: "#64748B" }}>No payout requests.</div>
          ) : (
            <table className="adm-table" style={{ width: "100%" }}>
              <thead>
                <tr><th>Reference</th><th>Company</th><th>Amount</th><th>Status</th><th>Date</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} data-testid={`payout-${p.id}`}>
                    <td>{p.reference}</td>
                    <td>{p.company_name || "—"}</td>
                    <td style={{ fontWeight: 700 }}>{euro(p.amount)}</td>
                    <td><Pill status={p.status} /></td>
                    <td>{new Date(p.created_at).toLocaleDateString()}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      {p.status === "pending" && (
                        <button className="adm-btn adm-btn-primary" data-testid={`payout-approve-${p.id}`} onClick={() => act(p.id, "approve")}><Check size={14} /> Approve</button>
                      )}
                      {(p.status === "approved" || p.status === "pending") && (
                        <button className="adm-btn" data-testid={`payout-pay-${p.id}`} onClick={() => act(p.id, "pay")}>Mark paid</button>
                      )}
                      {p.status !== "paid" && p.status !== "rejected" && (
                        <button className="adm-btn" data-testid={`payout-reject-${p.id}`} onClick={() => act(p.id, "reject")} style={{ color: "#DC2626" }}><X size={14} /> Reject</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#64748B", fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontWeight: 700, fontSize: 15 }}>
        {icon} {title}
      </div>
      {children}
    </div>
  );
}
