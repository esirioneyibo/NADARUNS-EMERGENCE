"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export type Lang = "fi" | "en";

// ---------------------------------------------------------------------------
// Content dictionaries. Finnish-first (default), English as the alternate.
// Add new page sections here; pages read them via useContent().
// ---------------------------------------------------------------------------
const CONTENT = {
  en: {
    nav: {
      home: "Home", about: "About", drivers: "For Drivers", business: "For Business",
      download: "Download", contact: "Contact",
      admin: "Admin Dashboard", driveWithUs: "Drive with us", getApp: "Get the app",
    },
    footer: {
      tagline: "Fast & reliable delivery connecting drivers with businesses across Finland.",
      company: "Company", about: "About Us", careers: "Careers", blog: "Blog", press: "Press",
      products: "Products", driveWith: "Drive with NadaRuns", forBusiness: "NadaRuns for Business",
      downloadApp: "Download the App", enterprise: "Enterprise",
      legal: "Legal", terms: "Terms of Service", privacy: "Privacy Policy", cookies: "Cookie Policy", gdpr: "GDPR",
      contact: "Contact", rights: "All rights reserved.", sitemap: "Sitemap", accessibility: "Accessibility",
    },
    home: {
      heroBadge: "⚡ #1 Delivery Platform in Finland",
      heroTitle1: "Fast & Reliable", heroTitle2: "Delivery", heroTitle3: "For", heroTitle4: "Everyone",
      heroSub: "Connect with professional drivers for quick deliveries or join our fleet to earn money on your own schedule.",
      becomeDriver: "🚴 Become a Driver", shipWithUs: "🏢 Ship with Us",
      statDrivers: "Active Drivers", statDeliveries: "Deliveries", statRating: "App Rating",
      inTransit: "● In transit", delivering: "Eero V. is delivering", arriving: "Arriving in 8 mins",
      whyTitle: "Why Choose NadaRuns?", whySub: "We're revolutionizing delivery with technology, reliability, and care.",
      f1t: "Fast Delivery", f1d: "Average delivery time under 30 minutes",
      f2t: "Secure & Insured", f2d: "All deliveries are tracked and insured",
      f3t: "Top Rated", f3d: "4.9 star rating from 100K+ reviews",
      f4t: "24/7 Support", f4d: "Round-the-clock customer support",
      howTitle: "How It Works", howSub: "Getting started is easy, whether you're a driver or a business.",
      forDrivers: "🚴 For Drivers", driverHead: "Start earning today",
      ds1t: "Sign Up", ds1d: "Download the app and create your account",
      ds2t: "Get Verified", ds2d: "Complete KYC verification in minutes",
      ds3t: "Start Delivering", ds3d: "Accept orders and earn money",
      forBusiness: "🏢 For Business", bizHead: "Ship with confidence",
      bs1t: "Create Account", bs1d: "Register your business in minutes",
      bs2t: "Book Delivery", bs2d: "Enter pickup and delivery details",
      bs3t: "Track & Receive", bs3d: "Monitor in real-time until delivery",
      learnMore: "Learn more →",
      lovedTitle: "Loved by Thousands", lovedSub: "See what our drivers and customers are saying.",
      t1role: "Driver", t1: "Best platform for flexible work. I earn well and manage my own schedule. The app is super easy to use!",
      t2role: "Business Owner", t2: "NadaRuns has transformed our delivery operations. Fast, reliable, and their support team is amazing.",
      t3role: "Customer", t3: "Always get my orders on time. The tracking feature is amazing - I can see exactly where my package is.",
      ctaTitle: "Ready to Get Started?", ctaSub: "Join thousands of drivers and businesses already using NadaRuns.",
      startDriving: "🚴 Start Driving", shipProducts: "🏢 Ship Products",
    },
  },
  fi: {
    nav: {
      home: "Etusivu", about: "Tietoa", drivers: "Kuljettajille", business: "Yrityksille",
      download: "Lataa", contact: "Yhteystiedot",
      admin: "Hallintapaneeli", driveWithUs: "Ryhdy kuljettajaksi", getApp: "Lataa sovellus",
    },
    footer: {
      tagline: "Nopeaa ja luotettavaa toimitusta — yhdistämme kuljettajat ja yritykset kaikkialla Suomessa.",
      company: "Yritys", about: "Tietoa meistä", careers: "Työpaikat", blog: "Blogi", press: "Media",
      products: "Tuotteet", driveWith: "Aja NadaRunsin kanssa", forBusiness: "NadaRuns yrityksille",
      downloadApp: "Lataa sovellus", enterprise: "Yritysratkaisut",
      legal: "Juridiikka", terms: "Käyttöehdot", privacy: "Tietosuojaseloste", cookies: "Evästekäytäntö", gdpr: "GDPR",
      contact: "Yhteystiedot", rights: "Kaikki oikeudet pidätetään.", sitemap: "Sivukartta", accessibility: "Saavutettavuus",
    },
    home: {
      heroBadge: "⚡ Suomen #1 toimitusalusta",
      heroTitle1: "Nopea ja luotettava", heroTitle2: "toimitus", heroTitle3: "", heroTitle4: "kaikille",
      heroSub: "Löydä ammattikuljettaja nopeisiin toimituksiin tai liity kalustoomme ja ansaitse omilla aikatauluillasi.",
      becomeDriver: "🚴 Ryhdy kuljettajaksi", shipWithUs: "🏢 Lähetä kanssamme",
      statDrivers: "Aktiivista kuljettajaa", statDeliveries: "Toimitusta", statRating: "Sovelluksen arvosana",
      inTransit: "● Kuljetuksessa", delivering: "Eero V. toimittaa", arriving: "Perillä 8 min kuluttua",
      whyTitle: "Miksi valita NadaRuns?", whySub: "Uudistamme toimitukset teknologian, luotettavuuden ja huolenpidon avulla.",
      f1t: "Nopea toimitus", f1d: "Keskimääräinen toimitusaika alle 30 minuuttia",
      f2t: "Turvallinen ja vakuutettu", f2d: "Kaikki toimitukset seurataan ja vakuutetaan",
      f3t: "Korkeasti arvioitu", f3d: "4,9 tähden arvosana yli 100 000 arviosta",
      f4t: "Tuki 24/7", f4d: "Asiakaspalvelu ympäri vuorokauden",
      howTitle: "Näin se toimii", howSub: "Aloittaminen on helppoa — olitpa kuljettaja tai yritys.",
      forDrivers: "🚴 Kuljettajille", driverHead: "Aloita ansaitseminen tänään",
      ds1t: "Rekisteröidy", ds1d: "Lataa sovellus ja luo tilisi",
      ds2t: "Vahvista henkilöllisyys", ds2d: "Suorita tunnistautuminen minuuteissa",
      ds3t: "Aloita toimittaminen", ds3d: "Hyväksy tilauksia ja ansaitse rahaa",
      forBusiness: "🏢 Yrityksille", bizHead: "Lähetä luottavaisin mielin",
      bs1t: "Luo tili", bs1d: "Rekisteröi yrityksesi minuuteissa",
      bs2t: "Tilaa toimitus", bs2d: "Syötä nouto- ja toimitustiedot",
      bs3t: "Seuraa ja vastaanota", bs3d: "Seuraa reaaliajassa toimitukseen asti",
      learnMore: "Lue lisää →",
      lovedTitle: "Tuhansien suosima", lovedSub: "Katso mitä kuljettajamme ja asiakkaamme sanovat.",
      t1role: "Kuljettaja", t1: "Paras alusta joustavaan työhön. Ansaitsen hyvin ja hallitsen omaa aikatauluani. Sovellus on todella helppokäyttöinen!",
      t2role: "Yrittäjä", t2: "NadaRuns on mullistanut toimituksemme. Nopea, luotettava ja heidän tukitiiminsä on mahtava.",
      t3role: "Asiakas", t3: "Saan tilaukseni aina ajallaan. Seurantaominaisuus on loistava — näen tarkalleen missä pakettini on.",
      ctaTitle: "Valmis aloittamaan?", ctaSub: "Liity tuhansien kuljettajien ja yritysten joukkoon, jotka jo käyttävät NadaRunsia.",
      startDriving: "🚴 Aloita ajaminen", shipProducts: "🏢 Lähetä tuotteita",
    },
  },
} as const;

