import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NadaRuns for Business — Ship smarter",
  description:
    "Move anything across Finland with NadaRuns for Business. Instant transparent pricing, live tracking, 11 vehicle types and proof of delivery.",
};

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
