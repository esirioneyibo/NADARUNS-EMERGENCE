"""Iteration 43 — Stripe refunds + webhook hardening (E2E pytest).

Covers the new money-critical surfaces:
  * POST /api/payments/orders/{id}/refund — admin full + partial refund
  * Refund ledger entries (payment_transactions, type='refund', negative gross)
  * Refund guard rails (non-captured, over-amount, double-full-refund)
  * Refund authorization (admin only)
  * Webhook event-id dedupe via processed_webhook_events
  * Webhook handling: charge.refunded, charge.dispute.created, payment_intent.payment_failed
  * Driver earnings: a FULL refund must drop the order from /driver/wallet
"""
import os
import time
import json
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://nadaruns-logistics.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

SHIPPER = {"email": "demo.shipper@nadaruns.com", "password": "demo1234"}
DRIVER = {"email": "demo.driver@nadaruns.com", "password": "demo1234"}
ADMIN = {"email": "admin@nadaruns.com", "password": "admin123"}

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "nadaruns")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module", autouse=True)
def seeded(s):
    r = s.post(f"{API}/seed-demo", timeout=60)
    assert r.status_code in (200, 201), f"seed failed: {r.status_code} {r.text[:200]}"
    return True


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    return client[DB_NAME]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def _login(s, path, payload):
    r = s.post(f"{API}{path}", json=payload, timeout=30)
    assert r.status_code == 200, f"login {path} failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def shipper_token(s):
    return _login(s, "/auth/shipper-login", SHIPPER)


@pytest.fixture(scope="module")
def driver_token(s):
    return _login(s, "/auth/login", DRIVER)


@pytest.fixture(scope="module")
def admin_token(s):
    return _login(s, "/auth/admin-login", ADMIN)


def _make_order(s, shipper_token):
    body = {
        "pickup_address": "Helsinki Port", "pickup_lat": 60.2095, "pickup_lng": 25.1478,
        "pickup_contact_name": "Dock A", "pickup_contact_phone": "+358401112222",
        "dropoff_address": "Nokia HQ", "dropoff_lat": 60.2198, "dropoff_lng": 24.7589,
        "dropoff_contact_name": "Reception", "dropoff_contact_phone": "+358403334444",
        "vehicle_type": "cargo_van", "cargo_weight_kg": 200,
        "cargo_description": f"TEST_Refund_{uuid.uuid4().hex[:6]}",
        "cargo_type": "general", "urgency": "standard",
    }
    r = s.post(f"{API}/shipper/shipments", json=body, headers=_auth(shipper_token), timeout=30)
    assert r.status_code in (200, 201), f"create order failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    assert data.get("order_id"), f"no order_id: {data}"
    return data


def _auth_and_capture(s, shipper_token, admin_token, db, attach_driver=False, driver_id=None):
    """Helper: create -> authorize-test -> (optionally attach driver) -> capture.
    Returns the order_id."""
    order = _make_order(s, shipper_token)
    oid = order["order_id"]
    r = s.post(f"{API}/payments/orders/{oid}/authorize-test", headers=_auth(shipper_token), timeout=60)
    assert r.status_code == 200, f"authorize-test failed: {r.status_code} {r.text[:200]}"
    if attach_driver and driver_id:
        # Attach the demo driver so the wallet earnings test is meaningful.
        db.orders.update_one({"id": oid}, {"$set": {"driver_id": driver_id}})
    r = s.post(f"{API}/payments/orders/{oid}/capture", json={}, headers=_auth(admin_token), timeout=60)
    assert r.status_code == 200, f"capture failed: {r.status_code} {r.text[:200]}"
    assert r.json().get("payment_status") == "captured"
    return oid


# ---------------------------------------------------------------------------
# Auth guards on refund endpoint
# ---------------------------------------------------------------------------

