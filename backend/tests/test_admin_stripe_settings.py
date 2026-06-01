"""Tests for the NEW Admin Stripe-settings surface + a light regression.

New surface under test:
- GET  /api/admin/settings/stripe  (admin token; masked status)
- POST /api/admin/settings/stripe  (validation + persistence)

Regression (light) to confirm the dynamic-key refactor didn't break payments:
- GET  /api/payments/config
- POST /api/payments/orders/{id}/authorize-test  (commission ~20%)
- POST /api/payments/orders/{id}/capture
- GET  /api/wallet/driver
- POST /api/wallet/withdraw   (min/exceed/valid)
- GET  /api/admin/financials/overview
"""

import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://nadaruns-logistics.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

SHIPPER = {"email": "demo.shipper@nadaruns.com", "password": "demo1234"}
DRIVER = {"email": "demo.driver@nadaruns.com", "password": "demo1234"}
ADMIN = {"email": "admin@nadaruns.com", "password": "admin123"}


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


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------------------------------------------------------------------
# Admin Stripe settings — NEW SURFACE
# ---------------------------------------------------------------------------

class TestAdminStripeSettingsAuth:
    """Auth guards on /admin/settings/stripe."""

    def test_get_requires_auth(self, s):
        r = s.get(f"{API}/admin/settings/stripe", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 unauth GET: {r.status_code} {r.text[:120]}"

    def test_get_rejects_non_admin(self, s, shipper_token):
        r = s.get(f"{API}/admin/settings/stripe", headers=_auth(shipper_token), timeout=15)
        assert r.status_code in (401, 403)

    def test_post_requires_auth(self, s):
        r = s.post(f"{API}/admin/settings/stripe", json={"mode": "test"}, timeout=15)
        assert r.status_code in (401, 403)


class TestAdminStripeSettingsGet:
    """GET returns masked status only — no full keys are exposed."""

    def test_get_returns_masked_status(self, s, admin_token):
        r = s.get(f"{API}/admin/settings/stripe", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        body = r.json()
        for key in (
            "configured", "mode", "test_configured", "live_configured",
            "test_key_masked", "active_key_masked", "webhook_configured",
        ):
            assert key in body, f"missing field {key} in {list(body)}"
        assert body["mode"] in ("test", "live")
        assert body["configured"] is True
        assert body["test_configured"] is True

    def test_keys_are_masked_not_full(self, s, admin_token):
        r = s.get(f"{API}/admin/settings/stripe", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200
        body = r.json()
        masked = body.get("test_key_masked") or ""
        active = body.get("active_key_masked") or ""
        # Masked format from services.payments._mask is "sk_test_XXX…YYYY" with an ellipsis.
        assert "…" in masked or masked == "set", f"test key not masked: {masked!r}"
        if active:
            assert "…" in active or active == "set", f"active key not masked: {active!r}"
        # Defensive: ensure the masked string is short (much shorter than a real sk_test_…)
        assert len(masked) <= 30, f"masked key looks like a full key (len={len(masked)}): {masked!r}"


class TestAdminStripeSettingsValidation:
    """POST validation: bad keys, wrong-prefix keys, mode switch without live key, etc."""

    def test_switch_to_live_without_live_key_rejected(self, s, admin_token):
        # Sanity: ensure live is not configured first
        cur = s.get(f"{API}/admin/settings/stripe", headers=_auth(admin_token), timeout=15).json()
        if cur.get("live_configured"):
            pytest.skip("live key is configured in this environment; mode-switch guard cannot be tested")
        r = s.post(f"{API}/admin/settings/stripe", json={"mode": "live"},
                   headers=_auth(admin_token), timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"

    def test_bad_test_secret_key_rejected(self, s, admin_token):
        r = s.post(f"{API}/admin/settings/stripe",
                   json={"test_secret_key": "sk_test_bad_definitely_not_a_real_key_123"},
                   headers=_auth(admin_token), timeout=30)
        assert r.status_code == 400, f"expected 400 for bad sk_test_, got {r.status_code}: {r.text[:200]}"
        assert "test key" in r.text.lower() or "stripe" in r.text.lower()

    def test_wrong_prefix_for_live_key_rejected(self, s, admin_token):
        # Sending a "pk_test_" string as the LIVE secret key must be rejected by prefix guard.
        r = s.post(f"{API}/admin/settings/stripe",
                   json={"live_secret_key": "pk_test_x"},
                   headers=_auth(admin_token), timeout=15)
        assert r.status_code == 400, f"expected 400 for wrong-prefix live key: {r.status_code} {r.text[:200]}"
        assert "sk_live_" in r.text or "live secret" in r.text.lower()

    def test_invalid_mode_value_rejected(self, s, admin_token):
        r = s.post(f"{API}/admin/settings/stripe",
                   json={"mode": "garbage"},
                   headers=_auth(admin_token), timeout=15)
        assert r.status_code == 400


class TestAdminStripeSettingsWebhookPersistence:
    """POST {webhook_secret} -> 200, persists, and is RESET to empty at teardown."""

    @pytest.fixture(scope="class")
    def reset_webhook(self, s, admin_token):
        # snapshot current webhook_configured so we restore to empty (per request)
        yield
        # Always reset to empty regardless of test outcome
        try:
            s.post(f"{API}/admin/settings/stripe",
                   json={"webhook_secret": ""},
                   headers=_auth(admin_token), timeout=15)
        except Exception:
            pass

    def test_set_webhook_secret_persists(self, s, admin_token, reset_webhook):
        r = s.post(f"{API}/admin/settings/stripe",
                   json={"webhook_secret": "whsec_test123"},
                   headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        body = r.json()
        assert body.get("webhook_configured") is True

        # GET should also report it as configured
        g = s.get(f"{API}/admin/settings/stripe", headers=_auth(admin_token), timeout=15)
        assert g.status_code == 200
        assert g.json().get("webhook_configured") is True


# ---------------------------------------------------------------------------
# Light payment regression after dynamic-key refactor
# ---------------------------------------------------------------------------

def _make_order(s, shipper_token):
    body = {
        "pickup_address": "Helsinki Port", "pickup_lat": 60.2095, "pickup_lng": 25.1478,
        "pickup_contact_name": "Dock A", "pickup_contact_phone": "+358401112222",
        "dropoff_address": "Nokia HQ", "dropoff_lat": 60.2198, "dropoff_lng": 24.7589,
        "dropoff_contact_name": "Reception", "dropoff_contact_phone": "+358403334444",
        "vehicle_type": "cargo_van", "cargo_weight_kg": 200,
        "cargo_description": f"TEST_StripeSettings_{uuid.uuid4().hex[:6]}",
        "cargo_type": "general", "urgency": "standard",
    }
    r = s.post(f"{API}/shipper/shipments", json=body, headers=_auth(shipper_token), timeout=30)
    assert r.status_code in (200, 201), f"create order failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    assert data.get("order_id") and (data.get("price") or 0) > 0
    return data


class TestPaymentsConfigRegression:
    def test_payments_config(self, s):
        r = s.get(f"{API}/payments/config", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("configured") is True
        assert d.get("test_mode") is True


class TestAuthorizeAndCaptureRegression:
    def test_authorize_then_admin_capture(self, s, shipper_token, admin_token):
        order = _make_order(s, shipper_token)
        oid = order["order_id"]
        ar = s.post(f"{API}/payments/orders/{oid}/authorize-test",
                    headers=_auth(shipper_token), timeout=60)
        assert ar.status_code == 200, f"authorize-test failed: {ar.status_code} {ar.text[:200]}"
        ad = ar.json()
        assert ad.get("payment_status") == "authorized"
        amt = ad.get("payment_amount") or 0
        comm = ad.get("commission_amount") or 0
        drv = ad.get("driver_payout_amount") or 0
        assert amt > 0 and comm > 0 and drv > 0
        assert abs((comm + drv) - amt) < 0.05
        ratio = comm / amt
        assert 0.05 <= ratio <= 0.40, f"commission ratio off: {ratio}"

        cp = s.post(f"{API}/payments/orders/{oid}/capture", json={},
                    headers=_auth(admin_token), timeout=60)
        assert cp.status_code == 200, f"capture failed: {cp.status_code} {cp.text[:200]}"
        assert cp.json().get("payment_status") == "captured"


class TestWalletRegression:
    def test_wallet_driver_shape(self, s, driver_token):
        r = s.get(f"{API}/wallet/driver", headers=_auth(driver_token), timeout=30)
        assert r.status_code == 200
        w = r.json()
        for k in ("available_balance", "pending_balance", "total_earned",
                  "total_withdrawn", "earnings", "withdrawals"):
            assert k in w, f"missing key {k} in wallet"

    def test_withdraw_below_min(self, s, driver_token):
        r = s.post(f"{API}/wallet/withdraw",
                   json={"amount": 5, "method": "bank_transfer", "account_details": "FI"},
                   headers=_auth(driver_token), timeout=30)
        assert r.status_code == 400

    def test_withdraw_above_balance(self, s, driver_token):
        r = s.post(f"{API}/wallet/withdraw",
                   json={"amount": 9_999_999, "method": "bank_transfer", "account_details": "FI"},
                   headers=_auth(driver_token), timeout=30)
        assert r.status_code == 400

    def test_withdraw_valid(self, s, driver_token):
        # only attempt a valid request if balance allows
        wr = s.get(f"{API}/wallet/driver", headers=_auth(driver_token), timeout=30)
        bal = (wr.json() or {}).get("available_balance", 0)
        if bal < 10:
            pytest.skip(f"available_balance={bal} < 10; cannot test valid withdrawal")
        r = s.post(f"{API}/wallet/withdraw",
                   json={"amount": 10, "method": "bank_transfer", "account_details": "FI00 1234"},
                   headers=_auth(driver_token), timeout=30)
        assert r.status_code == 200
        wd = r.json().get("withdrawal") or {}
        assert wd.get("status") == "pending"
        assert wd.get("amount") == 10


class TestAdminFinancialsRegression:
    def test_overview_kpis_shape(self, s, admin_token):
        r = s.get(f"{API}/admin/financials/overview", headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        kpis = body.get("kpis") or {}
        for k in ("total_revenue", "total_commission", "total_driver_payouts",
                  "authorized_amount", "pending_withdrawals_amount", "paid_withdrawals_amount"):
            assert k in kpis, f"kpi missing {k}"
