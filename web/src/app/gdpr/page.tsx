import LegalPage from "@/components/LegalPage";
import { site } from "@/lib/site";

export const metadata = {
  title: "GDPR & Your Rights — NadaRuns",
  description: "Your data-protection rights under the GDPR and how to exercise them with NadaRuns.",
};

export default function GdprPage() {
  return (
    <LegalPage
      title="GDPR & Your Data Rights"
      lastUpdated="To be set on publication"
      intro={`${site.company.legalName} is committed to protecting your personal data in line with the EU General Data Protection Regulation (GDPR). This page summarises your rights and how to exercise them.`}
      sections={[
        { heading: "Your rights at a glance", bullets: ["Right to be informed about how your data is used.", "Right of access to the personal data we hold about you.", "Right to rectification of inaccurate data.", "Right to erasure (\u201cright to be forgotten\u201d), within legal limits.", "Right to restrict processing.", "Right to data portability.", "Right to object to processing based on legitimate interests or direct marketing.", "Rights regarding automated decision-making and profiling."] },
        { heading: "How to exercise your rights", paragraphs: [`Send a request to ${site.contact.supportEmail}. We will verify your identity and respond within one month, as required by the GDPR. There is normally no charge for a request.`] },
        { heading: "Data we process & why", paragraphs: ["Cross-references the Privacy Policy for the categories of data, purposes and legal bases."] },
        { heading: "Sub-processors", paragraphs: ["We maintain a list of sub-processors (e.g. Stripe for payments, Google Maps, cloud hosting) and keep data-processing agreements in place."] },
        { heading: "Data breach procedure", paragraphs: ["Outline of our process for detecting, reporting and notifying relevant breaches to the supervisory authority and affected users where required."] },
        { heading: "Supervisory authority", paragraphs: ["You have the right to lodge a complaint with the Office of the Data Protection Ombudsman of Finland (tietosuojavaltuutetun toimisto)."] },
      ]}
    />
  );
}
