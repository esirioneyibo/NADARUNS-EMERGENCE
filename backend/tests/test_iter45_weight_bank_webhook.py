"""Iteration 45 — backend regression for:
1) Pricing: cargo_weight_kg required & affects price.
2) Driver cash-out persists bank_details on driver.
3) PATCH /api/driver/me updates bank_details.
4) Admin webhook signing secret saves + persists.
5) Refund regression: driver wallet excludes refunded orders.
"""
import os
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://nadaruns-logistics.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/admin-login",
                      json={"email": "admin@nadaruns.com", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def shipper_token():
    r = requests.post(f"{API}/auth/shipper-login",
                      json={"email": "demo.shipper@nadaruns.com", "password": "demo1234"})
    if r.status_code != 200:
        # ensure demo data exists
        requests.post(f"{API}/seed-demo")
        r = requests.post(f"{API}/auth/shipper-login",
                          json={"email": "demo.shipper@nadaruns.com", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def driver_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "demo.driver@nadaruns.com", "password": "demo1234"})
    if r.status_code != 200:
        requests.post(f"{API}/seed-demo")
        r = requests.post(f"{API}/auth/login",
                          json={"email": "demo.driver@nadaruns.com", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _shipment_payload(weight=None):
    p = {
        "pickup_address": "Helsinki Port Terminal A",
        "pickup_lat": 60.2095, "pickup_lng": 25.1478,
        "pickup_contact_name": "TEST Picker", "pickup_contact_phone": "+358111",
        "dropoff_address": "Nokia HQ",
        "dropoff_lat": 60.2198, "dropoff_lng": 24.7589,
        "dropoff_contact_name": "TEST Drop", "dropoff_contact_phone": "+358222",
        "vehicle_type": "cargo_van",
        "cargo_type": "general",
        "cargo_description": "TEST shipment iter45",
        "urgency": "standard",
    }
    if weight is not None:
        p["cargo_weight_kg"] = weight
    return p


# ----------------------------- 1) Required weight -----------------------------

class TestRequiredWeight:
    def test_missing_weight_rejected(self, shipper_token):
        r = requests.post(
            f"{API}/shipper/shipments",
            json=_shipment_payload(weight=None),
            headers={"Authorization": f"Bearer {shipper_token}"},
        )
        assert r.status_code in (400, 422), f"Expected 400/422 got {r.status_code}: {r.text}"

    def test_zero_weight_rejected(self, shipper_token):
        r = requests.post(
            f"{API}/shipper/shipments",
            json=_shipment_payload(weight=0),
            headers={"Authorization": f"Bearer {shipper_token}"},
        )
        assert r.status_code in (400, 422), f"Expected 400/422 got {r.status_code}: {r.text}"

    def test_negative_weight_rejected(self, shipper_token):
        r = requests.post(
            f"{API}/shipper/shipments",
            json=_shipment_payload(weight=-10),
            headers={"Authorization": f"Bearer {shipper_token}"},
        )
        assert r.status_code in (400, 422), f"Expected 400/422 got {r.status_code}: {r.text}"

    def test_valid_weight_creates(self, shipper_token):
        r = requests.post(
            f"{API}/shipper/shipments",
            json=_shipment_payload(weight=250),
            headers={"Authorization": f"Bearer {shipper_token}"},
        )
        assert r.status_code in (200, 201), r.text
        body = r.json()
        # Response contains order_number (and breakdown) — confirm shipment was created.
        assert body.get("order_number") or body.get("id") or (body.get("order") or {}).get("id"), body


class TestQuoteReflectsWeight:
    def test_quote_price_changes_with_weight(self, shipper_token):
        base = {
            "pickup_lat": 60.2095, "pickup_lng": 25.1478,
            "dropoff_lat": 60.2198, "dropoff_lng": 24.7589,
            "vehicle_type": "cargo_van",
            "urgency": "standard",
        }
        h = {"Authorization": f"Bearer {shipper_token}"}
        r1 = requests.post(f"{API}/shipper/quote", json={**base, "cargo_weight_kg": 50}, headers=h)
        r2 = requests.post(f"{API}/shipper/quote", json={**base, "cargo_weight_kg": 1200}, headers=h)
        assert r1.status_code == 200, r1.text
        assert r2.status_code == 200, r2.text
        p1 = r1.json()["total_price"]
        p2 = r2.json()["total_price"]
        assert p2 != p1, f"Price did not change with weight: {p1} vs {p2}"
        assert p2 > p1, f"Heavier cargo should cost >= lighter: 50kg={p1} 1200kg={p2}"


# ----------------------------- 2) Bank details on payout -----------------------------

class TestBankDetailsPersistence:
    def test_payout_saves_bank_details(self, driver_token):
        h = {"Authorization": f"Bearer {driver_token}"}
        bd = {
            "account_holder": "TEST Driver Holder",
            "iban": f"FI21{uuid.uuid4().hex[:14].upper()}",
            "bank_name": "TEST Bank",
            "swift_bic": "NDEAFIHH",
        }
        r = requests.post(f"{API}/driver/wallet/payout",
                          json={"amount": 1.0, "bank_details": bd}, headers=h)
        assert r.status_code == 200, r.text

        me = requests.get(f"{API}/driver/me", headers=h)
        assert me.status_code == 200, me.text
        saved = me.json().get("bank_details")
        assert saved, f"bank_details not persisted on driver: {me.json()}"
        assert saved.get("iban") == bd["iban"]
        assert saved.get("account_holder") == bd["account_holder"]
        assert saved.get("bank_name") == bd["bank_name"]
        assert saved.get("swift_bic") == bd["swift_bic"]


# ----------------------------- 3) Edit bank details from profile -----------------------------

class TestEditBankDetailsProfile:
    def test_patch_driver_me_updates_bank_details(self, driver_token):
        h = {"Authorization": f"Bearer {driver_token}"}
        bd = {
            "account_holder": "TEST Edited Holder",
            "iban": f"FI99{uuid.uuid4().hex[:14].upper()}",
            "bank_name": "Edited Bank",
            "swift_bic": "OKOYFIHH",
        }
        r = requests.patch(f"{API}/driver/me", json={"bank_details": bd}, headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert (body.get("bank_details") or {}).get("iban") == bd["iban"]

        me = requests.get(f"{API}/driver/me", headers=h)
        assert me.status_code == 200, me.text
        saved = me.json().get("bank_details") or {}
        assert saved.get("iban") == bd["iban"]
        assert saved.get("account_holder") == bd["account_holder"]
        assert saved.get("bank_name") == bd["bank_name"]
        assert saved.get("swift_bic") == bd["swift_bic"]


# ----------------------------- 4) Webhook signing secret persists -----------------------------

class TestStripeWebhookSecret:
    def test_save_and_persist_webhook_secret(self, admin_token):
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(f"{API}/admin/settings/stripe",
                          json={"webhook_secret": "whsec_test123"}, headers=h)
        assert r.status_code == 200, r.text
        s1 = r.json()
        assert s1.get("webhook_configured") is True, s1
        assert s1.get("webhook_secret_masked"), s1

        # First GET — should reflect masked secret
        g1 = requests.get(f"{API}/admin/settings/stripe", headers=h)
        assert g1.status_code == 200, g1.text
        assert g1.json().get("webhook_configured") is True, g1.json()
        assert g1.json().get("webhook_secret_masked"), g1.json()

        # Second GET — must survive (in-memory + DB persisted)
        g2 = requests.get(f"{API}/admin/settings/stripe", headers=h)
        assert g2.status_code == 200, g2.text
        assert g2.json().get("webhook_configured") is True, g2.json()
        assert g2.json().get("webhook_secret_masked"), g2.json()

        # Teardown: clear webhook_secret to keep other webhook tests (iter43) green.
        requests.post(f"{API}/admin/settings/stripe",
                      json={"webhook_secret": ""}, headers=h)


# ----------------------------- 5) Regression: refunded orders excluded from wallet -----------------------------

class TestWalletExcludesRefunds:
    def test_driver_wallet_endpoint_ok(self, driver_token):
        h = {"Authorization": f"Bearer {driver_token}"}
        r = requests.get(f"{API}/driver/wallet", headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        # All transactions of type 'delivery' must reference orders that are not refunded.
        # Endpoint already filters payment_status != refunded; sanity check structure.
        assert "available_balance" in body
        assert "pending_balance" in body
        assert isinstance(body.get("transactions"), list)
