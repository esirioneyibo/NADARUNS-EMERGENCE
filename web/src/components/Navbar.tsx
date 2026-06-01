"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

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
          <Link href="/" className="nav-link">Home</Link>
          <Link href="/about" className="nav-link">About</Link>
          <Link href="/drivers" className="nav-link">For Drivers</Link>
          <Link href="/business" className="nav-link">For Business</Link>
          <Link href="/download" className="nav-link">Download</Link>
          <Link href="/contact" className="nav-link">Contact</Link>
        </div>

        {/* CTA Buttons */}
        <div className="nav-cta">
          <Link href="/drivers" className="btn-outline" style={{ padding: '10px 20px', fontSize: '14px' }}>
            Drive with us
          </Link>
          <Link href="/download" className="btn-primary" style={{ padding: '10px 20px', fontSize: '14px' }}>
            Get the app
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
          <Link href="/" className="nav-link" style={{ display: 'block', padding: '12px 0' }} onClick={() => setIsOpen(false)}>Home</Link>
          <Link href="/about" className="nav-link" style={{ display: 'block', padding: '12px 0' }} onClick={() => setIsOpen(false)}>About</Link>
          <Link href="/drivers" className="nav-link" style={{ display: 'block', padding: '12px 0' }} onClick={() => setIsOpen(false)}>For Drivers</Link>
          <Link href="/business" className="nav-link" style={{ display: 'block', padding: '12px 0' }} onClick={() => setIsOpen(false)}>For Business</Link>
          <Link href="/download" className="nav-link" style={{ display: 'block', padding: '12px 0' }} onClick={() => setIsOpen(false)}>Download</Link>
          <Link href="/contact" className="nav-link" style={{ display: 'block', padding: '12px 0' }} onClick={() => setIsOpen(false)}>Contact</Link>
          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Link href="/drivers" className="btn-outline" style={{ justifyContent: 'center' }} onClick={() => setIsOpen(false)}>Drive with us</Link>
            <Link href="/download" className="btn-primary" style={{ justifyContent: 'center' }} onClick={() => setIsOpen(false)}>Get the app</Link>
          </div>
        </div>
      )}
    </nav>
  );
}
