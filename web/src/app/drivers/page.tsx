import AppBadges from "@/components/AppBadges";
import { Clock, Banknote, Truck, Navigation, Bell, Headphones, CheckCircle } from "lucide-react";

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

const PAYOUT = [
  { k: "Base fare", v: "€42.00" },
  { k: "Shipper bonus", v: "€8.00" },
  { k: "Platform fee (20%)", v: "−€8.40" },
];

const FAQS = [
  { q: "How much can I earn?", a: "Earnings depend on the hours you drive and your vehicle type. You keep up to 80% of every base fare plus 100% of any bonus a shipper adds — and you can see your projected payout before you accept." },
  { q: "Which vehicles can I drive?", a: "Anything you’re licensed and insured for, from a cargo van to a semi-truck. You can register multiple vehicles and switch your active one whenever you like." },
  { q: "When and how do I get paid?", a: "Your earnings are tracked live in the app — today, this week and all-time — and paid out to your account on a regular weekly cycle." },
  { q: "Do I need my own company?", a: "No. Light-entrepreneurs and sole traders are welcome. You just need a valid licence, registration and insurance for your vehicle." },
  { q: "Can I choose which jobs I take?", a: "Always. You only ever accept the jobs that suit your route, vehicle and schedule — there are no forced dispatches." },
];

export default function DriversPage() {
  return (
    <div className="page">
      {/* Hero */}
      <section className="hero-gradient sec">
        <div className="container">
          <div className="split">
            <div>
              <div className="badge badge-green eyebrow-lg">🚚 For drivers</div>
              <h1 className="display" style={{ marginBottom: 18 }}>
                Your vehicle.<br /><span className="gradient-text">Your schedule.</span><br />Your earnings.
              </h1>
              <p className="lead" style={{ marginBottom: 32, maxWidth: 480 }}>
                Turn your van or truck into income. Accept delivery jobs near you, navigate in one tap,
                and keep the majority of every fare — with fast, transparent pay.
              </p>
              <AppBadges />
            </div>
            <div className="hero-visual-wrap">
              <div className="hero-card">
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
      <section className="sec bg-white">
        <div className="container">
          <div className="sec-head">
            <h2 className="h2">Why drive with NadaRuns</h2>
            <p className="section-subtitle" style={{ marginTop: 12 }}>Everything you need to earn more, with less hassle.</p>
          </div>
          <div className="grid-auto-3">
            {BENEFITS.map((b, i) => (
              <div key={i} className="feature-card">
                <div className={`feature-icon ${b.cls}`}><b.icon size={28} /></div>
                <h3 className="h3" style={{ marginBottom: 10 }}>{b.title}</h3>
                <p style={{ color: "#6B7280", lineHeight: 1.7, margin: 0 }}>{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Earnings highlight */}
      <section className="sec bg-light">
        <div className="container">
          <div className="split">
            <div>
              <div className="badge badge-amber eyebrow-lg">💸 Transparent pay</div>
              <h2 className="h2" style={{ marginBottom: 16 }}>See exactly what you’ll earn — before you accept</h2>
              <p className="lead" style={{ marginBottom: 16 }}>
                No guesswork and no hidden cuts. Every job shows your projected payout up front, so
                you always know what a delivery is worth before you swipe to accept.
              </p>
              <p className="lead">
                You keep up to 80% of the base fare and 100% of any bonus the shipper adds on top.
              </p>
            </div>
            <div className="panel-gradient">
              <div style={{ fontSize: 13, opacity: 0.9, fontWeight: 700, marginBottom: 6 }}>Sample job payout</div>
              <div style={{ fontSize: 40, fontWeight: 800, marginBottom: 18 }}>€41.60</div>
              {PAYOUT.map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.2)", fontSize: 15 }}>
                  <span style={{ opacity: 0.92 }}>{r.k}</span><span style={{ fontWeight: 700 }}>{r.v}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 0 0", fontSize: 17, fontWeight: 800 }}>
                <span>You receive</span><span>€41.60</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="sec bg-white">
        <div className="container">
          <div className="sec-head"><h2 className="h2">Start earning in 4 steps</h2></div>
          <div className="grid-auto-4">
            {STEPS.map((s, i) => (
              <div key={i} className="tile">
                <div className="step-num">{s.n}</div>
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
              <h2 className="h2" style={{ marginBottom: 18 }}>What you’ll need</h2>
              <p className="lead" style={{ marginBottom: 24 }}>Getting verified is quick. Have these ready and you can be online today.</p>
              <div>
                {REQUIREMENTS.map((r, i) => (
                  <div key={i} className="check-row">
                    <CheckCircle size={22} color="#10B981" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="tile center" style={{ background: "#fff" }}>
              <h3 className="h3" style={{ marginBottom: 12 }}>Ready to roll?</h3>
              <p style={{ color: "#6B7280", marginBottom: 24, lineHeight: 1.6 }}>Download the app and go online today.</p>
              <div style={{ display: "flex", justifyContent: "center" }}><AppBadges /></div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="sec bg-white">
        <div className="container">
          <div className="sec-head"><h2 className="h2">Driver questions, answered</h2></div>
          <div className="faq-list">
            {FAQS.map((f, i) => (
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
          <h2 className="cta-title">Your next delivery is waiting</h2>
          <p className="cta-sub maxw-560 mx-auto">Download the app, go online, and start earning on your own terms.</p>
          <div style={{ display: "flex", justifyContent: "center" }}><AppBadges /></div>
        </div>
      </section>
    </div>
  );
}
