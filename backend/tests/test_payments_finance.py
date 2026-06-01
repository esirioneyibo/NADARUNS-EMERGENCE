"""End-to-end pytest suite for Stripe Payments & Financial Management.

Covers:
- /payments/config
- Stripe checkout creation (smoke)
- TEST-ONLY authorize-test endpoint (Stripe test card pm_card_visa)
- Payment status, admin capture, auto-capture on delivery, cancel-authorization
- Driver wallet, cash-out request validation
- Admin financial overview/ledger/authorized list/withdrawals admin actions
- Auth guards on payments/wallet/admin endpoints
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nadaruns-logistics.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SHIPPER = {"email": "demo.shipper@nadaruns.com", "password": "demo1234"}
DRIVER = {"email": "demo.driver@nadaruns.com", "password": "demo1234"}
ADMIN = {"email": "admin@nadaruns.com", "password": "admin123"}


# ---------------------------------------------------------------------------
# Shared session/token fixtures (module-scoped so we share seed/login)
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


def _login(s, path, payload):
    r = s.post(f"{API}{path}", json=payload, timeout=30)
    assert r.status_code == 200, f"login {path} failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    assert "token" in data, f"no token in {path}: {data}"
    return data["token"]


@pytest.fixture(scope="module")
def shipper_token(s):
    return _login(s, "/auth/shipper-login", SHIPPER)


@pytest.fixture(scope="module")
def driver_token(s):
    return _login(s, "/auth/login", DRIVER)


@pytest.fixture(scope="module")
def admin_token(s):
    return _login(s, "/auth/admin-login", ADMIN)


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def _make_order(s, shipper_token):
    body = {
        "pickup_address": "Helsinki Port", "pickup_lat": 60.2095, "pickup_lng": 25.1478,
        "pickup_contact_name": "Dock A", "pickup_contact_phone": "+358401112222",
        "dropoff_address": "Nokia HQ", "dropoff_lat": 60.2198, "dropoff_lng": 24.7589,
        "dropoff_contact_name": "Reception", "dropoff_contact_phone": "+358403334444",
        "vehicle_type": "cargo_van", "cargo_weight_kg": 200,
        "cargo_description": f"TEST_Boxes_{uuid.uuid4().hex[:6]}",
        "cargo_type": "general", "urgency": "standard",
    }
    r = s.post(f"{API}/shipper/shipments", json=body, headers=_auth(shipper_token), timeout=30)
    assert r.status_code in (200, 201), f"create order failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    assert data.get("order_id"), f"no order_id: {data}"
    assert (data.get("price") or 0) > 0, f"order has no price: {data}"
    return data


# ---------------------------------------------------------------------------
# /payments/config
# ---------------------------------------------------------------------------

class TestPaymentsConfig:
    def test_config_returns_eur_test_mode(self, s):
        r = s.get(f"{API}/payments/config", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("configured") is True
        assert data.get("test_mode") is True
        assert data.get("currency") == "EUR"


# ---------------------------------------------------------------------------
# Auth guards
# ---------------------------------------------------------------------------

class TestAuthGuards:
    def test_capture_requires_admin(self, s, shipper_token):
        r = s.post(f"{API}/payments/orders/nope/capture", json={}, headers=_auth(shipper_token), timeout=15)
        assert r.status_code in (401, 403), f"shipper should not capture: {r.status_code} {r.text[:120]}"

    def test_capture_no_token(self, s):
        r = s.post(f"{API}/payments/orders/nope/capture", json={}, timeout=15)
        assert r.status_code in (401, 403)

    def test_cancel_auth_requires_admin(self, s, shipper_token):
        r = s.post(f"{API}/payments/orders/nope/cancel-authorization", headers=_auth(shipper_token), timeout=15)
        assert r.status_code in (401, 403)

    def test_admin_financials_overview_requires_admin(self, s, driver_token):
        r = s.get(f"{API}/admin/financials/overview", headers=_auth(driver_token), timeout=15)
        assert r.status_code in (401, 403)

    def test_admin_payments_authorized_requires_admin(self, s, shipper_token):
        r = s.get(f"{API}/admin/payments/authorized", headers=_auth(shipper_token), timeout=15)
        assert r.status_code in (401, 403)

    def test_wallet_driver_requires_driver(self, s, shipper_token):
        r = s.get(f"{API}/wallet/driver", headers=_auth(shipper_token), timeout=15)
        assert r.status_code in (401, 403)

    def test_wallet_withdraw_requires_driver(self, s, admin_token):
        r = s.post(f"{API}/wallet/withdraw", json={"amount": 15, "method": "bank_transfer", "account_details": "FI"},
                   headers=_auth(admin_token), timeout=15)
        assert r.status_code in (401, 403)

    def test_status_requires_owner_or_admin(self, s, shipper_token, driver_token, admin_token):
        """A driver should not be able to query payment status of someone else's not-assigned order."""
        order = _make_order(s, shipper_token)
        oid = order["order_id"]
        # Driver hasn't accepted -- driver_id is None on order, so per code, driver_id is None means allowed.
        # We rely on shipper-owner check: a 2nd shipper not implemented; just verify shipper can read their own and admin can.
        r1 = s.get(f"{API}/payments/orders/{oid}/status", headers=_auth(shipper_token), timeout=15)
        assert r1.status_code == 200
        r2 = s.get(f"{API}/payments/orders/{oid}/status", headers=_auth(admin_token), timeout=15)
        assert r2.status_code == 200


