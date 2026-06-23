import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Drive with NadaRuns — Earn on your schedule",
  description:
    "Become a NadaRuns driver. Flexible hours, fast weekly pay, choose your vehicle and accept jobs near you with in-app navigation.",
};

export default function DriversLayout({ children }: { children: React.ReactNode }) {
  return children;
}
