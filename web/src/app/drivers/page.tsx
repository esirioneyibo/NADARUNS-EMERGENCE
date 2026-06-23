"use client";

import AppBadges from "@/components/AppBadges";
import { Clock, Banknote, Truck, Navigation, Bell, Headphones, CheckCircle } from "lucide-react";
import { useContent } from "@/lib/i18n";

const BENEFIT_ICONS = [Clock, Banknote, Truck, Navigation, Bell, Headphones];
const BENEFIT_CLS = ["feature-icon-green", "feature-icon-amber", "feature-icon-purple", "feature-icon-green", "feature-icon-rose", "feature-icon-purple"];

export default function DriversPage() {
  const c = useContent().drivers;
  return (
    <div className="page">
      {/* Hero */}
      <section className="hero-gradient sec">
        <div className="container">
          <div className="split">
            <div>
              <div className="badge badge-green eyebrow-lg">{c.heroBadge}</div>
              <h1 className="display" style={{ marginBottom: 18 }}>
                {c.heroTitle1}<br /><span className="gradient-text">{c.heroTitle2}</span><br />{c.heroTitle3}
              </h1>
              <p className="lead" style={{ marginBottom: 32, maxWidth: 480 }}>{c.heroLead}</p>
              <AppBadges />
            </div>
            <div className="hero-visual-wrap">
              <div className="hero-card">
                <div style={{ fontSize: 13, color: "#10B981", fontWeight: 700, marginBottom: 6 }}>{c.cardStatus}</div>
                <div style={{ fontSize: 14, color: "#6B7280" }}>{c.cardToday}</div>
                <div style={{ fontSize: 44, fontWeight: 800, color: "#111827", margin: "4px 0 18px" }}>€128.50</div>
                {[
                  { o: "#A249K · Cargo Van", v: "€42.00" },
                  { o: "#B871C · Box Truck", v: "€58.50" },
                  { o: "#C034M · Cargo Van", v: "€28.00" },
                ].map((r, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid #F3F4F6" }}>
                    <span style={{ color: "#374151", fontSize: 14 }}>{r.o}</span>
                    <span style={{ color: "#10B981", fontWeight: 700, fontSize: 14 }}>{r.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="sec bg-white">
        <div className="container">
          <div className="sec-head">
            <h2 className="h2">{c.benefitsHead}</h2>
            <p className="section-subtitle" style={{ marginTop: 12 }}>{c.benefitsSub}</p>
          </div>
          <div className="grid-auto-3">
            {c.benefits.map((b, i) => {
              const Icon = BENEFIT_ICONS[i];
              return (
                <div key={i} className="feature-card">
                  <div className={`feature-icon ${BENEFIT_CLS[i]}`}><Icon size={28} /></div>
                  <h3 className="h3" style={{ marginBottom: 10 }}>{b.title}</h3>
                  <p style={{ color: "#6B7280", lineHeight: 1.7, margin: 0 }}>{b.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Earnings highlight */}
      <section className="sec bg-light">
        <div className="container">
          <div className="split">
            <div>
              <div className="badge badge-amber eyebrow-lg">{c.payBadge}</div>
              <h2 className="h2" style={{ marginBottom: 16 }}>{c.payTitle}</h2>
              <p className="lead" style={{ marginBottom: 16 }}>{c.payP1}</p>
              <p className="lead">{c.payP2}</p>
            </div>
            <div className="panel-gradient">
              <div style={{ fontSize: 13, opacity: 0.9, fontWeight: 700, marginBottom: 6 }}>{c.payCardTitle}</div>
              <div style={{ fontSize: 40, fontWeight: 800, marginBottom: 18 }}>€41.60</div>
              {c.payRows.map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.2)", fontSize: 15 }}>
                  <span style={{ opacity: 0.92 }}>{r.k}</span><span style={{ fontWeight: 700 }}>{r.v}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 0 0", fontSize: 17, fontWeight: 800 }}>
                <span>{c.payReceive}</span><span>€41.60</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="sec bg-white">
        <div className="container">
          <div className="sec-head"><h2 className="h2">{c.stepsHead}</h2></div>
          <div className="grid-auto-4">
            {c.steps.map((s, i) => (
              <div key={i} className="tile">
                <div className="step-num">{i + 1}</div>
                <h3 className="h3" style={{ marginBottom: 8 }}>{s.title}</h3>
                <p style={{ color: "#6B7280", lineHeight: 1.6, fontSize: 15, margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Requirements */}
      <section className="sec bg-light">
        <div className="container">
          <div className="split">
            <div>
              <h2 className="h2" style={{ marginBottom: 18 }}>{c.reqTitle}</h2>
              <p className="lead" style={{ marginBottom: 24 }}>{c.reqLead}</p>
              <div>
                {c.requirements.map((r, i) => (
                  <div key={i} className="check-row">
                    <CheckCircle size={22} color="#10B981" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="tile center" style={{ background: "#fff" }}>
              <h3 className="h3" style={{ marginBottom: 12 }}>{c.readyTitle}</h3>
              <p style={{ color: "#6B7280", marginBottom: 24, lineHeight: 1.6 }}>{c.readyDesc}</p>
              <div style={{ display: "flex", justifyContent: "center" }}><AppBadges /></div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="sec bg-white">
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

      {/* CTA */}
      <section className="cta-band" style={{ background: "linear-gradient(135deg, #10B981 0%, #6366F1 100%)" }}>
        <div className="container center">
          <h2 className="cta-title">{c.ctaTitle}</h2>
          <p className="cta-sub maxw-560 mx-auto">{c.ctaSub}</p>
          <div style={{ display: "flex", justifyContent: "center" }}><AppBadges /></div>
        </div>
      </section>
    </div>
  );
}
