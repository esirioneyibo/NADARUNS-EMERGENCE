# Driver Delivery App – PRD

## Vision
Premium logistics & delivery driver app inspired by Uber Driver, Wolt Courier, Bolt Driver, and DoorDash Driver. Full-screen map-first interface, floating bottom sheets, Scandinavian modern design (deep teal/forest green), smooth animated transitions, large touch-friendly buttons.

## Stack
- React Native + Expo Router (mobile + web preview)
- FastAPI + MongoDB backend
- **Maps**: react-native-maps with Google Maps provider on iOS/Android (key in app.json), stylized SVG fallback on web (Platform.select via `.native.tsx`/`.web.tsx` extensions)
- **Routing**: Google Directions API (backend) with haversine straight-line fallback when billing/quota unavailable; routes cached in MongoDB
- Animations: react-native-reanimated; gestures: react-native-gesture-handler; haptics: expo-haptics

## Core Driver Flow (single core operational flow, not a separate module)
1. Home dashboard with online/offline toggle, today's earnings, deliveries, accept rate
2. Incoming order request card (floating over map): earnings, pickup, dropoff, distance, ETA, customer rating, Accept/Decline
3. Navigation to pickup (real Google polyline on native, straight-line on fallback)
4. Arrived at pickup
5. Confirm pickup (order items + customer notes + swipe to confirm)
6. Navigation to customer
7. Arrived at dropoff (address, apt, gate code)
8. Confirm delivery (swipe to complete)
9. Earnings summary (animated count, breakdown)
10. Thumbs up/down rating + feedback
11. Delivery history with lifetime earnings & per-delivery cards

## Settings / Profile Screen
- Profile card: avatar, name, rating, acceptance %, deliveries today
- Personal info: name, email, phone (auto-save on blur)
- Vehicle: 4-tile selector (Bicycle / Scooter / Motorbike / Car) + license plate
- Notifications: push, sound, new-order alerts, daily earnings summary toggles
- More: Payouts & bank, Tax documents, Help & Support, Privacy & terms
- Sign out

## Backend Endpoints (prefixed /api)
- GET /driver/me, PATCH /driver/me, POST /driver/toggle-online
- GET /orders/pending, GET /orders/active, GET /orders/history
- POST /orders/{id}/accept, /reject, /advance, /rate
- GET /orders/{id}/route — Google Directions polyline (decoded server-side) with cache + fallback
- POST /orders/seed-new-pending (demo helper)

## Seeded Data
On startup: 1 driver (with auto-migration of any new fields onto existing docs), 1 pending order, 8 historical delivered orders (Stockholm restaurants + customers).

## Smart Business Enhancement
Tip surfacing on the incoming-order card: drivers see total payout (base + tip) up-front, increasing acceptance rate and earnings transparency — a key retention metric for gig delivery platforms.

## Known Operational Notes
- The user-provided Google Maps API key is wired into `app.json` (iOS + Android) and into `backend/.env` as `GOOGLE_DIRECTIONS_API_KEY`. **Billing must be enabled** on the Google Cloud project to unlock the Directions API; until then, /route returns `source: "fallback"` with a straight polyline.
- react-native-maps requires a development build (EAS) to render on iOS/Android — Expo Go does not bundle native map SDKs. The web preview always uses the stylized SVG map.
