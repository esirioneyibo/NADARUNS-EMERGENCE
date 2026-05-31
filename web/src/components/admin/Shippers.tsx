"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import { Spinner, Badge, StatusBadge, Avatar, Drawer, Pager, money, fmtDate, Field, EmptyState } from "./ui";

type Notify = (msg: string, type?: "ok" | "err") => void;

export default function Shippers({ notify }: { notify: Notify }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<string | null>(null);
  const limit = 20;
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminApi.shippers({ search, status, page, limit })); }
    catch (e: any) { notify(e.message, "err"); } finally { setLoading(false); }
  }, [search, status, page, notify]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  return (
    <div>
      <div className="adm-toolbar">
        <div className="adm-search"><Search size={16} /><input className="adm-input" placeholder="Search company, contact, email…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} /></div>
        <select className="adm-select" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="all">All</option><option value="verified">Verified</option><option value="suspended">Suspended</option>
        </select>
      </div>
      <div className="adm-table-wrap"><div className="adm-table-scroll">
        <table className="adm-table">
          <thead><tr><th>Company</th><th>Contact</th><th>Orders</th><th>Status</th><th>Joined</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5}><Spinner /></td></tr>}
            {!loading && data?.items?.length === 0 && <tr><td colSpan={5}><EmptyState title="No shippers found" /></td></tr>}
            {!loading && data?.items?.map((s: any) => (
              <tr key={s.id} className="adm-tr-click" onClick={() => setSelId(s.id)}>
                <td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar src={s.avatar} name={s.company_name} size={36} /><div style={{ fontWeight: 700 }}>{s.company_name || "—"}</div></div></td>
                <td><div style={{ fontSize: 13 }}>{s.contact_name || "—"}</div><div style={{ fontSize: 12.5, color: "#94A3B8" }}>{s.email}</div></td>
                <td style={{ fontWeight: 700 }}>{s.total_orders}</td>
                <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{s.is_suspended ? <Badge tone="red">Suspended</Badge> : <Badge tone="green">Active</Badge>}{s.is_verified ? <Badge tone="blue">Verified</Badge> : null}</div></td>
                <td style={{ color: "#94A3B8" }}>{fmtDate(s.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>{data && <Pager page={page} total={data.total} limit={limit} onPage={setPage} />}</div>
      <ShipperDrawer id={selId} onClose={() => setSelId(null)} onChanged={load} notify={notify} />
    </div>
  );
}

function ShipperDrawer({ id, onClose, onChanged, notify }: { id: string | null; onClose: () => void; onChanged: () => void; notify: Notify }) {
  const [det, setDet] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!id) { setDet(null); return; }
    setDet(null);
    adminApi.shipper(id).then((d) => { setDet(d); const x = d.shipper; setForm({ company_name: x.company_name || "", contact_name: x.contact_name || "", email: x.email || "", phone: x.phone || "", address: x.address || "", tax_id: x.tax_id || "" }); }).catch((e) => notify(e.message, "err"));
  }, [id]);
  const save = async () => { if (!id) return; setSaving(true); try { await adminApi.updateShipper(id, form); notify("Shipper updated"); onChanged(); } catch (e: any) { notify(e.message, "err"); } finally { setSaving(false); } };
  const toggle = async () => { if (!id || !det) return; try { if (det.shipper.is_suspended) { await adminApi.activateShipper(id); notify("Shipper reactivated"); } else { await adminApi.suspendShipper(id); notify("Shipper suspended"); } setDet(await adminApi.shipper(id)); onChanged(); } catch (e: any) { notify(e.message, "err"); } };
  const verify = async () => { if (!id || !det) return; try { await adminApi.updateShipper(id, { is_verified: !det.shipper.is_verified }); notify("Updated"); setDet(await adminApi.shipper(id)); onChanged(); } catch (e: any) { notify(e.message, "err"); } };
  return (
    <Drawer open={!!id} title="Shipper details" onClose={onClose}>
      {!det ? <Spinner /> : (<>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Avatar src={det.shipper.avatar} name={det.shipper.company_name} size={56} />
          <div style={{ flex: 1 }}><div style={{ fontSize: 18, fontWeight: 800 }}>{det.shipper.company_name}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 5 }}>{det.shipper.is_suspended ? <Badge tone="red">Suspended</Badge> : <Badge tone="green">Active</Badge>}{det.shipper.is_verified ? <Badge tone="blue">Verified</Badge> : null}</div></div>
        </div>
        <div className="adm-card"><div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, textAlign: "center" }}>
          <div><div style={{ fontSize: 20, fontWeight: 800 }}>{det.stats.total_orders}</div><div style={{ fontSize: 12, color: "#94A3B8" }}>Orders</div></div>
          <div><div style={{ fontSize: 20, fontWeight: 800 }}>{det.stats.delivered}</div><div style={{ fontSize: 12, color: "#94A3B8" }}>Delivered</div></div>
          <div><div style={{ fontSize: 20, fontWeight: 800 }}>{money(det.stats.total_spend)}</div><div style={{ fontSize: 12, color: "#94A3B8" }}>Spend</div></div>
        </div></div>
        <div className="adm-card"><div className="adm-card-title">Edit company</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Company name" value={form.company_name} onChange={(v) => setForm({ ...form, company_name: v })} />
            <Field label="Contact name" value={form.contact_name} onChange={(v) => setForm({ ...form, contact_name: v })} />
            <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
            <Field label="Tax ID" value={form.tax_id} onChange={(v) => setForm({ ...form, tax_id: v })} />
            <div style={{ display: "flex", gap: 10 }}>
              <button className="adm-btn adm-btn-primary" onClick={save} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>{saving ? "Saving…" : "Save changes"}</button>
              <button className="adm-btn adm-btn-ghost" onClick={verify}>{det.shipper.is_verified ? "Unverify" : "Verify"}</button>
            </div>
          </div>
        </div>
        <div className="adm-card"><div className="adm-card-title">Recent orders</div>
          {(det.recent_orders || []).length === 0 ? <div style={{ color: "#94A3B8", fontSize: 14 }}>No orders yet</div> :
            (det.recent_orders || []).slice(0, 8).map((o: any) => (<div key={o.id} className="adm-row-info"><span><StatusBadge status={o.status} /> #{o.order_number || (o.id || "").slice(0, 6)}</span><span>{money(o.price_quote || o.earnings)} · {fmtDate(o.created_at)}</span></div>))}
        </div>
        <button className={`adm-btn ${det.shipper.is_suspended ? "adm-btn-success" : "adm-btn-danger"}`} onClick={toggle} style={{ justifyContent: "center" }}>{det.shipper.is_suspended ? "Reactivate shipper" : "Suspend shipper"}</button>
      </>)}
    </Drawer>
  );
}
