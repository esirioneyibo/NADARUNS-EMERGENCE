import Link from "next/link";
import { site } from "@/lib/site";

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

interface LegalPageProps {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
}

/**
 * Shared layout for all NadaRuns legal documents (Terms, Privacy, Cookies, GDPR).
 * Content is scaffolded as a TEMPLATE — replace the placeholder copy with text
 * reviewed by qualified legal counsel before launch. Company details are pulled
 * from the single source of truth in src/lib/site.ts.
 */
export default function LegalPage({ title, lastUpdated, intro, sections }: LegalPageProps) {
  return (
    <main style={{ background: "#ffffff", color: "#1f2937" }}>
      <section style={{ maxWidth: 860, margin: "0 auto", padding: "128px 24px 80px" }}>
        <p
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontSize: 13,
            fontWeight: 700,
            color: "#059669",
            marginBottom: 12,
          }}
        >
          Legal
        </p>
        <h1 style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.15, margin: "0 0 12px", color: "#0f172a" }}>
          {title}
        </h1>
        <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 24px" }}>Last updated: {lastUpdated}</p>

        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 12,
            padding: "14px 18px",
            fontSize: 14,
            color: "#9a3412",
            marginBottom: 28,
            lineHeight: 1.5,
          }}
        >
          <strong>Template notice:</strong> This document is a scaffold provided for layout and
          structure. The final wording must be reviewed and approved by qualified legal counsel and
          comply with Finnish and EU law before NadaRuns accepts real customers or payments.
        </div>

        <p style={{ fontSize: 16, lineHeight: 1.7, color: "#374151", marginBottom: 8 }}>{intro}</p>

        {sections.map((s, i) => (
          <section key={i} style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: "0 0 12px" }}>
              {i + 1}. {s.heading}
            </h2>
            {s.paragraphs?.map((p, j) => (
              <p key={j} style={{ fontSize: 16, lineHeight: 1.7, color: "#374151", margin: "0 0 12px" }}>
                {p}
              </p>
            ))}
            {s.bullets && (
              <ul style={{ paddingLeft: 22, margin: "0 0 12px" }}>
                {s.bullets.map((b, k) => (
                  <li key={k} style={{ fontSize: 16, lineHeight: 1.7, color: "#374151", marginBottom: 6 }}>
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <div
          style={{
            marginTop: 48,
            padding: "24px",
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 16,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: "0 0 12px" }}>
            Company details
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: "#374151", margin: 0 }}>
            <strong>{site.company.legalName}</strong>
            <br />
            Business ID (Y-tunnus): {site.company.businessId}
            <br />
            {site.contact.address.line1}, {site.contact.address.line2}
            <br />
            Support:{" "}
            <a href={`mailto:${site.contact.supportEmail}`} style={{ color: "#059669" }}>
              {site.contact.supportEmail}
            </a>
            <br />
            General enquiries:{" "}
            <a href={`mailto:${site.contact.email}`} style={{ color: "#059669" }}>
              {site.contact.email}
            </a>
          </p>
        </div>

        <div style={{ marginTop: 32 }}>
          <Link href="/" style={{ color: "#059669", fontWeight: 600, textDecoration: "none" }}>
            ← Back to home
          </Link>
        </div>
      </section>
    </main>
  );
}
