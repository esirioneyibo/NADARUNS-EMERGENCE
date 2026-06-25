// =============================================================
// Single source of truth for all NadaRuns marketing-site info.
// Update values here and they propagate across every page.
// (Contact details, store links and socials are placeholders
//  for now — swap them for the real ones before launch.)
// =============================================================

export const site = {
  name: "NadaRuns",
  tagline: "The marketplace for empty transport capacity",
  description:
    "NadaRuns matches available transport capacity and return trips with freight in real time — turning empty kilometers into revenue for carriers and faster, more competitive transport for shippers across Finland.",
  url: "https://nadaruns.com",
  city: "Helsinki, Finland",

  company: {
    legalName: "NadaRuns Oy",
    businessId: "3456789-1", // Finnish Y-tunnus (placeholder)
    foundedYear: 2024,
  },

  contact: {
    email: "care@nadaruns.com",
    supportEmail: "care@nadaruns.com",
    phone: "+358 40 123 4567",
    phoneHref: "tel:+358401234567",
    address: {
      line1: "Mannerheimintie 10",
      line2: "00100 Helsinki, Finland",
    },
    hours: [
      { days: "Mon – Fri", time: "9:00 – 18:00" },
      { days: "Sat – Sun", time: "10:00 – 16:00" },
    ],
  },

  social: {
    facebook: "https://facebook.com/nadaruns",
    twitter: "https://x.com/nadaruns",
    instagram: "https://instagram.com/nadaruns",
    linkedin: "https://linkedin.com/company/nadaruns",
  },

  // App download. While the apps are in review, set comingSoon = true and
  // the badges link to the download page / notify flow. Drop the real store
  // URLs in `ios` / `android` and flip comingSoon to false to go live.
  app: {
    ios: "#",
    android: "#",
    comingSoon: true,
  },

  stats: {
    drivers: "1,200+",
    deliveries: "2.4M km",
    rating: "18%",
    cities: "20+",
  },
};

export type Site = typeof site;
