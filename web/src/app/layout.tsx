import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ClientProviders from "@/components/ClientProviders";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NadaRuns — Nopea ja luotettava toimitus",
  description: "NadaRuns yhdistää kuljettajat ja yritykset nopeisiin, luotettaviin toimituksiin kaikkialla Suomessa. Ryhdy kuljettajaksi ansaitaksesi tai lähetä tuotteesi reaaliaikaisella seurannalla.",
  keywords: "toimitus, kuljetus, kuljettaja, lähetys, logistiikka, Helsinki, Suomi, delivery, courier",
  openGraph: {
    title: "NadaRuns — Nopea ja luotettava toimitus",
    description: "Löydä kuljettaja nopeisiin toimituksiin tai ryhdy kuljettajaksi ansaitaksesi omilla aikatauluillasi.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fi">
      <body className={inter.className}>
        <ClientProviders>
          <Navbar />
          {children}
          <Footer />
        </ClientProviders>
      </body>
    </html>
  );
}
