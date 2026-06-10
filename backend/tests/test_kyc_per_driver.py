"""
Tests for the real KYC verification flow and per-driver data scoping.

Covers:
- POST /api/seed-demo idempotent seeding (demo driver pre-approved)
- Per-driver KYC status (new driver -> 'incomplete', NOT global)
- POST /api/driver/kyc/submit -> overall_status 'pending' (no auto-approval)
- POST /api/driver/kyc/simulate-approval must NOT exist (404)
- Admin can list & approve KYC for the new driver
- accept_order KYC gate: unverified driver -> 403; demo driver -> 200/idempotent
- After admin approval, the new driver can also accept
- Per-driver scoping for /driver/wallet, /driver/performance, /orders/history
"""

import os
import time
import uuid
import base64

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nadaruns-logistics.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# Tiny but valid base64 image payloads (a few hundred bytes each, with data URI).
_TINY_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
DATA_URI = f"data:image/png;base64,{_TINY_PNG}"


# ---------------- Fixtures ----------------

@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def seed(http):
    """Idempotently seed demo accounts + sample data."""
    r = http.post(f"{API}/seed-demo", timeout=30)
    assert r.status_code in (200, 201), f"seed-demo failed: {r.status_code} {r.text[:300]}"
    return r.json()


@pytest.fixture(scope="session")
def demo_driver_token(http, seed):
    r = http.post(f"{API}/auth/login", json={
        "email": "demo.driver@nadaruns.com",
        "password": "demo1234",
    }, timeout=15)
    assert r.status_code == 200, f"demo driver login failed: {r.status_code} {r.text[:300]}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def demo_shipper_token(http, seed):
    r = http.post(f"{API}/auth/shipper-login", json={
        "email": "demo.shipper@nadaruns.com",
        "password": "demo1234",
    }, timeout=15)
    assert r.status_code == 200, f"demo shipper login failed: {r.status_code} {r.text[:300]}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_token(http, seed):
    r = http.post(f"{API}/auth/admin-login", json={
        "email": "admin@nadaruns.com",
        "password": "admin123",
    }, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:300]}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def new_driver(http, seed):
    """Register a brand new driver with a unique email via /api/auth/driver-register."""
    suffix = uuid.uuid4().hex[:8]
    email = f"TEST_kyc_{suffix}@nadaruns.com"
    payload = {
        "name": "TEST New Driver",
        "email": email,
        "password": "testpass123",
        "phone": "+11" + str(int(time.time()))[-9:],
        "vehicle_type": "cargo_van",
    }
    r = http.post(f"{API}/auth/driver-register", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text[:400]}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    driver_id = data.get("driver_id") or data.get("user_id") or (data.get("user") or {}).get("id") or (data.get("driver") or {}).get("id")
    assert token, f"no token in register response: {data}"
    assert driver_id, f"no driver id in register response: {data}"
    return {"email": email, "token": token, "driver_id": driver_id}


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------- 1) Per-driver KYC status ----------------

