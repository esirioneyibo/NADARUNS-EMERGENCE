"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";

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
      orderId: "Order #A249K", inTransit: "● In transit", route: "Karl Fazer Café → Mannerheimintie 15",
      delivering: "Eero V. is delivering", arriving: "Arriving in 8 mins",
      whyTitle: "Why Choose NadaRuns?", whySub: "We're revolutionizing delivery with technology, reliability, and care.",
      features: [
        { title: "Fast Delivery", desc: "Average delivery time under 30 minutes" },
        { title: "Secure & Insured", desc: "All deliveries are tracked and insured" },
        { title: "Top Rated", desc: "4.9 star rating from 100K+ reviews" },
        { title: "24/7 Support", desc: "Round-the-clock customer support" },
      ],
      howTitle: "How It Works", howSub: "Getting started is easy, whether you're a driver or a business.",
      forDrivers: "🚴 For Drivers", driverHead: "Start earning today",
      driverSteps: [
        { title: "Sign Up", desc: "Download the app and create your account" },
        { title: "Get Verified", desc: "Complete KYC verification in minutes" },
        { title: "Start Delivering", desc: "Accept orders and earn money" },
      ],
      forBusiness: "🏢 For Business", bizHead: "Ship with confidence",
      bizSteps: [
        { title: "Create Account", desc: "Register your business in minutes" },
        { title: "Book Delivery", desc: "Enter pickup and delivery details" },
        { title: "Track & Receive", desc: "Monitor in real-time until delivery" },
      ],
      learnMore: "Learn more →",
      lovedTitle: "Loved by Thousands", lovedSub: "See what our drivers and customers are saying.",
      testimonials: [
        { name: "Mikko L.", role: "Driver", text: "Best platform for flexible work. I earn well and manage my own schedule. The app is super easy to use!" },
        { name: "Sanna R.", role: "Business Owner", text: "NadaRuns has transformed our delivery operations. Fast, reliable, and their support team is amazing." },
        { name: "Aino K.", role: "Customer", text: "Always get my orders on time. The tracking feature is amazing - I can see exactly where my package is." },
      ],
      ctaTitle: "Ready to Get Started?", ctaSub: "Join thousands of drivers and businesses already using NadaRuns.",
      startDriving: "🚴 Start Driving", shipProducts: "🏢 Ship Products",
    },
    appBand: {
      badge: "📱 Get the NadaRuns app",
      title1: "Your deliveries,", title2: "in your pocket",
      sub: "Track shipments live, accept jobs, chat with drivers, and get instant alerts — all from one beautifully simple app for iOS and Android.",
      comingSoon: "Launching soon — tap a badge to get notified.",
      available: "Free to download. Available on iOS and Android.",
      inTransit: "● In transit", orderId: "Order #A249K", arriving: "Arriving in 8 mins",
      earnings: "Today’s earnings", goOnline: "Go online",
    },
    badges: { soon: "SOON", iosSub: "Download on the", iosMain: "App Store", androidSub: "GET IT ON", androidMain: "Google Play" },
    about: {
      metaTitle: "About NadaRuns — Moving Finland forward",
      heroBadge: "✨ Our story",
      heroTitle1: "Moving Finland forward,", heroTitle2: "one delivery at a time",
      heroLead: "NadaRuns is the modern logistics platform connecting trusted drivers with businesses that need to move things — from a single parcel to a full truckload — quickly, fairly and reliably.",
      statsLabels: ["Deliveries completed", "Active drivers", "Cities served", "Average rating"],
      missionBadge: "Our mission",
      missionTitle: "Logistics that’s fair for drivers and effortless for businesses",
      missionP1: "Traditional freight is slow, opaque and stacked with middlemen. We built NadaRuns to fix that — transparent pricing set up front, drivers who keep the majority of every fare, and real-time tracking from pickup to drop-off.",
      missionP2: "Whether you’re a small shop sending parcels or an enterprise moving pallets, NadaRuns gives you the right vehicle, a fair price and a driver you can trust — in minutes.",
      diffTitle: "Why we’re different",
      diffs: [
        "Up-front, transparent pricing — no surprises",
        "Drivers keep up to 80% + 100% of any bonus",
        "Live tracking and ETA on every shipment",
        "11 vehicle types, from cargo van to crane truck",
        "Built for Finland, ready for the Nordics",
      ],
      timelineHead: "Our journey so far", timelineSub: "From a Helsinki idea to a platform moving the country.",
      timeline: [
        { year: "2024", title: "NadaRuns is born", desc: "Founded in Helsinki with a simple belief: logistics should be fair for drivers and effortless for businesses." },
        { year: "2024", title: "First 1,000 deliveries", desc: "Local shops and couriers proved the model — transparent pricing and same-day matching that just works." },
        { year: "2025", title: "Eleven vehicle types", desc: "From cargo vans to crane trucks, we expanded the fleet so any cargo travels the right way." },
        { year: "Today", title: "Scaling across Finland", desc: "Thousands of verified drivers, live tracking on every order, and a roadmap that reaches the whole Nordics." },
      ],
      valuesHead: "What we stand for", valuesSub: "The principles behind every delivery we power.",
      values: [
        { title: "Reliability", desc: "Every delivery matters. We obsess over on-time pickups, accurate ETAs and proof at every step." },
        { title: "Care", desc: "We treat every package as if it were our own — handled with attention, tracked end to end." },
        { title: "Sustainability", desc: "Smart routing and return-load matching cut empty kilometres and lower emissions." },
        { title: "Trust & safety", desc: "Verified drivers, OTP hand-offs and insured shipments give everyone peace of mind." },
        { title: "Speed", desc: "Book in under a minute and get matched with a nearby driver in real time." },
        { title: "Built for the Nordics", desc: "Pricing, vehicles and coverage tuned for Finland — and ready to scale across the region." },
      ],
      ctaTitle: "Join the movement", ctaSub: "Whether you drive or you ship, NadaRuns was built for you.",
      ctaDrive: "Drive with us", ctaShip: "Ship with us",
    },
    drivers: {
      metaTitle: "Drive with NadaRuns — Earn on your schedule",
      heroBadge: "🚚 For drivers",
      heroTitle1: "Your vehicle.", heroTitle2: "Your schedule.", heroTitle3: "Your earnings.",
      heroLead: "Turn your van or truck into income. Accept delivery jobs near you, navigate in one tap, and keep the majority of every fare — with fast, transparent pay.",
      cardStatus: "● Online · earning", cardToday: "Today’s earnings",
      benefitsHead: "Why drive with NadaRuns", benefitsSub: "Everything you need to earn more, with less hassle.",
      benefits: [
        { title: "Flexible hours", desc: "Go online whenever it suits you. No shifts, no minimums — you’re always in control." },
        { title: "Keep more of every fare", desc: "Drivers keep up to 80% of the base price plus 100% of any shipper bonus." },
        { title: "Use any vehicle", desc: "From a cargo van to a semi-truck — register multiple vehicles and switch your active one anytime." },
        { title: "Built-in navigation", desc: "One-tap hand-off to Google, Apple or Waze for turn-by-turn directions." },
        { title: "Instant job alerts", desc: "Distinct sounds and push notifications the moment a matching job appears nearby." },
        { title: "Real support", desc: "A team that has your back, plus in-app chat with shippers on every delivery." },
      ],
      payBadge: "💸 Transparent pay",
      payTitle: "See exactly what you’ll earn — before you accept",
      payP1: "No guesswork and no hidden cuts. Every job shows your projected payout up front, so you always know what a delivery is worth before you swipe to accept.",
      payP2: "You keep up to 80% of the base fare and 100% of any bonus the shipper adds on top.",
      payCardTitle: "Sample job payout",
      payRows: [
        { k: "Base fare", v: "€42.00" },
        { k: "Shipper bonus", v: "€8.00" },
        { k: "Platform fee (20%)", v: "−€8.40" },
      ],
      payReceive: "You receive",
      stepsHead: "Start earning in 4 steps",
      steps: [
        { title: "Sign up", desc: "Create your driver account and add your vehicle details in minutes." },
        { title: "Go online", desc: "Open the app, go online, and see paid jobs on the map near you." },
        { title: "Accept & deliver", desc: "Swipe to accept, navigate to pickup, and complete the drop-off with OTP." },
        { title: "Get paid", desc: "Earnings land in your wallet — track today, this week and all-time." },
      ],
      reqTitle: "What you’ll need",
      reqLead: "Getting verified is quick. Have these ready and you can be online today.",
      requirements: [
        "Valid driver’s licence for your vehicle class",
        "Vehicle registration & insurance",
        "Smartphone (iOS or Android)",
        "Right to work in Finland",
      ],
      readyTitle: "Ready to roll?", readyDesc: "Download the app and go online today.",
      faqHead: "Driver questions, answered",
      faqs: [
        { q: "How much can I earn?", a: "Earnings depend on the hours you drive and your vehicle type. You keep up to 80% of every base fare plus 100% of any bonus a shipper adds — and you can see your projected payout before you accept." },
        { q: "Which vehicles can I drive?", a: "Anything you’re licensed and insured for, from a cargo van to a semi-truck. You can register multiple vehicles and switch your active one whenever you like." },
        { q: "When and how do I get paid?", a: "Your earnings are tracked live in the app — today, this week and all-time — and paid out to your account on a regular weekly cycle." },
        { q: "Do I need my own company?", a: "No. Light-entrepreneurs and sole traders are welcome. You just need a valid licence, registration and insurance for your vehicle." },
        { q: "Can I choose which jobs I take?", a: "Always. You only ever accept the jobs that suit your route, vehicle and schedule — there are no forced dispatches." },
      ],
      ctaTitle: "Your next delivery is waiting", ctaSub: "Download the app, go online, and start earning on your own terms.",
    },
    business: {
      metaTitle: "NadaRuns for Business — Ship smarter",
      heroBadge: "📦 For business",
      heroTitle1: "Ship anything,", heroTitle2: "anywhere in Finland",
      heroLead: "From a single parcel to a full truckload — get an instant, transparent price, a verified driver, and live tracking from pickup to delivery.",
      ctaStart: "Start shipping", ctaSales: "Talk to sales",
      priceLabel: "Estimated price", priceRoute: "Helsinki → Espoo · 22 km",
      priceRows: [
        { k: "Base fee", v: "€12.00" },
        { k: "Distance", v: "€24.20" },
        { k: "Weight (80 kg)", v: "€10.00" },
        { k: "Fuel (8%)", v: "€3.70" },
      ],
      featuresHead: "Everything your logistics needs", featuresSub: "Powerful, transparent and built to scale with your business.",
      features: [
        { title: "Book in under a minute", desc: "A 6-step wizard gives you an instant, transparent quote before you confirm." },
        { title: "Live tracking", desc: "Watch your shipment on the map with live ETA from pickup to drop-off." },
        { title: "Proof of delivery", desc: "OTP hand-offs and delivery confirmation on every order — fully insured." },
        { title: "Transparent pricing", desc: "Base + distance + weight, shown up front. No hidden fees, no haggling." },
        { title: "Any cargo", desc: "Parcels, pallets, oversized or refrigerated — the right vehicle every time." },
        { title: "Priority support", desc: "Dedicated help and in-app chat with your driver on every shipment." },
      ],
      fleetHead: "One platform, every vehicle", fleetSub: "Eleven vehicle types so your cargo always travels the right way.",
      fleet: [
        { name: "Cargo Van", note: "Up to 1,500 kg" },
        { name: "Box Truck", note: "Up to 5,000 kg" },
        { name: "Flatbed", note: "Up to 8,000 kg" },
        { name: "Semi-Truck", note: "Up to 20,000 kg" },
        { name: "Refrigerated", note: "Temperature-controlled" },
        { name: "Crane / Hazmat", note: "Specialized handling" },
      ],
      stepsHead: "How it works",
      steps: [
        { title: "Create a shipment", desc: "Enter pickup, drop-off, cargo and vehicle — get an instant price." },
        { title: "Get matched", desc: "A nearby verified driver accepts and heads to pickup." },
        { title: "Track live", desc: "Follow the delivery in real time and chat with your driver." },
        { title: "Delivered", desc: "Confirmed with OTP and proof of delivery. Done." },
      ],
      industriesHead: "Built for every industry", industriesSub: "From corner shops to factories — teams across Finland move with NadaRuns.",
      industries: [
        { title: "Retail & e-commerce", desc: "Same-day parcel and order delivery that keeps customers coming back." },
        { title: "Food & grocery", desc: "Temperature-controlled vehicles keep perishables fresh, every trip." },
        { title: "Construction", desc: "Move tools, materials and pallets to site with flatbeds and cranes." },
        { title: "Manufacturing", desc: "Reliable B2B freight between warehouses, plants and distributors." },
        { title: "Pharma & healthcare", desc: "Careful, tracked handling for sensitive and time-critical deliveries." },
        { title: "Furniture & bulky goods", desc: "Box trucks and crews for oversized items, handled with care." },
      ],
      faqHead: "Frequently asked questions",
      faqs: [
        { q: "How is the price calculated?", a: "Pricing combines a base fee, distance, cargo weight, vehicle type, urgency and a small fuel component — and the full quote is shown up front before you confirm. No hidden fees." },
        { q: "How fast will a driver be matched?", a: "Usually within minutes. We match your shipment with the nearest verified driver whose vehicle fits your cargo." },
        { q: "Can I track my delivery?", a: "Yes. Every order includes a live map with the driver’s location and ETA, plus in-app chat from pickup to drop-off." },
        { q: "What can I ship?", a: "Anything from a single parcel to a full truckload. With 11 vehicle types — including refrigerated and specialized handling — there’s a fit for almost any cargo." },
        { q: "Do you offer business accounts?", a: "Yes. For regular or high-volume shipping, talk to our team about a business account with consolidated billing and priority support." },
      ],
      ctaTitle: "Ready to ship smarter?", ctaSub: "Get your first quote in under a minute.",
      ctaGetApp: "Get the app", ctaContact: "Contact sales",
    },
    contact: {
      heroBadge: "💬 Get in touch",
      heroTitle1: "We’d love to", heroTitle2: "hear from you",
      heroLead: "Questions, partnerships or support — our team usually replies within one business day.",
      methodEmail: "Email us", methodCall: "Call us", methodVisit: "Visit us",
      formTitle: "Send us a message",
      labelName: "Your name", labelEmail: "Email", labelSubject: "Subject", labelMessage: "Message",
      phName: "Jane Doe", phEmail: "jane@company.com", phSubject: "How can we help?", phMessage: "Tell us a bit more…",
      send: "Send message", sending: "Sending…",
      sentTitle: "Message sent!", sentDesc: "Thanks for reaching out — we’ll get back to you shortly.", sendAnother: "Send another",
      hoursTitle: "Support hours",
      faqHead: "Quick answers",
      faqs: [
        { q: "How quickly will you reply?", a: "Our team usually responds within one business day. For anything urgent about a live order, in-app support is the fastest route." },
        { q: "I need help with an order", a: "The quickest way is through in-app support, where we can see your shipment details. You can also email us and we’ll pick it up as soon as possible." },
        { q: "Are you hiring drivers?", a: "Yes! We’re always welcoming new drivers across Finland. Head to the For Drivers page to learn how it works and download the app." },
        { q: "Do you serve my city?", a: "We’re expanding quickly across Finland. Send us a message with your location and we’ll let you know about coverage in your area." },
      ],
    },
    download: {
      metaTitle: "Download the NadaRuns App — iOS & Android",
      heroBadge: "⬇️ Download NadaRuns",
      heroTitle1: "Get the app.", heroTitle2: "Move everything.",
      heroLeadSoon: "One app for drivers and businesses. Launching soon on the App Store and Google Play — tap below to get notified.",
      heroLeadLive: "One app for drivers and businesses. Available now on the App Store and Google Play.",
      scan: "Scan to download",
      featuresHead: "Everything in one app", featuresSub: "Built for speed, reliability and a delightful experience.",
      features: [
        { title: "Live tracking", desc: "Follow every delivery on the map from pickup to drop-off." },
        { title: "Instant alerts", desc: "Distinct sounds & push notifications for every key event." },
        { title: "Earnings dashboard", desc: "Drivers see today, this week and total earnings at a glance." },
        { title: "In-app chat", desc: "Message between shipper and driver without sharing numbers." },
        { title: "Secure & insured", desc: "OTP hand-offs and proof-of-delivery on every order." },
        { title: "Fast booking", desc: "Create a shipment in under a minute with instant pricing." },
      ],
      ctaTitle: "Ready when you are", ctaSub: "Download NadaRuns and start moving in minutes.",
    },
    legal: {
      eyebrow: "Legal", lastUpdatedLabel: "Last updated:",
      templateNotice: "Template notice:",
      templateBody: "This document is a scaffold provided for layout and structure. The final wording must be reviewed and approved by qualified legal counsel and comply with Finnish and EU law before NadaRuns accepts real customers or payments.",
      companyDetails: "Company details", businessId: "Business ID (Y-tunnus):", support: "Support:", general: "General enquiries:",
      backHome: "← Back to home", toBeSet: "To be set on publication",
      gdpr: {
        metaTitle: "GDPR & Your Rights — NadaRuns",
        title: "GDPR & Your Data Rights",
        intro: "NadaRuns Oy is committed to protecting your personal data in line with the EU General Data Protection Regulation (GDPR). This page summarises your rights and how to exercise them.",
        sections: [
          { heading: "Your rights at a glance", bullets: ["Right to be informed about how your data is used.", "Right of access to the personal data we hold about you.", "Right to rectification of inaccurate data.", "Right to erasure (\u201cright to be forgotten\u201d), within legal limits.", "Right to restrict processing.", "Right to data portability.", "Right to object to processing based on legitimate interests or direct marketing.", "Rights regarding automated decision-making and profiling."] },
          { heading: "How to exercise your rights", paragraphs: ["Send a request to support@nadaruns.com. We will verify your identity and respond within one month, as required by the GDPR. There is normally no charge for a request."] },
          { heading: "Data we process & why", paragraphs: ["Cross-references the Privacy Policy for the categories of data, purposes and legal bases."] },
          { heading: "Sub-processors", paragraphs: ["We maintain a list of sub-processors (e.g. Stripe for payments, Google Maps, cloud hosting) and keep data-processing agreements in place."] },
          { heading: "Data breach procedure", paragraphs: ["Outline of our process for detecting, reporting and notifying relevant breaches to the supervisory authority and affected users where required."] },
          { heading: "Supervisory authority", paragraphs: ["You have the right to lodge a complaint with the Office of the Data Protection Ombudsman of Finland (tietosuojavaltuutetun toimisto)."] },
        ],
      },
      privacy: {
        metaTitle: "Privacy Policy — NadaRuns",
        title: "Privacy Policy",
        intro: "This Privacy Policy explains how NadaRuns Oy (\"we\") collects, uses, shares and protects personal data when you use NadaRuns. We act as the data controller and process personal data in accordance with the EU General Data Protection Regulation (GDPR) and the Finnish Data Protection Act.",
        sections: [
          { heading: "Data controller", paragraphs: ["NadaRuns Oy, Business ID 3456789-1, Mannerheimintie 10, 00100 Helsinki, Finland. For privacy matters contact support@nadaruns.com."] },
          { heading: "Data we collect", bullets: ["Account data: name, email, phone, password (hashed).", "Driver verification (KYC): identity document, driving licence, vehicle documents.", "Order data: pickup/dropoff addresses, cargo details, timestamps.", "Location data: driver GPS location while online/on a delivery.", "Payment data: handled by our processor (Stripe); we store limited transaction metadata, not full card numbers.", "Device & usage data: app/website analytics, log data."] },
          { heading: "How we use your data & legal bases", paragraphs: ["Purposes include providing the service (performance of a contract), safety and fraud prevention and legal compliance (legal obligation), service improvement and marketing (legitimate interest or consent)."] },
          { heading: "Sharing & processors", paragraphs: ["We share data with sub-processors strictly as needed: payment processing (Stripe), mapping (Google Maps), cloud hosting, and communications. Each acts under a data-processing agreement."] },
          { heading: "International transfers", paragraphs: ["Where data is transferred outside the EU/EEA, we rely on appropriate safeguards such as Standard Contractual Clauses."] },
          { heading: "Retention", paragraphs: ["How long each category of data is kept and the criteria used to determine retention periods."] },
          { heading: "Your rights", paragraphs: ["Under the GDPR you have the right to access, rectify, erase, restrict, object and port your data, and to withdraw consent. See the GDPR page for how to exercise them."] },
          { heading: "Security", paragraphs: ["Technical and organisational measures protecting your data (encryption in transit, hashed passwords, access controls)."] },
          { heading: "Cookies", paragraphs: ["Our website uses cookies as described in the Cookie Policy."] },
          { heading: "Contact & complaints", paragraphs: ["Contact support@nadaruns.com with any privacy questions. You also have the right to lodge a complaint with the Finnish Data Protection Ombudsman (tietosuojavaltuutettu)."] },
        ],
      },
      terms: {
        metaTitle: "Terms of Service — NadaRuns",
        title: "Terms of Service",
        intro: "These Terms of Service (\"Terms\") govern your access to and use of the NadaRuns platform, websites and mobile applications operated by NadaRuns Oy. By creating an account or using the service you agree to these Terms.",
        sections: [
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
        ],
      },
      cookies: {
        metaTitle: "Cookie Policy — NadaRuns",
        title: "Cookie Policy",
        intro: "This Cookie Policy explains how NadaRuns uses cookies and similar technologies on our website, and how you can control them. It should be read together with our Privacy Policy.",
        sections: [
          { heading: "What are cookies", paragraphs: ["A short, plain-language explanation of cookies and similar technologies (local storage, pixels)."] },
          { heading: "Categories of cookies we use", bullets: ["Strictly necessary — required for the site to function (e.g. session, security).", "Preferences — remember choices such as language.", "Analytics — help us understand usage and improve the service.", "Marketing — measure campaigns (only with consent)."] },
          { heading: "Managing your preferences", paragraphs: ["How users can accept/reject non-essential cookies via the consent banner and their browser settings. Non-essential cookies are only set after consent."] },
          { heading: "Third-party cookies", paragraphs: ["List third parties that may set cookies (e.g. analytics, payment, maps) and link to their policies."] },
          { heading: "Updates", paragraphs: ["How changes to this policy are communicated."] },
        ],
      },
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
      orderId: "Tilaus #A249K", inTransit: "● Kuljetuksessa", route: "Karl Fazer Café → Mannerheimintie 15",
      delivering: "Eero V. toimittaa", arriving: "Perillä 8 min kuluttua",
      whyTitle: "Miksi valita NadaRuns?", whySub: "Uudistamme toimitukset teknologian, luotettavuuden ja huolenpidon avulla.",
      features: [
        { title: "Nopea toimitus", desc: "Keskimääräinen toimitusaika alle 30 minuuttia" },
        { title: "Turvallinen ja vakuutettu", desc: "Kaikki toimitukset seurataan ja vakuutetaan" },
        { title: "Korkeasti arvioitu", desc: "4,9 tähden arvosana yli 100 000 arviosta" },
        { title: "Tuki 24/7", desc: "Asiakaspalvelu ympäri vuorokauden" },
      ],
      howTitle: "Näin se toimii", howSub: "Aloittaminen on helppoa — olitpa kuljettaja tai yritys.",
      forDrivers: "🚴 Kuljettajille", driverHead: "Aloita ansaitseminen tänään",
      driverSteps: [
        { title: "Rekisteröidy", desc: "Lataa sovellus ja luo tilisi" },
        { title: "Vahvista henkilöllisyys", desc: "Suorita tunnistautuminen minuuteissa" },
        { title: "Aloita toimittaminen", desc: "Hyväksy tilauksia ja ansaitse rahaa" },
      ],
      forBusiness: "🏢 Yrityksille", bizHead: "Lähetä luottavaisin mielin",
      bizSteps: [
        { title: "Luo tili", desc: "Rekisteröi yrityksesi minuuteissa" },
        { title: "Tilaa toimitus", desc: "Syötä nouto- ja toimitustiedot" },
        { title: "Seuraa ja vastaanota", desc: "Seuraa reaaliajassa toimitukseen asti" },
      ],
      learnMore: "Lue lisää →",
      lovedTitle: "Tuhansien suosima", lovedSub: "Katso mitä kuljettajamme ja asiakkaamme sanovat.",
      testimonials: [
        { name: "Mikko L.", role: "Kuljettaja", text: "Paras alusta joustavaan työhön. Ansaitsen hyvin ja hallitsen omaa aikatauluani. Sovellus on todella helppokäyttöinen!" },
        { name: "Sanna R.", role: "Yrittäjä", text: "NadaRuns on mullistanut toimituksemme. Nopea, luotettava ja heidän tukitiiminsä on mahtava." },
        { name: "Aino K.", role: "Asiakas", text: "Saan tilaukseni aina ajallaan. Seurantaominaisuus on loistava — näen tarkalleen missä pakettini on." },
      ],
      ctaTitle: "Valmis aloittamaan?", ctaSub: "Liity tuhansien kuljettajien ja yritysten joukkoon, jotka jo käyttävät NadaRunsia.",
      startDriving: "🚴 Aloita ajaminen", shipProducts: "🏢 Lähetä tuotteita",
    },
    appBand: {
      badge: "📱 Hanki NadaRuns-sovellus",
      title1: "Toimituksesi,", title2: "taskussasi",
      sub: "Seuraa lähetyksiä reaaliajassa, hyväksy keikkoja, keskustele kuljettajien kanssa ja saat välittömät ilmoitukset — kaikki yhdessä kauniin yksinkertaisessa sovelluksessa iOS:lle ja Androidille.",
      comingSoon: "Julkaistaan pian — napauta merkkiä saadaksesi ilmoituksen.",
      available: "Ilmainen ladata. Saatavilla iOS:lle ja Androidille.",
      inTransit: "● Kuljetuksessa", orderId: "Tilaus #A249K", arriving: "Perillä 8 min kuluttua",
      earnings: "Tämän päivän ansiot", goOnline: "Mene online-tilaan",
    },
    badges: { soon: "PIAN", iosSub: "Lataa", iosMain: "App Storesta", androidSub: "SAATAVILLA", androidMain: "Google Playssa" },
    about: {
      metaTitle: "Tietoa NadaRunsista — Vie Suomea eteenpäin",
      heroBadge: "✨ Tarinamme",
      heroTitle1: "Viemme Suomea eteenpäin,", heroTitle2: "yksi toimitus kerrallaan",
      heroLead: "NadaRuns on moderni logistiikka-alusta, joka yhdistää luotettavat kuljettajat ja yritykset, joiden täytyy kuljettaa tavaraa — yksittäisestä paketista täyteen kuormaan — nopeasti, reilusti ja luotettavasti.",
      statsLabels: ["Tehtyä toimitusta", "Aktiivista kuljettajaa", "Palveltua kaupunkia", "Keskiarvosana"],
      missionBadge: "Missiomme",
      missionTitle: "Logistiikkaa, joka on reilua kuljettajille ja vaivatonta yrityksille",
      missionP1: "Perinteinen rahtiliikenne on hidasta, läpinäkymätöntä ja täynnä välikäsiä. Rakensimme NadaRunsin korjataksemme tämän — läpinäkyvä hinnoittelu etukäteen, kuljettajat jotka pitävät suurimman osan jokaisesta maksusta, ja reaaliaikainen seuranta noudosta toimitukseen.",
      missionP2: "Olitpa pieni liike, joka lähettää paketteja, tai suuryritys, joka kuljettaa lavoja, NadaRuns tarjoaa sinulle oikean ajoneuvon, reilun hinnan ja luotettavan kuljettajan — minuuteissa.",
      diffTitle: "Miksi olemme erilaisia",
      diffs: [
        "Läpinäkyvä hinnoittelu etukäteen — ei yllätyksiä",
        "Kuljettajat pitävät jopa 80 % + 100 % bonuksista",
        "Reaaliaikainen seuranta ja arvioitu saapumisaika jokaisessa lähetyksessä",
        "11 ajoneuvotyyppiä, pakettiautosta nosturiautoon",
        "Rakennettu Suomelle, valmis Pohjoismaihin",
      ],
      timelineHead: "Matkamme tähän asti", timelineSub: "Helsinkiläisestä ideasta koko maata liikuttavaksi alustaksi.",
      timeline: [
        { year: "2024", title: "NadaRuns syntyy", desc: "Perustettu Helsingissä yksinkertaisen ajatuksen pohjalta: logistiikan tulisi olla reilua kuljettajille ja vaivatonta yrityksille." },
        { year: "2024", title: "Ensimmäiset 1 000 toimitusta", desc: "Paikalliset liikkeet ja kuriirit todistivat mallin toimivuuden — läpinäkyvä hinnoittelu ja saman päivän yhdistäminen, joka vain toimii." },
        { year: "2025", title: "Yksitoista ajoneuvotyyppiä", desc: "Pakettiautoista nosturiautoihin laajensimme kalustoa, jotta kaikki kuorma matkaa oikealla tavalla." },
        { year: "Tänään", title: "Skaalaamme kaikkialle Suomeen", desc: "Tuhansia vahvistettuja kuljettajia, reaaliaikainen seuranta jokaisessa tilauksessa ja tiekartta, joka ulottuu koko Pohjolaan." },
      ],
      valuesHead: "Mitä edustamme", valuesSub: "Periaatteet jokaisen toimittamamme toimituksen takana.",
      values: [
        { title: "Luotettavuus", desc: "Jokainen toimitus on tärkeä. Panostamme ajallaan tapahtuviin noutoihin, tarkkoihin saapumisaikoihin ja todisteisiin jokaisessa vaiheessa." },
        { title: "Huolenpito", desc: "Käsittelemme jokaista pakettia kuin omaamme — huolellisesti ja seurattuna alusta loppuun." },
        { title: "Kestävyys", desc: "Älykäs reititys ja paluukuormien yhdistäminen vähentävät tyhjiä kilometrejä ja päästöjä." },
        { title: "Luottamus ja turvallisuus", desc: "Vahvistetut kuljettajat, OTP-luovutukset ja vakuutetut lähetykset tuovat mielenrauhan kaikille." },
        { title: "Nopeus", desc: "Tilaa alle minuutissa ja löydä lähellä oleva kuljettaja reaaliajassa." },
        { title: "Rakennettu Pohjoismaihin", desc: "Hinnoittelu, ajoneuvot ja kattavuus viritetty Suomelle — ja valmis skaalautumaan koko alueelle." },
      ],
      ctaTitle: "Liity liikkeeseen", ctaSub: "Ajoitpa tai lähetitpä, NadaRuns on rakennettu sinua varten.",
      ctaDrive: "Ryhdy kuljettajaksi", ctaShip: "Lähetä kanssamme",
    },
    drivers: {
      metaTitle: "Aja NadaRunsin kanssa — Ansaitse omilla aikatauluillasi",
      heroBadge: "🚚 Kuljettajille",
      heroTitle1: "Ajoneuvosi.", heroTitle2: "Aikataulusi.", heroTitle3: "Ansiosi.",
      heroLead: "Muuta pakettiautosi tai kuorma-autosi tuloksi. Hyväksy toimituskeikkoja läheltäsi, navigoi yhdellä napautuksella ja pidä suurin osa jokaisesta maksusta — nopealla ja läpinäkyvällä palkalla.",
      cardStatus: "● Online · ansaitsee", cardToday: "Tämän päivän ansiot",
      benefitsHead: "Miksi ajaa NadaRunsin kanssa", benefitsSub: "Kaikki mitä tarvitset ansaitaksesi enemmän, vähemmällä vaivalla.",
      benefits: [
        { title: "Joustavat työajat", desc: "Mene online-tilaan milloin sinulle sopii. Ei vuoroja, ei minimimääriä — olet aina hallinnassa." },
        { title: "Pidä suurempi osa jokaisesta maksusta", desc: "Kuljettajat pitävät jopa 80 % perushinnasta ja 100 % lähettäjän bonuksesta." },
        { title: "Käytä mitä tahansa ajoneuvoa", desc: "Pakettiautosta puoliperävaunuun — rekisteröi useita ajoneuvoja ja vaihda aktiivista milloin tahansa." },
        { title: "Sisäänrakennettu navigointi", desc: "Yhden napautuksen siirto Googleen, Appleen tai Wazeen käännöskohtaisia ohjeita varten." },
        { title: "Välittömät keikkailmoitukset", desc: "Selkeät äänet ja push-ilmoitukset heti kun sopiva keikka ilmestyy lähelle." },
        { title: "Aitoa tukea", desc: "Tiimi, joka tukee sinua, sekä sovelluksen sisäinen chat lähettäjien kanssa jokaisessa toimituksessa." },
      ],
      payBadge: "💸 Läpinäkyvä palkka",
      payTitle: "Näe tarkalleen mitä ansaitset — ennen kuin hyväksyt",
      payP1: "Ei arvailua eikä piilokuluja. Jokainen keikka näyttää arvioidun maksusi etukäteen, joten tiedät aina mitä toimitus on arvoltaan ennen kuin hyväksyt.",
      payP2: "Pidät jopa 80 % perusmaksusta ja 100 % bonuksesta, jonka lähettäjä lisää päälle.",
      payCardTitle: "Esimerkki keikan maksusta",
      payRows: [
        { k: "Perusmaksu", v: "42,00 €" },
        { k: "Lähettäjän bonus", v: "8,00 €" },
        { k: "Alustamaksu (20 %)", v: "−8,40 €" },
      ],
      payReceive: "Saat",
      stepsHead: "Aloita ansaitseminen 4 vaiheessa",
      steps: [
        { title: "Rekisteröidy", desc: "Luo kuljettajatilisi ja lisää ajoneuvosi tiedot minuuteissa." },
        { title: "Mene online-tilaan", desc: "Avaa sovellus, mene online-tilaan ja näe maksetut keikat kartalla lähelläsi." },
        { title: "Hyväksy ja toimita", desc: "Pyyhkäise hyväksyäksesi, navigoi noutoon ja viimeistele toimitus OTP:llä." },
        { title: "Saat maksun", desc: "Ansiot ilmestyvät lompakkoosi — seuraa tätä päivää, tätä viikkoa ja koko ajan." },
      ],
      reqTitle: "Mitä tarvitset",
      reqLead: "Vahvistaminen on nopeaa. Pidä nämä valmiina, niin voit olla online-tilassa jo tänään.",
      requirements: [
        "Voimassa oleva ajokortti ajoneuvoluokallesi",
        "Ajoneuvon rekisteröinti ja vakuutus",
        "Älypuhelin (iOS tai Android)",
        "Oikeus työskennellä Suomessa",
      ],
      readyTitle: "Valmiina liikkeelle?", readyDesc: "Lataa sovellus ja mene online-tilaan jo tänään.",
      faqHead: "Kuljettajien kysymyksiin vastattu",
      faqs: [
        { q: "Kuinka paljon voin ansaita?", a: "Ansiot riippuvat ajamistasi tunneista ja ajoneuvotyypistäsi. Pidät jopa 80 % jokaisesta perusmaksusta ja 100 % lähettäjän lisäämästä bonuksesta — ja näet arvioidun maksusi ennen kuin hyväksyt." },
        { q: "Mitä ajoneuvoja voin ajaa?", a: "Mitä tahansa, mihin sinulla on lupa ja vakuutus, pakettiautosta puoliperävaunuun. Voit rekisteröidä useita ajoneuvoja ja vaihtaa aktiivista milloin haluat." },
        { q: "Milloin ja miten saan maksun?", a: "Ansiosi seurataan reaaliajassa sovelluksessa — tänään, tällä viikolla ja koko ajan — ja maksetaan tilillesi säännöllisellä viikkosyklillä." },
        { q: "Tarvitsenko oman yrityksen?", a: "Et. Kevytyrittäjät ja toiminimet ovat tervetulleita. Tarvitset vain voimassa olevan ajokortin, rekisteröinnin ja vakuutuksen ajoneuvollesi." },
        { q: "Voinko valita mitkä keikat otan?", a: "Aina. Hyväksyt vain ne keikat, jotka sopivat reitillesi, ajoneuvollesi ja aikataulullesi — ei pakkojakoja." },
      ],
      ctaTitle: "Seuraava toimituksesi odottaa", ctaSub: "Lataa sovellus, mene online-tilaan ja aloita ansaitseminen omilla ehdoillasi.",
    },
    business: {
      metaTitle: "NadaRuns yrityksille — Lähetä älykkäämmin",
      heroBadge: "📦 Yrityksille",
      heroTitle1: "Lähetä mitä tahansa,", heroTitle2: "minne tahansa Suomessa",
      heroLead: "Yksittäisestä paketista täyteen kuormaan — saat välittömän, läpinäkyvän hinnan, vahvistetun kuljettajan ja reaaliaikaisen seurannan noudosta toimitukseen.",
      ctaStart: "Aloita lähettäminen", ctaSales: "Keskustele myynnin kanssa",
      priceLabel: "Arvioitu hinta", priceRoute: "Helsinki → Espoo · 22 km",
      priceRows: [
        { k: "Perusmaksu", v: "12,00 €" },
        { k: "Etäisyys", v: "24,20 €" },
        { k: "Paino (80 kg)", v: "10,00 €" },
        { k: "Polttoaine (8 %)", v: "3,70 €" },
      ],
      featuresHead: "Kaikki mitä logistiikkasi tarvitsee", featuresSub: "Tehokas, läpinäkyvä ja rakennettu skaalautumaan yrityksesi mukana.",
      features: [
        { title: "Tilaa alle minuutissa", desc: "6-vaiheinen ohjattu toiminto antaa välittömän, läpinäkyvän tarjouksen ennen vahvistusta." },
        { title: "Reaaliaikainen seuranta", desc: "Seuraa lähetystäsi kartalla reaaliaikaisella saapumisajalla noudosta toimitukseen." },
        { title: "Toimitustodistus", desc: "OTP-luovutukset ja toimitusvahvistus jokaisessa tilauksessa — täysin vakuutettu." },
        { title: "Läpinäkyvä hinnoittelu", desc: "Perusmaksu + etäisyys + paino, näytetään etukäteen. Ei piilokuluja, ei tinkimistä." },
        { title: "Mikä tahansa kuorma", desc: "Paketit, lavat, ylisuuret tai kylmäkuljetukset — oikea ajoneuvo joka kerta." },
        { title: "Priorisoitu tuki", desc: "Oma apu ja sovelluksen sisäinen chat kuljettajasi kanssa jokaisessa lähetyksessä." },
      ],
      fleetHead: "Yksi alusta, jokainen ajoneuvo", fleetSub: "Yksitoista ajoneuvotyyppiä, jotta kuormasi matkaa aina oikealla tavalla.",
      fleet: [
        { name: "Pakettiauto", note: "Enintään 1 500 kg" },
        { name: "Kuorma-auto", note: "Enintään 5 000 kg" },
        { name: "Lavetti", note: "Enintään 8 000 kg" },
        { name: "Puoliperävaunu", note: "Enintään 20 000 kg" },
        { name: "Kylmäkuljetus", note: "Lämpötilasäädelty" },
        { name: "Nosturi / Vaaralliset aineet", note: "Erikoiskäsittely" },
      ],
      stepsHead: "Näin se toimii",
      steps: [
        { title: "Luo lähetys", desc: "Syötä nouto, toimitus, kuorma ja ajoneuvo — saat välittömän hinnan." },
        { title: "Yhdistetään", desc: "Lähellä oleva vahvistettu kuljettaja hyväksyy ja lähtee noutoon." },
        { title: "Seuraa reaaliajassa", desc: "Seuraa toimitusta reaaliajassa ja keskustele kuljettajasi kanssa." },
        { title: "Toimitettu", desc: "Vahvistettu OTP:llä ja toimitustodistuksella. Valmis." },
      ],
      industriesHead: "Rakennettu jokaiselle toimialalle", industriesSub: "Pienistä liikkeistä tehtaisiin — tiimit kaikkialla Suomessa liikkuvat NadaRunsin kanssa.",
      industries: [
        { title: "Vähittäiskauppa ja verkkokauppa", desc: "Saman päivän paketti- ja tilaustoimitus, joka pitää asiakkaat tyytyväisinä." },
        { title: "Ruoka ja päivittäistavarat", desc: "Lämpötilasäädellyt ajoneuvot pitävät tuoretuotteet tuoreina joka matkalla." },
        { title: "Rakentaminen", desc: "Kuljeta työkalut, materiaalit ja lavat työmaalle laveteilla ja nostureilla." },
        { title: "Valmistus", desc: "Luotettava B2B-rahti varastojen, tehtaiden ja jakelijoiden välillä." },
        { title: "Lääke- ja terveydenhuolto", desc: "Huolellinen, seurattu käsittely arkaluonteisille ja aikakriittisille toimituksille." },
        { title: "Huonekalut ja isot tavarat", desc: "Kuorma-autot ja työryhmät ylisuurille tavaroille, huolella käsiteltynä." },
      ],
      faqHead: "Usein kysytyt kysymykset",
      faqs: [
        { q: "Miten hinta lasketaan?", a: "Hinnoittelu yhdistää perusmaksun, etäisyyden, kuorman painon, ajoneuvotyypin, kiireellisyyden ja pienen polttoaineosuuden — ja koko tarjous näytetään etukäteen ennen vahvistusta. Ei piilokuluja." },
        { q: "Kuinka nopeasti kuljettaja löytyy?", a: "Yleensä minuuteissa. Yhdistämme lähetyksesi lähimpään vahvistettuun kuljettajaan, jonka ajoneuvo sopii kuormaasi." },
        { q: "Voinko seurata toimitustani?", a: "Kyllä. Jokainen tilaus sisältää reaaliaikaisen kartan kuljettajan sijainnista ja saapumisajasta sekä sovelluksen sisäisen chatin noudosta toimitukseen." },
        { q: "Mitä voin lähettää?", a: "Mitä tahansa yksittäisestä paketista täyteen kuormaan. 11 ajoneuvotyypillä — mukaan lukien kylmäkuljetukset ja erikoiskäsittely — löytyy sopiva lähes mille tahansa kuormalle." },
        { q: "Tarjoatteko yritystilejä?", a: "Kyllä. Säännölliseen tai suureen lähetysmäärään keskustele tiimimme kanssa yritystilistä, jossa on yhdistetty laskutus ja priorisoitu tuki." },
      ],
      ctaTitle: "Valmis lähettämään älykkäämmin?", ctaSub: "Saat ensimmäisen tarjouksesi alle minuutissa.",
      ctaGetApp: "Lataa sovellus", ctaContact: "Ota yhteyttä myyntiin",
    },
    contact: {
      heroBadge: "💬 Ota yhteyttä",
      heroTitle1: "Kuulisimme", heroTitle2: "mielellämme sinusta",
      heroLead: "Kysymykset, kumppanuudet tai tuki — tiimimme vastaa yleensä yhden työpäivän kuluessa.",
      methodEmail: "Lähetä sähköpostia", methodCall: "Soita meille", methodVisit: "Vieraile luonamme",
      formTitle: "Lähetä meille viesti",
      labelName: "Nimesi", labelEmail: "Sähköposti", labelSubject: "Aihe", labelMessage: "Viesti",
      phName: "Matti Meikäläinen", phEmail: "matti@yritys.fi", phSubject: "Miten voimme auttaa?", phMessage: "Kerro hieman lisää…",
      send: "Lähetä viesti", sending: "Lähetetään…",
      sentTitle: "Viesti lähetetty!", sentDesc: "Kiitos yhteydenotostasi — palaamme asiaan pian.", sendAnother: "Lähetä toinen",
      hoursTitle: "Tukiajat",
      faqHead: "Nopeat vastaukset",
      faqs: [
        { q: "Kuinka nopeasti vastaatte?", a: "Tiimimme vastaa yleensä yhden työpäivän kuluessa. Kaikessa kiireellisessä elävää tilausta koskevassa sovelluksen sisäinen tuki on nopein reitti." },
        { q: "Tarvitsen apua tilauksen kanssa", a: "Nopein tapa on sovelluksen sisäinen tuki, jossa näemme lähetyksesi tiedot. Voit myös lähettää meille sähköpostia, niin tartumme siihen mahdollisimman pian." },
        { q: "Palkkaatteko kuljettajia?", a: "Kyllä! Otamme aina vastaan uusia kuljettajia kaikkialla Suomessa. Siirry Kuljettajille-sivulle oppiaksesi miten se toimii ja lataa sovellus." },
        { q: "Palveletteko kaupungissani?", a: "Laajennamme nopeasti kaikkialle Suomeen. Lähetä meille viesti sijainnistasi, niin kerromme alueesi kattavuudesta." },
      ],
    },
    download: {
      metaTitle: "Lataa NadaRuns-sovellus — iOS & Android",
      heroBadge: "⬇️ Lataa NadaRuns",
      heroTitle1: "Hanki sovellus.", heroTitle2: "Liikuta kaikkea.",
      heroLeadSoon: "Yksi sovellus kuljettajille ja yrityksille. Julkaistaan pian App Storessa ja Google Playssa — napauta alta saadaksesi ilmoituksen.",
      heroLeadLive: "Yksi sovellus kuljettajille ja yrityksille. Saatavilla nyt App Storessa ja Google Playssa.",
      scan: "Skannaa ladataksesi",
      featuresHead: "Kaikki yhdessä sovelluksessa", featuresSub: "Rakennettu nopeudelle, luotettavuudelle ja ihastuttavalle käyttökokemukselle.",
      features: [
        { title: "Reaaliaikainen seuranta", desc: "Seuraa jokaista toimitusta kartalla noudosta toimitukseen." },
        { title: "Välittömät ilmoitukset", desc: "Selkeät äänet ja push-ilmoitukset jokaisesta tärkeästä tapahtumasta." },
        { title: "Ansionäkymä", desc: "Kuljettajat näkevät tämän päivän, tämän viikon ja kokonaisansiot yhdellä silmäyksellä." },
        { title: "Sovelluksen sisäinen chat", desc: "Viestit lähettäjän ja kuljettajan välillä ilman numeroiden jakamista." },
        { title: "Turvallinen ja vakuutettu", desc: "OTP-luovutukset ja toimitustodistus jokaisessa tilauksessa." },
        { title: "Nopea tilaaminen", desc: "Luo lähetys alle minuutissa välittömällä hinnoittelulla." },
      ],
      ctaTitle: "Valmiina kun sinä olet", ctaSub: "Lataa NadaRuns ja aloita liikkuminen minuuteissa.",
    },
    legal: {
      eyebrow: "Juridiikka", lastUpdatedLabel: "Päivitetty viimeksi:",
      templateNotice: "Mallipohjailmoitus:",
      templateBody: "Tämä asiakirja on rakenne, joka on tarkoitettu asetteluun ja jäsentelyyn. Lopullinen sanamuoto on tarkistettava ja hyväksyttävä pätevän lakimiehen toimesta ja sen on noudatettava Suomen ja EU:n lakia ennen kuin NadaRuns ottaa vastaan todellisia asiakkaita tai maksuja.",
      companyDetails: "Yrityksen tiedot", businessId: "Y-tunnus:", support: "Tuki:", general: "Yleiset tiedustelut:",
      backHome: "← Takaisin etusivulle", toBeSet: "Asetetaan julkaisun yhteydessä",
      gdpr: {
        metaTitle: "GDPR & oikeutesi — NadaRuns",
        title: "GDPR & tietosuojaoikeutesi",
        intro: "NadaRuns Oy on sitoutunut suojelemaan henkilötietojasi EU:n yleisen tietosuoja-asetuksen (GDPR) mukaisesti. Tämä sivu kokoaa yhteen oikeutesi ja sen, miten voit käyttää niitä.",
        sections: [
          { heading: "Oikeutesi pähkinänkuoressa", bullets: ["Oikeus saada tietoa siitä, miten tietojasi käytetään.", "Oikeus tutustua sinusta hallussamme oleviin henkilötietoihin.", "Oikeus virheellisten tietojen oikaisuun.", "Oikeus tietojen poistamiseen (\u201coikeus tulla unohdetuksi\u201d) lain rajoissa.", "Oikeus käsittelyn rajoittamiseen.", "Oikeus tietojen siirrettävyyteen.", "Oikeus vastustaa oikeutettuun etuun tai suoramarkkinointiin perustuvaa käsittelyä.", "Oikeudet automaattiseen päätöksentekoon ja profilointiin liittyen."] },
          { heading: "Miten käytät oikeuksiasi", paragraphs: ["Lähetä pyyntö osoitteeseen support@nadaruns.com. Vahvistamme henkilöllisyytesi ja vastaamme yhden kuukauden kuluessa GDPR:n edellyttämällä tavalla. Pyynnöstä ei yleensä peritä maksua."] },
          { heading: "Mitä tietoja käsittelemme ja miksi", paragraphs: ["Viittaa tietosuojaselosteeseen tietoluokkien, käyttötarkoitusten ja oikeusperusteiden osalta."] },
          { heading: "Alikäsittelijät", paragraphs: ["Ylläpidämme luetteloa alikäsittelijöistä (esim. Stripe maksuihin, Google Maps, pilvipalvelut) ja pidämme tietojenkäsittelysopimukset voimassa."] },
          { heading: "Tietoturvaloukkausmenettely", paragraphs: ["Yhteenveto prosessistamme merkityksellisten loukkausten havaitsemiseksi, raportoimiseksi ja ilmoittamiseksi valvontaviranomaiselle ja tarvittaessa asianosaisille käyttäjille."] },
          { heading: "Valvontaviranomainen", paragraphs: ["Sinulla on oikeus tehdä valitus tietosuojavaltuutetun toimistolle Suomessa."] },
        ],
      },
      privacy: {
        metaTitle: "Tietosuojaseloste — NadaRuns",
        title: "Tietosuojaseloste",
        intro: "Tämä tietosuojaseloste kuvaa, miten NadaRuns Oy (\"me\") kerää, käyttää, jakaa ja suojaa henkilötietoja, kun käytät NadaRunsia. Toimimme rekisterinpitäjänä ja käsittelemme henkilötietoja EU:n yleisen tietosuoja-asetuksen (GDPR) ja Suomen tietosuojalain mukaisesti.",
        sections: [
          { heading: "Rekisterinpitäjä", paragraphs: ["NadaRuns Oy, Y-tunnus 3456789-1, Mannerheimintie 10, 00100 Helsinki, Suomi. Tietosuoja-asioissa ota yhteyttä support@nadaruns.com."] },
          { heading: "Keräämämme tiedot", bullets: ["Tilitiedot: nimi, sähköposti, puhelin, salasana (tiivistetty).", "Kuljettajan tunnistautuminen (KYC): henkilöllisyystodistus, ajokortti, ajoneuvon asiakirjat.", "Tilaustiedot: nouto-/toimitusosoitteet, kuorman tiedot, aikaleimat.", "Sijaintitiedot: kuljettajan GPS-sijainti online-tilassa/toimituksen aikana.", "Maksutiedot: käsittelee maksunvälittäjämme (Stripe); tallennamme rajoitettuja tapahtumatietoja, emme täysiä korttinumeroita.", "Laite- ja käyttötiedot: sovelluksen/sivuston analytiikka, lokitiedot."] },
          { heading: "Miten käytämme tietojasi ja oikeusperusteet", paragraphs: ["Käyttötarkoituksia ovat palvelun tarjoaminen (sopimuksen täytäntöönpano), turvallisuus ja petosten ehkäisy sekä lakisääteinen velvoite, palvelun parantaminen ja markkinointi (oikeutettu etu tai suostumus)."] },
          { heading: "Jakaminen ja käsittelijät", paragraphs: ["Jaamme tietoja alikäsittelijöiden kanssa vain tarpeen mukaan: maksunkäsittely (Stripe), kartat (Google Maps), pilvipalvelut ja viestintä. Jokainen toimii tietojenkäsittelysopimuksen alaisena."] },
          { heading: "Kansainväliset siirrot", paragraphs: ["Kun tietoja siirretään EU:n/ETA:n ulkopuolelle, tukeudumme asianmukaisiin suojatoimiin, kuten vakiosopimuslausekkeisiin."] },
          { heading: "Säilytys", paragraphs: ["Kuinka kauan kutakin tietoluokkaa säilytetään ja kriteerit säilytysaikojen määrittämiseksi."] },
          { heading: "Oikeutesi", paragraphs: ["GDPR:n mukaan sinulla on oikeus tutustua tietoihisi, oikaista, poistaa, rajoittaa, vastustaa ja siirtää niitä sekä peruuttaa suostumus. Katso GDPR-sivulta miten käytät niitä."] },
          { heading: "Tietoturva", paragraphs: ["Tekniset ja organisatoriset toimenpiteet tietojesi suojaamiseksi (salaus siirrossa, tiivistetyt salasanat, pääsynhallinta)."] },
          { heading: "Evästeet", paragraphs: ["Verkkosivustomme käyttää evästeitä evästekäytännössä kuvatulla tavalla."] },
          { heading: "Yhteydenotto ja valitukset", paragraphs: ["Ota yhteyttä support@nadaruns.com tietosuojaa koskevissa kysymyksissä. Sinulla on myös oikeus tehdä valitus tietosuojavaltuutetulle Suomessa."] },
        ],
      },
      terms: {
        metaTitle: "Käyttöehdot — NadaRuns",
        title: "Käyttöehdot",
        intro: "Nämä käyttöehdot (\"Ehdot\") säätelevät pääsyäsi NadaRuns-alustalle, verkkosivustoille ja mobiilisovelluksiin, joita NadaRuns Oy operoi, ja niiden käyttöä. Luomalla tilin tai käyttämällä palvelua hyväksyt nämä Ehdot.",
        sections: [
          { heading: "Määritelmät", paragraphs: ["Määrittelee sopimuksessa käytetyt keskeiset termit."], bullets: ["\u201cAlusta\u201d — NadaRunsin verkkosivustot, sovellukset ja rajapinnat.", "\u201cLähettäjä\u201d — yritys tai yksityishenkilö, joka tilaa toimituksen.", "\u201cKuljettaja\u201d — itsenäinen kuljettaja, joka hyväksyy ja toteuttaa toimituksia.", "\u201cTilaus\u201d — Alustalle luotu toimituspyyntö."] },
          { heading: "Kelpoisuus ja tilit", paragraphs: ["Rekisteröitymisvaatimukset, tietojen oikeellisuus, tilin turvallisuus ja vähimmäisikä. Kuljettajien on suoritettava henkilöllisyyden (KYC) ja ajoneuvon vahvistus ennen tilausten hyväksymistä."] },
          { heading: "Palvelu ja NadaRunsin rooli", paragraphs: ["NadaRuns on teknologia-alusta, joka yhdistää Lähettäjät ja itsenäiset Kuljettajat. Kuvaa sopimussuhde ja se, että NadaRuns mahdollistaa kuljetuksen mutta ei itse suorita sitä, ellei toisin mainita."] },
          { heading: "Tilaukset, hinnoittelu ja maksut", paragraphs: ["Miten hinnat lasketaan, maksujen valtuutus ja veloitus maksunvälittäjämme (Stripe) kautta, alustan provisio, kuljettajien maksut, verot (ALV) ja laskutus."] },
          { heading: "Peruutukset ja hyvitykset", paragraphs: ["Peruutusajat Lähettäjille ja Kuljettajille, sovellettavat maksut ja hyvitysprosessi. Viittaa peruutus-/hyvityskäytäntöön."] },
          { heading: "Kuljettajan velvoitteet", paragraphs: ["Lisenssit, vakuutus, ajoneuvon kunto, turvallinen ja laillinen toiminta, toimitustodistus (OTP/valokuva) ja kuorman käsittely."] },
          { heading: "Kielletyt esineet ja toiminta", paragraphs: ["Luettelo kielletyistä/laittomista/vaarallisista tavaroista ja kielletystä alustakäyttäytymisestä."] },
          { heading: "Vastuu ja vakuutus", paragraphs: ["Vastuunrajoitukset, kuorman vakuutusturva ja korvausvaatimusprosessi Suomen lain sallimissa rajoissa."] },
          { heading: "Keskeytys ja irtisanominen", paragraphs: ["Tilien keskeyttämisen tai irtisanomisen perusteet ja prosessi."] },
          { heading: "Sovellettava laki ja riidat", paragraphs: ["Näihin Ehtoihin sovelletaan Suomen lakia. Määritä toimivaltaiset tuomioistuimet / riidanratkaisu ja kuluttajariitalautakunta soveltuvin osin."] },
          { heading: "Muutokset näihin Ehtoihin", paragraphs: ["Miten päivityksistä ilmoitetaan ja milloin ne tulevat voimaan."] },
        ],
      },
      cookies: {
        metaTitle: "Evästekäytäntö — NadaRuns",
        title: "Evästekäytäntö",
        intro: "Tämä evästekäytäntö kuvaa, miten NadaRuns käyttää evästeitä ja vastaavia teknologioita verkkosivustollamme ja miten voit hallita niitä. Sitä tulee lukea yhdessä tietosuojaselosteemme kanssa.",
        sections: [
          { heading: "Mitä evästeet ovat", paragraphs: ["Lyhyt, selkokielinen selitys evästeistä ja vastaavista teknologioista (paikallinen tallennustila, pikselit)."] },
          { heading: "Käyttämämme evästeluokat", bullets: ["Ehdottoman välttämättömät — vaaditaan sivuston toiminnalle (esim. istunto, turvallisuus).", "Asetukset — muistavat valinnat, kuten kielen.", "Analytiikka — auttavat ymmärtämään käyttöä ja parantamaan palvelua.", "Markkinointi — mittaavat kampanjoita (vain suostumuksella)."] },
          { heading: "Asetustesi hallinta", paragraphs: ["Miten käyttäjät voivat hyväksyä/hylätä ei-välttämättömät evästeet suostumusbannerin ja selaimen asetusten kautta. Ei-välttämättömät evästeet asetetaan vasta suostumuksen jälkeen."] },
          { heading: "Kolmannen osapuolen evästeet", paragraphs: ["Luettelo kolmansista osapuolista, jotka voivat asettaa evästeitä (esim. analytiikka, maksut, kartat) ja linkki niiden käytäntöihin."] },
          { heading: "Päivitykset", paragraphs: ["Miten tämän käytännön muutoksista ilmoitetaan."] },
        ],
      },
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
    <LangContext.Provider value={{ lang, setLang, c: CONTENT[lang] as unknown as Content }}>
      <SeoUpdater />
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): Ctx {
  const ctx = useContext(LangContext);
  if (!ctx) return { lang: "fi", setLang: () => {}, c: CONTENT.fi as unknown as Content };
  return ctx;
}

