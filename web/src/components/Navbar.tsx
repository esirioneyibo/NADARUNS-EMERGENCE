"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useContent, LangToggle } from "@/lib/i18n";

export default function Navbar() {
  const pathname = usePathname();
  const c = useContent();
  const [isOpen, setIsOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsAdmin(!!localStorage.getItem("admin_token"));
    } catch {
      /* ignore */
    }
  }, [pathname]);

  if (pathname?.startsWith("/admin")) return null;

  return (
    <nav className="nav">
      <div className="nav-container">
        {/* Logo */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
          <div style={{
            width: '42px',
            height: '42px',
            background: 'linear-gradient(135deg, #10B981 0%, #6366F1 100%)',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '20px',
            fontWeight: 'bold'
          }}>
            ⚡
          </div>
          <span style={{ fontSize: '22px', fontWeight: '700', color: '#111827' }}>NadaRuns</span>
        </Link>

        {/* Desktop Navigation */}
        <div className="nav-links">
          <Link href="/" className="nav-link">{c.nav.home}</Link>
          <Link href="/about" className="nav-link">{c.nav.about}</Link>
          <Link href="/drivers" className="nav-link">{c.nav.drivers}</Link>
          <Link href="/business" className="nav-link">{c.nav.business}</Link>
          <Link href="/download" className="nav-link">{c.nav.download}</Link>
          <Link href="/contact" className="nav-link">{c.nav.contact}</Link>
        </div>

        {/* CTA Buttons */}
        <div className="nav-cta">
          <LangToggle />
          {isAdmin && (
            <Link href="/admin" className="btn-outline" data-testid="nav-admin-link" style={{ padding: '10px 20px', fontSize: '14px', borderColor: '#6366F1', color: '#6366F1' }}>
              {c.nav.admin}
            </Link>
          )}
          <Link href="/drivers" className="btn-outline" style={{ padding: '10px 20px', fontSize: '14px' }}>
            {c.nav.driveWithUs}
          </Link>
          <Link href="/download" className="btn-primary" style={{ padding: '10px 20px', fontSize: '14px' }}>
            {c.nav.getApp}
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="nav-mobile-btn"
          aria-label="Toggle menu"
        >
          {isOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '72px',
          left: 0,
          right: 0,
          background: 'white',
          padding: '24px',
          borderTop: '1px solid #E5E7EB',
          boxShadow: '0 10px 40px rgba(0,0,0,0.1)'
        }}>
          <div style={{ marginBottom: '16px' }}><LangToggle /></div>
          <Link href="/" className="nav-link" style={{ display: 'block', padding: '12px 0' }} onClick={() => setIsOpen(false)}>{c.nav.home}</Link>
          <Link href="/about" className="nav-link" style={{ display: 'block', padding: '12px 0' }} onClick={() => setIsOpen(false)}>{c.nav.about}</Link>
          <Link href="/drivers" className="nav-link" style={{ display: 'block', padding: '12px 0' }} onClick={() => setIsOpen(false)}>{c.nav.drivers}</Link>
          <Link href="/business" className="nav-link" style={{ display: 'block', padding: '12px 0' }} onClick={() => setIsOpen(false)}>{c.nav.business}</Link>
          <Link href="/download" className="nav-link" style={{ display: 'block', padding: '12px 0' }} onClick={() => setIsOpen(false)}>{c.nav.download}</Link>
          <Link href="/contact" className="nav-link" style={{ display: 'block', padding: '12px 0' }} onClick={() => setIsOpen(false)}>{c.nav.contact}</Link>
          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {isAdmin && (
              <Link href="/admin" className="btn-outline" style={{ justifyContent: 'center', borderColor: '#6366F1', color: '#6366F1' }} onClick={() => setIsOpen(false)}>{c.nav.admin}</Link>
            )}
            <Link href="/drivers" className="btn-outline" style={{ justifyContent: 'center' }} onClick={() => setIsOpen(false)}>{c.nav.driveWithUs}</Link>
            <Link href="/download" className="btn-primary" style={{ justifyContent: 'center' }} onClick={() => setIsOpen(false)}>{c.nav.getApp}</Link>
          </div>
        </div>
      )}
    </nav>
  );
}
