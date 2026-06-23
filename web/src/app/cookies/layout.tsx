import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy — NadaRuns",
  description: "How NadaRuns uses cookies and similar technologies on its website.",
};

export default function CookiesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
