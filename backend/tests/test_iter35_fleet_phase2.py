"""Phase 2 Fleet/Company tests:
 - self-accept records assigned_company_id/driver_id/vehicle_id
 - owner_assign mode blocks self-accept (403) and owner assign endpoint works
 - GET /api/company/jobs visibility (owner-only, stats shape)
 - vehicle audit: assigned vehicle id propagates to order on accept
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

DRIVER_EMAIL = "demo.driver@nadaruns.com"
DRIVER_PASS = "demo1234"


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def driver_token(s):
    r = s.post(f"{API}/auth/login", json={"email": DRIVER_EMAIL, "password": DRIVER_PASS}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("token") or j.get("access_token")


@pytest.fixture(scope="module")
def H(driver_token):
    return {"Authorization": f"Bearer {driver_token}"}


@pytest.fixture(scope="module")
def driver_id(s, H):
    r = s.get(f"{API}/driver/me", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def company(s, H):
    # ensure company exists
    r = s.post(f"{API}/company", headers=H, json={"company_name": "TEST_NadaFleet_Phase2"}, timeout=15)
    assert r.status_code in (200, 400), r.text
    # set mode to self_accept (clean baseline)
    r = s.patch(f"{API}/company", headers=H, json={"job_acceptance_mode": "self_accept"}, timeout=15)
    assert r.status_code == 200, r.text
    me = s.get(f"{API}/company/me", headers=H, timeout=15)
    assert me.status_code == 200, me.text
    data = me.json()
    return data["company"]


def _seed_pending(s):
    """Use add-pending so we don't kill orders other tests may use."""
    r = s.post(f"{API}/orders/add-pending", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _pick_available(s, H):
    r = s.get(f"{API}/orders/available", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    lst = r.json()
    assert isinstance(lst, list) and len(lst) > 0, "no available pending orders"
    return lst[0]


# ---------- 1. self_accept records fleet fields ----------

class TestSelfAcceptRecordsFleetFields:
    def test_self_accept_sets_assigned_fields(self, s, H, driver_id, company):
        # unassign any vehicle from owner so we start clean
        vehs = s.get(f"{API}/company/vehicles", headers=H, timeout=15).json().get("vehicles", [])
        for v in vehs:
            if v.get("assigned_driver_id") == driver_id:
                s.post(f"{API}/company/vehicles/{v['id']}/unassign", headers=H, timeout=15)

        pending = _seed_pending(s)
        # confirm mode self_accept
        s.patch(f"{API}/company", headers=H, json={"job_acceptance_mode": "self_accept"}, timeout=15)

        order_id = pending["id"]
        r = s.post(f"{API}/orders/{order_id}/accept", headers=H, timeout=20)
        assert r.status_code == 200, f"accept failed: {r.status_code} {r.text}"
        body = r.json()

        assert body.get("assigned_company_id") == company["id"], body
        assert body.get("assigned_driver_id") == driver_id, body
        # no fleet vehicle assigned -> should be None
        assert body.get("assigned_vehicle_id") in (None, ""), body
        assert body.get("status") == "accepted"
        assert body.get("driver_id") == driver_id


# ---------- 2. owner_assign blocks self-accept and owner can assign ----------

class TestOwnerAssignMode:
    def test_owner_assign_blocks_self_accept(self, s, H, driver_id, company):
        # switch to owner_assign
        r = s.patch(f"{API}/company", headers=H, json={"job_acceptance_mode": "owner_assign"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["company"]["job_acceptance_mode"] == "owner_assign"

        pending = _seed_pending(s)
        order_id = pending["id"]

        r = s.post(f"{API}/orders/{order_id}/accept", headers=H, timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

        # cleanup: leave mode as owner_assign for next test
        # remember order_id for owner-assign test
        TestOwnerAssignMode._order_for_assign = order_id

    def test_owner_assign_endpoint_succeeds(self, s, H, driver_id, company):
        order_id = getattr(TestOwnerAssignMode, "_order_for_assign", None)
        if not order_id:
            pending = _seed_pending(s)
            order_id = pending["id"]

        r = s.post(
            f"{API}/company/jobs/{order_id}/assign",
            headers=H,
            json={"driver_id": driver_id},
            timeout=20,
        )
        assert r.status_code == 200, f"assign failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("success") is True
        assert body.get("driver_id") == driver_id

        # verify order persisted with assigned_* and status accepted
        # use company/jobs to fetch this order
        jobs = s.get(f"{API}/company/jobs", headers=H, timeout=15).json()["jobs"]
        target = next((j for j in jobs if j["id"] == order_id), None)
        assert target is not None, "order not found in company/jobs"
        assert target["status"] == "accepted"
        assert target["driver_id"] == driver_id

    def test_reset_mode_self_accept(self, s, H):
        r = s.patch(f"{API}/company", headers=H, json={"job_acceptance_mode": "self_accept"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["company"]["job_acceptance_mode"] == "self_accept"


# ---------- 3. company/jobs visibility & shape ----------

class TestCompanyJobsVisibility:
    def test_owner_can_list_jobs_with_stats(self, s, H, company):
        r = s.get(f"{API}/company/jobs", headers=H, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "jobs" in data and "stats" in data
        stats = data["stats"]
        for k in ("total", "active", "completed", "completed_earnings"):
            assert k in stats, f"missing {k} in stats"
        assert isinstance(data["jobs"], list)
        assert len(data["jobs"]) >= 1
        # shape check on first job
        j = data["jobs"][0]
        for k in ("id", "status", "earnings", "driver_id", "driver_name", "vehicle_id", "vehicle_reg", "pickup", "dropoff"):
            assert k in j, f"missing {k} in job"
        # driver_name should be populated for at least one job (owner)
        names = [j.get("driver_name") for j in data["jobs"]]
        assert any(n for n in names), f"no driver_name set in any job: {names}"

    def test_non_owner_driver_gets_403(self, s, H, company):
        # create a fresh fleet driver, login as them, and check 403
        suffix = uuid.uuid4().hex[:8]
        email = f"test_phase2_{suffix}@nadafleet.test"
        invite = {
            "first_name": "P2",
            "last_name": f"Driver {suffix}",
            "email": email,
            "phone": f"+3585000{suffix[:4]}",
            "password": "Pass1234!",
        }
        r = s.post(f"{API}/company/drivers", headers=H, json=invite, timeout=20)
        assert r.status_code == 200, f"invite failed: {r.text}"
        new_driver = r.json()
        new_driver_id = new_driver.get("id") or new_driver.get("driver", {}).get("id")
        assert new_driver_id, f"no driver id in {new_driver}"
        try:
            lg = s.post(f"{API}/auth/login", json={"email": email, "password": "Pass1234!"}, timeout=15)
            assert lg.status_code == 200, lg.text
            new_token = lg.json().get("token") or lg.json().get("access_token")
            NH = {"Authorization": f"Bearer {new_token}"}

            rj = requests.get(f"{API}/company/jobs", headers=NH, timeout=15)
            assert rj.status_code == 403, f"expected 403 for non-owner, got {rj.status_code} {rj.text}"
        finally:
            # cleanup invited driver
            s.delete(f"{API}/company/drivers/{new_driver_id}", headers=H, timeout=15)


# ---------- 4. vehicle audit ----------

class TestVehicleAudit:
    def test_assigned_vehicle_id_recorded_on_accept(self, s, H, driver_id, company):
        # ensure self_accept
        s.patch(f"{API}/company", headers=H, json={"job_acceptance_mode": "self_accept"}, timeout=15)

        # create a fresh vehicle
        reg = f"TEST{uuid.uuid4().hex[:6].upper()}"
        veh_payload = {
            "registration_number": reg,
            "capacity_kg": 1000,
            "max_weight_kg": 1500,
            "length_cm": 300,
            "width_cm": 180,
            "height_cm": 180,
        }
        r = s.post(f"{API}/company/vehicles", headers=H, json=veh_payload, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        vehicle = body.get("vehicle") if isinstance(body, dict) and "vehicle" in body else body
        vehicle_id = vehicle["id"]

        try:
            # assign to owner driver
            r = s.post(
                f"{API}/company/vehicles/{vehicle_id}/assign",
                headers=H,
                json={"driver_id": driver_id},
                timeout=15,
            )
            assert r.status_code == 200, r.text

            pending = _seed_pending(s)
            r = s.post(f"{API}/orders/{pending['id']}/accept", headers=H, timeout=20)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("assigned_vehicle_id") == vehicle_id, (
                f"vehicle_id mismatch: got {body.get('assigned_vehicle_id')} expected {vehicle_id}"
            )
            assert body.get("assigned_company_id") == company["id"]
            assert body.get("assigned_driver_id") == driver_id

            # also check visible in company/jobs
            jobs = s.get(f"{API}/company/jobs", headers=H, timeout=15).json()["jobs"]
            this = next((j for j in jobs if j["id"] == body["id"]), None)
            assert this is not None
            assert this["vehicle_id"] == vehicle_id
            assert this["vehicle_reg"] == reg
        finally:
            # cleanup: unassign + delete vehicle
            s.post(f"{API}/company/vehicles/{vehicle_id}/unassign", headers=H, timeout=15)
            s.delete(f"{API}/company/vehicles/{vehicle_id}", headers=H, timeout=15)


# ---------- 5. seed-new-pending endpoint sanity ----------

class TestSeedEndpoint:
    def test_seed_new_pending(self, s):
        r = s.post(f"{API}/orders/seed-new-pending", timeout=15)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["status"] == "pending"
        assert "id" in order
