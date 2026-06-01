"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import { Spinner } from "./ui";

let leafletPromise: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if ((window as any).L) return Promise.resolve((window as any).L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.async = true;
    s.onload = () => resolve((window as any).L);
    s.onerror = () => reject(new Error("leaflet load failed"));
    document.body.appendChild(s);
  });
  return leafletPromise;
}

export default function DispatchMap() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);

  const fetchData = useCallback(async () => {
    try { setErr(""); setData(await adminApi.dispatchMap()); }
    catch (e: any) { setErr(e.message || "Failed to load dispatch data"); }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 15000);
    return () => clearInterval(t);
  }, [fetchData]);

  const renderMarkers = useCallback(() => {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current;
    if (!L || !map || !layer || !data) return;
    layer.clearLayers();
    const bounds: [number, number][] = [];
    const add = (lat: number, lng: number, color: string, popup: string) => {
      if (lat == null || lng == null) return;
      L.circleMarker([lat, lng], { radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 })
        .bindPopup(popup).addTo(layer);
      bounds.push([lat, lng]);
    };
    (data.jobs || []).forEach((j: any) => {
      const open = j.status === "open";
      add(j.lat, j.lng, open ? "#16A34A" : "#2563EB",
        `<b>#${j.order_number}</b><br/>${open ? "🟢 OPEN" : "🔵 IN TRANSIT"}<br/>📦 ${j.package || "Package"}<br/>📍 ${j.pickup_name || ""} → ${j.dropoff_name || ""}<br/>💶 €${Number(j.earnings || 0).toFixed(2)}`);
    });
    (data.drivers || []).forEach((d: any) => {
      add(d.lat, d.lng, "#7C3AED", `<b>🚗 ${d.name || "Driver"}</b><br/>${(d.vehicle_type || "").replace(/_/g, " ")}`);
    });
    if (bounds.length) {
      try { map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 }); } catch { /* noop */ }
    }
  }, [data]);

  // init map once
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !mapEl.current || mapRef.current) return;
      LRef.current = L;
      mapRef.current = L.map(mapEl.current).setView([60.1699, 24.9384], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors", maxZoom: 19,
      }).addTo(mapRef.current);
      layerRef.current = L.layerGroup().addTo(mapRef.current);
      renderMarkers();
    }).catch(() => setErr("Could not load the map library (check your internet connection)."));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { renderMarkers(); }, [renderMarkers]);

  const s = data?.summary || {};
  const alerts = data?.alerts || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="dispatch-root">
      {/* Summary + refresh */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Pill color="#16A34A" bg="#DCFCE7" label="Open jobs" value={s.open ?? "—"} />
        <Pill color="#2563EB" bg="#DBEAFE" label="In transit" value={s.in_transit ?? "—"} />
        <Pill color="#7C3AED" bg="#EDE9FE" label="Drivers online" value={s.online_drivers ?? "—"} />
        <button className="adm-btn" onClick={fetchData} style={{ marginLeft: "auto" }} data-testid="dispatch-refresh">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {alerts.map((a: any, i: number) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 12,
          background: a.severity === "high" ? "#FEE2E2" : "#FEF3C7",
          color: a.severity === "high" ? "#991B1B" : "#92400E", fontWeight: 700, fontSize: 14,
        }} data-testid="dispatch-alert">
          <AlertTriangle size={18} /> {a.message}
        </div>
      ))}

      {err && <div className="adm-card" style={{ color: "#991B1B" }}>{err}</div>}
      {!data && !err && <Spinner label="Loading dispatch map…" />}

      {/* Map */}
      <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
        <div ref={mapEl} data-testid="dispatch-map" style={{ height: 520, width: "100%", background: "#E5E7EB" }} />
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13, color: "#64748B" }}>
        <Legend color="#16A34A" label="Open job (pickup)" />
        <Legend color="#2563EB" label="In transit (live position)" />
        <Legend color="#7C3AED" label="Online driver" />
      </div>
    </div>
  );
}

function Pill({ color, bg, label, value }: { color: string; bg: string; label: string; value: any }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, background: bg, color, padding: "8px 16px", borderRadius: 999, fontWeight: 800 }}>
      <span style={{ fontSize: 20 }}>{value}</span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 14, height: 14, borderRadius: 999, background: color, border: "2px solid #fff", boxShadow: "0 0 0 1px #cbd5e1" }} />
      {label}
    </span>
  );
}
