# NadaRuns Driver – PRD

## Brand
**NadaRuns** — modern Scandinavian logistics platform reducing empty delivery runs. This codebase ships the **Driver app** (the first product in the ecosystem). Coming next: Business/Shipper app, Admin dashboard, Marketing site.

App display name: **NadaRuns Driver** (`app.json` → `expo.name`).

## Stack
- React Native + Expo Router (mobile + web preview)
- FastAPI + MongoDB backend
- Maps: react-native-maps + Google provider on iOS/Android, stylized SVG fallback on web (Platform.select)
- Routing: Google Directions API → fallback haversine straight-line when billing/quota unavailable
- Animations: react-native-reanimated; Gestures: react-native-gesture-handler; Haptics: expo-haptics

## Core Driver Operational Flow
1. **Home dashboard** — online/offline toggle, today's earnings/deliveries/accept-rate, map + NadaRuns brand badge
2. **Incoming order request** — floating card over live map with pickup/dropoff/distance/earnings/tip/ETA/customer rating, Accept/Decline
3. **Navigate to pickup** — Google polyline (or fallback), route fitting
4. **Arrived at pickup**
5. **Confirm pickup** — items list + customer notes + **4-digit OTP modal** + swipe-to-confirm
6. **Navigate to customer**
7. **Arrived at dropoff** — apt/gate code shown
8. **Confirm delivery** — **4-digit OTP modal** + swipe to complete
9. **Earnings summary** — animated count, breakdown
10. **Rating/feedback** — thumbs up/down + optional note
11. **Delivery history** — lifetime earnings + per-delivery cards
12. **Wallet** — available + pending balance, payout schedule, transaction stream (deliveries, tips, payouts), cash-out CTA
13. **Settings/Profile** — driver info, vehicle selector, license plate, notifications, payouts (→ wallet), tax, help, privacy, sign out

## Backend Endpoints (prefixed /api)
- GET /driver/me, PATCH /driver/me, POST /driver/toggle-online, GET /driver/wallet
- GET /orders/pending, GET /orders/active, GET /orders/history
- POST /orders/{id}/accept, /reject, /advance, /rate
- POST /orders/{id}/verify-otp body `{otp, kind: 'pickup'|'dropoff'}`
- GET /orders/{id}/route — Google Directions polyline (cached + fallback)
- POST /orders/seed-new-pending (demo helper)

## Order Model fields (extended)
`pickup_otp`, `dropoff_otp` (4-digit strings), `pickup_otp_verified`, `dropoff_otp_verified`.
OTPs are generated when each order is created and migrated onto any pre-existing seed data at startup.

## Test Coverage (24/24 backend pytest)
- 9 driver lifecycle tests
- 7 settings + Directions tests
- 8 OTP + wallet tests
All frontend iter3 testIDs (otp-modal, otp-digit-*, wallet-screen, wallet-balance, cash-out-button, etc.) verified via Playwright.

## Smart Business Enhancement
**Tip-surfacing** on the incoming-order card + **48-hour earnings clearance window** visualised in the wallet (pending vs available) — drivers see exactly when money lands, increasing retention/transparency (a key gig-platform metric).

## Known Operational Notes
- Google Directions falls back to straight-line until billing is enabled on the GCP project for `AIzaSyCm_A2yMaW6HF-PTFnu-AuSvkWLCJMHtyM`. Once enabled, behaviour auto-switches; clear `db.route_cache` once.
- React-native-maps requires an EAS dev build for iOS/Android — Expo Go cannot bundle the native Google Maps SDK. Web preview always shows the SVG map.
- Expo's auto-link emits a non-blocking PluginError for react-native-maps in dev logs (no app.plugin.js export). Bundle still builds successfully.

## Planned Next Iterations
- Photo proof at delivery (camera + base64)
- Dark-mode toggle in settings (extract theme tokens behind ThemeContext)
- KYC document upload screen
- Driver onboarding flow (remove auto-seed → sign-up)
- Push notifications for new orders (Expo push tokens)
- **Business/Shipper app** (role-based login or sibling expo app)
- **Admin web dashboard** (driver approval, live tracking, analytics)
- **NadaRuns marketing site** (Expo Router web export)
