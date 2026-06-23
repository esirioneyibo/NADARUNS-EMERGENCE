import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Aja NadaRunsin kanssa — Ansaitse omilla aikatauluillasi",
  description:
    "Ryhdy NadaRuns-kuljettajaksi. Joustavat työajat, nopea viikkopalkka, valitse ajoneuvosi ja hyväksy keikkoja läheltäsi sovelluksen navigoinnilla.",
};

export default function DriversLayout({ children }: { children: React.ReactNode }) {
  return children;
}
