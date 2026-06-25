"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";

export type Lang = "fi" | "en";

// ---------------------------------------------------------------------------
// NadaRuns is a B2B logistics marketplace for empty transport capacity.
// It connects available vehicle capacity & return trips with freight that
// needs moving — turning empty kilometers into revenue. Copy below reflects
// that positioning (NOT a courier / food-delivery / gig app). Finnish-first.
// ---------------------------------------------------------------------------
const CONTENT = {
  en: {
    nav: {
      home: "Home", about: "About", drivers: "For Carriers", business: "For Shippers",
      download: "App", contact: "Contact",
      admin: "Admin Dashboard", driveWithUs: "Offer capacity", getApp: "Get started",
    },
    footer: {
      tagline: "The marketplace for empty transport capacity — turning empty kilometers into revenue across Finland.",
      company: "Company", about: "About Us", careers: "Carriers", blog: "Blog", press: "Press",
      products: "Platform", driveWith: "Carriers & fleets", forBusiness: "Shippers & businesses",
      downloadApp: "Get the App", enterprise: "Enterprise & logistics",
      legal: "Legal", terms: "Terms of Service", privacy: "Privacy Policy", cookies: "Cookie Policy", gdpr: "GDPR",
      contact: "Contact", rights: "All rights reserved.", sitemap: "Sitemap", accessibility: "Accessibility",
    },
    home: {
      heroBadge: "🚛 The marketplace for empty transport capacity",
      heroTitle1: "Turn empty", heroTitle2: "kilometers", heroTitle3: "into", heroTitle4: "revenue.",
      heroSub: "NadaRuns matches available vehicle capacity and return trips with freight that needs moving — in real time. Carriers earn from kilometers they'd otherwise drive empty; shippers get faster, more competitive transport.",
      becomeDriver: "🚛 Offer capacity", shipWithUs: "📦 Find transport",
      statDrivers: "Active carriers", statDeliveries: "Empty km reduced", statRating: "Avg. CO₂ cut",
      orderId: "Return load · HKI → TKU", inTransit: "● Capacity matched", route: "Semi-trailer · 12t free · heading your way",
      delivering: "Matched in real time", arriving: "Carrier accepts in seconds",
      whyTitle: "Why NadaRuns", whySub: "A freight marketplace built to eliminate empty runs and unlock idle capacity.",
      features: [
        { title: "Real-time matching", desc: "We match free capacity and return legs with nearby freight instantly." },
        { title: "Fewer empty runs", desc: "Fill kilometers you'd drive empty and cut wasted fuel and time." },
        { title: "Tracked & insured", desc: "Live tracking and insured transport with proof of pickup and delivery." },
        { title: "Transparent pricing", desc: "Clear, up-front pricing for carriers and shippers — no haggling." },
      ],
      howTitle: "How it works", howSub: "Whether you move freight or need it moved, matching takes minutes.",
      forDrivers: "🚛 For carriers", driverHead: "Fill your empty kilometers",
      driverSteps: [
        { title: "List capacity & routes", desc: "Publish your free capacity, planned routes and return legs." },
        { title: "Get matched", desc: "Receive freight that fits your vehicle and direction in real time." },
        { title: "Haul & get paid", desc: "Complete the load with proof of delivery and get paid weekly." },
      ],
      forBusiness: "📦 For shippers", bizHead: "Move freight, smarter",
      bizSteps: [
        { title: "Post your freight", desc: "Enter pickup, drop-off, cargo and vehicle in under a minute." },
        { title: "Get matched instantly", desc: "Tap into capacity already heading your way at competitive rates." },
        { title: "Track to delivery", desc: "Follow your shipment live with proof of pickup and delivery." },
      ],
      learnMore: "Learn more →",
      lovedTitle: "Trusted across the supply chain", lovedSub: "Carriers, fleets and shippers moving more with less waste.",
      testimonials: [
        { name: "Mikko L.", role: "Owner-driver", text: "My return trips used to be empty. Now NadaRuns fills them automatically — it's pure extra revenue on kilometers I was driving anyway." },
        { name: "Sanna R.", role: "Fleet operator", text: "Vehicle utilization is up across our fleet and empty kilometers are down. The matching is fast and the pricing is transparent." },
        { name: "Antti K.", role: "Logistics manager, manufacturer", text: "We get transport capacity in minutes at competitive prices, with live tracking from pickup to delivery. It's changed how we plan freight." },
      ],
      ctaTitle: "Turn empty runs into revenue", ctaSub: "Join the carriers, fleets and shippers already moving more with NadaRuns.",
      startDriving: "🚛 Offer capacity", shipProducts: "📦 Find transport",
    },
    appBand: {
      badge: "📱 Get the NadaRuns app",
      title1: "Your capacity,", title2: "always working",
      sub: "List free capacity, accept matching freight, track loads live and get paid — or post freight and watch it get matched. One app for carriers and shippers, on iOS and Android.",
      comingSoon: "Launching soon — tap a badge to get notified.",
      available: "Free to download. Available on iOS and Android.",
      inTransit: "● Capacity matched", orderId: "Return load · HKI → TKU", arriving: "Carrier en route",
      earnings: "Recovered this week", goOnline: "Go available",
    },
    badges: { soon: "SOON", iosSub: "Download on the", iosMain: "App Store", androidSub: "GET IT ON", androidMain: "Google Play" },
    about: {
      metaTitle: "About NadaRuns — The marketplace for empty transport capacity",
      heroBadge: "✨ Our mission",
      heroTitle1: "Ending the empty run,", heroTitle2: "one match at a time",
      heroLead: "Across Europe, trucks run empty on roughly one in four trips — wasting fuel, time, money and emissions. NadaRuns is the marketplace that connects that idle capacity with freight that needs moving, in real time.",
      statsLabels: ["Empty km reduced", "Active carriers", "Revenue recovered", "Avg. CO₂ cut"],
      missionBadge: "The problem & our solution",
      missionTitle: "Empty kilometers cost transport companies millions every year",
      missionP1: "Empty running — driving with no load — burns fuel, wears vehicles, wastes driver hours and emits CO₂ for zero revenue. For carriers it's lost profit; for the planet it's avoidable emissions.",
      missionP2: "NadaRuns fixes this by matching available capacity and return trips with nearby freight opportunities in real time. Carriers recover revenue from kilometers they'd drive empty, and shippers get faster, more competitive access to transport.",
      diffTitle: "What makes us different",
      diffs: [
        "Real-time matching of free capacity and return legs",
        "Transparent, up-front pricing for both sides",
        "Built for carriers, fleets, owner-drivers and shippers",
        "Live tracking and insured transport on every load",
        "Less empty running means lower costs and emissions",
      ],
      timelineHead: "Our journey", timelineSub: "From a Helsinki idea to a freight marketplace moving the Nordics.",
      timeline: [
        { year: "2024", title: "NadaRuns is born", desc: "Founded in Helsinki on one belief: empty kilometers are a solvable problem worth billions." },
        { year: "2024", title: "First matches", desc: "Owner-drivers and local fleets proved the model — return loads filled automatically." },
        { year: "2025", title: "Capacity at scale", desc: "Eleven vehicle types and smart route matching across Finland's freight corridors." },
        { year: "Today", title: "Scaling the Nordics", desc: "Thousands of carriers and shippers cutting empty runs and emissions every day." },
      ],
      valuesHead: "What we stand for", valuesSub: "The principles behind a more efficient, sustainable logistics network.",
      values: [
        { title: "Efficiency", desc: "Every empty kilometer is waste. We exist to turn idle capacity into value." },
        { title: "Fairness", desc: "Transparent pricing and fair terms for carriers and shippers alike." },
        { title: "Sustainability", desc: "Fewer empty runs mean less fuel burned and lower CO₂ — better for everyone." },
        { title: "Trust & safety", desc: "Verified carriers, insured loads and proof of delivery on every match." },
        { title: "Reliability", desc: "Real-time matching and live tracking you can plan your operations around." },
        { title: "Built for the Nordics", desc: "Tuned for Finland's freight network — and scaling across the region." },
      ],
      ctaTitle: "Join the movement", ctaSub: "Whether you run vehicles or ship freight, NadaRuns was built for you.",
      ctaDrive: "Offer capacity", ctaShip: "Find transport",
    },
    drivers: {
      metaTitle: "For Carriers — Turn empty kilometers into revenue with NadaRuns",
      heroBadge: "🚛 For carriers, fleets & owner-drivers",
      heroTitle1: "Your vehicles.", heroTitle2: "Your routes.", heroTitle3: "Zero empty runs.",
      heroLead: "List your available capacity and return trips, and NadaRuns matches you with freight heading your way — so you earn from kilometers you'd otherwise drive empty.",
      cardStatus: "● Available · matching", cardToday: "Recovered today",
      benefitsHead: "Why carriers choose NadaRuns", benefitsSub: "More revenue, better utilization and fewer empty kilometers.",
      benefits: [
        { title: "Recover lost revenue", desc: "Fill empty and return legs with paying freight — extra income on trips you're already making." },
        { title: "Higher vehicle utilization", desc: "Keep trucks loaded both ways and get more value from every asset and shift." },
        { title: "Fewer empty kilometers", desc: "Cut wasted fuel, wear and driver hours by matching loads to your direction." },
        { title: "Use any vehicle", desc: "From cargo vans to semi-trailers — register multiple vehicles and switch anytime." },
        { title: "Real-time load alerts", desc: "Get notified the moment matching freight appears near your route." },
        { title: "Fast, transparent pay", desc: "See your payout before you accept, tracked in-app and paid weekly." },
      ],
      payBadge: "💶 Transparent pay",
      payTitle: "See exactly what each load pays — before you accept",
      payP1: "No guesswork and no hidden cuts. Every matched load shows your projected payout up front, so you always know what a trip is worth before you commit.",
      payP2: "You keep the majority of every fare, plus 100% of any shipper bonus — and it's all revenue on kilometers you were driving anyway.",
      payCardTitle: "Sample return-load payout",
      payRows: [
        { k: "Base fare", v: "€420.00" },
        { k: "Shipper bonus", v: "€40.00" },
        { k: "Platform fee", v: "−€69.00" },
      ],
      payReceive: "You receive",
      stepsHead: "Start earning in 4 steps",
      steps: [
        { title: "Register", desc: "Create your carrier account and add your vehicles in minutes." },
        { title: "List capacity", desc: "Publish your free capacity, planned routes and return legs." },
        { title: "Accept matches", desc: "Get freight that fits your direction and swipe to accept." },
        { title: "Get paid", desc: "Complete with proof of delivery — earnings land in your wallet weekly." },
      ],
      reqTitle: "What you'll need",
      reqLead: "Getting verified is quick. Have these ready and you can be matching loads today.",
      requirements: [
        "Valid driving licence for your vehicle class",
        "Vehicle registration & transport insurance",
        "Operating licence where required for your cargo",
        "Smartphone (iOS or Android)",
      ],
      readyTitle: "Ready to fill those empty runs?", readyDesc: "Download the app and list your capacity today.",
      faqHead: "Carrier questions, answered",
      faqs: [
        { q: "How does NadaRuns reduce my empty runs?", a: "You publish your free capacity and planned routes — including return legs — and we match you with nearby freight that fits your direction and vehicle, so you fill kilometers you'd otherwise drive empty." },
        { q: "How much can I earn?", a: "It depends on your routes and vehicle, but because it's revenue on trips you're already making, it's largely incremental. You see the projected payout for every load before you accept." },
        { q: "Which vehicles can I register?", a: "Anything from a cargo van to a semi-trailer. Register multiple vehicles and switch your active one anytime to match the loads you want." },
        { q: "When and how do I get paid?", a: "Earnings are tracked live in the app and paid out to your account on a regular weekly cycle, net of applicable taxes." },
        { q: "Do I need my own company?", a: "Owner-drivers, light-entrepreneurs and fleets are all welcome. You just need a valid licence, registration and insurance for your vehicle and cargo." },
      ],
      ctaTitle: "Stop driving empty", ctaSub: "List your capacity, get matched with freight on your route, and turn empty kilometers into revenue.",
    },
    business: {
      metaTitle: "For Shippers — Faster, more competitive freight with NadaRuns",
      heroBadge: "📦 For shippers & businesses",
      heroTitle1: "Move freight using", heroTitle2: "capacity that already exists",
      heroLead: "Tap into trucks already heading your way. NadaRuns matches your freight with available capacity and return trips — for faster access to transport, more options and competitive pricing.",
      ctaStart: "Post freight", ctaSales: "Talk to sales",
      priceLabel: "Estimated price", priceRoute: "Helsinki → Tampere · 180 km · 8 pallets",
      priceRows: [
        { k: "Base rate", v: "€180.00" },
        { k: "Distance", v: "€220.00" },
        { k: "Capacity match discount", v: "−€45.00" },
        { k: "Fuel", v: "€28.00" },
      ],
      featuresHead: "Everything your freight needs", featuresSub: "Powerful, transparent and built to scale with your operations.",
      features: [
        { title: "Faster access to capacity", desc: "Match with carriers already heading your way — often within minutes." },
        { title: "Competitive pricing", desc: "Because you use capacity that already exists, prices are more competitive." },
        { title: "Live tracking", desc: "Follow every shipment on the map with live ETA from pickup to drop-off." },
        { title: "Proof of delivery", desc: "Proof of pickup and delivery on every load — fully insured." },
        { title: "Any cargo, any vehicle", desc: "Parcels to full truckloads, refrigerated to oversized — the right fit every time." },
        { title: "Wider transport options", desc: "A growing network of vetted carriers means more choice and resilience." },
      ],
      fleetHead: "Capacity for every load", fleetSub: "Eleven vehicle types so your freight always travels the right way.",
      fleet: [
        { name: "Cargo Van", note: "Up to 1,500 kg" },
        { name: "Box Truck", note: "Up to 5,000 kg" },
        { name: "Flatbed", note: "Up to 8,000 kg" },
        { name: "Semi-Trailer", note: "Up to 20,000 kg" },
        { name: "Refrigerated", note: "Temperature-controlled" },
        { name: "Crane / Hazmat", note: "Specialized handling" },
      ],
      stepsHead: "How it works",
      steps: [
        { title: "Post your freight", desc: "Enter pickup, drop-off, cargo and vehicle — get an instant price." },
        { title: "Get matched", desc: "A nearby carrier with matching capacity accepts your load." },
        { title: "Track live", desc: "Follow the shipment in real time and message your carrier." },
        { title: "Delivered", desc: "Confirmed with proof of pickup and delivery. Done." },
      ],
      industriesHead: "Built for every industry", industriesSub: "Manufacturers, wholesalers, retailers and SMEs move with NadaRuns.",
      industries: [
        { title: "Manufacturing", desc: "Reliable B2B freight between plants, warehouses and distributors." },
        { title: "Wholesale & distribution", desc: "Move pallets and bulk stock with capacity matched to your lanes." },
        { title: "Retail & e-commerce", desc: "Replenish stores and fulfil orders with flexible, scalable transport." },
        { title: "Construction", desc: "Get tools, materials and pallets to site with flatbeds and cranes." },
        { title: "Food & grocery", desc: "Temperature-controlled capacity keeps perishables fresh, every trip." },
        { title: "SMEs", desc: "Enterprise-grade freight access without enterprise overhead or contracts." },
      ],
      faqHead: "Frequently asked questions",
      faqs: [
        { q: "How is the price calculated?", a: "Pricing reflects distance, weight, vehicle type and route, with the full quote shown up front before you confirm. Because you're using capacity that already exists, prices are often more competitive than dedicated transport." },
        { q: "How fast will my freight be matched?", a: "Often within minutes. We match your load with the nearest carrier whose available capacity and route fit your shipment." },
        { q: "Can I track my shipment?", a: "Yes. Every load includes a live map with the carrier's location and ETA, plus in-app messaging from pickup to drop-off." },
        { q: "What can I ship?", a: "Anything from a single pallet to a full truckload. With 11 vehicle types — including refrigerated and specialized handling — there's a fit for almost any cargo." },
        { q: "Do you offer business accounts?", a: "Yes. For regular or high-volume freight, talk to our team about a business account with consolidated billing and priority support." },
      ],
      ctaTitle: "Ready to move freight smarter?", ctaSub: "Post your first load and get matched with capacity in minutes.",
      ctaGetApp: "Get the app", ctaContact: "Contact sales",
    },
    contact: {
      heroBadge: "💬 Get in touch",
      heroTitle1: "We'd love to", heroTitle2: "hear from you",
      heroLead: "Questions, partnerships or support for carriers and shippers — our team usually replies within one business day.",
      methodEmail: "Email us", methodCall: "Call us", methodVisit: "Visit us",
      formTitle: "Send us a message",
      labelName: "Your name", labelEmail: "Email", labelSubject: "Subject", labelMessage: "Message",
      phName: "Jane Doe", phEmail: "jane@company.com", phSubject: "How can we help?", phMessage: "Tell us a bit more…",
      send: "Send message", sending: "Sending…",
      sentTitle: "Message sent!", sentDesc: "Thanks for reaching out — we'll get back to you shortly.", sendAnother: "Send another",
      hoursTitle: "Support hours",
      faqHead: "Quick answers",
      faqs: [
        { q: "How quickly will you reply?", a: "Our team usually responds within one business day. For anything urgent about a live load, in-app support is the fastest route." },
        { q: "I'm a carrier — how do I start?", a: "Head to the For Carriers page, download the app and list your available capacity and routes. Verification takes minutes." },
        { q: "I'm a shipper — how do I book?", a: "Post your freight in the app or talk to our team about a business account for regular or high-volume lanes." },
        { q: "Do you cover my region?", a: "We're expanding quickly across Finland and the Nordics. Send us your lanes and we'll let you know about coverage." },
      ],
    },
    download: {
      metaTitle: "Get the NadaRuns App — Capacity matching for iOS & Android",
      heroBadge: "⬇️ Download NadaRuns",
      heroTitle1: "Get the app.", heroTitle2: "Stop running empty.",
      heroLeadSoon: "One app for carriers and shippers. Launching soon on the App Store and Google Play — tap below to get notified.",
      heroLeadLive: "One app for carriers and shippers. Available now on the App Store and Google Play.",
      scan: "Scan to download",
      featuresHead: "Everything in one app", featuresSub: "Built for speed, utilization and a delightful experience.",
      features: [
        { title: "Real-time matching", desc: "List capacity or post freight and get matched in real time." },
        { title: "Live tracking", desc: "Follow every load on the map from pickup to drop-off." },
        { title: "Earnings dashboard", desc: "Carriers see revenue recovered today, this week and all-time." },
        { title: "In-app messaging", desc: "Message between shipper and carrier without sharing numbers." },
        { title: "Tracked & insured", desc: "Proof of pickup and delivery and insured transport on every load." },
        { title: "Fast booking", desc: "Post freight or list capacity in under a minute with instant pricing." },
      ],
      ctaTitle: "Ready when you are", ctaSub: "Download NadaRuns and start matching capacity in minutes.",
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
        intro: "NadaRuns Oy operates a B2B logistics marketplace and is committed to protecting your personal data in line with the EU General Data Protection Regulation (GDPR). This page summarises your rights and how to exercise them.",
        sections: [
          { heading: "Your rights at a glance", bullets: ["Right to be informed about how your data is used.", "Right of access to the personal data we hold.", "Right to rectification of inaccurate data.", "Right to erasure within legal limits.", "Right to restrict processing.", "Right to data portability.", "Right to object to processing.", "Rights regarding automated decision-making."] },
          { heading: "How to exercise your rights", paragraphs: ["Send a request to care@nadaruns.com. We will verify your identity and respond within one month, as required by the GDPR."] },
          { heading: "Data we process & why", paragraphs: ["See the Privacy Policy for the categories of data (account, carrier verification, capacity/route, booking, location and payment data), purposes and legal bases."] },
          { heading: "Sub-processors", paragraphs: ["We maintain data-processing agreements with vetted sub-processors (e.g. Stripe for payments, mapping/routing, cloud hosting)."] },
          { heading: "Supervisory authority", paragraphs: ["You may lodge a complaint with the Office of the Data Protection Ombudsman of Finland (tietosuojavaltuutetun toimisto)."] },
        ],
      },
      privacy: {
        metaTitle: "Privacy Policy — NadaRuns",
        title: "Privacy Policy",
        intro: "This Privacy Policy explains how NadaRuns Oy (\"we\") collects, uses, shares and protects personal data when you use the NadaRuns logistics marketplace. We act as the data controller under the EU GDPR and Finnish law.",
        sections: [
          { heading: "Data controller", paragraphs: ["NadaRuns Oy, Business ID 3456789-1, Mannerheimintie 10, 00100 Helsinki, Finland. For privacy matters contact care@nadaruns.com."] },
          { heading: "Data we collect", bullets: ["Account data: name, company, email, phone, hashed password.", "Carrier verification: identity and licence documents, vehicle registration and insurance.", "Capacity & route data: vehicle type, available capacity, planned routes and return legs.", "Booking data: pickup/drop-off, cargo details, prices, timestamps.", "Location data: vehicle GPS while available or fulfilling a load.", "Payment data: handled by Stripe; we store limited transaction metadata, not full card numbers."] },
          { heading: "How we use your data & legal bases", paragraphs: ["To match capacity with freight and operate bookings and payments (contract), keep the marketplace safe and meet legal obligations, and improve and communicate about the service (legitimate interest or consent)."] },
          { heading: "Sharing & processors", paragraphs: ["To complete a match we share the data needed between carrier and shipper. We use sub-processors for payments (Stripe), mapping/routing, cloud hosting and email, each under a data-processing agreement."] },
          { heading: "International transfers", paragraphs: ["Where data is transferred outside the EU/EEA, we rely on safeguards such as Standard Contractual Clauses."] },
          { heading: "Your rights", paragraphs: ["You may access, rectify, erase, restrict, object to and port your data, and withdraw consent. See the GDPR page for how to exercise them."] },
          { heading: "Security", paragraphs: ["Technical and organisational measures protect your data (encryption in transit, hashed passwords, access controls)."] },
          { heading: "Contact & complaints", paragraphs: ["Contact care@nadaruns.com with any privacy questions. You may also complain to the Finnish Data Protection Ombudsman (tietosuojavaltuutettu)."] },
        ],
      },
      terms: {
        metaTitle: "Terms of Service — NadaRuns",
        title: "Terms of Service",
        intro: "These Terms govern your use of the NadaRuns logistics marketplace, websites and apps operated by NadaRuns Oy. By creating an account or using the service you accept these Terms. NadaRuns is a technology platform connecting independent carriers with shippers; we facilitate matches and payments but do not ourselves perform the transport.",
        sections: [
          { heading: "Definitions", bullets: ["\u201cPlatform\u201d — the NadaRuns marketplace, websites, apps and APIs.", "\u201cCarrier\u201d — a transport company, fleet operator or owner-driver offering capacity.", "\u201cShipper\u201d — a business booking freight transport.", "\u201cLoad\u201d — a freight booking created on the Platform."] },
          { heading: "Accounts & eligibility", paragraphs: ["You must provide accurate information and keep credentials secure. Carriers must complete identity, licence, vehicle and insurance verification before accepting loads."] },
          { heading: "Matching, pricing & payments", paragraphs: ["The Platform matches available capacity and return trips with freight. Prices are shown transparently up front. Payments are processed via Stripe; NadaRuns charges a service fee, and carrier earnings are paid out on a regular cycle, net of applicable taxes (VAT)."] },
          { heading: "Carrier obligations", paragraphs: ["Carriers must hold valid licences and insurance, keep vehicles roadworthy, handle cargo safely and lawfully, provide proof of pickup and delivery, and list capacity and routes accurately."] },
          { heading: "Shipper obligations", paragraphs: ["Shippers must describe cargo accurately, ensure it is lawful to transport, and make it available for collection as agreed. Dangerous or restricted goods require proper declaration and handling."] },
          { heading: "Liability & insurance", paragraphs: ["Transport is insured from collection to delivery to the extent described at booking. To the extent permitted by Finnish law, NadaRuns' liability as an intermediary is limited; the carrier performs the transport."] },
          { heading: "Suspension & termination", paragraphs: ["We may suspend or terminate accounts that breach these Terms, applicable law or marketplace safety."] },
          { heading: "Governing law & disputes", paragraphs: ["These Terms are governed by the laws of Finland, with disputes resolved by the competent Finnish courts or applicable consumer dispute bodies."] },
          { heading: "Changes to these Terms", paragraphs: ["How updates are communicated and when they take effect."] },
        ],
      },
      cookies: {
        metaTitle: "Cookie Policy — NadaRuns",
        title: "Cookie Policy",
        intro: "This Cookie Policy explains how NadaRuns uses cookies and similar technologies on our website, and how you can control them. Read it together with our Privacy Policy.",
        sections: [
          { heading: "What are cookies", paragraphs: ["A short explanation of cookies and similar technologies (local storage, pixels)."] },
          { heading: "Categories of cookies we use", bullets: ["Strictly necessary — required for the site to function.", "Preferences — remember choices such as language.", "Analytics — help us understand usage and improve the service.", "Marketing — measure campaigns (only with consent)."] },
          { heading: "Managing your preferences", paragraphs: ["You can accept or reject non-essential cookies via the consent banner and your browser settings. Non-essential cookies are only set after consent."] },
          { heading: "Updates", paragraphs: ["How changes to this policy are communicated."] },
        ],
      },
    },
  },
  fi: {
    nav: {
      home: "Etusivu", about: "Tietoa", drivers: "Kuljettajille", business: "Lähettäjille",
      download: "Sovellus", contact: "Yhteystiedot",
      admin: "Hallintapaneeli", driveWithUs: "Tarjoa kapasiteettia", getApp: "Aloita",
    },
    footer: {
      tagline: "Tyhjän kuljetuskapasiteetin markkinapaikka — muutamme tyhjät kilometrit tuloksi kaikkialla Suomessa.",
      company: "Yritys", about: "Tietoa meistä", careers: "Kuljettajille", blog: "Blogi", press: "Media",
      products: "Alusta", driveWith: "Kuljettajat ja kalustot", forBusiness: "Lähettäjät ja yritykset",
      downloadApp: "Lataa sovellus", enterprise: "Yritykset ja logistiikka",
      legal: "Juridiikka", terms: "Käyttöehdot", privacy: "Tietosuojaseloste", cookies: "Evästekäytäntö", gdpr: "GDPR",
      contact: "Yhteystiedot", rights: "Kaikki oikeudet pidätetään.", sitemap: "Sivukartta", accessibility: "Saavutettavuus",
    },
    home: {
      heroBadge: "🚛 Tyhjän kuljetuskapasiteetin markkinapaikka",
      heroTitle1: "Muuta tyhjät", heroTitle2: "kilometrit", heroTitle3: "", heroTitle4: "tuloksi.",
      heroSub: "NadaRuns yhdistää vapaan ajoneuvokapasiteetin ja paluukuljetukset rahtiin, joka pitää siirtää — reaaliajassa. Kuljettajat ansaitsevat kilometreistä, jotka ajaisivat tyhjänä; lähettäjät saavat nopeamman ja kilpailukykyisemmän kuljetuksen.",
      becomeDriver: "🚛 Tarjoa kapasiteettia", shipWithUs: "📦 Etsi kuljetus",
      statDrivers: "Aktiivista kuljettajaa", statDeliveries: "Tyhjää km vähennetty", statRating: "Keskim. CO₂-vähennys",
      orderId: "Paluukuorma · HKI → TKU", inTransit: "● Kapasiteetti yhdistetty", route: "Puoliperävaunu · 12 t vapaana · suuntaasi",
      delivering: "Yhdistetään reaaliajassa", arriving: "Kuljettaja hyväksyy sekunneissa",
      whyTitle: "Miksi NadaRuns", whySub: "Rahtimarkkinapaikka, joka on rakennettu poistamaan tyhjät ajot ja vapauttamaan käyttämätön kapasiteetti.",
      features: [
        { title: "Reaaliaikainen yhdistäminen", desc: "Yhdistämme vapaan kapasiteetin ja paluukuljetukset lähellä olevaan rahtiin välittömästi." },
        { title: "Vähemmän tyhjää ajoa", desc: "Täytä kilometrit, jotka ajaisit tyhjänä, ja vähennä hukattua polttoainetta ja aikaa." },
        { title: "Seurattu ja vakuutettu", desc: "Reaaliaikainen seuranta ja vakuutettu kuljetus nouto- ja toimitustodistuksella." },
        { title: "Läpinäkyvä hinnoittelu", desc: "Selkeä, etukäteen näytettävä hinta kuljettajille ja lähettäjille — ei tinkimistä." },
      ],
      howTitle: "Näin se toimii", howSub: "Olitpa rahdin siirtäjä tai sen tarvitsija, yhdistäminen vie minuutteja.",
      forDrivers: "🚛 Kuljettajille", driverHead: "Täytä tyhjät kilometrisi",
      driverSteps: [
        { title: "Ilmoita kapasiteetti ja reitit", desc: "Julkaise vapaa kapasiteettisi, suunnitellut reitit ja paluukuljetukset." },
        { title: "Yhdistetään", desc: "Saat ajoneuvoosi ja suuntaasi sopivaa rahtia reaaliajassa." },
        { title: "Aja ja saa maksu", desc: "Viimeistele kuorma toimitustodistuksella ja saat maksun viikoittain." },
      ],
      forBusiness: "📦 Lähettäjille", bizHead: "Siirrä rahtia älykkäämmin",
      bizSteps: [
        { title: "Ilmoita rahtisi", desc: "Syötä nouto, toimitus, kuorma ja ajoneuvo alle minuutissa." },
        { title: "Yhdistetään heti", desc: "Hyödynnä kapasiteettia, joka on jo matkalla suuntaasi, kilpailukykyiseen hintaan." },
        { title: "Seuraa toimitukseen", desc: "Seuraa lähetystäsi reaaliajassa nouto- ja toimitustodistuksella." },
      ],
      learnMore: "Lue lisää →",
      lovedTitle: "Luotettu koko toimitusketjussa", lovedSub: "Kuljettajat, kalustot ja lähettäjät liikkuvat enemmän vähemmällä hukalla.",
      testimonials: [
        { name: "Mikko L.", role: "Yksityisautoilija", text: "Paluukuljetukseni olivat ennen tyhjiä. Nyt NadaRuns täyttää ne automaattisesti — puhdasta lisätuloa kilometreistä, jotka ajoin muutenkin." },
        { name: "Sanna R.", role: "Kaluston operaattori", text: "Ajoneuvojen käyttöaste on noussut ja tyhjät kilometrit vähentyneet. Yhdistäminen on nopeaa ja hinnoittelu läpinäkyvää." },
        { name: "Antti K.", role: "Logistiikkapäällikkö, valmistaja", text: "Saamme kuljetuskapasiteettia minuuteissa kilpailukykyiseen hintaan ja reaaliaikaisella seurannalla. Se on muuttanut rahdin suunnittelumme." },
      ],
      ctaTitle: "Muuta tyhjät ajot tuloksi", ctaSub: "Liity kuljettajiin, kalustoihin ja lähettäjiin, jotka jo liikkuvat enemmän NadaRunsin kanssa.",
      startDriving: "🚛 Tarjoa kapasiteettia", shipProducts: "📦 Etsi kuljetus",
    },
    appBand: {
      badge: "📱 Hanki NadaRuns-sovellus",
      title1: "Kapasiteettisi,", title2: "aina käytössä",
      sub: "Ilmoita vapaa kapasiteetti, hyväksy sopiva rahti, seuraa kuormia reaaliajassa ja saa maksu — tai ilmoita rahtisi ja katso, kun se yhdistetään. Yksi sovellus kuljettajille ja lähettäjille, iOS:lle ja Androidille.",
      comingSoon: "Julkaistaan pian — napauta merkkiä saadaksesi ilmoituksen.",
      available: "Ilmainen ladata. Saatavilla iOS:lle ja Androidille.",
      inTransit: "● Kapasiteetti yhdistetty", orderId: "Paluukuorma · HKI → TKU", arriving: "Kuljettaja matkalla",
      earnings: "Tällä viikolla saatu", goOnline: "Mene saataville",
    },
    badges: { soon: "PIAN", iosSub: "Lataa", iosMain: "App Storesta", androidSub: "SAATAVILLA", androidMain: "Google Playssa" },
    about: {
      metaTitle: "Tietoa NadaRunsista — Tyhjän kuljetuskapasiteetin markkinapaikka",
      heroBadge: "✨ Missiomme",
      heroTitle1: "Lopetamme tyhjän ajon,", heroTitle2: "yksi yhdistäminen kerrallaan",
      heroLead: "Euroopassa rekat ajavat tyhjänä noin joka neljännellä matkalla — hukaten polttoainetta, aikaa, rahaa ja päästöjä. NadaRuns on markkinapaikka, joka yhdistää tämän käyttämättömän kapasiteetin rahtiin reaaliajassa.",
      statsLabels: ["Tyhjää km vähennetty", "Aktiivista kuljettajaa", "Tuloa palautettu", "Keskim. CO₂-vähennys"],
      missionBadge: "Ongelma ja ratkaisumme",
      missionTitle: "Tyhjät kilometrit maksavat kuljetusyrityksille miljoonia joka vuosi",
      missionP1: "Tyhjänä ajaminen — ilman kuormaa — polttaa polttoainetta, kuluttaa ajoneuvoja, hukkaa kuljettajan työtunteja ja tuottaa CO₂-päästöjä ilman tuloa. Kuljettajille se on menetettyä voittoa; ympäristölle vältettävissä olevia päästöjä.",
      missionP2: "NadaRuns korjaa tämän yhdistämällä vapaan kapasiteetin ja paluukuljetukset lähellä oleviin rahtimahdollisuuksiin reaaliajassa. Kuljettajat saavat tuloa kilometreistä, jotka ajaisivat tyhjänä, ja lähettäjät saavat nopeamman ja kilpailukykyisemmän pääsyn kuljetuksiin.",
      diffTitle: "Mikä tekee meistä erilaisia",
      diffs: [
        "Vapaan kapasiteetin ja paluukuljetusten reaaliaikainen yhdistäminen",
        "Läpinäkyvä, etukäteen näytettävä hinnoittelu molemmille osapuolille",
        "Rakennettu kuljettajille, kalustoille, yksityisautoilijoille ja lähettäjille",
        "Reaaliaikainen seuranta ja vakuutettu kuljetus jokaisessa kuormassa",
        "Vähemmän tyhjää ajoa tarkoittaa pienempiä kustannuksia ja päästöjä",
      ],
      timelineHead: "Matkamme", timelineSub: "Helsinkiläisestä ideasta Pohjolaa liikuttavaksi rahtimarkkinapaikaksi.",
      timeline: [
        { year: "2024", title: "NadaRuns syntyy", desc: "Perustettu Helsingissä yhden ajatuksen pohjalta: tyhjät kilometrit ovat ratkaistavissa oleva, miljardien arvoinen ongelma." },
        { year: "2024", title: "Ensimmäiset yhdistämiset", desc: "Yksityisautoilijat ja paikalliset kalustot todistivat mallin — paluukuormat täyttyivät automaattisesti." },
        { year: "2025", title: "Kapasiteettia mittakaavassa", desc: "Yksitoista ajoneuvotyyppiä ja älykäs reitin yhdistäminen Suomen rahtikäytävillä." },
        { year: "Tänään", title: "Skaalaamme Pohjolaan", desc: "Tuhannet kuljettajat ja lähettäjät vähentävät tyhjiä ajoja ja päästöjä joka päivä." },
      ],
      valuesHead: "Mitä edustamme", valuesSub: "Periaatteet tehokkaamman ja kestävämmän logistiikkaverkoston takana.",
      values: [
        { title: "Tehokkuus", desc: "Jokainen tyhjä kilometri on hukkaa. Olemme olemassa muuttaaksemme käyttämättömän kapasiteetin arvoksi." },
        { title: "Reiluus", desc: "Läpinäkyvä hinnoittelu ja reilut ehdot sekä kuljettajille että lähettäjille." },
        { title: "Kestävyys", desc: "Vähemmän tyhjää ajoa tarkoittaa vähemmän poltettua polttoainetta ja pienempiä CO₂-päästöjä." },
        { title: "Luottamus ja turvallisuus", desc: "Vahvistetut kuljettajat, vakuutetut kuormat ja toimitustodistus jokaisessa yhdistämisessä." },
        { title: "Luotettavuus", desc: "Reaaliaikainen yhdistäminen ja seuranta, joiden varaan voit suunnitella toimintasi." },
        { title: "Rakennettu Pohjolaan", desc: "Viritetty Suomen rahtiverkostolle — ja skaalautuu koko alueelle." },
      ],
      ctaTitle: "Liity liikkeeseen", ctaSub: "Ajoitpa ajoneuvoja tai lähetitpä rahtia, NadaRuns on rakennettu sinua varten.",
      ctaDrive: "Tarjoa kapasiteettia", ctaShip: "Etsi kuljetus",
    },
    drivers: {
      metaTitle: "Kuljettajille — Muuta tyhjät kilometrit tuloksi NadaRunsilla",
      heroBadge: "🚛 Kuljettajille, kalustoille ja yksityisautoilijoille",
      heroTitle1: "Ajoneuvosi.", heroTitle2: "Reittisi.", heroTitle3: "Ei tyhjää ajoa.",
      heroLead: "Ilmoita vapaa kapasiteettisi ja paluukuljetuksesi, niin NadaRuns yhdistää sinut suuntaasi menevään rahtiin — jotta ansaitset kilometreistä, jotka muuten ajaisit tyhjänä.",
      cardStatus: "● Saatavilla · yhdistetään", cardToday: "Palautettu tänään",
      benefitsHead: "Miksi kuljettajat valitsevat NadaRunsin", benefitsSub: "Enemmän tuloa, parempi käyttöaste ja vähemmän tyhjiä kilometrejä.",
      benefits: [
        { title: "Palauta menetetty tulo", desc: "Täytä tyhjät ja paluukuljetukset maksavalla rahdilla — lisätuloa matkoista, jotka teet jo." },
        { title: "Korkeampi käyttöaste", desc: "Pidä rekat kuormattuina molempiin suuntiin ja saa enemmän arvoa jokaisesta ajoneuvosta." },
        { title: "Vähemmän tyhjiä kilometrejä", desc: "Vähennä hukattua polttoainetta, kulumista ja työtunteja yhdistämällä kuormat suuntaasi." },
        { title: "Käytä mitä tahansa ajoneuvoa", desc: "Pakettiautosta puoliperävaunuun — rekisteröi useita ja vaihda milloin tahansa." },
        { title: "Reaaliaikaiset kuormailmoitukset", desc: "Saat ilmoituksen heti, kun sopiva rahti ilmestyy reittisi lähelle." },
        { title: "Nopea, läpinäkyvä palkka", desc: "Näe maksusi ennen hyväksymistä, seuraa sovelluksessa ja saa maksu viikoittain." },
      ],
      payBadge: "💶 Läpinäkyvä palkka",
      payTitle: "Näe tarkalleen mitä kukin kuorma maksaa — ennen hyväksymistä",
      payP1: "Ei arvailua eikä piilokuluja. Jokainen yhdistetty kuorma näyttää arvioidun maksusi etukäteen, joten tiedät aina matkan arvon ennen sitoutumista.",
      payP2: "Pidät suurimman osan jokaisesta maksusta ja 100 % lähettäjän bonuksesta — ja kaikki on tuloa kilometreistä, jotka ajoit muutenkin.",
      payCardTitle: "Esimerkki paluukuorman maksusta",
      payRows: [
        { k: "Perusmaksu", v: "420,00 €" },
        { k: "Lähettäjän bonus", v: "40,00 €" },
        { k: "Alustamaksu", v: "−69,00 €" },
      ],
      payReceive: "Saat",
      stepsHead: "Aloita ansaitseminen 4 vaiheessa",
      steps: [
        { title: "Rekisteröidy", desc: "Luo kuljettajatilisi ja lisää ajoneuvosi minuuteissa." },
        { title: "Ilmoita kapasiteetti", desc: "Julkaise vapaa kapasiteettisi, suunnitellut reitit ja paluukuljetukset." },
        { title: "Hyväksy yhdistämiset", desc: "Saat suuntaasi sopivaa rahtia ja pyyhkäiset hyväksyäksesi." },
        { title: "Saat maksun", desc: "Viimeistele toimitustodistuksella — ansiot lompakkoosi viikoittain." },
      ],
      reqTitle: "Mitä tarvitset",
      reqLead: "Vahvistaminen on nopeaa. Pidä nämä valmiina, niin voit yhdistää kuormia jo tänään.",
      requirements: [
        "Voimassa oleva ajokortti ajoneuvoluokallesi",
        "Ajoneuvon rekisteröinti ja kuljetusvakuutus",
        "Tarvittaessa liikennelupa kuormallesi",
        "Älypuhelin (iOS tai Android)",
      ],
      readyTitle: "Valmis täyttämään tyhjät ajot?", readyDesc: "Lataa sovellus ja ilmoita kapasiteettisi jo tänään.",
      faqHead: "Kuljettajien kysymyksiin vastattu",
      faqs: [
        { q: "Miten NadaRuns vähentää tyhjiä ajojani?", a: "Julkaiset vapaan kapasiteettisi ja suunnitellut reittisi — paluukuljetukset mukaan lukien — ja yhdistämme sinut lähellä olevaan rahtiin, joka sopii suuntaasi ja ajoneuvoosi, jotta täytät kilometrit, jotka muuten ajaisit tyhjänä." },
        { q: "Kuinka paljon voin ansaita?", a: "Se riippuu reiteistäsi ja ajoneuvostasi, mutta koska kyse on tulosta matkoista, jotka teet jo, se on suurelta osin lisätuloa. Näet arvioidun maksun jokaisesta kuormasta ennen hyväksymistä." },
        { q: "Mitä ajoneuvoja voin rekisteröidä?", a: "Mitä tahansa pakettiautosta puoliperävaunuun. Rekisteröi useita ajoneuvoja ja vaihda aktiivista milloin tahansa haluamiisi kuormiin." },
        { q: "Milloin ja miten saan maksun?", a: "Ansiot seurataan reaaliajassa sovelluksessa ja maksetaan tilillesi säännöllisellä viikkosyklillä verojen jälkeen." },
        { q: "Tarvitsenko oman yrityksen?", a: "Yksityisautoilijat, kevytyrittäjät ja kalustot ovat kaikki tervetulleita. Tarvitset vain voimassa olevan ajokortin, rekisteröinnin ja vakuutuksen ajoneuvollesi ja kuormallesi." },
      ],
      ctaTitle: "Lopeta tyhjänä ajaminen", ctaSub: "Ilmoita kapasiteettisi, yhdisty reittisi rahtiin ja muuta tyhjät kilometrit tuloksi.",
    },
    business: {
      metaTitle: "Lähettäjille — Nopeampi ja kilpailukykyisempi rahti NadaRunsilla",
      heroBadge: "📦 Lähettäjille ja yrityksille",
      heroTitle1: "Siirrä rahtia hyödyntäen", heroTitle2: "kapasiteettia, joka on jo olemassa",
      heroLead: "Hyödynnä rekkoja, jotka ovat jo matkalla suuntaasi. NadaRuns yhdistää rahtisi vapaaseen kapasiteettiin ja paluukuljetuksiin — nopeampi pääsy kuljetuksiin, enemmän vaihtoehtoja ja kilpailukykyinen hinta.",
      ctaStart: "Ilmoita rahti", ctaSales: "Keskustele myynnin kanssa",
      priceLabel: "Arvioitu hinta", priceRoute: "Helsinki → Tampere · 180 km · 8 lavaa",
      priceRows: [
        { k: "Perusmaksu", v: "180,00 €" },
        { k: "Etäisyys", v: "220,00 €" },
        { k: "Kapasiteettialennus", v: "−45,00 €" },
        { k: "Polttoaine", v: "28,00 €" },
      ],
      featuresHead: "Kaikki mitä rahtisi tarvitsee", featuresSub: "Tehokas, läpinäkyvä ja rakennettu skaalautumaan toimintasi mukana.",
      features: [
        { title: "Nopeampi pääsy kapasiteettiin", desc: "Yhdisty kuljettajiin, jotka ovat jo matkalla suuntaasi — usein minuuteissa." },
        { title: "Kilpailukykyinen hinta", desc: "Koska hyödynnät jo olemassa olevaa kapasiteettia, hinnat ovat kilpailukykyisempiä." },
        { title: "Reaaliaikainen seuranta", desc: "Seuraa jokaista lähetystä kartalla reaaliaikaisella saapumisajalla." },
        { title: "Toimitustodistus", desc: "Nouto- ja toimitustodistus jokaisessa kuormassa — täysin vakuutettu." },
        { title: "Mikä tahansa kuorma, mikä tahansa ajoneuvo", desc: "Paketeista täysiin kuormiin, kylmäkuljetuksista ylisuuriin — oikea sopivuus joka kerta." },
        { title: "Laajemmat kuljetusvaihtoehdot", desc: "Kasvava vahvistettujen kuljettajien verkosto tarkoittaa enemmän valinnanvaraa ja varmuutta." },
      ],
      fleetHead: "Kapasiteettia jokaiseen kuormaan", fleetSub: "Yksitoista ajoneuvotyyppiä, jotta rahtisi matkaa aina oikealla tavalla.",
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
        { title: "Ilmoita rahti", desc: "Syötä nouto, toimitus, kuorma ja ajoneuvo — saat välittömän hinnan." },
        { title: "Yhdistetään", desc: "Lähellä oleva kuljettaja, jolla on sopiva kapasiteetti, hyväksyy kuormasi." },
        { title: "Seuraa reaaliajassa", desc: "Seuraa lähetystä reaaliajassa ja viesti kuljettajasi kanssa." },
        { title: "Toimitettu", desc: "Vahvistettu nouto- ja toimitustodistuksella. Valmis." },
      ],
      industriesHead: "Rakennettu jokaiselle toimialalle", industriesSub: "Valmistajat, tukkukauppiaat, vähittäiskauppiaat ja pk-yritykset liikkuvat NadaRunsilla.",
      industries: [
        { title: "Valmistus", desc: "Luotettava B2B-rahti tehtaiden, varastojen ja jakelijoiden välillä." },
        { title: "Tukkukauppa ja jakelu", desc: "Siirrä lavoja ja irtotavaraa reiteillesi sovitetulla kapasiteetilla." },
        { title: "Vähittäiskauppa ja verkkokauppa", desc: "Täydennä myymälöitä ja toimita tilauksia joustavalla, skaalautuvalla kuljetuksella." },
        { title: "Rakentaminen", desc: "Kuljeta työkalut, materiaalit ja lavat työmaalle laveteilla ja nostureilla." },
        { title: "Ruoka ja päivittäistavarat", desc: "Lämpötilasäädelty kapasiteetti pitää tuoretuotteet tuoreina joka matkalla." },
        { title: "Pk-yritykset", desc: "Yritystason rahtipääsy ilman raskaita kuluja tai sopimuksia." },
      ],
      faqHead: "Usein kysytyt kysymykset",
      faqs: [
        { q: "Miten hinta lasketaan?", a: "Hinta perustuu etäisyyteen, painoon, ajoneuvotyyppiin ja reittiin, ja koko tarjous näytetään etukäteen ennen vahvistusta. Koska hyödynnät jo olemassa olevaa kapasiteettia, hinnat ovat usein kilpailukykyisempiä kuin oma kuljetus." },
        { q: "Kuinka nopeasti rahtini yhdistetään?", a: "Usein minuuteissa. Yhdistämme kuormasi lähimpään kuljettajaan, jonka vapaa kapasiteetti ja reitti sopivat lähetykseesi." },
        { q: "Voinko seurata lähetystäni?", a: "Kyllä. Jokainen kuorma sisältää reaaliaikaisen kartan kuljettajan sijainnista ja saapumisajasta sekä sovelluksen sisäisen viestinnän noudosta toimitukseen." },
        { q: "Mitä voin lähettää?", a: "Mitä tahansa yksittäisestä lavasta täyteen kuormaan. 11 ajoneuvotyypillä — mukaan lukien kylmäkuljetukset ja erikoiskäsittely — löytyy sopiva lähes mille tahansa kuormalle." },
        { q: "Tarjoatteko yritystilejä?", a: "Kyllä. Säännölliseen tai suureen rahtimäärään keskustele tiimimme kanssa yritystilistä, jossa on yhdistetty laskutus ja priorisoitu tuki." },
      ],
      ctaTitle: "Valmis siirtämään rahtia älykkäämmin?", ctaSub: "Ilmoita ensimmäinen kuormasi ja yhdisty kapasiteettiin minuuteissa.",
      ctaGetApp: "Lataa sovellus", ctaContact: "Ota yhteyttä myyntiin",
    },
    contact: {
      heroBadge: "💬 Ota yhteyttä",
      heroTitle1: "Kuulisimme", heroTitle2: "mielellämme sinusta",
      heroLead: "Kysymykset, kumppanuudet tai tuki kuljettajille ja lähettäjille — tiimimme vastaa yleensä yhden työpäivän kuluessa.",
      methodEmail: "Lähetä sähköpostia", methodCall: "Soita meille", methodVisit: "Vieraile luonamme",
      formTitle: "Lähetä meille viesti",
      labelName: "Nimesi", labelEmail: "Sähköposti", labelSubject: "Aihe", labelMessage: "Viesti",
      phName: "Matti Meikäläinen", phEmail: "matti@yritys.fi", phSubject: "Miten voimme auttaa?", phMessage: "Kerro hieman lisää…",
      send: "Lähetä viesti", sending: "Lähetetään…",
      sentTitle: "Viesti lähetetty!", sentDesc: "Kiitos yhteydenotostasi — palaamme asiaan pian.", sendAnother: "Lähetä toinen",
      hoursTitle: "Tukiajat",
      faqHead: "Nopeat vastaukset",
      faqs: [
        { q: "Kuinka nopeasti vastaatte?", a: "Tiimimme vastaa yleensä yhden työpäivän kuluessa. Kaikessa kiireellisessä elävää kuormaa koskevassa sovelluksen sisäinen tuki on nopein reitti." },
        { q: "Olen kuljettaja — miten aloitan?", a: "Siirry Kuljettajille-sivulle, lataa sovellus ja ilmoita vapaa kapasiteettisi ja reittisi. Vahvistaminen vie minuutteja." },
        { q: "Olen lähettäjä — miten varaan?", a: "Ilmoita rahtisi sovelluksessa tai keskustele tiimimme kanssa yritystilistä säännöllisille tai suurille reiteille." },
        { q: "Palveletteko alueellani?", a: "Laajennamme nopeasti kaikkialle Suomeen ja Pohjolaan. Lähetä reittisi, niin kerromme alueesi kattavuudesta." },
      ],
    },
    download: {
      metaTitle: "Lataa NadaRuns-sovellus — Kapasiteetin yhdistäminen iOS & Android",
      heroBadge: "⬇️ Lataa NadaRuns",
      heroTitle1: "Hanki sovellus.", heroTitle2: "Lopeta tyhjänä ajaminen.",
      heroLeadSoon: "Yksi sovellus kuljettajille ja lähettäjille. Julkaistaan pian App Storessa ja Google Playssa — napauta alta saadaksesi ilmoituksen.",
      heroLeadLive: "Yksi sovellus kuljettajille ja lähettäjille. Saatavilla nyt App Storessa ja Google Playssa.",
      scan: "Skannaa ladataksesi",
      featuresHead: "Kaikki yhdessä sovelluksessa", featuresSub: "Rakennettu nopeudelle, käyttöasteelle ja ihastuttavalle käyttökokemukselle.",
      features: [
        { title: "Reaaliaikainen yhdistäminen", desc: "Ilmoita kapasiteetti tai rahti ja yhdisty reaaliajassa." },
        { title: "Reaaliaikainen seuranta", desc: "Seuraa jokaista kuormaa kartalla noudosta toimitukseen." },
        { title: "Ansionäkymä", desc: "Kuljettajat näkevät palautetun tulon tänään, tällä viikolla ja kaikkiaan." },
        { title: "Sovelluksen sisäinen viestintä", desc: "Viestit lähettäjän ja kuljettajan välillä ilman numeroiden jakamista." },
        { title: "Seurattu ja vakuutettu", desc: "Nouto- ja toimitustodistus sekä vakuutettu kuljetus jokaisessa kuormassa." },
        { title: "Nopea varaaminen", desc: "Ilmoita rahti tai kapasiteetti alle minuutissa välittömällä hinnoittelulla." },
      ],
      ctaTitle: "Valmiina kun sinä olet", ctaSub: "Lataa NadaRuns ja aloita kapasiteetin yhdistäminen minuuteissa.",
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
        intro: "NadaRuns Oy ylläpitää B2B-logistiikkamarkkinapaikkaa ja on sitoutunut suojelemaan henkilötietojasi EU:n yleisen tietosuoja-asetuksen (GDPR) mukaisesti. Tämä sivu kokoaa oikeutesi ja sen, miten voit käyttää niitä.",
        sections: [
          { heading: "Oikeutesi pähkinänkuoressa", bullets: ["Oikeus saada tietoa tietojesi käytöstä.", "Oikeus tutustua hallussamme oleviin henkilötietoihin.", "Oikeus virheellisten tietojen oikaisuun.", "Oikeus tietojen poistamiseen lain rajoissa.", "Oikeus käsittelyn rajoittamiseen.", "Oikeus tietojen siirrettävyyteen.", "Oikeus vastustaa käsittelyä.", "Oikeudet automaattiseen päätöksentekoon liittyen."] },
          { heading: "Miten käytät oikeuksiasi", paragraphs: ["Lähetä pyyntö osoitteeseen care@nadaruns.com. Vahvistamme henkilöllisyytesi ja vastaamme yhden kuukauden kuluessa GDPR:n edellyttämällä tavalla."] },
          { heading: "Mitä tietoja käsittelemme ja miksi", paragraphs: ["Katso tietosuojaselosteesta tietoluokat (tili, kuljettajan tunnistautuminen, kapasiteetti/reitti, varaus, sijainti ja maksut), käyttötarkoitukset ja oikeusperusteet."] },
          { heading: "Alikäsittelijät", paragraphs: ["Pidämme tietojenkäsittelysopimukset voimassa luotettujen alikäsittelijöiden kanssa (esim. Stripe maksuihin, kartat/reititys, pilvipalvelut)."] },
          { heading: "Valvontaviranomainen", paragraphs: ["Voit tehdä valituksen tietosuojavaltuutetun toimistolle Suomessa."] },
        ],
      },
      privacy: {
        metaTitle: "Tietosuojaseloste — NadaRuns",
        title: "Tietosuojaseloste",
        intro: "Tämä tietosuojaseloste kuvaa, miten NadaRuns Oy (\"me\") kerää, käyttää, jakaa ja suojaa henkilötietoja, kun käytät NadaRuns-logistiikkamarkkinapaikkaa. Toimimme rekisterinpitäjänä EU:n GDPR:n ja Suomen lain mukaisesti.",
        sections: [
          { heading: "Rekisterinpitäjä", paragraphs: ["NadaRuns Oy, Y-tunnus 3456789-1, Mannerheimintie 10, 00100 Helsinki, Suomi. Tietosuoja-asioissa ota yhteyttä care@nadaruns.com."] },
          { heading: "Keräämämme tiedot", bullets: ["Tilitiedot: nimi, yritys, sähköposti, puhelin, tiivistetty salasana.", "Kuljettajan tunnistautuminen: henkilöllisyys- ja ajokorttiasiakirjat, ajoneuvon rekisteröinti ja vakuutus.", "Kapasiteetti- ja reittitiedot: ajoneuvotyyppi, vapaa kapasiteetti, reitit ja paluukuljetukset.", "Varaustiedot: nouto/toimitus, kuorman tiedot, hinnat, aikaleimat.", "Sijaintitiedot: ajoneuvon GPS saatavilla ollessa tai kuormaa suorittaessa.", "Maksutiedot: käsittelee Stripe; tallennamme rajoitettuja tapahtumatietoja, emme täysiä korttinumeroita."] },
          { heading: "Miten käytämme tietojasi ja oikeusperusteet", paragraphs: ["Kapasiteetin ja rahdin yhdistämiseen sekä varausten ja maksujen hoitamiseen (sopimus), markkinapaikan turvallisuuteen ja lakisääteisiin velvoitteisiin, sekä palvelun parantamiseen ja viestintään (oikeutettu etu tai suostumus)."] },
          { heading: "Jakaminen ja käsittelijät", paragraphs: ["Yhdistämisen toteuttamiseksi jaamme tarvittavat tiedot kuljettajan ja lähettäjän välillä. Käytämme alikäsittelijöitä maksuihin (Stripe), kartoihin/reititykseen, pilvipalveluihin ja sähköpostiin, kukin tietojenkäsittelysopimuksen alaisena."] },
          { heading: "Kansainväliset siirrot", paragraphs: ["Kun tietoja siirretään EU:n/ETA:n ulkopuolelle, tukeudumme suojatoimiin, kuten vakiosopimuslausekkeisiin."] },
          { heading: "Oikeutesi", paragraphs: ["Voit tutustua tietoihisi, oikaista, poistaa, rajoittaa, vastustaa ja siirtää niitä sekä peruuttaa suostumuksen. Katso GDPR-sivulta miten käytät niitä."] },
          { heading: "Tietoturva", paragraphs: ["Tekniset ja organisatoriset toimenpiteet suojaavat tietosi (salaus siirrossa, tiivistetyt salasanat, pääsynhallinta)."] },
          { heading: "Yhteydenotto ja valitukset", paragraphs: ["Ota yhteyttä care@nadaruns.com tietosuoja-asioissa. Voit myös tehdä valituksen tietosuojavaltuutetulle."] },
        ],
      },
      terms: {
        metaTitle: "Käyttöehdot — NadaRuns",
        title: "Käyttöehdot",
        intro: "Nämä ehdot säätelevät NadaRuns-logistiikkamarkkinapaikan, verkkosivustojen ja sovellusten käyttöä, joita NadaRuns Oy operoi. Luomalla tilin tai käyttämällä palvelua hyväksyt nämä ehdot. NadaRuns on teknologia-alusta, joka yhdistää itsenäiset kuljettajat ja lähettäjät; mahdollistamme yhdistämiset ja maksut mutta emme itse suorita kuljetusta.",
        sections: [
          { heading: "Määritelmät", bullets: ["\u201cAlusta\u201d — NadaRuns-markkinapaikka, verkkosivustot, sovellukset ja rajapinnat.", "\u201cKuljettaja\u201d — kuljetusyritys, kalustonhaltija tai yksityisautoilija, joka tarjoaa kapasiteettia.", "\u201cLähettäjä\u201d — yritys, joka varaa rahtikuljetuksen.", "\u201cKuorma\u201d — Alustalle luotu rahtivaraus."] },
          { heading: "Tilit ja kelpoisuus", paragraphs: ["Sinun on annettava oikeat tiedot ja pidettävä tunnuksesi turvassa. Kuljettajien on suoritettava henkilöllisyyden, ajokortin, ajoneuvon ja vakuutuksen vahvistus ennen kuormien hyväksymistä."] },
          { heading: "Yhdistäminen, hinnoittelu ja maksut", paragraphs: ["Alusta yhdistää vapaan kapasiteetin ja paluukuljetukset rahtiin. Hinnat näytetään läpinäkyvästi etukäteen. Maksut käsitellään Stripen kautta; NadaRuns veloittaa palvelumaksun, ja kuljettajan ansiot maksetaan säännöllisesti verojen (ALV) jälkeen."] },
          { heading: "Kuljettajan velvoitteet", paragraphs: ["Kuljettajilla on oltava voimassa olevat ajokortit ja vakuutukset, ajoneuvojen on oltava ajokuntoisia, kuorma on käsiteltävä turvallisesti ja laillisesti, nouto- ja toimitustodistus on toimitettava, ja kapasiteetti- ja reitti-ilmoitusten on oltava paikkansapitäviä."] },
          { heading: "Lähettäjän velvoitteet", paragraphs: ["Lähettäjien on kuvattava kuorma tarkasti, varmistettava sen laillisuus ja asetettava se noudettavaksi sovitusti. Vaaralliset tai rajoitetut tavarat vaativat asianmukaisen ilmoituksen ja käsittelyn."] },
          { heading: "Vastuu ja vakuutus", paragraphs: ["Kuljetus on vakuutettu noudosta toimitukseen varauksessa kuvatussa laajuudessa. Suomen lain sallimissa rajoissa NadaRunsin vastuu välittäjänä on rajoitettu; kuljettaja suorittaa kuljetuksen."] },
          { heading: "Keskeytys ja irtisanominen", paragraphs: ["Voimme keskeyttää tai irtisanoa tilit, jotka rikkovat näitä ehtoja, lakia tai markkinapaikan turvallisuutta."] },
          { heading: "Sovellettava laki ja riidat", paragraphs: ["Näihin ehtoihin sovelletaan Suomen lakia, ja riidat ratkaistaan toimivaltaisissa Suomen tuomioistuimissa tai soveltuvissa kuluttajariitaelimissä."] },
          { heading: "Muutokset näihin ehtoihin", paragraphs: ["Miten päivityksistä ilmoitetaan ja milloin ne tulevat voimaan."] },
        ],
      },
      cookies: {
        metaTitle: "Evästekäytäntö — NadaRuns",
        title: "Evästekäytäntö",
        intro: "Tämä evästekäytäntö kuvaa, miten NadaRuns käyttää evästeitä ja vastaavia teknologioita verkkosivustollamme ja miten voit hallita niitä. Sitä tulee lukea yhdessä tietosuojaselosteemme kanssa.",
        sections: [
          { heading: "Mitä evästeet ovat", paragraphs: ["Lyhyt selitys evästeistä ja vastaavista teknologioista (paikallinen tallennustila, pikselit)."] },
          { heading: "Käyttämämme evästeluokat", bullets: ["Ehdottoman välttämättömät — vaaditaan sivuston toiminnalle.", "Asetukset — muistavat valinnat, kuten kielen.", "Analytiikka — auttavat ymmärtämään käyttöä ja parantamaan palvelua.", "Markkinointi — mittaavat kampanjoita (vain suostumuksella)."] },
          { heading: "Asetustesi hallinta", paragraphs: ["Voit hyväksyä tai hylätä ei-välttämättömät evästeet suostumusbannerin ja selaimen asetusten kautta. Ei-välttämättömät evästeet asetetaan vasta suostumuksen jälkeen."] },
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
    "/": { title: "NadaRuns — Tyhjän kuljetuskapasiteetin markkinapaikka", description: "NadaRuns yhdistää vapaan kuljetuskapasiteetin ja paluukuljetukset rahtiin reaaliajassa. Muuta tyhjät kilometrit tuloksi — kuljettajille ja lähettäjille kaikkialla Suomessa." },
    "/about": { title: "Tietoa NadaRunsista — Tyhjän kuljetuskapasiteetin markkinapaikka", description: "NadaRuns vähentää tyhjiä ajoja yhdistämällä vapaan kuljetuskapasiteetin rahtiin reaaliajassa. Tutustu missioomme ja tarinaamme." },
    "/drivers": { title: "Kuljettajille — Muuta tyhjät kilometrit tuloksi", description: "Ilmoita vapaa kapasiteettisi ja paluukuljetuksesi, niin NadaRuns yhdistää sinut suuntaasi menevään rahtiin. Vähemmän tyhjää ajoa, enemmän tuloa." },
    "/business": { title: "Lähettäjille — Nopeampi ja kilpailukykyisempi rahti", description: "Hyödynnä kapasiteettia, joka on jo matkalla suuntaasi. Nopeampi pääsy kuljetuksiin, kilpailukykyinen hinta ja reaaliaikainen seuranta." },
    "/contact": { title: "Yhteystiedot — NadaRuns", description: "Ota yhteyttä NadaRunsiin. Tuki kuljettajille ja lähettäjille — vastaamme yleensä yhden työpäivän kuluessa." },
    "/download": { title: "Lataa NadaRuns-sovellus — iOS & Android", description: "Yksi sovellus kuljettajille ja lähettäjille. Ilmoita kapasiteetti tai rahti, yhdisty reaaliajassa ja seuraa kuormia." },
    "/terms": { title: "Käyttöehdot — NadaRuns", description: "NadaRuns-logistiikkamarkkinapaikan käyttöä koskevat ehdot." },
    "/privacy": { title: "Tietosuojaseloste — NadaRuns", description: "Miten NadaRuns kerää, käyttää ja suojaa henkilötietojasi GDPR:n mukaisesti." },
    "/cookies": { title: "Evästekäytäntö — NadaRuns", description: "Miten NadaRuns käyttää evästeitä ja vastaavia teknologioita verkkosivustollaan." },
    "/gdpr": { title: "GDPR & oikeutesi — NadaRuns", description: "Tietosuojaoikeutesi GDPR:n mukaan ja miten käytät niitä NadaRunsin kanssa." },
  },
  en: {
    "/": { title: "NadaRuns — The marketplace for empty transport capacity", description: "NadaRuns matches available transport capacity and return trips with freight in real time. Turn empty kilometers into revenue — for carriers and shippers across Finland." },
    "/about": { title: "About NadaRuns — The marketplace for empty transport capacity", description: "NadaRuns reduces empty runs by matching available capacity with freight in real time. Learn about our mission and story." },
    "/drivers": { title: "For Carriers — Turn empty kilometers into revenue", description: "List your available capacity and return trips and NadaRuns matches you with freight heading your way. Fewer empty runs, more revenue." },
    "/business": { title: "For Shippers — Faster, more competitive freight", description: "Tap into capacity already heading your way. Faster access to transport, competitive pricing and live tracking from pickup to delivery." },
    "/contact": { title: "Contact — NadaRuns", description: "Get in touch with NadaRuns. Support for carriers and shippers — we usually reply within one business day." },
    "/download": { title: "Download the NadaRuns App — iOS & Android", description: "One app for carriers and shippers. List capacity or post freight, match in real time and track loads live." },
    "/terms": { title: "Terms of Service — NadaRuns", description: "The terms governing the use of the NadaRuns logistics marketplace." },
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