class TestKycPerDriverStatus:
    def test_new_driver_kyc_status_is_incomplete(self, http, new_driver):
        r = http.get(f"{API}/driver/kyc-status", headers=_auth(new_driver["token"]), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["overall_status"] == "incomplete", f"expected 'incomplete', got: {data}"
        assert data["driver_id"] == new_driver["driver_id"]
        # not the globally hardcoded driver-001 anymore
        assert data["driver_id"] != "driver-001"

    def test_demo_driver_kyc_is_approved(self, http, demo_driver_token):
        r = http.get(f"{API}/driver/kyc-status", headers=_auth(demo_driver_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["overall_status"] == "approved"


# ---------------- 2) Submit -> pending (no auto-approve) ----------------

class TestKycSubmitPending:
    def test_submit_marks_pending_not_approved(self, http, new_driver):
        body = {"license_front": DATA_URI, "license_back": DATA_URI, "selfie": DATA_URI}
        r = http.post(f"{API}/driver/kyc/submit", json=body,
                      headers=_auth(new_driver["token"]), timeout=20)
        assert r.status_code in (200, 201), r.text
        # follow-up GET should reflect 'pending', NOT auto 'approved'
        g = http.get(f"{API}/driver/kyc-status", headers=_auth(new_driver["token"]), timeout=15)
        assert g.status_code == 200
        data = g.json()
        assert data["overall_status"] == "pending", f"expected 'pending' after submit, got: {data}"

    def test_simulate_approval_endpoint_removed(self, http, new_driver):
        r = http.post(f"{API}/driver/kyc/simulate-approval",
                      headers=_auth(new_driver["token"]), timeout=15)
        assert r.status_code == 404, f"simulate-approval should be gone; got {r.status_code}: {r.text[:200]}"


# ---------------- 3) Accept-order KYC gate (before approval) ----------------

def _create_pending_order(http, shipper_token):
    """Create a pending shipment via POST /api/shipper/shipments."""
    payload = {
        "pickup_address": "Pickup 1, Helsinki",
        "pickup_lat": 60.1699,
        "pickup_lng": 24.9384,
        "pickup_contact_name": "TEST Pickup",
        "pickup_contact_phone": "+358401111111",
        "dropoff_address": "Drop 1, Helsinki",
        "dropoff_lat": 60.1812,
        "dropoff_lng": 24.9298,
        "dropoff_contact_name": "TEST Dropoff",
        "dropoff_contact_phone": "+358402222222",
        "vehicle_type": "cargo_van",
        "cargo_weight_kg": 25,
        "cargo_type": "general",
        "cargo_description": "TEST cargo for KYC tests",
        "urgency": "standard",
    }
    r = http.post(f"{API}/shipper/shipments", json=payload,
                  headers=_auth(shipper_token), timeout=30)
    assert r.status_code in (200, 201), f"order create failed: {r.status_code} {r.text[:300]}"
    return r.json()


class TestKycAcceptGate:
    def test_unverified_new_driver_cannot_accept(self, http, new_driver, demo_shipper_token):
        order = _create_pending_order(http, demo_shipper_token)
        oid = order.get("id") or order.get("order_id")
        assert oid, f"no order id: {order}"
        r = http.post(f"{API}/orders/{oid}/accept", headers=_auth(new_driver["token"]), timeout=15)
        assert r.status_code == 403, f"expected 403 for unverified driver, got {r.status_code}: {r.text[:300]}"
        body_lower = r.text.lower()
        assert "kyc" in body_lower or "verification" in body_lower, f"403 message must mention KYC: {r.text[:200]}"
        # cleanup: leave the order pending – next test (demo driver) will accept it
        pytest.shared_pending_order_id = oid  # type: ignore[attr-defined]

    def test_demo_verified_driver_can_accept(self, http, demo_shipper_token, demo_driver_token):
        # Use the order from the previous test if available, else create a new one
        oid = getattr(pytest, "shared_pending_order_id", None)
        if not oid:
            order = _create_pending_order(http, demo_shipper_token)
            oid = order.get("id") or order.get("order_id")
        r = http.post(f"{API}/orders/{oid}/accept", headers=_auth(demo_driver_token), timeout=15)
        assert r.status_code == 200, f"demo driver should accept, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        # Status moved to an active state (accepted / en_route_pickup etc.)
        assert data.get("status") not in (None, "pending"), f"unexpected status after accept: {data.get('status')}"

    def test_demo_driver_idempotent_re_accept(self, http, demo_driver_token):
        oid = getattr(pytest, "shared_pending_order_id", None)
        if not oid:
            pytest.skip("no shared order id")
        r = http.post(f"{API}/orders/{oid}/accept", headers=_auth(demo_driver_token), timeout=15)
        assert r.status_code == 200, f"idempotent re-accept failed: {r.status_code} {r.text[:200]}"


# ---------------- 4) Admin approval + post-approval accept ----------------

class TestAdminApproval:
    def test_admin_sees_pending_application(self, http, admin_token, new_driver):
        r = http.get(f"{API}/admin/kyc-applications", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        apps = r.json()
        # Normalize various wrapper shapes
        if isinstance(apps, dict):
            apps = apps.get("applications") or apps.get("items") or []
        ids = []
        for a in apps:
            ks = a.get("kyc_status") or {}
            drv = a.get("driver") or {}
            did = ks.get("driver_id") or drv.get("id") or a.get("driver_id")
            if did:
                ids.append(did)
        assert new_driver["driver_id"] in ids, f"new driver not listed in KYC applications: ids={ids}"

    def test_admin_approve_and_driver_is_verified(self, http, admin_token, new_driver):
        r = http.post(f"{API}/admin/kyc/{new_driver['driver_id']}/approve",
                      headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200, f"approve failed: {r.status_code} {r.text[:300]}"
        g = http.get(f"{API}/driver/kyc-status", headers=_auth(new_driver["token"]), timeout=15)
        assert g.status_code == 200
        assert g.json()["overall_status"] == "approved"

    def test_now_approved_driver_can_accept(self, http, new_driver, demo_shipper_token):
        order = _create_pending_order(http, demo_shipper_token)
        oid = order.get("id") or order.get("order_id")
        r = http.post(f"{API}/orders/{oid}/accept", headers=_auth(new_driver["token"]), timeout=15)
        assert r.status_code == 200, f"post-approval accept failed: {r.status_code} {r.text[:300]}"


# ---------------- 5) Per-driver data scoping ----------------

class TestPerDriverScoping:
    def test_new_driver_wallet_is_empty(self, http, new_driver):
        # NOTE: the new driver has ZERO 'delivered' orders. The accept above
        # only moved an order to accepted/active, not 'delivered', so wallet
        # and history must be empty.
        r = http.get(f"{API}/driver/wallet", headers=_auth(new_driver["token"]), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert float(data.get("available_balance", 0)) == 0.0
        assert float(data.get("pending_balance", 0)) == 0.0
        # transactions should not include any 'delivery' txns for a brand-new driver
        txns = data.get("transactions", []) or []
        delivery_txns = [t for t in txns if t.get("type") == "delivery"]
        assert delivery_txns == [], f"new driver wallet leaked delivery txns: {delivery_txns}"

    def test_new_driver_performance_is_zeroed(self, http, new_driver):
        r = http.get(f"{API}/driver/performance", headers=_auth(new_driver["token"]), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # Earnings should all be zero for a new driver with no delivered orders
        earnings = data.get("earnings") or {}
        for k in ("today", "week", "total"):
            v = earnings.get(k, 0)
            assert float(v or 0) == 0.0, f"performance.earnings.{k} leaked non-zero for new driver: {v}"
        deliveries = data.get("deliveries") or {}
        for k in ("today", "week", "total"):
            assert int(deliveries.get(k, 0) or 0) == 0, f"performance.deliveries.{k} leaked non-zero: {deliveries}"
        recent = data.get("recent_deliveries") or []
        assert recent == [], f"performance.recent_deliveries leaked for new driver: {recent}"

    def test_new_driver_history_is_empty(self, http, new_driver):
        r = http.get(f"{API}/orders/history", headers=_auth(new_driver["token"]), timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()
        assert items == [], f"new driver history leaked items: {items[:3]}"

    def test_demo_driver_scoping_does_not_404(self, http, demo_driver_token):
        # Demo driver's data should load fine (seeded by /seed-demo with delivered orders)
        for ep in ("/driver/wallet", "/driver/performance", "/orders/history"):
            r = http.get(f"{API}{ep}", headers=_auth(demo_driver_token), timeout=15)
            assert r.status_code == 200, f"{ep} demo failed: {r.status_code} {r.text[:200]}"