/** Returns the content dictionary for the active language. */
export function useContent(): Content {
  return useLang().c;
}

// ---------------------------------------------------------------------------
// Per-route, per-language SEO (document <title> + meta description). The static
// server metadata is Finnish (default); this client updater keeps the head in
// sync when the user toggles language or navigates between routes.
// ---------------------------------------------------------------------------
type SeoEntry = { title: string; description: string };
const SEO: Record<Lang, Record<string, SeoEntry>> = {
  fi: {
    "/": { title: "NadaRuns — Nopea ja luotettava toimitus", description: "NadaRuns yhdistää kuljettajat ja yritykset nopeisiin, luotettaviin toimituksiin kaikkialla Suomessa. Ryhdy kuljettajaksi ansaitaksesi tai lähetä tuotteesi reaaliaikaisella seurannalla." },
    "/about": { title: "Tietoa NadaRunsista — Vie Suomea eteenpäin", description: "NadaRuns yhdistää luotettavat kuljettajat ja yritykset nopeisiin, luotettaviin toimituksiin kaikkialla Suomessa. Tutustu missioomme, arvoihimme ja tarinaamme." },
    "/drivers": { title: "Aja NadaRunsin kanssa — Ansaitse omilla aikatauluillasi", description: "Ryhdy NadaRuns-kuljettajaksi. Joustavat työajat, nopea viikkopalkka, valitse ajoneuvosi ja hyväksy keikkoja läheltäsi sovelluksen navigoinnilla." },
    "/business": { title: "NadaRuns yrityksille — Lähetä älykkäämmin", description: "Kuljeta mitä tahansa kaikkialle Suomeen NadaRuns yrityksille -palvelulla. Välitön läpinäkyvä hinnoittelu, reaaliaikainen seuranta, 11 ajoneuvotyyppiä ja toimitustodistus." },
    "/contact": { title: "Yhteystiedot — NadaRuns", description: "Ota yhteyttä NadaRunsiin. Kysymykset, kumppanuudet tai tuki — tiimimme vastaa yleensä yhden työpäivän kuluessa." },
    "/download": { title: "Lataa NadaRuns-sovellus — iOS & Android", description: "Lataa NadaRuns iOS:lle ja Androidille. Seuraa toimituksia reaaliajassa, hyväksy keikkoja, keskustele kuljettajien kanssa ja saat välittömät ilmoitukset." },
    "/terms": { title: "Käyttöehdot — NadaRuns", description: "NadaRuns-logistiikka-alustan käyttöä koskevat ehdot." },
    "/privacy": { title: "Tietosuojaseloste — NadaRuns", description: "Miten NadaRuns kerää, käyttää ja suojaa henkilötietojasi GDPR:n mukaisesti." },
    "/cookies": { title: "Evästekäytäntö — NadaRuns", description: "Miten NadaRuns käyttää evästeitä ja vastaavia teknologioita verkkosivustollaan." },
    "/gdpr": { title: "GDPR & oikeutesi — NadaRuns", description: "Tietosuojaoikeutesi GDPR:n mukaan ja miten käytät niitä NadaRunsin kanssa." },
  },
  en: {
    "/": { title: "NadaRuns — Fast & Reliable Delivery", description: "NadaRuns connects drivers with businesses for fast, reliable deliveries across Finland. Join as a driver to earn money or as a business to ship your products." },
    "/about": { title: "About NadaRuns — Moving Finland forward", description: "NadaRuns connects trusted drivers with businesses for fast, reliable deliveries across Finland. Learn about our mission, values and story." },
    "/drivers": { title: "Drive with NadaRuns — Earn on your schedule", description: "Become a NadaRuns driver. Flexible hours, fast weekly pay, choose your vehicle and accept jobs near you with in-app navigation." },
    "/business": { title: "NadaRuns for Business — Ship smarter", description: "Move anything across Finland with NadaRuns for Business. Instant transparent pricing, live tracking, 11 vehicle types and proof of delivery." },
    "/contact": { title: "Contact — NadaRuns", description: "Get in touch with NadaRuns. Questions, partnerships or support — our team usually replies within one business day." },
    "/download": { title: "Download the NadaRuns App — iOS & Android", description: "Download NadaRuns for iOS and Android. Track deliveries live, accept jobs, chat with drivers and get instant alerts." },
    "/terms": { title: "Terms of Service — NadaRuns", description: "The terms and conditions governing the use of the NadaRuns logistics platform." },
    "/privacy": { title: "Privacy Policy — NadaRuns", description: "How NadaRuns collects, uses and protects your personal data under the GDPR." },
    "/cookies": { title: "Cookie Policy — NadaRuns", description: "How NadaRuns uses cookies and similar technologies on its website." },
    "/gdpr": { title: "GDPR & Your Rights — NadaRuns", description: "Your data-protection rights under the GDPR and how to exercise them with NadaRuns." },
  },
};

function setMetaContent(selector: string, attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/** Keeps <title> + meta description in sync with active language & route. */
export function SeoUpdater() {
  const { lang } = useLang();
  const pathname = usePathname() || "/";
  useEffect(() => {
    const table = SEO[lang];
    const meta = table[pathname] ?? SEO[lang]["/"];
    document.title = meta.title;
    setMetaContent('meta[name="description"]', "name", "description", meta.description);
    setMetaContent('meta[property="og:title"]', "property", "og:title", meta.title);
    setMetaContent('meta[property="og:description"]', "property", "og:description", meta.description);
    document.documentElement.lang = lang;
  }, [lang, pathname]);
  return null;
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
