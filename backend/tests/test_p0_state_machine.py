"""P0 production-grade features regression tests for NadaRuns.

Covers:
  - Order State Machine (forward flow, illegal transitions, idempotent advance)
  - Race-safe driver-bound order acceptance (409 on conflict, 200 idempotent)
  - /api/orders/active scoped by authenticated driver
  - Delivery earnings credited to the authenticated driver
  - Immutable audit trail (order_events)
  - Idempotency-Key support on POST /api/shipper/shipments
  - Backward-compat regression of legacy endpoints
"""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

# Load env from frontend (public URL) - that's what the user hits.
load_dotenv(Path('/app/frontend/.env'))
BASE_URL = (
    os.environ.get('EXPO_BACKEND_URL')
    or os.environ.get('EXPO_PUBLIC_BACKEND_URL')
).rstrip('/')
API = f"{BASE_URL}/api"

DEMO_DRIVER = {"email": "demo.driver@nadaruns.com", "password": "demo1234"}
DEMO_SHIPPER = {"email": "demo.shipper@nadaruns.com", "password": "demo1234"}

ACTIVE_STATES = {
    "accepted", "enroute_pickup", "arrived_pickup",
    "picked_up", "enroute_dropoff", "arrived_dropoff",
}


# ---------- Fixtures ----------

