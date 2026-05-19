"""Iteration 2: tests for PATCH /driver/me (settings) and GET /orders/{id}/route (directions)."""
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


# ----- Driver new fields shape -----
class TestDriverNewFields:
    def test_driver_has_new_fields(self, s):
        r = s.get(f"{API}/driver/me")
        assert r.status_code == 200
        d = r.json()
        # New fields
        for k in ("vehicle_type", "plate", "email", "phone", "notifications"):
            assert k in d, f"missing field: {k}"
        # Notifications nested shape
        for k in ("push", "sound", "new_orders", "earnings_summary"):
            assert k in d["notifications"], f"missing notifications.{k}"
            assert isinstance(d["notifications"][k], bool)
        # Seeded values present (post-migration)
        assert d["vehicle_type"] in ("bicycle", "scooter", "car", "motorbike")
        assert d["email"] != ""
        assert d["phone"] != ""
        assert d["plate"] != ""


# ----- PATCH /driver/me -----
class TestDriverPatch:
    def test_patch_name_only(self, s):
        original = s.get(f"{API}/driver/me").json()
        new_name = "TEST_Alex Lindqvist"
        r = s.patch(f"{API}/driver/me", json={"name": new_name})
        assert r.status_code == 200
        assert r.json()["name"] == new_name
        # Verify persistence via GET
        again = s.get(f"{API}/driver/me").json()
        assert again["name"] == new_name
        # Untouched fields stay
        assert again["email"] == original["email"]
        assert again["vehicle_type"] == original["vehicle_type"]
        # restore
        s.patch(f"{API}/driver/me", json={"name": original["name"]})

    def test_patch_vehicle_combo(self, s):
        original = s.get(f"{API}/driver/me").json()
        payload = {"vehicle_type": "car", "plate": "ABC-123", "vehicle": "Car • ABC-123"}
        r = s.patch(f"{API}/driver/me", json=payload)
        assert r.status_code == 200
        d = r.json()
        assert d["vehicle_type"] == "car"
        assert d["plate"] == "ABC-123"
        assert d["vehicle"] == "Car • ABC-123"
        # Verify persistence
        again = s.get(f"{API}/driver/me").json()
        assert again["vehicle_type"] == "car"
        assert again["plate"] == "ABC-123"
        # restore
        s.patch(f"{API}/driver/me", json={
            "vehicle_type": original["vehicle_type"],
            "plate": original["plate"],
            "vehicle": original["vehicle"],
        })

    def test_patch_notifications(self, s):
        original = s.get(f"{API}/driver/me").json()
        flipped = {k: not v for k, v in original["notifications"].items()}
        r = s.patch(f"{API}/driver/me", json={"notifications": flipped})
        assert r.status_code == 200
        assert r.json()["notifications"] == flipped
        # Verify persistence
        again = s.get(f"{API}/driver/me").json()
        assert again["notifications"] == flipped
        # restore
        s.patch(f"{API}/driver/me", json={"notifications": original["notifications"]})


# ----- Route / Directions -----
class TestRoute:
    def _get_any_order_id(self, s):
        # any existing order works; use a fresh pending
        s.post(f"{API}/orders/seed-new-pending")
        return s.get(f"{API}/orders/pending").json()["id"]

    def test_route_fallback_shape(self, s):
        oid = self._get_any_order_id(s)
        r = s.get(f"{API}/orders/{oid}/route")
        assert r.status_code == 200, r.text
        j = r.json()
        # Required fields
        for k in ("points", "distance_meters", "duration_seconds", "source"):
            assert k in j, f"missing {k}"
        assert isinstance(j["points"], list) and len(j["points"]) >= 2
        for p in j["points"]:
            assert "lat" in p and "lng" in p
            assert isinstance(p["lat"], (int, float))
            assert isinstance(p["lng"], (int, float))
        assert j["distance_meters"] > 0
        assert j["duration_seconds"] > 0
        # Since Google billing is disabled, source should be 'fallback'
        assert j["source"] in ("fallback", "google")
        if j["source"] == "fallback":
            assert len(j["points"]) == 2  # pickup + dropoff straight line

    def test_route_idempotent_cache(self, s):
        oid = self._get_any_order_id(s)
        r1 = s.get(f"{API}/orders/{oid}/route").json()
        r2 = s.get(f"{API}/orders/{oid}/route").json()
        # Should be byte-identical structure (cached)
        assert r1 == r2
        assert r1["source"] == r2["source"]

    def test_route_404_for_unknown_order(self, s):
        r = s.get(f"{API}/orders/nonexistent-id/route")
        assert r.status_code == 404
