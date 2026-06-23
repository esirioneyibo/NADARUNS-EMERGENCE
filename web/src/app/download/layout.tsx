import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Download the NadaRuns App — iOS & Android",
  description:
    "Download NadaRuns for iOS and Android. Track deliveries live, accept jobs, chat with drivers and get instant alerts.",
};

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
