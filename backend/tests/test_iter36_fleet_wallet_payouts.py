"""Phase 3/4/5 — Company Wallet, Payouts, Admin Fleet dashboard.

Money flow under test:
  1. Demo driver owns a company; set self_accept; seed pending order; accept; advance to delivered.
  2. Wallet is credited (available_balance + total_earnings) with a matching 'earning' txn.
  3. POST /company/payouts -> pending, available -> pending move.
  4. Admin GET payouts -> approve -> pay (paid, pending -> total_withdrawn).
  5. Reject path on a fresh payout refunds pending -> available.
  6. payout > available -> 400.
  7. Admin /admin/fleet/companies list+detail+suspend/activate; non-admin (driver) -> 401/403.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL is required"

DRIVER_EMAIL = "demo.driver@nadaruns.com"
DRIVER_PASSWORD = "demo1234"
ADMIN_EMAIL = "admin@nadaruns.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def driver_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": DRIVER_EMAIL, "password": DRIVER_PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/admin-login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def company(driver_token):
    # Try create — pre-existing is OK (400 already belong).
    r = requests.post(f"{BASE_URL}/api/company", headers=_h(driver_token),
                      json={"company_name": "Nordic Transport Oy"}, timeout=20)
    assert r.status_code in (200, 201, 400), r.text
    me = requests.get(f"{BASE_URL}/api/company/me", headers=_h(driver_token), timeout=20)
    assert me.status_code == 200, me.text
    return me.json()["company"]


@pytest.fixture(scope="module")
def company_id(company):
    return company["id"]


def _set_mode(driver_token, mode):
    r = requests.patch(f"{BASE_URL}/api/company", headers=_h(driver_token),
                       json={"job_acceptance_mode": mode}, timeout=20)
    assert r.status_code == 200, r.text


def _wallet(driver_token):
    r = requests.get(f"{BASE_URL}/api/company/wallet", headers=_h(driver_token), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 1. Earnings split ----------

class TestEarningsSplit:
    def test_delivery_credits_company_wallet(self, driver_token, company_id):
        _set_mode(driver_token, "self_accept")
        wallet_before = _wallet(driver_token)["wallet"]
        avail_before = float(wallet_before.get("available_balance", 0))
        total_before = float(wallet_before.get("total_earnings", 0))

        # Seed a fresh pending order
        seed = requests.post(f"{BASE_URL}/api/orders/seed-new-pending", timeout=20)
        assert seed.status_code == 200, seed.text
        order = seed.json()
        order_id = order["id"]

        # Accept (self_accept by company owner -> records assigned_company_id)
        acc = requests.post(f"{BASE_URL}/api/orders/{order_id}/accept",
                            headers=_h(driver_token), json={}, timeout=20)
        assert acc.status_code == 200, acc.text

        # Advance until delivered (state machine sequential transitions)
        for _ in range(8):
            r = requests.post(f"{BASE_URL}/api/orders/{order_id}/advance",
                              headers=_h(driver_token), json={}, timeout=20)
            assert r.status_code == 200, r.text
            if r.json().get("status") == "delivered":
                break
        else:
            pytest.fail("order never reached delivered")

        # Verify wallet credited
        time.sleep(0.5)
        wallet_after = _wallet(driver_token)
        w = wallet_after["wallet"]
        net = round(float(order.get("earnings") or 0) + float(order.get("tip") or 0), 2)
        assert net > 0, f"order has zero net earnings: {order}"

        avail_after = float(w["available_balance"])
        total_after = float(w["total_earnings"])
        assert round(avail_after - avail_before, 2) == net, (
            f"available_balance delta {avail_after - avail_before} != net {net}")
        assert round(total_after - total_before, 2) == net, (
            f"total_earnings delta {total_after - total_before} != net {net}")

        # Earning txn present with fee fields
        txns = wallet_after["transactions"]
        earn = next((x for x in txns if x.get("type") == "earning" and x.get("order_id") == order_id), None)
        assert earn is not None, "no earning txn for this order"
        assert earn.get("amount") == net
        assert earn.get("gross_amount") is not None
        assert earn.get("platform_fee") is not None
        assert earn.get("company_earnings") == net


# ---------- 2. Payout lifecycle ----------

class TestPayoutLifecycle:
    def test_payout_amount_exceeds_available_returns_400(self, driver_token):
        w = _wallet(driver_token)["wallet"]
        bad = float(w["available_balance"]) + 1000.0
        r = requests.post(f"{BASE_URL}/api/company/payouts", headers=_h(driver_token),
                          json={"amount": bad}, timeout=20)
        assert r.status_code == 400, r.text

    def test_full_payout_lifecycle_approve_pay(self, driver_token, admin_token):
        w_before = _wallet(driver_token)["wallet"]
        avail_before = float(w_before["available_balance"])
        pending_before = float(w_before["pending_balance"])
        withdrawn_before = float(w_before["total_withdrawn"])
        assert avail_before > 0, "need an available balance for this test"
        amount = round(min(5.0, avail_before / 2 if avail_before > 2 else avail_before), 2)
        if amount <= 0:
            amount = round(avail_before, 2)

        # Request payout
        r = requests.post(f"{BASE_URL}/api/company/payouts", headers=_h(driver_token),
                          json={"amount": amount}, timeout=20)
        assert r.status_code == 200, r.text
        payout = r.json()["payout"]
        assert payout["status"] == "pending"
        assert (payout.get("reference") or "").startswith("PO-")
        payout_id = payout["id"]

        # Wallet moves available -> pending
        w_after_req = _wallet(driver_token)["wallet"]
        assert round(float(w_after_req["available_balance"]), 2) == round(avail_before - amount, 2)
        assert round(float(w_after_req["pending_balance"]), 2) == round(pending_before + amount, 2)

        # Admin sees it
        adm = requests.get(f"{BASE_URL}/api/admin/fleet/payouts", headers=_h(admin_token), timeout=20)
        assert adm.status_code == 200, adm.text
        assert any(p["id"] == payout_id for p in adm.json()["payouts"])

        # Approve
        ap = requests.post(f"{BASE_URL}/api/admin/fleet/payouts/{payout_id}/approve",
                           headers=_h(admin_token), timeout=20)
        assert ap.status_code == 200, ap.text

        # Pay
        pay = requests.post(f"{BASE_URL}/api/admin/fleet/payouts/{payout_id}/pay",
                            headers=_h(admin_token),
                            json={"reference": "BANKREF-TEST-001"}, timeout=20)
        assert pay.status_code == 200, pay.text

        # Wallet: pending -> withdrawn
        w_final = _wallet(driver_token)["wallet"]
        assert round(float(w_final["pending_balance"]), 2) == round(pending_before, 2), \
            "pending did not return to baseline"
        assert round(float(w_final["total_withdrawn"]) - withdrawn_before, 2) == amount, \
            "total_withdrawn did not increase by amount"

        # Payout body now paid w/ reference
        payouts = requests.get(f"{BASE_URL}/api/admin/fleet/payouts",
                               headers=_h(admin_token), timeout=20).json()["payouts"]
        rec = next(p for p in payouts if p["id"] == payout_id)
        assert rec["status"] == "paid"
        assert rec["reference"] == "BANKREF-TEST-001"

    def test_payout_reject_refunds_to_available(self, driver_token, admin_token):
        w_before = _wallet(driver_token)["wallet"]
        avail_before = float(w_before["available_balance"])
        if avail_before <= 0:
            pytest.skip("no available balance for reject test")
        amount = round(min(2.0, avail_before), 2)

        r = requests.post(f"{BASE_URL}/api/company/payouts", headers=_h(driver_token),
                          json={"amount": amount}, timeout=20)
        assert r.status_code == 200, r.text
        pid = r.json()["payout"]["id"]

        # Check pending grew
        wm = _wallet(driver_token)["wallet"]
        assert round(float(wm["available_balance"]), 2) == round(avail_before - amount, 2)

        # Reject
        rej = requests.post(f"{BASE_URL}/api/admin/fleet/payouts/{pid}/reject",
                            headers=_h(admin_token),
                            json={"reason": "test rejection"}, timeout=20)
        assert rej.status_code == 200, rej.text

        w_after = _wallet(driver_token)["wallet"]
        assert round(float(w_after["available_balance"]), 2) == round(avail_before, 2), \
            "available not refunded on reject"


# ---------- 3. Admin Fleet dashboard ----------

class TestAdminFleetDashboard:
    def test_list_companies_search_and_fields(self, admin_token, company):
        r = requests.get(f"{BASE_URL}/api/admin/fleet/companies",
                         headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data
        assert any(c["id"] == company["id"] for c in data["items"])
        item = next(c for c in data["items"] if c["id"] == company["id"])
        for k in ("owner_name", "driver_count", "vehicle_count",
                  "available_balance", "total_earnings", "status"):
            assert k in item, f"field {k} missing from admin company item"

        # Search filter (case-insensitive substring on name)
        # Use first 4 chars of company name to be robust to renaming
        prefix = (company.get("company_name") or "")[:4]
        if prefix:
            r2 = requests.get(f"{BASE_URL}/api/admin/fleet/companies",
                              headers=_h(admin_token), params={"search": prefix}, timeout=20)
            assert r2.status_code == 200
            assert any(c["id"] == company["id"] for c in r2.json()["items"])

    def test_company_detail(self, admin_token, company_id):
        r = requests.get(f"{BASE_URL}/api/admin/fleet/companies/{company_id}",
                         headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("company", "wallet", "drivers", "vehicles", "payouts", "stats"):
            assert k in d, f"detail missing {k}"
        assert d["company"]["id"] == company_id
        assert "completed_jobs" in d["stats"] and "active_jobs" in d["stats"]

    def test_suspend_then_activate(self, admin_token, company_id):
        sus = requests.post(f"{BASE_URL}/api/admin/fleet/companies/{company_id}/suspend",
                            headers=_h(admin_token), timeout=20)
        assert sus.status_code == 200
        d = requests.get(f"{BASE_URL}/api/admin/fleet/companies/{company_id}",
                         headers=_h(admin_token), timeout=20).json()
        assert d["company"]["status"] == "suspended"

        act = requests.post(f"{BASE_URL}/api/admin/fleet/companies/{company_id}/activate",
                            headers=_h(admin_token), timeout=20)
        assert act.status_code == 200
        d2 = requests.get(f"{BASE_URL}/api/admin/fleet/companies/{company_id}",
                          headers=_h(admin_token), timeout=20).json()
        assert d2["company"]["status"] == "active"

    def test_admin_endpoints_reject_driver_token(self, driver_token):
        """Non-admin (driver) must not see admin endpoints."""
        endpoints = [
            ("GET", "/api/admin/fleet/companies", None),
            ("GET", "/api/admin/fleet/payouts", None),
        ]
        for method, path, body in endpoints:
            if method == "GET":
                r = requests.get(f"{BASE_URL}{path}", headers=_h(driver_token), timeout=20)
            else:
                r = requests.request(method, f"{BASE_URL}{path}",
                                     headers=_h(driver_token), json=body or {}, timeout=20)
            assert r.status_code in (401, 403), f"{path} returned {r.status_code} for driver"

    def test_admin_endpoints_require_token(self):
        r = requests.get(f"{BASE_URL}/api/admin/fleet/companies", timeout=20)
        assert r.status_code in (401, 403)
