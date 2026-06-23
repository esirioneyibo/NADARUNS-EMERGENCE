import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About NadaRuns — Moving Finland forward",
  description:
    "NadaRuns connects trusted drivers with businesses for fast, reliable deliveries across Finland. Learn about our mission, values and story.",
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
