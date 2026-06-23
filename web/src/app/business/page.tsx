"use client";

import Link from "next/link";
import { Package, MapPin, ShieldCheck, BarChart3, Clock, Headphones, Truck, ArrowRight, Store, Factory, UtensilsCrossed, Hammer, Pill, Sofa } from "lucide-react";
import { useContent } from "@/lib/i18n";

const FEATURE_ICONS = [Clock, MapPin, ShieldCheck, BarChart3, Package, Headphones];
const FEATURE_CLS = ["feature-icon-green", "feature-icon-purple", "feature-icon-amber", "feature-icon-purple", "feature-icon-rose", "feature-icon-green"];
const INDUSTRY_ICONS = [Store, UtensilsCrossed, Hammer, Factory, Pill, Sofa];

export default function BusinessPage() {
  const c = useContent().business;
  return (
    <div className="page">
      {/* Hero */}
      <section className="hero-gradient sec">
        <div className="container">
          <div className="split">
            <div>
              <div className="badge badge-purple eyebrow-lg">{c.heroBadge}</div>
              <h1 className="display" style={{ marginBottom: 18 }}>
                {c.heroTitle1}<br /><span className="gradient-text">{c.heroTitle2}</span>
              </h1>
              <p className="lead" style={{ marginBottom: 32, maxWidth: 480 }}>{c.heroLead}</p>
              <div className="cluster">
                <Link href="/download" className="btn-secondary">{c.ctaStart} <ArrowRight size={18} /></Link>
                <Link href="/contact" className="btn-outline">{c.ctaSales}</Link>
              </div>
            </div>
            <div className="hero-visual-wrap">
              <div className="hero-card">
                <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 6 }}>{c.priceLabel}</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: "#111827", marginBottom: 4 }}>€49.90</div>
                <div style={{ fontSize: 13, color: "#10B981", fontWeight: 700, marginBottom: 18 }}>{c.priceRoute}</div>
                {c.priceRows.map((r, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderTop: "1px solid #F3F4F6", fontSize: 14, color: "#374151" }}>
                    <span>{r.k}</span><span style={{ fontWeight: 600 }}>{r.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="sec bg-white">
        <div className="container">
          <div className="sec-head">
            <h2 className="h2">{c.featuresHead}</h2>
            <p className="section-subtitle" style={{ marginTop: 12 }}>{c.featuresSub}</p>
          </div>
          <div className="grid-auto-3">
            {c.features.map((f, i) => {
              const Icon = FEATURE_ICONS[i];
              return (
                <div key={i} className="feature-card">
                  <div className={`feature-icon ${FEATURE_CLS[i]}`}><Icon size={28} /></div>
                  <h3 className="h3" style={{ marginBottom: 10 }}>{f.title}</h3>
                  <p style={{ color: "#6B7280", lineHeight: 1.7, margin: 0 }}>{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Fleet */}
      <section className="sec bg-light">
        <div className="container">
          <div className="sec-head">
            <h2 className="h2">{c.fleetHead}</h2>
            <p className="section-subtitle" style={{ marginTop: 12 }}>{c.fleetSub}</p>
          </div>
          <div className="grid-auto-3">
            {c.fleet.map((v, i) => (
              <div key={i} className="tile" style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div className="feature-icon feature-icon-green" style={{ width: 52, height: 52, marginBottom: 0, flexShrink: 0 }}><Truck size={24} /></div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>{v.name}</div>
                  <div style={{ fontSize: 14, color: "#6B7280" }}>{v.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="sec bg-white">
        <div className="container">
          <div className="sec-head"><h2 className="h2">{c.stepsHead}</h2></div>
          <div className="grid-auto-4">
            {c.steps.map((s, i) => (
              <div key={i} className="tile-soft">
                <div className="step-num">{i + 1}</div>
                <h3 className="h3" style={{ marginBottom: 8 }}>{s.title}</h3>
                <p style={{ color: "#6B7280", lineHeight: 1.6, fontSize: 15, margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Industries */}
      <section className="sec bg-light">
        <div className="container">
          <div className="sec-head">
            <h2 className="h2">{c.industriesHead}</h2>
            <p className="section-subtitle" style={{ marginTop: 12 }}>{c.industriesSub}</p>
          </div>
          <div className="grid-auto-3">
            {c.industries.map((ind, i) => {
              const Icon = INDUSTRY_ICONS[i];
              return (
                <div key={i} className="feature-card">
                  <div className="feature-icon feature-icon-purple"><Icon size={28} /></div>
                  <h3 className="h3" style={{ marginBottom: 10 }}>{ind.title}</h3>
                  <p style={{ color: "#6B7280", lineHeight: 1.7, margin: 0 }}>{ind.desc}</p>
                </div>
              );
            })}
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
      <section className="cta-band" style={{ background: "linear-gradient(135deg, #6366F1 0%, #10B981 100%)" }}>
        <div className="container center">
          <h2 className="cta-title">{c.ctaTitle}</h2>
          <p className="cta-sub maxw-560 mx-auto">{c.ctaSub}</p>
          <div className="cluster cluster-center">
            <Link href="/download" className="btn-on-dark">{c.ctaGetApp} <ArrowRight size={18} /></Link>
            <Link href="/contact" className="btn-ghost-dark">{c.ctaContact}</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
