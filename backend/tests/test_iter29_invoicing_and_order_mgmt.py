"""
Iter-29 backend tests for:
  (A) Admin Order Management lifecycle + assignment
  (B) Shipper Invoicing system ("Accept Invoice" -> Net-14 + admin fee)
  (C) Admin Invoice Management
  (D) Regression: GET /api/orders/available

Run: pytest /app/backend/tests/test_iter29_invoicing_and_order_mgmt.py -v \
        --junitxml=/app/test_reports/pytest/iter29_results.xml
"""

import os
import uuid
import time
from datetime import datetime, timezone
from dateutil import parser as dtparser

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@nadaruns.com"
ADMIN_PASSWORD = "admin123"
SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
SHIPPER_PASSWORD = "demo1234"
DRIVER_EMAIL = "demo.driver@nadaruns.com"
DRIVER_PASSWORD = "demo1234"


# -------------------------------------------------- helpers / fixtures

def _login_admin() -> str:
    r = requests.post(f"{API}/auth/admin-login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"admin-login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _login_shipper(email: str, password: str) -> dict:
    r = requests.post(f"{API}/auth/shipper-login",
                      json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"shipper-login failed: {r.status_code} {r.text}"
    return r.json()


def _login_driver() -> dict:
    r = requests.post(f"{API}/auth/login",
                      json={"email": DRIVER_EMAIL, "password": DRIVER_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"driver login failed: {r.status_code} {r.text}"
    return r.json()


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _create_shipment(token: str, label: str = "iter29") -> dict:
    """Create a throwaway shipper-owned pending order. Helsinki -> ~3km route."""
    body = {
        "pickup_address": f"Mannerheimintie 1, Helsinki ({label})",
        "pickup_lat": 60.1699, "pickup_lng": 24.9384,
        "pickup_contact_name": "Pickup Person",
        "pickup_contact_phone": "+358401111111",
        "dropoff_address": f"Hämeentie 30, Helsinki ({label})",
        "dropoff_lat": 60.1879, "dropoff_lng": 24.9519,
        "dropoff_contact_name": "Drop Person",
        "dropoff_contact_phone": "+358402222222",
        "vehicle_type": "cargo_van",
        "cargo_weight_kg": 50.0,
        "cargo_type": "general",
        "cargo_description": f"TEST_{label} small package",
        "urgency": "standard",
        "shipper_offer": 0.0,
    }
    r = requests.post(f"{API}/shipper/shipments", json=body, headers=_h(token), timeout=30)
    assert r.status_code in (200, 201), f"create shipment failed: {r.status_code} {r.text}"
    data = r.json()
    # API returns `order_id`; normalize to `id` so the rest of the suite can rely on it.
    if "id" not in data and "order_id" in data:
        data["id"] = data["order_id"]
    assert data.get("id"), f"no id in create shipment response: {data}"
    return data


@pytest.fixture(scope="module")
def ctx():
    # Make sure demo data exists
    requests.post(f"{API}/seed-demo", timeout=30)

    admin_token = _login_admin()
    shipper = _login_shipper(SHIPPER_EMAIL, SHIPPER_PASSWORD)
    driver = _login_driver()

    # Find demo driver id (the demo driver should be returned by login response)
    driver_id = driver.get("driver_id") or driver.get("id")
    assert driver_id, f"no driver_id in login response: {driver}"

    # Shipper login uses the legacy LoginResponse model: shipper_id is returned as `driver_id`.
    shipper_id = shipper.get("shipper_id") or shipper.get("driver_id") or shipper.get("id")
    assert shipper_id, f"no shipper id in login response: {shipper}"

    # Create / login second throwaway shipper (for 403 test)
    other_email = f"TEST_other_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/shipper-register", json={
        "business_name": "TEST_OtherCo",
        "email": other_email,
        "password": "Passw0rd!",
        "phone": "+358400000000",
    }, timeout=20)
    assert r.status_code in (200, 201), f"other shipper register failed: {r.status_code} {r.text}"
    other_token = r.json()["token"]

    return {
        "admin": admin_token,
        "shipper_token": shipper["token"],
        "shipper_id": shipper_id,
        "driver_id": driver_id,
        "other_token": other_token,
        "created_order_ids": [],
    }


# -------------------------------------------------- A) Invoice flow

class TestInvoicing:

    def test_accept_invoice_creates_invoice(self, ctx):
        order = _create_shipment(ctx["shipper_token"], "inv1")
        order_id = order["id"]
        ctx["created_order_ids"].append(order_id)
        ctx["invoice_order_id"] = order_id

        r = requests.post(f"{API}/shipper/shipments/{order_id}/accept-invoice",
                          headers=_h(ctx["shipper_token"]), timeout=30)
        assert r.status_code == 200, f"accept-invoice: {r.status_code} {r.text}"
        inv = r.json()
        # Schema
        assert inv["status"] == "unpaid"
        assert inv["net_days"] == 14
        assert inv["invoice_fee"] == 9.0, f"expected default fee 9.0, got {inv['invoice_fee']}"
        assert inv["total_amount"] == pytest.approx(inv["order_value"] + inv["invoice_fee"], rel=1e-6)
        assert inv["invoice_number"].startswith(f"NDR-{datetime.now(timezone.utc).year}-"), inv["invoice_number"]
        assert inv["order_id"] == order_id
        assert inv["shipper_id"] == ctx["shipper_id"]
        # due_date ≈ issued_at + 14 days
        issued = dtparser.isoparse(inv["issued_at"])
        due = dtparser.isoparse(inv["due_date"])
        days = (due - issued).total_seconds() / 86400.0
        assert 13.5 <= days <= 14.5, f"due_date not ~14d after issued_at: {days}"

        ctx["invoice_id"] = inv["id"]
        ctx["invoice_number"] = inv["invoice_number"]

    def test_accept_invoice_idempotent(self, ctx):
        order_id = ctx["invoice_order_id"]
        r = requests.post(f"{API}/shipper/shipments/{order_id}/accept-invoice",
                          headers=_h(ctx["shipper_token"]), timeout=30)
        assert r.status_code == 200
        inv2 = r.json()
        assert inv2["id"] == ctx["invoice_id"], "second call should return same invoice"
        assert inv2["invoice_number"] == ctx["invoice_number"]

    def test_accept_invoice_forbidden_for_other_shipper(self, ctx):
        order_id = ctx["invoice_order_id"]
        r = requests.post(f"{API}/shipper/shipments/{order_id}/accept-invoice",
                          headers=_h(ctx["other_token"]), timeout=30)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_shipper_list_invoices(self, ctx):
        r = requests.get(f"{API}/shipper/invoices",
                         headers=_h(ctx["shipper_token"]), timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        ids = [x["id"] for x in rows]
        assert ctx["invoice_id"] in ids, f"created invoice missing from list: {ids[:5]}..."

    def test_get_invoice_detail_owner(self, ctx):
        r = requests.get(f"{API}/invoices/{ctx['invoice_id']}",
                         headers=_h(ctx["shipper_token"]), timeout=20)
        assert r.status_code == 200
        inv = r.json()
        assert inv["id"] == ctx["invoice_id"]

    def test_get_invoice_detail_admin(self, ctx):
        r = requests.get(f"{API}/invoices/{ctx['invoice_id']}",
                         headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        assert r.json()["id"] == ctx["invoice_id"]

    def test_get_invoice_detail_other_shipper_forbidden(self, ctx):
        r = requests.get(f"{API}/invoices/{ctx['invoice_id']}",
                         headers=_h(ctx["other_token"]), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_invoice_pdf(self, ctx):
        r = requests.get(f"{API}/invoices/{ctx['invoice_id']}/pdf",
                         headers={"Authorization": f"Bearer {ctx['shipper_token']}"},
                         timeout=30)
        assert r.status_code == 200, f"pdf: {r.status_code} {r.text[:200]}"
        ctype = r.headers.get("content-type", "")
        assert "application/pdf" in ctype, f"unexpected content-type {ctype}"
        body = r.content
        assert len(body) > 500, f"pdf body too small: {len(body)} bytes"
        assert body[:4] == b"%PDF", f"not a PDF header: {body[:10]!r}"


# -------------------------------------------------- B) Admin invoice management

class TestAdminInvoices:

    def test_admin_list_invoices_includes_new(self, ctx):
        r = requests.get(f"{API}/admin/invoices", headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "invoices" in data and "totals" in data
        ids = [x["id"] for x in data["invoices"]]
        assert ctx["invoice_id"] in ids
        assert data["totals"]["count"] == len(data["invoices"])

    def test_admin_list_invoices_filter_status_unpaid(self, ctx):
        r = requests.get(f"{API}/admin/invoices?status=unpaid",
                         headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        rows = r.json()["invoices"]
        assert all(x["status"] == "unpaid" for x in rows)
        assert ctx["invoice_id"] in [x["id"] for x in rows]

    def test_admin_list_invoices_search_q(self, ctx):
        r = requests.get(f"{API}/admin/invoices",
                         params={"q": ctx["invoice_number"]},
                         headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        rows = r.json()["invoices"]
        assert ctx["invoice_id"] in [x["id"] for x in rows]

    def test_admin_resend(self, ctx):
        r = requests.post(f"{API}/admin/invoices/{ctx['invoice_id']}/resend",
                          headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert data.get("last_sent_at")

    def test_admin_mark_overdue(self, ctx):
        r = requests.post(f"{API}/admin/invoices/{ctx['invoice_id']}/mark-overdue",
                          headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        assert r.json()["status"] == "overdue"

    def test_admin_mark_paid(self, ctx):
        r = requests.post(f"{API}/admin/invoices/{ctx['invoice_id']}/mark-paid",
                          headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        inv = r.json()
        assert inv["status"] == "paid"
        assert inv.get("paid_at")


# -------------------------------------------------- C) Admin invoicing settings

class TestAdminInvoicingSettings:

    def test_get_default(self, ctx):
        r = requests.get(f"{API}/admin/settings/invoicing",
                         headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "invoice_fee" in data and "net_days" in data

    def test_update_and_revert(self, ctx):
        # Update
        r = requests.post(f"{API}/admin/settings/invoicing",
                          json={"invoice_fee": 12.5, "net_days": 14},
                          headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        # Verify via GET
        r2 = requests.get(f"{API}/admin/settings/invoicing",
                          headers=_h(ctx["admin"]), timeout=20)
        assert r2.status_code == 200
        d = r2.json()
        assert d["invoice_fee"] == 12.5
        assert d["net_days"] == 14
        # Revert
        r3 = requests.post(f"{API}/admin/settings/invoicing",
                           json={"invoice_fee": 9.0, "net_days": 14},
                           headers=_h(ctx["admin"]), timeout=20)
        assert r3.status_code == 200
        assert r3.json()["invoice_fee"] == 9.0


# -------------------------------------------------- D) Admin order management lifecycle

class TestAdminOrderManagement:

    def test_assign_to_demo_driver(self, ctx):
        order = _create_shipment(ctx["shipper_token"], "lifecycle")
        ctx["lifecycle_order_id"] = order["id"]
        ctx["created_order_ids"].append(order["id"])

        oid = ctx["lifecycle_order_id"]
        r = requests.post(f"{API}/admin/manage/orders/{oid}/assign",
                          json={"driver_id": ctx["driver_id"]},
                          headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200, f"assign: {r.status_code} {r.text}"
        o = r.json()
        assert o.get("driver_id") == ctx["driver_id"]
        assert o.get("status") == "accepted"

    def test_unassign_returns_to_marketplace(self, ctx):
        oid = ctx["lifecycle_order_id"]
        r = requests.post(f"{API}/admin/manage/orders/{oid}/unassign",
                          json={"reason": "TEST_unassign"},
                          headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200, f"unassign: {r.status_code} {r.text}"
        o = r.json()
        assert o.get("driver_id") in (None, "")
        assert o.get("status") == "pending"

    def test_pause(self, ctx):
        oid = ctx["lifecycle_order_id"]
        r = requests.post(f"{API}/admin/manage/orders/{oid}/pause",
                          headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        assert r.json().get("status") == "paused"

    def test_restore_to_pending(self, ctx):
        oid = ctx["lifecycle_order_id"]
        r = requests.post(f"{API}/admin/manage/orders/{oid}/restore",
                          headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        assert r.json().get("status") == "pending"

    def test_complete(self, ctx):
        oid = ctx["lifecycle_order_id"]
        r = requests.post(f"{API}/admin/manage/orders/{oid}/complete",
                          headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        o = r.json()
        assert o.get("status") == "delivered"
        assert o.get("completed_at")

    def test_fail_after_complete_on_new_order(self, ctx):
        # Fail endpoint contract: should set status='failed' regardless. Use a fresh order so
        # we don't depend on completed-then-fail being allowed.
        order = _create_shipment(ctx["shipper_token"], "fail")
        ctx["created_order_ids"].append(order["id"])
        oid = order["id"]
        r = requests.post(f"{API}/admin/manage/orders/{oid}/fail",
                          json={"reason": "TEST_fail_reason"},
                          headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200, f"fail: {r.status_code} {r.text}"
        o = r.json()
        assert o.get("status") == "failed"

    def test_notes(self, ctx):
        oid = ctx["lifecycle_order_id"]
        r = requests.post(f"{API}/admin/manage/orders/{oid}/notes",
                          json={"note": "hello"},
                          headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200, f"notes: {r.status_code} {r.text}"
        data = r.json()
        notes = data.get("notes") or []
        assert any(n.get("note") == "hello" for n in notes), f"notes payload: {notes}"

    def test_assignment_history(self, ctx):
        oid = ctx["lifecycle_order_id"]
        r = requests.get(f"{API}/admin/manage/orders/{oid}/assignment-history",
                         headers=_h(ctx["admin"]), timeout=20)
        assert r.status_code == 200
        rows = r.json().get("history") or []
        actions = [x.get("action") for x in rows]
        assert "assigned" in actions
        assert "returned_to_marketplace" in actions, f"actions: {actions}"


# -------------------------------------------------- E) Regression: /api/orders/available

class TestRegressionAvailableFeed:

    def test_available_orders(self, ctx):
        # No auth needed (or driver?). Try both.
        r = requests.get(f"{API}/orders/available", timeout=20)
        if r.status_code == 401:
            driver = _login_driver()
            r = requests.get(f"{API}/orders/available",
                             headers={"Authorization": f"Bearer {driver['token']}"},
                             timeout=20)
        assert r.status_code == 200, f"available feed: {r.status_code} {r.text[:200]}"
        body = r.json()
        rows = body if isinstance(body, list) else body.get("orders") or body.get("items") or []
        assert isinstance(rows, list)
        assert len(rows) > 0, "no pending available orders returned"
