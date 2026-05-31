"""
Backend tests for the NadaRuns Admin Dashboard (iteration 12).

Covers:
- Admin auth (POST /api/auth/admin-login) and Bearer enforcement on /admin/*.
- GET /api/admin/overview (KPIs, series, breakdowns).
- /api/admin/manage/drivers (list, get, patch, suspend/activate).
- /api/admin/manage/shippers (list, get, patch, suspend/activate).
- /api/admin/manage/orders (list, get, cancel guard, reassign 404).
- /api/admin/manage/vehicles (flattened across drivers).
- Suspension enforcement on driver toggle-online & shipper create shipment.
"""

import os
import pytest
import requests

BASE_URL = "http://localhost:8001"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@nadaruns.com"
ADMIN_PASSWORD = "admin123"
DEMO_DRIVER_EMAIL = "demo.driver@nadaruns.com"
DEMO_DRIVER_PASSWORD = "demo1234"
DEMO_SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
DEMO_SHIPPER_PASSWORD = "demo1234"


def _valid_shipment_payload(desc: str) -> dict:
    """Match ShipmentCreateRequest pydantic schema."""
    return {
        "pickup_address": "TEST Pickup, Helsinki",
        "pickup_lat": 60.17, "pickup_lng": 24.94,
        "pickup_contact_name": "TEST Sender",
        "pickup_contact_phone": "+358401111111",
        "dropoff_address": "TEST Drop, Espoo",
        "dropoff_lat": 60.20, "dropoff_lng": 24.65,
        "dropoff_contact_name": "TEST Receiver",
        "dropoff_contact_phone": "+358402222222",
        "vehicle_type": "cargo_van",
        "cargo_weight_kg": 5.0,
        "cargo_description": desc,
        "urgency": "standard",
    }


# ---------- fixtures ----------

@pytest.fixture(scope="session", autouse=True)
def ensure_seed():
    """Make sure demo data exists so list endpoints are not empty."""
    try:
        requests.post(f"{API}/seed-demo", timeout=20)
    except Exception:
        pass


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(
        f"{API}/auth/admin-login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=10,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("is_admin") is True
    assert "token" in body
    return body["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def demo_driver_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": DEMO_DRIVER_EMAIL, "password": DEMO_DRIVER_PASSWORD},
        timeout=10,
    )
    assert r.status_code == 200, f"demo driver login failed: {r.text}"
    return r.json()["token"], r.json().get("driver_id")


@pytest.fixture(scope="session")
def demo_shipper_token():
    r = requests.post(
        f"{API}/auth/shipper-login",
        json={"email": DEMO_SHIPPER_EMAIL, "password": DEMO_SHIPPER_PASSWORD},
        timeout=10,
    )
    assert r.status_code == 200, f"demo shipper login failed: {r.text}"
    body = r.json()
    return body["token"], body.get("shipper_id") or body.get("driver_id")


# ---------- auth gate ----------

class TestAuthGate:
    """All admin endpoints require Bearer token."""

    def test_overview_requires_auth(self):
        r = requests.get(f"{API}/admin/overview", timeout=10)
        assert r.status_code in (401, 403), r.status_code

    def test_manage_drivers_requires_auth(self):
        r = requests.get(f"{API}/admin/manage/drivers", timeout=10)
        assert r.status_code in (401, 403)

    def test_invalid_password_rejected(self):
        r = requests.post(
            f"{API}/auth/admin-login",
            json={"email": ADMIN_EMAIL, "password": "wrong"},
            timeout=10,
        )
        assert r.status_code in (400, 401, 403)


# ---------- overview ----------

