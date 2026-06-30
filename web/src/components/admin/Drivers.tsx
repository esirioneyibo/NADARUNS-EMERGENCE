"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import { Spinner, Badge, StatusBadge, Avatar, Drawer, Pager, money, fmtDate, Field, EmptyState } from "./ui";

type Notify = (msg: string, type?: "ok" | "err") => void;

export default function Drivers({ notify }: { notify: Notify }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<string | null>(null);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminApi.drivers({ search, status, page, limit })); }
    catch (e: any) { notify(e.message, "err"); }
    finally { setLoading(false); }
  }, [search, status, page, notify]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <div className="adm-toolbar">
        <div className="adm-search"><Search size={16} /><input className="adm-input" data-testid="drivers-search" placeholder="Search name, email, phone, plate…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} /></div>
        <select className="adm-select" data-testid="drivers-status-filter" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="all">All statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      <div className="adm-table-wrap">
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead><tr><th>Driver</th><th>Contact</th><th>Vehicle</th><th>Status</th><th>Rating</th><th>Today</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6}><Spinner /></td></tr>}
              {!loading && data?.items?.length === 0 && <tr><td colSpan={6}><EmptyState title="No drivers found" /></td></tr>}
              {!loading && data?.items?.map((d: any) => (
                <tr key={d.id} data-testid={`driver-row-${d.id}`} className="adm-tr-click" onClick={() => setSelId(d.id)}>
                  <td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar src={d.avatar} name={d.name} size={36} /><div><div style={{ fontWeight: 700 }}>{d.name || "Unnamed"}</div><div style={{ fontSize: 12, color: "#94A3B8" }}>{d.vehicles_count} vehicle(s)</div></div></div></td>
                  <td><div style={{ fontSize: 13 }}>{d.email}</div><div style={{ fontSize: 12.5, color: "#94A3B8" }}>{d.phone || "—"}</div></td>
                  <td style={{ textTransform: "capitalize" }}>{(d.vehicle_type || "—").replace(/_/g, " ")}</td>
                  <td>{d.is_suspended ? <Badge tone="red">Suspended</Badge> : <Badge tone={d.is_online ? "green" : "gray"}>{d.is_online ? "Online" : "Offline"}</Badge>}</td>
                  <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{(d.rating ?? 0).toFixed(1)} ★</td>
                  <td><div style={{ fontWeight: 700 }}>{money(d.earnings_today)}</div><div style={{ fontSize: 12, color: "#94A3B8" }}>{d.deliveries_today} trips</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && <Pager page={page} total={data.total} limit={limit} onPage={setPage} />}
      </div>
      <DriverDrawer id={selId} onClose={() => setSelId(null)} onChanged={load} notify={notify} />
    </div>
  );
}

function DriverDrawer({ id, onClose, onChanged, notify }: { id: string | null; onClose: () => void; onChanged: () => void; notify: Notify }) {
  const [det, setDet] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!id) { setDet(null); return; }
    setDet(null);
    adminApi.driver(id).then((d) => { setDet(d); const x = d.driver; setForm({ name: x.name || "", email: x.email || "", phone: x.phone || "", vehicle_type: x.vehicle_type || "", plate: x.plate || "" }); }).catch((e) => notify(e.message, "err"));
  }, [id]);
  const save = async () => { if (!id) return; setSaving(true); try { await adminApi.updateDriver(id, form); notify("Driver updated"); onChanged(); } catch (e: any) { notify(e.message, "err"); } finally { setSaving(false); } };
  const toggle = async () => { if (!id || !det) return; try { if (det.driver.is_suspended) { await adminApi.activateDriver(id); notify("Driver reactivated"); } else { await adminApi.suspendDriver(id); notify("Driver suspended"); } setDet(await adminApi.driver(id)); onChanged(); } catch (e: any) { notify(e.message, "err"); } };
  return (
    <Drawer open={!!id} title="Driver details" onClose={onClose}>
      {!det ? <Spinner /> : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar src={det.driver.avatar} name={det.driver.name} size={56} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{det.driver.name}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
                {det.driver.is_suspended ? <Badge tone="red">Suspended</Badge> : <Badge tone={det.driver.is_online ? "green" : "gray"}>{det.driver.is_online ? "Online" : "Offline"}</Badge>}
                <Badge tone="amber">{(det.driver.rating ?? 0).toFixed(1)} ★</Badge>
              </div>
            </div>
          </div>
          <div className="adm-card">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, textAlign: "center" }}>
              <div><div style={{ fontSize: 20, fontWeight: 800 }}>{det.stats.delivered}</div><div style={{ fontSize: 12, color: "#94A3B8" }}>Delivered</div></div>
              <div><div style={{ fontSize: 20, fontWeight: 800 }}>{det.stats.total_assigned}</div><div style={{ fontSize: 12, color: "#94A3B8" }}>Assigned</div></div>
              <div><div style={{ fontSize: 20, fontWeight: 800 }}>{money(det.stats.lifetime_earnings)}</div><div style={{ fontSize: 12, color: "#94A3B8" }}>Lifetime</div></div>
            </div>
          </div>
          <div className="adm-card">
            <div className="adm-card-title">Edit profile</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
              <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              <Field label="Vehicle type" value={form.vehicle_type} onChange={(v) => setForm({ ...form, vehicle_type: v })} />
              <Field label="Plate" value={form.plate} onChange={(v) => setForm({ ...form, plate: v })} />
              <button className="adm-btn adm-btn-primary" data-testid="driver-save" onClick={save} disabled={saving} style={{ justifyContent: "center" }}>{saving ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
          <div className="adm-card">
            <div className="adm-card-title">Vehicles ({det.vehicles?.length || 0})</div>
            {(!det.vehicles || det.vehicles.length === 0) ? <div style={{ color: "#94A3B8", fontSize: 14 }}>No garage entries. Primary: {(det.driver.vehicle_type || "—").replace(/_/g, " ")}</div> :
              det.vehicles.map((v: any, i: number) => (
                <div key={i} className="adm-row-info"><span style={{ textTransform: "capitalize" }}>{(v.vehicle_type || "").replace(/_/g, " ")} {v.is_primary ? "· primary" : ""}</span><span>{v.plate || v.label || "—"} · {v.capacity_kg || 0} kg</span></div>
              ))}
          </div>
          <div className="adm-card">
            <div className="adm-card-title">Recent orders</div>
            {(det.recent_orders || []).length === 0 ? <div style={{ color: "#94A3B8", fontSize: 14 }}>No orders yet</div> :
              (det.recent_orders || []).slice(0, 8).map((o: any) => (
                <div key={o.id} className="adm-row-info"><span><StatusBadge status={o.status} /> #{o.order_number || (o.id || "").slice(0, 6)}</span><span>{money(o.earnings)} · {fmtDate(o.created_at)}</span></div>
              ))}
          </div>
          <button data-testid="driver-suspend-toggle" className={`adm-btn ${det.driver.is_suspended ? "adm-btn-success" : "adm-btn-danger"}`} onClick={toggle} style={{ justifyContent: "center" }}>{det.driver.is_suspended ? "Reactivate driver" : "Suspend driver"}</button>
          <button data-testid="driver-delete" className="adm-btn adm-btn-danger" style={{ justifyContent: "center", marginTop: 8 }} onClick={async () => { if (!id || !window.confirm("Permanently delete this driver? This cannot be undone.")) return; try { await adminApi.deleteDriver(id); notify("Driver deleted"); onClose(); onChanged(); } catch (e: any) { notify(e.message, "err"); } }}>Delete driver</button>
        </>
      )}
    </Drawer>
  );
}
