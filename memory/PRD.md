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

## Fleet Management — Phases 3-5: Wallet, Payouts, Admin (Jun 2026)
**Phase 3 — Company Wallet & earnings split**: on delivery of a company job, net earnings (earnings+tip) route to the **company wallet** (`available_balance`/`total_earnings`); order stores `gross_amount`/`platform_fee`/`company_earnings`. Solo drivers unchanged. Driver personal stats (earnings_today/deliveries) still increment (informational). New `company_wallets` + `company_wallet_txns` collections. `GET /api/company/wallet` (owner) → wallet + txns + payouts.
**Phase 4 — Payouts (admin-approved ledger, no Stripe transfers)**: `POST /api/company/payouts` (owner; moves available→pending, ref `PO-XXXX`). Admin: `GET /api/admin/fleet/payouts`, `/{id}/approve`, `/{id}/pay` (pending→withdrawn), `/{id}/reject` (refund to available). Statuses pending/approved/paid/rejected.
**Phase 5 — Admin Fleet dashboard** (Next.js web): `GET /api/admin/fleet/companies` (+ search/status), `/{id}` detail, `/{id}/suspend|activate`. New `web/src/components/admin/FleetCompanies.tsx` (Companies list + detail with drivers/vehicles/wallet/payouts, and Payout-requests tab with approve/pay/reject). Wired into admin `page.tsx` ("Fleet Companies" nav).
**Frontend (driver app)**: Fleet screen gains a **Wallet** tab (balances + request-payout modal + payout history + recent earnings). Localized EN+FI.
**Verified**: full money flow curl-tested (deliver→wallet credit→payout→admin approve/pay→withdrawn). NOTE: admin web is not served in preview (deploy-time); backend admin endpoints curl-verified.

## Fleet Management — Phase 2: Job acceptance & visibility (Jun 2026)
- **Order audit fields** added: `assigned_company_id`, `assigned_driver_id`, `assigned_vehicle_id` (set on accept).
- **Self-accept enforcement**: when a company driver accepts a job, the order records company/driver/vehicle (vehicle = the active fleet vehicle assigned to that driver, else null). Suspended driver/company → 403.
- **Job acceptance mode enforced**: `owner_assign` blocks driver self-accept (403); `self_accept`/`hybrid` allow it. New `POST /api/company/jobs/{order_id}/assign {driver_id, vehicle_id?}` lets the owner assign a pending order to a company driver.
- **Company job visibility**: `GET /api/company/jobs?status=` (owner) → all company jobs with driver_name/vehicle_reg + stats {total, active, completed, completed_earnings}.
- **Frontend**: Fleet screen gains a **Jobs** tab (stats row + JobCards). Localized EN+FI.
- **Verified**: testing_agent iter35 — 8/8 backend pytest + frontend Jobs tab + EN/FI, no defects.

## Fleet Management — Phase 1: Foundation (Jun 2026)
Upgraded from single-driver to a company/fleet model (backward compatible — solo drivers unaffected; `company_id`/`company_role` are null for them).
- **Account model**: any existing driver creates a Company (`POST /api/company`) and becomes `owner`. No separate login. Invited drivers log in via the normal driver login with their own email/password.
- **Roles**: Owner (full management) + Driver (own jobs/stats). Dispatcher excluded per spec.
- **Collections**: `companies`, `fleet_vehicles`; `drivers` gain `company_id`/`company_role`. Indexes added in `create_database_indexes`.
- **Endpoints** (owner JWT): `POST/GET/PATCH /api/company`, `GET/POST /api/company/drivers`, `PATCH /api/company/drivers/{id}/suspend|activate`, `DELETE /api/company/drivers/{id}` (detaches, keeps account), `GET/POST/PATCH/DELETE /api/company/vehicles`, `POST /api/company/vehicles/{id}/assign|unassign`. Non-owners get 403.
- **Job Acceptance Mode** setting stored on company: `self_accept` (default) | `owner_assign` | `hybrid` (enforcement = Phase 2).
- **Frontend**: new `/app/frontend/app/fleet.tsx` (Settings → Fleet). Create-company form, owner dashboard with mode chips + Drivers/Vehicles tabs (add/suspend/remove/assign/disable/delete via modals), member read-only view. Localized EN+FI (`fleet` namespace). `fleet` route hidden from bottom tab bar in `_layout.tsx`.
- **Verified**: testing_agent iter34 — 22/22 backend pytest + full frontend owner flow + EN/FI, no key leakage.
- **Next phases**: P2 job acceptance enforcement + owner assignment + company job visibility; P3 company wallet + earnings split + driver stats; P4 payouts (admin-approved ledger, no Stripe transfers yet); P5 admin fleet dashboard.

## Finnish Road-Freight Pricing — chargeable weight (Jun 2026)
Pricing now follows the Finnish road-transport model (Logistiikan Maailma). The WEIGHT component is charged on the **chargeable freight weight (rahdituspaino)** = the GREATEST of:
- actual weight (kg)
- volumetric weight = volume m³ × **333 kg/m³**
- pallet weight = pallets × **925 kg** (FIN pallet)
- loading-meter weight = loading-m × **1850 kg** (≈ 2 FIN pallets)
…multiplied by a per-vehicle **€/kg freight rate** (`FREIGHT_KG_RATES` in `services/pricing.py`). Distance €/km, urgency, special-vehicle multipliers, and 8% fuel surcharge unchanged.
- Backend: `pricing.chargeable_weight()` + `calculate_price(..., volume_m3, pallets, loading_meters)`; new request fields `cargo_volume_m3`/`pallet_count`/`loading_meters` on `/api/shipper/quote` + `/api/shipper/shipments`; new response fields `freight_fee`, `chargeable_weight`, `chargeable_basis`, `actual_weight_kg`.
- Frontend: `src/utils/pricing.ts` mirrors it; `shipper-create.tsx` Advanced section adds **Pallets** + **Loading-meters** inputs, computes volume from L×W×H, and the breakdown shows `Freight weight (X kg · basis)`. Localized EN+FI. Verified frontend iteration_33 (6/6, EN+FI, no key leakage).
- NOTE: Google Directions billing was enabled by the user — `/api/shipper/quote` + create now return real road distances (status OK), resolving the prior "routing configuration error".

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
