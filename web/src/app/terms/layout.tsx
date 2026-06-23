import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — NadaRuns",
  description: "The terms and conditions governing the use of the NadaRuns logistics platform.",
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
