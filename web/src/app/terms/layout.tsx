import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Käyttöehdot — NadaRuns",
  description: "NadaRuns-logistiikka-alustan käyttöä koskevat ehdot.",
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
