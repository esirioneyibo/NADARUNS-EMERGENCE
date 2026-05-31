"use client";
import React from "react";

function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / p;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * p;
}
function fmtTick(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k";
  return Math.round(n).toString();
}

export function LineAreaChart({
  data,
  color = "#10B981",
  height = 230,
  valuePrefix = "",
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  valuePrefix?: string;
}) {
  const W = 720;
  const H = height;
  const pad = { l: 46, r: 14, t: 16, b: 28 };
  const niceMax = niceCeil(Math.max(1, ...data.map((d) => d.value)));
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / niceMax) * ih;
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(data.length - 1).toFixed(1)} ${(pad.t + ih).toFixed(1)} L ${x(0).toFixed(1)} ${(pad.t + ih).toFixed(1)} Z`;
  const ticks = 4;
  const gid = "grad_" + color.replace("#", "");
  const step = Math.max(1, Math.ceil(data.length / 7));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: ticks + 1 }).map((_, t) => {
        const v = (niceMax / ticks) * (ticks - t);
        const yy = pad.t + (ih / ticks) * t;
        return (
          <g key={t}>
            <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke="#EEF2F6" />
            <text x={pad.l - 8} y={yy + 4} textAnchor="end" fontSize="11" fill="#94A3B8">
              {valuePrefix}{fmtTick(v)}
            </text>
          </g>
        );
      })}
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) =>
        i % step === 0 || i === data.length - 1 ? (
          <text key={"x" + i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#94A3B8">
            {d.label}
          </text>
        ) : null
      )}
      {data.map((d, i) => (
        <circle key={"c" + i} cx={x(i)} cy={y(d.value)} r={i === data.length - 1 ? 3.5 : 0} fill={color}>
          <title>{`${d.label}: ${valuePrefix}${d.value}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function HBars({ data, color = "#6366F1" }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
      {data.length === 0 && <div style={{ color: "#94A3B8", fontSize: 14 }}>No data yet</div>}
      {data.map((d, i) => (
        <div key={i}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
            <span style={{ color: "#334155", fontWeight: 600, textTransform: "capitalize" }}>{d.label.replace(/_/g, " ")}</span>
            <span style={{ color: "#64748B", fontWeight: 700 }}>{d.value}</span>
          </div>
          <div style={{ height: 8, background: "#F1F5F9", borderRadius: 99 }}>
            <div style={{ height: 8, borderRadius: 99, width: `${(d.value / max) * 100}%`, background: color, transition: "width .3s" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Donut({ data, size = 184 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  let off = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1F5F9" strokeWidth={16} />
        {data.map((d, i) => {
          const len = (d.value / total) * c;
          const el = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth={16} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cy})`}>
              <title>{`${d.label}: ${d.value}`}</title>
            </circle>
          );
          off += len;
          return el;
        })}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="26" fontWeight="800" fill="#0F172A">{total}</text>
        <text x={cx} y={cy + 18} textAnchor="middle" fontSize="11" fill="#94A3B8">total</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
            <span style={{ color: "#334155", textTransform: "capitalize", fontWeight: 600 }}>{d.label.replace(/_/g, " ")}</span>
            <span style={{ color: "#94A3B8", marginLeft: 4 }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
