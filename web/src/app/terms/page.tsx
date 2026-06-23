"use client";

import LegalPage from "@/components/LegalPage";
import { useContent } from "@/lib/i18n";

export default function TermsPage() {
  const c = useContent().legal.terms;
  return <LegalPage title={c.title} intro={c.intro} sections={c.sections} />;
}
