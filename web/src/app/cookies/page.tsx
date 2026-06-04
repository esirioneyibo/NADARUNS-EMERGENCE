import LegalPage from "@/components/LegalPage";
import { site } from "@/lib/site";

export const metadata = {
  title: "Cookie Policy — NadaRuns",
  description: "How NadaRuns uses cookies and similar technologies on its website.",
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      lastUpdated="To be set on publication"
      intro={`This Cookie Policy explains how ${site.name} uses cookies and similar technologies on our website, and how you can control them. It should be read together with our Privacy Policy.`}
      sections={[
        { heading: "What are cookies", paragraphs: ["A short, plain-language explanation of cookies and similar technologies (local storage, pixels)."] },
        { heading: "Categories of cookies we use", bullets: ["Strictly necessary — required for the site to function (e.g. session, security).", "Preferences — remember choices such as language.", "Analytics — help us understand usage and improve the service.", "Marketing — measure campaigns (only with consent)."] },
        { heading: "Managing your preferences", paragraphs: ["How users can accept/reject non-essential cookies via the consent banner and their browser settings. Non-essential cookies are only set after consent."] },
        { heading: "Third-party cookies", paragraphs: ["List third parties that may set cookies (e.g. analytics, payment, maps) and link to their policies."] },
        { heading: "Updates", paragraphs: ["How changes to this policy are communicated."] },
      ]}
    />
  );
}
