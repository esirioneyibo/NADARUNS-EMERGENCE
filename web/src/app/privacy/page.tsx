import LegalPage from "@/components/LegalPage";
import { site } from "@/lib/site";

export const metadata = {
  title: "Privacy Policy — NadaRuns",
  description: "How NadaRuns collects, uses and protects your personal data under the GDPR.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="To be set on publication"
      intro={`This Privacy Policy explains how ${site.company.legalName} ("we") collects, uses, shares and protects personal data when you use ${site.name}. We act as the data controller and process personal data in accordance with the EU General Data Protection Regulation (GDPR) and the Finnish Data Protection Act.`}
      sections={[
        { heading: "Data controller", paragraphs: [`${site.company.legalName}, Business ID ${site.company.businessId}, ${site.contact.address.line1}, ${site.contact.address.line2}. For privacy matters contact ${site.contact.supportEmail}.`] },
        { heading: "Data we collect", bullets: ["Account data: name, email, phone, password (hashed).", "Driver verification (KYC): identity document, driving licence, vehicle documents.", "Order data: pickup/dropoff addresses, cargo details, timestamps.", "Location data: driver GPS location while online/on a delivery.", "Payment data: handled by our processor (Stripe); we store limited transaction metadata, not full card numbers.", "Device & usage data: app/website analytics, log data."] },
        { heading: "How we use your data & legal bases", paragraphs: ["Purposes include providing the service (performance of a contract), safety and fraud prevention and legal compliance (legal obligation), service improvement and marketing (legitimate interest or consent)."] },
        { heading: "Sharing & processors", paragraphs: ["We share data with sub-processors strictly as needed: payment processing (Stripe), mapping (Google Maps), cloud hosting, and communications. Each acts under a data-processing agreement."] },
        { heading: "International transfers", paragraphs: ["Where data is transferred outside the EU/EEA, we rely on appropriate safeguards such as Standard Contractual Clauses."] },
        { heading: "Retention", paragraphs: ["How long each category of data is kept and the criteria used to determine retention periods."] },
        { heading: "Your rights", paragraphs: ["Under the GDPR you have the right to access, rectify, erase, restrict, object and port your data, and to withdraw consent. See the GDPR page for how to exercise them."] },
        { heading: "Security", paragraphs: ["Technical and organisational measures protecting your data (encryption in transit, hashed passwords, access controls)."] },
        { heading: "Cookies", paragraphs: ["Our website uses cookies as described in the Cookie Policy."] },
        { heading: "Contact & complaints", paragraphs: [`Contact ${site.contact.supportEmail} with any privacy questions. You also have the right to lodge a complaint with the Finnish Data Protection Ombudsman (tietosuojavaltuutettu).`] },
      ]}
    />
  );
}
