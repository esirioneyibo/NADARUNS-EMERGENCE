"use client";

import AppBadges from "@/components/AppBadges";
import { site } from "@/lib/site";
import { Bell, MapPin, Wallet, MessageSquare, ShieldCheck, Zap } from "lucide-react";
import { useContent } from "@/lib/i18n";

const FEATURE_ICONS = [MapPin, Bell, Wallet, MessageSquare, ShieldCheck, Zap];

export default function DownloadPage() {
  const c = useContent().download;
  return (
    <>
      <div style={{ paddingTop: "72px" }}>
        {/* Hero */}
        <section className="hero-gradient" style={{ padding: "80px 0 90px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "-120px", right: "-120px", width: "420px", height: "420px", background: "radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)", borderRadius: "50%" }} />
          <div className="container">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "64px", alignItems: "center" }} className="dl-hero-grid">
              <div>
                <div className="badge badge-purple" style={{ marginBottom: "24px" }}>{c.heroBadge}</div>
                <h1 style={{ fontSize: "52px", fontWeight: 800, lineHeight: 1.1, marginBottom: "20px", color: "#111827" }}>
                  {c.heroTitle1}<br />
                  <span className="gradient-text">{c.heroTitle2}</span>
                </h1>
                <p style={{ fontSize: "19px", color: "#6B7280", lineHeight: 1.7, marginBottom: "32px", maxWidth: "480px" }}>
                  {site.app.comingSoon ? c.heroLeadSoon : c.heroLeadLive}
                </p>
                <AppBadges />
              </div>

              {/* QR + phone */}
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "24px" }} className="dl-hero-visual">
                <div style={{ background: "white", borderRadius: "20px", padding: "20px", boxShadow: "0 20px 50px rgba(0,0,0,0.12)", textAlign: "center" }}>
                  <div
                    aria-hidden="true"
                    style={{
                      width: "150px",
                      height: "150px",
                      borderRadius: "12px",
                      background:
                        "conic-gradient(#111827 0 25%, #fff 0 50%, #111827 0 75%, #fff 0) 0 0/40px 40px, conic-gradient(#111827 0 25%, #fff 0 50%, #111827 0 75%, #fff 0) 20px 20px/40px 40px",
                      border: "8px solid white",
                      outline: "1px solid #E5E7EB",
                      margin: "0 auto 12px",
                    }}
                  />
                  <div style={{ fontSize: "13px", color: "#6B7280", fontWeight: 600 }}>{c.scan}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="section" style={{ background: "white" }}>
          <div className="container">
            <div style={{ textAlign: "center", marginBottom: "56px" }}>
              <h2 className="section-title">{c.featuresHead}</h2>
              <p className="section-subtitle">{c.featuresSub}</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }} className="dl-feature-grid">
              {c.features.map((f, i) => {
                const Icon = FEATURE_ICONS[i];
                return (
                  <div key={i} className="feature-card">
                    <div className="feature-icon feature-icon-purple">
                      <Icon className="w-7 h-7" />
                    </div>
                    <h3 style={{ fontSize: "19px", fontWeight: 700, marginBottom: "10px", color: "#111827" }}>{f.title}</h3>
                    <p style={{ color: "#6B7280", lineHeight: 1.6 }}>{f.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section style={{ padding: "90px 0", background: "linear-gradient(135deg, #10B981 0%, #6366F1 100%)" }}>
          <div className="container" style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: "40px", fontWeight: 800, color: "white", marginBottom: "16px" }}>{c.ctaTitle}</h2>
            <p style={{ fontSize: "19px", color: "rgba(255,255,255,0.85)", marginBottom: "36px" }}>
              {c.ctaSub}
            </p>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <AppBadges />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
