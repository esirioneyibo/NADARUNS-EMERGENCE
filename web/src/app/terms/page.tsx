import LegalPage from "@/components/LegalPage";
import { site } from "@/lib/site";

export const metadata = {
  title: "Terms of Service — NadaRuns",
  description: "The terms and conditions governing the use of the NadaRuns logistics platform.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="To be set on publication"
      intro={`These Terms of Service ("Terms") govern your access to and use of the ${site.name} platform, websites and mobile applications operated by ${site.company.legalName}. By creating an account or using the service you agree to these Terms.`}
      sections={[
        { heading: "Definitions", paragraphs: ["Defines key terms used throughout the agreement."], bullets: ["\u201cPlatform\u201d — the NadaRuns websites, apps and APIs.", "\u201cShipper\u201d — a business or individual booking a delivery.", "\u201cDriver\u201d — an independent carrier accepting and fulfilling deliveries.", "\u201cOrder\u201d — a delivery request created on the Platform."] },
        { heading: "Eligibility & accounts", paragraphs: ["Requirements to register, accuracy of information, account security, and minimum age. Drivers must complete identity (KYC) and vehicle verification before accepting orders."] },
        { heading: "The service & role of NadaRuns", paragraphs: ["NadaRuns is a technology platform connecting Shippers and independent Drivers. Describe the contractual relationship and that NadaRuns facilitates, but does not itself perform, the transport unless stated otherwise."] },
        { heading: "Bookings, pricing & payments", paragraphs: ["How prices are calculated, authorization and capture of payments via our payment processor (Stripe), platform commission, driver payouts, taxes (VAT) and invoicing."] },
        { heading: "Cancellations & refunds", paragraphs: ["Cancellation windows for Shippers and Drivers, applicable fees, and the refund process. Cross-reference the Refund/Cancellation policy."] },
        { heading: "Driver obligations", paragraphs: ["Licensing, insurance, vehicle condition, safe and lawful conduct, proof-of-delivery (OTP/photo), and handling of cargo."] },
        { heading: "Prohibited items & conduct", paragraphs: ["List prohibited/illegal/dangerous goods and prohibited platform behaviour."] },
        { heading: "Liability & insurance", paragraphs: ["Limitations of liability, cargo insurance coverage and claims process, to the extent permitted by Finnish law."] },
        { heading: "Suspension & termination", paragraphs: ["Grounds and process for suspending or terminating accounts."] },
        { heading: "Governing law & disputes", paragraphs: ["These Terms are governed by the laws of Finland. Specify the competent courts / dispute-resolution and consumer ADR (kuluttajariitalautakunta) where applicable."] },
        { heading: "Changes to these Terms", paragraphs: ["How updates are communicated and when they take effect."] },
      ]}
    />
  );
}
