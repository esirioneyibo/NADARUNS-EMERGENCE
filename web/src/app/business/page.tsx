import Link from "next/link";
import { Package, MapPin, ShieldCheck, BarChart3, Clock, Headphones, Truck, ArrowRight, Store, Factory, UtensilsCrossed, Hammer, Pill, Sofa } from "lucide-react";

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

const INDUSTRIES = [
  { icon: Store, title: "Retail & e-commerce", desc: "Same-day parcel and order delivery that keeps customers coming back." },
  { icon: UtensilsCrossed, title: "Food & grocery", desc: "Temperature-controlled vehicles keep perishables fresh, every trip." },
  { icon: Hammer, title: "Construction", desc: "Move tools, materials and pallets to site with flatbeds and cranes." },
  { icon: Factory, title: "Manufacturing", desc: "Reliable B2B freight between warehouses, plants and distributors." },
  { icon: Pill, title: "Pharma & healthcare", desc: "Careful, tracked handling for sensitive and time-critical deliveries." },
  { icon: Sofa, title: "Furniture & bulky goods", desc: "Box trucks and crews for oversized items, handled with care." },
];

const FAQS = [
  { q: "How is the price calculated?", a: "Pricing combines a base fee, distance, cargo weight, vehicle type, urgency and a small fuel component — and the full quote is shown up front before you confirm. No hidden fees." },
  { q: "How fast will a driver be matched?", a: "Usually within minutes. We match your shipment with the nearest verified driver whose vehicle fits your cargo." },
  { q: "Can I track my delivery?", a: "Yes. Every order includes a live map with the driver’s location and ETA, plus in-app chat from pickup to drop-off." },
  { q: "What can I ship?", a: "Anything from a single parcel to a full truckload. With 11 vehicle types — including refrigerated and specialized handling — there’s a fit for almost any cargo." },
  { q: "Do you offer business accounts?", a: "Yes. For regular or high-volume shipping, talk to our team about a business account with consolidated billing and priority support." },
];

export default function BusinessPage() {
  return (
    <div className="page">
      {/* Hero */}
      <section className="hero-gradient sec">
        <div className="container">
          <div className="split">
            <div>
              <div className="badge badge-purple eyebrow-lg">📦 For business</div>
              <h1 className="display" style={{ marginBottom: 18 }}>
                Ship anything,<br /><span className="gradient-text">anywhere in Finland</span>
              </h1>
              <p className="lead" style={{ marginBottom: 32, maxWidth: 480 }}>
                From a single parcel to a full truckload — get an instant, transparent price, a verified driver,
                and live tracking from pickup to delivery.
              </p>
              <div className="cluster">
                <Link href="/download" className="btn-secondary">Start shipping <ArrowRight size={18} /></Link>
                <Link href="/contact" className="btn-outline">Talk to sales</Link>
              </div>
            </div>
            <div className="hero-visual-wrap">
              <div className="hero-card">
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
      <section className="sec bg-white">
        <div className="container">
          <div className="sec-head">
            <h2 className="h2">Everything your logistics needs</h2>
            <p className="section-subtitle" style={{ marginTop: 12 }}>Powerful, transparent and built to scale with your business.</p>
          </div>
          <div className="grid-auto-3">
            {FEATURES.map((f, i) => (
              <div key={i} className="feature-card">
                <div className={`feature-icon ${f.cls}`}><f.icon size={28} /></div>
                <h3 className="h3" style={{ marginBottom: 10 }}>{f.title}</h3>
                <p style={{ color: "#6B7280", lineHeight: 1.7, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fleet */}
      <section className="sec bg-light">
        <div className="container">
          <div className="sec-head">
            <h2 className="h2">One platform, every vehicle</h2>
            <p className="section-subtitle" style={{ marginTop: 12 }}>Eleven vehicle types so your cargo always travels the right way.</p>
          </div>
          <div className="grid-auto-3">
            {FLEET.map((v, i) => (
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
          <div className="sec-head"><h2 className="h2">How it works</h2></div>
          <div className="grid-auto-4">
            {STEPS.map((s, i) => (
              <div key={i} className="tile-soft">
                <div className="step-num">{s.n}</div>
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
            <h2 className="h2">Built for every industry</h2>
            <p className="section-subtitle" style={{ marginTop: 12 }}>From corner shops to factories — teams across Finland move with NadaRuns.</p>
          </div>
          <div className="grid-auto-3">
            {INDUSTRIES.map((ind, i) => (
              <div key={i} className="feature-card">
                <div className="feature-icon feature-icon-purple"><ind.icon size={28} /></div>
                <h3 className="h3" style={{ marginBottom: 10 }}>{ind.title}</h3>
                <p style={{ color: "#6B7280", lineHeight: 1.7, margin: 0 }}>{ind.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="sec bg-white">
        <div className="container">
          <div className="sec-head"><h2 className="h2">Frequently asked questions</h2></div>
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
      <section className="cta-band" style={{ background: "linear-gradient(135deg, #6366F1 0%, #10B981 100%)" }}>
        <div className="container center">
          <h2 className="cta-title">Ready to ship smarter?</h2>
          <p className="cta-sub maxw-560 mx-auto">Get your first quote in under a minute.</p>
          <div className="cluster cluster-center">
            <Link href="/download" className="btn-on-dark">Get the app <ArrowRight size={18} /></Link>
            <Link href="/contact" className="btn-ghost-dark">Contact sales</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
