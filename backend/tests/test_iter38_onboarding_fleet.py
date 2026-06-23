"""
Iteration 38 — Driver Onboarding wizard backend regression
Tests:
  - Individual driver registration (no company side effects)
  - Fleet driver registration creates Company + sets company_id on driver
  - Fleet registration without company_name -> HTTP 400
  - Admin /api/admin/fleet/companies lists the new company
"""

import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nadaruns-logistics.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@nadaruns.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/admin-login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=30)
    assert r.status_code == 200, f"admin login failed {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def ts():
    return int(time.time())


# ---------------- Individual driver ----------------

def test_register_individual_driver(ts):
    payload = {
        "first_name": "Indi",
        "last_name": "Driver",
        "email": f"qa.ind+{ts}@example.com",
        "phone": "+358401234567",
        "password": "test1234",
        "vehicle_type": "cargo_van",
        "city": "Helsinki",
        "license_class": "B",
        "account_type": "individual",
    }
    r = requests.post(f"{BASE_URL}/api/driver/register", json=payload, timeout=60)
    assert r.status_code == 200, f"register failed {r.status_code} {r.text}"
    body = r.json()
    assert body.get("driver_id"), "driver_id missing"
    assert body.get("token"), "token missing"


# ---------------- Fleet validation ----------------

def test_register_fleet_without_company_name_400(ts):
    payload = {
        "first_name": "NoName",
        "last_name": "Fleet",
        "email": f"qa.fleet.bad+{ts}@example.com",
        "phone": "+358401234568",
        "password": "test1234",
        "vehicle_type": "cargo_van",
        "city": "Helsinki",
        "account_type": "fleet",
        # company_name intentionally missing
    }
    r = requests.post(f"{BASE_URL}/api/driver/register", json=payload, timeout=30)
    assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
    assert "company" in r.text.lower()


def test_register_fleet_with_empty_company_name_400(ts):
    payload = {
        "first_name": "Empty",
        "last_name": "Co",
        "email": f"qa.fleet.empty+{ts}@example.com",
        "phone": "+358401234569",
        "password": "test1234",
        "vehicle_type": "cargo_van",
        "city": "Helsinki",
        "account_type": "fleet",
        "company_name": "   ",
    }
    r = requests.post(f"{BASE_URL}/api/driver/register", json=payload, timeout=30)
    assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"


# ---------------- Fleet success + side effects ----------------

@pytest.fixture(scope="module")
def fleet_registration(ts):
    payload = {
        "first_name": "QA",
        "last_name": "Fleet",
        "email": f"qa.fleet+{ts}@example.com",
        "phone": "+358401234570",
        "password": "test1234",
        "vehicle_type": "box_truck",
        "city": "Helsinki",
        "license_class": "C",
        "account_type": "fleet",
        "company_name": f"QA Fleet Oy {ts}",
        "business_id": "1234567-8",
    }
    r = requests.post(f"{BASE_URL}/api/driver/register", json=payload, timeout=60)
    assert r.status_code == 200, f"fleet register failed {r.status_code} {r.text}"
    body = r.json()
    return {"payload": payload, "driver_id": body["driver_id"], "token": body["token"]}


def test_fleet_driver_has_company_id(fleet_registration):
    # Use driver token to fetch own profile via /api/driver/me
    headers = {"Authorization": f"Bearer {fleet_registration['token']}"}
    r = requests.get(f"{BASE_URL}/api/driver/me", headers=headers, timeout=30)
    assert r.status_code == 200, f"driver me failed: {r.status_code} {r.text}"
    data = r.json()
    # company_id may be present under driver root
    cid = data.get("company_id") or (data.get("driver") or {}).get("company_id")
    assert cid, f"company_id not set on driver: {data}"


def test_admin_sees_new_company(admin_token, fleet_registration):
    headers = {"Authorization": f"Bearer {admin_token}"}
    expected_name = fleet_registration["payload"]["company_name"]
    r = requests.get(
        f"{BASE_URL}/api/admin/fleet/companies",
        headers=headers, params={"search": expected_name}, timeout=30,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    items = r.json().get("items", [])
    names = [c.get("company_name") for c in items]
    assert expected_name in names, f"Company '{expected_name}' not found in admin list: {names}"
    company = next(c for c in items if c.get("company_name") == expected_name)
    assert company.get("business_id") == "1234567-8"
    assert company.get("owner_email") == fleet_registration["payload"]["email"]
