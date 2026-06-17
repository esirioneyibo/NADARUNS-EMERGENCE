"""One-tap pay-with-saved-card (off-session manual-capture authorization).

Covers: success -> order authorized, decline -> 402 + order stays unpaid,
ownership guard -> 404, and the already-paid guard -> 400.
"""
import os
import time
import uuid

import pytest
import requests

API = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nadaruns-logistics.preview.emergentagent.com").rstrip("/") + "/api"

SHIPPER = {"email": "demo.shipper@nadaruns.com", "password": "demo1234"}
HELSINKI = (60.1699, 24.9384)
ESPOO = (60.2055, 24.6559)


@pytest.fixture(scope="module")
def shipper_token():
    r = requests.post(f"{API}/auth/shipper-login", json=SHIPPER, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _ensure_customer(token):
    # Creating a setup-checkout session lazily provisions the Stripe customer.
    requests.post(f"{API}/shipper/payment-methods/setup-checkout", headers=_headers(token), json={}, timeout=25)


def _attach_card(test_pm: str) -> str:
    """Attach a Stripe test PaymentMethod token to the shipper's customer and
    return the resulting pm id. Imports the backend payments module so the
    Stripe API key is configured."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    from services import payments  # noqa: F401  (sets stripe.api_key)
    import stripe

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    load_dotenv(os.path.join(backend_dir, ".env"))

    async def _run():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        sh = await db.shippers.find_one({"email": SHIPPER["email"]}, {"_id": 0, "stripe_customer_id": 1})
        return sh["stripe_customer_id"]

    cid = asyncio.get_event_loop().run_until_complete(_run())
    pm = stripe.PaymentMethod.attach(test_pm, customer=cid)
    return pm.id


def _detach(pm_id: str):
    from services import payments  # noqa: F401
    import stripe
    try:
        stripe.PaymentMethod.detach(pm_id)
    except Exception:
        pass


def _create_order(token) -> str:
    body = {
        "pickup_address": "Helsinki Central", "pickup_lat": HELSINKI[0], "pickup_lng": HELSINKI[1],
        "pickup_contact_name": "A", "pickup_contact_phone": "+3581",
        "dropoff_address": "Espoo", "dropoff_lat": ESPOO[0], "dropoff_lng": ESPOO[1],
        "dropoff_contact_name": "B", "dropoff_contact_phone": "+3582",
        "vehicle_type": "cargo_van", "cargo_weight_kg": 120, "cargo_type": "general",
        "cargo_description": "regression", "urgency": "standard", "shipper_offer": 0,
    }
    r = requests.post(f"{API}/shipper/shipments", headers={**_headers(token), "Idempotency-Key": uuid.uuid4().hex}, json=body, timeout=30)
    assert r.status_code == 200, f"create order failed: {r.text}"
    return r.json()["order_id"]


class TestPayWithSavedCard:
    def test_success_authorizes_order(self, shipper_token):
        _ensure_customer(shipper_token)
        pm = _attach_card("pm_card_visa")
        try:
            oid = _create_order(shipper_token)
            r = requests.post(
                f"{API}/payments/orders/{oid}/pay-with-saved-card",
                headers=_headers(shipper_token),
                json={"payment_method_id": pm},
                timeout=30,
            )
            assert r.status_code == 200, r.text
            assert r.json()["payment_status"] == "authorized"

            # Paying again is rejected.
            again = requests.post(
                f"{API}/payments/orders/{oid}/pay-with-saved-card",
                headers=_headers(shipper_token),
                json={"payment_method_id": pm},
                timeout=30,
            )
            assert again.status_code == 400
        finally:
            _detach(pm)

    def test_declined_card_returns_402_and_keeps_order_unpaid(self, shipper_token):
        _ensure_customer(shipper_token)
        pm = _attach_card("pm_card_chargeCustomerFail")  # attaches, fails on charge
        try:
            oid = _create_order(shipper_token)
            r = requests.post(
                f"{API}/payments/orders/{oid}/pay-with-saved-card",
                headers=_headers(shipper_token),
                json={"payment_method_id": pm},
                timeout=30,
            )
            assert r.status_code == 402, r.text
            status = requests.get(f"{API}/payments/orders/{oid}/status", headers=_headers(shipper_token), timeout=20).json()
            assert status["payment_status"] == "unpaid"
        finally:
            _detach(pm)

    def test_unowned_payment_method_rejected(self, shipper_token):
        oid = _create_order(shipper_token)
        r = requests.post(
            f"{API}/payments/orders/{oid}/pay-with-saved-card",
            headers=_headers(shipper_token),
            json={"payment_method_id": "pm_card_visa"},  # a token, not attached to this customer
            timeout=30,
        )
        assert r.status_code in (403, 404), r.text
