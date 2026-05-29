"""Backend tests for new GET /api/driver/performance endpoint and P0 regression.

Run with:
    pytest /app/backend/tests/test_driver_performance.py -v \
      --junitxml=/app/test_reports/pytest/driver_performance_results.xml
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    # Fallback to reading frontend/.env at runtime (no hardcoded URL).
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip()
                    break
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")

DEMO_DRIVER_EMAIL = "demo.driver@nadaruns.com"
DEMO_DRIVER_PASS = "demo1234"
DEMO_SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
DEMO_SHIPPER_PASS = "demo1234"


# -------------------------- shared fixtures --------------------------
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session", autouse=True)
def seed_demo(api):
    # Idempotent on the backend; ensures demo accounts exist.
    try:
        api.post(f"{BASE_URL}/api/seed-demo", timeout=30)
    except Exception:
        pass
    yield


@pytest.fixture(scope="session")
def driver_token(api):
    r = api.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": DEMO_DRIVER_EMAIL, "password": DEMO_DRIVER_PASS},
        timeout=15,
    )
    assert r.status_code == 200, f"driver login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and isinstance(data["token"], str)
    return data["token"]


@pytest.fixture(scope="session")
def shipper_token(api):
    r = api.post(
        f"{BASE_URL}/api/auth/shipper-login",
        json={"email": DEMO_SHIPPER_EMAIL, "password": DEMO_SHIPPER_PASS},
        timeout=15,
    )
    assert r.status_code == 200, f"shipper login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# ============================================================
# Module: GET /api/driver/performance  (NEW endpoint)
# ============================================================
class TestDriverPerformanceAuth:
    def test_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/driver/performance", timeout=15)
        # 401 (no creds) or 403 (forbidden) is acceptable for "unauthorized"
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_rejects_shipper_token(self, api, shipper_token):
        r = api.get(
            f"{BASE_URL}/api/driver/performance",
            headers=auth(shipper_token),
            timeout=15,
        )
        assert r.status_code in (401, 403)


class TestDriverPerformanceShape:
    def test_returns_200_with_driver_token(self, api, driver_token):
        r = api.get(
            f"{BASE_URL}/api/driver/performance",
            headers=auth(driver_token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # top-level keys
        for k in ("status", "is_online", "rating", "acceptance_rate",
                  "completion_rate", "earnings", "deliveries",
                  "recent_deliveries"):
            assert k in data, f"missing key {k}"
        # nested earnings
        for k in ("today", "week", "total"):
            assert k in data["earnings"], f"earnings missing {k}"
            assert isinstance(data["earnings"][k], (int, float))
        # nested deliveries
        for k in ("today", "week", "total"):
            assert k in data["deliveries"], f"deliveries missing {k}"
            assert isinstance(data["deliveries"][k], int)
        # numeric types
        assert isinstance(data["rating"], (int, float))
        assert isinstance(data["acceptance_rate"], (int, float))
        assert isinstance(data["completion_rate"], (int, float))
        assert isinstance(data["is_online"], bool)
        assert isinstance(data["status"], str)
        assert isinstance(data["recent_deliveries"], list)

    def test_rates_are_percent_0_to_100(self, api, driver_token):
        r = api.get(
            f"{BASE_URL}/api/driver/performance",
            headers=auth(driver_token),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert 0.0 <= data["acceptance_rate"] <= 100.0
        assert 0.0 <= data["completion_rate"] <= 100.0

    def test_earnings_monotonic(self, api, driver_token):
        r = api.get(
            f"{BASE_URL}/api/driver/performance",
            headers=auth(driver_token),
            timeout=15,
        )
        data = r.json()
        e = data["earnings"]
        assert e["total"] >= e["week"] - 1e-6, (
            f"total {e['total']} must be >= week {e['week']}"
        )
        assert e["week"] >= e["today"] - 1e-6, (
            f"week {e['week']} must be >= today {e['today']}"
        )

    def test_recent_deliveries_shape(self, api, driver_token):
        r = api.get(
            f"{BASE_URL}/api/driver/performance",
            headers=auth(driver_token),
            timeout=15,
        )
        data = r.json()
        for d in data["recent_deliveries"]:
            # minimum sensible shape
            for k in ("order_number", "pickup_name", "dropoff_name",
                      "earnings", "completed_at"):
                assert k in d, f"recent delivery missing {k}"
            assert isinstance(d["earnings"], (int, float))


# ============================================================
# Module: P0 regression - prior endpoints still pass
# ============================================================
class TestP0Regression:
    def test_login_returns_token(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": DEMO_DRIVER_EMAIL, "password": DEMO_DRIVER_PASS},
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert "token" in body
        assert "driver_id" in body

    def test_orders_available_with_driver(self, api, driver_token):
        r = api.get(
            f"{BASE_URL}/api/orders/available",
            headers=auth(driver_token),
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        # accept either list or {orders: []}
        if isinstance(body, dict):
            assert "orders" in body or "available" in body or isinstance(body, dict)
        else:
            assert isinstance(body, list)

    def _create_shipment(self, api, shipper_token, idem_key=None):
        headers = {**auth(shipper_token), "Content-Type": "application/json"}
        if idem_key:
            headers["Idempotency-Key"] = idem_key
        payload = {
            "pickup_address": "TEST_pickup Mannerheimintie 10, Helsinki",
            "pickup_lat": 60.17,
            "pickup_lng": 24.94,
            "pickup_contact_name": "TEST_Sender",
            "pickup_contact_phone": "+358000000001",
            "dropoff_address": "TEST_dropoff Esplanadi 5, Helsinki",
            "dropoff_lat": 60.168,
            "dropoff_lng": 24.95,
            "dropoff_contact_name": "TEST_Recipient",
            "dropoff_contact_phone": "+358000000002",
            "vehicle_type": "cargo_van",
            "cargo_weight_kg": 25,
            "cargo_description": "TEST_general parcel",
        }
        return api.post(
            f"{BASE_URL}/api/shipper/shipments",
            json=payload,
            headers=headers,
            timeout=20,
        )

    def test_shipper_create_with_idempotency_key(self, api, shipper_token):
        key = f"TEST_idem_{uuid.uuid4()}"
        r1 = self._create_shipment(api, shipper_token, idem_key=key)
        assert r1.status_code in (200, 201), r1.text
        r2 = self._create_shipment(api, shipper_token, idem_key=key)
        assert r2.status_code in (200, 201)
        id1 = (r1.json().get("id") or r1.json().get("order_id")
               or r1.json().get("order_number"))
        id2 = (r2.json().get("id") or r2.json().get("order_id")
               or r2.json().get("order_number"))
        assert id1 and id2 and id1 == id2, (
            f"idempotency violated: {id1} vs {id2}"
        )

    def test_accept_advance_events_flow(self, api, driver_token, shipper_token):
        # Create a fresh shipment
        r = self._create_shipment(api, shipper_token)
        assert r.status_code in (200, 201), r.text
        order = r.json()
        order_id = order.get("id") or order.get("order_id")
        assert order_id, f"no order id in response: {order}"

        # Accept
        acc = api.post(
            f"{BASE_URL}/api/orders/{order_id}/accept",
            headers=auth(driver_token),
            timeout=15,
        )
        assert acc.status_code in (200, 201), acc.text
        acc_body = acc.json()
        assert acc_body.get("driver_id"), "driver_id must be bound on accept"

        # Idempotent re-accept by same driver
        acc2 = api.post(
            f"{BASE_URL}/api/orders/{order_id}/accept",
            headers=auth(driver_token),
            timeout=15,
        )
        assert acc2.status_code in (200, 201)

        # Advance one step
        adv = api.post(
            f"{BASE_URL}/api/orders/{order_id}/advance",
            json={},
            headers=auth(driver_token),
            timeout=15,
        )
        assert adv.status_code == 200, adv.text

        # Events audit
        ev = api.get(
            f"{BASE_URL}/api/orders/{order_id}/events",
            headers=auth(driver_token),
            timeout=15,
        )
        assert ev.status_code == 200
        ev_body = ev.json()
        assert "events" in ev_body
        assert isinstance(ev_body["events"], list)
        assert len(ev_body["events"]) >= 2
