"""
Test marketplace visibility fix:
The payment_status gate was removed from driver marketplace endpoints,
so shipper-created jobs should appear immediately for drivers regardless
of payment_status.
"""
import os
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
).rstrip("/")

DRIVER_EMAIL = "demo.driver@nadaruns.com"
DRIVER_PASSWORD = "demo1234"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def driver_token(api_client):
    # Try login; if fails, seed demo and retry
    r = api_client.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": DRIVER_EMAIL, "password": DRIVER_PASSWORD},
        timeout=30,
    )
    if r.status_code != 200:
        seed = api_client.post(f"{BASE_URL}/api/seed-demo", timeout=60)
        assert seed.status_code in (200, 201), f"seed-demo failed: {seed.status_code} {seed.text}"
        r = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": DRIVER_EMAIL, "password": DRIVER_PASSWORD},
            timeout=30,
        )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"no token in login response: {data}"
    return token


# ===== /api/orders/pending (no auth) =====
def test_orders_pending_returns_object(api_client):
    r = api_client.get(f"{BASE_URL}/api/orders/pending", timeout=30)
    assert r.status_code == 200, f"unexpected status: {r.status_code} body={r.text}"
    body = r.json()
    assert body is not None, "expected a pending order object, got null"
    assert isinstance(body, dict), f"expected dict, got {type(body)}"
    assert body.get("status") == "pending", f"order is not pending: {body.get('status')}"
    assert "id" in body, "order is missing id"


# ===== /api/orders/available as DRIVER =====
def test_orders_available_non_empty_for_driver(api_client, driver_token):
    headers = {"Authorization": f"Bearer {driver_token}"}
    r = api_client.get(f"{BASE_URL}/api/orders/available", headers=headers, timeout=30)
    assert r.status_code == 200, f"unexpected status: {r.status_code} body={r.text}"
    body = r.json()
    assert isinstance(body, list), f"expected list, got {type(body)}"
    assert len(body) > 0, "expected non-empty list of available orders for driver"


def test_orders_available_no_auth_also_works(api_client):
    """endpoint has no auth dependency — should still work without token"""
    r = api_client.get(f"{BASE_URL}/api/orders/available", timeout=30)
    assert r.status_code == 200, f"unexpected status: {r.status_code} body={r.text}"
    body = r.json()
    assert isinstance(body, list)
    assert len(body) > 0, "expected non-empty list of available orders"


def test_orders_available_includes_unpaid_pending(api_client, driver_token):
    """The fix removed payment_status filter — orders with payment_status
    'unpaid'/'pending'/None should appear."""
    headers = {"Authorization": f"Bearer {driver_token}"}
    r = api_client.get(f"{BASE_URL}/api/orders/available", headers=headers, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert len(body) > 0
    # All returned must be pending status
    for o in body:
        assert o.get("status") == "pending", f"non-pending leaked: {o.get('status')}"
    # Confirm at least some are non-captured/non-authorized payment status
    non_paid_statuses = [
        o.get("payment_status") for o in body
        if o.get("payment_status") not in ("authorized", "captured")
    ]
    assert len(non_paid_statuses) > 0, (
        "expected some pending orders with non-paid payment_status to confirm "
        "gate was removed"
    )


def test_orders_available_contains_shipper_created(api_client, driver_token):
    headers = {"Authorization": f"Bearer {driver_token}"}
    r = api_client.get(f"{BASE_URL}/api/orders/available", headers=headers, timeout=30)
    assert r.status_code == 200
    body = r.json()
    shipper_jobs = [o for o in body if o.get("shipper_id")]
    assert len(shipper_jobs) > 0, "expected at least one shipper-created job in marketplace"


# ===== /api/orders/available/matched (regression) =====
def test_orders_available_matched_for_driver(api_client, driver_token):
    headers = {"Authorization": f"Bearer {driver_token}"}
    r = api_client.get(
        f"{BASE_URL}/api/orders/available/matched", headers=headers, timeout=30
    )
    assert r.status_code == 200, f"unexpected status: {r.status_code} body={r.text}"
    body = r.json()
    assert isinstance(body, list), f"expected list, got {type(body)}"
    # all returned are pending
    for o in body:
        assert o.get("status") == "pending", f"non-pending in matched: {o.get('status')}"


def test_orders_available_matched_requires_auth(api_client):
    r = api_client.get(f"{BASE_URL}/api/orders/available/matched", timeout=30)
    assert r.status_code in (401, 403), (
        f"expected auth required, got {r.status_code}"
    )
