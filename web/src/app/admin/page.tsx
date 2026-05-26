"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface DashboardStats {
  total_drivers: number;
  active_drivers: number;
  total_shippers: number;
  total_orders: number;
  pending_orders: number;
  completed_orders: number;
  total_revenue: number;
  pending_kyc: number;
}

interface KYCApplication {
  driver_id: string;
  driver_name: string;
  email: string;
  phone: string;
  submitted_at: string;
  overall_status: string;
}

interface Driver {
  id: string;
  name: string;
  email: string;
  is_online: boolean;
  rating: number;
  deliveries_today: number;
}

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [kycApplications, setKycApplications] = useState<KYCApplication[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboardData = useCallback(async () => {
    try {
      setRefreshing(true);
      const [statsRes, kycRes, driversRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/stats`),
        fetch(`${API_BASE}/api/admin/kyc-applications`),
        fetch(`${API_BASE}/api/admin/drivers`),
      ]);
      
      if (statsRes.ok) setStats(await statsRes.json());
      if (kycRes.ok) setKycApplications(await kycRes.json());
      if (driversRes.ok) setDrivers(await driversRes.json());
    } catch (err) {
      console.error("Failed to fetch dashboard data", err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchDashboardData();
    }
  }, [isAuthenticated, fetchDashboardData]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    
    try {
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      
      if (res.ok) {
        setIsAuthenticated(true);
      } else {
        setError("Invalid credentials");
      }
    } catch (err) {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKYCAction = async (driverId: string, action: "approve" | "reject") => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/kyc/${driverId}/${action}`, {
        method: "POST",
      });
      if (res.ok) {
        fetchDashboardData();
      }
    } catch (err) {
      console.error("KYC action failed", err);
    }
  };

  // Login Screen
  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #1F2937 0%, #111827 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ background: 'white', borderRadius: '24px', padding: '48px', maxWidth: '420px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ width: '64px', height: '64px', background: 'linear-gradient(135deg, #10B981 0%, #6366F1 100%)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '28px' }}>
              ⚡
            </div>
            <h1 style={{ fontSize: '28px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>Admin Dashboard</h1>
            <p style={{ color: '#6B7280' }}>Sign in to manage NadaRuns</p>
          </div>
          
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@nadaruns.com"
                required
                style={{ width: '100%', padding: '14px 16px', borderRadius: '12px', border: '2px solid #E5E7EB', fontSize: '16px', outline: 'none', transition: 'border-color 0.2s' }}
              />
            </div>
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{ width: '100%', padding: '14px 16px', borderRadius: '12px', border: '2px solid #E5E7EB', fontSize: '16px', outline: 'none', transition: 'border-color 0.2s' }}
              />
            </div>
            
            {error && (
              <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '12px 16px', borderRadius: '12px', marginBottom: '20px', fontSize: '14px' }}>
                {error}
              </div>
            )}
            
            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', padding: '16px', background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)', color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          
          <div style={{ marginTop: '24px', textAlign: 'center' }}>
            <Link href="/" style={{ color: '#6366F1', textDecoration: 'none', fontSize: '14px' }}>
              ← Back to Website
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard
  return (
    <div style={{ minHeight: '100vh', background: '#F3F4F6' }}>
      {/* Header */}
      <header style={{ background: 'white', borderBottom: '1px solid #E5E7EB', padding: '16px 24px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', background: 'linear-gradient(135deg, #10B981 0%, #6366F1 100%)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
              ⚡
            </div>
            <span style={{ fontSize: '20px', fontWeight: '700', color: '#111827' }}>NadaRuns Admin</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              onClick={fetchDashboardData}
              disabled={refreshing}
              style={{ padding: '10px 16px', background: '#F3F4F6', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
            >
              {refreshing ? '🔄 Refreshing...' : '🔄 Refresh'}
            </button>
            <button
              onClick={() => setIsAuthenticated(false)}
              style={{ padding: '10px 16px', background: '#FEE2E2', color: '#DC2626', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          {['overview', 'kyc', 'drivers'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 24px',
                borderRadius: '10px',
                border: 'none',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                background: activeTab === tab ? '#111827' : 'white',
                color: activeTab === tab ? 'white' : '#6B7280',
                textTransform: 'capitalize'
              }}
            >
              {tab === 'kyc' ? 'KYC Applications' : tab}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && stats && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' }}>
              {[
                { label: 'Total Drivers', value: stats.total_drivers, icon: '🚗', color: '#10B981' },
                { label: 'Active Now', value: stats.active_drivers, icon: '🟢', color: '#059669' },
                { label: 'Total Orders', value: stats.total_orders, icon: '📦', color: '#6366F1' },
                { label: 'Pending KYC', value: stats.pending_kyc, icon: '📋', color: '#F59E0B' },
              ].map((stat, i) => (
                <div key={i} style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <span style={{ fontSize: '14px', color: '#6B7280' }}>{stat.label}</span>
                    <span style={{ fontSize: '24px' }}>{stat.icon}</span>
                  </div>
                  <div style={{ fontSize: '36px', fontWeight: '700', color: stat.color }}>{stat.value}</div>
                </div>
              ))}
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Revenue Overview</h3>
                <div style={{ fontSize: '32px', fontWeight: '700', color: '#10B981' }}>€{stats.total_revenue.toLocaleString()}</div>
                <p style={{ color: '#6B7280', marginTop: '8px' }}>Total platform revenue</p>
              </div>
              <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Order Status</h3>
                <div style={{ display: 'flex', gap: '24px' }}>
                  <div>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#F59E0B' }}>{stats.pending_orders}</div>
                    <div style={{ fontSize: '14px', color: '#6B7280' }}>Pending</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#10B981' }}>{stats.completed_orders}</div>
                    <div style={{ fontSize: '14px', color: '#6B7280' }}>Completed</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* KYC Tab */}
        {activeTab === 'kyc' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px' }}>KYC Applications ({kycApplications.length})</h3>
            {kycApplications.length === 0 ? (
              <p style={{ color: '#6B7280', textAlign: 'center', padding: '40px' }}>No pending KYC applications</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {kycApplications.map((app) => (
                  <div key={app.driver_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: '#F9FAFB', borderRadius: '12px' }}>
                    <div>
                      <div style={{ fontWeight: '600', color: '#111827' }}>{app.driver_name}</div>
                      <div style={{ fontSize: '14px', color: '#6B7280' }}>{app.email} • {app.phone}</div>
                      <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>Submitted: {new Date(app.submitted_at).toLocaleDateString()}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleKYCAction(app.driver_id, 'approve')}
                        style={{ padding: '8px 16px', background: '#10B981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
                      >
                        ✓ Approve
                      </button>
                      <button
                        onClick={() => handleKYCAction(app.driver_id, 'reject')}
                        style={{ padding: '8px 16px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
                      >
                        ✕ Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Drivers Tab */}
        {activeTab === 'drivers' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px' }}>All Drivers ({drivers.length})</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                    <th style={{ textAlign: 'left', padding: '12px', fontSize: '14px', fontWeight: '600', color: '#6B7280' }}>Driver</th>
                    <th style={{ textAlign: 'left', padding: '12px', fontSize: '14px', fontWeight: '600', color: '#6B7280' }}>Email</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600', color: '#6B7280' }}>Status</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600', color: '#6B7280' }}>Rating</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600', color: '#6B7280' }}>Today</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((driver) => (
                    <tr key={driver.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '16px 12px' }}>
                        <div style={{ fontWeight: '500', color: '#111827' }}>{driver.name}</div>
                      </td>
                      <td style={{ padding: '16px 12px', color: '#6B7280' }}>{driver.email}</td>
                      <td style={{ padding: '16px 12px', textAlign: 'center' }}>
                        <span style={{ padding: '4px 12px', borderRadius: '100px', fontSize: '13px', fontWeight: '500', background: driver.is_online ? '#D1FAE5' : '#F3F4F6', color: driver.is_online ? '#065F46' : '#6B7280' }}>
                          {driver.is_online ? '● Online' : '○ Offline'}
                        </span>
                      </td>
                      <td style={{ padding: '16px 12px', textAlign: 'center', color: '#F59E0B', fontWeight: '600' }}>⭐ {driver.rating.toFixed(1)}</td>
                      <td style={{ padding: '16px 12px', textAlign: 'center', fontWeight: '600', color: '#111827' }}>{driver.deliveries_today}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
