import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Evästekäytäntö — NadaRuns",
  description: "Miten NadaRuns käyttää evästeitä ja vastaavia teknologioita verkkosivustollaan.",
};

export default function CookiesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
