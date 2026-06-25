import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useTranslation } from "react-i18next";

import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

const COMPANY = { name: "NadaRuns Oy", businessId: "3456789-1", address: "Mannerheimintie 10, 00100 Helsinki, Finland", email: "care@nadaruns.com" };

type Section = { heading: string; paragraphs?: string[]; bullets?: string[] };
type Doc = { intro: string; sections: Section[] };

const CONTENT: Record<"en" | "fi", {
  title: string; tabPrivacy: string; tabTerms: string; updated: string; companyHead: string;
  businessId: string; contact: string; privacy: Doc; terms: Doc;
}> = {
  en: {
    title: "Privacy & Terms",
    tabPrivacy: "Privacy", tabTerms: "Terms",
    updated: "Last updated: June 2026",
    companyHead: "Company details", businessId: "Business ID (Y-tunnus)", contact: "Contact",
    privacy: {
      intro: "NadaRuns Oy (\"NadaRuns\", \"we\") operates a B2B logistics marketplace that connects available transport capacity with businesses that need freight moved. This policy explains how we process personal data in line with the EU General Data Protection Regulation (GDPR) and Finnish law. We act as the data controller.",
      sections: [
        { heading: "1. Data we collect", bullets: [
          "Account data: name, company, email, phone, and a hashed password.",
          "Carrier verification: identity and licence documents, vehicle registration and insurance.",
          "Capacity & route data: vehicle type, available capacity, planned routes and return legs.",
          "Booking data: pickup/drop-off locations, cargo details, prices and timestamps.",
          "Location data: vehicle GPS while a carrier is online or fulfilling a load.",
          "Payment data: handled by our processor (Stripe); we store limited transaction metadata, never full card numbers.",
        ] },
        { heading: "2. How we use your data", paragraphs: ["To match capacity with freight, operate bookings and payments (performance of a contract), keep the marketplace safe and prevent fraud and meet legal obligations, and to improve the service and communicate with you (legitimate interest or consent)."] },
        { heading: "3. Sharing", paragraphs: ["To complete a match we share the data needed between the carrier and the shipper (e.g. contact, route and cargo details). We use vetted sub-processors — payments (Stripe), mapping/routing, cloud hosting and email — each under a data-processing agreement."] },
        { heading: "4. International transfers", paragraphs: ["Where data leaves the EU/EEA we rely on appropriate safeguards such as Standard Contractual Clauses."] },
        { heading: "5. Retention", paragraphs: ["We keep personal data only as long as needed for the purposes above and to meet accounting and legal requirements, then delete or anonymise it."] },
        { heading: "6. Your rights", paragraphs: ["Under the GDPR you may access, rectify, erase, restrict, object to or port your data, and withdraw consent. Email " + COMPANY.email + " and we will respond within one month. You may also complain to the Finnish Data Protection Ombudsman (tietosuojavaltuutettu)."] },
        { heading: "7. Security", paragraphs: ["We protect your data with encryption in transit, hashed passwords, access controls and continuous monitoring."] },
      ],
    },
    terms: {
      intro: "These Terms govern your use of the NadaRuns logistics marketplace, websites and apps operated by NadaRuns Oy. By creating an account or using the service you accept these Terms. NadaRuns is a technology platform that connects independent carriers with shippers; we facilitate matches and payments but do not ourselves perform the transport.",
      sections: [
        { heading: "1. Definitions", bullets: [
          "\"Platform\" — the NadaRuns marketplace, websites, apps and APIs.",
          "\"Carrier\" — a transport company, fleet operator or owner-driver offering capacity.",
          "\"Shipper\" — a business booking freight transport.",
          "\"Load\" — a freight booking created on the Platform.",
        ] },
        { heading: "2. Accounts & eligibility", paragraphs: ["You must provide accurate information and keep your credentials secure. Carriers must complete identity, licence, vehicle and insurance verification before accepting loads."] },
        { heading: "3. Matching, pricing & payments", paragraphs: ["The Platform matches available capacity and return trips with freight. Prices are shown transparently up front based on distance, weight, vehicle type and route. Payments are processed via Stripe; NadaRuns charges a service fee, and carrier earnings are paid out on a regular cycle, net of applicable taxes (VAT)."] },
        { heading: "4. Carrier obligations", paragraphs: ["Carriers must hold valid licences and insurance, keep vehicles roadworthy, handle cargo safely and lawfully, and provide proof of pickup and delivery. Listings of capacity and routes must be accurate."] },
        { heading: "5. Shipper obligations", paragraphs: ["Shippers must describe cargo accurately, ensure it is lawful to transport, and make it available for collection as agreed. Prohibited, dangerous or illegal goods may not be booked without proper declaration and handling."] },
        { heading: "6. Liability & insurance", paragraphs: ["Transport is insured from collection to delivery to the extent described at booking. To the extent permitted by Finnish law, NadaRuns' liability as an intermediary is limited; the carrier is responsible for performing the transport."] },
        { heading: "7. Cancellations", paragraphs: ["Cancellation windows and any applicable fees are shown at booking. Repeated late cancellations or no-shows may affect account standing."] },
        { heading: "8. Suspension & termination", paragraphs: ["We may suspend or terminate accounts that breach these Terms, applicable law or marketplace safety."] },
        { heading: "9. Governing law", paragraphs: ["These Terms are governed by the laws of Finland, with disputes resolved by the competent Finnish courts or applicable consumer dispute bodies."] },
      ],
    },
  },
  fi: {
    title: "Tietosuoja & ehdot",
    tabPrivacy: "Tietosuoja", tabTerms: "Ehdot",
    updated: "Päivitetty viimeksi: kesäkuu 2026",
    companyHead: "Yrityksen tiedot", businessId: "Y-tunnus", contact: "Yhteystiedot",
    privacy: {
      intro: "NadaRuns Oy (\"NadaRuns\", \"me\") ylläpitää B2B-logistiikkamarkkinapaikkaa, joka yhdistää vapaan kuljetuskapasiteetin yrityksiin, joiden täytyy kuljettaa rahtia. Tämä seloste kuvaa, miten käsittelemme henkilötietoja EU:n yleisen tietosuoja-asetuksen (GDPR) ja Suomen lain mukaisesti. Toimimme rekisterinpitäjänä.",
      sections: [
        { heading: "1. Keräämämme tiedot", bullets: [
          "Tilitiedot: nimi, yritys, sähköposti, puhelin ja tiivistetty salasana.",
          "Kuljettajan tunnistautuminen: henkilöllisyys- ja ajokorttiasiakirjat, ajoneuvon rekisteröinti ja vakuutus.",
          "Kapasiteetti- ja reittitiedot: ajoneuvotyyppi, vapaa kapasiteetti, suunnitellut reitit ja paluukuljetukset.",
          "Varaustiedot: nouto-/toimituspaikat, kuorman tiedot, hinnat ja aikaleimat.",
          "Sijaintitiedot: ajoneuvon GPS, kun kuljettaja on online-tilassa tai suorittaa kuormaa.",
          "Maksutiedot: käsittelee maksunvälittäjämme (Stripe); tallennamme rajoitettuja tapahtumatietoja, emme koskaan täysiä korttinumeroita.",
        ] },
        { heading: "2. Miten käytämme tietojasi", paragraphs: ["Kapasiteetin ja rahdin yhdistämiseen, varausten ja maksujen hoitamiseen (sopimuksen täytäntöönpano), markkinapaikan turvallisuuden ylläpitoon ja petosten ehkäisyyn sekä lakisääteisten velvoitteiden täyttämiseen, ja palvelun parantamiseen ja viestintään (oikeutettu etu tai suostumus)."] },
        { heading: "3. Tietojen jakaminen", paragraphs: ["Yhdistämisen toteuttamiseksi jaamme kuljettajan ja lähettäjän välillä tarvittavat tiedot (esim. yhteystiedot, reitti- ja kuormatiedot). Käytämme luotettuja alikäsittelijöitä — maksut (Stripe), kartat/reititys, pilvipalvelut ja sähköposti — kukin tietojenkäsittelysopimuksen alaisena."] },
        { heading: "4. Kansainväliset siirrot", paragraphs: ["Kun tietoja siirretään EU:n/ETA:n ulkopuolelle, tukeudumme asianmukaisiin suojatoimiin, kuten vakiosopimuslausekkeisiin."] },
        { heading: "5. Säilytys", paragraphs: ["Säilytämme henkilötietoja vain niin kauan kuin yllä oleviin tarkoituksiin sekä kirjanpidollisten ja lakisääteisten vaatimusten täyttämiseen on tarpeen, minkä jälkeen poistamme tai anonymisoimme ne."] },
        { heading: "6. Oikeutesi", paragraphs: ["GDPR:n mukaan voit tutustua tietoihisi, oikaista, poistaa, rajoittaa, vastustaa tai siirtää niitä sekä peruuttaa suostumuksen. Lähetä sähköpostia osoitteeseen " + COMPANY.email + ", niin vastaamme kuukauden kuluessa. Voit myös tehdä valituksen tietosuojavaltuutetulle."] },
        { heading: "7. Tietoturva", paragraphs: ["Suojaamme tietosi salauksella siirrossa, tiivistetyillä salasanoilla, pääsynhallinnalla ja jatkuvalla valvonnalla."] },
      ],
    },
    terms: {
      intro: "Nämä ehdot säätelevät NadaRuns-logistiikkamarkkinapaikan, verkkosivustojen ja sovellusten käyttöä, joita NadaRuns Oy operoi. Luomalla tilin tai käyttämällä palvelua hyväksyt nämä ehdot. NadaRuns on teknologia-alusta, joka yhdistää itsenäiset kuljettajat ja lähettäjät; mahdollistamme yhdistämiset ja maksut mutta emme itse suorita kuljetusta.",
      sections: [
        { heading: "1. Määritelmät", bullets: [
          "\"Alusta\" — NadaRuns-markkinapaikka, verkkosivustot, sovellukset ja rajapinnat.",
          "\"Kuljettaja\" — kuljetusyritys, kalustonhaltija tai yksityisautoilija, joka tarjoaa kapasiteettia.",
          "\"Lähettäjä\" — yritys, joka varaa rahtikuljetuksen.",
          "\"Kuorma\" — Alustalle luotu rahtivaraus.",
        ] },
        { heading: "2. Tilit ja kelpoisuus", paragraphs: ["Sinun on annettava oikeat tiedot ja pidettävä tunnuksesi turvassa. Kuljettajien on suoritettava henkilöllisyyden, ajokortin, ajoneuvon ja vakuutuksen vahvistus ennen kuormien hyväksymistä."] },
        { heading: "3. Yhdistäminen, hinnoittelu ja maksut", paragraphs: ["Alusta yhdistää vapaan kapasiteetin ja paluukuljetukset rahtiin. Hinnat näytetään läpinäkyvästi etukäteen etäisyyden, painon, ajoneuvotyypin ja reitin perusteella. Maksut käsitellään Stripen kautta; NadaRuns veloittaa palvelumaksun, ja kuljettajan ansiot maksetaan säännöllisesti verojen (ALV) jälkeen."] },
        { heading: "4. Kuljettajan velvoitteet", paragraphs: ["Kuljettajilla on oltava voimassa olevat ajokortit ja vakuutukset, ajoneuvojen on oltava ajokuntoisia, kuorma on käsiteltävä turvallisesti ja laillisesti, ja nouto- ja toimitustodistus on toimitettava. Kapasiteetti- ja reitti-ilmoitusten on oltava paikkansapitäviä."] },
        { heading: "5. Lähettäjän velvoitteet", paragraphs: ["Lähettäjien on kuvattava kuorma tarkasti, varmistettava sen laillisuus kuljetukseen ja asetettava se noudettavaksi sovitusti. Kiellettyjä, vaarallisia tai laittomia tavaroita ei saa varata ilman asianmukaista ilmoitusta ja käsittelyä."] },
        { heading: "6. Vastuu ja vakuutus", paragraphs: ["Kuljetus on vakuutettu noudosta toimitukseen varauksessa kuvatussa laajuudessa. Suomen lain sallimissa rajoissa NadaRunsin vastuu välittäjänä on rajoitettu; kuljettaja vastaa kuljetuksen suorittamisesta."] },
        { heading: "7. Peruutukset", paragraphs: ["Peruutusajat ja mahdolliset maksut näytetään varauksessa. Toistuvat myöhäiset peruutukset tai saapumatta jättämiset voivat vaikuttaa tilin asemaan."] },
        { heading: "8. Keskeytys ja irtisanominen", paragraphs: ["Voimme keskeyttää tai irtisanoa tilit, jotka rikkovat näitä ehtoja, sovellettavaa lakia tai markkinapaikan turvallisuutta."] },
        { heading: "9. Sovellettava laki", paragraphs: ["Näihin ehtoihin sovelletaan Suomen lakia, ja riidat ratkaistaan toimivaltaisissa Suomen tuomioistuimissa tai soveltuvissa kuluttajariitaelimissä."] },
      ],
    },
  },
};

