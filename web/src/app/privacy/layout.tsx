import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — NadaRuns",
  description: "How NadaRuns collects, uses and protects your personal data under the GDPR.",
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
