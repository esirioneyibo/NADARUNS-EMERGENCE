import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tietoa NadaRunsista — Vie Suomea eteenpäin",
  description:
    "NadaRuns yhdistää luotettavat kuljettajat ja yritykset nopeisiin, luotettaviin toimituksiin kaikkialla Suomessa. Tutustu missioomme, arvoihimme ja tarinaamme.",
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
