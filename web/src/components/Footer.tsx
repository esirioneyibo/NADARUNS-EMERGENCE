"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { site } from "@/lib/site";
import { useContent } from "@/lib/i18n";

export default function Footer() {
  const pathname = usePathname();
  const c = useContent();
  if (pathname?.startsWith("/admin")) return null;
  const socials: { label: string; href: string }[] = [
    { label: "f", href: site.social.facebook },
    { label: "X", href: site.social.twitter },
    { label: "in", href: site.social.linkedin },
    { label: "ig", href: site.social.instagram },
  ];
  return (
    <footer className="footer">
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '48px', marginBottom: '60px' }}>
          {/* Brand */}
          <div>
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', marginBottom: '20px' }}>
              <div style={{
                width: '42px',
                height: '42px',
                background: 'linear-gradient(135deg, #10B981 0%, #6366F1 100%)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '20px'
              }}>
                ⚡
              </div>
              <span style={{ fontSize: '22px', fontWeight: '700', color: 'white' }}>NadaRuns</span>
            </Link>
            <p style={{ color: '#9CA3AF', lineHeight: 1.7, marginBottom: '24px' }}>
              {c.footer.tagline}
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              {socials.map((s, i) => (
                <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label} style={{
                  width: '40px',
                  height: '40px',
                  background: '#374151',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#9CA3AF',
                  textDecoration: 'none',
                  fontSize: '14px',
                  fontWeight: '600',
                  transition: 'all 0.2s'
                }}>
                  {s.label}
                </a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="footer-title">{c.footer.company}</h3>
            <Link href="/about" className="footer-link">{c.footer.about}</Link>
            <Link href="/drivers" className="footer-link">{c.footer.careers}</Link>
            <Link href="#" className="footer-link">{c.footer.blog}</Link>
            <Link href="/contact" className="footer-link">{c.footer.press}</Link>
          </div>

          {/* Products */}
          <div>
            <h3 className="footer-title">{c.footer.products}</h3>
            <Link href="/drivers" className="footer-link">{c.footer.driveWith}</Link>
            <Link href="/business" className="footer-link">{c.footer.forBusiness}</Link>
            <Link href="/download" className="footer-link">{c.footer.downloadApp}</Link>
            <Link href="/contact" className="footer-link">{c.footer.enterprise}</Link>
          </div>

          {/* Legal */}
          <div>
            <h3 className="footer-title">{c.footer.legal}</h3>
            <Link href="/terms" className="footer-link">{c.footer.terms}</Link>
            <Link href="/privacy" className="footer-link">{c.footer.privacy}</Link>
            <Link href="/cookies" className="footer-link">{c.footer.cookies}</Link>
            <Link href="/gdpr" className="footer-link">{c.footer.gdpr}</Link>
          </div>

          {/* Contact */}
          <div>
            <h3 className="footer-title">{c.footer.contact}</h3>
            <p style={{ color: '#9CA3AF', marginBottom: '12px' }}>
              📍 {site.contact.address.line1}, {site.contact.address.line2}
            </p>
            <a href={`mailto:${site.contact.email}`} className="footer-link">✉️ {site.contact.email}</a>
            <a href={site.contact.phoneHref} className="footer-link">📞 {site.contact.phone}</a>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #374151', paddingTop: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <p style={{ color: '#6B7280', fontSize: '14px' }}>
            © {new Date().getFullYear()} NadaRuns. {c.footer.rights}
          </p>
          <div style={{ display: 'flex', gap: '24px' }}>
            <a href="#" style={{ color: '#6B7280', fontSize: '14px', textDecoration: 'none' }}>{c.footer.sitemap}</a>
            <a href="#" style={{ color: '#6B7280', fontSize: '14px', textDecoration: 'none' }}>{c.footer.accessibility}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
