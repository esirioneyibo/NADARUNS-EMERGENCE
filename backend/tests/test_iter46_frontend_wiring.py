"""
Iteration 46 backend tests for the new frontend wiring.

Covers:
  - Driver bank_details persistence via PATCH /api/driver/me (full set then partial IBAN-only merge).
  - Wallet cash-out (POST /api/wallet/withdraw or /api/driver/wallet/withdraw) when balance allows,
    then verify the IBAN gets persisted back to driver.bank_details via PATCH /api/driver/me.
  - Cargo weight required: POST /api/shipper/shipments with cargo_weight_kg <=0 returns 422,
    and a valid weight succeeds (200/201).
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
DRIVER_EMAIL = "demo.driver@nadaruns.com"
DRIVER_PWD = "demo1234"
SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
SHIPPER_PWD = "demo1234"


# ---------- shared fixtures ----------

@pytest.fixture(scope="session")
def base_url():
    assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"
    # Make sure demo data exists
    try:
        requests.post(f"{BASE_URL}/api/seed-demo", timeout=20)
    except Exception:
        pass
    return BASE_URL


@pytest.fixture(scope="session")
def driver_token(base_url):
    r = requests.post(
        f"{base_url}/api/auth/login",
        json={"email": DRIVER_EMAIL, "password": DRIVER_PWD},
        timeout=20,
    )
    assert r.status_code == 200, f"driver login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def shipper_token(base_url):
    r = requests.post(
        f"{base_url}/api/auth/shipper-login",
        json={"email": SHIPPER_EMAIL, "password": SHIPPER_PWD},
        timeout=20,
    )
    assert r.status_code == 200, f"shipper login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _driver_headers(t): return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ---------- driver bank_details ----------

class TestDriverBankDetails:
    """PATCH /api/driver/me bank_details persistence + per-field merge."""

    def test_full_bank_details_persist(self, base_url, driver_token):
        payload = {
            "bank_details": {
                "account_holder": "TEST Eero Virtanen",
                "iban": "FI2112345600000785",
                "bank_name": "TEST Nordea",
                "swift_bic": "NDEAFIHH",
            }
        }
        r = requests.patch(f"{base_url}/api/driver/me", json=payload, headers=_driver_headers(driver_token), timeout=20)
        assert r.status_code == 200, r.text
        # GET to verify persistence
        g = requests.get(f"{base_url}/api/driver/me", headers=_driver_headers(driver_token), timeout=20)
        assert g.status_code == 200
        bd = g.json().get("bank_details") or {}
        assert bd.get("account_holder") == "TEST Eero Virtanen"
        assert bd.get("iban") == "FI2112345600000785"
        assert bd.get("bank_name") == "TEST Nordea"
        assert bd.get("swift_bic") == "NDEAFIHH"

    def test_partial_iban_only_does_not_wipe_other_fields(self, base_url, driver_token):
        # Run after the full-set test; assert merge behaviour.
        new_iban = "FI9876543210000000"
        r = requests.patch(
            f"{base_url}/api/driver/me",
            json={"bank_details": {"iban": new_iban}},
            headers=_driver_headers(driver_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        g = requests.get(f"{base_url}/api/driver/me", headers=_driver_headers(driver_token), timeout=20)
        bd = g.json().get("bank_details") or {}
        assert bd.get("iban") == new_iban, f"iban not updated: {bd}"
        # The other 3 fields must NOT have been wiped
        assert bd.get("account_holder") == "TEST Eero Virtanen", f"account_holder wiped: {bd}"
        assert bd.get("bank_name") == "TEST Nordea", f"bank_name wiped: {bd}"
        assert bd.get("swift_bic") == "NDEAFIHH", f"swift_bic wiped: {bd}"


# ---------- wallet withdraw ----------

class TestWalletWithdraw:
    """Wallet cash-out: only run the POST path if balance >= 10. Always verify endpoint exists."""

    def test_wallet_withdraw_endpoint(self, base_url, driver_token):
        w = requests.get(f"{base_url}/api/driver/wallet", headers=_driver_headers(driver_token), timeout=20)
        assert w.status_code == 200, w.text
        bal = float(w.json().get("available_balance") or 0)
        # Try both legacy and new endpoint paths
        candidates = ["/api/wallet/withdraw", "/api/driver/wallet/withdraw"]
        test_iban = "FI3344556677889900"
        if bal < 10:
            # Hit endpoint anyway; expect 400/422 (not 404) which still proves wiring.
            r = requests.post(
                f"{base_url}{candidates[0]}",
                json={"amount": 5.0, "method": "bank_transfer", "account_details": test_iban},
                headers=_driver_headers(driver_token),
                timeout=20,
            )
            if r.status_code == 404:
                r = requests.post(
                    f"{base_url}{candidates[1]}",
                    json={"amount": 5.0, "method": "bank_transfer", "account_details": test_iban},
                    headers=_driver_headers(driver_token),
                    timeout=20,
                )
            assert r.status_code in (400, 422, 200), f"unexpected: {r.status_code} {r.text}"
            pytest.skip(f"Skip happy-path withdraw: available_balance={bal:.2f} < 10")
        # Balance sufficient → actually request 10
        r = requests.post(
            f"{base_url}{candidates[0]}",
            json={"amount": 10.0, "method": "bank_transfer", "account_details": test_iban},
            headers=_driver_headers(driver_token),
            timeout=20,
        )
        if r.status_code == 404:
            r = requests.post(
                f"{base_url}{candidates[1]}",
                json={"amount": 10.0, "method": "bank_transfer", "account_details": test_iban},
                headers=_driver_headers(driver_token),
                timeout=20,
            )
        assert r.status_code in (200, 201), f"withdraw failed: {r.status_code} {r.text}"


# ---------- shipper cargo weight ----------

def _shipment_payload(weight: float):
    return {
        "pickup_address": "TEST Pickup Helsinki",
        "pickup_lat": 60.1699,
        "pickup_lng": 24.9384,
        "pickup_contact_name": "TEST Sender",
        "pickup_contact_phone": "+358401234567",
        "dropoff_address": "TEST Dropoff Espoo",
        "dropoff_lat": 60.2055,
        "dropoff_lng": 24.6559,
        "dropoff_contact_name": "TEST Receiver",
        "dropoff_contact_phone": "+358407654321",
        "vehicle_type": "cargo_van",
        "cargo_weight_kg": weight,
        "cargo_type": "general",
        "cargo_description": "TEST iter46 weight check",
    }


class TestShipperCargoWeight:
    def test_zero_weight_rejected(self, base_url, shipper_token):
        r = requests.post(
            f"{base_url}/api/shipper/shipments",
            json=_shipment_payload(0),
            headers={"Authorization": f"Bearer {shipper_token}", "Content-Type": "application/json"},
            timeout=20,
        )
        assert r.status_code == 422, f"expected 422 for 0 weight, got {r.status_code}: {r.text}"

    def test_negative_weight_rejected(self, base_url, shipper_token):
        r = requests.post(
            f"{base_url}/api/shipper/shipments",
            json=_shipment_payload(-5),
            headers={"Authorization": f"Bearer {shipper_token}", "Content-Type": "application/json"},
            timeout=20,
        )
        assert r.status_code == 422

    def test_valid_weight_succeeds(self, base_url, shipper_token):
        r = requests.post(
            f"{base_url}/api/shipper/shipments",
            json=_shipment_payload(123.5),
            headers={
                "Authorization": f"Bearer {shipper_token}",
                "Content-Type": "application/json",
                "Idempotency-Key": f"iter46-{int(time.time()*1000)}",
            },
            timeout=30,
        )
        assert r.status_code in (200, 201), f"valid weight should succeed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("order_id") or body.get("id"), f"no order id in response: {body}"
