"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, AlertTriangle, Webhook } from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import { Spinner } from "./ui";

export default function Settings({ notify }: { notify: (m: string, t?: "ok" | "err") => void }) {
  const [status, setStatus] = useState<any>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const [testKey, setTestKey] = useState("");
  const [liveKey, setLiveKey] = useState("");
  const [webhook, setWebhook] = useState("");

  const load = async () => {
    try { setErr(""); setStatus(await adminApi.getStripeSettings()); }
    catch (e: any) { setErr(e.message || "Failed to load settings"); }
  };
  useEffect(() => { load(); }, []);

  const saveKeys = async () => {
    if (!testKey && !liveKey && !webhook) { notify("Nothing to save", "err"); return; }
    setSaving(true);
    try {
      const body: any = {};
      if (testKey.trim()) body.test_secret_key = testKey.trim();
      if (liveKey.trim()) body.live_secret_key = liveKey.trim();
      if (webhook.trim()) body.webhook_secret = webhook.trim();
      const s = await adminApi.updateStripeSettings(body);
      setStatus(s); setTestKey(""); setLiveKey(""); setWebhook("");
      notify("Stripe credentials saved");
    } catch (e: any) { notify(e.message || "Save failed", "err"); }
    finally { setSaving(false); }
  };

  const switchMode = async (mode: "test" | "live") => {
    if (status?.mode === mode) return;
    setSaving(true);
    try { const s = await adminApi.updateStripeSettings({ mode }); setStatus(s); notify(`Switched to ${mode.toUpperCase()} mode`); }
    catch (e: any) { notify(e.message || "Could not switch mode", "err"); }
    finally { setSaving(false); }
  };

  if (err) return <div className="adm-card" style={{ color: "#991B1B" }}>{err}</div>;
  if (!status) return <Spinner label="Loading settings…" />;

  const live = status.mode === "live";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 760 }} data-testid="settings-root">
      {/* Current status */}
      <div className="adm-card">
        <div className="adm-card-title">Stripe payment gateway</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 999, fontWeight: 800, fontSize: 13,
            background: live ? "#FEE2E2" : "#DCFCE7", color: live ? "#B91C1C" : "#15803D",
          }} data-testid="stripe-mode-badge">
            {live ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />} {live ? "LIVE MODE" : "TEST MODE"}
          </span>
          <span style={{ color: status.configured ? "#16A34A" : "#DC2626", fontWeight: 700, fontSize: 13 }}>
            {status.configured ? `Active key: ${status.active_key_masked}` : "No active key — payments disabled"}
          </span>
        </div>

        {/* Mode switch */}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            className={`adm-btn ${!live ? "adm-btn-primary" : ""}`}
            data-testid="mode-test-btn"
            disabled={saving || !status.test_configured}
            onClick={() => switchMode("test")}
          >Use Test mode</button>
          <button
            className={`adm-btn ${live ? "adm-btn-primary" : ""}`}
            data-testid="mode-live-btn"
            disabled={saving || !status.live_configured}
            onClick={() => switchMode("live")}
          >Use Live mode</button>
        </div>
        {!status.live_configured && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "#94A3B8" }}>
            Add a live secret key below to enable Live mode.
          </div>
        )}
      </div>

      {/* Key management */}
      <div className="adm-card">
        <div className="adm-card-title">API keys</div>
        <p style={{ color: "#64748B", fontSize: 13, marginTop: -6, marginBottom: 16 }}>
          Keys are stored securely and never displayed in full. Leave a field blank to keep the current value.
          Each key is verified with Stripe before saving.
        </p>

        <div className="adm-field" style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <KeyRound size={15} /> Test secret key {status.test_configured && <span style={{ color: "#16A34A", fontWeight: 700 }}>· set ({status.test_key_masked})</span>}
          </label>
          <input className="adm-input" data-testid="test-key-input" type="password" placeholder="sk_test_..." value={testKey} onChange={(e) => setTestKey(e.target.value)} autoComplete="off" />
        </div>

        <div className="adm-field" style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <KeyRound size={15} /> Live secret key {status.live_configured && <span style={{ color: "#16A34A", fontWeight: 700 }}>· set ({status.live_key_masked})</span>}
          </label>
          <input className="adm-input" data-testid="live-key-input" type="password" placeholder="sk_live_..." value={liveKey} onChange={(e) => setLiveKey(e.target.value)} autoComplete="off" />
        </div>

        <div className="adm-field" style={{ marginBottom: 18 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Webhook size={15} /> Webhook signing secret {status.webhook_configured && <span style={{ color: "#16A34A", fontWeight: 700 }}>· set</span>}
          </label>
          <input className="adm-input" data-testid="webhook-input" type="password" placeholder="whsec_..." value={webhook} onChange={(e) => setWebhook(e.target.value)} autoComplete="off" />
        </div>

        <button className="adm-btn adm-btn-primary" data-testid="save-keys-btn" disabled={saving} onClick={saveKeys}>
          {saving ? "Saving…" : "Save credentials"}
        </button>
      </div>
    </div>
  );
}
