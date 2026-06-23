"use client";

import { useState } from "react";
import { Mail, Phone, MapPin, Clock, Send, CheckCircle } from "lucide-react";
import { site } from "@/lib/site";
import { useContent } from "@/lib/i18n";

export default function ContactPage() {
  const c = useContent().contact;
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  const onChange = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    // Front-end confirmation (wire to your API/email service later).
    setTimeout(() => {
      setSending(false);
      setSubmitted(true);
      setForm({ name: "", email: "", subject: "", message: "" });
    }, 800);
  };

  const METHODS = [
    { icon: Mail, cls: "feature-icon-green", label: c.methodEmail, value: site.contact.email, href: `mailto:${site.contact.email}` },
    { icon: Phone, cls: "feature-icon-purple", label: c.methodCall, value: site.contact.phone, href: site.contact.phoneHref },
    { icon: MapPin, cls: "feature-icon-amber", label: c.methodVisit, value: `${site.contact.address.line1}, ${site.contact.address.line2}` },
  ];

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "14px 16px", borderRadius: 12, border: "1.5px solid #E5E7EB",
    fontSize: 15, color: "#111827", background: "#fff", outline: "none", fontFamily: "inherit",
  };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 8 };

  return (
    <div className="page">
      {/* Hero */}
      <section className="hero-gradient sec-sm" style={{ paddingTop: "clamp(56px,8vw,88px)", paddingBottom: "clamp(56px,8vw,88px)" }}>
        <div className="container center maxw-720 mx-auto">
          <div className="badge badge-green eyebrow-lg">{c.heroBadge}</div>
          <h1 className="display" style={{ marginBottom: 16 }}>
            {c.heroTitle1} <span className="gradient-text">{c.heroTitle2}</span>
          </h1>
          <p className="lead">{c.heroLead}</p>
        </div>
      </section>

      {/* Methods */}
      <section className="bg-white" style={{ padding: "clamp(40px,6vw,56px) 0 0" }}>
        <div className="container">
          <div className="grid-auto-3">
            {METHODS.map((m, i) => {
              const inner = (
                <>
                  <div className={`feature-icon ${m.cls}`}><m.icon size={26} /></div>
                  <div style={{ fontSize: 13, color: "#6B7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{m.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: "#111827", marginTop: 4, wordBreak: "break-word" }}>{m.value}</div>
                </>
              );
              return m.href ? (
                <a key={i} href={m.href} className="feature-card" style={{ textDecoration: "none", display: "block" }}>{inner}</a>
              ) : (
                <div key={i} className="feature-card">{inner}</div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Form + info */}
      <section className="sec bg-white" style={{ paddingTop: "clamp(40px,6vw,64px)" }}>
        <div className="container">
          <div className="split-form">
            {/* Form */}
            <div style={{ background: "#fff", borderRadius: 24, padding: "clamp(24px,3vw,36px)", border: "1px solid #F3F4F6", boxShadow: "0 10px 40px -12px rgba(0,0,0,0.1)" }}>
              {submitted ? (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                  <div className="feature-icon feature-icon-green" style={{ margin: "0 auto 16px" }}><CheckCircle size={30} /></div>
                  <h3 style={{ fontSize: 22, fontWeight: 800, color: "#111827", marginBottom: 8 }}>{c.sentTitle}</h3>
                  <p style={{ color: "#6B7280", lineHeight: 1.6, marginBottom: 24 }}>{c.sentDesc}</p>
                  <button onClick={() => setSubmitted(false)} className="btn-outline" style={{ cursor: "pointer" }}>{c.sendAnother}</button>
                </div>
              ) : (
                <form onSubmit={onSubmit}>
                  <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111827", marginBottom: 20 }}>{c.formTitle}</h2>
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>{c.labelName}</label>
                    <input style={inputStyle} value={form.name} onChange={(e) => onChange("name", e.target.value)} placeholder={c.phName} required />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>{c.labelEmail}</label>
                    <input style={inputStyle} type="email" value={form.email} onChange={(e) => onChange("email", e.target.value)} placeholder={c.phEmail} required />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>{c.labelSubject}</label>
                    <input style={inputStyle} value={form.subject} onChange={(e) => onChange("subject", e.target.value)} placeholder={c.phSubject} />
                  </div>
                  <div style={{ marginBottom: 24 }}>
                    <label style={labelStyle}>{c.labelMessage}</label>
                    <textarea style={{ ...inputStyle, minHeight: 130, resize: "vertical" }} value={form.message} onChange={(e) => onChange("message", e.target.value)} placeholder={c.phMessage} required />
                  </div>
                  <button type="submit" className="btn-primary" style={{ width: "100%", justifyContent: "center", cursor: "pointer", opacity: sending ? 0.7 : 1 }} disabled={sending}>
                    {sending ? c.sending : (<>{c.send} <Send size={17} /></>)}
                  </button>
                </form>
              )}
            </div>

            {/* Info + hours + map */}
            <div>
              <div className="tile-soft" style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <Clock size={20} color="#10B981" />
                  <h3 style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>{c.hoursTitle}</h3>
                </div>
                {site.contact.hours.map((h, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", color: "#374151", fontSize: 15 }}>
                    <span style={{ fontWeight: 600 }}>{h.days}</span><span style={{ color: "#6B7280" }}>{h.time}</span>
                  </div>
                ))}
              </div>
              <div style={{ borderRadius: 20, overflow: "hidden", height: 280, border: "1px solid #F3F4F6" }}>
                <iframe
                  title="NadaRuns office location"
                  src={`https://www.google.com/maps?q=${encodeURIComponent(`${site.contact.address.line1}, ${site.contact.address.line2}`)}&output=embed`}
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="sec bg-light">
        <div className="container">
          <div className="sec-head"><h2 className="h2">{c.faqHead}</h2></div>
          <div className="faq-list">
            {c.faqs.map((f, i) => (
              <details key={i} className="faq-item">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
