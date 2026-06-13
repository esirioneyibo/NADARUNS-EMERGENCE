"""Iter-31 backend tests: Shipper saved-payment-methods (Stripe SetupIntent via Checkout)
covers list/setup-checkout/set-default/delete + ownership-guard.
"""
import os
import pytest
import requests
import stripe

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nadaruns-logistics.preview.emergentagent.com").rstrip("/")
SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
SHIPPER_PASSWORD = "demo1234"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def shipper_token(session):
    # Ensure demo data
    session.post(f"{BASE_URL}/api/seed-demo", timeout=20)
    r = session.post(
        f"{BASE_URL}/api/auth/shipper-login",
        json={"email": SHIPPER_EMAIL, "password": SHIPPER_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(shipper_token):
    return {"Authorization": f"Bearer {shipper_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def stripe_key():
    # Always read backend/.env first (env may carry placeholder sk_test_emergent)
    key = None
    try:
        with open("/app/backend/.env") as f:
            for line in f:
                if line.startswith("STRIPE_API_KEY"):
                    key = line.split("=", 1)[1].strip().strip('"').strip()
                    break
    except Exception:
        pass
    if not key or not key.startswith("sk_test_") or len(key) < 30:
        key = os.environ.get("STRIPE_API_KEY")
    assert key and key.startswith("sk_test_"), "STRIPE_API_KEY (test) is required"
    stripe.api_key = key
    return key


class TestPaymentMethodsAuth:
    def test_list_requires_auth(self, session):
        r = session.get(f"{BASE_URL}/api/shipper/payment-methods", timeout=15)
        assert r.status_code in (401, 403)

    def test_setup_requires_auth(self, session):
        r = session.post(f"{BASE_URL}/api/shipper/payment-methods/setup-checkout", json={}, timeout=15)
        assert r.status_code in (401, 403)


class TestPaymentMethodsFlow:
    def test_list_initial(self, session, auth_headers):
        r = session.get(f"{BASE_URL}/api/shipper/payment-methods", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "customer_id" in data
        assert "payment_methods" in data
        assert isinstance(data["payment_methods"], list)

    def test_setup_checkout_returns_stripe_url(self, session, auth_headers):
        r = session.post(
            f"{BASE_URL}/api/shipper/payment-methods/setup-checkout",
            json={
                "success_url": "https://example.com/ok",
                "cancel_url": "https://example.com/cancel",
            },
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "url" in data and "session_id" in data
        # Stripe hosted Checkout URLs live on checkout.stripe.com
        assert "checkout.stripe.com" in data["url"], data["url"]
        assert data["session_id"].startswith("cs_"), data["session_id"]

    def test_customer_id_persisted(self, session, auth_headers):
        # After setup-checkout, the shipper should have a stripe_customer_id
        r = session.get(f"{BASE_URL}/api/shipper/payment-methods", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["customer_id"] is not None
        assert data["customer_id"].startswith("cus_")


class TestPaymentMethodsCRUD:
    """Seed a card via Stripe library, list / default / delete it."""

    @pytest.fixture(scope="class")
    def attached_pm(self, session, auth_headers, stripe_key):
        # Get shipper customer id
        r = session.get(f"{BASE_URL}/api/shipper/payment-methods", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        customer_id = r.json()["customer_id"]
        assert customer_id, "shipper must have a stripe customer first"
        # Attach pm_card_visa to this customer
        pm = stripe.PaymentMethod.attach("pm_card_visa", customer=customer_id)
        yield pm.id, customer_id
        # Cleanup
        try:
            stripe.PaymentMethod.detach(pm.id)
        except Exception:
            pass

    def test_list_shows_attached_card(self, session, auth_headers, attached_pm):
        pm_id, _cust = attached_pm
        r = session.get(f"{BASE_URL}/api/shipper/payment-methods", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        cards = data["payment_methods"]
        match = next((c for c in cards if c["id"] == pm_id), None)
        assert match is not None, f"attached pm {pm_id} not in list: {cards}"
        assert match["brand"] == "visa"
        assert match["last4"] == "4242"
        assert isinstance(match["is_default"], bool)

    def test_set_default_flips_flag(self, session, auth_headers, attached_pm):
        pm_id, _ = attached_pm
        r = session.post(
            f"{BASE_URL}/api/shipper/payment-methods/{pm_id}/default",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # Verify via list
        r2 = session.get(f"{BASE_URL}/api/shipper/payment-methods", headers=auth_headers, timeout=15)
        cards = r2.json()["payment_methods"]
        match = next(c for c in cards if c["id"] == pm_id)
        assert match["is_default"] is True

    def test_ownership_guard_returns_403(self, session, auth_headers, stripe_key):
        """A pm not belonging to this shipper should yield 403."""
        # Create a brand new customer with its own pm — guaranteed not owned by us
        other = stripe.Customer.create(email="other@test.local")
        try:
            pm = stripe.PaymentMethod.attach("pm_card_amex", customer=other.id)
            r = session.post(
                f"{BASE_URL}/api/shipper/payment-methods/{pm.id}/default",
                headers=auth_headers,
                timeout=15,
            )
            assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"
            r2 = session.delete(
                f"{BASE_URL}/api/shipper/payment-methods/{pm.id}",
                headers=auth_headers,
                timeout=15,
            )
            assert r2.status_code == 403
        finally:
            try:
                stripe.PaymentMethod.detach(pm.id)
            except Exception:
                pass
            try:
                stripe.Customer.delete(other.id)
            except Exception:
                pass

    def test_delete_removes_card(self, session, auth_headers, attached_pm):
        pm_id, _ = attached_pm
        r = session.delete(
            f"{BASE_URL}/api/shipper/payment-methods/{pm_id}",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        # Verify
        r2 = session.get(f"{BASE_URL}/api/shipper/payment-methods", headers=auth_headers, timeout=15)
        cards = r2.json()["payment_methods"]
        assert all(c["id"] != pm_id for c in cards), f"pm {pm_id} still present"