class TestRefundAuth:
    def test_refund_requires_token(self, s):
        r = s.post(f"{API}/payments/orders/nope/refund", json={}, timeout=15)
        assert r.status_code in (401, 403)

    def test_refund_rejects_shipper(self, s, shipper_token):
        r = s.post(f"{API}/payments/orders/nope/refund", json={},
                   headers=_auth(shipper_token), timeout=15)
        assert r.status_code in (401, 403), f"shipper must not refund: {r.status_code} {r.text[:120]}"

    def test_refund_rejects_driver(self, s, driver_token):
        r = s.post(f"{API}/payments/orders/nope/refund", json={},
                   headers=_auth(driver_token), timeout=15)
        assert r.status_code in (401, 403), f"driver must not refund: {r.status_code} {r.text[:120]}"


# ---------------------------------------------------------------------------
# Refund lifecycle — FULL refund
# ---------------------------------------------------------------------------

class TestFullRefund:
    @pytest.fixture(scope="class")
    def captured_order_id(self, s, shipper_token, admin_token, db):
        return _auth_and_capture(s, shipper_token, admin_token, db)

    def test_full_refund_flips_order_to_refunded(self, s, admin_token, captured_order_id, db):
        # Read captured amount first.
        before = db.orders.find_one({"id": captured_order_id}, {"_id": 0, "payment_amount": 1})
        captured_amt = float(before.get("payment_amount") or 0)
        assert captured_amt > 0

        r = s.post(f"{API}/payments/orders/{captured_order_id}/refund",
                   json={"reason": "TEST_full_refund"},
                   headers=_auth(admin_token), timeout=60)
        assert r.status_code == 200, f"refund failed: {r.status_code} {r.text[:200]}"
        data = r.json()
        assert data.get("payment_status") == "refunded", f"status not refunded: {data}"
        # refunded_amount should equal captured (allow 1c tolerance)
        rf = float(data.get("refunded_amount") or 0)
        assert abs(rf - captured_amt) < 0.02, f"refunded_amount {rf} != captured {captured_amt}"

        # DB verification — Create -> GET style.
        after = db.orders.find_one({"id": captured_order_id}, {"_id": 0})
        assert after.get("payment_status") == "refunded"
        assert after.get("refund_reason") == "TEST_full_refund"
        assert after.get("refunded_at"), "refunded_at not set"

    def test_full_refund_creates_negative_ledger_entry(self, s, captured_order_id, db):
        rows = list(db.payment_transactions.find(
            {"order_id": captured_order_id, "type": "refund"}, {"_id": 0}
        ))
        assert len(rows) >= 1, f"no refund ledger row: {rows}"
        row = rows[0]
        assert float(row.get("gross_amount", 0)) < 0, f"refund gross_amount must be negative: {row}"
        assert row.get("stripe_refund_id"), f"missing stripe_refund_id: {row}"
        assert row.get("currency") == "EUR"

    def test_refund_already_fully_refunded_returns_400(self, s, admin_token, captured_order_id):
        """Refunding a non-captured order (already refunded) -> 400."""
        r = s.post(f"{API}/payments/orders/{captured_order_id}/refund", json={},
                   headers=_auth(admin_token), timeout=30)
        assert r.status_code == 400, f"second full refund must 400: {r.status_code} {r.text[:200]}"


# ---------------------------------------------------------------------------
# Refund lifecycle — PARTIAL refund
# ---------------------------------------------------------------------------

