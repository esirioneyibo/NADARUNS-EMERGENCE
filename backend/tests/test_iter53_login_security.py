"""
Iteration 53 - Login security P3 hardening verification.

Coverage:
  - REGRESSION: driver/shipper/admin login still succeed and tokens work on
    protected routes (/api/driver/me, /api/shipper/me, /api/admin/manage/drivers).
  - RATE LIMITING: 5 failed attempts with the SAME throwaway email on
    /api/auth/login, /api/auth/shipper-login, /api/auth/admin-login produce a
    6th-attempt 429 ("Too many failed attempts...").
  - RATE LIMIT ISOLATION: a locked throwaway email does not lock a DIFFERENT
    throwaway email.
  - RESET ON SUCCESS: failed attempts followed by a successful login resets the
    throttle counter (verified using the real demo driver with <5 failures so
    the account never crosses the lockout threshold).
  - SUSPENDED-ACCOUNT BLOCK: admin suspends demo driver -> driver login = 403,
    admin reactivates -> driver login = 200. (Demo account is restored.)
  - CORS: API reachable with no CORS_ALLOWED_ORIGINS env (regression sanity).

Throttle is in-memory per-process (5 failures / 5 min window, per-email key).
All bruteforce tests use throwaway emails so demo accounts stay unlocked.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or os.environ.get("EXPO_BACKEND_URL")
            or "https://nadaruns-logistics.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DRIVER_EMAIL = "demo.driver@nadaruns.com"
DRIVER_PASSWORD = "demo1234"
SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
SHIPPER_PASSWORD = "demo1234"
ADMIN_EMAIL = "admin@nadaruns.com"
ADMIN_PASSWORD = "admin123"


# ---------- Shared fixtures ----------
@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session", autouse=True)
def seed_demo(http):
    # Idempotent: ensure demo accounts exist before logins
    try:
        http.post(f"{API}/seed-demo", timeout=30)
    except Exception:
        pass
    yield


def _login_driver(http, email=DRIVER_EMAIL, password=DRIVER_PASSWORD):
    return http.post(f"{API}/auth/login",
                     json={"email": email, "password": password}, timeout=20)


def _login_shipper(http, email=SHIPPER_EMAIL, password=SHIPPER_PASSWORD):
    return http.post(f"{API}/auth/shipper-login",
                     json={"email": email, "password": password}, timeout=20)


def _login_admin(http, email=ADMIN_EMAIL, password=ADMIN_PASSWORD):
    return http.post(f"{API}/auth/admin-login",
                     json={"email": email, "password": password}, timeout=20)


# ---------- Regression: logins still work ----------
class TestLoginRegression:
    def test_driver_login_ok_and_me(self, http):
        r = _login_driver(http)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("token")
        assert body.get("driver_id")
        token = body["token"]

        # Protected route
        me = http.get(f"{API}/driver/me",
                      headers={"Authorization": f"Bearer {token}"}, timeout=20)
        assert me.status_code == 200, me.text
        data = me.json()
        # accept either nested or flat shape
        email_val = data.get("email") or (data.get("driver") or {}).get("email")
        assert email_val == DRIVER_EMAIL

    def test_shipper_login_ok_and_me(self, http):
        r = _login_shipper(http)
        assert r.status_code == 200, r.text
        token = r.json()["token"]
        me = http.get(f"{API}/shipper/me",
                      headers={"Authorization": f"Bearer {token}"}, timeout=20)
        assert me.status_code == 200, me.text
        data = me.json()
        email_val = data.get("email") or (data.get("shipper") or {}).get("email")
        assert email_val == SHIPPER_EMAIL

    def test_admin_login_ok_and_protected(self, http):
        r = _login_admin(http)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("is_admin") is True
        token = body["token"]
        # admin-only list endpoint
        resp = http.get(f"{API}/admin/manage/drivers",
                        headers={"Authorization": f"Bearer {token}"}, timeout=20)
        assert resp.status_code == 200, resp.text
        # Must be JSON (list or dict with items)
        data = resp.json()
        assert isinstance(data, (list, dict))


# ---------- Rate limiting ----------
def _bruteforce_email(prefix: str) -> str:
    # unique throwaway per run - never matches any real account
    return f"bruteforce-{prefix}-{uuid.uuid4().hex[:8]}@nadaruns.com"


class TestRateLimiting:
    def test_driver_login_rate_limit_429_on_6th(self, http):
        email = _bruteforce_email("driver")
        # 5 failed attempts -> 401 each
        for i in range(5):
            r = _login_driver(http, email=email, password="wrongpass!!")
            assert r.status_code == 401, f"attempt {i+1}: {r.status_code} {r.text}"
        # 6th attempt -> 429
        r6 = _login_driver(http, email=email, password="wrongpass!!")
        assert r6.status_code == 429, f"expected 429, got {r6.status_code} {r6.text}"
        assert "Too many" in r6.text or "too many" in r6.text.lower()

    def test_shipper_login_rate_limit_429_on_6th(self, http):
        email = _bruteforce_email("shipper")
        for i in range(5):
            r = _login_shipper(http, email=email, password="wrongpass!!")
            assert r.status_code == 401, f"attempt {i+1}: {r.status_code} {r.text}"
        r6 = _login_shipper(http, email=email, password="wrongpass!!")
        assert r6.status_code == 429, f"expected 429, got {r6.status_code} {r6.text}"

    def test_admin_login_rate_limit_429_on_6th(self, http):
        # Throwaway admin email - never matches ADMIN_EMAIL so success can't happen
        email = _bruteforce_email("admin")
        for i in range(5):
            r = _login_admin(http, email=email, password="wrongpass!!")
            assert r.status_code == 401, f"attempt {i+1}: {r.status_code} {r.text}"
        r6 = _login_admin(http, email=email, password="wrongpass!!")
        assert r6.status_code == 429, f"expected 429, got {r6.status_code} {r6.text}"

    def test_rate_limit_isolation_across_emails(self, http):
        # Lock email A
        email_a = _bruteforce_email("iso-a")
        for _ in range(5):
            _login_driver(http, email=email_a, password="wrongpass!!")
        # 6th = 429
        ra = _login_driver(http, email=email_a, password="wrongpass!!")
        assert ra.status_code == 429

        # Email B must NOT be locked - one failed attempt should still 401
        email_b = _bruteforce_email("iso-b")
        rb = _login_driver(http, email=email_b, password="wrongpass!!")
        assert rb.status_code == 401, f"isolation broken: {rb.status_code} {rb.text}"

    def test_successful_login_resets_throttle(self, http):
        # Use the real demo driver but stay UNDER the 5-failure threshold so we
        # never actually lock the demo account.
        for i in range(3):
            r = _login_driver(http, email=DRIVER_EMAIL, password="wrongpass!!")
            assert r.status_code == 401, f"attempt {i+1}: {r.status_code}"
        # Successful login should clear the counter
        ok = _login_driver(http)
        assert ok.status_code == 200, ok.text
        # After reset we should be able to fail 5 times again before lockout.
        # Sanity: fail 4 more and the 5th should still be 401 (not 429).
        last = None
        for _ in range(4):
            last = _login_driver(http, email=DRIVER_EMAIL, password="wrongpass!!")
            assert last.status_code == 401, last.text
        # Restore: a successful login again resets so we leave demo unlocked.
        ok2 = _login_driver(http)
        assert ok2.status_code == 200, ok2.text


# ---------- Suspended-account block ----------
class TestSuspendedAccountBlock:
    def test_suspended_driver_blocked_then_reactivated(self, http):
        # 0) Admin token
        admin_r = _login_admin(http)
        assert admin_r.status_code == 200, admin_r.text
        admin_tok = admin_r.json()["token"]
        admin_hdr = {"Authorization": f"Bearer {admin_tok}"}

        # 1) Find demo driver id (login as demo driver works -> /me)
        d_login = _login_driver(http)
        assert d_login.status_code == 200, d_login.text
        driver_id = d_login.json()["driver_id"]
        assert driver_id

        try:
            # 2) Suspend
            sus = http.post(f"{API}/admin/manage/drivers/{driver_id}/suspend",
                            headers=admin_hdr, timeout=20)
            assert sus.status_code == 200, sus.text
            assert sus.json().get("status") == "suspended"

            # 3) Login attempt -> 403 'suspended'
            blocked = _login_driver(http)
            assert blocked.status_code == 403, blocked.text
            assert "suspend" in blocked.text.lower()
        finally:
            # 4) ALWAYS reactivate - demo account must end usable
            act = http.post(f"{API}/admin/manage/drivers/{driver_id}/activate",
                            headers=admin_hdr, timeout=20)
            assert act.status_code == 200, act.text

        # 5) Login works again
        ok = _login_driver(http)
        assert ok.status_code == 200, f"demo driver did NOT recover: {ok.text}"


# ---------- CORS / reachability sanity ----------
class TestCorsAndReachability:
    def test_api_reachable_no_cors_breakage(self, http):
        # Basic GET should succeed without any Origin header
        r = http.get(f"{API}/seed-demo", timeout=20)
        # Endpoint may be GET-not-allowed; we only care that the request reaches
        # the app (i.e., CORS middleware didn't drop it).
        assert r.status_code in (200, 204, 404, 405), r.status_code

    def test_login_with_origin_header_still_works(self, http):
        # Simulate a browser request with an Origin header. With wildcard origin
        # & no credentials, this should still succeed.
        r = requests.post(
            f"{API}/auth/login",
            json={"email": DRIVER_EMAIL, "password": DRIVER_PASSWORD},
            headers={"Content-Type": "application/json",
                     "Origin": "https://example.com"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        # Wildcard CORS should be advertised (no credentials)
        acao = r.headers.get("access-control-allow-origin")
        # Some proxies strip this header; only assert when present
        if acao is not None:
            assert acao in ("*", "https://example.com"), acao
        acac = r.headers.get("access-control-allow-credentials")
        # With wildcard, credentials must NOT be true
        if acac is not None:
            assert acac.lower() != "true", f"credentials enabled with wildcard: {acac}"
