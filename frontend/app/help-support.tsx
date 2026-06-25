import React from "react";
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { useTranslation } from "react-i18next";

import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

const SUPPORT_EMAIL = "care@nadaruns.com";

type QA = { q: string; a: string };

const CONTENT = {
  en: {
    title: "Help & Support",
    heroTitle: "We're here to help",
    heroSub: "Get answers about listing capacity, booking freight and getting paid — or reach our team directly.",
    contactTitle: "Contact support",
    emailLabel: "Email our team",
    emailNote: "We reply within 1 business day.",
    hoursLabel: "Support hours",
    hoursValue: "Mon–Fri 9:00–18:00 (EET)",
    faqTitle: "Frequently asked questions",
    carriersHead: "For carriers & drivers",
    shippersHead: "For shippers & businesses",
    legalLink: "Privacy & Terms",
    legalNote: "Read our policies",
    carrierFaqs: [
      { q: "How do I turn an empty run into revenue?", a: "List your available capacity and planned route — including return legs — and NadaRuns matches you with nearby freight that fits your vehicle and direction, so you fill kilometres you'd otherwise drive empty." },
      { q: "How and when do I get paid?", a: "Your earnings are tracked in the app and paid to your account on a regular weekly cycle. You always see your projected payout before you accept a load." },
      { q: "Which vehicles can I register?", a: "Anything from a cargo van to a semi-trailer. Register multiple vehicles and switch your active one anytime to match the loads you want." },
    ],
    shipperFaqs: [
      { q: "How fast can I find transport?", a: "In minutes. We surface carriers with matching capacity already heading your way, so you get competitive pricing and faster access to vehicles." },
      { q: "How is pricing calculated?", a: "Transparent, up-front pricing based on distance, weight, vehicle type and route — shown before you confirm. Because you're using capacity that already exists, prices are often more competitive." },
      { q: "Is my freight tracked and insured?", a: "Yes. Every booking includes live tracking, proof of pickup/delivery and insured transport from collection to drop-off." },
    ],
  },
  fi: {
    title: "Ohje & tuki",
    heroTitle: "Autamme mielellämme",
    heroSub: "Saat vastauksia kapasiteetin ilmoittamisesta, rahdin varaamisesta ja maksuista — tai tavoitat tiimimme suoraan.",
    contactTitle: "Ota yhteyttä tukeen",
    emailLabel: "Lähetä sähköpostia",
    emailNote: "Vastaamme yhden työpäivän kuluessa.",
    hoursLabel: "Tukiajat",
    hoursValue: "Ma–Pe 9:00–18:00 (EET)",
    faqTitle: "Usein kysytyt kysymykset",
    carriersHead: "Kuljettajille ja kuljetusyrityksille",
    shippersHead: "Lähettäjille ja yrityksille",
    legalLink: "Tietosuoja & ehdot",
    legalNote: "Lue käytäntömme",
    carrierFaqs: [
      { q: "Miten muutan tyhjän ajon tuloksi?", a: "Ilmoita vapaa kapasiteettisi ja suunniteltu reittisi — paluukuljetukset mukaan lukien — ja NadaRuns yhdistää sinut lähellä olevaan rahtiin, joka sopii ajoneuvoosi ja suuntaasi, jotta täytät kilometrit, jotka muuten ajaisit tyhjänä." },
      { q: "Miten ja milloin saan maksun?", a: "Ansiosi seurataan sovelluksessa ja maksetaan tilillesi säännöllisellä viikkosyklillä. Näet aina arvioidun maksusi ennen kuorman hyväksymistä." },
      { q: "Mitä ajoneuvoja voin rekisteröidä?", a: "Mitä tahansa pakettiautosta puoliperävaunuun. Rekisteröi useita ajoneuvoja ja vaihda aktiivista milloin tahansa haluamiisi kuormiin." },
    ],
    shipperFaqs: [
      { q: "Kuinka nopeasti löydän kuljetuksen?", a: "Minuuteissa. Nostamme esiin kuljettajat, joiden kapasiteetti on jo matkalla suuntaasi, joten saat kilpailukykyisen hinnan ja nopeamman pääsyn ajoneuvoihin." },
      { q: "Miten hinta lasketaan?", a: "Läpinäkyvä, etukäteen näytettävä hinta etäisyyden, painon, ajoneuvotyypin ja reitin perusteella — ennen vahvistusta. Koska hyödynnät jo olemassa olevaa kapasiteettia, hinnat ovat usein kilpailukykyisempiä." },
      { q: "Seurataanko ja vakuutetaanko rahtini?", a: "Kyllä. Jokainen varaus sisältää reaaliaikaisen seurannan, nouto-/toimitustodistuksen ja vakuutetun kuljetuksen noudosta toimitukseen." },
    ],
  },
};

