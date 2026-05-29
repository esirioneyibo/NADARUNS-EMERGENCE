"""Live-tracking regression tests for NadaRuns.

Covers the upgraded GET /api/orders/{order_id}/driver-location endpoint:
  - Returns eta_minutes/remaining_km/target/off_route when driver has a location
  - Returns null/false sentinels when driver has no location yet (graceful)
  - target = "pickup" during pickup phase, "dropoff" during dropoff phase
  - off_route detected only on the dropoff phase when driver strays >3km

Also verifies the driver-location update path (POST /api/driver/location)
and reuses the demo accounts seeded via /api/seed-demo.
"""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path('/app/frontend/.env'))
BASE_URL = (
    os.environ.get('EXPO_BACKEND_URL')
    or os.environ.get('EXPO_PUBLIC_BACKEND_URL')
).rstrip('/')
API = f"{BASE_URL}/api"

DEMO_DRIVER = {"email": "demo.driver@nadaruns.com", "password": "demo1234"}
DEMO_SHIPPER = {"email": "demo.shipper@nadaruns.com", "password": "demo1234"}

# Helsinki demo coordinates (matches seed-demo fixture region)
PICKUP_LAT, PICKUP_LNG = 60.17, 24.94
DROPOFF_LAT, DROPOFF_LNG = 60.20, 24.97

