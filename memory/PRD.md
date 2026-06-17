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

## One-tap "Pay with saved card" (Feb 2026)
- **Off-session instant pay**: in the shipper's post-create payment sheet, saved cards now appear as a green one-tap button "Pay with Visa ···· 4242 · Instant" that authorizes the order off-session (Stripe PaymentIntent, `capture_method=manual`, `off_session=True`, `confirm=True`) — no checkout redirect. Funds captured on delivery like every other payment. When a saved card exists, the old "Pay now" becomes "Pay with a different card".
- Backend: `payments.create_offsession_authorization()` + `POST /api/payments/orders/{id}/pay-with-saved-card` (reuses `_assert_pm_owned` + `_apply_intent_to_order`). Graceful `CardError` → 402; guards for unowned card (404) and already-paid (400). Tested via `tests/test_iter32_pay_with_saved_card.py` (3/3) + frontend iteration_32 (PASS).
- Frontend: `api.payWithSavedCard()` + saved-card buttons in `shipper-create.tsx` modal (loads cards on sheet open).

## Test-suite hardening + geo bug fix (Feb 2026)
- **FIXED real production bug**: the driver map-based "nearby jobs" feed (`GET /api/orders/available?lat&lng&radius_km`) returned **0 jobs** even when jobs existed. Root cause: every order is written with `pickup_location: null` (model default), but both backfills only matched `{$exists: false}`, so the GeoJSON Point was never populated and `$geoNear` matched nothing. Updated both backfills (lazy in `get_available_orders` + startup `backfill_pickup_locations`) to also match `pickup_location: null`. Drivers now correctly see nearby jobs sorted by distance.
- **Test suite green-up** (was 15 failed + 7 errors → 0 real failures): deleted obsolete single-driver-prototype suite `test_driver_api.py` (replaced by `test_p0_state_machine`/`test_pricing`); authenticated the stale wallet & driver-settings tests (`test_otp_and_wallet`, `test_settings_and_route`) and updated assertions to the current contract; added admin KYC-approval to fresh-driver fixtures in `test_p0_state_machine` + `test_live_tracking` (KYC gating is enforced on accept); fixed `test_pricing` to use routable cached Helsinki→Espoo coords (Google Directions key is unbilled in preview → remote coords 500 by design — pricing intentionally never falls back to straight-line).
- Note: running all 255 integration tests sequentially can show 1–3 transient failures from shared demo-account state contention + tunnel ConnectTimeouts; they pass per-file in isolation.

## Recent Work (Feb 2026 — Forked session)
**Shipper payment settlement + Admin order/invoice management.**
- **Shipper "Pay Now / Accept Invoice" modal** (`/app/frontend/app/shipper-create.tsx`): after a shipment is created, a bottom-sheet `<Modal>` (testID `pay-choice-modal`) offers Option A `pay-now-button` (Stripe checkout) and Option B `accept-invoice-button` (Net-14 invoice + PDF), plus `pay-later-button`. Verified end-to-end (iteration_30).
- **Admin Web — Order Management** (`/app/web/src/components/admin/Orders.tsx`): OrderDrawer now supports pause, restore, mark-delivered, unassign (driver emergency → marketplace), mark-failed, cancel, assign/reassign driver, internal admin notes, assignment-history timeline, and linked-invoice PDF download.
- **Admin Web — Invoice Management** (`/app/web/src/components/admin/Invoices.tsx`, new nav tab): list with search + status filter, KPI totals (count/unpaid/overdue/outstanding), invoice drawer with full billing/order/amount details, mark-paid, mark-overdue, resend, download PDF, and an Invoicing Settings drawer (configurable admin fee + net days).
- adminApi (`/app/web/src/lib/adminApi.ts`) extended with all order-action + invoice + invoicePdfUrl(token) methods.
- Backend (all pre-existing & tested, 25/25 pytest iter30): `/api/admin/manage/orders/{id}/{pause|restore|complete|fail|unassign|assign|notes}`, `/assignment-history`, `/api/admin/invoices`, `/mark-paid|mark-overdue|resend`, `/api/invoices/{id}/pdf?token=`, `/api/admin/settings/invoicing`.

## Recent Work — P2 Saved Cards + P3 Tracking i18n (Feb 2026, same fork)
- **P2 DONE — Shipper Saved Payment Methods (Stripe)** via SetupIntent through hosted Checkout (mode=setup), consistent with existing redirect-based Pay Now (no native Stripe SDK).
  - Backend (`services/payments.py` + `server.py`): `create_customer`, `create_setup_checkout_session`, `list_payment_methods`, `set_default_payment_method`, `detach_payment_method`. Endpoints: `POST /api/shipper/payment-methods/setup-checkout`, `GET /api/shipper/payment-methods`, `POST /api/shipper/payment-methods/{pm_id}/default`, `DELETE /api/shipper/payment-methods/{pm_id}`. Lazy Stripe customer stored as `stripe_customer_id` on shipper doc. Ownership guard (403). Tested 9/9 pytest (`tests/test_iter31_payment_methods.py`).
  - Frontend: new `app/shipper-payment-methods.tsx` (list, add-card redirect, set-default, delete) linked from shipper-settings. `api.ts` methods added. Verified end-to-end.
- **P3 DONE — shipper-tracking.tsx i18n** (English + Finnish): added `tracking` + `paymentMethods` blocks to en/fi locales; all status/payment labels + UI strings + alerts translated. Verified bilingual render, no raw-key leakage.

## Roadmap / Backlog
- **P3 (remaining) — i18n Batch C** for any other untranslated Expo screens + the Next.js web admin.
- **Refactor**: split `server.py` (~7000 lines) into routers/models; split `shipper-create.tsx` (~2069 lines) into per-step components; add testIDs to shipper-create inputs.
- Cosmetic: `/api/auth/shipper-login` returns shipper id under `driver_id` key.
- **Env note**: the Expo frontend supervisor program is named **`expo`** (not `frontend`); restart with `sudo supervisorctl restart expo`. New Expo Router route files require an `expo` restart to register.

## Planned Next Iterations
- Photo proof at delivery (camera + base64)
- Dark-mode toggle in settings (extract theme tokens behind ThemeContext)
- KYC document upload screen
- Driver onboarding flow (remove auto-seed → sign-up)
- Push notifications for new orders (Expo push tokens)
- **Business/Shipper app** (role-based login or sibling expo app)
- **Admin web dashboard** (driver approval, live tracking, analytics)
- **NadaRuns marketing site** (Expo Router web export)
