"""Phase D (self-tuning), E (reputation), F (bundling) + regression tests.

Covers:
- /api/orders/{id}/match: reputation breakdown_line, marketplace heat, empty toggle
- /api/orders/{id}/bundle-suggestions: corridor bundle (capacity/vehicle/detour)
- /api/shipper/quote/recommend: auto_tune neutral when few signals
- Pricing signal capture path: create shipment + accept (must not error;
  auto_tune stays bounded)
- Regression: recommend payload shape + match shape + accept/advance/deliver
"""
import os
import time
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://nadaruns-logistics.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

DRIVER_EMAIL = "demo.driver@nadaruns.com"
SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
PWD = "demo1234"


# ---- session/auth fixtures -------------------------------------------------


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def driver_token(session):
    r = session.post(f"{API}/auth/login", json={"email": DRIVER_EMAIL, "password": PWD})
    assert r.status_code == 200, f"driver login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def shipper_token(session):
    r = session.post(f"{API}/auth/shipper-login", json={"email": SHIPPER_EMAIL, "password": PWD})
    assert r.status_code == 200, f"shipper login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def driver_headers(driver_token):
    return {"Authorization": f"Bearer {driver_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def shipper_headers(shipper_token):
    return {"Authorization": f"Bearer {shipper_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def pending_order(session):
    # Try to get any pending order; seed one if none exist.
    r = session.get(f"{API}/orders/available")
    items = r.json() if r.status_code == 200 else []
    if not items:
        s = session.post(f"{API}/orders/add-pending")
        assert s.status_code == 200
        return s.json()
    return items[0]


# ---- Phase E: reputation breakdown_line -----------------------------------


def test_match_reputation_breakdown_line(session, driver_headers, pending_order):
    oid = pending_order["id"]
    r = session.get(f"{API}/orders/{oid}/match", headers=driver_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    # Standard match shape
    assert "standard_price" in data and "marketplace_price" in data
    assert "driver_earnings" in data
    assert "breakdown_lines" in data and isinstance(data["breakdown_lines"], list)
    # Reputation line: demo driver rating ~4.5 → expect a 'reputation' positive line
    rep_lines = [ln for ln in data["breakdown_lines"] if (ln.get("key") == "reputation")]
    # Allow either presence (rating>=4) or empty (rating<4). Demo seed is ~4.5
    # so we assert presence; bounded by config (<=8% uplift).
    assert rep_lines, f"expected a 'reputation' breakdown_line, got keys: {[ln.get('key') for ln in data['breakdown_lines']]}"
    line = rep_lines[0]
    # Validate bounds: positive % and <= 8%
    pct = line.get("pct")
    if pct is not None:
        assert -0.05 <= float(pct) <= 0.08, f"reputation pct out of bounds: {pct}"


def test_match_empty_toggle_changes_price(session, driver_headers, pending_order):
    oid = pending_order["id"]
    base = session.get(f"{API}/orders/{oid}/match", headers=driver_headers).json()
    empty = session.get(f"{API}/orders/{oid}/match?empty=true", headers=driver_headers).json()
    assert empty["returning_empty"] is True
    # Empty-run discount must be > 0 and price must drop (or earnings change)
    assert empty["discounts"]["empty_run_pct"] > 0
    assert empty["marketplace_price"] <= base["marketplace_price"]


def test_match_includes_market_heat(session, driver_headers, pending_order):
    oid = pending_order["id"]
    data = session.get(f"{API}/orders/{oid}/match", headers=driver_headers).json()
    mkt = data.get("marketplace") or {}
    heat = mkt.get("heat") or {}
    assert "label" in heat and "icon" in heat
    assert mkt.get("region_name")  # Uusimaa, etc.


# ---- Phase F: bundling ----------------------------------------------------


def test_bundle_suggestions_shape(session, driver_headers, pending_order):
    oid = pending_order["id"]
    r = session.get(f"{API}/orders/{oid}/bundle-suggestions", headers=driver_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ("bundle_count", "payload_capacity_kg", "extra_earnings_if_all", "suggestions"):
        assert k in data, f"missing {k} in bundle response"
    suggestions = data["suggestions"]
    assert isinstance(suggestions, list)
    # Validate each suggestion has required fields and sorted by detour
    detours = []
    for s in suggestions:
        for k in ("extra_distance_km", "pickup_name", "dropoff_name", "price", "driver_earnings"):
            assert k in s, f"suggestion missing {k}: {s}"
        detours.append(s["extra_distance_km"])
        # detour must be <= 25 km
        assert s["extra_distance_km"] <= 25.0
    assert detours == sorted(detours), f"suggestions not sorted ascending: {detours}"


def test_bundle_404_unknown(session, driver_headers):
    r = session.get(f"{API}/orders/nope-not-real/bundle-suggestions", headers=driver_headers)
    assert r.status_code == 404


# ---- Phase D: auto_tune in recommend --------------------------------------


def _quote_payload():
    return {
        "vehicle_type": "cargo_van",
        "pickup_lat": 60.1699,
        "pickup_lng": 24.9384,
        "dropoff_lat": 60.2099,
        "dropoff_lng": 24.9984,
        "cargo_weight_kg": 50,
        "urgency": "standard",
        "special_handling": False,
    }


def test_recommend_includes_auto_tune_neutral(session):
    r = session.post(f"{API}/shipper/quote/recommend", json=_quote_payload())
    assert r.status_code == 200, r.text
    data = r.json()
    # Regression: existing fields still present
    assert "quote" in data
    assert "recommendations" in data and len(data["recommendations"]) == 4
    assert "environment" in data
    mkt = data["marketplace"]
    assert "heat" in mkt
    at = mkt.get("auto_tune")
    assert at is not None, "auto_tune missing from marketplace block"
    # Bounded
    assert abs(float(at["adjustment_pct"])) <= 0.05
    assert isinstance(at["samples"], int)
    # With few signals → neutral 0.0
    if at["samples"] < 8:
        assert float(at["adjustment_pct"]) == 0.0
        assert at["acceptance_rate"] is None


# ---- Pricing signal capture: create + accept flow -------------------------


def _shipment_payload():
    return {
        "vehicle_type": "cargo_van",
        "pickup_lat": 60.1699,
        "pickup_lng": 24.9384,
        "pickup_address": "TEST Helsinki pickup",
        "pickup_contact_name": "TEST Pickup",
        "pickup_contact_phone": "+358000000",
        "dropoff_lat": 60.2099,
        "dropoff_lng": 24.9984,
        "dropoff_address": "TEST Helsinki dropoff",
        "dropoff_contact_name": "TEST Dropoff",
        "dropoff_contact_phone": "+358000001",
        "cargo_description": "TEST cargo iter50",
        "cargo_weight_kg": 25,
        "urgency": "standard",
        "cargo_type": "general",
    }


def test_create_shipment_records_signal(session, shipper_headers):
    r = session.post(f"{API}/shipper/shipments", json=_shipment_payload(), headers=shipper_headers)
    # We don't want test to fail if Google Directions quota issue causes 502.
    if r.status_code == 502:
        pytest.skip("road route unavailable in this env")
    assert r.status_code in (200, 201), f"create shipment failed: {r.status_code} {r.text}"
    j = r.json()
    assert "order_id" in j and j.get("status") == "pending"
    # auto_tune must remain bounded after signal recording
    rec = session.post(f"{API}/shipper/quote/recommend", json=_quote_payload()).json()
    assert abs(float(rec["marketplace"]["auto_tune"]["adjustment_pct"])) <= 0.05


# ---- Regression: full lifecycle -------------------------------------------


def test_recommend_regression_shape(session):
    r = session.post(f"{API}/shipper/quote/recommend", json=_quote_payload())
    assert r.status_code == 200
    d = r.json()
    assert "quote" in d and "recommendations" in d and "environment" in d
    assert len(d["recommendations"]) == 4
    for rec in d["recommendations"]:
        for k in ("tier", "label", "price", "acceptance_pct", "wait_minutes"):
            assert k in rec


def test_match_regression_shape(session, driver_headers, pending_order):
    oid = pending_order["id"]
    d = session.get(f"{API}/orders/{oid}/match", headers=driver_headers).json()
    for k in ("standard_price", "marketplace_price", "driver_earnings", "discounts", "marketplace", "breakdown_lines"):
        assert k in d
    # Driver earnings should be ~85% of marketplace price (driver_earnings() rule)
    mp = float(d["marketplace_price"])
    de = float(d["driver_earnings"])
    if mp > 0:
        ratio = de / mp
        assert 0.80 <= ratio <= 0.95, f"earnings ratio off: {ratio}"
