import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tietosuojaseloste — NadaRuns",
  description: "Miten NadaRuns kerää, käyttää ja suojaa henkilötietojasi GDPR:n mukaisesti.",
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