export default function LegalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { i18n } = useTranslation();
  const params = useLocalSearchParams<{ tab?: string }>();
  const c = i18n.language?.startsWith("fi") ? CONTENT.fi : CONTENT.en;
  const [tab, setTab] = useState<"privacy" | "terms">(params.tab === "terms" ? "terms" : "privacy");
  const doc = tab === "privacy" ? c.privacy : c.terms;
  const styles = createStyles(theme);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="legal-screen">
      <Animated.View entering={FadeInDown.duration(260)} style={styles.header}>
        <TouchableOpacity style={[styles.iconBtn, shadows.sm]} onPress={() => router.back()} testID="legal-back">
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>{c.title}</Text>
        <View style={{ width: 44 }} />
      </Animated.View>

      <View style={styles.tabs}>
        {(["privacy", "terms"] as const).map((id) => (
          <TouchableOpacity
            key={id}
            style={[styles.tab, tab === id && { backgroundColor: theme.primary }]}
            onPress={() => setTab(id)}
            testID={`legal-tab-${id}`}
          >
            <Text style={[styles.tabText, { color: tab === id ? "#fff" : theme.textSecondary }]}>
              {id === "privacy" ? c.tabPrivacy : c.tabTerms}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>{c.updated}</Text>
        <Text style={styles.intro}>{doc.intro}</Text>
        {doc.sections.map((s, i) => (
          <View key={i} style={{ marginTop: spacing.lg }}>
            <Text style={styles.secHeading}>{s.heading}</Text>
            {s.paragraphs?.map((p, j) => <Text key={j} style={styles.para}>{p}</Text>)}
            {s.bullets?.map((b, k) => (
              <View key={k} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={[styles.para, { flex: 1, marginTop: 0 }]}>{b}</Text>
              </View>
            ))}
          </View>
        ))}

        <View style={[styles.companyCard, shadows.sm]}>
          <Text style={styles.secHeading}>{c.companyHead}</Text>
          <Text style={styles.companyText}>{COMPANY.name}</Text>
          <Text style={styles.companyText}>{c.businessId}: {COMPANY.businessId}</Text>
          <Text style={styles.companyText}>{COMPANY.address}</Text>
          <Text style={styles.companyText}>{c.contact}: {COMPANY.email}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 20, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.3 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: spacing.xl, marginBottom: spacing.sm },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: theme.surfaceMuted, alignItems: "center" },
  tabText: { fontSize: 14, fontWeight: "700" },
  updated: { fontSize: 12, color: theme.textSecondary, marginBottom: spacing.md },
  intro: { fontSize: 15, lineHeight: 23, color: theme.textPrimary },
  secHeading: { fontSize: 16, fontWeight: "800", color: theme.textPrimary, marginBottom: spacing.xs },
  para: { fontSize: 14, lineHeight: 22, color: theme.textSecondary, marginTop: spacing.xs },
  bulletRow: { flexDirection: "row", gap: 8, marginTop: spacing.xs },
  bulletDot: { fontSize: 14, lineHeight: 22, color: theme.primary, fontWeight: "800" },
  companyCard: { backgroundColor: theme.surface, borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.xxl },
  companyText: { fontSize: 14, lineHeight: 22, color: theme.textSecondary, marginTop: 2 },
});