export default function HelpSupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { i18n } = useTranslation();
  const c = i18n.language?.startsWith("fi") ? CONTENT.fi : CONTENT.en;
  const styles = createStyles(theme);

  const openEmail = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=NadaRuns%20Support`).catch(() => {});
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="help-support-screen">
      <Animated.View entering={FadeInDown.duration(260)} style={styles.header}>
        <TouchableOpacity style={[styles.iconBtn, shadows.sm]} onPress={() => router.back()} testID="help-back">
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>{c.title}</Text>
        <View style={{ width: 44 }} />
      </Animated.View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.delay(60)} style={[styles.hero, shadows.md]}>
          <Ionicons name="headset-outline" size={34} color="#fff" />
          <Text style={styles.heroTitle}>{c.heroTitle}</Text>
          <Text style={styles.heroSub}>{c.heroSub}</Text>
        </Animated.View>

        {/* Contact */}
        <Text style={styles.sectionTitle}>{c.contactTitle.toUpperCase()}</Text>
        <Animated.View entering={FadeInUp.delay(120)} style={[styles.card, shadows.sm]}>
          <TouchableOpacity style={styles.row} onPress={openEmail} testID="support-email">
            <View style={styles.rowIcon}><Ionicons name="mail-outline" size={20} color={theme.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{c.emailLabel}</Text>
              <Text style={styles.rowValue}>{SUPPORT_EMAIL}</Text>
              <Text style={styles.rowNote}>{c.emailNote}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </TouchableOpacity>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowIcon}><Ionicons name="time-outline" size={20} color={theme.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{c.hoursLabel}</Text>
              <Text style={styles.rowValue}>{c.hoursValue}</Text>
            </View>
          </View>
        </Animated.View>

        {/* FAQ */}
        <Text style={styles.sectionTitle}>{c.faqTitle.toUpperCase()}</Text>
        <Text style={styles.groupHead}>{c.carriersHead}</Text>
        <Animated.View entering={FadeInUp.delay(160)} style={[styles.card, shadows.sm]}>
          {c.carrierFaqs.map((f, i) => <Faq key={i} item={f} theme={theme} last={i === c.carrierFaqs.length - 1} />)}
        </Animated.View>
        <Text style={styles.groupHead}>{c.shippersHead}</Text>
        <Animated.View entering={FadeInUp.delay(200)} style={[styles.card, shadows.sm]}>
          {c.shipperFaqs.map((f, i) => <Faq key={i} item={f} theme={theme} last={i === c.shipperFaqs.length - 1} />)}
        </Animated.View>

        {/* Legal link */}
        <Animated.View entering={FadeInUp.delay(240)} style={[styles.card, shadows.sm, { marginTop: spacing.xl }]}>
          <TouchableOpacity style={styles.row} onPress={() => router.push("/legal")} testID="link-legal-from-help">
            <View style={styles.rowIcon}><Ionicons name="shield-checkmark-outline" size={20} color={theme.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{c.legalLink}</Text>
              <Text style={styles.rowNote}>{c.legalNote}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function Faq({ item, theme, last }: { item: QA; theme: any; last: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <View>
      <TouchableOpacity style={styles2.qRow} onPress={() => setOpen((o) => !o)} activeOpacity={0.7}>
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{item.q}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={theme.textSecondary} />
      </TouchableOpacity>
      {open ? <Text style={{ fontSize: 14, lineHeight: 21, color: theme.textSecondary, paddingBottom: spacing.md }}>{item.a}</Text> : null}
      {!last ? <View style={{ height: 1, backgroundColor: theme.border }} /> : null}
    </View>
  );
}

const styles2 = StyleSheet.create({
  qRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, gap: 12 },
});

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 20, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.3 },
  hero: { backgroundColor: theme.primary, borderRadius: radius.xxl, padding: spacing.xl, alignItems: "center" },
  heroTitle: { fontSize: 22, fontWeight: "800", color: "#fff", marginTop: spacing.md, textAlign: "center" },
  heroSub: { fontSize: 14, lineHeight: 21, color: "rgba(255,255,255,0.9)", marginTop: spacing.xs, textAlign: "center" },
  sectionTitle: { fontSize: 11, fontWeight: "800", color: theme.textSecondary, letterSpacing: 1.2, marginTop: spacing.xxl, marginBottom: spacing.md, paddingHorizontal: 4 },
  groupHead: { fontSize: 14, fontWeight: "700", color: theme.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: 4 },
  card: { backgroundColor: theme.surface, borderRadius: radius.xl, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, gap: 12 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.primaryLight, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 15, fontWeight: "600", color: theme.textPrimary },
  rowValue: { fontSize: 14, fontWeight: "600", color: theme.primary, marginTop: 2 },
  rowNote: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: theme.border, marginLeft: 52 },
});
