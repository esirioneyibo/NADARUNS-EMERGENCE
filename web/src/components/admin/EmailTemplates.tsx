"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState } from "react";
import { Mail, Send, Eye } from "lucide-react";
import { adminApi } from "@/lib/adminApi";
import { Spinner, EmptyState } from "./ui";

type Notify = (msg: string, type?: "ok" | "err") => void;

export default function EmailTemplates({ notify }: { notify: Notify }) {
  const [meta, setMeta] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sending, setSending] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const d = await adminApi.emailTemplates();
      setMeta(d);
      setTemplates(d.templates || []);
      if (d.templates?.length && !selected) setSelected(d.templates[0].key);
    } catch (e: any) { notify(e.message, "err"); }
    finally { setLoading(false); }
  }, [notify, selected]);
  useEffect(() => { loadList(); }, [loadList]);

  const loadPreview = useCallback(async (key: string) => {
    setPreviewing(true);
    try { setPreview(await adminApi.emailTemplatePreview(key)); }
    catch (e: any) { notify(e.message, "err"); }
    finally { setPreviewing(false); }
  }, [notify]);
  useEffect(() => { if (selected) loadPreview(selected); }, [selected, loadPreview]);

  const sendTest = async () => {
    if (!selected) return;
    const email = testEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { notify("Enter a valid email address", "err"); return; }
    setSending(true);
    try {
      const r = await adminApi.emailTemplateTestSend(selected, email);
      notify(r.status === "dry_run" ? `Dry-run logged (no email actually sent)` : `Test email sent to ${email}`);
    } catch (e: any) { notify(e.message || "Send failed", "err"); }
    finally { setSending(false); }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      {meta && (
        <div className="adm-card" data-testid="email-meta" style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Mail size={18} color="#2563EB" />
            <span style={{ fontWeight: 800 }}>Provider:</span>
            <span style={{ textTransform: "capitalize" }}>{meta.provider}</span>
          </div>
          <div><span style={{ fontWeight: 800 }}>Sender:</span> {meta.sender || "—"}</div>
          <span style={{ background: meta.configured ? "#DCFCE7" : "#FEE2E2", color: meta.configured ? "#15803D" : "#B91C1C", padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 800 }}>
            {meta.configured ? "Configured" : "Not configured"}
          </span>
          {meta.dry_run && <span style={{ background: "#FEF3C7", color: "#B45309", padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 800 }}>DRY-RUN MODE</span>}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, alignItems: "start" }}>
        {/* Template list */}
        <div className="adm-card" style={{ padding: 8, maxHeight: 620, overflowY: "auto" }}>
          {templates.length === 0 && <EmptyState title="No templates" />}
          {templates.map((t) => (
            <button
              key={t.key}
              data-testid={`tpl-${t.key}`}
              onClick={() => setSelected(t.key)}
              style={{
                display: "block", width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                padding: "10px 12px", borderRadius: 10, marginBottom: 4,
                background: selected === t.key ? "#EFF6FF" : "transparent",
                color: selected === t.key ? "#1D4ED8" : "#0F172A",
                fontWeight: selected === t.key ? 800 : 600, fontSize: 14,
              }}
            >
              {t.label}
              <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, marginTop: 2 }}>{t.category}</div>
            </button>
          ))}
        </div>

        {/* Preview + test send */}
        <div>
          <div className="adm-card" style={{ marginBottom: 14 }}>
            <div className="adm-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><Eye size={16} /> Test send</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input
                className="adm-input"
                data-testid="test-email-input"
                style={{ flex: 1, minWidth: 220 }}
                type="email"
                placeholder="recipient@example.com"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
              <button className="adm-btn adm-btn-primary" data-testid="test-send-btn" disabled={sending || !selected} onClick={sendTest}>
                <Send size={15} /> {sending ? "Sending…" : "Send test"}
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 8 }}>
              Sends the selected template (with sample data) to the address above. Subject is prefixed with <b>[TEST]</b>.
            </div>
          </div>

          <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #E2E8F0", background: "#F8FAFC" }}>
              <div style={{ fontSize: 12, color: "#64748B", fontWeight: 700 }}>SUBJECT</div>
              <div data-testid="preview-subject" style={{ fontSize: 15, fontWeight: 800, color: "#0F172A", marginTop: 2 }}>
                {previewing ? "Loading…" : (preview?.subject || "—")}
              </div>
            </div>
            {previewing ? (
              <div style={{ padding: 40 }}><Spinner /></div>
            ) : preview?.html ? (
              <iframe
                title="email-preview"
                data-testid="preview-frame"
                srcDoc={preview.html}
                sandbox=""
                style={{ width: "100%", height: 520, border: "none", background: "#fff" }}
              />
            ) : (
              <div style={{ padding: 40 }}><EmptyState title="Select a template to preview" /></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
