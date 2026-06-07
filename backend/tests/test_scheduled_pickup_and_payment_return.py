"""Tests for scheduled_pickup persistence on shipper shipments and the
/api/payments/return HTML deep-link redirect endpoint.

Covers iter-23 review: custom delivery day/time picker and Stripe in-app
browser auto-close via the payments/return deep link.
"""
import os
import urllib.parse
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
    "https://nadaruns-logistics.preview.emergentagent.com"

SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
SHIPPER_PASSWORD = "demo1234"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def shipper_token(api_client):
    # Seed demo data (idempotent)
    api_client.post(f"{BASE_URL}/api/seed-demo", timeout=30)
    r = api_client.post(
        f"{BASE_URL}/api/auth/shipper-login",
        json={"email": SHIPPER_EMAIL, "password": SHIPPER_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"shipper-login failed: {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token, f"No token in response: {r.json()}"
    return token


def _shipment_payload(scheduled_pickup):
    return {
        "pickup_address": "TEST_Helsinki Pickup, Mannerheimintie 1",
        "pickup_lat": 60.1699,
        "pickup_lng": 24.9384,
        "pickup_contact_name": "TEST_Pickup Contact",
        "pickup_contact_phone": "+358401234567",
        "pickup_notes": "TEST pickup notes",
        "dropoff_address": "TEST_Espoo Dropoff, Tapiontori 2",
        "dropoff_lat": 60.1755,
        "dropoff_lng": 24.7956,
        "dropoff_contact_name": "TEST_Dropoff Contact",
        "dropoff_contact_phone": "+358407654321",
        "dropoff_notes": "TEST dropoff notes",
        "vehicle_type": "cargo_van",
        "cargo_weight_kg": 25.0,
        "cargo_dimensions": "50x40x30",
        "cargo_type": "general",
        "cargo_description": "TEST_Custom-schedule package",
        "special_requirements": [],
        "scheduled_pickup": scheduled_pickup,
        "urgency": "standard",
        "shipper_offer": 0,
    }


# ---------------------------------------------------------------------------
# scheduled_pickup persistence
# ---------------------------------------------------------------------------
class TestScheduledPickupPersistence:
    """POST /api/shipper/shipments must persist scheduled_pickup and GET must echo it back."""

    def test_create_with_custom_scheduled_pickup(self, api_client, shipper_token):
        future_iso = (datetime.now(timezone.utc) + timedelta(days=2, hours=3)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        # Use the exact value the frontend would produce
        future_iso = "2026-06-20T09:00:00.000Z"

        headers = {"Authorization": f"Bearer {shipper_token}"}
        r = api_client.post(
            f"{BASE_URL}/api/shipper/shipments",
            json=_shipment_payload(future_iso),
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 200, f"create failed: {r.status_code} {r.text}"
        body = r.json()
        order_id = body.get("order_id")
        assert order_id, f"missing order_id in response: {body}"

        # GET list and confirm scheduled_pickup persisted
        rl = api_client.get(
            f"{BASE_URL}/api/shipper/shipments", headers=headers, timeout=20
        )
        assert rl.status_code == 200, rl.text
        match = next((o for o in rl.json() if o.get("id") == order_id), None)
        assert match is not None, f"created order {order_id} not found in shipments list"
        assert match.get("scheduled_pickup") == future_iso, (
            f"scheduled_pickup mismatch: got {match.get('scheduled_pickup')!r}, expected {future_iso!r}"
        )

        # GET single shipment also reflects it
        rd = api_client.get(
            f"{BASE_URL}/api/shipper/shipments/{order_id}", headers=headers, timeout=20
        )
        assert rd.status_code == 200, rd.text
        assert rd.json().get("scheduled_pickup") == future_iso

    def test_create_asap_null_scheduled_pickup_still_works(self, api_client, shipper_token):
        headers = {"Authorization": f"Bearer {shipper_token}"}
        r = api_client.post(
            f"{BASE_URL}/api/shipper/shipments",
            json=_shipment_payload(None),
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 200, f"asap create failed: {r.status_code} {r.text}"
        order_id = r.json()["order_id"]

        rl = api_client.get(
            f"{BASE_URL}/api/shipper/shipments", headers=headers, timeout=20
        )
        match = next((o for o in rl.json() if o.get("id") == order_id), None)
        assert match is not None
        assert match.get("scheduled_pickup") in (None, ""), (
            f"ASAP shipment should have null scheduled_pickup, got {match.get('scheduled_pickup')!r}"
        )


# ---------------------------------------------------------------------------
# /api/payments/return HTML
# ---------------------------------------------------------------------------
class TestPaymentsReturnEndpoint:
    def test_success_with_redirect_returns_html_with_deeplink(self, api_client):
        redirect = "nadaruns://payment-complete"
        order_id = "test123"
        url = (
            f"{BASE_URL}/api/payments/return?status=success&order_id={order_id}"
            f"&redirect={urllib.parse.quote(redirect, safe='')}"
        )
        r = api_client.get(url, timeout=20)
        assert r.status_code == 200, r.text
        assert "text/html" in r.headers.get("content-type", ""), r.headers
        body = r.text
        assert "nadaruns://payment-complete" in body, body[:500]
        assert "order_id=test123" in body, body[:500]
        assert "status=success" in body, body[:500]
        # Auto-redirect markers (meta refresh + JS)
        assert "http-equiv='refresh'" in body or "http-equiv=\"refresh\"" in body
        assert "window.location.replace" in body

    def test_cancel_with_redirect_returns_html(self, api_client):
        redirect = "nadaruns://payment-complete"
        url = (
            f"{BASE_URL}/api/payments/return?status=cancel&order_id=test123"
            f"&redirect={urllib.parse.quote(redirect, safe='')}"
        )
        r = api_client.get(url, timeout=20)
        assert r.status_code == 200, r.text
        body = r.text
        assert "nadaruns://payment-complete" in body
        assert "status=cancel" in body
        assert "Payment cancelled" in body

    def test_without_redirect_returns_plain_status_page(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/payments/return?status=success&order_id=test123",
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.text
        assert "Payment authorized" in body
        # No deep link / meta refresh in plain mode
        assert "http-equiv='refresh'" not in body
        assert "nadaruns://" not in body

    def test_without_any_params_does_not_crash(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/payments/return", timeout=20)
        assert r.status_code == 200, r.text
        assert "Payment authorized" in r.text  # default status=success
