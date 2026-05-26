"use client";

import Link from "next/link";
import { useState } from "react";

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

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
          <Link href="/contact" className="nav-link">Contact</Link>
        </div>

        {/* CTA Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link href="/drivers" className="btn-outline" style={{ padding: '10px 20px', fontSize: '14px' }}>
            Drive with us
          </Link>
          <Link href="/business" className="btn-secondary" style={{ padding: '10px 20px', fontSize: '14px' }}>
            Ship Now
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            display: 'none',
            background: 'none',
            border: 'none',
            fontSize: '24px',
            cursor: 'pointer'
          }}
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
          <Link href="/" className="nav-link" style={{ display: 'block', padding: '12px 0' }}>Home</Link>
          <Link href="/about" className="nav-link" style={{ display: 'block', padding: '12px 0' }}>About</Link>
          <Link href="/drivers" className="nav-link" style={{ display: 'block', padding: '12px 0' }}>For Drivers</Link>
          <Link href="/business" className="nav-link" style={{ display: 'block', padding: '12px 0' }}>For Business</Link>
          <Link href="/contact" className="nav-link" style={{ display: 'block', padding: '12px 0' }}>Contact</Link>
          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Link href="/drivers" className="btn-primary" style={{ justifyContent: 'center' }}>Drive with us</Link>
            <Link href="/business" className="btn-secondary" style={{ justifyContent: 'center' }}>Ship Now</Link>
          </div>
        </div>
      )}
    </nav>
  );
}
