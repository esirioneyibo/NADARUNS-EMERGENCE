"use client";

import { site } from "@/lib/site";
import { useContent } from "@/lib/i18n";

const APPLE_PATH =
  "M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z";

function AppleIcon() {
  return (
    <svg viewBox="0 0 384 512" width={24} height={24} fill="currentColor" aria-hidden="true">
      <path d={APPLE_PATH} />
    </svg>
  );
}

function PlayIcon() {
  // Recognizable Google Play "play" triangle (monochrome to match the badge).
  return (
    <svg viewBox="0 0 512 512" width={22} height={22} fill="currentColor" aria-hidden="true">
      <path d="M48 32 358 256 48 480c-8 6-20 0-20-12V44c0-12 12-18 20-12zM392 224l64 44c14 10 14 26 0 36l-64 44-70-72 70-92z" />
    </svg>
  );
}

function Badge({
  href,
  sub,
  main,
  icon,
  comingSoon,
  soonLabel,
}: {
  href: string;
  sub: string;
  main: string;
  icon: React.ReactNode;
  comingSoon?: boolean;
  soonLabel: string;
}) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: "12px",
        background: "#111827",
        color: "white",
        padding: "12px 22px",
        borderRadius: "14px",
        textDecoration: "none",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        minWidth: "190px",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", color: "white" }}>{icon}</span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
        <span style={{ fontSize: "11px", opacity: 0.8, letterSpacing: "0.3px" }}>{sub}</span>
        <span style={{ fontSize: "19px", fontWeight: 700 }}>{main}</span>
      </span>
      {comingSoon && (
        <span
          style={{
            position: "absolute",
            top: "-10px",
            right: "-8px",
            background: "linear-gradient(135deg, #10B981 0%, #6366F1 100%)",
            color: "white",
            fontSize: "10px",
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: "100px",
            letterSpacing: "0.4px",
          }}
        >
          {soonLabel}
        </span>
      )}
    </a>
  );
}

export default function AppBadges() {
  const b = useContent().badges;
  const cs = site.app.comingSoon;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
      <Badge
        href={cs ? "/download" : site.app.ios}
        icon={<AppleIcon />}
        sub={b.iosSub}
        main={b.iosMain}
        comingSoon={cs}
        soonLabel={b.soon}
      />
      <Badge
        href={cs ? "/download" : site.app.android}
        icon={<PlayIcon />}
        sub={b.androidSub}
        main={b.androidMain}
        comingSoon={cs}
        soonLabel={b.soon}
      />
    </div>
  );
}
