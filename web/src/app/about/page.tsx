import Link from "next/link";
import { Target, Heart, Leaf, ShieldCheck, Zap, Globe, ArrowRight, CheckCircle2 } from "lucide-react";
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

const TIMELINE = [
  { year: "2024", title: "NadaRuns is born", desc: "Founded in Helsinki with a simple belief: logistics should be fair for drivers and effortless for businesses." },
  { year: "2024", title: "First 1,000 deliveries", desc: "Local shops and couriers proved the model — transparent pricing and same-day matching that just works." },
  { year: "2025", title: "Eleven vehicle types", desc: "From cargo vans to crane trucks, we expanded the fleet so any cargo travels the right way." },
  { year: "Today", title: "Scaling across Finland", desc: "Thousands of verified drivers, live tracking on every order, and a roadmap that reaches the whole Nordics." },
];

const DIFFERENTIATORS = [
  "Up-front, transparent pricing — no surprises",
  "Drivers keep up to 80% + 100% of any bonus",
  "Live tracking and ETA on every shipment",
  "11 vehicle types, from cargo van to crane truck",
  "Built for Finland, ready for the Nordics",
];

export default function AboutPage() {
  return (
    <div className="page">
      {/* Hero */}
      <section className="hero-gradient sec">
        <div className="container center maxw-820 mx-auto">
          <div className="badge badge-green eyebrow-lg">✨ Our story</div>
          <h1 className="display" style={{ marginBottom: 20 }}>
            Moving Finland forward,<br />
            <span className="gradient-text">one delivery at a time</span>
          </h1>
          <p className="lead maxw-720 mx-auto">
            NadaRuns is the modern logistics platform connecting trusted drivers with businesses
            that need to move things — from a single parcel to a full truckload — quickly, fairly and reliably.
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="sec-sm bg-white">
        <div className="container">
          <div className="grid-auto-4">
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
      <section className="sec bg-light">
        <div className="container">
          <div className="split">
            <div>
              <div className="badge badge-purple eyebrow-lg">Our mission</div>
              <h2 className="h2" style={{ marginBottom: 18 }}>
                Logistics that’s fair for drivers and effortless for businesses
              </h2>
              <p className="lead" style={{ marginBottom: 16 }}>
                Traditional freight is slow, opaque and stacked with middlemen. We built NadaRuns to fix that —
                transparent pricing set up front, drivers who keep the majority of every fare, and real-time
                tracking from pickup to drop-off.
              </p>
              <p className="lead">
                Whether you’re a small shop sending parcels or an enterprise moving pallets, NadaRuns gives you
                the right vehicle, a fair price and a driver you can trust — in minutes.
              </p>
            </div>
            <div className="panel-gradient">
              <h3 style={{ fontSize: 24, fontWeight: 800, marginBottom: 18 }}>Why we’re different</h3>
              {DIFFERENTIATORS.map((t, i) => (
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
            <h2 className="h2">Our journey so far</h2>
            <p className="section-subtitle" style={{ marginTop: 12 }}>From a Helsinki idea to a platform moving the country.</p>
          </div>
          <div className="timeline">
            {TIMELINE.map((t, i) => (
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
            <h2 className="h2">What we stand for</h2>
            <p className="section-subtitle" style={{ marginTop: 12 }}>The principles behind every delivery we power.</p>
          </div>
          <div className="grid-auto-3">
            {VALUES.map((v, i) => (
              <div key={i} className="feature-card">
                <div className={`feature-icon ${v.cls}`}><v.icon size={28} /></div>
                <h3 className="h3" style={{ marginBottom: 10 }}>{v.title}</h3>
                <p style={{ color: "#6B7280", lineHeight: 1.7, margin: 0 }}>{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-band" style={{ background: "linear-gradient(135deg, #10B981 0%, #6366F1 100%)" }}>
        <div className="container center">
          <h2 className="cta-title">Join the movement</h2>
          <p className="cta-sub maxw-560 mx-auto">Whether you drive or you ship, NadaRuns was built for you.</p>
          <div className="cluster cluster-center">
            <Link href="/drivers" className="btn-on-dark">Drive with us <ArrowRight size={18} /></Link>
            <Link href="/business" className="btn-ghost-dark">Ship with us</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
