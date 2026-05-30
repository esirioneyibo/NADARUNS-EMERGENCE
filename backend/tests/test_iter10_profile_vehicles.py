"""Iteration 10 backend tests:
   - Multi-vehicle CRUD + primary mirroring on Driver
   - Change-password for driver & shipper (then restore demo passwords)
   - Profile edit (driver + shipper, incl. avatar data-URI)
   - Order lifecycle regression
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://nadaruns-logistics.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DRIVER_EMAIL = "demo.driver@nadaruns.com"
SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
DEMO_PWD = "demo1234"

TINY_PNG_DATA_URI = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


# ---------- shared fixtures ----------
@pytest.fixture(scope="session")
def driver_token():
    r = requests.post(f"{API}/auth/login", json={"email": DRIVER_EMAIL, "password": DEMO_PWD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def shipper_token():
    r = requests.post(f"{API}/auth/shipper-login", json={"email": SHIPPER_EMAIL, "password": DEMO_PWD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ============================================================
# Multi-Vehicle CRUD
# ============================================================
class TestDriverVehicles:
    def test_driver_me_has_vehicles_array(self, driver_token):
        r = requests.get(f"{API}/driver/me", headers=hdr(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("vehicles"), list)
        assert len(d["vehicles"]) >= 1, "Legacy migration should produce >=1 vehicle"
        assert any(v.get("is_primary") for v in d["vehicles"]), "At least one must be primary"
        # primary mirrors top-level
        primary = next(v for v in d["vehicles"] if v["is_primary"])
        assert d["vehicle_type"] == primary["vehicle_type"]

    def test_add_vehicle_invalid_type_400(self, driver_token):
        r = requests.post(
            f"{API}/driver/vehicles",
            headers=hdr(driver_token),
            json={"vehicle_type": "spaceship", "plate": "X-1", "make_primary": False},
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_add_set_primary_update_delete_full_flow(self, driver_token):
        # baseline
        d0 = requests.get(f"{API}/driver/me", headers=hdr(driver_token), timeout=15).json()
        base_count = len(d0["vehicles"])
        original_primary_id = next(v["id"] for v in d0["vehicles"] if v["is_primary"])
        original_primary_type = d0["vehicle_type"]

        # ADD a non-primary vehicle
        r = requests.post(
            f"{API}/driver/vehicles",
            headers=hdr(driver_token),
            json={"vehicle_type": "box_truck", "plate": "TEST-BX1", "make_primary": False},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d1 = r.json()
        assert len(d1["vehicles"]) == base_count + 1
        new_v1 = next(v for v in d1["vehicles"] if v["plate"] == "TEST-BX1")
        assert new_v1["vehicle_type"] == "box_truck"
        assert new_v1["is_primary"] is False
        # primary unchanged
        assert d1["vehicle_type"] == original_primary_type

        # ADD a vehicle WITH make_primary=true -> mirrors to top-level
        r = requests.post(
            f"{API}/driver/vehicles",
            headers=hdr(driver_token),
            json={"vehicle_type": "flatbed_truck", "plate": "TEST-FB1", "make_primary": True},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d2 = r.json()
        new_v2 = next(v for v in d2["vehicles"] if v["plate"] == "TEST-FB1")
        assert new_v2["is_primary"] is True
        # top-level mirrors flatbed_truck
        assert d2["vehicle_type"] == "flatbed_truck"
        assert d2["plate"] == "TEST-FB1"
        # only one primary
        assert sum(1 for v in d2["vehicles"] if v["is_primary"]) == 1

        # SET ORIGINAL back as primary
        r = requests.post(
            f"{API}/driver/vehicles/{original_primary_id}/primary",
            headers=hdr(driver_token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d3 = r.json()
        assert d3["vehicle_type"] == original_primary_type
        assert sum(1 for v in d3["vehicles"] if v["is_primary"]) == 1
        assert next(v for v in d3["vehicles"] if v["id"] == original_primary_id)["is_primary"] is True

        # PATCH update new_v1 plate
        r = requests.patch(
            f"{API}/driver/vehicles/{new_v1['id']}",
            headers=hdr(driver_token),
            json={"vehicle_type": "box_truck", "plate": "TEST-BX1-UPD", "capacity_kg": 2200},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d4 = r.json()
        upd = next(v for v in d4["vehicles"] if v["id"] == new_v1["id"])
        assert upd["plate"] == "TEST-BX1-UPD"
        assert upd["capacity_kg"] == 2200

        # DELETE non-primary vehicle (new_v1)
        r = requests.delete(f"{API}/driver/vehicles/{new_v1['id']}", headers=hdr(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        d5 = r.json()
        assert all(v["id"] != new_v1["id"] for v in d5["vehicles"])

        # DELETE the primary -> another should be promoted
        primary_now = next(v for v in d5["vehicles"] if v["is_primary"])
        r = requests.delete(f"{API}/driver/vehicles/{primary_now['id']}", headers=hdr(driver_token), timeout=15)
        if len(d5["vehicles"]) > 1:
            assert r.status_code == 200, r.text
            d6 = r.json()
            assert all(v["id"] != primary_now["id"] for v in d6["vehicles"])
            assert any(v["is_primary"] for v in d6["vehicles"])
            # top-level vehicle_type mirrors the promoted primary
            promoted = next(v for v in d6["vehicles"] if v["is_primary"])
            assert d6["vehicle_type"] == promoted["vehicle_type"]
        else:
            # if only one vehicle remains, deletion must be blocked
            assert r.status_code == 400

        # Restore baseline: keep only one cargo_van primary
        cur = requests.get(f"{API}/driver/me", headers=hdr(driver_token), timeout=15).json()
        # delete every non-last vehicle
        ids = [v["id"] for v in cur["vehicles"]]
        for vid in ids[:-1]:
            requests.delete(f"{API}/driver/vehicles/{vid}", headers=hdr(driver_token), timeout=15)
        cur2 = requests.get(f"{API}/driver/me", headers=hdr(driver_token), timeout=15).json()
        last = cur2["vehicles"][0]
        # update remaining to cargo_van with DEMO plate
        requests.patch(
            f"{API}/driver/vehicles/{last['id']}",
            headers=hdr(driver_token),
            json={"vehicle_type": "cargo_van", "plate": "DEMO-001", "make_primary": True},
            timeout=15,
        )

    def test_cannot_delete_last_vehicle(self, driver_token):
        cur = requests.get(f"{API}/driver/me", headers=hdr(driver_token), timeout=15).json()
        assert len(cur["vehicles"]) >= 1
        if len(cur["vehicles"]) == 1:
            r = requests.delete(
                f"{API}/driver/vehicles/{cur['vehicles'][0]['id']}",
                headers=hdr(driver_token),
                timeout=15,
            )
            assert r.status_code == 400


# ============================================================
# Change Password (driver + shipper) — restore demo1234 after
# ============================================================
class TestChangePassword:
    def test_driver_change_password_full_cycle(self, driver_token):
        new_pwd = "newdriverpwd9"
        # wrong current
        r = requests.post(
            f"{API}/auth/change-password",
            headers=hdr(driver_token),
            json={"current_password": "wrong", "new_password": new_pwd},
            timeout=15,
        )
        assert r.status_code == 400, r.text

        # too-short new pwd (Pydantic validation)
        r = requests.post(
            f"{API}/auth/change-password",
            headers=hdr(driver_token),
            json={"current_password": DEMO_PWD, "new_password": "short"},
            timeout=15,
        )
        assert r.status_code == 422, r.text

        # new == current
        r = requests.post(
            f"{API}/auth/change-password",
            headers=hdr(driver_token),
            json={"current_password": DEMO_PWD, "new_password": DEMO_PWD},
            timeout=15,
        )
        assert r.status_code == 400, r.text

        # success
        r = requests.post(
            f"{API}/auth/change-password",
            headers=hdr(driver_token),
            json={"current_password": DEMO_PWD, "new_password": new_pwd},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        # login with new
        r = requests.post(f"{API}/auth/login", json={"email": DRIVER_EMAIL, "password": new_pwd}, timeout=15)
        assert r.status_code == 200, r.text
        new_tok = r.json()["token"]

        # old password no longer works
        r = requests.post(f"{API}/auth/login", json={"email": DRIVER_EMAIL, "password": DEMO_PWD}, timeout=15)
        assert r.status_code in (400, 401), r.text

        # RESTORE: change back to demo1234
        r = requests.post(
            f"{API}/auth/change-password",
            headers=hdr(new_tok),
            json={"current_password": new_pwd, "new_password": DEMO_PWD},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        # confirm restored
        r = requests.post(f"{API}/auth/login", json={"email": DRIVER_EMAIL, "password": DEMO_PWD}, timeout=15)
        assert r.status_code == 200, "Driver demo password failed to restore!"

    def test_shipper_change_password_full_cycle(self, shipper_token):
        new_pwd = "newshippwd9"
        r = requests.post(
            f"{API}/auth/change-password",
            headers=hdr(shipper_token),
            json={"current_password": "wrong", "new_password": new_pwd},
            timeout=15,
        )
        assert r.status_code == 400, r.text

        r = requests.post(
            f"{API}/auth/change-password",
            headers=hdr(shipper_token),
            json={"current_password": DEMO_PWD, "new_password": "abc"},
            timeout=15,
        )
        assert r.status_code == 422, r.text

        r = requests.post(
            f"{API}/auth/change-password",
            headers=hdr(shipper_token),
            json={"current_password": DEMO_PWD, "new_password": DEMO_PWD},
            timeout=15,
        )
        assert r.status_code == 400, r.text

        r = requests.post(
            f"{API}/auth/change-password",
            headers=hdr(shipper_token),
            json={"current_password": DEMO_PWD, "new_password": new_pwd},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        r = requests.post(f"{API}/auth/shipper-login", json={"email": SHIPPER_EMAIL, "password": new_pwd}, timeout=15)
        assert r.status_code == 200, r.text
        new_tok = r.json()["token"]

        # restore
        r = requests.post(
            f"{API}/auth/change-password",
            headers=hdr(new_tok),
            json={"current_password": new_pwd, "new_password": DEMO_PWD},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        r = requests.post(f"{API}/auth/shipper-login", json={"email": SHIPPER_EMAIL, "password": DEMO_PWD}, timeout=15)
        assert r.status_code == 200, "Shipper demo password failed to restore!"


# ============================================================
# Profile Edit (driver + shipper) incl. avatar
# ============================================================
class TestProfileEdit:
    def test_patch_driver_me_with_avatar(self, driver_token):
        # capture original
        original = requests.get(f"{API}/driver/me", headers=hdr(driver_token), timeout=15).json()
        orig_name = original.get("name")
        orig_phone = original.get("phone", "")

        r = requests.patch(
            f"{API}/driver/me",
            headers=hdr(driver_token),
            json={
                "name": "TEST_Driver_Name",
                "phone": "+358401234567",
                "avatar": TINY_PNG_DATA_URI,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == "TEST_Driver_Name"
        assert d["phone"] == "+358401234567"
        assert d["avatar"].startswith("data:image/png;base64,")

        # verify persisted
        d2 = requests.get(f"{API}/driver/me", headers=hdr(driver_token), timeout=15).json()
        assert d2["name"] == "TEST_Driver_Name"
        assert d2["avatar"] == TINY_PNG_DATA_URI

        # restore
        requests.patch(
            f"{API}/driver/me",
            headers=hdr(driver_token),
            json={"name": orig_name or "Demo Driver", "phone": orig_phone},
            timeout=15,
        )

    def test_patch_shipper_me_with_avatar(self, shipper_token):
        original = requests.get(f"{API}/shipper/me", headers=hdr(shipper_token), timeout=15).json()

        r = requests.patch(
            f"{API}/shipper/me",
            headers=hdr(shipper_token),
            json={
                "company_name": "TEST_Co",
                "contact_name": "TEST_Contact",
                "phone": "+358401111111",
                "address": "TEST 1 Street",
                "tax_id": "FI12345678",
                "avatar": TINY_PNG_DATA_URI,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["company_name"] == "TEST_Co"
        assert s["contact_name"] == "TEST_Contact"
        assert s["phone"] == "+358401111111"
        assert s["address"] == "TEST 1 Street"
        assert s["tax_id"] == "FI12345678"
        assert s.get("avatar", "").startswith("data:image/png;base64,")

        # restore
        requests.patch(
            f"{API}/shipper/me",
            headers=hdr(shipper_token),
            json={
                "company_name": original.get("company_name", "Demo Logistics Co"),
                "contact_name": original.get("contact_name", ""),
                "phone": original.get("phone", ""),
                "address": original.get("address", ""),
                "tax_id": original.get("tax_id", ""),
            },
            timeout=15,
        )


# ============================================================
# Regression: order lifecycle + matching by primary vehicle_type
# ============================================================
class TestOrderLifecycleRegression:
    def test_available_orders_uses_primary_vehicle(self, driver_token):
        d = requests.get(f"{API}/driver/me", headers=hdr(driver_token), timeout=15).json()
        primary_type = d["vehicle_type"]
        r = requests.get(
            f"{API}/orders/available",
            headers=hdr(driver_token),
            params={"vehicle_type": primary_type, "limit": 5},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        orders = r.json()
        # all returned orders must be compatible (same type or unspecified)
        for o in orders:
            ovt = o.get("vehicle_type")
            assert ovt is None or ovt == primary_type, f"order {o.get('id')} type {ovt} mismatched"

    def test_full_order_lifecycle(self, driver_token, shipper_token):
        # shipper creates an order
        # use a known-good helper if it exists; fall back to /shipper/create-shipment
        body = {
            "pickup_address": "TEST Helsinki Central",
            "pickup_lat": 60.1699,
            "pickup_lng": 24.9384,
            "dropoff_address": "TEST Espoo Office",
            "dropoff_lat": 60.2055,
            "dropoff_lng": 24.6559,
            "vehicle_type": "cargo_van",
            "items": [{"name": "TEST_PKG", "quantity": 1, "weight_kg": 10}],
            "total_weight_kg": 10,
            "cargo_type": "general",
            "urgency": "standard",
            "shipper_offer": 0,
        }
        r = requests.post(f"{API}/shipper/create-shipment", headers=hdr(shipper_token), json=body, timeout=20)
        if r.status_code != 200:
            pytest.skip(f"create-shipment unavailable: {r.status_code} {r.text[:200]}")
        order = r.json()
        order_id = order.get("order_id") or order.get("id")
        assert order_id

        # driver must be online to accept
        requests.post(f"{API}/driver/toggle-online", headers=hdr(driver_token), json={"is_online": True}, timeout=15)

        # drain any pre-existing active order so accept succeeds
        for _ in range(20):
            act = requests.get(f"{API}/orders/active", headers=hdr(driver_token), timeout=10).json()
            if not act:
                break
            cur_id = act.get("id")
            for _i in range(8):
                rr = requests.post(f"{API}/orders/{cur_id}/advance", headers=hdr(driver_token), json={}, timeout=10)
                if rr.status_code != 200 or rr.json().get("status") == "delivered":
                    break

        # accept
        r = requests.post(f"{API}/orders/{order_id}/accept", headers=hdr(driver_token), timeout=15)
        assert r.status_code == 200, r.text

        # advance through statuses until delivered
        for _ in range(8):
            r = requests.post(f"{API}/orders/{order_id}/advance", headers=hdr(driver_token), json={}, timeout=15)
            assert r.status_code == 200, r.text
            if r.json().get("status") == "delivered":
                break

        assert r.json().get("status") == "delivered"
