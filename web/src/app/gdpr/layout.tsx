import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GDPR & Your Rights — NadaRuns",
  description: "Your data-protection rights under the GDPR and how to exercise them with NadaRuns.",
};

export default function GdprLayout({ children }: { children: React.ReactNode }) {
  return children;
}
