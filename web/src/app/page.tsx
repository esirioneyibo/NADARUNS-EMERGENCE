import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <div style={{ paddingTop: '72px' }}>
      {/* Hero Section */}
      <section className="hero-gradient" style={{ padding: '80px 0 100px', position: 'relative', overflow: 'hidden' }}>
        {/* Background decorations */}
        <div style={{ position: 'absolute', top: '-100px', right: '-100px', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', bottom: '-100px', left: '-100px', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 70%)', borderRadius: '50%' }} />
        
        <div className="container">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '80px', alignItems: 'center' }}>
            <div>
              <div className="badge badge-green" style={{ marginBottom: '24px' }}>
                ⚡ #1 Delivery Platform in Finland
              </div>
              <h1 style={{ fontSize: '56px', fontWeight: '800', lineHeight: 1.1, marginBottom: '24px', color: '#111827' }}>
                Fast & Reliable<br/>
                <span className="gradient-text">Delivery</span> For<br/>
                Everyone
              </h1>
              <p style={{ fontSize: '20px', color: '#6B7280', lineHeight: 1.7, marginBottom: '40px', maxWidth: '500px' }}>
                Connect with professional drivers for quick deliveries or join our fleet to earn money on your own schedule.
              </p>
              <div style={{ display: 'flex', gap: '16px', marginBottom: '60px' }}>
                <Link href="/drivers" className="btn-primary">
                  🚴 Become a Driver
                </Link>
                <Link href="/business" className="btn-secondary">
                  🏢 Ship with Us
                </Link>
              </div>
              
              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '32px', borderTop: '1px solid #E5E7EB', paddingTop: '32px' }}>
                <div>
                  <div className="stat-number">10K+</div>
                  <div className="stat-label">Active Drivers</div>
                </div>
                <div>
                  <div className="stat-number">500K+</div>
                  <div className="stat-label">Deliveries</div>
                </div>
                <div>
                  <div className="stat-number">4.9★</div>
                  <div className="stat-label">App Rating</div>
                </div>
              </div>
            </div>
            
            {/* Hero Visual */}
            <div style={{ position: 'relative' }}>
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
                      <div style={{ fontWeight: '700', color: '#111827' }}>Order #A249K</div>
                      <div style={{ fontSize: '14px', color: '#10B981', fontWeight: '500' }}>● In transit</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#6B7280' }}>
                    <span>📍</span>
                    <span>Karl Fazer Café → Mannerheimintie 15</span>
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
                      <div style={{ fontWeight: '600' }}>Eero V. is delivering</div>
                      <div style={{ fontSize: '14px', opacity: 0.8 }}>Arriving in 8 mins</div>
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
            <h2 className="section-title">Why Choose NadaRuns?</h2>
            <p className="section-subtitle">
              We're revolutionizing delivery with technology, reliability, and care.
            </p>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px' }}>
            {[
              { icon: '⚡', title: 'Fast Delivery', desc: 'Average delivery time under 30 minutes', color: 'green' },
              { icon: '🛡️', title: 'Secure & Insured', desc: 'All deliveries are tracked and insured', color: 'purple' },
              { icon: '⭐', title: 'Top Rated', desc: '4.9 star rating from 100K+ reviews', color: 'amber' },
              { icon: '💬', title: '24/7 Support', desc: 'Round-the-clock customer support', color: 'rose' },
            ].map((feature, i) => (
              <div key={i} className="feature-card">
                <div className={`feature-icon feature-icon-${feature.color}`}>
                  <span style={{ fontSize: '28px' }}>{feature.icon}</span>
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '12px', color: '#111827' }}>{feature.title}</h3>
                <p style={{ color: '#6B7280', lineHeight: 1.6 }}>{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="section" style={{ background: '#F9FAFB' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <h2 className="section-title">How It Works</h2>
            <p className="section-subtitle">
              Getting started is easy, whether you're a driver or a business.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
            {/* For Drivers */}
            <div className="card" style={{ background: 'linear-gradient(135deg, #F0FDF4 0%, white 100%)' }}>
              <div className="badge badge-green" style={{ marginBottom: '24px' }}>
                🚴 For Drivers
              </div>
              <h3 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '32px', color: '#111827' }}>Start earning today</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {[
                  { step: '1', title: 'Sign Up', desc: 'Download the app and create your account' },
                  { step: '2', title: 'Get Verified', desc: 'Complete KYC verification in minutes' },
                  { step: '3', title: 'Start Delivering', desc: 'Accept orders and earn money' },
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                    <div style={{ width: '40px', height: '40px', background: '#10B981', color: 'white', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                      {item.step}
                    </div>
                    <div>
                      <div style={{ fontWeight: '600', color: '#111827', marginBottom: '4px' }}>{item.title}</div>
                      <div style={{ color: '#6B7280', fontSize: '14px' }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/drivers" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '32px', color: '#10B981', fontWeight: '600', textDecoration: 'none' }}>
                Learn more →
              </Link>
            </div>

            {/* For Business */}
            <div className="card" style={{ background: 'linear-gradient(135deg, #EEF2FF 0%, white 100%)' }}>
              <div className="badge badge-purple" style={{ marginBottom: '24px' }}>
                🏢 For Business
              </div>
              <h3 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '32px', color: '#111827' }}>Ship with confidence</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {[
                  { step: '1', title: 'Create Account', desc: 'Register your business in minutes' },
                  { step: '2', title: 'Book Delivery', desc: 'Enter pickup and delivery details' },
                  { step: '3', title: 'Track & Receive', desc: 'Monitor in real-time until delivery' },
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                    <div style={{ width: '40px', height: '40px', background: '#6366F1', color: 'white', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                      {item.step}
                    </div>
                    <div>
                      <div style={{ fontWeight: '600', color: '#111827', marginBottom: '4px' }}>{item.title}</div>
                      <div style={{ color: '#6B7280', fontSize: '14px' }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/business" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '32px', color: '#6366F1', fontWeight: '600', textDecoration: 'none' }}>
                Learn more →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="section" style={{ background: 'white' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <h2 className="section-title">Loved by Thousands</h2>
            <p className="section-subtitle">
              See what our drivers and customers are saying.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
            {[
              { name: 'Mikko L.', role: 'Driver', text: 'Best platform for flexible work. I earn well and manage my own schedule. The app is super easy to use!' },
              { name: 'Sanna R.', role: 'Business Owner', text: 'NadaRuns has transformed our delivery operations. Fast, reliable, and their support team is amazing.' },
              { name: 'Aino K.', role: 'Customer', text: 'Always get my orders on time. The tracking feature is amazing - I can see exactly where my package is.' },
            ].map((testimonial, i) => (
              <div key={i} className="testimonial-card">
                <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
                  {[...Array(5)].map((_, j) => (
                    <span key={j} style={{ color: '#F59E0B', fontSize: '18px' }}>★</span>
                  ))}
                </div>
                <p style={{ color: '#374151', lineHeight: 1.7, marginBottom: '24px', position: 'relative', zIndex: 1 }}>
                  "{testimonial.text}"
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

      {/* CTA Section */}
      <section style={{ padding: '100px 0', background: 'linear-gradient(135deg, #10B981 0%, #6366F1 100%)', position: 'relative', overflow: 'hidden' }}>
        {/* Decorations */}
        <div style={{ position: 'absolute', top: '0', left: '0', right: '0', bottom: '0', background: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.05\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />
        
        <div className="container" style={{ position: 'relative', textAlign: 'center' }}>
          <h2 style={{ fontSize: '44px', fontWeight: '800', color: 'white', marginBottom: '20px' }}>
            Ready to Get Started?
          </h2>
          <p style={{ fontSize: '20px', color: 'rgba(255,255,255,0.8)', marginBottom: '40px', maxWidth: '500px', margin: '0 auto 40px' }}>
            Join thousands of drivers and businesses already using NadaRuns.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
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
              🚴 Start Driving
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
              🏢 Ship Products
            </Link>
          </div>
        </div>
      </section>
    </div>
    <Footer />
    </>
  );
}
