import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GDPR & oikeutesi — NadaRuns",
  description: "Tietosuojaoikeutesi GDPR:n mukaan ja miten käytät niitä NadaRunsin kanssa.",
};

export default function GdprLayout({ children }: { children: React.ReactNode }) {
  return children;
}
