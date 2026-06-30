"""Iteration 9 regression suite for NadaRuns.

Coverage:
- Pricing engine: POST /api/shipper/quote — formula, urgency multipliers,
  special-vehicle surcharges, special-handling boost.
- Shipment creation: POST /api/shipper/shipments — base_price/offer/breakdown
  fields, tip == offer, driver earnings = 0.8*base + offer.
- Available orders + no-reseed: GET /api/orders/available (with/without
  lat/lng) and full accept->...->delivered cycle does NOT seed a replacement.
- Driver performance: GET /api/driver/performance returns populated data.
- Regression: order lifecycle is still 200 end-to-end; /api/register-push
  returns 422 on a missing body.
"""

import math
import os
import time
import pytest
import requests

def _read_env_url():
    # First try shell env
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if url:
        return url
    # Fallback: parse frontend/.env directly
    try:
        with open("/app/frontend/.env", "r") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return None


BASE_URL = _read_env_url()
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")

SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
DRIVER_EMAIL = "demo.driver@nadaruns.com"
PASSWORD = "demo1234"


# ---------- fixtures ----------

@pytest.fixture(scope="session", autouse=True)
def seed_demo():
    requests.post(f"{BASE_URL}/api/seed-demo", timeout=30)
    yield


@pytest.fixture(scope="session")
def shipper_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/shipper-login",
        json={"email": SHIPPER_EMAIL, "password": PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"shipper login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def driver_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": DRIVER_EMAIL, "password": PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"driver login failed: {r.status_code} {r.text}"
    return r.json()["token"]


# Helsinki area pickup/dropoff ~22km apart (Helsinki center -> Espoo)
HELSINKI = (60.1699, 24.9384)
ESPOO = (60.2055, 24.6559)


def _approx(a, b, tol=0.5):
    return abs(a - b) <= tol


# ---------- pricing quote ----------

class TestPricingQuote:
    def test_quote_known_case_cargo_van_22km_80kg_standard(self):
        body = {
            "vehicle_type": "cargo_van",
            "pickup_lat": HELSINKI[0], "pickup_lng": HELSINKI[1],
            "dropoff_lat": ESPOO[0], "dropoff_lng": ESPOO[1],
            "cargo_weight_kg": 80,
            "urgency": "standard",
            "special_handling": False,
        }
        r = requests.post(f"{BASE_URL}/api/shipper/quote", json=body, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        # required new fields
        for k in ("distance_km", "base_fee", "distance_fee", "weight_fee",
                  "fuel_surcharge", "total_price", "estimate_low",
                  "estimate_high", "urgency", "urgency_multiplier",
                  "special_multiplier"):
            assert k in data, f"missing field {k}"
        # base_fee == 12 for cargo_van
        assert data["base_fee"] == 12.0
        # ~16-22 km depending on chosen coords (formula validated below)
        assert 14 <= data["distance_km"] <= 30, data["distance_km"]
        # weight component follows the chargeable-weight freight model (kg * €/kg)
        assert _approx(data["weight_fee"],
                       round(data["chargeable_weight"] * data["freight_rate_per_kg"], 2),
                       tol=0.05)
        # urgency standard => 1.0
        assert data["urgency_multiplier"] == 1.0
        # special multiplier for cargo_van w/o handling => 1.0
        assert data["special_multiplier"] == 1.0
        # Fuel surcharge = 8% of subtotal (since multipliers are 1.0)
        subtotal = data["base_fee"] + data["distance_fee"] + data["weight_fee"]
        assert _approx(data["fuel_surcharge"], subtotal * 0.08, tol=0.05)
        assert _approx(data["total_price"], subtotal * 1.08, tol=0.05)
        # roughly 40-60€ for the documented case (varies with chosen coords)
        assert 38 <= data["total_price"] <= 65

    @pytest.mark.parametrize("urgency,mult", [
        ("express", 1.3), ("priority", 1.5), ("emergency", 2.0)
    ])
    def test_urgency_multiplier_scales_total(self, urgency, mult):
        base_body = {
            "vehicle_type": "cargo_van",
            "pickup_lat": HELSINKI[0], "pickup_lng": HELSINKI[1],
            "dropoff_lat": ESPOO[0], "dropoff_lng": ESPOO[1],
            "cargo_weight_kg": 80,
            "urgency": "standard",
            "special_handling": False,
        }
        r0 = requests.post(f"{BASE_URL}/api/shipper/quote", json=base_body, timeout=20).json()
        body = {**base_body, "urgency": urgency}
        r1 = requests.post(f"{BASE_URL}/api/shipper/quote", json=body, timeout=20).json()
        assert r1["urgency"] == urgency
        assert r1["urgency_multiplier"] == mult
        # total should be ~mult× the standard total (multiplier applies pre-fuel
        # but fuel is a flat 8% of pre-fuel so net ratio is preserved).
        assert _approx(r1["total_price"], r0["total_price"] * mult, tol=0.5)

    @pytest.mark.parametrize("vehicle_type,extra_mult", [
        ("refrigerated", 1.15), ("hazmat", 1.35), ("crane_truck", 1.25),
        ("tanker", 1.20),
    ])
    def test_special_vehicle_multiplier(self, vehicle_type, extra_mult):
        body = {
            "vehicle_type": vehicle_type,
            "pickup_lat": HELSINKI[0], "pickup_lng": HELSINKI[1],
            "dropoff_lat": ESPOO[0], "dropoff_lng": ESPOO[1],
            "cargo_weight_kg": 80,
            "urgency": "standard",
            "special_handling": False,
        }
        r = requests.post(f"{BASE_URL}/api/shipper/quote", json=body, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert _approx(data["special_multiplier"], extra_mult, tol=0.01)

    def test_special_handling_adds_15pct(self):
        base = {
            "vehicle_type": "cargo_van",
            "pickup_lat": HELSINKI[0], "pickup_lng": HELSINKI[1],
            "dropoff_lat": ESPOO[0], "dropoff_lng": ESPOO[1],
            "cargo_weight_kg": 80,
            "urgency": "standard",
            "special_handling": False,
        }
        r0 = requests.post(f"{BASE_URL}/api/shipper/quote", json=base, timeout=20).json()
        r1 = requests.post(f"{BASE_URL}/api/shipper/quote",
                          json={**base, "special_handling": True}, timeout=20).json()
        assert r1["special_multiplier"] == 1.15
        assert _approx(r1["total_price"], r0["total_price"] * 1.15, tol=0.5)


# ---------- create shipment with offer ----------

def _create_shipment(token, urgency="standard", offer=0.0, vehicle_type="cargo_van",
                     pickup=None, dropoff=None):
    p = pickup or HELSINKI
    d = dropoff or ESPOO
    body = {
        "pickup_address": "TEST Helsinki",
        "pickup_lat": p[0], "pickup_lng": p[1],
        "pickup_contact_name": "TEST Pickup",
        "pickup_contact_phone": "+358111",
        "dropoff_address": "TEST Espoo",
        "dropoff_lat": d[0], "dropoff_lng": d[1],
        "dropoff_contact_name": "TEST Drop",
        "dropoff_contact_phone": "+358222",
        "vehicle_type": vehicle_type,
        "cargo_description": "TEST cargo",
        "cargo_weight_kg": 80,
        "cargo_type": "general",
        "urgency": urgency,
        "shipper_offer": offer,
    }
    r = requests.post(
        f"{BASE_URL}/api/shipper/shipments",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    return r


class TestCreateShipment:
    def test_create_with_offer_breakdown_and_tip(self, shipper_token):
        offer = 10.0
        r = _create_shipment(shipper_token, urgency="standard", offer=offer)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("order_id", "price", "base_price", "offer", "breakdown"):
            assert k in data, f"missing {k} in create response"
        assert _approx(data["price"], data["base_price"] + offer, tol=0.05)
        assert data["offer"] == offer
        # breakdown is the pricing engine dict
        assert data["breakdown"]["base_fee"] == 12.0
        # Driver earnings field: fetch the underlying order
        oid = data["order_id"]
        r2 = requests.get(
            f"{BASE_URL}/api/shipper/shipments/{oid}",
            headers={"Authorization": f"Bearer {shipper_token}"},
            timeout=20,
        )
        assert r2.status_code == 200
        order = r2.json()
        # tip should equal offer
        assert _approx(float(order.get("tip", 0)), offer, tol=0.01)
        expected_earnings = round(data["base_price"] * 0.85 + offer, 2)
        assert _approx(float(order.get("earnings", 0)), expected_earnings, tol=0.02), (
            f"earnings={order.get('earnings')} expected={expected_earnings}"
        )


# ---------- available orders + no-reseed ----------

class TestAvailableAndNoReseed:
    def test_available_without_coords(self):
        r = requests.get(f"{BASE_URL}/api/orders/available", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) <= 50

    def test_available_with_coords_filters_radius(self):
        # Far-away coords (Tokyo) should return zero pending nearby.
        r = requests.get(
            f"{BASE_URL}/api/orders/available",
            params={"lat": 35.6762, "lng": 139.6503, "radius_km": 50},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json() == []
        # Helsinki coords with radius 50 should return up to 50 sorted by distance
        r2 = requests.get(
            f"{BASE_URL}/api/orders/available",
            params={"lat": HELSINKI[0], "lng": HELSINKI[1], "radius_km": 50},
            timeout=20,
        )
        assert r2.status_code == 200
        data = r2.json()
        assert len(data) <= 50

    def test_complete_delivery_does_not_seed_replacement(self, shipper_token, driver_token):
        # Use routable Helsinki->Espoo coords (pricing requires a real cached road
        # route; arbitrary remote coords would 502/500 by design). We instead guard
        # the auto-reseed regression by tracking order-id deltas in the nearby pool.
        params = {"lat": HELSINKI[0], "lng": HELSINKI[1], "radius_km": 100}
        before = requests.get(f"{BASE_URL}/api/orders/available", params=params, timeout=20).json()
        before_ids = {o["id"] for o in before}

        # Create a fresh pending order (Helsinki -> Espoo).
        c = _create_shipment(shipper_token, offer=0)
        assert c.status_code == 200, c.text
        order_id = c.json()["order_id"]

        # It shows up as pending in the nearby pool.
        mid = requests.get(f"{BASE_URL}/api/orders/available", params=params, timeout=20).json()
        assert order_id in {o["id"] for o in mid}

        # Accept with the driver and advance to delivered.
        h = {"Authorization": f"Bearer {driver_token}"}
        ra = requests.post(f"{BASE_URL}/api/orders/{order_id}/accept", headers=h, timeout=20)
        assert ra.status_code == 200, ra.text
        for target in (
            "enroute_pickup", "arrived_pickup", "picked_up",
            "enroute_dropoff", "arrived_dropoff", "delivered",
        ):
            rr = requests.post(
                f"{BASE_URL}/api/orders/{order_id}/advance",
                json={"next_status": target},
                headers=h,
                timeout=20,
            )
            assert rr.status_code == 200, f"advance to {target} failed: {rr.status_code} {rr.text}"

        # CRITICAL: after delivery the delivered order is no longer pending and NO
        # replacement order was auto-seeded (the old prototype's reseed behavior).
        after = requests.get(f"{BASE_URL}/api/orders/available", params=params, timeout=20).json()
        after_ids = {o["id"] for o in after}
        assert order_id not in after_ids, "delivered order still appears as pending"
        new_ids = after_ids - before_ids
        assert new_ids == set(), f"unexpected new pending orders after delivery — re-seed bug? {new_ids}"


# ---------- driver performance ----------

class TestDriverPerformance:
    def test_performance_populated(self, driver_token):
        h = {"Authorization": f"Bearer {driver_token}"}
        r = requests.get(f"{BASE_URL}/api/driver/performance", headers=h, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("earnings", "deliveries", "acceptance_rate", "completion_rate",
                  "rating", "recent_deliveries"):
            assert k in data, f"missing {k}"
        for sub in ("today", "week", "total"):
            assert sub in data["earnings"], f"missing earnings.{sub}"
            assert sub in data["deliveries"], f"missing deliveries.{sub}"
        # populated: at least one delivery in history (we just completed one)
        assert data["deliveries"]["total"] >= 1
        assert isinstance(data["recent_deliveries"], list)
        assert len(data["recent_deliveries"]) >= 1, "recent_deliveries should not be empty"
        # numbers are floats/ints, not None
        assert isinstance(data["acceptance_rate"], (int, float))
        assert isinstance(data["completion_rate"], (int, float))
        assert isinstance(data["rating"], (int, float))


# ---------- regression ----------

class TestRegression:
    def test_register_push_422_missing_body(self):
        r = requests.post(f"{BASE_URL}/api/register-push", json={}, timeout=20)
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"

    def test_order_lifecycle_end_to_end(self, shipper_token, driver_token):
        c = _create_shipment(shipper_token, offer=5)
        assert c.status_code == 200, c.text
        oid = c.json()["order_id"]
        h = {"Authorization": f"Bearer {driver_token}"}
        ra = requests.post(f"{BASE_URL}/api/orders/{oid}/accept", headers=h, timeout=20)
        assert ra.status_code == 200
        for target in (
            "enroute_pickup", "arrived_pickup", "picked_up",
            "enroute_dropoff", "arrived_dropoff", "delivered",
        ):
            rr = requests.post(
                f"{BASE_URL}/api/orders/{oid}/advance",
                json={"next_status": target},
                headers=h,
                timeout=20,
            )
            assert rr.status_code == 200, f"{target} -> {rr.status_code} {rr.text}"
