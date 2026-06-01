"""Manual smoke test for the Stripe payment & financial module."""
import httpx

BASE = "http://localhost:8001/api"


def main():
    c = httpx.Client(base_url=BASE, timeout=60)
    c.post("/seed-demo")

    sh = c.post("/auth/shipper-login", json={"email": "demo.shipper@nadaruns.com", "password": "demo1234"}).json()
    sh_tok = {"Authorization": f"Bearer {sh['token']}"}
    dr = c.post("/auth/login", json={"email": "demo.driver@nadaruns.com", "password": "demo1234"}).json()
    dr_tok = {"Authorization": f"Bearer {dr['token']}"}
    ad = c.post("/auth/admin-login", json={"email": "admin@nadaruns.com", "password": "admin123"}).json()
    ad_tok = {"Authorization": f"Bearer {ad['token']}"}

    print("config:", c.get("/payments/config").json())

    def make_order():
        body = {
            "pickup_address": "Helsinki Port", "pickup_lat": 60.2095, "pickup_lng": 25.1478,
            "pickup_contact_name": "Dock A", "pickup_contact_phone": "+358401112222",
            "dropoff_address": "Nokia HQ", "dropoff_lat": 60.2198, "dropoff_lng": 24.7589,
            "dropoff_contact_name": "Reception", "dropoff_contact_phone": "+358403334444",
            "vehicle_type": "cargo_van", "cargo_weight_kg": 200, "cargo_description": "Boxes",
            "cargo_type": "general", "urgency": "standard",
        }
        return c.post("/shipper/shipments", json=body, headers=sh_tok).json()

    # ---- Path A: admin manual capture ----
    o1 = make_order()
    oid1 = o1["order_id"]
    print(f"\n[A] order {oid1} price={o1['price']}")
    auth = c.post(f"/payments/orders/{oid1}/authorize-test", headers=sh_tok).json()
    print("[A] authorize:", auth.get("payment_status"), "amount:", auth.get("payment_amount"),
          "commission:", auth.get("commission_amount"), "driver:", auth.get("driver_payout_amount"))
    st = c.get(f"/payments/orders/{oid1}/status", headers=sh_tok).json()
    print("[A] status:", st.get("payment_status"))
    cap = c.post(f"/payments/orders/{oid1}/capture", json={}, headers=ad_tok).json()
    print("[A] capture:", cap.get("payment_status"), "captured_at:", bool(cap.get("captured_at")))

    # ---- Path B: auto-capture on delivery + wallet + withdrawal ----
    o2 = make_order()
    oid2 = o2["order_id"]
    print(f"\n[B] order {oid2} price={o2['price']}")
    c.post(f"/orders/{oid2}/accept", headers=dr_tok)
    c.post(f"/payments/orders/{oid2}/authorize-test", headers=sh_tok)
    # advance to delivered
    for _ in range(8):
        r = c.post(f"/orders/{oid2}/advance", json={}, headers=dr_tok)
        if r.status_code != 200:
            print("[B] advance err:", r.status_code, r.text[:120]); break
        if r.json().get("status") == "delivered":
            break
    st2 = c.get(f"/payments/orders/{oid2}/status", headers=sh_tok).json()
    print("[B] payment after delivery:", st2.get("payment_status"))

    wallet = c.get("/wallet/driver", headers=dr_tok).json()
    print("[B] wallet available:", wallet.get("available_balance"), "earned:", wallet.get("total_earned"),
          "earnings entries:", len(wallet.get("earnings", [])))

    wd = c.post("/wallet/withdraw", json={"amount": 15, "method": "bank_transfer", "account_details": "FI00 1234"}, headers=dr_tok)
    print("[B] withdraw:", wd.status_code, wd.json().get("withdrawal", {}).get("status") if wd.status_code == 200 else wd.text[:150])

    # ---- Admin financials ----
    ov = c.get("/admin/financials/overview", headers=ad_tok).json()
    print("\n[ADMIN] overview kpis:", ov.get("kpis"))
    tx = c.get("/admin/financials/transactions", headers=ad_tok).json()
    print("[ADMIN] tx total:", tx.get("total"))
    authz = c.get("/admin/payments/authorized", headers=ad_tok).json()
    print("[ADMIN] authorized awaiting capture:", authz.get("total"))
    wds = c.get("/admin/financials/withdrawals?status=pending", headers=ad_tok).json()
    print("[ADMIN] pending withdrawals:", wds.get("total"))
    if wds.get("items"):
        wid = wds["items"][0]["id"]
        ap = c.post(f"/admin/financials/withdrawals/{wid}/approve", headers=ad_tok).json()
        print("[ADMIN] approve:", ap.get("status"))
        pay = c.post(f"/admin/financials/withdrawals/{wid}/pay", json={"reference": "TRX-9001"}, headers=ad_tok).json()
        print("[ADMIN] pay:", pay.get("status"), "ref:", pay.get("reference"))


if __name__ == "__main__":
    main()
