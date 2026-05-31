import Link from "next/link";
import AppBadges from "@/components/AppBadges";
import { Clock, Banknote, Truck, Navigation, Bell, Headphones, ArrowRight, CheckCircle } from "lucide-react";

export const metadata = {
  title: "Drive with NadaRuns — Earn on your schedule",
  description:
    "Become a NadaRuns driver. Flexible hours, fast weekly pay, choose your vehicle and accept jobs near you with in-app navigation.",
};

const BENEFITS = [
  { icon: Clock, cls: "feature-icon-green", title: "Flexible hours", desc: "Go online whenever it suits you. No shifts, no minimums — you’re always in control." },
  { icon: Banknote, cls: "feature-icon-amber", title: "Keep more of every fare", desc: "Drivers keep up to 80% of the base price plus 100% of any shipper bonus." },
  { icon: Truck, cls: "feature-icon-purple", title: "Use any vehicle", desc: "From a cargo van to a semi-truck — register multiple vehicles and switch your active one anytime." },
  { icon: Navigation, cls: "feature-icon-green", title: "Built-in navigation", desc: "One-tap hand-off to Google, Apple or Waze for turn-by-turn directions." },
  { icon: Bell, cls: "feature-icon-rose", title: "Instant job alerts", desc: "Distinct sounds and push notifications the moment a matching job appears nearby." },
  { icon: Headphones, cls: "feature-icon-purple", title: "Real support", desc: "A team that has your back, plus in-app chat with shippers on every delivery." },
];

const STEPS = [
  { n: "1", title: "Sign up", desc: "Create your driver account and add your vehicle details in minutes." },
  { n: "2", title: "Go online", desc: "Open the app, go online, and see paid jobs on the map near you." },
  { n: "3", title: "Accept & deliver", desc: "Swipe to accept, navigate to pickup, and complete the drop-off with OTP." },
  { n: "4", title: "Get paid", desc: "Earnings land in your wallet — track today, this week and all-time." },
];

const REQUIREMENTS = [
  "Valid driver’s licence for your vehicle class",
  "Vehicle registration & insurance",
  "Smartphone (iOS or Android)",
  "Right to work in Finland",
];

export default function DriversPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      {/* Hero */}
      <section className="hero-gradient" style={{ padding: "90px 0" }}>
        <div className="container">
          <div className="hero-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
            <div>
              <div className="badge badge-green" style={{ marginBottom: 24 }}>🚚 For drivers</div>
              <h1 style={{ fontSize: 50, fontWeight: 800, lineHeight: 1.1, color: "#111827", marginBottom: 18 }}>
                Your vehicle.<br /><span className="gradient-text">Your schedule.</span><br />Your earnings.
              </h1>
              <p style={{ fontSize: 18, color: "#6B7280", lineHeight: 1.7, marginBottom: 32, maxWidth: 480 }}>
                Turn your van or truck into income. Accept delivery jobs near you, navigate in one tap,
                and keep the majority of every fare — with fast, transparent pay.
              </p>
              <AppBadges />
            </div>
            <div className="hero-visual" style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ background: "#fff", borderRadius: 24, padding: 28, width: 320, boxShadow: "0 30px 60px -20px rgba(0,0,0,0.18)" }}>
                <div style={{ fontSize: 13, color: "#10B981", fontWeight: 700, marginBottom: 6 }}>● Online · earning</div>
                <div style={{ fontSize: 14, color: "#6B7280" }}>Today’s earnings</div>
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
      <section className="section" style={{ background: "#fff", paddingTop: 80, paddingBottom: 80 }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <h2 className="section-title" style={{ textAlign: "center" }}>Why drive with NadaRuns</h2>
            <p className="section-subtitle">Everything you need to earn more, with less hassle.</p>
          </div>
          <div className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            {BENEFITS.map((b, i) => (
              <div key={i} className="feature-card">
                <div className={`feature-icon ${b.cls}`}><b.icon size={28} /></div>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 10 }}>{b.title}</h3>
                <p style={{ color: "#6B7280", lineHeight: 1.7 }}>{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="section" style={{ background: "#F9FAFB", paddingTop: 80, paddingBottom: 80 }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <h2 className="section-title" style={{ textAlign: "center" }}>Start earning in 4 steps</h2>
          </div>
          <div className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24 }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{ background: "#fff", borderRadius: 20, padding: 28, border: "1px solid #F3F4F6" }}>
                <div style={{ width: 44, height: 44, borderRadius: 22, background: "linear-gradient(135deg, #10B981 0%, #6366F1 100%)", color: "#fff", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>{s.n}</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 8 }}>{s.title}</h3>
                <p style={{ color: "#6B7280", lineHeight: 1.6, fontSize: 15 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Requirements */}
      <section className="section" style={{ background: "#fff", paddingTop: 72, paddingBottom: 72 }}>
        <div className="container">
          <div className="hero-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
            <div>
              <h2 style={{ fontSize: 34, fontWeight: 800, color: "#111827", marginBottom: 18 }}>What you’ll need</h2>
              <div>
                {REQUIREMENTS.map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <CheckCircle size={22} color="#10B981" />
                    <span style={{ fontSize: 16, color: "#374151" }}>{r}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: "#F9FAFB", borderRadius: 24, padding: 40, textAlign: "center" }}>
              <h3 style={{ fontSize: 24, fontWeight: 800, color: "#111827", marginBottom: 12 }}>Ready to roll?</h3>
              <p style={{ color: "#6B7280", marginBottom: 24, lineHeight: 1.6 }}>Download the app and go online today.</p>
              <div style={{ display: "flex", justifyContent: "center" }}><AppBadges /></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
