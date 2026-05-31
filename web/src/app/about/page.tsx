import Link from "next/link";
import { Target, Heart, Leaf, ShieldCheck, Zap, Globe, ArrowRight } from "lucide-react";
import { site } from "@/lib/site";

export const metadata = {
  title: "About NadaRuns — Moving Finland forward",
  description:
    "NadaRuns connects trusted drivers with businesses for fast, reliable deliveries across Finland. Learn about our mission, values and story.",
};

const STATS = [
  { number: site.stats.deliveries, label: "Deliveries completed" },
  { number: site.stats.drivers, label: "Active drivers" },
  { number: site.stats.cities, label: "Cities served" },
  { number: site.stats.rating, label: "Average rating" },
];

const VALUES = [
  { icon: Target, cls: "feature-icon-green", title: "Reliability", desc: "Every delivery matters. We obsess over on-time pickups, accurate ETAs and proof at every step." },
  { icon: Heart, cls: "feature-icon-rose", title: "Care", desc: "We treat every package as if it were our own — handled with attention, tracked end to end." },
  { icon: Leaf, cls: "feature-icon-green", title: "Sustainability", desc: "Smart routing and return-load matching cut empty kilometres and lower emissions." },
  { icon: ShieldCheck, cls: "feature-icon-purple", title: "Trust & safety", desc: "Verified drivers, OTP hand-offs and insured shipments give everyone peace of mind." },
  { icon: Zap, cls: "feature-icon-amber", title: "Speed", desc: "Book in under a minute and get matched with a nearby driver in real time." },
  { icon: Globe, cls: "feature-icon-purple", title: "Built for the Nordics", desc: "Pricing, vehicles and coverage tuned for Finland — and ready to scale across the region." },
];

export default function AboutPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      {/* Hero */}
      <section className="hero-gradient" style={{ padding: "96px 0" }}>
        <div className="container" style={{ textAlign: "center", maxWidth: 840 }}>
          <div className="badge badge-green" style={{ marginBottom: 24 }}>✨ Our story</div>
          <h1 style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.1, color: "#111827", marginBottom: 20 }}>
            Moving Finland forward,<br />
            <span className="gradient-text">one delivery at a time</span>
          </h1>
          <p style={{ fontSize: 19, color: "#6B7280", lineHeight: 1.7, maxWidth: 680, margin: "0 auto" }}>
            NadaRuns is the modern logistics platform connecting trusted drivers with businesses
            that need to move things — from a single parcel to a full truckload — quickly, fairly and reliably.
          </p>
        </div>
      </section>

      {/* Stats */}
      <section style={{ padding: "64px 0", background: "#fff" }}>
        <div className="container">
          <div className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24 }}>
            {STATS.map((s, i) => (
              <div key={i} className="stat-card">
                <div className="stat-number">{s.number}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="section" style={{ background: "#F9FAFB", paddingTop: 80, paddingBottom: 80 }}>
        <div className="container">
          <div className="hero-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
            <div>
              <div className="badge badge-purple" style={{ marginBottom: 20 }}>Our mission</div>
              <h2 style={{ fontSize: 38, fontWeight: 800, color: "#111827", lineHeight: 1.2, marginBottom: 18 }}>
                Logistics that’s fair for drivers and effortless for businesses
              </h2>
              <p style={{ fontSize: 17, color: "#6B7280", lineHeight: 1.8, marginBottom: 16 }}>
                Traditional freight is slow, opaque and stacked with middlemen. We built NadaRuns to fix that —
                transparent pricing set up front, drivers who keep the majority of every fare, and real-time
                tracking from pickup to drop-off.
              </p>
              <p style={{ fontSize: 17, color: "#6B7280", lineHeight: 1.8 }}>
                Whether you’re a small shop sending parcels or an enterprise moving pallets, NadaRuns gives you
                the right vehicle, a fair price and a driver you can trust — in minutes.
              </p>
            </div>
            <div style={{ background: "linear-gradient(135deg, #10B981 0%, #6366F1 100%)", borderRadius: 24, padding: 40, color: "#fff", boxShadow: "0 30px 60px -20px rgba(99,102,241,0.4)" }}>
              <h3 style={{ fontSize: 24, fontWeight: 800, marginBottom: 18 }}>Why we’re different</h3>
              {[
                "Up-front, transparent pricing — no surprises",
                "Drivers keep up to 80% + 100% of any bonus",
                "Live tracking and ETA on every shipment",
                "11 vehicle types, from cargo van to crane truck",
                "Built for Finland, ready for the Nordics",
              ].map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 13, background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✓</div>
                  <span style={{ fontSize: 15.5, lineHeight: 1.5 }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="section" style={{ background: "#fff", paddingTop: 80, paddingBottom: 80 }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <h2 className="section-title" style={{ textAlign: "center" }}>What we stand for</h2>
            <p className="section-subtitle">The principles behind every delivery we power.</p>
          </div>
          <div className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            {VALUES.map((v, i) => (
              <div key={i} className="feature-card">
                <div className={`feature-icon ${v.cls}`}><v.icon size={28} /></div>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 10 }}>{v.title}</h3>
                <p style={{ color: "#6B7280", lineHeight: 1.7 }}>{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "90px 0", background: "linear-gradient(135deg, #10B981 0%, #6366F1 100%)" }}>
        <div className="container" style={{ textAlign: "center" }}>
          <h2 style={{ fontSize: 40, fontWeight: 800, color: "#fff", marginBottom: 16 }}>Join the movement</h2>
          <p style={{ fontSize: 19, color: "rgba(255,255,255,0.85)", marginBottom: 36, maxWidth: 560, margin: "0 auto 36px" }}>
            Whether you drive or you ship, NadaRuns was built for you.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/drivers" style={{ background: "#fff", color: "#111827", padding: "14px 28px", borderRadius: 12, fontWeight: 700, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}>
              Drive with us <ArrowRight size={18} />
            </Link>
            <Link href="/business" style={{ background: "rgba(255,255,255,0.15)", color: "#fff", padding: "14px 28px", borderRadius: 12, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(255,255,255,0.3)" }}>
              Ship with us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
