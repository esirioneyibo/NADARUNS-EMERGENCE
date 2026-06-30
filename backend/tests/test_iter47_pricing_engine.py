"""Iteration 47 — Pricing console (Phase A) backend tests.

Coverage:
- Admin pricing GET / defaults / save (new version) / activate (rollback) / preview
- Engine correctness: weight bands, urgency, special vehicle, empty-run, fuel,
  min-price floor, supply/demand, route-match
- Live shipper quote uses the new engine and driver earnings == 85% of base
- Persistence reflected immediately after save & rollback
- Auth: admin pricing endpoints require admin auth
"""

import os
import copy
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
    "https://nadaruns-logistics.preview.emergentagent.com"

ADMIN_EMAIL = "admin@nadaruns.com"
ADMIN_PASSWORD = "admin123"
SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
SHIPPER_PASSWORD = "demo1234"
DRIVER_EMAIL = "demo.driver@nadaruns.com"
DRIVER_PASSWORD = "demo1234"


# ----------------------- Fixtures -----------------------
@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/admin-login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin-login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def shipper_token(s):
    r = s.post(f"{BASE_URL}/api/auth/shipper-login",
               json={"email": SHIPPER_EMAIL, "password": SHIPPER_PASSWORD}, timeout=15)
    if r.status_code != 200:
        # Try seeding then retry
        s.post(f"{BASE_URL}/api/seed-demo", timeout=30)
        r = s.post(f"{BASE_URL}/api/auth/shipper-login",
                   json={"email": SHIPPER_EMAIL, "password": SHIPPER_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"shipper-login failed: {r.text}"
    return r.json()["token"]


# ----------------------- AUTH guard -----------------------
class TestAuthGuard:
    def test_get_pricing_requires_auth(self, s):
        r = s.get(f"{BASE_URL}/api/admin/pricing", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_save_pricing_requires_auth(self, s):
        r = s.post(f"{BASE_URL}/api/admin/pricing",
                   json={"config": {"base_fees": {"cargo_van": 1}}, "note": "x"},
                   timeout=15)
        assert r.status_code in (401, 403)


# ----------------------- GET / Defaults -----------------------
class TestGetPricing:
    def test_get_active_pricing(self, s, admin_headers):
        r = s.get(f"{BASE_URL}/api/admin/pricing", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("active_version", "config", "versions", "vehicle_types"):
            assert k in body, f"missing key {k}"
        cfg = body["config"]
        # required engine keys present
        for k in ("base_fees", "km_rates", "weight_bands", "capacity_bands",
                  "urgency_multipliers", "fuel_pct", "commission"):
            assert k in cfg, f"config missing {k}"
        assert isinstance(body["versions"], list) and len(body["versions"]) >= 1
        # vehicle_types is a list of keys
        assert isinstance(body["vehicle_types"], list)
        assert "cargo_van" in body["vehicle_types"]

    def test_get_defaults(self, s, admin_headers):
        r = s.get(f"{BASE_URL}/api/admin/pricing/defaults", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        cfg = r.json()["config"]
        # Default contracts the playbook describes
        assert cfg["commission"]["driver_share"] == 0.85
        assert cfg["fuel_pct"] == 0.08
        assert "cargo_van" in cfg["base_fees"]
        # 5 weight bands
        assert len(cfg["weight_bands"]) >= 4


# ----------------------- POST save validation -----------------------
class TestSaveValidation:
    def test_save_rejects_empty_body(self, s, admin_headers):
        r = s.post(f"{BASE_URL}/api/admin/pricing", headers=admin_headers,
                   json={"note": "nope"}, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_save_rejects_config_without_base_fees(self, s, admin_headers):
        r = s.post(f"{BASE_URL}/api/admin/pricing", headers=admin_headers,
                   json={"config": {"km_rates": {}}, "note": "no base_fees"},
                   timeout=15)
        assert r.status_code == 400


# ----------------------- Engine correctness via preview -----------------------
def _preview(s, admin_headers, sample, config=None):
    body = {"sample": sample}
    if config:
        body["config"] = config
    r = s.post(f"{BASE_URL}/api/admin/pricing/preview", headers=admin_headers,
               json=body, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["quote"]


class TestEngineCorrectness:
    def test_preview_basic_shape(self, s, admin_headers):
        q = _preview(s, admin_headers,
                     {"vehicle_type": "cargo_van", "distance_km": 50, "cargo_weight_kg": 500})
        for k in ("total_price", "traditional_estimate", "savings",
                  "savings_pct", "breakdown_lines", "base_fee", "distance_fee"):
            assert k in q
        # breakdown line shape
        line = q["breakdown_lines"][0]
        for k in ("key", "label", "type", "amount", "detail"):
            assert k in line

    def test_empty_run_discount_creates_negative_line(self, s, admin_headers):
        q = _preview(s, admin_headers, {
            "vehicle_type": "cargo_van", "distance_km": 50,
            "cargo_weight_kg": 500, "empty_run_discount_pct": 0.25,
        })
        empties = [l for l in q["breakdown_lines"] if l["key"] == "empty_run"]
        assert empties, "empty_run line missing"
        assert empties[0]["amount"] < 0, f"empty_run should be negative, got {empties[0]['amount']}"
        assert empties[0]["type"] == "discount"

    def test_urgency_emergency_higher_than_standard(self, s, admin_headers):
        std = _preview(s, admin_headers,
                       {"vehicle_type": "cargo_van", "distance_km": 50,
                        "cargo_weight_kg": 500, "urgency": "standard"})
        emg = _preview(s, admin_headers,
                       {"vehicle_type": "cargo_van", "distance_km": 50,
                        "cargo_weight_kg": 500, "urgency": "emergency"})
        assert emg["total_price"] > std["total_price"]
        # urgency line should be present on emergency
        urg_lines = [l for l in emg["breakdown_lines"] if l["key"] == "urgency"]
        assert urg_lines and urg_lines[0]["amount"] > 0

    def test_refrigerated_special_vehicle_line(self, s, admin_headers):
        q = _preview(s, admin_headers,
                     {"vehicle_type": "refrigerated", "distance_km": 50,
                      "cargo_weight_kg": 500})
        sv = [l for l in q["breakdown_lines"] if l["key"] == "special_vehicle"]
        assert sv, "special_vehicle line missing for refrigerated"
        assert sv[0]["amount"] > 0

    def test_hazmat_special_vehicle_line_bigger(self, s, admin_headers):
        q = _preview(s, admin_headers,
                     {"vehicle_type": "hazmat", "distance_km": 50,
                      "cargo_weight_kg": 500})
        sv = [l for l in q["breakdown_lines"] if l["key"] == "special_vehicle"]
        assert sv and sv[0]["amount"] > 0

    def test_weight_band_heavy_vs_light(self, s, admin_headers):
        # Use semi_truck (high km/base) to ensure delta is significant
        light = _preview(s, admin_headers,
                         {"vehicle_type": "semi_truck", "distance_km": 100,
                          "cargo_weight_kg": 300})
        heavy = _preview(s, admin_headers,
                         {"vehicle_type": "semi_truck", "distance_km": 100,
                          "cargo_weight_kg": 20000})
        assert light["weight_category"] in ("Very Light", "Light")
        assert heavy["weight_category"] in ("Heavy", "Very Heavy")
        assert heavy["weight_adjustment_pct"] > light["weight_adjustment_pct"]
        assert heavy["total_price"] > light["total_price"]

    def test_min_price_floor_applies(self, s, admin_headers):
        q = _preview(s, admin_headers,
                     {"vehicle_type": "cargo_van", "distance_km": 0.1,
                      "cargo_weight_kg": 1})
        floor_lines = [l for l in q["breakdown_lines"] if l["key"] == "floor"]
        # When floor binds, a floor adjustment line appears
        assert floor_lines, "min_price_floor line missing for tiny distance"

    def test_fuel_line_always_present(self, s, admin_headers):
        q = _preview(s, admin_headers,
                     {"vehicle_type": "cargo_van", "distance_km": 50,
                      "cargo_weight_kg": 500})
        fuels = [l for l in q["breakdown_lines"] if l["key"] == "fuel"]
        assert fuels and fuels[0]["amount"] > 0

    def test_supply_demand_surge_line(self, s, admin_headers):
        q = _preview(s, admin_headers,
                     {"vehicle_type": "cargo_van", "distance_km": 50,
                      "cargo_weight_kg": 500, "supply_demand_pct": 0.20})
        sd = [l for l in q["breakdown_lines"] if l["key"] == "supply_demand"]
        assert sd and sd[0]["amount"] > 0

    def test_route_match_discount_negative(self, s, admin_headers):
        q = _preview(s, admin_headers,
                     {"vehicle_type": "cargo_van", "distance_km": 50,
                      "cargo_weight_kg": 500, "route_match_discount_pct": 0.30})
        rm = [l for l in q["breakdown_lines"] if l["key"] == "route_match"]
        assert rm and rm[0]["amount"] < 0

    def test_preview_does_not_persist(self, s, admin_headers):
        # version count before
        before = s.get(f"{BASE_URL}/api/admin/pricing", headers=admin_headers, timeout=15).json()
        _preview(s, admin_headers,
                 {"vehicle_type": "cargo_van", "distance_km": 10})
        after = s.get(f"{BASE_URL}/api/admin/pricing", headers=admin_headers, timeout=15).json()
        assert len(before["versions"]) == len(after["versions"]), \
            "preview must NOT create a new version"
        assert before["active_version"] == after["active_version"]


# ----------------------- Versioning: save + rollback -----------------------
class TestVersioning:
    """Save a new version, verify it becomes active, then rollback to v1."""

    def test_save_new_version_increments_and_activates(self, s, admin_headers):
        before = s.get(f"{BASE_URL}/api/admin/pricing", headers=admin_headers, timeout=15).json()
        before_versions = len(before["versions"])
        before_active = before["active_version"]

        # Clone default config and bump fuel_pct as a sentinel.
        defaults = s.get(f"{BASE_URL}/api/admin/pricing/defaults",
                         headers=admin_headers, timeout=15).json()["config"]
        new_cfg = copy.deepcopy(defaults)
        new_cfg["fuel_pct"] = 0.123  # sentinel
        new_cfg["base_fees"]["cargo_van"] = 19.99  # sentinel
        r = s.post(f"{BASE_URL}/api/admin/pricing", headers=admin_headers,
                   json={"config": new_cfg, "note": "iter47 test sentinel"}, timeout=20)
        assert r.status_code == 200, r.text
        saved = r.json()
        assert saved["saved"] is True
        new_version = saved["version"]
        assert new_version > (before_active or 0)

        after = s.get(f"{BASE_URL}/api/admin/pricing", headers=admin_headers, timeout=15).json()
        assert after["active_version"] == new_version
        assert len(after["versions"]) == before_versions + 1
        # The active config now reflects the sentinel
        assert abs(after["config"]["fuel_pct"] - 0.123) < 1e-9
        assert after["config"]["base_fees"]["cargo_van"] == 19.99

        # Previous version still in history & inactive
        v_records = {v["version"]: v for v in after["versions"]}
        for ver, doc in v_records.items():
            if ver == new_version:
                assert doc["active"] is True
            else:
                assert doc["active"] is False, f"v{ver} should be inactive"

        # Engine reflects the sentinel via preview immediately
        q = _preview(s, admin_headers,
                     {"vehicle_type": "cargo_van", "distance_km": 50,
                      "cargo_weight_kg": 100})
        fuels = [l for l in q["breakdown_lines"] if l["key"] == "fuel"]
        assert fuels and "+12.3%" in fuels[0]["detail"]

    def test_activate_unknown_version_404(self, s, admin_headers):
        r = s.post(f"{BASE_URL}/api/admin/pricing/activate/99999",
                   headers=admin_headers, timeout=15)
        assert r.status_code == 404

    def test_rollback_to_v1(self, s, admin_headers):
        r = s.post(f"{BASE_URL}/api/admin/pricing/activate/1",
                   headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["activated"] is True and body["version"] == 1

        after = s.get(f"{BASE_URL}/api/admin/pricing",
                      headers=admin_headers, timeout=15).json()
        assert after["active_version"] == 1
        # v1 sentinel: fuel_pct should be the default 0.08, cargo_van base 12.0
        assert after["config"]["fuel_pct"] == 0.08
        assert after["config"]["base_fees"]["cargo_van"] == 12.0


# ----------------------- Live shipper quote uses new engine -----------------------
class TestShipperQuoteUsesEngine:
    def test_shipper_quote_has_breakdown(self, s, shipper_token):
        h = {"Authorization": f"Bearer {shipper_token}",
             "Content-Type": "application/json"}
        payload = {
            "pickup_lat": 60.1699, "pickup_lng": 24.9384,
            "dropoff_lat": 60.4518, "dropoff_lng": 22.2666,
            "vehicle_type": "cargo_van",
            "cargo_weight_kg": 500,
            "urgency": "standard",
            "special_handling": False,
        }
        r = s.post(f"{BASE_URL}/api/shipper/quote", headers=h, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        q = r.json()
        # subtotal = base + distance (matches engine contract)
        assert abs((q["base_fee"] + q["distance_fee"]) - q["base_price"]) < 0.02
        assert q["total_price"] > 0
        assert q["distance_km"] > 0
        # vehicle type echoed
        assert q["vehicle_type"] == "cargo_van"

    def test_driver_share_85_in_active_config(self, s, admin_headers):
        cfg = s.get(f"{BASE_URL}/api/admin/pricing",
                    headers=admin_headers, timeout=15).json()["config"]
        assert cfg["commission"]["driver_share"] == 0.85
        assert cfg["commission"]["platform_share"] == 0.15
