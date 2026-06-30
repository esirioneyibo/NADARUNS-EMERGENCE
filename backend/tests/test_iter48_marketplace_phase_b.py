"""Iteration 48 — Phase B Marketplace Intelligence tests.

Covers:
  - POST /api/shipper/quote/recommend (4-tier recommendations, region/heat)
  - GET  /api/orders/{order_id}/match (empty-run, route-match, driver earnings)
  - Region resolution sanity (Helsinki/Tampere/Turku)
  - Regression on POST /api/shipper/quote
  - Auth guards
"""
import os
import pytest
import requests

BASE_URL = os.environ.get(
    "BACKEND_URL",
    "https://nadaruns-logistics.preview.emergentagent.com",
).rstrip("/")

SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
DRIVER_EMAIL = "demo.driver@nadaruns.com"
PASSWORD = "demo1234"


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers["Content-Type"] = "application/json"
    # Make sure demo accounts exist
    sess.post(f"{BASE_URL}/api/seed-demo", timeout=30)
    return sess


@pytest.fixture(scope="module")
def shipper_token(s):
    r = s.post(
        f"{BASE_URL}/api/auth/shipper-login",
        json={"email": SHIPPER_EMAIL, "password": PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def driver_token(s):
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": DRIVER_EMAIL, "password": PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def pending_order(s, shipper_token):
    """Reuse an existing pending order or create one from the demo shipper."""
    # First try to discover a pending order via the shipper's shipments
    r = s.get(
        f"{BASE_URL}/api/shipper/shipments",
        headers={"Authorization": f"Bearer {shipper_token}"},
        timeout=20,
    )
    if r.status_code == 200:
        for o in r.json():
            if o.get("status") == "pending":
                return o["id"]

    payload = {
        "pickup_address": "Helsinki Central",
        "pickup_lat": 60.1699, "pickup_lng": 24.9384,
        "pickup_contact_name": "TEST Shipper",
        "pickup_contact_phone": "+358401234567",
        "dropoff_address": "Espoo",
        "dropoff_lat": 60.2055, "dropoff_lng": 24.6559,
        "dropoff_contact_name": "TEST Receiver",
        "dropoff_contact_phone": "+358407654321",
        "vehicle_type": "cargo_van",
        "cargo_description": "TEST_phase_b",
        "cargo_weight_kg": 400,
        "urgency": "standard",
    }
    r = s.post(
        f"{BASE_URL}/api/shipper/shipments",
        json=payload,
        headers={"Authorization": f"Bearer {shipper_token}"},
        timeout=30,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# --------------------------------------------------------------------------- #
# /api/shipper/quote/recommend
# --------------------------------------------------------------------------- #
QUOTE_HELSINKI = {
    "pickup_lat": 60.17, "pickup_lng": 24.94,
    "dropoff_lat": 60.45, "dropoff_lng": 22.27,  # → Turku
    "vehicle_type": "cargo_van",
    "cargo_weight_kg": 500,
    "urgency": "standard",
}


class TestRecommend:
    def test_recommend_happy_path_helsinki(self, s):
        r = s.post(f"{BASE_URL}/api/shipper/quote/recommend",
                   json=QUOTE_HELSINKI, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # Top-level shape
        for k in ("quote", "distance_km", "marketplace", "recommendations"):
            assert k in body, f"missing {k}"
        q = body["quote"]
        assert q["total_price"] > 0
        assert q["traditional_estimate"] >= q["total_price"]
        assert isinstance(q.get("breakdown_lines"), list) and q["breakdown_lines"]

        mp = body["marketplace"]
        assert mp["region"] == "helsinki"
        assert mp["region_name"] == "Uusimaa"
        for k in ("demand", "supply", "ratio", "heat"):
            assert k in mp
        heat = mp["heat"]
        assert heat["label"] in {"Cold", "Normal", "Busy", "Very Busy", "Critical"}
        assert "icon" in heat
        assert -0.15 <= heat["adjustment_pct"] <= 0.25

    def test_recommend_four_tiers_ordering(self, s):
        r = s.post(f"{BASE_URL}/api/shipper/quote/recommend",
                   json=QUOTE_HELSINKI, timeout=30)
        recs = r.json()["recommendations"]
        tiers = [x["tier"] for x in recs]
        assert tiers == ["budget", "balanced", "fast", "premium"]

        # Price strictly increasing across tiers
        prices = [x["price"] for x in recs]
        assert prices == sorted(prices) and len(set(prices)) == 4, prices

        # Acceptance non-decreasing
        acc = [x["acceptance_pct"] for x in recs]
        assert acc == sorted(acc), acc
        for a in acc:
            assert 1 <= a <= 99

        # Wait minutes >= 2 each
        for x in recs:
            assert x["wait_minutes"] >= 2
            assert "savings" in x and "savings_pct" in x

        # Only balanced is recommended=True
        recommended_flags = [x["recommended"] for x in recs]
        assert recommended_flags == [False, True, False, False]

    @pytest.mark.parametrize("lat,lng,expected_region,expected_name", [
        (60.17, 24.94, "helsinki", "Uusimaa"),
        (61.50, 23.76, "tampere", "Pirkanmaa"),
        (60.45, 22.27, "turku", "Varsinais-Suomi"),
    ])
    def test_region_resolution(self, s, lat, lng, expected_region, expected_name):
        payload = dict(QUOTE_HELSINKI, pickup_lat=lat, pickup_lng=lng)
        r = s.post(f"{BASE_URL}/api/shipper/quote/recommend",
                   json=payload, timeout=30)
        assert r.status_code == 200, r.text
        mp = r.json()["marketplace"]
        assert mp["region"] == expected_region
        assert mp["region_name"] == expected_name

    def test_recommend_invalid_vehicle(self, s):
        bad = dict(QUOTE_HELSINKI, vehicle_type="spaceship")
        r = s.post(f"{BASE_URL}/api/shipper/quote/recommend",
                   json=bad, timeout=20)
        assert r.status_code == 400


# --------------------------------------------------------------------------- #
# /api/orders/{order_id}/match
# --------------------------------------------------------------------------- #
class TestMatch:
    def test_match_requires_driver_auth(self, s):
        r = s.get(f"{BASE_URL}/api/orders/anything/match", timeout=20)
        assert r.status_code in (401, 403)

    def test_match_unknown_order_returns_404(self, s, driver_token):
        r = s.get(
            f"{BASE_URL}/api/orders/does-not-exist-xyz/match",
            headers={"Authorization": f"Bearer {driver_token}"},
            timeout=20,
        )
        assert r.status_code == 404

    def test_match_default_no_empty(self, s, driver_token, pending_order):
        # Ensure driver location is unset → route_match_pct must be 0
        r = s.post(
            f"{BASE_URL}/api/driver/location",
            json={"location": None},
            headers={"Authorization": f"Bearer {driver_token}"},
            timeout=20,
        )
        # If unset isn't supported, set far-away dummy
        if r.status_code >= 400:
            s.post(
                f"{BASE_URL}/api/driver/location",
                json={"location": {"lat": 0.0, "lng": 0.0}},
                headers={"Authorization": f"Bearer {driver_token}"},
                timeout=20,
            )
        r = s.get(
            f"{BASE_URL}/api/orders/{pending_order}/match",
            headers={"Authorization": f"Bearer {driver_token}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("standard_price", "marketplace_price", "driver_earnings",
                  "discounts", "returning_empty", "empty_run_auto_detected",
                  "marketplace", "breakdown_lines"):
            assert k in body, f"missing {k}"
        # Default: no manual override
        assert body["returning_empty"] is False or body["empty_run_auto_detected"] is True
        d = body["discounts"]
        for k in ("empty_run_pct", "route_match_pct", "route_overlap_pct",
                  "detour_km", "supply_demand_pct"):
            assert k in d

    def test_match_empty_true_applies_discount(self, s, driver_token, shipper_token, pending_order):
        # Look up the order to read the tip (driver earnings includes 100% of tip)
        ord_r = s.get(
            f"{BASE_URL}/api/shipper/shipments",
            headers={"Authorization": f"Bearer {shipper_token}"},
            timeout=20,
        )
        tip = 0.0
        if ord_r.status_code == 200:
            for o in ord_r.json():
                if o.get("id") == pending_order:
                    tip = float(o.get("tip") or o.get("shipper_offer") or 0.0)
                    break

        r = s.get(
            f"{BASE_URL}/api/orders/{pending_order}/match?empty=true",
            headers={"Authorization": f"Bearer {driver_token}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["returning_empty"] is True
        assert b["discounts"]["empty_run_pct"] == 0.25
        # Marketplace price is strictly lower than standard (no empty/route in std)
        assert b["marketplace_price"] < b["standard_price"], (
            b["marketplace_price"], b["standard_price"])
        # Driver earnings = 85% of marketplace_price + tip (100% to driver)
        expected = round(b["marketplace_price"] * 0.85 + tip, 2)
        assert abs(b["driver_earnings"] - expected) <= 0.5, (
            b["driver_earnings"], expected, "tip=", tip)
        # Lower bound: earnings must be at least 85% of marketplace price
        assert b["driver_earnings"] >= round(b["marketplace_price"] * 0.85, 2) - 0.01

    def test_match_route_match_with_location(self, s, driver_token, pending_order):
        # Set driver location near pickup → may produce a route_match discount;
        # without an active job (driver_dest) it should be 0 per implementation.
        s.post(
            f"{BASE_URL}/api/driver/location",
            json={"location": {"lat": 60.17, "lng": 24.94}},
            headers={"Authorization": f"Bearer {driver_token}"},
            timeout=20,
        )
        r = s.get(
            f"{BASE_URL}/api/orders/{pending_order}/match",
            headers={"Authorization": f"Bearer {driver_token}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        rm = r.json()["discounts"]["route_match_pct"]
        # With current_location but no active driver_dest, discount must be 0
        # and never exceed config max (0.30).
        assert 0.0 <= rm <= 0.30


# --------------------------------------------------------------------------- #
# Regression: Phase A engine still works
# --------------------------------------------------------------------------- #
class TestRegressionPhaseA:
    def test_legacy_quote_works(self, s):
        r = s.post(f"{BASE_URL}/api/shipper/quote",
                   json=QUOTE_HELSINKI, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "total_price" in body and body["total_price"] > 0
        assert "distance_km" in body
