"""
Iteration 51 - Security fixes regression tests
SEC-001: JWT secret rotation regression - all logins still work
SEC-002: POST /api/orders/{id}/advance requires authenticated assigned driver
         POST /api/orders/{id}/reject requires authenticated driver
SEC-003: POST /api/payments/webhook rejects unsigned/forged events (400)
Full regression: assigned driver can accept -> advance -> delivered.
Admin-only endpoints still require admin token.
"""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or os.environ.get("EXPO_BACKEND_URL")
            or "https://nadaruns-logistics.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DRIVER_EMAIL = "demo.driver@nadaruns.com"
DRIVER_PASSWORD = "demo1234"
SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
SHIPPER_PASSWORD = "demo1234"
ADMIN_EMAIL = "admin@nadaruns.com"
ADMIN_PASSWORD = "admin123"


# ---------- Shared fixtures ----------
@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def seed_demo(http):
    # Idempotent: ensure demo accounts exist before logins
    try:
        http.post(f"{API}/seed-demo", timeout=30)
    except Exception:
        pass
    return True


@pytest.fixture(scope="session")
def driver_token(http, seed_demo):
    r = http.post(f"{API}/auth/login",
                  json={"email": DRIVER_EMAIL, "password": DRIVER_PASSWORD},
                  timeout=15)
    assert r.status_code == 200, f"driver login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"no token in driver login response: {data}"
    return token


@pytest.fixture(scope="session")
def shipper_token(http, seed_demo):
    r = http.post(f"{API}/auth/shipper-login",
                  json={"email": SHIPPER_EMAIL, "password": SHIPPER_PASSWORD},
                  timeout=15)
    assert r.status_code == 200, f"shipper login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"no token in shipper login response: {data}"
    return token