type Content = (typeof CONTENT)["en"];

interface Ctx { lang: Lang; setLang: (l: Lang) => void; c: Content; }
const LangContext = createContext<Ctx | null>(null);

const STORAGE_KEY = "nadaruns_lang";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("fi");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
      if (saved === "fi" || saved === "en") setLangState(saved);
    } catch { /* ignore */ }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
      document.documentElement.lang = l;
    } catch { /* ignore */ }
  }, []);

  return (
    <LangContext.Provider value={{ lang, setLang, c: CONTENT[lang] as Content }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): Ctx {
  const ctx = useContext(LangContext);
  if (!ctx) return { lang: "fi", setLang: () => {}, c: CONTENT.fi as Content };
  return ctx;
}

/** Returns the content dictionary for the active language. */
export function useContent(): Content {
  return useLang().c;
}

/** FI / EN toggle for the navbar. */
export function LangToggle() {
  const { lang, setLang } = useLang();
  const btn = (l: Lang, label: string) => (
    <button
      key={l}
      data-testid={`lang-${l}`}
      onClick={() => setLang(l)}
      style={{
        border: "none", cursor: "pointer", padding: "6px 12px", borderRadius: 8,
        fontSize: 13, fontWeight: 700,
        background: lang === l ? "#10B981" : "transparent",
        color: lang === l ? "#fff" : "#6B7280",
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", background: "#F3F4F6", borderRadius: 10, padding: 2 }} aria-label="Language selector">
      {btn("fi", "FI")}
      {btn("en", "EN")}
    </div>
  );
}