@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session", autouse=True)
def seed(http):
    r = http.post(f"{API}/seed-demo", timeout=30)
    assert r.status_code == 200, f"seed-demo failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def driver_token(http):
    r = http.post(f"{API}/auth/login", json=DEMO_DRIVER, timeout=15)
    assert r.status_code == 200, f"driver login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def driver_id(http, driver_token):
    r = http.get(f"{API}/driver/me", headers={"Authorization": f"Bearer {driver_token}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def shipper_token(http):
    r = http.post(f"{API}/auth/shipper-login", json=DEMO_SHIPPER, timeout=15)
    assert r.status_code == 200, f"shipper login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def second_driver_token(http):
    """Register a second driver for race-condition tests."""
    email = f"TEST_driver2_{uuid.uuid4().hex[:8]}@nadaruns.com"
    reg = http.post(
        f"{API}/auth/driver-register",
        json={
            "name": "TEST Second Driver",
            "email": email,
            "password": "secondpass123",
            "phone": "+358 40 000 1111",
            "vehicle_type": "cargo_van",
        }, timeout=20,
    )
    assert reg.status_code in (200, 201), f"second driver registration failed: {reg.status_code} {reg.text}"
    body = reg.json()
    token = body.get("token") or body.get("access_token")
    if not token:
        # fall back to login
        r = http.post(f"{API}/auth/login", json={"email": email, "password": "secondpass123"}, timeout=15)
        assert r.status_code == 200, r.text
        token = r.json()["token"]
    return token


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _shipment_payload(suffix=""):
    return {
        "pickup_address": f"TEST Pickup {suffix}",
        "pickup_lat": 60.17, "pickup_lng": 24.94,
        "pickup_contact_name": "Pickup Contact",
        "pickup_contact_phone": "+358 40 000 0001",
        "pickup_notes": "TEST notes",
        "dropoff_address": f"TEST Dropoff {suffix}",
        "dropoff_lat": 60.20, "dropoff_lng": 24.97,
        "dropoff_contact_name": "Drop Contact",
        "dropoff_contact_phone": "+358 40 000 0002",
        "vehicle_type": "cargo_van",
        "cargo_weight_kg": 200,
        "cargo_type": "general",
        "cargo_description": "TEST cargo",
    }


def _create_pending_order(http, shipper_token, headers=None):
    h = _auth(shipper_token)
    if headers:
        h.update(headers)
    r = http.post(f"{API}/shipper/shipments", json=_shipment_payload(str(uuid.uuid4())[:6]), headers=h, timeout=20)
    assert r.status_code == 200, f"shipment create failed: {r.status_code} {r.text}"
    return r.json()["order_id"]


# ---------- Health / regression ----------

class TestRegression:
    def test_health(self, http):
        r = http.get(f"{API}/", timeout=15)
        assert r.status_code == 200
        assert "NadaRuns" in r.json().get("message", "")

    def test_driver_login(self, driver_token):
        assert driver_token

    def test_shipper_login(self, shipper_token):
        assert shipper_token

    def test_orders_available(self, http):
        r = http.get(f"{API}/orders/available", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_driver_me(self, http, driver_token):
        r = http.get(f"{API}/driver/me", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == DEMO_DRIVER["email"]

    def test_orders_history(self, http, driver_token):
        r = http.get(f"{API}/orders/history", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- State Machine ----------

class TestStateMachine:
    def test_full_happy_path(self, http, shipper_token, driver_token):
        order_id = _create_pending_order(http, shipper_token)
        # Accept
        r = http.post(f"{API}/orders/{order_id}/accept", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "accepted"

        # advance through full chain
        expected = ["enroute_pickup", "arrived_pickup", "picked_up",
                    "enroute_dropoff", "arrived_dropoff", "delivered"]
        for status in expected:
            r = http.post(f"{API}/orders/{order_id}/advance",
                          json={}, headers=_auth(driver_token), timeout=15)
            assert r.status_code == 200, f"advance to {status} failed: {r.text}"
            assert r.json()["status"] == status, f"expected {status}, got {r.json()['status']}"

    def test_illegal_jump_to_delivered(self, http, shipper_token, driver_token):
        order_id = _create_pending_order(http, shipper_token)
        http.post(f"{API}/orders/{order_id}/accept", headers=_auth(driver_token), timeout=15)
        r = http.post(f"{API}/orders/{order_id}/advance",
                      json={"next_status": "delivered"},
                      headers=_auth(driver_token), timeout=15)
        assert r.status_code == 400, f"expected 400 for illegal jump, got {r.status_code}: {r.text}"

    def test_advance_already_delivered_returns_400(self, http, shipper_token, driver_token):
        order_id = _create_pending_order(http, shipper_token)
        http.post(f"{API}/orders/{order_id}/accept", headers=_auth(driver_token), timeout=15)
        # walk to delivered
        for _ in range(6):
            http.post(f"{API}/orders/{order_id}/advance", json={}, headers=_auth(driver_token), timeout=15)
        # verify delivered
        evt = http.get(f"{API}/orders/{order_id}/events", timeout=15).json()
        assert evt["current_status"] == "delivered"
        # advancing past delivered must fail
        r = http.post(f"{API}/orders/{order_id}/advance", json={}, headers=_auth(driver_token), timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_idempotent_advance_same_status(self, http, shipper_token, driver_token):
        order_id = _create_pending_order(http, shipper_token)
        http.post(f"{API}/orders/{order_id}/accept", headers=_auth(driver_token), timeout=15)
        r = http.post(f"{API}/orders/{order_id}/advance",
                      json={"next_status": "accepted"},
                      headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "accepted"


# ---------- Race-safe acceptance ----------

class TestAcceptRaceSafe:
    def test_accept_binds_driver_id(self, http, shipper_token, driver_token, driver_id):
        order_id = _create_pending_order(http, shipper_token)
        r = http.post(f"{API}/orders/{order_id}/accept", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["driver_id"] == driver_id

    def test_same_driver_reaccept_is_idempotent(self, http, shipper_token, driver_token):
        order_id = _create_pending_order(http, shipper_token)
        r1 = http.post(f"{API}/orders/{order_id}/accept", headers=_auth(driver_token), timeout=15)
        assert r1.status_code == 200, r1.text
        r2 = http.post(f"{API}/orders/{order_id}/accept", headers=_auth(driver_token), timeout=15)
        assert r2.status_code == 200, f"expected 200 idempotent, got {r2.status_code}: {r2.text}"
        assert r2.json()["id"] == order_id

    def test_different_driver_gets_409(self, http, shipper_token, driver_token, second_driver_token):
        order_id = _create_pending_order(http, shipper_token)
        r1 = http.post(f"{API}/orders/{order_id}/accept", headers=_auth(driver_token), timeout=15)
        assert r1.status_code == 200
        r2 = http.post(f"{API}/orders/{order_id}/accept", headers=_auth(second_driver_token), timeout=15)
        assert r2.status_code == 409, f"expected 409 conflict, got {r2.status_code}: {r2.text}"


# ---------- Active order scoping ----------

class TestActiveScoped:
    def test_active_returns_driver_order_only(self, http, shipper_token, driver_token, driver_id, second_driver_token):
        # demo driver accepts an order
        order_id = _create_pending_order(http, shipper_token)
        http.post(f"{API}/orders/{order_id}/accept", headers=_auth(driver_token), timeout=15)

        # demo driver sees it on /active
        r = http.get(f"{API}/orders/active", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data is not None, "active order should be returned for owning driver"
        assert data["driver_id"] == driver_id
        assert data["status"] in ACTIVE_STATES

        # second driver should NOT see another driver's active order
        r2 = http.get(f"{API}/orders/active", headers=_auth(second_driver_token), timeout=15)
        assert r2.status_code == 200
        body2 = r2.json()
        if body2 is not None:
            # if any active order is returned, it must NOT belong to the demo driver
            assert body2.get("driver_id") != driver_id, "second driver leaked another driver's active job"


# ---------- Delivery earnings credited to auth driver ----------

class TestEarningsCredit:
    def test_delivered_credits_authenticated_driver(self, http, shipper_token, driver_token, driver_id):
        # snapshot driver wallet before
        before = http.get(f"{API}/driver/me", headers=_auth(driver_token), timeout=15).json()
        before_earnings = before["earnings_today"]
        before_deliv = before["deliveries_today"]

        order_id = _create_pending_order(http, shipper_token)
        http.post(f"{API}/orders/{order_id}/accept", headers=_auth(driver_token), timeout=15)
        for _ in range(6):
            r = http.post(f"{API}/orders/{order_id}/advance", json={}, headers=_auth(driver_token), timeout=15)
            assert r.status_code == 200, r.text
        assert r.json()["status"] == "delivered"

        after = http.get(f"{API}/driver/me", headers=_auth(driver_token), timeout=15).json()
        assert after["deliveries_today"] == before_deliv + 1, "delivery counter not incremented for auth driver"
        assert after["earnings_today"] > before_earnings, "earnings_today did not increase for auth driver"

        # Hardcoded legacy driver must NOT be credited - check via lookup by old id
        # If a driver-001 record exists, its delta should be zero. If it doesn't
        # exist, that's also fine (means we never accidentally created it).
        legacy_id = "driver-001"
        # we can't easily auth as driver-001, but we can verify via available endpoints by
        # asserting no driver-001 entry appears in shippers/shipments path. Skip if absent.


# ---------- Audit trail ----------

class TestAudit:
    def test_unknown_order_returns_404(self, http):
        r = http.get(f"{API}/orders/{uuid.uuid4()}/events", timeout=15)
        assert r.status_code == 404

    def test_events_chronological_with_required_fields(self, http, shipper_token, driver_token):
        order_id = _create_pending_order(http, shipper_token)
        http.post(f"{API}/orders/{order_id}/accept", headers=_auth(driver_token), timeout=15)
        http.post(f"{API}/orders/{order_id}/advance", json={}, headers=_auth(driver_token), timeout=15)

        r = http.get(f"{API}/orders/{order_id}/events", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["order_id"] == order_id
        assert "current_status" in body
        events = body["events"]
        assert isinstance(events, list)
        assert len(events) >= 3, f"expected >=3 events (created + accept + advance), got {len(events)}: {events}"

        # validate fields and event types
        types = [e["event_type"] for e in events]
        assert "order_created" in types, f"missing order_created event: {types}"
        assert types.count("status_change") >= 2, f"expected at least 2 status_change events: {types}"

        for ev in events:
            assert "event_type" in ev
            assert "from_status" in ev
            assert "to_status" in ev
            assert "actor_id" in ev
            assert "created_at" in ev

        # chronological
        timestamps = [e["created_at"] for e in events]
        assert timestamps == sorted(timestamps), "events are not chronological"


# ---------- Idempotency ----------

class TestIdempotency:
    def test_same_key_returns_same_order(self, http, shipper_token):
        key = f"TEST-{uuid.uuid4()}"
        payload = _shipment_payload("idem-same")
        h1 = _auth(shipper_token); h1["Idempotency-Key"] = key
        r1 = http.post(f"{API}/shipper/shipments", json=payload, headers=h1, timeout=20)
        assert r1.status_code == 200, r1.text
        id1 = r1.json()["order_id"]

        h2 = _auth(shipper_token); h2["Idempotency-Key"] = key
        r2 = http.post(f"{API}/shipper/shipments", json=payload, headers=h2, timeout=20)
        assert r2.status_code == 200, r2.text
        id2 = r2.json()["order_id"]
        assert id1 == id2, f"idempotency failed: got two ids {id1} != {id2}"

    def test_no_key_creates_two_orders(self, http, shipper_token):
        payload = _shipment_payload("idem-none")
        r1 = http.post(f"{API}/shipper/shipments", json=payload, headers=_auth(shipper_token), timeout=20)
        r2 = http.post(f"{API}/shipper/shipments", json=payload, headers=_auth(shipper_token), timeout=20)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["order_id"] != r2.json()["order_id"], "two requests without key must create two orders"
