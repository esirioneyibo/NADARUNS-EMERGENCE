"""
Tests for the NEW NadaRuns endpoints:
- GET /api/orders/available with 2dsphere $geoNear (lat/lng/radius_km)
- GET /api/admin/dispatch/map
- regression: GET /api/payments/config + authorize-test + admin capture flow
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

DRIVER_EMAIL = "demo.driver@nadaruns.com"
SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
ADMIN_EMAIL = "admin@nadaruns.com"
DEMO_PW = "demo1234"
ADMIN_PW = "admin123"

HELSINKI_LAT = 60.1699
HELSINKI_LNG = 24.9384


# ---------- Fixtures ----------

@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session", autouse=True)
def seed_demo(http):
    # Idempotent seeding
    r = http.post(f"{API}/seed-demo", timeout=60)
    assert r.status_code in (200, 201), f"seed-demo failed: {r.status_code} {r.text[:200]}"
    return r.json() if r.headers.get("content-type", "").startswith("application/json") else {}


@pytest.fixture(scope="session")
def driver_token(http):
    r = http.post(f"{API}/auth/login", json={"email": DRIVER_EMAIL, "password": DEMO_PW}, timeout=30)
    assert r.status_code == 200, f"driver login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def shipper_token(http):
    r = http.post(f"{API}/auth/shipper-login", json={"email": SHIPPER_EMAIL, "password": DEMO_PW}, timeout=30)
    assert r.status_code == 200, f"shipper login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_token(http):
    r = http.post(f"{API}/auth/admin-login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.text}"
    return r.json()["token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ============================================================
# Module: orders/available with $geoNear (2dsphere)
# ============================================================

class TestAvailableOrdersGeo:

    def test_with_lat_lng_returns_jobs_sorted_by_distance(self, http, driver_token):
        r = http.get(
            f"{API}/orders/available",
            params={"lat": HELSINKI_LAT, "lng": HELSINKI_LNG, "radius_km": 50},
            headers=auth(driver_token),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        jobs = r.json()
        assert isinstance(jobs, list)
        assert len(jobs) > 0, "expected at least one nearby job after seed-demo (2dsphere backfill)"

        # Every job has pickup_distance_km as a number
        for j in jobs:
            assert "pickup_distance_km" in j, f"missing pickup_distance_km: {j}"
            assert isinstance(j["pickup_distance_km"], (int, float)), j["pickup_distance_km"]

        # Sorted ascending by pickup_distance_km
        dists = [j["pickup_distance_km"] for j in jobs]
        assert dists == sorted(dists), f"jobs not sorted by pickup_distance_km asc: {dists}"

    def test_payout_per_km_when_distance_positive(self, http, driver_token):
        r = http.get(
            f"{API}/orders/available",
            params={"lat": HELSINKI_LAT, "lng": HELSINKI_LNG, "radius_km": 50},
            headers=auth(driver_token),
            timeout=30,
        )
        assert r.status_code == 200
        jobs = r.json()
        any_with_dist = [j for j in jobs if (j.get("distance_km") or 0) > 0]
        assert any_with_dist, "expected at least one job with distance_km>0"
        for j in any_with_dist:
            assert j.get("payout_per_km") is not None, f"payout_per_km missing for job w/ distance>0: {j}"
            assert isinstance(j["payout_per_km"], (int, float))
            # Sanity: payout_per_km ≈ earnings/distance_km
            expected = round(float(j["earnings"]) / float(j["distance_km"]), 2)
            assert abs(j["payout_per_km"] - expected) < 0.05, f"payout_per_km mismatch: got {j['payout_per_km']} vs {expected}"

    def test_without_lat_lng_still_returns_jobs(self, http, driver_token):
        r = http.get(f"{API}/orders/available", headers=auth(driver_token), timeout=30)
        assert r.status_code == 200, r.text
        jobs = r.json()
        assert isinstance(jobs, list)
        assert len(jobs) > 0
        any_with_dist = [j for j in jobs if (j.get("distance_km") or 0) > 0]
        assert any_with_dist
        for j in any_with_dist:
            assert j.get("payout_per_km") is not None
            assert isinstance(j["payout_per_km"], (int, float))

    def test_radius_excludes_far_jobs(self, http, driver_token):
        # Tiny radius from Helsinki center -> at most the closest few; many jobs filtered
        narrow = http.get(
            f"{API}/orders/available",
            params={"lat": HELSINKI_LAT, "lng": HELSINKI_LNG, "radius_km": 1},
            headers=auth(driver_token),
            timeout=30,
        )
        wide = http.get(
            f"{API}/orders/available",
            params={"lat": HELSINKI_LAT, "lng": HELSINKI_LNG, "radius_km": 100},
            headers=auth(driver_token),
            timeout=30,
        )
        assert narrow.status_code == 200 and wide.status_code == 200
        nj, wj = narrow.json(), wide.json()
        assert len(nj) <= len(wj), f"narrow radius should not exceed wide: narrow={len(nj)} wide={len(wj)}"
        for j in nj:
            assert j["pickup_distance_km"] <= 1.0 + 0.05

        # Far-away point (Sahara) should return zero
        far = http.get(
            f"{API}/orders/available",
            params={"lat": 23.0, "lng": 12.0, "radius_km": 50},
            headers=auth(driver_token),
            timeout=30,
        )
        assert far.status_code == 200
        assert far.json() == []

    def test_vehicle_type_filter_respected(self, http, driver_token):
        # Request cargo_van; any returned job with vehicle_type set must match (or be None)
        r = http.get(
            f"{API}/orders/available",
            params={"lat": HELSINKI_LAT, "lng": HELSINKI_LNG, "radius_km": 100, "vehicle_type": "cargo_van"},
            headers=auth(driver_token),
            timeout=30,
        )
        assert r.status_code == 200
        for j in r.json():
            vt = j.get("vehicle_type")
            assert vt in (None, "cargo_van"), f"vehicle_type filter leaked: {vt}"


# ============================================================
# Module: admin/dispatch/map
# ============================================================

class TestAdminDispatchMap:

    def test_no_token_unauthorized(self, http):
        r = http.get(f"{API}/admin/dispatch/map", timeout=20)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"

    def test_driver_token_forbidden(self, http, driver_token):
        r = http.get(f"{API}/admin/dispatch/map", headers=auth(driver_token), timeout=20)
        assert r.status_code in (401, 403)

    def test_admin_returns_expected_shape(self, http, admin_token):
        r = http.get(f"{API}/admin/dispatch/map", headers=auth(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("jobs", "drivers", "alerts", "summary"):
            assert key in data, f"missing key {key}: {list(data.keys())}"
        assert isinstance(data["jobs"], list)
        assert isinstance(data["drivers"], list)
        assert isinstance(data["alerts"], list)
        s = data["summary"]
        for k in ("open", "in_transit", "online_drivers"):
            assert k in s and isinstance(s[k], int), f"bad summary[{k}]: {s}"

        # Summary counts must be consistent with jobs/drivers arrays
        open_jobs = [j for j in data["jobs"] if j.get("status") == "open"]
        in_transit_jobs = [j for j in data["jobs"] if j.get("status") == "in_transit"]
        assert s["open"] == len(open_jobs), f"open count mismatch: {s['open']} vs {len(open_jobs)}"
        assert s["in_transit"] == len(in_transit_jobs), f"in_transit count mismatch"
        assert s["online_drivers"] == len(data["drivers"])

        # Open jobs schema
        for j in open_jobs[:5]:
            assert j.get("lat") is not None and j.get("lng") is not None
            assert "package" in j
            assert "earnings" in j

        # In transit schema sanity
        for j in in_transit_jobs[:5]:
            assert j.get("status") == "in_transit"
            assert j.get("lat") is not None and j.get("lng") is not None


# ============================================================
# Module: payments regression (configure + authorize + capture)
# ============================================================

class TestPaymentsRegression:

    def test_payments_config_configured(self, http):
        r = http.get(f"{API}/payments/config", timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("configured") is True, d

    def test_create_order_authorize_and_capture(self, http, shipper_token, admin_token):
        # 1) Create a shipment as shipper
        payload = {
            "pickup_address": "Mannerheimintie 1, Helsinki",
            "pickup_lat": 60.1700,
            "pickup_lng": 24.9300,
            "pickup_contact_name": "TEST_Pickup",
            "pickup_contact_phone": "+358401111111",
            "dropoff_address": "Aleksanterinkatu 50, Helsinki",
            "dropoff_lat": 60.1690,
            "dropoff_lng": 24.9500,
            "dropoff_contact_name": "TEST_Dropoff",
            "dropoff_contact_phone": "+358402222222",
            "vehicle_type": "cargo_van",
            "cargo_weight_kg": 25.0,
            "cargo_type": "general",
            "cargo_description": f"TEST_box_{uuid.uuid4().hex[:6]}",
            "urgency": "standard",
        }
        r = http.post(f"{API}/shipper/shipments", json=payload, headers=auth(shipper_token), timeout=30)
        assert r.status_code in (200, 201), f"create order failed: {r.status_code} {r.text[:300]}"
        order = r.json()
        oid = order.get("id") or order.get("order_id") or (order.get("order") or {}).get("id")
        assert oid, f"no order id in response: {order}"

        # 2) Authorize test payment
        r = http.post(f"{API}/payments/orders/{oid}/authorize-test", headers=auth(shipper_token), timeout=30)
        assert r.status_code in (200, 201), f"authorize-test failed: {r.text}"
        body = r.json()
        # Either explicit status or nested payment shape
        status = body.get("payment_status") or body.get("status") or (body.get("payment") or {}).get("status")
        assert status in ("authorized", "requires_capture", "succeeded"), f"unexpected authorize status: {body}"

        # 3) Capture (admin) — CaptureBody requires JSON body
        r = http.post(f"{API}/payments/orders/{oid}/capture", json={}, headers=auth(admin_token), timeout=30)
        assert r.status_code in (200, 201), f"capture failed: {r.text}"
        cap = r.json()
        cap_status = cap.get("payment_status") or cap.get("status") or (cap.get("payment") or {}).get("status")
        assert cap_status in ("captured", "succeeded"), f"unexpected capture status: {cap}"
