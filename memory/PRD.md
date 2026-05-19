# Driver Delivery App – PRD

## Vision
Premium logistics & delivery driver app inspired by Uber Driver, Wolt Courier, Bolt Driver, and DoorDash Driver. Full-screen map-first interface, floating bottom sheets, Scandinavian modern design (deep teal/forest green), smooth animated transitions, large touch-friendly buttons.

## Stack
- React Native + Expo Router (mobile + web preview)
- FastAPI + MongoDB backend
- Cross-platform stylized map via react-native-svg (no API key)
- Animations: react-native-reanimated; gestures: react-native-gesture-handler; haptics: expo-haptics

## Core Flow (single core operational flow, not a separate module)
1. Home dashboard with online/offline toggle, today's earnings, deliveries, accept rate
2. Incoming order request card (floating over map): earnings, pickup, dropoff, distance, ETA, customer rating, Accept/Decline
3. Navigation to pickup
4. Arrived at pickup
5. Confirm pickup (order items + customer notes + swipe to confirm)
6. Navigation to customer
7. Arrived at dropoff (address, apt, gate code)
8. Confirm delivery (swipe to complete)
9. Earnings summary (animated count, breakdown)
10. Thumbs up/down rating + feedback
11. Delivery history with lifetime earnings & per-delivery cards

## Backend Endpoints (prefixed /api)
- GET /driver/me, POST /driver/toggle-online
- GET /orders/pending, GET /orders/active, GET /orders/history
- POST /orders/{id}/accept, /reject, /advance, /rate
- POST /orders/seed-new-pending (demo helper)

## Seeded Data
On startup: 1 driver, 1 pending order, 8 historical delivered orders (Stockholm restaurants + customers).

## Smart Business Enhancement
Tip surfacing: every pending request highlights tip on top of base earnings → drivers see total payout up-front, increasing acceptance rate and earnings transparency (key retention metric for gig platforms).
