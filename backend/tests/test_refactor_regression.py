"""
Refactor regression tests for the route extraction.

Verifies the primary endpoints listed in the testing request still respond correctly
after the monolithic server.py was split into per-domain APIRouter modules.

NOTE: This is a SMOKE / regression suite — it confirms that registration + dependency
injection still work for each domain. Deeper behavioural tests live in their own files.
"""
import os
import json
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nadaruns-logistics.preview.emergentagent.com").rstrip("/")

DRIVER_EMAIL = "demo.driver@nadaruns.com"
SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
ADMIN_EMAIL = "admin@nadaruns.com"
DRIVER_PW = "demo1234"
SHIPPER_PW = "demo1234"
ADMIN_PW = "admin123"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def tokens(api):
    # Ensure demo seeded (idempotent)
    api.post(f"{BASE_URL}/api/seed-demo", timeout=15)

    d = api.post(f"{BASE_URL}/api/auth/login",
                 json={"email": DRIVER_EMAIL, "password": DRIVER_PW}, timeout=15)
    s = api.post(f"{BASE_URL}/api/auth/shipper-login",
                 json={"email": SHIPPER_EMAIL, "password": SHIPPER_PW}, timeout=15)
    a = api.post(f"{BASE_URL}/api/auth/admin-login",
                 json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15)

    assert d.status_code == 200, f"driver login {d.status_code}: {d.text[:300]}"
    assert s.status_code == 200, f"shipper login {s.status_code}: {s.text[:300]}"
    assert a.status_code == 200, f"admin login {a.status_code}: {a.text[:300]}"

    dj, sj, aj = d.json(), s.json(), a.json()
    assert "token" in dj and "token" in sj and "token" in aj
    return {"driver": dj["token"], "shipper": sj["token"], "admin": aj["token"]}


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- AUTH ----------
class TestAuth:
    def test_driver_login(self, tokens):
        assert tokens["driver"]

    def test_shipper_login(self, tokens):
        assert tokens["shipper"]

    def test_admin_login(self, tokens):
        assert tokens["admin"]


