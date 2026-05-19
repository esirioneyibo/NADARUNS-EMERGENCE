"""Backend API tests for driver delivery app."""
import os
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://delivery-ui-kit-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ----- Driver -----
class TestDriver:
    def test_get_driver(self, s):
        r = s.get(f"{API}/driver/me", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == "Alex Lindqvist"
        assert d["rating"] == 4.92
        assert d["id"] == "driver-001"
        assert "_id" not in d

    def test_toggle_online_flips(self, s):
        d1 = s.get(f"{API}/driver/me").json()
        initial = d1["is_online"]
        d2 = s.post(f"{API}/driver/toggle-online").json()
        assert d2["is_online"] != initial
        # restore
        d3 = s.post(f"{API}/driver/toggle-online").json()
        assert d3["is_online"] == initial


# ----- Pending -----
class TestPending:
    def test_pending_order_full_shape(self, s):
        # ensure there is a pending one
        s.post(f"{API}/orders/seed-new-pending")
        r = s.get(f"{API}/orders/pending")
        assert r.status_code == 200
        o = r.json()
        assert o is not None
        for k in ["id", "order_number", "status", "pickup", "dropoff", "customer",
                  "items", "distance_km", "eta_minutes", "earnings", "tip"]:
            assert k in o, f"missing {k}"
        assert o["status"] == "pending"
        assert o["pickup"]["address"] and o["pickup"]["name"]
        assert o["dropoff"]["address"]
        assert o["customer"]["name"] and o["customer"]["rating"]
        assert len(o["items"]) >= 1
        assert "_id" not in o


# ----- History -----
class TestHistory:
    def test_history_min_8(self, s):
        r = s.get(f"{API}/orders/history")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 6  # seeds 8 if <6
        for o in items:
            assert o["status"] == "delivered"
            assert o["completed_at"] is not None
            assert "_id" not in o


# ----- Lifecycle -----
class TestLifecycle:
    def test_accept_advance_complete(self, s):
        # Get pending
        s.post(f"{API}/orders/seed-new-pending")
        pending = s.get(f"{API}/orders/pending").json()
        oid = pending["id"]
        earn = pending["earnings"] + pending.get("tip", 0)

        driver_before = s.get(f"{API}/driver/me").json()

        # Accept
        a = s.post(f"{API}/orders/{oid}/accept").json()
        assert a["status"] == "accepted"

        # Walk through statuses
        expected = ["enroute_pickup", "arrived_pickup", "picked_up",
                    "enroute_dropoff", "arrived_dropoff", "delivered"]
        for st in expected:
            r = s.post(f"{API}/orders/{oid}/advance", json={})
            assert r.status_code == 200, r.text
            assert r.json()["status"] == st

        # Verify completed_at set
        final = s.post(f"{API}/orders/{oid}/advance", json={})
        # should fail to advance past delivered
        assert final.status_code == 400

        # Driver earnings increment
        driver_after = s.get(f"{API}/driver/me").json()
        assert driver_after["deliveries_today"] == driver_before["deliveries_today"] + 1
        assert round(driver_after["earnings_today"] - driver_before["earnings_today"], 2) == round(earn, 2)

        # New pending was auto-seeded
        new_pending = s.get(f"{API}/orders/pending").json()
        assert new_pending is not None
        assert new_pending["id"] != oid

    def test_reject_creates_new_pending(self, s):
        s.post(f"{API}/orders/seed-new-pending")
        old = s.get(f"{API}/orders/pending").json()
        r = s.post(f"{API}/orders/{old['id']}/reject")
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"
        new = s.get(f"{API}/orders/pending").json()
        assert new is not None
        assert new["id"] != old["id"]

    def test_rate_after_delivery(self, s):
        # set up and deliver one
        s.post(f"{API}/orders/seed-new-pending")
        p = s.get(f"{API}/orders/pending").json()
        oid = p["id"]
        s.post(f"{API}/orders/{oid}/accept")
        for _ in range(6):
            s.post(f"{API}/orders/{oid}/advance", json={})
        r = s.post(f"{API}/orders/{oid}/rate", json={"rating": 1, "feedback": "Great!"})
        assert r.status_code == 200
        j = r.json()
        assert j["rating_given"] == 1
        assert j["feedback"] == "Great!"


# ----- Error handling -----
class TestErrors:
    def test_accept_nonexistent(self, s):
        r = s.post(f"{API}/orders/nonexistent-id/accept")
        assert r.status_code == 404

    def test_advance_nonexistent(self, s):
        r = s.post(f"{API}/orders/nonexistent-id/advance", json={})
        assert r.status_code == 404