class TestPartialRefund:
    @pytest.fixture(scope="class")
    def captured_order_id(self, s, shipper_token, admin_token, db):
        return _auth_and_capture(s, shipper_token, admin_token, db)

    def test_partial_refund_keeps_captured_status(self, s, admin_token, captured_order_id, db):
        before = db.orders.find_one({"id": captured_order_id}, {"_id": 0, "payment_amount": 1})
        captured_amt = float(before.get("payment_amount") or 0)
        assert captured_amt > 0.5
        partial = round(captured_amt * 0.25, 2)  # 25% partial

        r = s.post(f"{API}/payments/orders/{captured_order_id}/refund",
                   json={"amount": partial, "reason": "TEST_partial"},
                   headers=_auth(admin_token), timeout=60)
        assert r.status_code == 200, f"partial refund failed: {r.status_code} {r.text[:200]}"
        data = r.json()
        assert data.get("payment_status") == "captured", f"partial should keep captured: {data}"
        assert abs(float(data.get("refunded_amount") or 0) - partial) < 0.02

        # Ledger row exists & is negative.
        rows = list(db.payment_transactions.find(
            {"order_id": captured_order_id, "type": "refund"}, {"_id": 0}
        ))
        assert len(rows) >= 1
        assert float(rows[-1].get("gross_amount", 0)) < 0

    def test_over_amount_refund_returns_400(self, s, admin_token, captured_order_id, db):
        captured_amt = float(db.orders.find_one(
            {"id": captured_order_id}, {"_id": 0, "payment_amount": 1}
        ).get("payment_amount") or 0)
        # Ask for far more than captured.
        r = s.post(f"{API}/payments/orders/{captured_order_id}/refund",
                   json={"amount": round(captured_amt * 10 + 100, 2)},
                   headers=_auth(admin_token), timeout=30)
        assert r.status_code == 400, f"over-refund must 400: {r.status_code} {r.text[:200]}"


# ---------------------------------------------------------------------------
# Refund guard rail — non-captured order
# ---------------------------------------------------------------------------

class TestRefundOnNonCaptured:
    def test_refund_unpaid_order_returns_400(self, s, shipper_token, admin_token):
        order = _make_order(s, shipper_token)
        oid = order["order_id"]
        # Status is "unpaid" — no authorize, no capture.
        r = s.post(f"{API}/payments/orders/{oid}/refund", json={},
                   headers=_auth(admin_token), timeout=30)
        assert r.status_code == 400, f"refund on unpaid must 400: {r.status_code} {r.text[:200]}"

    def test_refund_authorized_only_order_returns_400(self, s, shipper_token, admin_token):
        order = _make_order(s, shipper_token)
        oid = order["order_id"]
        r = s.post(f"{API}/payments/orders/{oid}/authorize-test",
                   headers=_auth(shipper_token), timeout=60)
        assert r.status_code == 200
        # Authorized but NOT captured.
        r = s.post(f"{API}/payments/orders/{oid}/refund", json={},
                   headers=_auth(admin_token), timeout=30)
        assert r.status_code == 400, f"refund on authorized must 400: {r.status_code} {r.text[:200]}"


# ---------------------------------------------------------------------------
# Idempotency — refund ledger dedupe (single stripe_refund_id row)
# ---------------------------------------------------------------------------

class TestRefundIdempotency:
    def test_refund_ledger_dedup_by_stripe_refund_id(self, s, shipper_token, admin_token, db):
        # Capture an order.
        oid = _auth_and_capture(s, shipper_token, admin_token, db)
        # First partial refund.
        r1 = s.post(f"{API}/payments/orders/{oid}/refund",
                    json={"amount": 1.0},  # tiny partial
                    headers=_auth(admin_token), timeout=30)
        assert r1.status_code == 200, r1.text[:200]
        # Repeat with identical amount: idempotency key reused on Stripe -> same refund id.
        r2 = s.post(f"{API}/payments/orders/{oid}/refund",
                    json={"amount": 1.0},
                    headers=_auth(admin_token), timeout=30)
        # Either Stripe replays the same refund (200) or returns idempotency conflict surfaced as 502.
        # Either way, the ledger MUST not duplicate the row keyed by stripe_refund_id.
        rows = list(db.payment_transactions.find(
            {"order_id": oid, "type": "refund"}, {"_id": 0}
        ))
        refund_ids = [row.get("stripe_refund_id") for row in rows]
        # No duplicate stripe_refund_ids
        assert len(refund_ids) == len(set(refund_ids)), f"duplicate refund rows: {rows}"


# ---------------------------------------------------------------------------
# Driver earnings: a FULL refund must drop the order from /driver/wallet
# ---------------------------------------------------------------------------

