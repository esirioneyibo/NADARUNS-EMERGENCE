"use client";

import LegalPage from "@/components/LegalPage";
import { useContent } from "@/lib/i18n";

export default function CookiesPage() {
  const c = useContent().legal.cookies;
  return <LegalPage title={c.title} intro={c.intro} sections={c.sections} />;
}
