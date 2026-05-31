"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */
import React, { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { Spinner, StatusBadge, Avatar, EmptyState } from "./ui";

type Notify = (msg: string, type?: "ok" | "err") => void;

export default function Kyc({ notify }: { notify: Notify }) {
  const [apps, setApps] = useState<any[] | null>(null);
  const load = useCallback(() => { adminApi.kyc().then(setApps).catch((e) => notify(e.message, "err")); }, [notify]);
  useEffect(() => { load(); }, [load]);
  const approve = async (id: string) => { try { await adminApi.kycApprove(id); notify("KYC approved"); load(); } catch (e: any) { notify(e.message, "err"); } };
  const reject = async (id: string) => { try { await adminApi.kycReject(id, "Documents not clear"); notify("KYC rejected"); load(); } catch (e: any) { notify(e.message, "err"); } };
  if (!apps) return <Spinner />;
  const pending = apps.filter((a) => a.kyc_status?.overall_status === "pending");
  const others = apps.filter((a) => a.kyc_status?.overall_status !== "pending");
  const Card = (a: any) => {
    const d = a.driver || {};
    const docs = a.documents || {};
    const st = a.kyc_status?.overall_status;
    return (
      <div className="adm-card" key={d.id} style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <Avatar src={d.avatar} name={d.name} size={44} />
          <div style={{ flex: 1 }}><div style={{ fontWeight: 800 }}>{d.name || "Unknown"}</div><div style={{ fontSize: 13, color: "#94A3B8" }}>{d.email}</div></div>
          <StatusBadge status={st} />
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          {Object.entries(docs).map(([key, v]: any) => (
            <div key={key} style={{ textAlign: "center" }}>
              <img src={v.image_data} alt={key} style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 10, border: "1px solid #E2E8F0", background: "#F1F5F9" }} />
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 4, textTransform: "capitalize" }}>{key.replace(/_/g, " ")}</div>
            </div>
          ))}
          {Object.keys(docs).length === 0 && <div style={{ fontSize: 13, color: "#94A3B8" }}>No documents uploaded</div>}
        </div>
        {st === "pending" && <div style={{ display: "flex", gap: 10 }}>
          <button data-testid={`kyc-approve-${d.id}`} className="adm-btn adm-btn-success" onClick={() => approve(d.id)} style={{ flex: 1, justifyContent: "center" }}>Approve</button>
          <button data-testid={`kyc-reject-${d.id}`} className="adm-btn adm-btn-danger" onClick={() => reject(d.id)} style={{ flex: 1, justifyContent: "center" }}>Reject</button>
        </div>}
      </div>
    );
  };
  return (
    <div>
      <div className="adm-h" style={{ fontSize: 18, marginBottom: 16 }}>Pending verification ({pending.length})</div>
      {pending.length === 0 ? <EmptyState title="No pending applications" sub="All caught up!" /> : pending.map(Card)}
      {others.length > 0 && <><div className="adm-h" style={{ fontSize: 18, margin: "24px 0 14px" }}>Reviewed</div>{others.map(Card)}</>}
    </div>
  );
}
