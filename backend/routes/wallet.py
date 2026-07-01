"""Auto-extracted wallet routes. Handler bodies are unchanged; shared names
(db, models, helpers, FastAPI symbols) are injected from the server module."""
from fastapi import APIRouter
import server as _srv

_g = globals()
for _k in dir(_srv):
    if not _k.startswith('__'):
        _g.setdefault(_k, getattr(_srv, _k))

router = APIRouter()


@router.get("/wallet/driver")
async def wallet_driver(credentials: HTTPAuthorizationCredentials = Depends(security)):
    payload = _auth_payload(credentials)
    if payload.get("type") != "driver":
        raise HTTPException(403, "Driver access required")
    driver_id = payload["sub"]

    balance = await compute_driver_balance(driver_id)

    txns = await db.payment_transactions.find(
        {"driver_id": driver_id, "type": "capture"}, {"_id": 0}
    ).sort("created_at", -1).limit(50).to_list(50)

    withdrawals = await db.withdrawal_requests.find(
        {"driver_id": driver_id}, {"_id": 0}
    ).sort("requested_at", -1).limit(50).to_list(50)

    return {
        **balance,
        "earnings": [
            {
                "order_id": t.get("order_id"),
                "order_number": t.get("order_number"),
                "amount": t.get("driver_amount"),
                "gross_amount": t.get("gross_amount"),
                "commission_amount": t.get("commission_amount"),
                "created_at": t.get("created_at"),
            } for t in txns
        ],
        "withdrawals": withdrawals,
    }


@router.post("/wallet/withdraw")
async def wallet_withdraw(body: WithdrawalCreate, credentials: HTTPAuthorizationCredentials = Depends(security)):
    payload = _auth_payload(credentials)
    if payload.get("type") != "driver":
        raise HTTPException(403, "Driver access required")
    driver_id = payload["sub"]

    amount = round(float(body.amount or 0), 2)
    if amount < 10:
        raise HTTPException(400, "Minimum cash-out is €10.00")

    balance = await compute_driver_balance(driver_id)
    if amount > balance["available_balance"]:
        raise HTTPException(400, f"Amount exceeds available balance (€{balance['available_balance']:.2f})")

    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0, "name": 1})
    wr = WithdrawalRequest(
        driver_id=driver_id,
        driver_name=(driver or {}).get("name"),
        amount=amount,
        method=body.method,
        account_details=body.account_details,
    )
    await db.withdrawal_requests.insert_one(wr.model_dump())

    # Auto-generate + email a withdrawal invoice (idempotent, non-blocking).
    asyncio.create_task(_create_withdrawal_doc(wr.model_dump(), "withdrawal_invoice"))

    await db.notifications.insert_one(Notification(
        recipient_id=driver_id,
        recipient_type="driver",
        type="payment",
        title="Cash-out requested",
        message=f"Your cash-out of €{amount:.2f} is pending admin approval.",
        data={"withdrawal_id": wr.id},
    ).model_dump())

    new_balance = await compute_driver_balance(driver_id)
    return {"withdrawal": wr.model_dump(), **new_balance}


@router.get("/wallet/withdrawals")
async def wallet_withdrawals(credentials: HTTPAuthorizationCredentials = Depends(security)):
    payload = _auth_payload(credentials)
    if payload.get("type") != "driver":
        raise HTTPException(403, "Driver access required")
    items = await db.withdrawal_requests.find(
        {"driver_id": payload["sub"]}, {"_id": 0}
    ).sort("requested_at", -1).limit(100).to_list(100)
    return {"withdrawals": items}


@router.get("/wallet/payouts")
async def wallet_payouts(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Driver payout history joined with any linked PDF documents
    (withdrawal invoice + payout receipt) so drivers can download proof."""
    payload = _auth_payload(credentials)
    if payload.get("type") != "driver":
        raise HTTPException(403, "Driver access required")
    driver_id = payload["sub"]

    items = await db.withdrawal_requests.find(
        {"driver_id": driver_id}, {"_id": 0}
    ).sort("requested_at", -1).limit(100).to_list(100)

    ids = [w["id"] for w in items]
    docs = []
    if ids:
        docs = await db.receipts.find(
            {"withdrawal_id": {"$in": ids}},
            {"_id": 0, "id": 1, "receipt_number": 1, "doc_type": 1, "created_at": 1, "withdrawal_id": 1},
        ).sort("created_at", 1).to_list(500)

    by_wr: dict = {}
    for d in docs:
        by_wr.setdefault(d.get("withdrawal_id"), []).append({
            "id": d.get("id"),
            "receipt_number": d.get("receipt_number"),
            "doc_type": d.get("doc_type"),
            "created_at": d.get("created_at"),
        })
    for w in items:
        w["documents"] = by_wr.get(w["id"], [])

    return {"payouts": items}

