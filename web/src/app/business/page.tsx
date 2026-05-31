import Link from "next/link";
import { Package, MapPin, ShieldCheck, BarChart3, Clock, Headphones, Truck, ArrowRight, CheckCircle } from "lucide-react";

export const metadata = {
  title: "NadaRuns for Business — Ship smarter",
  description:
    "Move anything across Finland with NadaRuns for Business. Instant transparent pricing, live tracking, 11 vehicle types and proof of delivery.",
};

const FEATURES = [
  { icon: Clock, cls: "feature-icon-green", title: "Book in under a minute", desc: "A 6-step wizard gives you an instant, transparent quote before you confirm." },
  { icon: MapPin, cls: "feature-icon-purple", title: "Live tracking", desc: "Watch your shipment on the map with live ETA from pickup to drop-off." },
  { icon: ShieldCheck, cls: "feature-icon-amber", title: "Proof of delivery", desc: "OTP hand-offs and delivery confirmation on every order — fully insured." },
  { icon: BarChart3, cls: "feature-icon-purple", title: "Transparent pricing", desc: "Base + distance + weight, shown up front. No hidden fees, no haggling." },
  { icon: Package, cls: "feature-icon-rose", title: "Any cargo", desc: "Parcels, pallets, oversized or refrigerated — the right vehicle every time." },
  { icon: Headphones, cls: "feature-icon-green", title: "Priority support", desc: "Dedicated help and in-app chat with your driver on every shipment." },
];

const FLEET = [
  { name: "Cargo Van", note: "Up to 1,500 kg" },
  { name: "Box Truck", note: "Up to 5,000 kg" },
  { name: "Flatbed", note: "Up to 8,000 kg" },
  { name: "Semi-Truck", note: "Up to 20,000 kg" },
  { name: "Refrigerated", note: "Temperature-controlled" },
  { name: "Crane / Hazmat", note: "Specialized handling" },
];

const STEPS = [
  { n: "1", title: "Create a shipment", desc: "Enter pickup, drop-off, cargo and vehicle — get an instant price." },
  { n: "2", title: "Get matched", desc: "A nearby verified driver accepts and heads to pickup." },
  { n: "3", title: "Track live", desc: "Follow the delivery in real time and chat with your driver." },
  { n: "4", title: "Delivered", desc: "Confirmed with OTP and proof of delivery. Done." },
];

export default function BusinessPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      {/* Hero */}
      <section className="hero-gradient" style={{ padding: "90px 0" }}>
        <div className="container">
          <div className="hero-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
            <div>
              <div className="badge badge-purple" style={{ marginBottom: 24 }}>📦 For business</div>
              <h1 style={{ fontSize: 50, fontWeight: 800, lineHeight: 1.1, color: "#111827", marginBottom: 18 }}>
                Ship anything,<br /><span className="gradient-text">anywhere in Finland</span>
              </h1>
              <p style={{ fontSize: 18, color: "#6B7280", lineHeight: 1.7, marginBottom: 32, maxWidth: 480 }}>
                From a single parcel to a full truckload — get an instant, transparent price, a verified driver,
                and live tracking from pickup to delivery.
              </p>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <Link href="/download" className="btn-secondary">Start shipping <ArrowRight size={18} /></Link>
                <Link href="/contact" className="btn-outline">Talk to sales</Link>
              </div>
            </div>
            <div className="hero-visual" style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ background: "#fff", borderRadius: 24, padding: 28, width: 320, boxShadow: "0 30px 60px -20px rgba(0,0,0,0.18)" }}>
                <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 6 }}>Estimated price</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: "#111827", marginBottom: 4 }}>€49.90</div>
                <div style={{ fontSize: 13, color: "#10B981", fontWeight: 700, marginBottom: 18 }}>Helsinki → Espoo · 22 km</div>
                {[
                  { k: "Base fee", v: "€12.00" },
                  { k: "Distance", v: "€24.20" },
                  { k: "Weight (80 kg)", v: "€10.00" },
                  { k: "Fuel (8%)", v: "€3.70" },
                ].map((r, i) => (
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
      <section className="section" style={{ background: "#fff", paddingTop: 80, paddingBottom: 80 }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <h2 className="section-title" style={{ textAlign: "center" }}>Everything your logistics needs</h2>
            <p className="section-subtitle">Powerful, transparent and built to scale with your business.</p>
          </div>
          <div className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            {FEATURES.map((f, i) => (
              <div key={i} className="feature-card">
                <div className={`feature-icon ${f.cls}`}><f.icon size={28} /></div>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 10 }}>{f.title}</h3>
                <p style={{ color: "#6B7280", lineHeight: 1.7 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fleet */}
      <section className="section" style={{ background: "#F9FAFB", paddingTop: 80, paddingBottom: 80 }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <h2 className="section-title" style={{ textAlign: "center" }}>One platform, every vehicle</h2>
            <p className="section-subtitle">Eleven vehicle types so your cargo always travels the right way.</p>
          </div>
          <div className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            {FLEET.map((v, i) => (
              <div key={i} style={{ background: "#fff", borderRadius: 18, padding: 24, border: "1px solid #F3F4F6", display: "flex", alignItems: "center", gap: 16 }}>
                <div className="feature-icon feature-icon-green" style={{ width: 52, height: 52, marginBottom: 0 }}><Truck size={24} /></div>
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
      <section className="section" style={{ background: "#fff", paddingTop: 80, paddingBottom: 80 }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <h2 className="section-title" style={{ textAlign: "center" }}>How it works</h2>
          </div>
          <div className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24 }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{ background: "#F9FAFB", borderRadius: 20, padding: 28 }}>
                <div style={{ width: 44, height: 44, borderRadius: 22, background: "linear-gradient(135deg, #6366F1 0%, #10B981 100%)", color: "#fff", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>{s.n}</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 8 }}>{s.title}</h3>
                <p style={{ color: "#6B7280", lineHeight: 1.6, fontSize: 15 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "90px 0", background: "linear-gradient(135deg, #6366F1 0%, #10B981 100%)" }}>
        <div className="container" style={{ textAlign: "center" }}>
          <h2 style={{ fontSize: 40, fontWeight: 800, color: "#fff", marginBottom: 16 }}>Ready to ship smarter?</h2>
          <p style={{ fontSize: 19, color: "rgba(255,255,255,0.85)", marginBottom: 36 }}>Get your first quote in under a minute.</p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/download" style={{ background: "#fff", color: "#111827", padding: "14px 28px", borderRadius: 12, fontWeight: 700, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}>Get the app <ArrowRight size={18} /></Link>
            <Link href="/contact" style={{ background: "rgba(255,255,255,0.15)", color: "#fff", padding: "14px 28px", borderRadius: 12, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(255,255,255,0.3)" }}>Contact sales</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
