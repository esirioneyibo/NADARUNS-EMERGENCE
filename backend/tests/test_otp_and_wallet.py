"""Iteration 3 tests: OTP verification + Wallet endpoint."""
import os
import requests
import pytest

BASE = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://delivery-ui-kit-3.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def pending_order():
    # Force a fresh pending order so we know the OTPs
    r = requests.post(f"{BASE}/api/orders/seed-new-pending", timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


# ============ OTP fields on pending order ============

class TestPendingOrderOtpFields:
    def test_pending_has_4digit_otps_unverified(self, pending_order):
        o = pending_order
        assert isinstance(o.get("pickup_otp"), str) and len(o["pickup_otp"]) == 4
        assert o["pickup_otp"].isdigit()
        assert isinstance(o.get("dropoff_otp"), str) and len(o["dropoff_otp"]) == 4
        assert o["dropoff_otp"].isdigit()
        assert o["pickup_otp_verified"] is False
        assert o["dropoff_otp_verified"] is False


# ============ verify-otp endpoint ============

class TestVerifyOtp:
    def test_invalid_otp_returns_400(self, pending_order):
        r = requests.post(
            f"{BASE}/api/orders/{pending_order['id']}/verify-otp",
            json={"otp": "0000" if pending_order["pickup_otp"] != "0000" else "1111",
                  "kind": "pickup"},
            timeout=15,
        )
        assert r.status_code == 400
        assert "invalid" in r.json().get("detail", "").lower()

    def test_nonexistent_order_returns_404(self):
        r = requests.post(
            f"{BASE}/api/orders/nonexistent-id-xyz/verify-otp",
            json={"otp": "1234", "kind": "pickup"},
            timeout=15,
        )
        assert r.status_code == 404

    def test_correct_pickup_otp_marks_pickup_verified(self, pending_order):
        r = requests.post(
            f"{BASE}/api/orders/{pending_order['id']}/verify-otp",
            json={"otp": pending_order["pickup_otp"], "kind": "pickup"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["pickup_otp_verified"] is True
        assert body["dropoff_otp_verified"] is False
        assert body["id"] == pending_order["id"]

    def test_correct_dropoff_otp_marks_dropoff_verified(self, pending_order):
        r = requests.post(
            f"{BASE}/api/orders/{pending_order['id']}/verify-otp",
            json={"otp": pending_order["dropoff_otp"], "kind": "dropoff"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["dropoff_otp_verified"] is True
        # pickup still verified from earlier test
        assert body["pickup_otp_verified"] is True


# ============ Wallet endpoint (authenticated) ============

@pytest.fixture(scope="module")
def driver_token():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "demo.driver@nadaruns.com", "password": "demo1234"},
        timeout=20,
    )
    assert r.status_code == 200, f"driver login failed: {r.text}"
    return r.json()["token"]


class TestWallet:
    def test_requires_auth(self):
        # Wallet is scoped per-driver and must reject unauthenticated access.
        r = requests.get(f"{BASE}/api/driver/wallet", timeout=20)
        assert r.status_code in (401, 403), r.text

    def test_wallet_structure_and_balances(self, driver_token):
        r = requests.get(
            f"{BASE}/api/driver/wallet",
            headers={"Authorization": f"Bearer {driver_token}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        w = r.json()

        assert isinstance(w["available_balance"], (int, float))
        assert isinstance(w["pending_balance"], (int, float))
        assert w["available_balance"] >= 0
        assert w["pending_balance"] >= 0

        assert isinstance(w["payout_schedule"], str) and w["payout_schedule"]

        assert isinstance(w["next_payout_date"], str)
        # ISO date YYYY-MM-DD
        assert len(w["next_payout_date"]) >= 10
        assert w["next_payout_date"][4] == "-" and w["next_payout_date"][7] == "-"

        # transactions is always a list (may be empty for a freshly-seeded driver)
        assert isinstance(w["transactions"], list)

    def test_wallet_transactions_shape_and_sorted_desc(self, driver_token):
        r = requests.get(
            f"{BASE}/api/driver/wallet",
            headers={"Authorization": f"Bearer {driver_token}"},
            timeout=20,
        )
        w = r.json()
        txns = w["transactions"]
        # When transactions exist they must carry type/amount and be newest-first.
        for t in txns:
            assert "type" in t and "amount" in t
        if txns:
            payouts = [t for t in txns if t["type"] == "payout"]
            assert all(p["amount"] < 0 for p in payouts)
            timestamps = [t["timestamp"] for t in txns]
            assert timestamps == sorted(timestamps, reverse=True)

    def test_wallet_tip_rows_are_positive(self, driver_token):
        r = requests.get(
            f"{BASE}/api/driver/wallet",
            headers={"Authorization": f"Bearer {driver_token}"},
            timeout=20,
        )
        w = r.json()
        tips = [t for t in w["transactions"] if t["type"] == "tip"]
        for t in tips:
            assert t["amount"] > 0
            assert "tip" in t["description"].lower() or "from" in t["description"].lower()