class TestOverview:
    def test_overview_shape(self, admin_headers):
        r = requests.get(f"{API}/admin/overview", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()

        # KPIs
        kpis = body.get("kpis") or {}
        required_kpis = [
            "total_drivers", "active_drivers", "suspended_drivers",
            "total_shippers", "total_orders", "pending_orders",
            "in_progress_orders", "delivered_orders", "cancelled_orders",
            "pending_kyc", "total_revenue", "total_tips",
        ]
        for k in required_kpis:
            assert k in kpis, f"missing kpi: {k}"
            assert isinstance(kpis[k], (int, float)), f"kpi {k} not numeric"

        # breakdowns
        assert isinstance(body.get("orders_by_status"), dict)
        assert isinstance(body.get("orders_by_vehicle"), list)

        # series = 14 daily points
        series = body.get("series")
        assert isinstance(series, list)
        assert len(series) == 14, f"series len={len(series)} not 14"
        for p in series:
            assert {"date", "deliveries", "revenue", "new_orders"} <= set(p.keys())

        # top + recent
        assert isinstance(body.get("top_drivers"), list)
        recent = body.get("recent_orders")
        assert isinstance(recent, list)
        assert len(recent) <= 8


# ---------- drivers ----------

class TestDriversMgmt:
    def test_list_drivers(self, admin_headers):
        r = requests.get(f"{API}/admin/manage/drivers", headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        b = r.json()
        assert {"items", "total", "page", "limit"} <= set(b.keys())
        assert isinstance(b["items"], list)
        # _id stripped
        for item in b["items"]:
            assert "_id" not in item

    def test_list_drivers_status_filter(self, admin_headers):
        for st in ("online", "offline", "suspended", "all"):
            r = requests.get(
                f"{API}/admin/manage/drivers",
                params={"status": st, "limit": 5},
                headers=admin_headers,
                timeout=10,
            )
            assert r.status_code == 200, f"status={st}: {r.text}"

    def test_list_drivers_search_and_paginate(self, admin_headers):
        r = requests.get(
            f"{API}/admin/manage/drivers",
            params={"search": "demo", "page": 1, "limit": 2},
            headers=admin_headers,
            timeout=10,
        )
        assert r.status_code == 200
        b = r.json()
        assert b["limit"] == 2
        assert len(b["items"]) <= 2

    def test_driver_detail_and_patch_and_suspend_activate(self, admin_headers):
        # find demo driver via search
        r = requests.get(
            f"{API}/admin/manage/drivers",
            params={"search": "demo.driver"},
            headers=admin_headers,
            timeout=10,
        )
        items = r.json().get("items", [])
        assert items, "demo driver not found"
        driver_id = items[0]["id"]
        original_name = items[0].get("name", "Demo Driver")

        # detail
        r2 = requests.get(
            f"{API}/admin/manage/drivers/{driver_id}",
            headers=admin_headers,
            timeout=10,
        )
        assert r2.status_code == 200, r2.text
        detail = r2.json()
        assert {"driver", "vehicles", "recent_orders", "stats"} <= set(detail.keys())
        assert detail["driver"]["id"] == driver_id

        # patch name
        new_name = f"{original_name} (admintest)"
        r3 = requests.patch(
            f"{API}/admin/manage/drivers/{driver_id}",
            json={"name": new_name},
            headers=admin_headers,
            timeout=10,
        )
        assert r3.status_code == 200, r3.text

        # verify persistence via GET
        r4 = requests.get(
            f"{API}/admin/manage/drivers/{driver_id}",
            headers=admin_headers,
            timeout=10,
        )
        assert r4.json()["driver"]["name"] == new_name

        # revert
        requests.patch(
            f"{API}/admin/manage/drivers/{driver_id}",
            json={"name": original_name},
            headers=admin_headers,
            timeout=10,
        )

        # suspend then activate (clean state)
        s = requests.post(
            f"{API}/admin/manage/drivers/{driver_id}/suspend",
            headers=admin_headers,
            timeout=10,
        )
        assert s.status_code == 200
        chk = requests.get(
            f"{API}/admin/manage/drivers/{driver_id}",
            headers=admin_headers,
            timeout=10,
        ).json()
        assert chk["driver"]["is_suspended"] is True
        assert chk["driver"].get("is_online") in (False, None)

        a = requests.post(
            f"{API}/admin/manage/drivers/{driver_id}/activate",
            headers=admin_headers,
            timeout=10,
        )
        assert a.status_code == 200
        chk2 = requests.get(
            f"{API}/admin/manage/drivers/{driver_id}",
            headers=admin_headers,
            timeout=10,
        ).json()
        assert chk2["driver"]["is_suspended"] is False


# ---------- shippers ----------

class TestShippersMgmt:
    def test_list_shippers(self, admin_headers):
        r = requests.get(f"{API}/admin/manage/shippers", headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        b = r.json()
        assert {"items", "total", "page", "limit"} <= set(b.keys())

    def test_shipper_detail_patch_suspend_activate(self, admin_headers):
        r = requests.get(
            f"{API}/admin/manage/shippers",
            params={"search": "demo.shipper"},
            headers=admin_headers,
            timeout=10,
        )
        items = r.json().get("items", [])
        if not items:
            pytest.skip("no demo shipper found")
        sid = items[0]["id"]
        original_contact = items[0].get("contact_name", "Demo")

        # detail
        r2 = requests.get(
            f"{API}/admin/manage/shippers/{sid}",
            headers=admin_headers, timeout=10,
        )
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert {"shipper", "recent_orders", "stats"} <= set(d.keys())

        # patch
        r3 = requests.patch(
            f"{API}/admin/manage/shippers/{sid}",
            json={"contact_name": f"{original_contact} (test)"},
            headers=admin_headers, timeout=10,
        )
        assert r3.status_code == 200, r3.text

        # verify
        chk = requests.get(
            f"{API}/admin/manage/shippers/{sid}",
            headers=admin_headers, timeout=10,
        ).json()
        assert "(test)" in chk["shipper"].get("contact_name", "")

        # revert
        requests.patch(
            f"{API}/admin/manage/shippers/{sid}",
            json={"contact_name": original_contact},
            headers=admin_headers, timeout=10,
        )

        # suspend/activate clean
        s = requests.post(
            f"{API}/admin/manage/shippers/{sid}/suspend",
            headers=admin_headers, timeout=10,
        )
        assert s.status_code == 200
        a = requests.post(
            f"{API}/admin/manage/shippers/{sid}/activate",
            headers=admin_headers, timeout=10,
        )
        assert a.status_code == 200


# ---------- orders ----------

class TestOrdersMgmt:
    def test_list_orders(self, admin_headers):
        r = requests.get(
            f"{API}/admin/manage/orders",
            params={"limit": 5},
            headers=admin_headers,
            timeout=10,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert {"items", "total", "page", "limit"} <= set(b.keys())

    def test_order_detail(self, admin_headers):
        r = requests.get(
            f"{API}/admin/manage/orders",
            params={"limit": 1},
            headers=admin_headers,
            timeout=10,
        )
        items = r.json().get("items", [])
        if not items:
            pytest.skip("no orders to inspect")
        oid = items[0]["id"]
        r2 = requests.get(
            f"{API}/admin/manage/orders/{oid}",
            headers=admin_headers, timeout=10,
        )
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert {"order", "events"} <= set(d.keys())

    def test_cancel_already_delivered_rejected(self, admin_headers):
        # find a delivered order
        r = requests.get(
            f"{API}/admin/manage/orders",
            params={"status": "delivered", "limit": 1},
            headers=admin_headers,
            timeout=10,
        )
        items = r.json().get("items", [])
        if not items:
            pytest.skip("no delivered order to test cancel guard")
        oid = items[0]["id"]
        r2 = requests.post(
            f"{API}/admin/manage/orders/{oid}/cancel",
            headers=admin_headers,
            timeout=10,
        )
        assert r2.status_code == 400, f"expected 400, got {r2.status_code}: {r2.text}"

    def test_reassign_unknown_driver_404(self, admin_headers):
        r = requests.get(
            f"{API}/admin/manage/orders",
            params={"limit": 1}, headers=admin_headers, timeout=10,
        )
        items = r.json().get("items", [])
        if not items:
            pytest.skip("no orders")
        oid = items[0]["id"]
        r2 = requests.post(
            f"{API}/admin/manage/orders/{oid}/reassign",
            json={"driver_id": "definitely-not-a-real-driver"},
            headers=admin_headers,
            timeout=10,
        )
        assert r2.status_code == 404, f"expected 404, got {r2.status_code}"

    def test_cancel_pending_then_check_persistence(self, admin_headers, demo_shipper_token):
        """Create a pending order via shipper then admin cancels it."""
        token, _ = demo_shipper_token
        sh_headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        payload = _valid_shipment_payload("TEST_admin_cancel")
        create = requests.post(f"{API}/shipper/shipments", json=payload, headers=sh_headers, timeout=15)
        if create.status_code not in (200, 201):
            pytest.skip(f"could not create shipment: {create.status_code} {create.text}")
        oid = create.json().get("id") or create.json().get("order_id")
        assert oid

        cancel = requests.post(
            f"{API}/admin/manage/orders/{oid}/cancel",
            headers=admin_headers, timeout=10,
        )
        assert cancel.status_code == 200, cancel.text

        # verify persistence
        det = requests.get(
            f"{API}/admin/manage/orders/{oid}", headers=admin_headers, timeout=10,
        ).json()
        assert det["order"]["status"] == "cancelled"


# ---------- vehicles ----------

class TestVehicles:
    def test_list_vehicles(self, admin_headers):
        r = requests.get(f"{API}/admin/manage/vehicles", headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        b = r.json()
        assert "items" in b and "total" in b
        for v in b["items"][:5]:
            assert "driver_id" in v and "driver_name" in v

    def test_vehicle_type_filter(self, admin_headers):
        r = requests.get(
            f"{API}/admin/manage/vehicles",
            params={"vehicle_type": "cargo_van"},
            headers=admin_headers, timeout=10,
        )
        assert r.status_code == 200
        for v in r.json().get("items", []):
            assert v.get("vehicle_type") == "cargo_van"


# ---------- suspension enforcement ----------

class TestSuspensionEnforcement:
    def test_suspended_driver_cannot_go_online(self, admin_headers, demo_driver_token):
        d_token, _ = demo_driver_token
        d_headers = {"Authorization": f"Bearer {d_token}", "Content-Type": "application/json"}

        # find driver id
        r = requests.get(
            f"{API}/admin/manage/drivers", params={"search": "demo.driver"},
            headers=admin_headers, timeout=10,
        )
        items = r.json().get("items", [])
        assert items
        driver_id = items[0]["id"]

        # suspend
        s = requests.post(
            f"{API}/admin/manage/drivers/{driver_id}/suspend",
            headers=admin_headers, timeout=10,
        )
        assert s.status_code == 200

        try:
            # try go online
            toggle = requests.post(
                f"{API}/driver/toggle-online",
                json={"is_online": True},
                headers=d_headers, timeout=10,
            )
            assert toggle.status_code == 403, f"expected 403, got {toggle.status_code}: {toggle.text}"
        finally:
            # ALWAYS reactivate
            requests.post(
                f"{API}/admin/manage/drivers/{driver_id}/activate",
                headers=admin_headers, timeout=10,
            )

    def test_suspended_shipper_cannot_create_shipment(self, admin_headers, demo_shipper_token):
        s_token, _ = demo_shipper_token
        s_headers = {"Authorization": f"Bearer {s_token}", "Content-Type": "application/json"}

        r = requests.get(
            f"{API}/admin/manage/shippers", params={"search": "demo.shipper"},
            headers=admin_headers, timeout=10,
        )
        items = r.json().get("items", [])
        if not items:
            pytest.skip("demo shipper not found")
        sid = items[0]["id"]

        sus = requests.post(
            f"{API}/admin/manage/shippers/{sid}/suspend",
            headers=admin_headers, timeout=10,
        )
        assert sus.status_code == 200

        try:
            payload = _valid_shipment_payload("TEST_suspension_check")
            res = requests.post(f"{API}/shipper/shipments", json=payload, headers=s_headers, timeout=10)
            assert res.status_code == 403, f"expected 403, got {res.status_code}: {res.text}"
        finally:
            requests.post(
                f"{API}/admin/manage/shippers/{sid}/activate",
                headers=admin_headers, timeout=10,
            )
