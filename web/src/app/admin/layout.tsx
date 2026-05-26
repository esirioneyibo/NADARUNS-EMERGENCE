import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin Dashboard - NadaRuns",
  description: "NadaRuns Admin Dashboard - Manage drivers, KYC applications, and monitor platform statistics.",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
