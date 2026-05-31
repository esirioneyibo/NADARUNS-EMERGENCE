"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from "react";
import { LayoutDashboard, Truck, Users, Package, Car, ShieldCheck, LogOut } from "lucide-react";
import { adminApi, setToken, clearToken, hasToken } from "@/lib/adminApi";
import Overview from "@/components/admin/Overview";
import Drivers from "@/components/admin/Drivers";
import Shippers from "@/components/admin/Shippers";
import Orders from "@/components/admin/Orders";
import Vehicles from "@/components/admin/Vehicles";
import Kyc from "@/components/admin/Kyc";

type Section = "overview" | "drivers" | "shippers" | "orders" | "vehicles" | "kyc";

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState<Section>("overview");
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [pendingKyc, setPendingKyc] = useState(0);

  useEffect(() => { setAuthed(hasToken()); setReady(true); }, []);

  const notify = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2600);
  };

  useEffect(() => {
    if (authed) adminApi.overview().then((d) => setPendingKyc(d?.kpis?.pending_kyc || 0)).catch(() => {});
  }, [authed, section]);

  if (!ready) return null;
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const nav: { key: Section; label: string; icon: any; count?: number }[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "drivers", label: "Drivers", icon: Truck },
    { key: "shippers", label: "Shippers", icon: Users },
    { key: "orders", label: "Orders", icon: Package },
    { key: "vehicles", label: "Vehicles", icon: Car },
    { key: "kyc", label: "KYC", icon: ShieldCheck, count: pendingKyc || undefined },
  ];
  const titles: Record<Section, string> = {
    overview: "Dashboard overview", drivers: "Drivers", shippers: "Shippers",
    orders: "Orders & deliveries", vehicles: "Fleet & vehicles", kyc: "KYC verification",
  };
  const logout = () => { clearToken(); setAuthed(false); };

  return (
    <div className="adm-root">
      <div className="adm-shell">
        <aside className="adm-side">
          <div className="adm-side-brand">
            <div className="adm-side-logo"><Truck size={18} color="#fff" /></div>
            <div><div style={{ color: "#fff", fontWeight: 800, fontSize: 16 }}>NadaRuns</div><div style={{ color: "#64748B", fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>ADMIN</div></div>
          </div>
          <nav className="adm-nav">
            {nav.map((n) => (
              <button key={n.key} data-testid={`admin-nav-${n.key}`} className={`adm-navbtn ${section === n.key ? "active" : ""}`} onClick={() => setSection(n.key)}>
                <n.icon size={18} /> {n.label}
                {n.count ? <span className="count">{n.count}</span> : null}
              </button>
            ))}
          </nav>
          <div className="adm-side-foot">
            <button className="adm-navbtn" data-testid="admin-logout" onClick={logout}><LogOut size={18} /> Sign out</button>
          </div>
        </aside>
        <main className="adm-main">
          <div className="adm-topbar">
            <div className="adm-h" style={{ fontSize: 18 }}>{titles[section]}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, color: "#64748B" }}>admin@nadaruns.com</span>
              <div className="adm-avatar" style={{ width: 34, height: 34 }}>A</div>
            </div>
          </div>
          <div className="adm-content">
            {section === "overview" && <Overview />}
            {section === "drivers" && <Drivers notify={notify} />}
            {section === "shippers" && <Shippers notify={notify} />}
            {section === "orders" && <Orders notify={notify} />}
            {section === "vehicles" && <Vehicles />}
            {section === "kyc" && <Kyc notify={notify} />}
          </div>
        </main>
      </div>
      {toast && <div className={`adm-toast ${toast.type === "err" ? "adm-toast-err" : "adm-toast-ok"}`}>{toast.msg}</div>}
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("admin@nadaruns.com");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setLoading(true);
    try { const r = await adminApi.login(email.trim(), password); setToken(r.token); onLogin(); }
    catch (e: any) { setErr(e.message || "Login failed"); }
    finally { setLoading(false); }
  };
  return (
    <div className="adm-login-wrap">
      <form className="adm-login-card" onSubmit={submit}>
        <div className="adm-login-logo"><Truck size={26} color="#fff" /></div>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 6 }}>Admin sign in</h1>
        <p style={{ color: "#64748B", fontSize: 14, marginBottom: 24 }}>NadaRuns control center</p>
        <div className="adm-field" style={{ marginBottom: 14 }}>
          <label>Email</label>
          <input className="adm-input" data-testid="admin-login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="adm-field" style={{ marginBottom: 20 }}>
          <label>Password</label>
          <input className="adm-input" data-testid="admin-login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" required />
        </div>
        {err && <div style={{ color: "#DC2626", fontSize: 13, marginBottom: 14, fontWeight: 600 }}>{err}</div>}
        <button className="adm-btn adm-btn-primary" data-testid="admin-login-submit" type="submit" style={{ width: "100%", justifyContent: "center" }} disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
