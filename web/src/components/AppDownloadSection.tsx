"use client";

import AppBadges from "@/components/AppBadges";
import { site } from "@/lib/site";
import { useContent } from "@/lib/i18n";

// Reusable "Get the app" band used on the home page and elsewhere.
export default function AppDownloadSection() {
  const c = useContent().appBand;
  return (
    <section className="section" style={{ background: "#0B1220" }}>
      <div className="container">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 0.8fr",
            gap: "56px",
            alignItems: "center",
          }}
          className="app-band-grid"
        >
          <div>
            <div className="badge badge-green" style={{ marginBottom: "20px" }}>
              {c.badge}
            </div>
            <h2 style={{ fontSize: "40px", fontWeight: 800, color: "white", lineHeight: 1.15, marginBottom: "16px" }}>
              {c.title1}<br />
              <span className="gradient-text">{c.title2}</span>
            </h2>
            <p style={{ fontSize: "18px", color: "#9CA3AF", lineHeight: 1.7, marginBottom: "32px", maxWidth: "460px" }}>
              {c.sub}
            </p>
            <AppBadges />
            <p style={{ color: "#6B7280", fontSize: "14px", marginTop: "20px" }}>
              {site.app.comingSoon ? c.comingSoon : c.available}
            </p>
          </div>

          {/* Phone mockup */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div
              style={{
                width: "230px",
                height: "460px",
                background: "linear-gradient(135deg, #10B981 0%, #6366F1 100%)",
                borderRadius: "36px",
                padding: "12px",
                boxShadow: "0 40px 80px -20px rgba(99,102,241,0.45)",
              }}
            >
              <div style={{ background: "#0B1220", borderRadius: "26px", height: "100%", padding: "20px 16px", color: "white" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#9CA3AF", marginBottom: "24px" }}>
                  <span>9:41</span>
                  <span>NadaRuns</span>
                </div>
                <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "16px", padding: "16px", marginBottom: "14px" }}>
                  <div style={{ fontSize: "12px", color: "#10B981", fontWeight: 600, marginBottom: "6px" }}>{c.inTransit}</div>
                  <div style={{ fontWeight: 700, marginBottom: "4px" }}>{c.orderId}</div>
                  <div style={{ fontSize: "12px", color: "#9CA3AF" }}>{c.arriving}</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "16px", padding: "16px", marginBottom: "14px" }}>
                  <div style={{ fontSize: "12px", color: "#6366F1", fontWeight: 600, marginBottom: "6px" }}>{c.earnings}</div>
                  <div style={{ fontSize: "26px", fontWeight: 800 }}>€128.50</div>
                </div>
                <div style={{ background: "linear-gradient(135deg, #10B981 0%, #6366F1 100%)", borderRadius: "14px", padding: "14px", textAlign: "center", fontWeight: 700 }}>
                  {c.goOnline}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
