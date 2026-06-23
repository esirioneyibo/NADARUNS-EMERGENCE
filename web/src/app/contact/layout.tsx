import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Yhteystiedot — NadaRuns",
  description:
    "Ota yhteyttä NadaRunsiin. Kysymykset, kumppanuudet tai tuki — tiimimme vastaa yleensä yhden työpäivän kuluessa.",
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
