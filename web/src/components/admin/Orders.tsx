"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import { Spinner, StatusBadge, Drawer, Pager, money, fmtDate, InfoRow, EmptyState } from "./ui";

type Notify = (msg: string, type?: "ok" | "err") => void;
const STATUSES = ["all", "pending", "assigned", "accepted", "picked_up", "in_transit", "delivered", "cancelled", "rejected"];

export default function Orders({ notify }: { notify: Notify }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<string | null>(null);
  const limit = 20;
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminApi.orders({ search, status, page, limit })); }
    catch (e: any) { notify(e.message, "err"); } finally { setLoading(false); }
  }, [search, status, page, notify]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  return (
    <div>
      <div className="adm-toolbar">
        <div className="adm-search"><Search size={16} /><input className="adm-input" data-testid="orders-search" placeholder="Search order #, address…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} /></div>
        <select className="adm-select" data-testid="orders-status-filter" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      <div className="adm-table-wrap"><div className="adm-table-scroll">
        <table className="adm-table">
          <thead><tr><th>Order</th><th>Status</th><th>Route</th><th>Vehicle</th><th>Amount</th><th>When</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6}><Spinner /></td></tr>}
            {!loading && data?.items?.length === 0 && <tr><td colSpan={6}><EmptyState title="No orders found" /></td></tr>}
            {!loading && data?.items?.map((o: any) => (
              <tr key={o.id} data-testid={`order-row-${o.id}`} className="adm-tr-click" onClick={() => setSelId(o.id)}>
                <td style={{ fontWeight: 700 }}>#{o.order_number || (o.id || "").slice(0, 6)}</td>
                <td><StatusBadge status={o.status} /></td>
                <td style={{ maxWidth: 240, fontSize: 13 }}>{o.pickup || "—"} → {o.dropoff || "—"}</td>
                <td style={{ textTransform: "capitalize", fontSize: 13 }}>{(o.vehicle_type || "—").replace(/_/g, " ")}</td>
                <td style={{ fontWeight: 700 }}>{money(o.earnings || o.price_quote)}</td>
                <td style={{ color: "#94A3B8" }}>{fmtDate(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>{data && <Pager page={page} total={data.total} limit={limit} onPage={setPage} />}</div>
      <OrderDrawer id={selId} onClose={() => setSelId(null)} onChanged={load} notify={notify} />
    </div>
  );
}

function OrderDrawer({ id, onClose, onChanged, notify }: { id: string | null; onClose: () => void; onChanged: () => void; notify: Notify }) {
  const [det, setDet] = useState<any>(null);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [reassignId, setReassignId] = useState("");
  useEffect(() => {
    if (!id) { setDet(null); return; }
    setDet(null); setReassignId("");
    adminApi.order(id).then(setDet).catch((e) => notify(e.message, "err"));
    adminApi.drivers({ limit: 100 }).then((d) => setDrivers(d.items || [])).catch(() => {});
  }, [id]);
  const cancel = async () => { if (!id) return; try { await adminApi.cancelOrder(id); notify("Order cancelled"); setDet(await adminApi.order(id)); onChanged(); } catch (e: any) { notify(e.message, "err"); } };
  const reassign = async () => { if (!id || !reassignId) return; try { await adminApi.reassignOrder(id, reassignId); notify("Driver reassigned"); setDet(await adminApi.order(id)); onChanged(); } catch (e: any) { notify(e.message, "err"); } };
  const o = det?.order;
  const active = o && !["delivered", "cancelled"].includes(o.status);
  return (
    <Drawer open={!!id} title="Order details" onClose={onClose}>
      {!det || !o ? <Spinner /> : (<>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>#{o.order_number || (o.id || "").slice(0, 6)}</div><StatusBadge status={o.status} />
        </div>
        <div className="adm-card">
          <InfoRow label="Pickup" value={o.pickup?.address || "—"} />
          <InfoRow label="Dropoff" value={o.dropoff?.address || "—"} />
          <InfoRow label="Vehicle" value={(o.vehicle_type || "—").replace(/_/g, " ")} />
          <InfoRow label="Weight" value={o.cargo_weight_kg ? `${o.cargo_weight_kg} kg` : "—"} />
          <InfoRow label="Distance" value={o.distance_km ? `${o.distance_km} km` : "—"} />
          <InfoRow label="Price quote" value={money(o.price_quote)} />
          <InfoRow label="Tip / bonus" value={money(o.tip)} />
          <InfoRow label="Driver earnings" value={money(o.earnings)} />
          <InfoRow label="Created" value={fmtDate(o.created_at)} />
        </div>
        <div className="adm-card">
          <div className="adm-card-title">Parties</div>
          <InfoRow label="Driver" value={det.driver ? det.driver.name : "Unassigned"} />
          <InfoRow label="Shipper" value={det.shipper ? det.shipper.company_name : "—"} />
        </div>
        {det.events?.length > 0 && <div className="adm-card"><div className="adm-card-title">Timeline</div>
          {det.events.map((e: any, i: number) => (<div key={i} className="adm-row-info"><span style={{ textTransform: "capitalize" }}>{(e.event_type || e.type || e.status || "event").toString().replace(/_/g, " ")}</span><span>{fmtDate(e.created_at)}</span></div>))}
        </div>}
        {active && <div className="adm-card">
          <div className="adm-card-title">Reassign driver</div>
          <div style={{ display: "flex", gap: 10 }}>
            <select className="adm-select" data-testid="order-reassign-select" style={{ flex: 1 }} value={reassignId} onChange={(e) => setReassignId(e.target.value)}>
              <option value="">Select driver…</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name} {d.is_suspended ? "(suspended)" : ""}</option>)}
            </select>
            <button className="adm-btn adm-btn-ghost" data-testid="order-reassign-btn" onClick={reassign} disabled={!reassignId}>Assign</button>
          </div>
        </div>}
        {active && <button className="adm-btn adm-btn-danger" data-testid="order-cancel" onClick={cancel} style={{ justifyContent: "center" }}>Cancel order</button>}
      </>)}
    </Drawer>
  );
}
