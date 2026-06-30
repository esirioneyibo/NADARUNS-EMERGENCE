"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useState } from "react";
import { BadgeEuro, History, RotateCcw, Save, FlaskConical, Plus, Trash2 } from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import { Spinner } from "./ui";

// Helpers to edit percentages as human %, stored as decimals.
const toPct = (v: number) => Math.round((Number(v || 0)) * 1000) / 10;
const fromPct = (v: number) => Math.round((Number(v || 0)) * 10) / 1000;

function NumRow({ label, value, onChange, suffix, step = 1 }: any) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "6px 0" }}>
      <span style={{ color: "#475569", fontSize: 13.5 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input className="adm-input" type="number" step={step} value={value}
          style={{ width: 110, textAlign: "right" }}
          onChange={(e) => onChange(parseFloat(e.target.value))} />
        {suffix && <span style={{ color: "#94A3B8", fontSize: 13, width: 18 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function Card({ title, desc, children }: any) {
  return (
    <div className="adm-card">
      <div className="adm-card-title">{title}</div>
      {desc && <p style={{ color: "#64748B", fontSize: 12.5, marginTop: -6, marginBottom: 12 }}>{desc}</p>}
      {children}
    </div>
  );
}

export default function Pricing({ notify }: { notify: (m: string, t?: "ok" | "err") => void }) {
  const [data, setData] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [sample, setSample] = useState<any>({ vehicle_type: "box_truck", distance_km: 120, cargo_weight_kg: 3000, urgency: "express", empty_run_discount_pct: 0, supply_demand_pct: 0, route_match_discount_pct: 0 });

  const load = async () => {
    try {
      setErr("");
      const d = await adminApi.getPricing();
      setData(d);
      setCfg(JSON.parse(JSON.stringify(d.config)));
    } catch (e: any) { setErr(e.message || "Failed to load pricing"); }
  };
  useEffect(() => { load(); }, []);

  const vehicleTypes: string[] = useMemo(() => data?.vehicle_types || Object.keys(cfg?.base_fees || {}), [data, cfg]);

  const set = (path: string[], val: any) => {
    setCfg((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      let node = next;
      for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
      node[path[path.length - 1]] = val;
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await adminApi.savePricing(cfg, note || undefined);
      notify(`Saved pricing version ${r.version}`);
      setNote("");
      await load();
    } catch (e: any) { notify(e.message || "Save failed", "err"); }
    finally { setSaving(false); }
  };

  const rollback = async (version: number) => {
    try { await adminApi.activatePricing(version); notify(`Activated version ${version}`); await load(); }
    catch (e: any) { notify(e.message || "Rollback failed", "err"); }
  };

  const resetDefaults = async () => {
    try { const d = await adminApi.getPricingDefaults(); setCfg(JSON.parse(JSON.stringify(d.config))); notify("Loaded defaults (not yet saved)"); }
    catch (e: any) { notify(e.message || "Could not load defaults", "err"); }
  };

  const runPreview = async () => {
    try { const r = await adminApi.previewPricing(cfg, sample); setPreview(r.quote); }
    catch (e: any) { notify(e.message || "Preview failed", "err"); }
  };

  if (err) return <div className="adm-card" style={{ color: "#991B1B" }}>{err}</div>;
  if (!cfg) return <Spinner label="Loading pricing engine…" />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 18, alignItems: "start" }} data-testid="pricing-root">
      <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        {/* Header / save bar */}
        <div className="adm-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BadgeEuro size={20} color="#0F766E" />
            <div>
              <div style={{ fontWeight: 800 }}>Marketplace pricing engine</div>
              <div style={{ color: "#64748B", fontSize: 12.5 }}>Active version {data?.active_version}. Saving creates a new version — history is never overwritten.</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="adm-input" placeholder="Change note (e.g. 'Raise fuel to 9%')" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 240 }} data-testid="pricing-note" />
            <button className="adm-btn" onClick={resetDefaults} data-testid="pricing-defaults"><RotateCcw size={15} /> Defaults</button>
            <button className="adm-btn adm-btn-primary" disabled={saving} onClick={save} data-testid="pricing-save"><Save size={15} /> {saving ? "Saving…" : "Save new version"}</button>
          </div>
        </div>

        {/* Base fees */}
        <Card title="1 · Base booking fees (€)" desc="Per-vehicle minimum that covers dispatch, payments and platform operations.">
          {vehicleTypes.map((v) => (
            <NumRow key={v} label={v} step={1} suffix="€" value={cfg.base_fees?.[v] ?? 0} onChange={(n: number) => set(["base_fees", v], n)} />
          ))}
        </Card>

        {/* Distance rates */}
        <Card title="2 · Distance rates (€/km)" desc="The primary cost driver. Per-vehicle €/km.">
          {vehicleTypes.map((v) => (
            <NumRow key={v} label={v} step={0.05} suffix="€" value={cfg.km_rates?.[v] ?? 0} onChange={(n: number) => set(["km_rates", v], n)} />
          ))}
        </Card>

        {/* Weight bands */}
        <Card title="3 · Weight categories" desc="Chargeable freight weight (Finnish rahdituspaino) selects a band → small % adjustment. Weight no longer dominates.">
          {(cfg.weight_bands || []).map((b: any, i: number) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0" }}>
              <input className="adm-input" value={b.label} onChange={(e) => set(["weight_bands", String(i), "label"], e.target.value) as any} style={{ flex: 1 }} />
              <input className="adm-input" type="number" placeholder="max kg (blank = ∞)" value={b.max_kg ?? ""} style={{ width: 130 }}
                onChange={(e) => set(["weight_bands", String(i), "max_kg"], e.target.value === "" ? null : parseFloat(e.target.value)) as any} />
              <input className="adm-input" type="number" step={1} value={toPct(b.adjustment_pct)} style={{ width: 80, textAlign: "right" }}
                onChange={(e) => set(["weight_bands", String(i), "adjustment_pct"], fromPct(parseFloat(e.target.value))) as any} />
              <span style={{ color: "#94A3B8" }}>%</span>
            </div>
          ))}
        </Card>

        {/* Capacity bands */}
        <Card title="4 · Capacity utilisation" desc="Higher utilisation → slightly higher price (space scarce); low utilisation → cheaper to encourage matching.">
          {(cfg.capacity_bands || []).map((b: any, i: number) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0" }}>
              <input className="adm-input" value={b.label} onChange={(e) => set(["capacity_bands", String(i), "label"], e.target.value) as any} style={{ flex: 1 }} />
              <input className="adm-input" type="number" placeholder="max % (blank = ∞)" value={b.max_pct ?? ""} style={{ width: 130 }}
                onChange={(e) => set(["capacity_bands", String(i), "max_pct"], e.target.value === "" ? null : parseFloat(e.target.value)) as any} />
              <input className="adm-input" type="number" step={1} value={toPct(b.adjustment_pct)} style={{ width: 80, textAlign: "right" }}
                onChange={(e) => set(["capacity_bands", String(i), "adjustment_pct"], fromPct(parseFloat(e.target.value))) as any} />
              <span style={{ color: "#94A3B8" }}>%</span>
            </div>
          ))}
        </Card>

        {/* Marketplace intelligence */}
        <Card title="5–7 · Marketplace intelligence" desc="Empty-run, route-matching and supply/demand bounds. Resolved live per shipment; these set the limits.">
          <NumRow label="Empty-run discount" suffix="%" step={1} value={toPct(cfg.empty_run?.discount_pct)} onChange={(n: number) => set(["empty_run", "discount_pct"], fromPct(n))} />
          <NumRow label="Route-match max discount" suffix="%" step={1} value={toPct(cfg.route_match?.max_discount_pct)} onChange={(n: number) => set(["route_match", "max_discount_pct"], fromPct(n))} />
          <NumRow label="Supply/demand max surge" suffix="%" step={1} value={toPct(cfg.supply_demand?.max_surge_pct)} onChange={(n: number) => set(["supply_demand", "max_surge_pct"], fromPct(n))} />
          <NumRow label="Supply/demand max discount" suffix="%" step={1} value={toPct(cfg.supply_demand?.max_discount_pct)} onChange={(n: number) => set(["supply_demand", "max_discount_pct"], fromPct(n))} />
          <NumRow label="Supply/demand sensitivity" suffix="×" step={0.1} value={cfg.supply_demand?.sensitivity ?? 1} onChange={(n: number) => set(["supply_demand", "sensitivity"], n)} />
        </Card>

        {/* Urgency */}
        <Card title="10 · Urgency multipliers (×)">
          {Object.keys(cfg.urgency_multipliers || {}).map((k) => (
            <NumRow key={k} label={k} step={0.05} suffix="×" value={cfg.urgency_multipliers[k]} onChange={(n: number) => set(["urgency_multipliers", k], n)} />
          ))}
        </Card>

        {/* Special vehicle + handling */}
        <Card title="9 · Special vehicle & handling (%)">
          {Object.keys(cfg.special_vehicle_surcharge || {}).map((k) => (
            <NumRow key={k} label={`Vehicle · ${k}`} step={1} suffix="%" value={toPct(cfg.special_vehicle_surcharge[k])} onChange={(n: number) => set(["special_vehicle_surcharge", k], fromPct(n))} />
          ))}
          {Object.keys(cfg.special_handling_surcharge || {}).map((k) => (
            <NumRow key={k} label={`Handling · ${k}`} step={1} suffix="%" value={toPct(cfg.special_handling_surcharge[k])} onChange={(n: number) => set(["special_handling_surcharge", k], fromPct(n))} />
          ))}
        </Card>

        {/* Fuel + commission + savings + floor */}
        <Card title="8 · Fuel, commission & global">
          <NumRow label="Fuel adjustment" suffix="%" step={1} value={toPct(cfg.fuel_pct)} onChange={(n: number) => set(["fuel_pct"], fromPct(n))} />
          <NumRow label="Driver revenue share" suffix="%" step={1} value={toPct(cfg.commission?.driver_share)} onChange={(n: number) => { set(["commission", "driver_share"], fromPct(n)); set(["commission", "platform_share"], Math.round((1 - fromPct(n)) * 1000) / 1000); }} />
          <NumRow label="Platform commission" suffix="%" step={1} value={toPct(cfg.commission?.platform_share)} onChange={(n: number) => { set(["commission", "platform_share"], fromPct(n)); set(["commission", "driver_share"], Math.round((1 - fromPct(n)) * 1000) / 1000); }} />
          <NumRow label="Traditional-freight multiplier (for savings)" suffix="×" step={0.05} value={cfg.traditional_freight_multiplier} onChange={(n: number) => set(["traditional_freight_multiplier"], n)} />
          <NumRow label="Min price floor (base + €)" suffix="€" step={1} value={cfg.min_price_floor_add} onChange={(n: number) => set(["min_price_floor_add"], n)} />
        </Card>

        {/* Regional + seasonal */}
        <KeyPctEditor title="Regional adjustments (%)" desc="Per-region price nudge, e.g. pirkanmaa." obj={cfg.regional_adjustments || {}}
          onSet={(k: string, v: number) => set(["regional_adjustments", k], v)} onAdd={(k: string) => set(["regional_adjustments", k], 0)} onDel={(k: string) => { const o = { ...cfg.regional_adjustments }; delete o[k]; set(["regional_adjustments"], o); }} placeholder="region key (e.g. pirkanmaa)" />
        <KeyPctEditor title="Seasonal adjustments (%)" desc="Per-month (1-12) or season key." obj={cfg.seasonal_adjustments || {}}
          onSet={(k: string, v: number) => set(["seasonal_adjustments", k], v)} onAdd={(k: string) => set(["seasonal_adjustments", k], 0)} onDel={(k: string) => { const o = { ...cfg.seasonal_adjustments }; delete o[k]; set(["seasonal_adjustments"], o); }} placeholder="month (e.g. 12) or 'winter'" />
      </div>

      {/* Right rail: live preview + version history */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18, position: "sticky", top: 12 }}>
        <Card title={<span><FlaskConical size={15} /> Live preview</span>} desc="Test the current (unsaved) config against a sample shipment.">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <select className="adm-input" value={sample.vehicle_type} onChange={(e) => setSample({ ...sample, vehicle_type: e.target.value })}>
              {vehicleTypes.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <NumRow label="Distance (km)" step={5} value={sample.distance_km} onChange={(n: number) => setSample({ ...sample, distance_km: n })} />
            <NumRow label="Weight (kg)" step={100} value={sample.cargo_weight_kg} onChange={(n: number) => setSample({ ...sample, cargo_weight_kg: n })} />
            <select className="adm-input" value={sample.urgency} onChange={(e) => setSample({ ...sample, urgency: e.target.value })}>
              {Object.keys(cfg.urgency_multipliers || {}).map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <NumRow label="Empty-run disc." suffix="%" step={1} value={toPct(sample.empty_run_discount_pct)} onChange={(n: number) => setSample({ ...sample, empty_run_discount_pct: fromPct(n) })} />
            <NumRow label="Supply/demand" suffix="%" step={1} value={toPct(sample.supply_demand_pct)} onChange={(n: number) => setSample({ ...sample, supply_demand_pct: fromPct(n) })} />
            <button className="adm-btn adm-btn-primary" onClick={runPreview} data-testid="pricing-preview-run">Calculate price</button>
          </div>
          {preview && (
            <div style={{ marginTop: 12, borderTop: "1px solid #E2E8F0", paddingTop: 12 }} data-testid="pricing-preview-result">
              {preview.breakdown_lines.map((l: any, i: number) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "2px 0", fontWeight: l.type === "total" ? 800 : 500, color: l.type === "discount" ? "#15803D" : "#334155" }}>
                  <span>{l.label}{l.detail ? ` · ${l.detail}` : ""}</span>
                  <span>{l.amount >= 0 ? "+" : ""}€{l.amount.toFixed(2)}</span>
                </div>
              ))}
              <div style={{ marginTop: 8, padding: "8px 10px", background: "#ECFDF5", borderRadius: 8, fontSize: 13 }}>
                Traditional est. €{preview.traditional_estimate} → <b>save €{preview.savings} ({preview.savings_pct}%)</b>
              </div>
            </div>
          )}
        </Card>

        <Card title={<span><History size={15} /> Version history</span>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(data?.versions || []).map((v: any) => (
              <div key={v.version} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 8, background: v.active ? "#ECFDF5" : "#F8FAFC", border: v.active ? "1px solid #6EE7B7" : "1px solid #E2E8F0" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>v{v.version} {v.active && <span style={{ color: "#15803D" }}>· active</span>}</div>
                  <div style={{ color: "#64748B", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{v.note}</div>
                </div>
                {!v.active && <button className="adm-btn" onClick={() => rollback(v.version)} data-testid={`pricing-rollback-${v.version}`}>Roll back</button>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function KeyPctEditor({ title, desc, obj, onSet, onAdd, onDel, placeholder }: any) {
  const [newKey, setNewKey] = useState("");
  return (
    <Card title={title} desc={desc}>
      {Object.keys(obj).map((k) => (
        <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0" }}>
          <span style={{ flex: 1, color: "#475569", fontSize: 13.5 }}>{k}</span>
          <input className="adm-input" type="number" step={1} value={toPct(obj[k])} style={{ width: 90, textAlign: "right" }} onChange={(e) => onSet(k, fromPct(parseFloat(e.target.value)))} />
          <span style={{ color: "#94A3B8" }}>%</span>
          <button className="adm-btn" onClick={() => onDel(k)}><Trash2 size={14} /></button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input className="adm-input" placeholder={placeholder} value={newKey} onChange={(e) => setNewKey(e.target.value)} style={{ flex: 1 }} />
        <button className="adm-btn" onClick={() => { if (newKey.trim()) { onAdd(newKey.trim().toLowerCase()); setNewKey(""); } }}><Plus size={14} /> Add</button>
      </div>
    </Card>
  );
}
