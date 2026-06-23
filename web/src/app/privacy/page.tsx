"use client";

import LegalPage from "@/components/LegalPage";
import { useContent } from "@/lib/i18n";

export default function PrivacyPage() {
  const c = useContent().legal.privacy;
  return <LegalPage title={c.title} intro={c.intro} sections={c.sections} />;
}
