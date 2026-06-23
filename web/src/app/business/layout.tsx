import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NadaRuns yrityksille — Lähetä älykkäämmin",
  description:
    "Kuljeta mitä tahansa kaikkialle Suomeen NadaRuns yrityksille -palvelulla. Välitön läpinäkyvä hinnoittelu, reaaliaikainen seuranta, 11 ajoneuvotyyppiä ja toimitustodistus.",
};

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
