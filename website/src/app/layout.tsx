import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NadaRuns - Fast & Reliable Delivery",
  description: "NadaRuns connects drivers with businesses for fast, reliable deliveries. Join as a driver to earn money or as a business to ship your products.",
  keywords: "delivery, courier, driver, shipping, logistics, Helsinki, Finland",
  openGraph: {
    title: "NadaRuns - Fast & Reliable Delivery",
    description: "Connect with drivers for fast deliveries or join as a driver to earn money on your schedule.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Navbar />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