@pytest.fixture(scope="session")
def admin_token(http, seed_demo):
    r = http.post(f"{API}/auth/admin-login",
                  json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                  timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"no token in admin login response: {data}"
    return token


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ============================================================
# SEC-001 regression: logins still work after JWT secret rotation
# ============================================================
class TestSec001LoginsAndProtected:
    def test_driver_login_works(self, driver_token):
        assert isinstance(driver_token, str) and len(driver_token) > 20

    def test_shipper_login_works(self, shipper_token):
        assert isinstance(shipper_token, str) and len(shipper_token) > 20

    def test_admin_login_works(self, admin_token):
        assert isinstance(admin_token, str) and len(admin_token) > 20

    def test_driver_token_accepted_on_protected_route(self, http, driver_token):
        r = http.get(f"{API}/driver/me", headers=_h(driver_token), timeout=15)
        assert r.status_code == 200, f"/driver/me failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("email") == DRIVER_EMAIL or body.get("id"), body

    def test_shipper_token_accepted_on_protected_route(self, http, shipper_token):
        r = http.get(f"{API}/shipper/me", headers=_h(shipper_token), timeout=15)
        assert r.status_code == 200, f"/shipper/me failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("email") == SHIPPER_EMAIL or body.get("id"), body

    def test_protected_route_rejects_no_token(self, http):
        r = http.get(f"{API}/driver/me", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"

    def test_protected_route_rejects_garbage_token(self, http):
        r = http.get(f"{API}/driver/me",
                     headers={"Authorization": "Bearer garbage.token.value"},
                     timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"


# ============================================================
# SEC-003: webhook rejects forged/unsigned events with 400
# ============================================================
class TestSec003WebhookSignature:
    def test_webhook_no_signature_rejected(self, http):
        body = {
            "id": "evt_forged_1",
            "type": "charge.refunded",
            "data": {"object": {"id": "ch_test", "payment_intent": "pi_test", "amount_refunded": 100}},
        }
        r = http.post(f"{API}/payments/webhook", json=body, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_webhook_bad_signature_rejected(self, http):
        body = {
            "id": "evt_forged_2",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": "pi_test_bad"}},
        }
        r = http.post(f"{API}/payments/webhook",
                      json=body,
                      headers={"stripe-signature": "t=1,v1=deadbeef"},
                      timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_webhook_does_not_mutate_orders(self, http, shipper_token):
        # Pick any existing order and snapshot its payment_status; after a
        # forged webhook call referencing it, the status must be unchanged.
        # Fall back gracefully if no shipper orders exist.
        list_resp = http.get(f"{API}/shipper/orders", headers=_h(shipper_token), timeout=15)
        if list_resp.status_code != 200:
            pytest.skip(f"shipper orders list unavailable: {list_resp.status_code}")
        orders = list_resp.json() or []
        if not orders:
            pytest.skip("no shipper orders to verify against")
        target = orders[0]
        order_id = target.get("id")
        before_status = target.get("payment_status")
        intent_id = target.get("stripe_payment_intent_id") or f"pi_fake_{uuid.uuid4().hex[:6]}"

        forged = {
            "id": f"evt_forged_{uuid.uuid4().hex[:8]}",
            "type": "charge.refunded",
            "data": {"object": {
                "id": "ch_forged",
                "payment_intent": intent_id,
                "amount_refunded": 100,
                "refunds": {"data": [{"id": "re_forged", "amount": 100}]},
            }},
        }
        r = http.post(f"{API}/payments/webhook", json=forged, timeout=15)
        assert r.status_code == 400, f"forged webhook should be 400, got {r.status_code}"

        # Re-read order; payment_status must be unchanged
        after_status = None
        try:
            sr = http.get(f"{API}/payments/orders/{order_id}/status",
                          headers=_h(shipper_token), timeout=15)
            if sr.status_code == 200:
                after_status = sr.json().get("payment_status")
        except Exception:
            pass
        assert after_status == before_status, (
            f"order payment_status mutated by unsigned webhook: {before_status} -> {after_status}"
        )


# ============================================================
# SEC-002 + full regression: accept -> advance lifecycle with auth
# ============================================================
def _get_or_create_pending_order(http):
    """Ensure at least one pending order exists; return its id."""
    r = http.get(f"{API}/orders/pending", timeout=15)
    if r.status_code == 200 and r.json():
        return r.json()["id"]
    r2 = http.post(f"{API}/orders/add-pending", timeout=15)
    assert r2.status_code in (200, 201), f"could not seed pending order: {r2.status_code} {r2.text}"
    return r2.json()["id"]


class TestSec002OrderLifecycleAuth:
    @pytest.fixture(scope="class")
    def claimed_order_id(self, http, driver_token):
        order_id = _get_or_create_pending_order(http)
        r = http.post(f"{API}/orders/{order_id}/accept",
                      headers=_h(driver_token), timeout=20)
        # Some orders may already be claimed by this driver in earlier runs;
        # if accept fails because the order moved on, fetch a fresh active one.
        if r.status_code not in (200, 201):
            # Try to get the driver's current active order
            ar = http.get(f"{API}/orders/active", headers=_h(driver_token), timeout=15)
            if ar.status_code == 200 and ar.json():
                return ar.json()["id"]
            # Seed and accept fresh
            order_id = _get_or_create_pending_order(http)
            r = http.post(f"{API}/orders/{order_id}/accept",
                          headers=_h(driver_token), timeout=20)
            assert r.status_code in (200, 201), f"accept failed: {r.status_code} {r.text}"
        return r.json()["id"]

    # --- advance ---
    def test_advance_without_auth_rejected(self, http, claimed_order_id):
        r = http.post(f"{API}/orders/{claimed_order_id}/advance",
                      json={"next_status": "arrived_pickup"}, timeout=15)
        assert r.status_code in (401, 403), (
            f"anonymous advance should be 401/403, got {r.status_code}: {r.text}"
        )

    def test_advance_with_bad_token_rejected(self, http, claimed_order_id):
        r = http.post(f"{API}/orders/{claimed_order_id}/advance",
                      json={"next_status": "arrived_pickup"},
                      headers={"Authorization": "Bearer not.a.token",
                              "Content-Type": "application/json"},
                      timeout=15)
        assert r.status_code in (401, 403), (
            f"bad-token advance should be 401/403, got {r.status_code}: {r.text}"
        )

    def test_advance_with_other_driver_rejected(self, http, claimed_order_id, shipper_token, admin_token):
        # Use the shipper token (a non-driver) and the admin token — both should
        # NOT be allowed to advance an order owned by the demo driver.
        for label, tok in [("shipper", shipper_token), ("admin", admin_token)]:
            r = http.post(f"{API}/orders/{claimed_order_id}/advance",
                          json={"next_status": "arrived_pickup"},
                          headers=_h(tok), timeout=15)
            assert r.status_code in (401, 403), (
                f"{label} token must not advance order: got {r.status_code}: {r.text}"
            )

    # --- reject ---
    def test_reject_without_auth_rejected(self, http):
        # Seed a fresh pending order so we don't burn an active one
        order_id = _get_or_create_pending_order(http)
        r = http.post(f"{API}/orders/{order_id}/reject", timeout=15)
        assert r.status_code in (401, 403), (
            f"anonymous reject should be 401/403, got {r.status_code}: {r.text}"
        )

    # --- full assigned-driver lifecycle ---
    def test_assigned_driver_can_advance_to_delivered(self, http, driver_token, claimed_order_id):
        # Step through the lifecycle using the server's default next-state
        # resolver (omit next_status). The assigned driver must succeed every
        # step until 'delivered'. Cap iterations to prevent infinite loops.
        last_status = None
        for _ in range(12):
            r = http.post(f"{API}/orders/{claimed_order_id}/advance",
                          json={}, headers=_h(driver_token), timeout=20)
            assert r.status_code == 200, (
                f"assigned driver advance failed at status={last_status}: "
                f"{r.status_code} {r.text}"
            )
            body = r.json()
            last_status = body.get("status")
            if last_status == "delivered":
                break
        assert last_status == "delivered", f"expected delivered, got {last_status}"


# ============================================================
# Admin-only endpoints still require admin token
# ============================================================
class TestAdminEndpointsAuth:
    ADMIN_ENDPOINTS = [
        "/admin/manage/drivers",
        "/admin/pricing",
    ]

    @pytest.mark.parametrize("path", ADMIN_ENDPOINTS)
    def test_admin_route_without_token(self, http, path):
        r = http.get(f"{API}{path}", timeout=15)
        assert r.status_code in (401, 403), (
            f"{path} without token expected 401/403, got {r.status_code}: {r.text}"
        )

    @pytest.mark.parametrize("path", ADMIN_ENDPOINTS)
    def test_admin_route_with_driver_token_rejected(self, http, driver_token, path):
        r = http.get(f"{API}{path}", headers=_h(driver_token), timeout=15)
        assert r.status_code in (401, 403), (
            f"{path} with driver token expected 401/403, got {r.status_code}: {r.text}"
        )

    @pytest.mark.parametrize("path", ADMIN_ENDPOINTS)
    def test_admin_route_with_admin_token(self, http, admin_token, path):
        r = http.get(f"{API}{path}", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200, (
            f"{path} with admin token expected 200, got {r.status_code}: {r.text}"
        )
