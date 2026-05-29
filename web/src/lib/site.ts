// =============================================================
// Single source of truth for all NadaRuns marketing-site info.
// Update values here and they propagate across every page.
// (Contact details, store links and socials are placeholders
//  for now — swap them for the real ones before launch.)
// =============================================================

export const site = {
  name: "NadaRuns",
  tagline: "Fast & Reliable Delivery",
  description:
    "NadaRuns connects drivers with businesses for fast, reliable deliveries across Finland. Drive to earn on your schedule, or ship your products with real-time tracking.",
  url: "https://nadaruns.com",
  city: "Helsinki, Finland",

  company: {
    legalName: "NadaRuns Oy",
    businessId: "3456789-1", // Finnish Y-tunnus (placeholder)
    foundedYear: 2024,
  },

  contact: {
    email: "hello@nadaruns.com",
    supportEmail: "support@nadaruns.com",
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
    drivers: "10K+",
    deliveries: "500K+",
    rating: "4.9★",
    cities: "5",
  },
};

export type Site = typeof site;