class TestDriverWalletAfterRefund:
    def test_full_refund_excludes_from_driver_wallet(self, s, shipper_token, driver_token, admin_token, db):
        # Find demo driver id.
        drv = db.drivers.find_one({"email": DRIVER["email"]}, {"_id": 0, "id": 1})
        assert drv and drv.get("id"), "demo driver not found in DB"
        driver_id = drv["id"]

        # Snapshot wallet before.
        r0 = s.get(f"{API}/driver/wallet", headers=_auth(driver_token), timeout=15)
        assert r0.status_code == 200, r0.text[:200]
        before = r0.json()
        before_total = float(before.get("available_balance", 0)) + float(before.get("pending_balance", 0))

        # Create -> authorize -> attach driver -> capture -> mark order delivered (so wallet includes it).
        oid = _auth_and_capture(s, shipper_token, admin_token, db,
                                attach_driver=True, driver_id=driver_id)
        # Mark delivered so the legacy wallet endpoint sees it.
        db.orders.update_one(
            {"id": oid},
            {"$set": {"status": "delivered", "completed_at": "2026-01-01T00:00:00+00:00"}},
        )

        # Wallet after capture+delivered should include earnings.
        r1 = s.get(f"{API}/driver/wallet", headers=_auth(driver_token), timeout=15)
        assert r1.status_code == 200, r1.text[:200]
        after_cap = r1.json()
        after_cap_total = float(after_cap.get("available_balance", 0)) + float(after_cap.get("pending_balance", 0))
        assert after_cap_total > before_total + 0.01, (
            f"wallet should grow after captured+delivered: before={before_total} after={after_cap_total}"
        )

        # Full refund.
        r = s.post(f"{API}/payments/orders/{oid}/refund", json={},
                   headers=_auth(admin_token), timeout=60)
        assert r.status_code == 200, f"refund failed: {r.status_code} {r.text[:200]}"
        assert r.json().get("payment_status") == "refunded"

        # Wallet after full refund should drop back close to "before".
        r2 = s.get(f"{API}/driver/wallet", headers=_auth(driver_token), timeout=15)
        assert r2.status_code == 200
        after_refund = r2.json()
        after_refund_total = float(after_refund.get("available_balance", 0)) + float(after_refund.get("pending_balance", 0))
        assert after_refund_total <= before_total + 0.05, (
            f"BUG: refunded order still counted in /driver/wallet: "
            f"before={before_total} after_refund={after_refund_total} (after_cap={after_cap_total})"
        )


# ---------------------------------------------------------------------------
# Webhook dedupe + handlers (dev-fallback JSON path)
# ---------------------------------------------------------------------------

class TestWebhookDedupe:
    def test_webhook_dedupe_same_event_id(self, s, db):
        # Clean any previous test rec to make the assert deterministic.
        evt_id = f"evt_test_dedup_{uuid.uuid4().hex[:10]}"
        db.processed_webhook_events.delete_one({"_id": evt_id})

        payload = {
            "id": evt_id,
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": "pi_test_dedup_x"}},
        }
        # First delivery — processed.
        r1 = s.post(f"{API}/payments/webhook", json=payload, timeout=15)
        assert r1.status_code == 200, f"webhook 1 failed: {r1.status_code} {r1.text[:200]}"
        body1 = r1.json()
        assert body1.get("received") is True
        assert not body1.get("duplicate"), f"first delivery flagged duplicate: {body1}"

        # Second identical delivery — must dedupe.
        r2 = s.post(f"{API}/payments/webhook", json=payload, timeout=15)
        assert r2.status_code == 200, f"webhook 2 failed: {r2.status_code} {r2.text[:200]}"
        body2 = r2.json()
        assert body2.get("duplicate") is True, f"second delivery not deduped: {body2}"

        # processed_webhook_events row exists.
        rec = db.processed_webhook_events.find_one({"_id": evt_id})
        assert rec is not None, "event id not persisted to dedupe collection"


