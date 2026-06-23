"use client";

import LegalPage from "@/components/LegalPage";
import { useContent } from "@/lib/i18n";

export default function GdprPage() {
  const c = useContent().legal.gdpr;
  return <LegalPage title={c.title} intro={c.intro} sections={c.sections} />;
}
