import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lataa NadaRuns-sovellus — iOS & Android",
  description:
    "Lataa NadaRuns iOS:lle ja Androidille. Seuraa toimituksia reaaliajassa, hyväksy keikkoja, keskustele kuljettajien kanssa ja saat välittömät ilmoitukset.",
};

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