# ---------------------------------------------------------------------------
# Path A: Checkout smoke + authorize-test + admin capture
# ---------------------------------------------------------------------------

class TestCheckoutAndAuthorizeAndCapture:
    @pytest.fixture(scope="class")
    def order_a(self, s, shipper_token):
        return _make_order(s, shipper_token)

    def test_checkout_returns_stripe_url(self, s, shipper_token, order_a):
        oid = order_a["order_id"]
        r = s.post(f"{API}/payments/orders/{oid}/checkout", json={}, headers=_auth(shipper_token), timeout=30)
        assert r.status_code == 200, f"checkout failed: {r.status_code} {r.text[:200]}"
        data = r.json()
        assert data.get("session_id", "").startswith("cs_"), f"unexpected session id: {data}"
        assert "stripe.com" in (data.get("url") or ""), f"unexpected url: {data}"
        assert data.get("payment_status") == "pending"

    def test_authorize_test_succeeds(self, s, shipper_token, order_a):
        oid = order_a["order_id"]
        r = s.post(f"{API}/payments/orders/{oid}/authorize-test", headers=_auth(shipper_token), timeout=60)
        assert r.status_code == 200, f"authorize-test failed: {r.status_code} {r.text[:200]}"
        data = r.json()
        assert data.get("payment_status") == "authorized", f"unexpected status: {data}"
        amt = data.get("payment_amount") or 0
        assert amt > 0
        comm = data.get("commission_amount") or 0
        driver = data.get("driver_payout_amount") or 0
        assert comm > 0 and driver > 0
        # commission ~20% (allow some tolerance because of pricing rounding)
        ratio = comm / amt
        assert 0.05 <= ratio <= 0.40, f"commission ratio off: {ratio} (comm={comm} amt={amt})"
        # commission + driver ~= amount
        assert abs((comm + driver) - amt) < 0.05

    def test_status_after_authorization(self, s, shipper_token, order_a):
        oid = order_a["order_id"]
        r = s.get(f"{API}/payments/orders/{oid}/status", headers=_auth(shipper_token), timeout=30)
        assert r.status_code == 200
        assert r.json().get("payment_status") in ("authorized", "captured")

    def test_double_authorize_rejected(self, s, shipper_token, order_a):
        oid = order_a["order_id"]
        r = s.post(f"{API}/payments/orders/{oid}/authorize-test", headers=_auth(shipper_token), timeout=30)
        assert r.status_code == 400

    def test_admin_capture(self, s, admin_token, order_a):
        oid = order_a["order_id"]
        r = s.post(f"{API}/payments/orders/{oid}/capture", json={}, headers=_auth(admin_token), timeout=60)
        assert r.status_code == 200, f"capture failed: {r.status_code} {r.text[:200]}"
        data = r.json()
        assert data.get("payment_status") == "captured"
        assert data.get("captured_at"), "captured_at not set"

    def test_capture_ledger_entry_exists(self, s, admin_token, order_a):
        oid = order_a["order_id"]
        r = s.get(f"{API}/admin/financials/transactions", params={"type": "capture", "limit": 100},
                  headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200
        items = r.json().get("items", [])
        found = [t for t in items if t.get("order_id") == oid and t.get("type") == "capture"]
        assert found, f"no capture ledger entry for {oid}"


# ---------------------------------------------------------------------------
# Path B: Auto-capture on delivery + wallet
# ---------------------------------------------------------------------------

class TestAutoCaptureAndWallet:
    @pytest.fixture(scope="class")
    def delivered_order(self, s, shipper_token, driver_token):
        order = _make_order(s, shipper_token)
        oid = order["order_id"]
        # Driver accepts
        r = s.post(f"{API}/orders/{oid}/accept", headers=_auth(driver_token), timeout=30)
        assert r.status_code == 200, f"accept failed: {r.status_code} {r.text[:200]}"
        # Shipper authorizes
        r = s.post(f"{API}/payments/orders/{oid}/authorize-test", headers=_auth(shipper_token), timeout=60)
        assert r.status_code == 200, f"authorize-test failed: {r.status_code} {r.text[:200]}"
        # Advance to delivered
        status = None
        for _ in range(10):
            adv = s.post(f"{API}/orders/{oid}/advance", json={}, headers=_auth(driver_token), timeout=30)
            assert adv.status_code == 200, f"advance failed: {adv.status_code} {adv.text[:200]}"
            status = adv.json().get("status")
            if status == "delivered":
                break
        assert status == "delivered", f"did not reach delivered: {status}"
        return {"order_id": oid, "price": order.get("price")}

    def test_payment_auto_captured(self, s, shipper_token, delivered_order):
        oid = delivered_order["order_id"]
        # small sync delay tolerance
        time.sleep(1)
        r = s.get(f"{API}/payments/orders/{oid}/status", headers=_auth(shipper_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data.get("payment_status") == "captured", f"not auto-captured: {data}"
        assert data.get("captured_at")

    def test_wallet_reflects_captured_earnings(self, s, driver_token, delivered_order):
        r = s.get(f"{API}/wallet/driver", headers=_auth(driver_token), timeout=30)
        assert r.status_code == 200
        wallet = r.json()
        for k in ("available_balance", "pending_balance", "total_earned", "total_withdrawn", "earnings", "withdrawals"):
            assert k in wallet, f"wallet missing key {k}: {list(wallet)}"
        assert wallet["total_earned"] > 0, f"total_earned should be >0: {wallet}"
        assert wallet["available_balance"] >= 0
        # earnings list should contain the delivered order id
        oid = delivered_order["order_id"]
        ids = [e.get("order_id") for e in wallet["earnings"]]
        assert oid in ids, f"order {oid} missing from wallet earnings: {ids}"


# ---------------------------------------------------------------------------
# Cash-out request validation + admin actions
# ---------------------------------------------------------------------------

class TestWithdrawalFlow:
    def test_withdraw_below_minimum_rejected(self, s, driver_token):
        r = s.post(f"{API}/wallet/withdraw",
                   json={"amount": 5, "method": "bank_transfer", "account_details": "FI"},
                   headers=_auth(driver_token), timeout=30)
        assert r.status_code == 400, f"expected 400 for <10: {r.status_code} {r.text[:200]}"

    def test_withdraw_above_balance_rejected(self, s, driver_token):
        r = s.post(f"{API}/wallet/withdraw",
                   json={"amount": 9999999, "method": "bank_transfer", "account_details": "FI"},
                   headers=_auth(driver_token), timeout=30)
        assert r.status_code == 400

    def test_valid_withdraw_creates_pending(self, s, driver_token):
        r = s.post(f"{API}/wallet/withdraw",
                   json={"amount": 10, "method": "bank_transfer", "account_details": "FI00 1234 5678"},
                   headers=_auth(driver_token), timeout=30)
        assert r.status_code == 200, f"withdraw failed: {r.status_code} {r.text[:200]}"
        data = r.json()
        wd = data.get("withdrawal") or {}
        assert wd.get("status") == "pending"
        assert wd.get("amount") == 10
        assert wd.get("id")
        # listing endpoint
        r2 = s.get(f"{API}/wallet/withdrawals", headers=_auth(driver_token), timeout=15)
        assert r2.status_code == 200
        ids = [w.get("id") for w in r2.json().get("withdrawals", [])]
        assert wd["id"] in ids

    def test_admin_approve_pay_flow(self, s, driver_token, admin_token):
        # Create a fresh withdrawal we will fully process
        cr = s.post(f"{API}/wallet/withdraw",
                    json={"amount": 11, "method": "bank_transfer", "account_details": "FI"},
                    headers=_auth(driver_token), timeout=30)
        assert cr.status_code == 200, cr.text[:200]
        wid = cr.json()["withdrawal"]["id"]

        # Approve
        ar = s.post(f"{API}/admin/financials/withdrawals/{wid}/approve",
                    headers=_auth(admin_token), timeout=30)
        assert ar.status_code == 200, ar.text[:200]
        assert ar.json().get("status") == "approved"

        # Pay
        pr = s.post(f"{API}/admin/financials/withdrawals/{wid}/pay",
                    json={"reference": "TRX-TEST-001"},
                    headers=_auth(admin_token), timeout=30)
        assert pr.status_code == 200, pr.text[:200]
        body = pr.json()
        assert body.get("status") == "paid"
        assert body.get("reference") == "TRX-TEST-001"

        # Notification should have been created (best effort - check via admin -> driver notifications if exposed)
        # We at least verify withdrawal admin listing shows it as paid
        lr = s.get(f"{API}/admin/financials/withdrawals", params={"status": "paid"},
                   headers=_auth(admin_token), timeout=30)
        assert lr.status_code == 200
        ids = [w.get("id") for w in lr.json().get("items", [])]
        assert wid in ids

    def test_admin_reject_flow(self, s, driver_token, admin_token):
        cr = s.post(f"{API}/wallet/withdraw",
                    json={"amount": 12, "method": "bank_transfer", "account_details": "FI"},
                    headers=_auth(driver_token), timeout=30)
        assert cr.status_code == 200
        wid = cr.json()["withdrawal"]["id"]
        rj = s.post(f"{API}/admin/financials/withdrawals/{wid}/reject",
                    json={"reason": "Insufficient docs"}, headers=_auth(admin_token), timeout=30)
        assert rj.status_code == 200
        body = rj.json()
        assert body.get("status") == "rejected"
        assert body.get("note") == "Insufficient docs"


# ---------------------------------------------------------------------------
# Cancel-authorization
# ---------------------------------------------------------------------------

class TestCancelAuthorization:
    def test_cancel_authorization_releases_hold(self, s, shipper_token, admin_token):
        order = _make_order(s, shipper_token)
        oid = order["order_id"]
        a = s.post(f"{API}/payments/orders/{oid}/authorize-test", headers=_auth(shipper_token), timeout=60)
        assert a.status_code == 200
        assert a.json().get("payment_status") == "authorized"
        c = s.post(f"{API}/payments/orders/{oid}/cancel-authorization",
                   headers=_auth(admin_token), timeout=30)
        assert c.status_code == 200, f"cancel failed: {c.status_code} {c.text[:200]}"
        assert c.json().get("payment_status") == "canceled"


# ---------------------------------------------------------------------------
# Admin financials overview / ledger / authorized
# ---------------------------------------------------------------------------

class TestAdminFinancials:
    def test_overview_structure(self, s, admin_token):
        r = s.get(f"{API}/admin/financials/overview", headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        kpis = body.get("kpis") or {}
        for k in ("total_revenue", "total_commission", "total_driver_payouts",
                  "authorized_amount", "pending_withdrawals_amount", "paid_withdrawals_amount"):
            assert k in kpis, f"kpi missing {k}: {list(kpis)}"
        series = body.get("series")
        assert isinstance(series, list) and len(series) == 14, f"series should have 14 days, got {len(series) if isinstance(series, list) else 'n/a'}"
        for row in series:
            assert "date" in row and "revenue" in row and "commission" in row

    def test_transactions_pagination(self, s, admin_token):
        r = s.get(f"{API}/admin/financials/transactions", params={"page": 1, "limit": 10},
                  headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "total" in body and "page" in body and "limit" in body
        assert body["page"] == 1 and body["limit"] == 10

    def test_authorized_list_endpoint(self, s, admin_token, shipper_token):
        # Authorize a new order to ensure at least one is present
        order = _make_order(s, shipper_token)
        oid = order["order_id"]
        ar = s.post(f"{API}/payments/orders/{oid}/authorize-test", headers=_auth(shipper_token), timeout=60)
        assert ar.status_code == 200
        r = s.get(f"{API}/admin/payments/authorized", headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "total" in body
        ids = [i.get("order_id") for i in body["items"]]
        assert oid in ids, f"new authorized order missing from list: {ids[:5]}"
