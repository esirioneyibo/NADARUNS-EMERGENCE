"use client";

import Link from "next/link";
import { Target, Heart, Leaf, ShieldCheck, Zap, Globe, ArrowRight, CheckCircle2 } from "lucide-react";
import { site } from "@/lib/site";
import { useContent } from "@/lib/i18n";

const STAT_NUMBERS = [site.stats.deliveries, site.stats.drivers, site.stats.cities, site.stats.rating];
const VALUE_ICONS = [Target, Heart, Leaf, ShieldCheck, Zap, Globe];
const VALUE_CLS = ["feature-icon-green", "feature-icon-rose", "feature-icon-green", "feature-icon-purple", "feature-icon-amber", "feature-icon-purple"];

export default function AboutPage() {
  const c = useContent().about;
  return (
    <div className="page">
      {/* Hero */}
      <section className="hero-gradient sec">
        <div className="container center maxw-820 mx-auto">
          <div className="badge badge-green eyebrow-lg">{c.heroBadge}</div>
          <h1 className="display" style={{ marginBottom: 20 }}>
            {c.heroTitle1}<br />
            <span className="gradient-text">{c.heroTitle2}</span>
          </h1>
          <p className="lead maxw-720 mx-auto">{c.heroLead}</p>
        </div>
      </section>

      {/* Stats */}
      <section className="sec-sm bg-white">
        <div className="container">
          <div className="grid-auto-4">
            {c.statsLabels.map((label, i) => (
              <div key={i} className="stat-card">
                <div className="stat-number">{STAT_NUMBERS[i]}</div>
                <div className="stat-label">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="sec bg-light">
        <div className="container">
          <div className="split">
            <div>
              <div className="badge badge-purple eyebrow-lg">{c.missionBadge}</div>
              <h2 className="h2" style={{ marginBottom: 18 }}>{c.missionTitle}</h2>
              <p className="lead" style={{ marginBottom: 16 }}>{c.missionP1}</p>
              <p className="lead">{c.missionP2}</p>
            </div>
            <div className="panel-gradient">
              <h3 style={{ fontSize: 24, fontWeight: 800, marginBottom: 18 }}>{c.diffTitle}</h3>
              {c.diffs.map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <CheckCircle2 size={22} style={{ flexShrink: 0, opacity: 0.95 }} />
                  <span style={{ fontSize: 15.5, lineHeight: 1.5 }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="sec bg-white">
        <div className="container">
          <div className="sec-head">
            <h2 className="h2">{c.timelineHead}</h2>
            <p className="section-subtitle" style={{ marginTop: 12 }}>{c.timelineSub}</p>
          </div>
          <div className="timeline">
            {c.timeline.map((t, i) => (
              <div key={i} className="timeline-item">
                <div className="timeline-year">{t.year}</div>
                <div className="tile-soft">
                  <h3 className="h3" style={{ marginBottom: 8 }}>{t.title}</h3>
                  <p style={{ color: "#6B7280", lineHeight: 1.7, margin: 0 }}>{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="sec bg-light">
        <div className="container">
          <div className="sec-head">
            <h2 className="h2">{c.valuesHead}</h2>
            <p className="section-subtitle" style={{ marginTop: 12 }}>{c.valuesSub}</p>
          </div>
          <div className="grid-auto-3">
            {c.values.map((v, i) => {
              const Icon = VALUE_ICONS[i];
              return (
                <div key={i} className="feature-card">
                  <div className={`feature-icon ${VALUE_CLS[i]}`}><Icon size={28} /></div>
                  <h3 className="h3" style={{ marginBottom: 10 }}>{v.title}</h3>
                  <p style={{ color: "#6B7280", lineHeight: 1.7, margin: 0 }}>{v.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-band" style={{ background: "linear-gradient(135deg, #10B981 0%, #6366F1 100%)" }}>
        <div className="container center">
          <h2 className="cta-title">{c.ctaTitle}</h2>
          <p className="cta-sub maxw-560 mx-auto">{c.ctaSub}</p>
          <div className="cluster cluster-center">
            <Link href="/drivers" className="btn-on-dark">{c.ctaDrive} <ArrowRight size={18} /></Link>
            <Link href="/business" className="btn-ghost-dark">{c.ctaShip}</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
