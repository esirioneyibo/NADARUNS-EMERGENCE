"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from "react";
import { Truck, Users, Package, Wallet, Clock, CheckCircle2, XCircle, ShieldAlert } from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import { LineAreaChart, HBars, Donut } from "./charts";
import { Spinner, StatusBadge, money, fmtDate, Avatar } from "./ui";

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B", assigned: "#3B82F6", accepted: "#3B82F6", picked_up: "#8B5CF6",
  in_transit: "#8B5CF6", delivered: "#10B981", cancelled: "#94A3B8", rejected: "#EF4444",
};

export default function Overview() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    adminApi.overview().then(setData).catch((e) => setErr(e.message));
  }, []);
  if (err) return <div className="adm-card" style={{ color: "#991B1B" }}>{err}</div>;
  if (!data) return <Spinner label="Loading dashboard…" />;
  const k = data.kpis;
  const series = data.series || [];
  const kpis = [
    { label: "Total drivers", value: k.total_drivers, icon: Truck, bg: "#DCFCE7", fg: "#16A34A", sub: `${k.active_drivers} online` },
    { label: "Total shippers", value: k.total_shippers, icon: Users, bg: "#EDE9FE", fg: "#7C3AED", sub: `${k.suspended_shippers} suspended` },
    { label: "Total orders", value: k.total_orders, icon: Package, bg: "#DBEAFE", fg: "#2563EB", sub: `${k.in_progress_orders} in progress` },
    { label: "Revenue", value: money(k.total_revenue), icon: Wallet, bg: "#FEF3C7", fg: "#D97706", sub: `${money(k.total_tips)} tips` },
    { label: "Pending", value: k.pending_orders, icon: Clock, bg: "#FEF3C7", fg: "#D97706" },
    { label: "Delivered", value: k.delivered_orders, icon: CheckCircle2, bg: "#DCFCE7", fg: "#16A34A" },
    { label: "Cancelled", value: k.cancelled_orders, icon: XCircle, bg: "#F1F5F9", fg: "#64748B" },
    { label: "Pending KYC", value: k.pending_kyc, icon: ShieldAlert, bg: "#FEE2E2", fg: "#DC2626" },
  ];
  const statusDonut = Object.entries(data.orders_by_status || {}).map(([label, value]) => ({
    label, value: value as number, color: STATUS_COLORS[label] || "#94A3B8",
  }));
  const vehicleBars = (data.orders_by_vehicle || []).map((v: any) => ({ label: v.vehicle_type, value: v.count }));
  const fmtDay = (d: string) => { try { return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return d; } };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
          <div className="adm-card-title">Deliveries — last 14 days</div>
          <LineAreaChart data={series.map((s: any) => ({ label: fmtDay(s.date), value: s.deliveries }))} color="#10B981" />
        </div>
        <div className="adm-card">
          <div className="adm-card-title">Orders by status</div>
          <Donut data={statusDonut} />
        </div>
      </div>

      <div className="adm-grid-2">
        <div className="adm-card">
          <div className="adm-card-title">Revenue — last 14 days</div>
          <LineAreaChart data={series.map((s: any) => ({ label: fmtDay(s.date), value: s.revenue }))} color="#6366F1" valuePrefix="€" />
        </div>
        <div className="adm-card">
          <div className="adm-card-title">Orders by vehicle type</div>
          <HBars data={vehicleBars} />
        </div>
      </div>

      <div className="adm-grid-2">
        <div className="adm-card">
          <div className="adm-card-title">Recent orders</div>
          <div className="adm-table-scroll">
            <table className="adm-table">
              <thead><tr><th>Order</th><th>Status</th><th>Route</th><th>Amount</th><th>When</th></tr></thead>
              <tbody>
                {(data.recent_orders || []).map((o: any) => (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 700 }}>#{o.order_number || (o.id || "").slice(0, 6)}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td style={{ maxWidth: 220, fontSize: 13 }}>{o.pickup || "—"} → {o.dropoff || "—"}</td>
                    <td style={{ fontWeight: 700 }}>{money(o.earnings || o.price_quote)}</td>
                    <td style={{ color: "#94A3B8" }}>{fmtDate(o.created_at)}</td>
                  </tr>
                ))}
                {(data.recent_orders || []).length === 0 && <tr><td colSpan={5} style={{ color: "#94A3B8" }}>No orders yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="adm-card">
          <div className="adm-card-title">Top drivers</div>
          {(data.top_drivers || []).length === 0 && <div style={{ color: "#94A3B8", fontSize: 14 }}>No deliveries yet</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {(data.top_drivers || []).map((d: any, i: number) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Avatar src={d.avatar} name={d.name} size={38} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{d.name}</div>
                  <div style={{ fontSize: 12.5, color: "#94A3B8" }}>{d.deliveries} deliveries</div>
                </div>
                <div style={{ fontWeight: 800, color: "#16A34A" }}>{money(d.earnings)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