# ---------- DRIVER DOMAIN ----------
class TestDriverDomain:
    def test_driver_me(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/driver/me", headers=_auth(tokens["driver"]), timeout=15)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert "id" in body or "driver_id" in body or "email" in body

    def test_orders_active(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/orders/active", headers=_auth(tokens["driver"]), timeout=15)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), (list, dict))

    def test_orders_available(self, api, tokens):
        # Helsinki coords
        r = api.get(
            f"{BASE_URL}/api/orders/available",
            params={"lat": 60.1699, "lng": 24.9384, "radius_km": 50},
            headers=_auth(tokens["driver"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), (list, dict))

    def test_driver_wallet(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/driver/wallet", headers=_auth(tokens["driver"]), timeout=15)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        # wallet should expose at least balance/transactions fields
        assert isinstance(body, dict)

    def test_notifications(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/notifications", headers=_auth(tokens["driver"]), timeout=15)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), (list, dict))


# ---------- SHIPPER DOMAIN ----------
class TestShipperDomain:
    def test_shipper_me(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/shipper/me", headers=_auth(tokens["shipper"]), timeout=15)
        assert r.status_code == 200, r.text[:300]

    def test_shipper_shipments(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/shipper/shipments", headers=_auth(tokens["shipper"]), timeout=15)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), (list, dict))

    def test_shipper_receipts(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/shipper/receipts", headers=_auth(tokens["shipper"]), timeout=15)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), (list, dict))

    def test_create_shipment(self, api, tokens):
        # Real Helsinki area addresses so Google Directions can resolve them.
        # Schema mirrors backend `ShipmentCreateRequest` (server.py L477).
        payload = {
            "pickup_address": "Mannerheimintie 1, Helsinki, Finland",
            "pickup_lat": 60.1719,
            "pickup_lng": 24.9414,
            "pickup_contact_name": "TEST_PickupContact",
            "pickup_contact_phone": "+358401234567",
            "dropoff_address": "Aleksanterinkatu 52, Helsinki, Finland",
            "dropoff_lat": 60.1686,
            "dropoff_lng": 24.9414,
            "dropoff_contact_name": "TEST_DropoffContact",
            "dropoff_contact_phone": "+358407654321",
            "vehicle_type": "cargo_van",
            "cargo_weight_kg": 5.0,
            "cargo_description": "TEST_refactor regression box",
            "urgency": "standard",
        }
        r = api.post(
            f"{BASE_URL}/api/shipper/shipments",
            headers=_auth(tokens["shipper"]),
            data=json.dumps(payload),
            timeout=30,
        )
        # Accept 200/201 + structured body. If shape differs, surface text for debugging.
        assert r.status_code in (200, 201), f"create_shipment {r.status_code}: {r.text[:400]}"
        body = r.json()
        assert isinstance(body, dict)
        # Should contain at least one identifier so we can validate persistence later
        assert any(k in body for k in ("id", "_id", "order_id", "shipment_id")), body
        pytest.shipment_response = body


# ---------- ORDER LIFECYCLE ----------
class TestOrderLifecycle:
    """Driver accept + advance through state machine."""

    def test_driver_can_accept_and_advance(self, api, tokens):
        # Fetch available orders
        r = api.get(
            f"{BASE_URL}/api/orders/available",
            params={"lat": 60.1699, "lng": 24.9384, "radius_km": 200},
            headers=_auth(tokens["driver"]),
            timeout=20,
        )
        assert r.status_code == 200, r.text[:300]
        available = r.json() if isinstance(r.json(), list) else r.json().get("orders", [])
        if not available:
            pytest.skip("No available orders for driver to accept after seed")

        order = available[0]
        order_id = order.get("id") or order.get("_id") or order.get("order_id")
        assert order_id, f"order missing id: {order}"

        # Accept
        acc = api.post(
            f"{BASE_URL}/api/orders/{order_id}/accept",
            headers=_auth(tokens["driver"]),
            timeout=20,
        )
        assert acc.status_code in (200, 201, 409), f"accept {acc.status_code}: {acc.text[:300]}"
        if acc.status_code == 409:
            pytest.skip("Order already accepted by another driver; accept idempotency path tested")

        # Advance (state machine endpoint). Body is required (AdvanceRequest).
        adv = api.post(
            f"{BASE_URL}/api/orders/{order_id}/advance",
            headers=_auth(tokens["driver"]),
            data=json.dumps({}),
            timeout=20,
        )
        assert adv.status_code in (200, 201, 400, 409), (
            f"advance {adv.status_code}: {adv.text[:300]}"
        )


# ---------- ADMIN DOMAIN ----------
class TestAdminDomain:
    def test_admin_overview(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/admin/overview", headers=_auth(tokens["admin"]), timeout=20)
        assert r.status_code == 200, r.text[:300]

    def test_admin_manage_orders(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/admin/manage/orders", headers=_auth(tokens["admin"]), timeout=20)
        assert r.status_code == 200, r.text[:300]

    def test_admin_invoices(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/admin/invoices", headers=_auth(tokens["admin"]), timeout=20)
        assert r.status_code == 200, r.text[:300]

    def test_admin_receipts(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/admin/receipts", headers=_auth(tokens["admin"]), timeout=20)
        assert r.status_code == 200, r.text[:300]

    def test_admin_email_templates(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/admin/email-templates", headers=_auth(tokens["admin"]), timeout=20)
        assert r.status_code == 200, r.text[:300]


# ---------- COMPANY / PAYMENTS REGISTRATION ----------
class TestCompanyPaymentsRegistration:
    """Confirm company/payments routers are registered (no 404 on auth-protected routes).
    A 401/403 means 'reachable but unauthorized', which is a PASS for registration."""

    def _reachable(self, status):
        # 405 = endpoint registered but wrong HTTP verb (still PASS for registration check)
        return status in (200, 201, 204, 400, 401, 403, 405, 422)

    def test_company_root_registered(self, api, tokens):
        # `/api/company` is POST-only; GET should return 405 (registered), never 404
        r = api.get(f"{BASE_URL}/api/company", headers=_auth(tokens["driver"]), timeout=15)
        assert r.status_code != 404, f"company route 404 — not registered: {r.text[:200]}"
        assert self._reachable(r.status_code), r.status_code

    def test_company_drivers_registered(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/company/drivers", headers=_auth(tokens["driver"]), timeout=15)
        assert r.status_code != 404
        assert self._reachable(r.status_code), r.status_code

    def test_company_vehicles_registered(self, api, tokens):
        r = api.get(f"{BASE_URL}/api/company/vehicles", headers=_auth(tokens["driver"]), timeout=15)
        assert r.status_code != 404
        assert self._reachable(r.status_code), r.status_code

    def test_payments_config_registered(self, api, tokens):
        # `/api/payments/config` is the canonical registered payments endpoint
        r = api.get(f"{BASE_URL}/api/payments/config", headers=_auth(tokens["shipper"]), timeout=15)
        assert r.status_code != 404, f"payments route 404 — not registered: {r.text[:200]}"
        assert self._reachable(r.status_code), r.status_code
