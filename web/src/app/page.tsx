"use client";

import Link from "next/link";
import AppDownloadSection from "@/components/AppDownloadSection";
import { useContent } from "@/lib/i18n";

export default function Home() {
  const c = useContent().home;
  return (
    <>
      <div style={{ paddingTop: '72px' }}>
      {/* Hero Section */}
      <section className="hero-gradient" style={{ padding: '80px 0 100px', position: 'relative', overflow: 'hidden' }}>
        {/* Background decorations */}
        <div style={{ position: 'absolute', top: '-100px', right: '-100px', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', bottom: '-100px', left: '-100px', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 70%)', borderRadius: '50%' }} />
        
        <div className="container">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '80px', alignItems: 'center' }} className="hero-grid">
            <div>
              <div className="badge badge-green" style={{ marginBottom: '24px' }}>
                {c.heroBadge}
              </div>
              <h1 style={{ fontSize: 'clamp(34px, 8vw, 56px)', fontWeight: '800', lineHeight: 1.1, marginBottom: '24px', color: '#111827' }}>
                {c.heroTitle1}<br/>
                <span className="gradient-text">{c.heroTitle2}</span> {c.heroTitle3}<br/>
                {c.heroTitle4}
              </h1>
              <p style={{ fontSize: 'clamp(16px, 4vw, 20px)', color: '#6B7280', lineHeight: 1.7, marginBottom: '40px', maxWidth: '500px' }}>
                {c.heroSub}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '60px' }}>
                <Link href="/drivers" className="btn-primary">
                  {c.becomeDriver}
                </Link>
                <Link href="/business" className="btn-secondary">
                  {c.shipWithUs}
                </Link>
              </div>
              
              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'clamp(12px, 4vw, 32px)', borderTop: '1px solid #E5E7EB', paddingTop: '32px' }}>
                <div>
                  <div className="stat-number">10K+</div>
                  <div className="stat-label">{c.statDrivers}</div>
                </div>
                <div>
                  <div className="stat-number">500K+</div>
                  <div className="stat-label">{c.statDeliveries}</div>
                </div>
                <div>
                  <div className="stat-number">4.9★</div>
                  <div className="stat-label">{c.statRating}</div>
                </div>
              </div>
            </div>
            
            {/* Hero Visual */}
            <div style={{ position: 'relative' }} className="hero-visual">
              <div className="float-animation" style={{
                background: 'linear-gradient(135deg, #10B981 0%, #6366F1 100%)',
                borderRadius: '32px',
                padding: '32px',
                boxShadow: '0 40px 80px -20px rgba(16,185,129,0.3)'
              }}>
                {/* Order Card */}
                <div style={{
                  background: 'white',
                  borderRadius: '20px',
                  padding: '24px',
                  marginBottom: '16px',
                  boxShadow: '0 10px 40px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                    <div style={{ width: '48px', height: '48px', background: '#D1FAE5', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                      📦
                    </div>
                    <div>
                      <div style={{ fontWeight: '700', color: '#111827' }}>{c.orderId}</div>
                      <div style={{ fontSize: '14px', color: '#10B981', fontWeight: '500' }}>{c.inTransit}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#6B7280' }}>
                    <span>📍</span>
                    <span>{c.route}</span>
                  </div>
                </div>
                
                {/* Driver Card */}
                <div style={{
                  background: 'rgba(255,255,255,0.15)',
                  backdropFilter: 'blur(10px)',
                  borderRadius: '16px',
                  padding: '20px',
                  color: 'white'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '44px', height: '44px', background: 'rgba(255,255,255,0.2)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
                      🚴
                    </div>
                    <div>
                      <div style={{ fontWeight: '600' }}>{c.delivering}</div>
                      <div style={{ fontSize: '14px', opacity: 0.8 }}>{c.arriving}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="section" style={{ background: 'white' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <h2 className="section-title">{c.whyTitle}</h2>
            <p className="section-subtitle">
              {c.whySub}
            </p>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px' }} className="features-grid">
            {[
              { icon: '⚡', color: 'green' },
              { icon: '🛡️', color: 'purple' },
              { icon: '⭐', color: 'amber' },
              { icon: '💬', color: 'rose' },
            ].map((feature, i) => (
              <div key={i} className="feature-card">
                <div className={`feature-icon feature-icon-${feature.color}`}>
                  <span style={{ fontSize: '28px' }}>{feature.icon}</span>
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '12px', color: '#111827' }}>{c.features[i].title}</h3>
                <p style={{ color: '#6B7280', lineHeight: 1.6 }}>{c.features[i].desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="section" style={{ background: '#F9FAFB' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <h2 className="section-title">{c.howTitle}</h2>
            <p className="section-subtitle">
              {c.howSub}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }} className="howitworks-grid">
            {/* For Drivers */}
            <div className="card" style={{ background: 'linear-gradient(135deg, #F0FDF4 0%, white 100%)' }}>
              <div className="badge badge-green" style={{ marginBottom: '24px' }}>
                {c.forDrivers}
              </div>
              <h3 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '32px', color: '#111827' }}>{c.driverHead}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {c.driverSteps.map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                    <div style={{ width: '40px', height: '40px', background: '#10B981', color: 'white', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <div>
                      <div style={{ fontWeight: '600', color: '#111827', marginBottom: '4px' }}>{item.title}</div>
                      <div style={{ color: '#6B7280', fontSize: '14px' }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/drivers" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '32px', color: '#10B981', fontWeight: '600', textDecoration: 'none' }}>
                {c.learnMore}
              </Link>
            </div>

            {/* For Business */}
            <div className="card" style={{ background: 'linear-gradient(135deg, #EEF2FF 0%, white 100%)' }}>
              <div className="badge badge-purple" style={{ marginBottom: '24px' }}>
                {c.forBusiness}
              </div>
              <h3 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '32px', color: '#111827' }}>{c.bizHead}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {c.bizSteps.map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                    <div style={{ width: '40px', height: '40px', background: '#6366F1', color: 'white', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <div>
                      <div style={{ fontWeight: '600', color: '#111827', marginBottom: '4px' }}>{item.title}</div>
                      <div style={{ color: '#6B7280', fontSize: '14px' }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/business" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '32px', color: '#6366F1', fontWeight: '600', textDecoration: 'none' }}>
                {c.learnMore}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="section" style={{ background: 'white' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <h2 className="section-title">{c.lovedTitle}</h2>
            <p className="section-subtitle">
              {c.lovedSub}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }} className="testimonials-grid">
            {c.testimonials.map((testimonial, i) => (
              <div key={i} className="testimonial-card">
                <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
                  {[...Array(5)].map((_, j) => (
                    <span key={j} style={{ color: '#F59E0B', fontSize: '18px' }}>★</span>
                  ))}
                </div>
                <p style={{ color: '#374151', lineHeight: 1.7, marginBottom: '24px', position: 'relative', zIndex: 1 }}>
                  &ldquo;{testimonial.text}&rdquo;
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '44px', height: '44px', background: 'linear-gradient(135deg, #10B981 0%, #6366F1 100%)', borderRadius: '12px' }} />
                  <div>
                    <div style={{ fontWeight: '600', color: '#111827' }}>{testimonial.name}</div>
                    <div style={{ fontSize: '14px', color: '#6B7280' }}>{testimonial.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* App Download Band */}
      <AppDownloadSection />

      {/* CTA Section */}
      <section style={{ padding: '100px 0', background: 'linear-gradient(135deg, #10B981 0%, #6366F1 100%)', position: 'relative', overflow: 'hidden' }}>
        {/* Decorations */}
        <div style={{ position: 'absolute', top: '0', left: '0', right: '0', bottom: '0', background: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.05\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />
        
        <div className="container" style={{ position: 'relative', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(30px, 7vw, 44px)', fontWeight: '800', color: 'white', marginBottom: '20px' }}>
            {c.ctaTitle}
          </h2>
          <p style={{ fontSize: 'clamp(16px, 4vw, 20px)', color: 'rgba(255,255,255,0.8)', marginBottom: '40px', maxWidth: '500px', margin: '0 auto 40px' }}>
            {c.ctaSub}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'center' }}>
            <Link href="/drivers" style={{
              background: 'white',
              color: '#10B981',
              padding: '16px 32px',
              borderRadius: '12px',
              fontWeight: '600',
              fontSize: '16px',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.3s',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
            }}>
              {c.startDriving}
            </Link>
            <Link href="/business" style={{
              background: 'rgba(255,255,255,0.15)',
              color: 'white',
              padding: '16px 32px',
              borderRadius: '12px',
              fontWeight: '600',
              fontSize: '16px',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              border: '2px solid rgba(255,255,255,0.3)',
              backdropFilter: 'blur(10px)'
            }}>
              {c.shipProducts}
            </Link>
          </div>
        </div>
      </section>
    </div>
    </>
  );
}
