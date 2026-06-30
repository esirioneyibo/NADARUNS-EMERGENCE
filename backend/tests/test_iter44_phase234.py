"""Iteration 44 — Phase 2 (ETA tracking), Phase 3 (ratings + disputes) tests."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nadaruns-logistics.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# -----------------------------------------------------------------------------
# Session-scoped fixtures: log in all 3 actors + ensure demo data exists.
# -----------------------------------------------------------------------------
@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # Idempotent demo seed.
    s.post(f"{API}/seed-demo", timeout=20)
    return s


@pytest.fixture(scope="session")
def admin_token(http):
    r = http.post(f"{API}/auth/admin-login",
                  json={"email": "admin@nadaruns.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def shipper_token(http):
    r = http.post(f"{API}/auth/shipper-login",
                  json={"email": "demo.shipper@nadaruns.com", "password": "demo1234"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def driver_token(http):
    r = http.post(f"{API}/auth/login",
                  json={"email": "demo.driver@nadaruns.com", "password": "demo1234"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def driver_id(http, driver_token):
    r = http.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {driver_token}"}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# -----------------------------------------------------------------------------
# Helper: create a shipment and advance it to a chosen status.
# -----------------------------------------------------------------------------
def _create_shipment(http, shipper_token, desc="TEST_iter44 disp"):
    body = {
        "pickup_address": "Helsinki Central", "pickup_lat": 60.1699, "pickup_lng": 24.9384,
        "pickup_contact_name": "P", "pickup_contact_phone": "+358401111111",
        "dropoff_address": "Tampere Square", "dropoff_lat": 61.4978, "dropoff_lng": 23.7610,
        "dropoff_contact_name": "D", "dropoff_contact_phone": "+358402222222",
        "cargo_description": desc, "cargo_weight_kg": 50, "cargo_type": "general",
        "vehicle_type": "cargo_van", "urgency": "standard",
    }
    r = http.post(f"{API}/shipper/shipments", json=body, headers=_h(shipper_token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["order_id"]


def _set_order(http, admin_token, order_id, fields):
    """Backdoor: use admin assign or direct status -- here we use payment helpers
    and update via the admin DB endpoints if available; otherwise rely on driver
    flow."""
    # No direct admin patch endpoint -- caller must use driver flow.
    raise NotImplementedError


# -----------------------------------------------------------------------------
# Phase 2 — Driver location + ETA
# -----------------------------------------------------------------------------
class TestPhase2ETA:
    """Driver-location ETA endpoint and shipper tracking ETA."""

    def test_driver_post_location(self, http, driver_token):
        r = http.post(f"{API}/driver/location",
                      json={"lat": 60.20, "lng": 24.95},
                      headers=_h(driver_token), timeout=10)
        assert r.status_code in (200, 201), r.text

    def test_driver_location_for_pending_order_returns_null_target_no_500(self, http, shipper_token, driver_token):
        oid = _create_shipment(http, shipper_token, desc="TEST_iter44 eta-pending")
        # Order has no driver assigned. Endpoint should never 500.
        r = http.get(f"{API}/orders/{oid}/driver-location", headers=_h(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("driver_location") is None
        # When no driver yet, message is returned
        assert "message" in body or body.get("driver_id") is None

    def test_driver_location_after_accept_returns_eta(self, http, shipper_token, driver_token):
        # Create a fresh order, driver accepts, then check ETA.
        oid = _create_shipment(http, shipper_token, desc="TEST_iter44 eta-active")
        # Update driver location first
        http.post(f"{API}/driver/location", json={"lat": 60.20, "lng": 24.95},
                  headers=_h(driver_token), timeout=10)
        # Driver accepts
        acc = http.post(f"{API}/orders/{oid}/accept", headers=_h(driver_token), timeout=15)
        if acc.status_code == 403:
            pytest.skip(f"Driver KYC required: {acc.text}")
        assert acc.status_code in (200, 409), acc.text
        # GET driver-location with ETA
        r = http.get(f"{API}/orders/{oid}/driver-location", headers=_h(driver_token), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("driver_id"), body
        assert body.get("driver_location") is not None
        # Per problem statement: eta_minutes, remaining_km, target, off_route always present (never 500)
        assert "eta_minutes" in body
        assert "remaining_km" in body
        assert "target" in body
        assert "off_route" in body
        # ETA should be a sensible non-negative number OR null (if no target)
        if body.get("target") is not None:
            assert body["target"] in ("pickup", "dropoff")
            assert body["eta_minutes"] is None or body["eta_minutes"] >= 0
            assert body["remaining_km"] is None or body["remaining_km"] >= 0

    def test_shipper_tracking_active_order(self, http, shipper_token, driver_token):
        """Shipper tracking returns full payload for active shipments."""
        oid = _create_shipment(http, shipper_token, desc="TEST_iter44 tracking")
        http.post(f"{API}/driver/location", json={"lat": 60.30, "lng": 24.85},
                  headers=_h(driver_token), timeout=10)
        acc = http.post(f"{API}/orders/{oid}/accept", headers=_h(driver_token), timeout=15)
        if acc.status_code == 403:
            pytest.skip(f"Driver KYC required: {acc.text}")
        # Advance to enroute_pickup so it is "active"
        http.post(f"{API}/orders/{oid}/advance", json={"next_status": "enroute_pickup"},
                  headers=_h(driver_token), timeout=15)

        r = http.get(f"{API}/shipper/shipments/{oid}/tracking",
                     headers=_h(shipper_token), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("status", "pickup", "dropoff", "driver", "driver_location",
                  "eta_minutes", "remaining_km", "target"):
            assert k in body, f"Missing {k} in tracking response: {list(body.keys())}"
        assert body["status"] in ("enroute_pickup", "accepted")
        # active shipment must have driver_location + target object
        if body["status"] == "enroute_pickup":
            assert body["driver"] is not None
            assert body["target"] is not None
            assert "lat" in body["target"] and "lng" in body["target"]


# -----------------------------------------------------------------------------
# Phase 3 — Shipper -> driver rating + disputes
# -----------------------------------------------------------------------------
class TestPhase3RateDriver:
    """POST /api/shipper/shipments/{order_id}/rate-driver"""

    @pytest.fixture(scope="class")
    def delivered_order_id(self, http, shipper_token, driver_token):
        """Drive a fresh order through to delivered for rating tests."""
        oid = _create_shipment(http, shipper_token, desc="TEST_iter44 deliver-for-rating")
        acc = http.post(f"{API}/orders/{oid}/accept", headers=_h(driver_token), timeout=15)
        if acc.status_code == 403:
            pytest.skip(f"Driver KYC required: {acc.text}")
        for nxt in ("enroute_pickup", "arrived_pickup", "picked_up",
                    "enroute_dropoff", "arrived_dropoff", "delivered"):
            r = http.post(f"{API}/orders/{oid}/advance",
                          json={"next_status": nxt}, headers=_h(driver_token), timeout=15)
            assert r.status_code == 200, f"advance->{nxt}: {r.status_code} {r.text}"
        return oid

    def test_rate_driver_success(self, http, shipper_token, delivered_order_id):
        r = http.post(f"{API}/shipper/shipments/{delivered_order_id}/rate-driver",
                      json={"rating": 5, "review": "Great driver"},
                      headers=_h(shipper_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("success") is True
        assert body["driver_rating"] == 5
        assert body["driver_review"] == "Great driver"
        assert "driver_average_rating" in body
        assert isinstance(body["driver_average_rating"], (int, float))

    def test_rate_driver_one_time(self, http, shipper_token, delivered_order_id):
        r = http.post(f"{API}/shipper/shipments/{delivered_order_id}/rate-driver",
                      json={"rating": 4}, headers=_h(shipper_token), timeout=15)
        assert r.status_code == 400, r.text

    def test_rate_driver_out_of_range(self, http, shipper_token):
        # Use any order owned by shipper -- doesn't even need to be delivered, range check is first
        # Actually: looking at code, range check (1<=r<=5) comes BEFORE order lookup -> using a random id is OK
        fake = str(uuid.uuid4())
        r = http.post(f"{API}/shipper/shipments/{fake}/rate-driver",
                      json={"rating": 7}, headers=_h(shipper_token), timeout=10)
        assert r.status_code == 400, r.text

    def test_rate_driver_non_owner_403(self, http, driver_token, delivered_order_id):
        """Driver token cannot rate-driver on shipper endpoint -> 403."""
        r = http.post(f"{API}/shipper/shipments/{delivered_order_id}/rate-driver",
                      json={"rating": 5}, headers=_h(driver_token), timeout=10)
        assert r.status_code == 403, r.text


class TestPhase3Dispute:
    """POST /api/shipper/shipments/{order_id}/dispute"""

    @pytest.fixture(scope="class")
    def in_transit_order_id(self, http, shipper_token, driver_token):
        oid = _create_shipment(http, shipper_token, desc="TEST_iter44 dispute-in-transit")
        acc = http.post(f"{API}/orders/{oid}/accept", headers=_h(driver_token), timeout=15)
        if acc.status_code == 403:
            pytest.skip(f"Driver KYC required: {acc.text}")
        # advance to picked_up so dispute is allowed
        for nxt in ("enroute_pickup", "arrived_pickup", "picked_up"):
            r = http.post(f"{API}/orders/{oid}/advance",
                          json={"next_status": nxt}, headers=_h(driver_token), timeout=15)
            assert r.status_code == 200, r.text
        return oid

    def test_dispute_open_success(self, http, shipper_token, in_transit_order_id):
        r = http.post(f"{API}/shipper/shipments/{in_transit_order_id}/dispute",
                      json={"reason": "damaged_cargo", "description": "Boxes were dented"},
                      headers=_h(shipper_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "open"
        assert body["reason"] == "damaged_cargo"
        assert body["order_id"] == in_transit_order_id
        # verify order.has_dispute = True
        det = http.get(f"{API}/shipper/shipments/{in_transit_order_id}",
                       headers=_h(shipper_token), timeout=10)
        assert det.status_code == 200
        assert det.json().get("has_dispute") is True

    def test_dispute_duplicate_400(self, http, shipper_token, in_transit_order_id):
        r = http.post(f"{API}/shipper/shipments/{in_transit_order_id}/dispute",
                      json={"reason": "again"}, headers=_h(shipper_token), timeout=10)
        assert r.status_code == 400, r.text

    def test_dispute_missing_reason_400(self, http, shipper_token):
        oid = _create_shipment(http, shipper_token, desc="TEST_iter44 dispute-no-reason")
        r = http.post(f"{API}/shipper/shipments/{oid}/dispute",
                      json={"reason": "", "description": "x"},
                      headers=_h(shipper_token), timeout=10)
        # status not in allowed set OR empty reason -> 400 either way
        assert r.status_code == 400, r.text

    def test_dispute_non_owner_403(self, http, driver_token, in_transit_order_id):
        r = http.post(f"{API}/shipper/shipments/{in_transit_order_id}/dispute",
                      json={"reason": "x"}, headers=_h(driver_token), timeout=10)
        assert r.status_code == 403, r.text

    def test_dispute_wrong_status_400(self, http, shipper_token):
        """Cannot open dispute on pending order (no driver yet)."""
        oid = _create_shipment(http, shipper_token, desc="TEST_iter44 dispute-pending")
        r = http.post(f"{API}/shipper/shipments/{oid}/dispute",
                      json={"reason": "x"}, headers=_h(shipper_token), timeout=10)
        assert r.status_code == 400, r.text


class TestPhase3AdminDisputes:
    """GET /api/admin/disputes + POST /api/admin/disputes/{id}/resolve"""

    def test_admin_list_disputes(self, http, admin_token):
        r = http.get(f"{API}/admin/disputes", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        for d in rows[:5]:
            assert "id" in d and "order_id" in d and "status" in d
            # POP/POD attached
            assert "pickup_photo" in d
            assert "delivery_photo" in d
            assert "order_amount" in d

    def test_admin_list_disputes_filter_open(self, http, admin_token):
        r = http.get(f"{API}/admin/disputes?status=open", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        for d in r.json():
            assert d["status"] == "open"

    def test_admin_resolve_dispute_rejected(self, http, admin_token, shipper_token, driver_token):
        """Open a fresh dispute and resolve as rejected."""
        oid = _create_shipment(http, shipper_token, desc="TEST_iter44 dispute-resolve-reject")
        acc = http.post(f"{API}/orders/{oid}/accept", headers=_h(driver_token), timeout=15)
        if acc.status_code == 403:
            pytest.skip(f"Driver KYC required: {acc.text}")
        for nxt in ("enroute_pickup", "arrived_pickup", "picked_up"):
            http.post(f"{API}/orders/{oid}/advance", json={"next_status": nxt},
                      headers=_h(driver_token), timeout=15)
        dr = http.post(f"{API}/shipper/shipments/{oid}/dispute",
                       json={"reason": "test_reject"}, headers=_h(shipper_token), timeout=10)
        assert dr.status_code == 200, dr.text
        dispute_id = dr.json()["id"]

        # Resolve as rejected
        res = http.post(f"{API}/admin/disputes/{dispute_id}/resolve",
                        json={"resolution": "rejected", "note": "Insufficient evidence"},
                        headers=_h(admin_token), timeout=15)
        assert res.status_code == 200, res.text
        assert res.json()["resolution"] == "rejected"

        # verify order.has_dispute cleared
        det = http.get(f"{API}/shipper/shipments/{oid}", headers=_h(shipper_token), timeout=10)
        assert det.status_code == 200
        assert det.json().get("has_dispute") is False

        # second resolve -> 400
        res2 = http.post(f"{API}/admin/disputes/{dispute_id}/resolve",
                         json={"resolution": "rejected"},
                         headers=_h(admin_token), timeout=10)
        assert res2.status_code == 400, res2.text

    def test_admin_resolve_dispute_refund_requires_captured(self, http, admin_token, shipper_token, driver_token):
        """Resolution 'refunded' on a non-captured order -> 400 (and never 500)."""
        oid = _create_shipment(http, shipper_token, desc="TEST_iter44 dispute-refund-uncaptured")
        acc = http.post(f"{API}/orders/{oid}/accept", headers=_h(driver_token), timeout=15)
        if acc.status_code == 403:
            pytest.skip(f"Driver KYC required: {acc.text}")
        for nxt in ("enroute_pickup", "arrived_pickup", "picked_up"):
            http.post(f"{API}/orders/{oid}/advance", json={"next_status": nxt},
                      headers=_h(driver_token), timeout=15)
        dr = http.post(f"{API}/shipper/shipments/{oid}/dispute",
                       json={"reason": "refund_test"}, headers=_h(shipper_token), timeout=10)
        assert dr.status_code == 200, dr.text
        dispute_id = dr.json()["id"]

        res = http.post(f"{API}/admin/disputes/{dispute_id}/resolve",
                        json={"resolution": "refunded"},
                        headers=_h(admin_token), timeout=15)
        # Not captured -> 400
        assert res.status_code == 400, res.text

    def test_admin_resolve_dispute_refund_captured_full_flow(self, http, admin_token, shipper_token, driver_token, driver_id):
        """Full refund flow: authorize-test -> capture -> deliver -> dispute -> refund."""
        oid = _create_shipment(http, shipper_token, desc="TEST_iter44 dispute-refund-captured")

        # 1) authorize-test
        auth_r = http.post(f"{API}/payments/orders/{oid}/authorize-test",
                           headers=_h(shipper_token), timeout=20)
        if auth_r.status_code == 404:
            # try without trailing piece
            auth_r = http.post(f"{API}/payments/orders/{oid}/authorize-test",
                               json={}, headers=_h(shipper_token), timeout=20)
        if auth_r.status_code not in (200, 201):
            pytest.skip(f"authorize-test unavailable: {auth_r.status_code} {auth_r.text[:200]}")

        # 2) accept + advance to delivered (auto-capture on delivery)
        acc = http.post(f"{API}/orders/{oid}/accept", headers=_h(driver_token), timeout=15)
        if acc.status_code == 403:
            pytest.skip(f"Driver KYC required: {acc.text}")
        for nxt in ("enroute_pickup", "arrived_pickup", "picked_up",
                    "enroute_dropoff", "arrived_dropoff", "delivered"):
            r = http.post(f"{API}/orders/{oid}/advance", json={"next_status": nxt},
                          headers=_h(driver_token), timeout=15)
            assert r.status_code == 200, f"advance->{nxt}: {r.status_code} {r.text}"

        # Verify captured
        det = http.get(f"{API}/shipper/shipments/{oid}", headers=_h(shipper_token), timeout=10)
        assert det.status_code == 200
        if det.json().get("payment_status") != "captured":
            # try explicit capture
            cap = http.post(f"{API}/payments/orders/{oid}/capture",
                            headers=_h(admin_token), timeout=20)
            if cap.status_code not in (200, 201):
                pytest.skip(f"Could not capture payment: {cap.status_code} {cap.text[:200]}")

        # 3) Open dispute (status is delivered -> allowed)
        dr = http.post(f"{API}/shipper/shipments/{oid}/dispute",
                       json={"reason": "lost_in_transit"}, headers=_h(shipper_token), timeout=10)
        assert dr.status_code == 200, dr.text
        dispute_id = dr.json()["id"]

        # 4) Resolve as refunded
        res = http.post(f"{API}/admin/disputes/{dispute_id}/resolve",
                        json={"resolution": "refunded"},
                        headers=_h(admin_token), timeout=30)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["resolution"] == "refunded"
        assert body.get("refund") is not None
        assert body["refund"].get("amount", 0) > 0

        # Verify order.has_dispute cleared + payment_status reflects refund
        det = http.get(f"{API}/shipper/shipments/{oid}", headers=_h(shipper_token), timeout=10)
        assert det.status_code == 200
        body = det.json()
        assert body.get("has_dispute") is False
        assert body.get("payment_status") in ("refunded", "partially_refunded"), body.get("payment_status")