# A point ~near the pickup (driver "arriving")
NEAR_PICKUP_LAT, NEAR_PICKUP_LNG = 60.168, 24.938
# A point well off the pickup-dropoff line (>3km perpendicular) — south of Helsinki
OFF_ROUTE_LAT, OFF_ROUTE_LNG = 60.14, 25.05


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
def shipper_token(http):
    r = http.post(f"{API}/auth/shipper-login", json=DEMO_SHIPPER, timeout=15)
    assert r.status_code == 200, f"shipper login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def driver_token(http):
    """A fresh driver registered for this suite so we don't clash with the
    demo driver who may have an in-flight order (real users hit the demo accounts)."""
    email = f"TEST_tracker_{uuid.uuid4().hex[:8]}@nadaruns.com"
    reg = http.post(
        f"{API}/auth/driver-register",
        json={
            "name": "TEST Tracker Driver",
            "email": email,
            "password": "trackerpass123",
            "phone": "+358 40 111 2222",
            "vehicle_type": "cargo_van",
        }, timeout=20,
    )
    assert reg.status_code in (200, 201), f"register failed: {reg.text}"
    token = reg.json().get("token") or reg.json().get("access_token")
    if not token:
        r = http.post(f"{API}/auth/login", json={"email": email, "password": "trackerpass123"}, timeout=15)
        token = r.json()["token"]
    # bring driver online so accept is allowed (the backend may require this)
    http.post(f"{API}/driver/toggle-online", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    return token


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _create_pending_order(http, shipper_token):
    payload = {
        "pickup_address": "TEST Pickup",
        "pickup_lat": PICKUP_LAT, "pickup_lng": PICKUP_LNG,
        "pickup_contact_name": "Pickup Contact",
        "pickup_contact_phone": "+358 40 000 0001",
        "pickup_notes": "TEST notes",
        "dropoff_address": "TEST Dropoff",
        "dropoff_lat": DROPOFF_LAT, "dropoff_lng": DROPOFF_LNG,
        "dropoff_contact_name": "Drop Contact",
        "dropoff_contact_phone": "+358 40 000 0002",
        "vehicle_type": "cargo_van",
        "cargo_weight_kg": 200,
        "cargo_type": "general",
        "cargo_description": "TEST cargo",
    }
    r = http.post(f"{API}/shipper/shipments", json=payload, headers=_auth(shipper_token), timeout=20)
    assert r.status_code == 200, f"create shipment failed: {r.status_code} {r.text}"
    return r.json()["order_id"]


@pytest.fixture
def accepted_order(http, shipper_token, driver_token):
    """Create a shipment and have the test driver accept it.
    Returns the order_id (status='accepted')."""
    order_id = _create_pending_order(http, shipper_token)
    r = http.post(f"{API}/orders/{order_id}/accept", headers=_auth(driver_token), timeout=15)
    assert r.status_code == 200, f"accept failed: {r.status_code} {r.text}"
    assert r.json()["status"] == "accepted"
    return order_id


def _post_location(http, driver_token, lat, lng, order_id):
    # Frontend api.updateDriverLocation sends {location:{lat,lng}, order_id}
    return http.post(
        f"{API}/driver/location",
        json={"location": {"lat": lat, "lng": lng}, "order_id": order_id},
        headers=_auth(driver_token), timeout=15,
    )


# ---------- Tests: graceful no-location case ----------

class TestNoLocationGraceful:
    def test_no_location_yet_returns_nulls(self, http, accepted_order, shipper_token):
        """When the driver has not posted a location, the new fields are
        null/false (not missing) and existing fields remain present."""
        r = http.get(
            f"{API}/orders/{accepted_order}/driver-location",
            headers=_auth(shipper_token), timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # New fields must exist (graceful nulls)
        assert "eta_minutes" in data
        assert "remaining_km" in data
        assert "target" in data
        assert "off_route" in data
        assert data["off_route"] is False
        # Either driver hasn't pushed location (nulls) OR demo driver had one already
        # but in both cases off_route must be false on accepted-phase.
        if data.get("driver_location") is None:
            assert data["eta_minutes"] is None
            assert data["remaining_km"] is None
            assert data["target"] is None


# ---------- Tests: pickup-phase target ----------

class TestPickupPhase:
    def test_target_pickup_with_eta(self, http, accepted_order, shipper_token, driver_token):
        # Push a location near the pickup
        r = _post_location(http, driver_token, NEAR_PICKUP_LAT, NEAR_PICKUP_LNG, accepted_order)
        assert r.status_code == 200, r.text

        r = http.get(
            f"{API}/orders/{accepted_order}/driver-location",
            headers=_auth(shipper_token), timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["target"] == "pickup", f"expected pickup target, got {d['target']}"
        assert isinstance(d["eta_minutes"], int) and d["eta_minutes"] >= 1
        assert isinstance(d["remaining_km"], (int, float)) and d["remaining_km"] >= 0
        # Off-route is never raised on pickup-phase by design
        assert d["off_route"] is False
        # Driver-location echoed back
        assert d["driver_location"] is not None
        assert abs(d["driver_location"]["lat"] - NEAR_PICKUP_LAT) < 1e-6
        # Numeric sanity: <1km away → small ETA
        assert d["remaining_km"] < 5

    def test_target_pickup_for_enroute_pickup(self, http, accepted_order, shipper_token, driver_token):
        # advance to enroute_pickup
        r = http.post(f"{API}/orders/{accepted_order}/advance", json={}, headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200 and r.json()["status"] == "enroute_pickup"

        _post_location(http, driver_token, NEAR_PICKUP_LAT, NEAR_PICKUP_LNG, accepted_order)
        d = http.get(f"{API}/orders/{accepted_order}/driver-location",
                     headers=_auth(shipper_token), timeout=15).json()
        assert d["target"] == "pickup"
        assert d["status"] == "enroute_pickup"


# ---------- Tests: dropoff-phase target + off_route ----------

class TestDropoffPhase:
    def _advance_to_picked_up(self, http, order_id, driver_token):
        # accepted -> enroute_pickup -> arrived_pickup -> picked_up
        for _ in range(3):
            r = http.post(f"{API}/orders/{order_id}/advance", json={}, headers=_auth(driver_token), timeout=15)
            assert r.status_code == 200, r.text
        evt = http.get(f"{API}/orders/{order_id}/events", timeout=15).json()
        assert evt["current_status"] == "picked_up"

    def test_target_flips_to_dropoff(self, http, accepted_order, shipper_token, driver_token):
        self._advance_to_picked_up(http, accepted_order, driver_token)

        # Driver still near pickup; for dropoff phase we want target=dropoff
        _post_location(http, driver_token, NEAR_PICKUP_LAT, NEAR_PICKUP_LNG, accepted_order)
        d = http.get(f"{API}/orders/{accepted_order}/driver-location",
                     headers=_auth(shipper_token), timeout=15).json()
        assert d["target"] == "dropoff", f"expected dropoff, got {d['target']}"
        assert d["status"] == "picked_up"
        assert isinstance(d["eta_minutes"], int) and d["eta_minutes"] >= 1
        assert isinstance(d["remaining_km"], (int, float)) and d["remaining_km"] >= 0

    def test_off_route_detected_when_driver_strays(self, http, accepted_order, shipper_token, driver_token):
        self._advance_to_picked_up(http, accepted_order, driver_token)

        # Push a far off-route location (>3km perpendicular to pickup→dropoff line)
        _post_location(http, driver_token, OFF_ROUTE_LAT, OFF_ROUTE_LNG, accepted_order)
        d = http.get(f"{API}/orders/{accepted_order}/driver-location",
                     headers=_auth(shipper_token), timeout=15).json()
        assert d["target"] == "dropoff"
        # Either off_route is True (>3km perpendicular) OR the chosen test point
        # is unfortunately near the corridor. We assert geometrically: distance
        # from straight line should be >3km for our chosen coords.
        assert d["off_route"] is True, (
            f"expected off_route True at ({OFF_ROUTE_LAT},{OFF_ROUTE_LNG}), got {d}"
        )

    def test_on_route_not_flagged(self, http, accepted_order, shipper_token, driver_token):
        self._advance_to_picked_up(http, accepted_order, driver_token)
        # Midpoint between pickup and dropoff — clearly on-route
        mid_lat = (PICKUP_LAT + DROPOFF_LAT) / 2
        mid_lng = (PICKUP_LNG + DROPOFF_LNG) / 2
        _post_location(http, driver_token, mid_lat, mid_lng, accepted_order)
        d = http.get(f"{API}/orders/{accepted_order}/driver-location",
                     headers=_auth(shipper_token), timeout=15).json()
        assert d["target"] == "dropoff"
        assert d["off_route"] is False


# ---------- Tests: error / regression ----------

class TestErrorPaths:
    def test_unknown_order_404(self, http, shipper_token):
        r = http.get(
            f"{API}/orders/does-not-exist-{uuid.uuid4().hex[:6]}/driver-location",
            headers=_auth(shipper_token), timeout=15,
        )
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"

    def test_unauthenticated_rejected(self, http, accepted_order):
        r = http.get(f"{API}/orders/{accepted_order}/driver-location", timeout=15)
        # endpoint requires auth (get_current_user)
        assert r.status_code in (401, 403), f"expected auth-required, got {r.status_code}"

    def test_driver_performance_still_200(self, http, driver_token):
        """Regression: existing driver performance endpoint still works."""
        r = http.get(f"{API}/driver/performance", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("earnings", "deliveries", "acceptance_rate", "completion_rate", "rating"):
            assert key in body, f"missing key {key} in performance response: {body}"
        assert "today" in body["earnings"]