class TestWebhookHandlers:
    def test_payment_failed_sets_payment_failed_status(self, s, shipper_token, db):
        # Make an order with a known pi id, then fire the event.
        order = _make_order(s, shipper_token)
        oid = order["order_id"]
        pi_id = f"pi_test_fail_{uuid.uuid4().hex[:10]}"
        db.orders.update_one({"id": oid}, {"$set": {"stripe_payment_intent_id": pi_id}})

        evt_id = f"evt_test_fail_{uuid.uuid4().hex[:10]}"
        payload = {
            "id": evt_id,
            "type": "payment_intent.payment_failed",
            "data": {"object": {"id": pi_id, "metadata": {"order_id": oid}}},
        }
        r = s.post(f"{API}/payments/webhook", json=payload, timeout=15)
        assert r.status_code == 200, r.text[:200]
        after = db.orders.find_one({"id": oid}, {"_id": 0})
        assert after.get("payment_status") == "payment_failed", f"status not updated: {after}"

    def test_dispute_created_sets_has_dispute(self, s, shipper_token, db):
        order = _make_order(s, shipper_token)
        oid = order["order_id"]
        pi_id = f"pi_test_dispute_{uuid.uuid4().hex[:10]}"
        db.orders.update_one({"id": oid}, {"$set": {"stripe_payment_intent_id": pi_id}})

        evt_id = f"evt_test_dispute_{uuid.uuid4().hex[:10]}"
        payload = {
            "id": evt_id,
            "type": "charge.dispute.created",
            "data": {"object": {"id": "ch_x", "payment_intent": pi_id}},
        }
        r = s.post(f"{API}/payments/webhook", json=payload, timeout=15)
        assert r.status_code == 200, r.text[:200]
        after = db.orders.find_one({"id": oid}, {"_id": 0})
        assert after.get("has_dispute") is True, f"has_dispute not set: {after}"
        assert after.get("dispute_at"), "dispute_at not stamped"

    def test_charge_refunded_applies_refund(self, s, shipper_token, admin_token, db):
        # Capture an order properly so it has a real pi_id we can target.
        oid = _auth_and_capture(s, shipper_token, admin_token, db)
        pi_id = db.orders.find_one({"id": oid}, {"_id": 0, "stripe_payment_intent_id": 1})["stripe_payment_intent_id"]
        captured = float(db.orders.find_one({"id": oid}, {"_id": 0, "payment_amount": 1})["payment_amount"])
        amount_cents = int(round(captured * 100))

        evt_id = f"evt_test_chrgrf_{uuid.uuid4().hex[:10]}"
        refund_id = f"re_test_{uuid.uuid4().hex[:10]}"
        payload = {
            "id": evt_id,
            "type": "charge.refunded",
            "data": {"object": {
                "id": "ch_test_x",
                "payment_intent": pi_id,
                "amount_refunded": amount_cents,
                "refunds": {"data": [{"id": refund_id, "amount": amount_cents}]},
            }},
        }
        r = s.post(f"{API}/payments/webhook", json=payload, timeout=20)
        assert r.status_code == 200, r.text[:200]

        after = db.orders.find_one({"id": oid}, {"_id": 0})
        assert after.get("payment_status") == "refunded", f"order not refunded by webhook: {after}"
        ledger = list(db.payment_transactions.find(
            {"order_id": oid, "type": "refund", "stripe_refund_id": refund_id}, {"_id": 0}
        ))
        assert len(ledger) == 1, f"webhook-driven refund row missing/duplicate: {ledger}"


# ---------------------------------------------------------------------------
# Regression: existing payment flow still works
# ---------------------------------------------------------------------------

class TestRegression:
    def test_payments_config(self, s):
        r = s.get(f"{API}/payments/config", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("configured") is True
        assert data.get("test_mode") is True
        assert data.get("currency") == "EUR"

    def test_checkout_then_status(self, s, shipper_token):
        order = _make_order(s, shipper_token)
        oid = order["order_id"]
        r = s.post(f"{API}/payments/orders/{oid}/checkout", json={},
                   headers=_auth(shipper_token), timeout=30)
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        assert data.get("session_id", "").startswith("cs_")
        assert "stripe.com" in (data.get("url") or "")

        r2 = s.get(f"{API}/payments/orders/{oid}/status",
                   headers=_auth(shipper_token), timeout=15)
        assert r2.status_code == 200
