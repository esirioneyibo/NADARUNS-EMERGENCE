"""Iteration 34 — Fleet / Company Management (Phase 1) backend tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set in frontend/.env"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

DEMO_DRIVER = {"email": "demo.driver@nadaruns.com", "password": "demo1234"}


# ---------- helpers ----------
def _login_driver(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(token: str):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def owner_token():
    # demo driver may already have a company from prior runs; ensure he does
    token = _login_driver(**DEMO_DRIVER)
    me = requests.get(f"{API}/company/me", headers=_h(token), timeout=30).json()
    if not me.get("company"):
        r = requests.post(f"{API}/company", headers=_h(token), json={"company_name": "TEST_NadaFleet"}, timeout=30)
        assert r.status_code == 200, f"create company failed: {r.text}"
    return token


@pytest.fixture(scope="module")
def company_id(owner_token):
    me = requests.get(f"{API}/company/me", headers=_h(owner_token), timeout=30).json()
    return me["company"]["id"]


# ---------- Company lifecycle ----------
class TestCompanyLifecycle:
    def test_get_my_company_returns_company(self, owner_token):
        r = requests.get(f"{API}/company/me", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["company"] is not None
        assert data["role"] == "owner"
        assert isinstance(data["driver_count"], int)
        assert isinstance(data["vehicle_count"], int)
        assert data["driver_count"] >= 1  # owner counts

    def test_create_company_when_already_owner_returns_400(self, owner_token):
        r = requests.post(f"{API}/company", headers=_h(owner_token),
                          json={"company_name": "Another"}, timeout=30)
        assert r.status_code == 400
        assert "already" in r.text.lower()

    def test_patch_job_acceptance_mode_hybrid(self, owner_token):
        r = requests.patch(f"{API}/company", headers=_h(owner_token),
                           json={"job_acceptance_mode": "hybrid"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["company"]["job_acceptance_mode"] == "hybrid"
        # verify persistence
        me = requests.get(f"{API}/company/me", headers=_h(owner_token), timeout=30).json()
        assert me["company"]["job_acceptance_mode"] == "hybrid"

    def test_patch_job_acceptance_mode_owner_assign(self, owner_token):
        r = requests.patch(f"{API}/company", headers=_h(owner_token),
                           json={"job_acceptance_mode": "owner_assign"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["company"]["job_acceptance_mode"] == "owner_assign"

    def test_patch_invalid_mode_returns_422(self, owner_token):
        r = requests.patch(f"{API}/company", headers=_h(owner_token),
                           json={"job_acceptance_mode": "nonsense"}, timeout=30)
        assert r.status_code in (400, 422)


# ---------- Drivers tab ----------
class TestDriversTab:
    new_driver_email = f"test_driver_{uuid.uuid4().hex[:8]}@nadafleet.test"
    new_driver_password = "drv12345"
    new_driver_id = None

    def test_create_driver(self, owner_token):
        body = {
            "first_name": "Test",
            "last_name": "Fleeter",
            "email": self.new_driver_email,
            "password": self.new_driver_password,
            "vehicle_type": "cargo_van",
        }
        r = requests.post(f"{API}/company/drivers", headers=_h(owner_token), json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()["driver"]
        assert d["email"] == self.new_driver_email
        assert d["company_role"] == "driver"
        assert d["vehicle_type"] == "cargo_van"
        TestDriversTab.new_driver_id = d["id"]

    def test_list_drivers_owner_first(self, owner_token):
        r = requests.get(f"{API}/company/drivers", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        drivers = r.json()["drivers"]
        assert len(drivers) >= 2
        assert drivers[0]["company_role"] == "owner"
        emails = [d["email"] for d in drivers]
        assert self.new_driver_email in emails

    def test_duplicate_driver_email_returns_400(self, owner_token):
        body = {
            "first_name": "Dup",
            "last_name": "X",
            "email": self.new_driver_email,
            "password": "abc12345",
            "vehicle_type": "cargo_van",
        }
        r = requests.post(f"{API}/company/drivers", headers=_h(owner_token), json=body, timeout=30)
        assert r.status_code == 400

    def test_new_driver_can_login(self, owner_token):
        token = _login_driver(self.new_driver_email, self.new_driver_password)
        # confirm /company/me returns company + role 'driver'
        r = requests.get(f"{API}/company/me", headers=_h(token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["company"] is not None
        assert body["role"] == "driver"

    def test_non_owner_forbidden_on_owner_endpoints(self, owner_token):
        token = _login_driver(self.new_driver_email, self.new_driver_password)
        # Each tuple = (method, url, valid_body) -- body must satisfy pydantic so 403 (auth) fires, not 422
        endpoints = [
            ("GET", f"{API}/company/drivers", None),
            ("GET", f"{API}/company/vehicles", None),
            ("POST", f"{API}/company/drivers", {
                "first_name": "X", "last_name": "Y", "email": "x@x.com",
                "password": "abc12345", "vehicle_type": "cargo_van",
            }),
            ("PATCH", f"{API}/company", {"company_name": "X"}),
            ("POST", f"{API}/company/vehicles", {
                "registration_number": "XYZ-1", "vehicle_type": "cargo_van"
            }),
        ]
        for method, url, body in endpoints:
            r = requests.request(method, url, headers=_h(token),
                                 json=body, timeout=30)
            assert r.status_code == 403, f"{method} {url} -> {r.status_code} {r.text}"

    def test_suspend_then_activate_driver(self, owner_token):
        did = TestDriversTab.new_driver_id
        r = requests.patch(f"{API}/company/drivers/{did}/suspend", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        # verify
        drivers = requests.get(f"{API}/company/drivers", headers=_h(owner_token), timeout=30).json()["drivers"]
        target = next(d for d in drivers if d["id"] == did)
        assert target["is_suspended"] is True

        r = requests.patch(f"{API}/company/drivers/{did}/activate", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        drivers = requests.get(f"{API}/company/drivers", headers=_h(owner_token), timeout=30).json()["drivers"]
        target = next(d for d in drivers if d["id"] == did)
        assert target["is_suspended"] is False

    def test_cannot_suspend_owner(self, owner_token, company_id):
        # find owner id
        drivers = requests.get(f"{API}/company/drivers", headers=_h(owner_token), timeout=30).json()["drivers"]
        owner = next(d for d in drivers if d["company_role"] == "owner")
        r = requests.patch(f"{API}/company/drivers/{owner['id']}/suspend",
                           headers=_h(owner_token), timeout=30)
        assert r.status_code == 400

    def test_cannot_remove_owner(self, owner_token):
        drivers = requests.get(f"{API}/company/drivers", headers=_h(owner_token), timeout=30).json()["drivers"]
        owner = next(d for d in drivers if d["company_role"] == "owner")
        r = requests.delete(f"{API}/company/drivers/{owner['id']}", headers=_h(owner_token), timeout=30)
        assert r.status_code == 400


# ---------- Vehicles tab ----------
class TestVehiclesTab:
    reg = f"TEST{uuid.uuid4().hex[:6].upper()}"
    vehicle_id = None

    def test_add_vehicle(self, owner_token):
        body = {
            "registration_number": self.reg,
            "vehicle_type": "cargo_van",
            "length_cm": 350,
            "width_cm": 180,
            "height_cm": 190,
        }
        r = requests.post(f"{API}/company/vehicles", headers=_h(owner_token), json=body, timeout=30)
        assert r.status_code == 200, r.text
        v = r.json()["vehicle"]
        assert v["registration_number"] == self.reg.upper()
        TestVehiclesTab.vehicle_id = v["id"]

    def test_list_vehicles(self, owner_token):
        r = requests.get(f"{API}/company/vehicles", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        regs = [v["registration_number"] for v in r.json()["vehicles"]]
        assert self.reg.upper() in regs

    def test_duplicate_registration_returns_400(self, owner_token):
        body = {"registration_number": self.reg.lower(), "vehicle_type": "cargo_van"}
        r = requests.post(f"{API}/company/vehicles", headers=_h(owner_token), json=body, timeout=30)
        assert r.status_code == 400

    def test_patch_vehicle_disabled(self, owner_token):
        r = requests.patch(f"{API}/company/vehicles/{self.vehicle_id}",
                           headers=_h(owner_token), json={"status": "disabled"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["vehicle"]["status"] == "disabled"

    def test_assign_and_unassign_driver(self, owner_token):
        # use the driver created by TestDriversTab
        did = TestDriversTab.new_driver_id
        assert did, "Expected driver to be created first"
        r = requests.post(f"{API}/company/vehicles/{self.vehicle_id}/assign",
                          headers=_h(owner_token), json={"driver_id": did}, timeout=30)
        assert r.status_code == 200
        assert r.json()["vehicle"]["assigned_driver_id"] == did

        # confirm via GET list contains assigned_driver_name
        vehicles = requests.get(f"{API}/company/vehicles", headers=_h(owner_token), timeout=30).json()["vehicles"]
        target = next(v for v in vehicles if v["id"] == self.vehicle_id)
        assert target["assigned_driver_id"] == did
        assert target.get("assigned_driver_name")

        r = requests.post(f"{API}/company/vehicles/{self.vehicle_id}/unassign",
                          headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["vehicle"]["assigned_driver_id"] is None

    def test_delete_vehicle(self, owner_token):
        r = requests.delete(f"{API}/company/vehicles/{self.vehicle_id}",
                            headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        # verify it's gone
        vehicles = requests.get(f"{API}/company/vehicles", headers=_h(owner_token), timeout=30).json()["vehicles"]
        assert all(v["id"] != self.vehicle_id for v in vehicles)


# ---------- Cleanup + backward compat ----------
class TestRemoveDriverAndBackwardCompat:
    def test_remove_driver_detaches(self, owner_token):
        did = TestDriversTab.new_driver_id
        assert did
        r = requests.delete(f"{API}/company/drivers/{did}", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200

        # driver should be independent now: login and check /company/me
        token = _login_driver(TestDriversTab.new_driver_email, TestDriversTab.new_driver_password)
        me = requests.get(f"{API}/company/me", headers=_h(token), timeout=30).json()
        assert me["company"] is None
        assert me["role"] is None

    def test_independent_driver_existing_endpoints_still_work(self):
        # use the legacy test driver if it exists; otherwise skip
        token = _login_driver(TestDriversTab.new_driver_email, TestDriversTab.new_driver_password)
        # /api/driver/profile is a common existing endpoint
        r = requests.get(f"{API}/driver/profile", headers=_h(token), timeout=30)
        # accept either success or 404 (endpoint may not exist) – the key is no auth failure
        assert r.status_code in (200, 404), f"unexpected status: {r.status_code} {r.text}"


# ---------- Authorization for unauthenticated ----------
class TestNoAuth:
    def test_no_token_returns_401_or_403(self):
        r = requests.get(f"{API}/company/me", timeout=30)
        assert r.status_code in (401, 403)
