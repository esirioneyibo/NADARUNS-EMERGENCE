"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import { Spinner, Badge, EmptyState } from "./ui";

const TYPES = ["all", "bike", "car", "cargo_van", "box_truck", "flatbed", "refrigerated", "semi_truck", "crane_truck", "tanker", "tow_truck"];

export default function Vehicles() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let act = true; setLoading(true);
    const t = setTimeout(() => {
      adminApi.vehicles({ search, vehicle_type: type }).then((d) => { if (act) { setData(d); setLoading(false); } }).catch(() => { if (act) setLoading(false); });
    }, 250);
    return () => { act = false; clearTimeout(t); };
  }, [search, type]);
  return (
    <div>
      <div className="adm-toolbar">
        <div className="adm-search"><Search size={16} /><input className="adm-input" data-testid="vehicles-search" placeholder="Search plate, label, driver…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="adm-select" data-testid="vehicles-type-filter" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t === "all" ? "All types" : t.replace(/_/g, " ")}</option>)}
        </select>
        {data && <span style={{ marginLeft: "auto", color: "#64748B", fontSize: 13, fontWeight: 600 }}>{data.total} vehicles</span>}
      </div>
      <div className="adm-table-wrap"><div className="adm-table-scroll">
        <table className="adm-table">
          <thead><tr><th>Type</th><th>Plate / label</th><th>Capacity</th><th>Owner</th><th>Flags</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5}><Spinner /></td></tr>}
            {!loading && (!data || data.items.length === 0) && <tr><td colSpan={5}><EmptyState title="No vehicles found" /></td></tr>}
            {!loading && data?.items?.map((v: any, i: number) => (
              <tr key={i}>
                <td style={{ textTransform: "capitalize", fontWeight: 700 }}>{(v.vehicle_type || "—").replace(/_/g, " ")}</td>
                <td>{v.plate || v.label || "—"}</td>
                <td>{v.capacity_kg ? `${v.capacity_kg} kg` : "—"}</td>
                <td>{v.driver_name || "—"}</td>
                <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{v.is_primary ? <Badge tone="green">Primary</Badge> : null}{v.driver_suspended ? <Badge tone="red">Owner suspended</Badge> : null}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </div>
  );
}
