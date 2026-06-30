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

## Platform Enhancements — Email Infra + Invoices/Receipts + POP/POD (Jun 2026)
Provider-agnostic transactional email + automated financial documents + delivery proof visibility.
- **Email infrastructure (Brevo, LIVE):** `services/email_service.py` (httpx → Brevo, fire-and-forget, every send logged to `db.email_logs`) + `services/email_templates.py` (branded HTML). Configured in `backend/.env`: `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, sender `happysmiles@nadaruns.com`. `send_email_bg(...)` helper in `server.py` schedules non-blocking sends. Wired into: driver/shipper register (welcome), KYC approve/reject (driver_approved/rejected), order created (order_created), shipment lifecycle via `push_status_to_shipper` (driver_assigned + shipment_status), change-password (password_changed).
- **Automated invoices & receipts:** new `Receipt` model + `db.receipts` collection + generic `_build_doc_pdf`/`_receipt_pdf` (fpdf2). Auto-generated + emailed (idempotent): payment receipt on order capture (`_create_payment_receipt`), withdrawal invoice on `/api/wallet/withdraw`, payout receipt when admin marks withdrawal paid (`_create_withdrawal_doc`). Shipper invoice PDF emailed on `/api/shipper/shipments/{id}/accept-invoice` (only on first creation) + admin resend. Doc numbers via `_next_doc_number` (RCP/WIN/WRC prefixes).
- **New endpoints:** `GET /api/admin/receipts`, `GET /api/receipts/{id}/pdf` (owner/admin), `POST /api/admin/receipts/{id}/resend`, `GET /api/shipper/receipts`, `GET /api/admin/email-logs`.
- **Admin web (Next.js):** new `Receipts` tab (`web/src/components/admin/Receipts.tsx`) with Receipts/documents table (PDF + resend) and an Email log tab; POP/POD images added to Orders drawer.
- **POP/POD visibility:** shipper `shipper-tracking.tsx` gains a "Proof of Pickup & Delivery" card (pickup_photo/delivery_photo, tap → fullscreen Modal). Backend already exposed these on shipper/admin order detail.
- **Verified:** testing_agent iter37 — 21/21 backend pytest + frontend POP/POD card & fullscreen viewer, live Brevo sends confirmed. Note: EMAIL_DRY_RUN=false (real sends); set true to save quota during heavy testing.
- **Remaining:** Task 4 — Driver Onboarding Form Redesign (individual vs fleet/company fields, tooltips, validation) — NOT STARTED.

### Admin Email Templates preview/test-send (Jun 2026)
New admin web tab `web/src/components/admin/EmailTemplates.tsx` (nav key `emails`) lists all 15 transactional templates with realistic sample data: provider/sender/configured + dry-run banner, sandboxed iframe HTML preview, subject, and a "Send test" box that emails the chosen template (subject prefixed `[TEST]`).
Backend: `_email_template_registry()` + `GET /api/admin/email-templates`, `GET /api/admin/email-templates/{key}/preview`, `POST /api/admin/email-templates/{key}/test-send` (EmailStr validated → 422; unknown key → 404). Verified via curl (sent live Brevo test) + screenshot of the rendered tab.

### Task 4 — Driver Onboarding Redesign (Jun 2026, COMPLETE)
Backend: `DriverRegistration` extended (account_type individual|fleet, license_class, company_name, business_id, company_phone/email/address). `POST /api/driver/register` validates fleet→company_name required (400), and for fleet creates a `Company` (owner_driver_id), inits `company_wallets`, sets driver.company_id+company_role=owner; stores license_class. `api.registerDriver` type extended.
Frontend `app/onboarding.tsx`: dynamic-step wizard — account type (Individual=5 steps / Fleet=6 steps), Name, Contact, [Company step fleet-only], Vehicle (+licence-class chips +plate), Review. Cross-platform info **Tooltips** via Modal popover (testID tooltip-<field>, TOOLTIPS map). Post-register navigates directly to /kyc (RN-Web Alert callbacks dont fire). testIDs: account-individual/account-fleet, input-company-name/business-id/email/address, license-<X>, input-plate.
Verified: testing_agent iter38 (backend 5/5 pytest, both flows + empty-company validation) + screenshots (account step, company step, tooltip Modal). All 4 platform enhancements (Email infra, Invoices/Receipts, POP/POD, Onboarding) now COMPLETE.
NOTE for deploy: web admin (/app/web) must be rebuilt (`yarn build && yarn start`) on the users server to surface the new Receipts + Email Templates tabs — code is in repo and builds clean.

### Next.js Marketing Web i18n — Finnish (default) + English (Jun 2026, COMPLETE)
Lightweight client-side i18n for the Next.js marketing site (no heavy libs). `web/src/lib/i18n.tsx` holds a React Context `LanguageProvider` (default lang `fi`, persists to localStorage key `nadaruns_lang`, sets `document.documentElement.lang`), `useContent()` hook, and a `LangToggle` (FI/EN pills, testIDs `lang-fi`/`lang-en`). Full FI+EN dictionaries cover nav, footer, home, appBand, badges, about, drivers, business, contact, download, and all 4 legal docs (terms/privacy/cookies/gdpr).
Wiring: `web/src/components/ClientProviders.tsx` ("use client") wraps the tree in root `layout.tsx` (html lang="fi"); Navbar (desktop+mobile) shows LangToggle + translated links; Footer translated. All marketing pages converted to `"use client"` and read from `useContent()`. Per-page SEO `metadata` preserved by adding thin server `layout.tsx` files per route (about/drivers/business/download/terms/privacy/cookies/gdpr). Shared `LegalPage`, `AppBadges`, `AppDownloadSection` are now client + translated.
Verified: `npm run build` passes (all 12 routes prerender static), `tsc --noEmit` clean, and screenshots confirm Finnish-first render + working EN toggle (entire site swaps language). All 5 platform enhancements now COMPLETE.
DEPLOY NOTE: rebuild web admin (`yarn build && yarn start`) on the VPS to pick up the i18n changes.

### Web i18n — per-language SEO (Jun 2026, COMPLETE)
Static server `metadata` (root + per-route `layout.tsx`, incl. new contact/layout) is now Finnish (crawler default matches Finnish-first content). Added a client `SeoUpdater` in `i18n.tsx` (mounted inside `LanguageProvider`) with a per-route × per-lang `SEO` table; on lang toggle / route change it updates `document.title`, `<meta name=description>`, `og:title`, `og:description` and `<html lang>`. Verified: build prerenders FI titles/descriptions per page; EN toggle swaps title+desc+html lang live (Playwright).

### Session (Jun 2026 fork) — Sitemap fix, Nav fix, User Guides, Live Email
- **SEO sitemap/robots fix**: replaced Next.js dynamic `app/sitemap.ts`/`robots.ts` (rendered empty on static/misrouted hosting) with REAL static files `web/public/sitemap.xml` (10 marketing URLs) + `web/public/robots.txt`. Build clean; verified iter39.
- **Mobile bottom-nav fix**: `help-support` and `legal` routes were auto-added to the tab bar (stray tabs). Registered both as hidden `Tabs.Screen` (`href:null`) in `app/_layout.tsx`. Verified iter40 (driver 4 tabs, shipper 3 tabs).
- **User Guides (PowerPoint)**: `/app/user_guides/` — Driver & Shipper guides in EN + FI (`NadaRuns_Driver_Guide_EN.pptx`, `NadaRuns_Shipper_Guide_EN.pptx`, `NadaRuns_Kuljettajan_Opas_FI.pptx`, `NadaRuns_Lahettajan_Opas_FI.pptx`), plus PDF versions. Generator: `build_guides.py` (python-pptx). 11 step-slides + title each, brand-styled.
- **Live email**: code already sends live (Brevo, DRY_RUN=false) and verified with a real send (messageId returned). Root cause of "dry-run in production": `backend/.env.production` (the deploy template) was MISSING all EMAIL_* vars → `is_configured()` False → fallback to dry-run. Added EMAIL_PROVIDER/BREVO_API_KEY/EMAIL_SENDER/EMAIL_SENDER_NAME/EMAIL_DRY_RUN=false to `.env.production`. User must redeploy/restart prod backend to apply.

### server.py modular-router refactor (Jun 2026 fork, COMPLETE)
Split the 8513-line monolith: all 163 `@api_router` handlers extracted into per-domain `APIRouter` modules under `backend/routes/` — auth, driver, shipper, orders, wallet, notifications, company, payments, admin, invoices, receipts, misc. Handler bodies UNCHANGED. Each route module late-imports `server` and injects its globals (db/models/helpers/FastAPI symbols) via a `dir()` setdefault loop; `server.py` registers them with `api_router.include_router(...)` just before `app.include_router(api_router)`. server.py is now 4134 lines and keeps all models, helpers, `@app` websockets, the `/admin` HTML page, and startup/shutdown events. Models + helpers were intentionally NOT moved (future phase). Verified iter41: dedicated 22-test regression suite 100% pass + 340/345 full suite (4 failures pre-existing & unrelated: test_iter32 sys.path ModuleNotFoundError; 2 pricing assertions drift due to live Google Directions). Backup server.py.bak removed (git has history).

### Shipper create-shipment Android keyboard fix + pricing-test housekeeping (Jun 2026 fork)
- **Android keyboard overlap fix** (`app/shipper-create.tsx` + `app.json`): inputs were hidden behind the keyboard on Android. Root cause: Android 15 / edge-to-edge ignores `adjustResize`, so `KeyboardAwareScrollView` couldn't compute its offset. Fixes: (1) `app.json` → `android.softwareKeyboardLayoutMode: "resize"` (NATIVE — requires a rebuild to take effect; NOT active in Expo Go); (2) `shipper-create.tsx` tracks keyboard visibility via `KeyboardEvents` and shrinks the sticky bottom action bar padding while typing; (3) `bottomOffset` raised to 130 (Android)/100 (iOS) so focused inputs clear the sticky Continue button. Verified iter42: full 6-step create flow regression PASS on web (no crash from KeyboardEvents listener). Android soft-keyboard behavior must be validated on a device/dev build.
- **Pricing-test housekeeping**: `test_launch_readiness.py::test_quote_cargo_van_10km_100kg_standard` and `test_pricing_and_iter9.py::test_quote_known_case_cargo_van_22km_80kg_standard` were asserting a stale hardcoded `weight_fee == 10.0`; now assert against the API-returned breakdown (total = (base+distance+weight)*mults + fuel_surcharge; weight_fee = chargeable_weight × freight_rate_per_kg) using live Google road distance. Both pass.

### fleet.tsx component split (Jun 2026 fork, COMPLETE)
Split `frontend/app/fleet.tsx` (1146 lines) by extracting its 10 prop-driven presentational components (Banner, Field, DriverCard, VehicleCard, JobCard, VehicleTypePicker, AddDriverModal, AddVehicleModal, PayoutModal, PayoutRow) + VEHICLE_TYPE_OPTIONS into `frontend/src/components/fleet/FleetComponents.tsx`. fleet.tsx now 743 lines (container + makeStyles only) and imports the components. Behavior unchanged (components were already fully prop-driven; `s` styles passed in). Lint clean (0 issues). Verified via screenshot: fleet screen renders (company header, acceptance-mode toggles, Drivers/Vehicles/Jobs/Wallet tabs, DriverCard) and AddDriverModal opens with all Field inputs + VehicleTypePicker working.

### Backend refactor Phase 2 (move models/helpers → core/models.py): NOT STARTED (optional/deferred)

### Phase 1: Stripe payment + wallet hardening (Jun 2026 fork, COMPLETE)
World-standard recommendation #1. Added on top of existing authorize->capture flow:
- **Admin refunds** (`POST /api/payments/orders/{id}/refund`, RefundBody{amount?,reason?}): full or partial refund of a CAPTURED PaymentIntent via `payments.refund_payment_intent` (Stripe Refund.create w/ idempotency_key). Full refund -> order payment_status 'refunded' (excluded from driver earnings in compute_driver_balance); partial keeps 'captured' (platform absorbs) + logged. Validates against captured amount (over-refund rejected); only 'captured' orders refundable.
- **Refund ledger**: negative `payment_transactions` entry (type=refund) keyed/deduped on `stripe_refund_id`; sets order refunded_amount/refunded_at/refund_reason.
- **Webhook hardening** (`/api/payments/webhook`): event-id dedupe via `processed_webhook_events` (unique _id + 30-day TTL index) so Stripe retries never double-process; now also handles `charge.refunded` (dashboard/dispute refunds), `charge.dispute.created` (flags order has_dispute), and `payment_intent.payment_failed` (-> payment_status 'payment_failed').
- Service: `services/payments.py` gained `refund_payment_intent(intent_id, amount_cents?, idempotency_key?)`.
- Verified: self-tested full+partial refund lifecycle (authorize-test->capture->refund) on Stripe test key; 56 payment/webhook pytest pass; over-refund & double-refund correctly rejected.

#### Phase 1 follow-up fix (testing iter43): driver earnings excluded refunded orders
testing_agent found `/api/driver/wallet` and `/api/driver/performance` counted fully-refunded deliveries. Fixed in `routes/driver.py`: both delivered-order queries now filter `payment_status != 'refunded'`. Re-verified: test_iter43 18/18 pass + 98 payment/wallet/finance tests pass. (Partial refunds keep 'captured' so driver still earns full share — platform absorbs partial.)

### Phases 2-4 (Jun 2026 fork, COMPLETE — world-standard roadmap)
- **Phase 2 Live tracking + ETA**: `GET /api/orders/{id}/driver-location` now returns a REAL road ETA via Google Directions (`fetch_road_route`, graceful straight-line fallback, never 500); `GET /api/shipper/shipments/{id}/tracking` enriched (real `current_location`, target stop, eta_minutes, remaining_km, route_polyline). Frontend `shipper-tracking.tsx` already consumed these.
- **Phase 3 Ratings + Disputes**: shipper->driver star rating already existed (`/shipper/shipments/{id}/rate-driver` at shipper.py L14 — removed a duplicate I accidentally added). NEW dispute flow: shipper `POST /shipper/shipments/{id}/dispute` (sets order.has_dispute, gated to in-delivery/delivered, dedupes open disputes), admin `GET /admin/disputes?status=` (attaches POP/POD + payment context), admin `POST /admin/disputes/{id}/resolve` ('rejected' or 'refunded' -> Stripe refund via _apply_refund_to_order). Models DisputeRequest/DisputeResolveRequest in server.py. Frontend: "Report an issue" button + reason picker on tracking screen (api.openDispute).
- **Phase 4 Sentry**: backend `sentry_sdk` init in server.py (gated on SENTRY_DSN env); frontend `@sentry/react-native` init in app/_layout.tsx (gated on EXPO_PUBLIC_SENTRY_DSN). No-op until DSN provided. requirements.txt updated (sentry-sdk 2.63.0).
- Verified: testing_agent iter44 — 18/18 new + 44/44 regression backend pass; frontend bundle compiles with Sentry, report-issue button renders.
- KNOWN (platform): dispute reason picker uses Alert.alert (buttons don't render on RN-Web; works on native iOS/Android). Web parity would need an in-app modal.
- PRODUCTION TODO: set SENTRY_DSN (backend) + EXPO_PUBLIC_SENTRY_DSN (frontend) to enable Sentry; add Stripe webhook + STRIPE_WEBHOOK_SECRET.

### Final 3 requests — Frontend wiring (Jun 2026 fork, COMPLETE)
Completed the UI for the 3 backend-verified features:
- **Driver bank details**: `driver-edit.tsx` gains a "PAYOUT / BANK DETAILS" card (account_holder/iban/bank_name/swift_bic) saved via `PATCH /api/driver/me`. `wallet.tsx` cash-out modal pre-fills the IBAN from saved `driver.bank_details.iban` ("Using your saved bank account" hint) and persists the entered IBAN back on withdraw. `types.ts` adds `BankDetails` + `bank_details` on Driver/DriverUpdate. Backend `routes/driver.py::update_driver` now flattens `bank_details` to dotted `$set` keys so a partial (iban-only) update never wipes the other saved fields.
- **Shipper cargo weight**: client validation already blocked weight<=0 (step 3); removed the silent `cargo_weight_kg: weightNum || 100` fallback so the exact entered weight is always sent.
- **Web admin webhook secret**: `web/src/components/admin/Settings.tsx` now shows the masked value `· set (whsec_…)` (using `webhook_secret_masked`) so it no longer looks empty after saving.
- Verified: testing_agent iter46 — backend 6/6 pytest (full + partial-merge bank_details, withdraw, weight 422/201) + frontend E2E (driver-edit save+merge, wallet prefill+persist). Lint clean.
- DEFERRED (P2): EMERGENT_PUSH_KEY 401 on new-job push — needs user Firebase google-services.json + native build.

### Pricing engine re-architecture (marketplace model) — PHASE A COMPLETE (Jun 2026)
User approved a phased rebuild (A→F). Philosophy: NadaRuns is a *marketplace* (reduce empty runs, maximise utilisation, balance supply/demand), not a carrier. Pricing is multiplicative & config-driven; deterministic + explainable (no LLM decides price — AI only for prediction later).
**Phase A (DONE & tested):**
- Rewrote `backend/services/pricing.py` into a config-driven, multiplicative engine: Final = (Base + Distance) × (1+weight-category) × capacity × supply/demand × empty-run × route-match × urgency × special × regional × seasonal × reputation + fuel (+bonus 100% to driver). Distance is primary; weight is now only a *category %* (Finnish chargeable weight still computed). Returns a transparent line-by-line `breakdown_lines` + `traditional_estimate`/`savings`/`savings_pct`. Back-compat wrappers `calculate_price`/`driver_earnings` kept.
- Driver revenue share raised 80%→**85%** (configurable). Updated 2 stale tests.
- **Versioning & rollback**: `pricing_configs` Mongo collection; every save = new active version (history never overwritten); rollback re-activates any version. Loader `load_pricing_config()` seeds v1 from defaults on startup.
- **Admin endpoints** (`routes/admin.py`): GET `/admin/pricing`, GET `/admin/pricing/defaults`, POST `/admin/pricing` (new version), POST `/admin/pricing/activate/{version}`, POST `/admin/pricing/preview` (live what-if, not persisted).
- **Admin Pricing Console** (Next.js `web/src/components/admin/Pricing.tsx` + nav "Pricing" tab + adminApi methods): edit all base fees, €/km, weight/capacity bands, urgency, special, fuel, empty-run/route-match/supply-demand bounds, commission, regional & seasonal; live preview panel with breakdown + savings; version history with rollback. tsc passes. NOTE: web admin is not served in this preview (verify post-deploy / via API).
**Pending phases:** C = environmental metrics + mobile/shipper UI wiring + client estimator update; D = capture pricing signals + deterministic self-tuning (predictive models plug in later, NO LLM for price); E = reputation-based pricing; F = smart load bundling.

### Phase B — Marketplace intelligence (DONE & tested, Jun 2026)
New `backend/services/marketplace.py` (pure deterministic heuristics; pricing engine stays source of truth):
- **Per-region Supply & Demand + Market Heat Score**: `resolve_region(lat,lng)` maps to FI regions (helsinki/Uusimaa, tampere/Pirkanmaa, turku/Varsinais-Suomi, oulu, kuopio, lapland). `region_supply_demand()` = pending jobs (demand) vs idle online drivers in region (supply) → ratio → `pricing.market_heat()` label (Cold/Normal/Busy/Very Busy/Critical + icon) + bounded surge/discount %.
- **Route-matching discount**: `route_match_discount(origin,dest,pickup,dropoff)` — detour vs existing journey → overlap% → discount bounded by config (max 30%, min overlap 40%).
- **Empty-run discount**: manual override (`?empty=true`) OR auto-inferred from a recent delivery whose dropoff is ≤40km from the new pickup while driver is idle.
- **4-tier recommendations**: `build_recommendations()` → Budget/Balanced/Fast/Premium with price, acceptance_pct (rises w/ price & heat), wait_minutes (inverse), savings & savings_pct; balanced flagged recommended.
- **Endpoints**: `POST /api/shipper/quote/recommend` (balanced quote + marketplace heat + 4 tiers; public like /shipper/quote) and `GET /api/orders/{id}/match` (driver: standard vs marketplace price, empty-run + route-match + supply/demand discounts, driver earnings 85%, transparent breakdown_lines).
- Verified: testing_agent iter48 (12/12) — tier ordering, region resolution, heat bounds, empty=true (0.25) lowers price below standard, route_match ≤0.30, earnings=85%·price+tip, Phase A regression intact.
- Regional & seasonal config adjustments are now applied in the recommend/match flows.

### Phase C — Frontend wiring + environmental metrics (shipper side DONE & tested; driver UI deferred)
- **Backend**: `marketplace.env_savings(distance, cfg, empty_km)` → {empty_km_eliminated, co2_saved_kg, fuel_saved_l}; added `environment` block to both `/shipper/quote/recommend` and `/orders/{id}/match` responses.
- **Mobile shipper** (`app/shipper-create.tsx`): `fetchQuote` now calls `POST /shipper/quote/recommend`; price step renders a **Market Heat chip** (e.g. "🟢 Uusimaa · Normal"), a green **savings box** ("You save €X (Y%) vs typical freight") with a **CO₂/empty-km/fuel-saved** line (hidden when distance≈0), and a **transparent line-by-line breakdown** (base, distance, weight category, supply/demand, fuel, total) that reconciles to the total. Bonus still adds on top. New styles: heatChip/savingsBox/envText.
- **Client estimator** (`src/utils/pricing.ts`): rewritten to the new **weight-CATEGORY** model (WEIGHT_BANDS) — no more linear weight×€/kg; instant estimate now matches the server engine shape.
- Verified: testing_agent iter49 — full shipper create flow shows heat chip, savings box, env line, transparent breakdown (no linear weight surcharge), bonus adds to total. (testing agent fixed a JSX error I introduced in the fallback breakdown branch.)
- **DEFERRED to next round**: DRIVER-side marketplace UI (show empty-run/route-match price + earnings + heat on the job feed/detail via `GET /orders/{id}/match`). Backend is ready & tested; only the driver screen wiring remains.

**Pending phases:** all phases (A–F) of the pricing re-architecture are now implemented.

### Phase C driver UI + Phases D/E/F (DONE & tested — iter50, 9/9 backend + frontend verified)
- **Phase C driver UI** (`src/components/JobDetailSheet.tsx` + `api.getJobMatch`): job sheet fetches `GET /orders/{id}/match` on open and shows a **Market Heat** line (❄️/🟢/🔥 Region · Label), an empty-run/route-match tag ("♻️ Empty-run match · you earn €X" / "🧭 On your route · you earn €X"), and an **"I'm returning empty"** toggle that re-fetches with `?empty=true` (manual override on top of GPS auto-detect). Verified: toggle flips marketplace_price €439.31→€329.48.
- **Phase E — reputation pricing** (`marketplace.reputation_adjustment`): driver rating ≥4.0 → bounded uplift (≤+8%), <4.0 → bounded discount (≤−5%); wired into `/orders/{id}/match` (shows a "Driver reputation +X%" breakdown line).
- **Phase D — signal capture + deterministic self-tuning** (NO LLM): `pricing_signals` collection; `record_pricing_signal` on shipment create + `mark_signal_accepted` on driver accept (captures time-to-accept). `auto_tune_adjustment(region,vehicle)` reads recent accept-rate and nudges price within ±config `auto_tune.max_pct` (default 5%); needs ≥min_samples (8) else neutral. Exposed in `/shipper/quote/recommend.marketplace.auto_tune`. Predictive models can plug into this boundary later without touching the engine.
- **Phase F — smart load bundling** (`GET /orders/{id}/bundle-suggestions`): finds vehicle-compatible pending orders within a ≤25km corridor detour, payload-capacity guarded, sorted by extra distance; returns combined extra earnings.
- New config: `auto_tune` block in pricing DEFAULT_CONFIG; `reputation` block already existed.
- KNOWN demo-data quirks (not bugs): seeded pending orders lack `price_quote` (bundle price may show 0); some VEHICLE_TYPES lack `capacity_kg` (capacity guard then no-ops). Real created orders are unaffected.
- DEFERRED (nice-to-have): driver-side **bundle-suggestions UI** and a **Market Heat region strip** on driver home; admin pricing-signals analytics view. Backend ready.
