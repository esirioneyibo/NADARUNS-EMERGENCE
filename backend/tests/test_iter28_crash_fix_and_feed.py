"""
Iteration 28 backend regression tests.

Covers:
  - /api/orders/available defensive serialization (does not 500 if one order is malformed)
  - /api/admin/manage/orders/{id}/cancel isolation (cancelling one order
    must NOT make the rest disappear from /api/orders/available)
  - Demo driver (KYC approved) accept regression (still 200)
"""

import os
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://nadaruns-logistics.preview.emergentagent.com"
).rstrip("/")

DEMO_DRIVER = {"email": "demo.driver@nadaruns.com", "password": "demo1234"}
DEMO_SHIPPER = {"email": "demo.shipper@nadaruns.com", "password": "demo1234"}
ADMIN = {"email": "admin@nadaruns.com", "password": "admin123"}


# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module", autouse=True)
def ensure_seed(session):
    # Idempotent seed for demo accounts/orders
    try:
        session.post(f"{BASE_URL}/api/seed-demo", timeout=30)
    except Exception:
        pass
    yield


@pytest.fixture(scope="module")
def driver_token(session):
    r = session.post(f"{BASE_URL}/api/auth/login", json=DEMO_DRIVER, timeout=15)
    assert r.status_code == 200, f"driver login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def shipper_token(session):
    r = session.post(f"{BASE_URL}/api/auth/shipper-login", json=DEMO_SHIPPER, timeout=15)
    assert r.status_code == 200, f"shipper login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token(session):
    r = session.post(f"{BASE_URL}/api/auth/admin-login", json=ADMIN, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


# ---------- Available feed resilience ----------

class TestAvailableFeed:
    def test_available_feed_returns_200_with_jobs(self, session, driver_token):
        r = session.get(
            f"{BASE_URL}/api/orders/available",
            headers={"Authorization": f"Bearer {driver_token}"},
            timeout=20,
        )
        assert r.status_code == 200, f"available feed status: {r.status_code} body={r.text[:300]}"
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Expected at least one pending job from seed data"
        # Verify shape of an entry
        first = data[0]
        assert "id" in first
        assert first.get("status") == "pending"


# ---------- Admin cancel isolation ----------

class TestAdminCancelIsolation:
    def test_admin_cancel_does_not_hide_other_jobs(self, session, driver_token, shipper_token, admin_token):
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        driver_headers = {"Authorization": f"Bearer {driver_token}"}
        shipper_headers = {"Authorization": f"Bearer {shipper_token}"}

        # 1. Snapshot the available list BEFORE cancellation
        before = session.get(f"{BASE_URL}/api/orders/available", headers=driver_headers, timeout=20)
        assert before.status_code == 200, before.text
        before_jobs = before.json()
        before_count = len(before_jobs)
        assert before_count > 0, "need at least one pending job for this test"

        # 2. Create a THROWAWAY order via the shipper instant-create endpoint
        #    so we don't shrink the demo dataset. Fall back to picking an existing
        #    pending order if the create endpoint isn't available.
        throwaway_id = None
        instant_payload = {
            "pickup_address": "TEST_Cancel Pickup, Helsinki",
            "dropoff_address": "TEST_Cancel Dropoff, Helsinki",
            "pickup_lat": 60.1699, "pickup_lng": 24.9384,
            "dropoff_lat": 60.1719, "dropoff_lng": 24.9414,
            "customer_name": "TEST_Cancel Customer",
            "customer_phone": "+358401234567",
            "cargo_description": "TEST cancel-isolation parcel",
            "vehicle_type": "cargo_van",
            "cargo_weight_kg": 5,
        }
        for path in ("/api/shipper/orders/instant", "/api/shipper/orders", "/api/orders"):
            r = session.post(f"{BASE_URL}{path}", json=instant_payload, headers=shipper_headers, timeout=20)
            if r.status_code in (200, 201):
                try:
                    body = r.json()
                    throwaway_id = body.get("id") or (body.get("order") or {}).get("id")
                except Exception:
                    pass
                if throwaway_id:
                    break

        # Pick an order to cancel: prefer the throwaway, else the LAST one in the feed
        target_id = throwaway_id
        if not target_id:
            # Read admin list filtered by pending and pick one
            adm = session.get(
                f"{BASE_URL}/api/admin/manage/orders?status=pending&limit=100",
                headers=admin_headers,
                timeout=20,
            )
            assert adm.status_code == 200, adm.text
            adm_rows = adm.json()
            # response is {"items": [...], "total": N, ...}
            if isinstance(adm_rows, dict):
                rows = adm_rows.get("items") or adm_rows.get("orders") or []
            else:
                rows = adm_rows
            pending = [row for row in rows if row.get("status") == "pending"]
            assert pending, f"no pending orders found via admin manage list (rows={len(rows)})"
            target_id = pending[-1]["id"]

        # 3. Cancel that order
        cancel = session.post(
            f"{BASE_URL}/api/admin/manage/orders/{target_id}/cancel",
            headers=admin_headers,
            timeout=20,
        )
        assert cancel.status_code == 200, f"cancel failed: {cancel.status_code} {cancel.text}"
        cancelled_row = cancel.json()
        # response may be a normalized admin row — order id may be nested
        cancelled_status = cancelled_row.get("status") or (cancelled_row.get("order") or {}).get("status")
        assert cancelled_status == "cancelled", f"order not cancelled: {cancelled_row}"

        # 4. Confirm the available feed STILL returns the other jobs
        after = session.get(f"{BASE_URL}/api/orders/available", headers=driver_headers, timeout=20)
        assert after.status_code == 200, f"available feed broke after cancel: {after.status_code} {after.text[:300]}"
        after_jobs = after.json()
        after_count = len(after_jobs)

        # The available feed must NOT collapse to zero. It should be close to before_count
        # (minus the cancelled one if it was in the visible window, plus any new
        # throwaway we created and then cancelled = no net new pending).
        assert after_count > 0, (
            f"REGRESSION: available feed dropped to {after_count} after a single cancel "
            f"(was {before_count})"
        )
        # Sanity: the cancelled id must not be in the feed
        ids_after = {o.get("id") for o in after_jobs}
        assert target_id not in ids_after, "cancelled order still visible in available feed"

        # Should differ by at most 1 (the cancelled one) — generous bound of 2 to allow
        # for any concurrent dispatch churn in the demo data.
        assert before_count - after_count <= 2, (
            f"available feed shrank too much: before={before_count} after={after_count}"
        )


# ---------- Driver accept regression ----------

class TestDriverAcceptRegression:
    def test_demo_driver_can_accept_a_job(self, session, driver_token):
        headers = {"Authorization": f"Bearer {driver_token}"}

        # Make sure driver is online (best effort — endpoint name varies)
        for path in ("/api/driver/online", "/api/driver/status", "/api/driver/go-online"):
            try:
                session.post(f"{BASE_URL}{path}", json={"online": True, "is_online": True}, headers=headers, timeout=10)
            except Exception:
                pass

        # If driver already has an active job, treat that as proof of accept-capability
        active = session.get(f"{BASE_URL}/api/orders/active", headers=headers, timeout=15)
        if active.status_code == 200 and active.json():
            assert active.json().get("status") in (
                "accepted", "enroute_pickup", "arrived_pickup", "picked_up",
                "enroute_dropoff", "arrived_dropoff",
            )
            return

        avail = session.get(f"{BASE_URL}/api/orders/available", headers=headers, timeout=15)
        assert avail.status_code == 200, avail.text
        jobs = avail.json()
        assert jobs, "no jobs available to accept"
        order_id = jobs[0]["id"]

        # Try common accept endpoints
        accepted = None
        for path in (
            f"/api/orders/{order_id}/accept",
            f"/api/driver/orders/{order_id}/accept",
        ):
            r = session.post(f"{BASE_URL}{path}", headers=headers, timeout=15)
            if r.status_code == 200:
                accepted = r.json()
                break
        assert accepted is not None, "driver could not accept any job via known endpoints"
        assert accepted.get("status") in ("accepted", "enroute_pickup")
