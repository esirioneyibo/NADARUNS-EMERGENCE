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
  const [history, setHistory] = useState<any[]>([]);
  const [invoice, setInvoice] = useState<any>(null);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!id) return;
    try {
      const d = await adminApi.order(id);
      setDet(d);
      const h = await adminApi.assignmentHistory(id).catch(() => ({ history: [] }));
      setHistory(h.history || []);
      const ordNum = d?.order?.order_number;
      if (ordNum) {
        const r = await adminApi.invoices({ q: ordNum }).catch(() => ({ invoices: [] }));
        setInvoice((r.invoices || []).find((iv: any) => iv.order_id === id) || null);
      } else { setInvoice(null); }
    } catch (e: any) { notify(e.message, "err"); }
  };

  useEffect(() => {
    if (!id) { setDet(null); setHistory([]); setInvoice(null); return; }
    setDet(null); setReassignId(""); setNoteText(""); setInvoice(null);
    refresh();
    adminApi.drivers({ limit: 100 }).then((d) => setDrivers(d.items || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const run = async (label: string, fn: () => Promise<any>) => {
    if (!id || busy) return;
    setBusy(true);
    try { await fn(); notify(label); await refresh(); onChanged(); }
    catch (e: any) { notify(e.message, "err"); }
    finally { setBusy(false); }
  };

  const o = det?.order;
  const status = o?.status;
  const isFinal = ["delivered", "cancelled"].includes(status);
  const isActive = o && !isFinal;
  const canRestore = ["cancelled", "paused", "failed"].includes(status);
  const inv = invoice;

  const reassign = () => {
    if (!reassignId) return;
    run("Driver assigned", () => adminApi.assignOrder(id!, reassignId));
  };
  const addNote = () => {
    if (!noteText.trim()) return;
    run("Note added", async () => { await adminApi.addOrderNote(id!, noteText.trim()); setNoteText(""); });
  };

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
          <InfoRow label="Payment" value={(o.payment_status || "unpaid").replace(/_/g, " ")} />
          {o.fail_reason ? <InfoRow label="Fail reason" value={o.fail_reason} /> : null}
          <InfoRow label="Created" value={fmtDate(o.created_at)} />
        </div>
        <div className="adm-card">
          <div className="adm-card-title">Parties</div>
          <InfoRow label="Driver" value={det.driver ? det.driver.name : "Unassigned"} />
          <InfoRow label="Shipper" value={det.shipper ? det.shipper.company_name : "—"} />
        </div>

        {/* Lifecycle actions */}
        <div className="adm-card">
          <div className="adm-card-title">Order controls</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {isActive && status !== "paused" && (
              <button className="adm-btn adm-btn-ghost adm-btn-sm" data-testid="order-pause" disabled={busy} onClick={() => run("Order paused", () => adminApi.pauseOrder(id!))}>Pause</button>
            )}
            {canRestore && (
              <button className="adm-btn adm-btn-ghost adm-btn-sm" data-testid="order-restore" disabled={busy} onClick={() => run("Order restored to marketplace", () => adminApi.restoreOrder(id!))}>Restore</button>
            )}
            {isActive && (
              <button className="adm-btn adm-btn-ghost adm-btn-sm" data-testid="order-complete" disabled={busy} onClick={() => run("Order marked delivered", () => adminApi.completeOrder(id!))}>Mark delivered</button>
            )}
            {isActive && o.driver_id && (
              <button className="adm-btn adm-btn-ghost adm-btn-sm" data-testid="order-unassign" disabled={busy} onClick={() => run("Returned to marketplace", () => adminApi.unassignOrder(id!, "Driver emergency"))}>Unassign (emergency)</button>
            )}
            {isActive && (
              <button className="adm-btn adm-btn-danger adm-btn-sm" data-testid="order-fail" disabled={busy} onClick={() => run("Order marked failed", () => adminApi.failOrder(id!, "Marked failed by admin"))}>Mark failed</button>
            )}
            {isActive && (
              <button className="adm-btn adm-btn-danger adm-btn-sm" data-testid="order-cancel" disabled={busy} onClick={() => run("Order cancelled", () => adminApi.cancelOrder(id!))}>Cancel</button>
            )}
          </div>
        </div>

        {/* Assign / reassign */}
        {isActive && <div className="adm-card">
          <div className="adm-card-title">{o.driver_id ? "Reassign driver" : "Assign driver"}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <select className="adm-select" data-testid="order-reassign-select" style={{ flex: 1 }} value={reassignId} onChange={(e) => setReassignId(e.target.value)}>
              <option value="">Select driver…</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name} {d.is_suspended ? "(suspended)" : ""}</option>)}
            </select>
            <button className="adm-btn adm-btn-ghost" data-testid="order-reassign-btn" onClick={reassign} disabled={!reassignId || busy}>Assign</button>
          </div>
        </div>}

        {/* Invoice */}
        {inv && <div className="adm-card">
          <div className="adm-card-title">Invoice</div>
          <InfoRow label="Number" value={inv.invoice_number} />
          <InfoRow label="Status" value={<StatusBadge status={inv.status} />} />
          <InfoRow label="Total" value={money(inv.total_amount)} />
          <a className="adm-btn adm-btn-ghost adm-btn-sm" data-testid="order-invoice-pdf" href={adminApi.invoicePdfUrl(inv.id)} target="_blank" rel="noreferrer" style={{ marginTop: 8 }}>Download PDF</a>
        </div>}

        {/* Admin notes */}
        <div className="adm-card">
          <div className="adm-card-title">Admin notes</div>
          {(o.admin_notes || []).length === 0 && <div style={{ color: "#94A3B8", fontSize: 13, marginBottom: 8 }}>No notes yet.</div>}
          {(o.admin_notes || []).map((n: any, i: number) => (
            <div key={n.id || i} className="adm-row-info" style={{ alignItems: "flex-start" }}>
              <span style={{ flex: 1 }}>{n.note}</span>
              <span style={{ color: "#94A3B8", whiteSpace: "nowrap", marginLeft: 8 }}>{fmtDate(n.created_at)}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <input className="adm-input" data-testid="order-note-input" style={{ flex: 1 }} placeholder="Add an internal note…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            <button className="adm-btn adm-btn-ghost" data-testid="order-note-add" onClick={addNote} disabled={!noteText.trim() || busy}>Add</button>
          </div>
        </div>

        {/* Assignment history */}
        {history.length > 0 && <div className="adm-card">
          <div className="adm-card-title">Assignment history</div>
          {history.map((h, i) => (
            <div key={h.id || i} className="adm-row-info">
              <span style={{ textTransform: "capitalize" }}>{(h.action || "").replace(/_/g, " ")}{h.note ? ` · ${h.note}` : ""}</span>
              <span style={{ color: "#94A3B8" }}>{fmtDate(h.created_at)}</span>
            </div>
          ))}
        </div>}

        {det.events?.length > 0 && <div className="adm-card"><div className="adm-card-title">Timeline</div>
          {det.events.map((e: any, i: number) => (<div key={i} className="adm-row-info"><span style={{ textTransform: "capitalize" }}>{(e.event_type || e.type || e.status || "event").toString().replace(/_/g, " ")}</span><span>{fmtDate(e.created_at)}</span></div>))}
        </div>}
      </>)}
    </Drawer>
  );
}
