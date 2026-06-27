"""Auto-extracted payments routes. Handler bodies are unchanged; shared names
(db, models, helpers, FastAPI symbols) are injected from the server module."""
from fastapi import APIRouter
import server as _srv

_g = globals()
for _k in dir(_srv):
    if not _k.startswith('__'):
        _g.setdefault(_k, getattr(_srv, _k))

router = APIRouter()


@router.get("/payments/config")
async def payments_config():
    return {
        "configured": payments.is_configured(),
        "test_mode": payments.is_test_key(),
        "currency": "EUR",
    }


@router.post("/payments/orders/{order_id}/checkout")
async def create_payment_checkout(
    order_id: str,
    body: CheckoutBody,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Shipper authorizes payment for an order via Stripe Checkout (manual capture)."""
    payload = _auth_payload(credentials)
    if payload.get("type") not in ("shipper", "admin"):
        raise HTTPException(403, "Shipper access required")

    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if payload.get("type") == "shipper" and order.get("shipper_id") != payload.get("sub"):
        raise HTTPException(403, "Not your order")

    if order.get("payment_status") in ("authorized", "captured"):
        raise HTTPException(400, f"Payment already {order.get('payment_status')}")

    amount = float(order.get("price_quote") or order.get("payment_amount") or 0)
    if amount <= 0:
        raise HTTPException(400, "Order has no payable amount")

    base = _public_base(request)
    success_url = body.success_url or f"{base}/api/payments/return?status=success&order_id={order_id}&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = body.cancel_url or f"{base}/api/payments/return?status=cancel&order_id={order_id}"

    try:
        session = payments.create_checkout_session(
            order_id=order_id,
            order_number=order.get("order_number", order_id),
            amount_eur=amount,
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "order_id": order_id,
                "shipper_id": order.get("shipper_id"),
                "driver_id": order.get("driver_id"),
            },
        )
    except Exception as exc:
        logger.error(f"Stripe checkout creation failed for {order_id}: {exc}")
        raise HTTPException(502, f"Could not start payment: {exc}")

    intent_id = getattr(session, "payment_intent", None)
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "payment_status": "pending",
            "stripe_checkout_session_id": session.id,
            "stripe_payment_intent_id": intent_id,
            "payment_amount": round(amount, 2),
        }},
    )
    return {"url": session.url, "session_id": session.id, "payment_status": "pending"}


@router.post("/payments/orders/{order_id}/pay-with-saved-card")
async def pay_order_with_saved_card(
    order_id: str,
    body: PayWithCardBody,
    shipper: dict = Depends(get_current_shipper),
):
    """One-tap: authorize an order's payment off-session using a saved card.

    Mirrors the hosted-Checkout flow but skips the redirect — the saved card is
    authorized immediately (manual capture), publishing the order to the driver
    marketplace. Funds are captured on delivery like every other payment.
    """
    if not payments.is_configured():
        raise HTTPException(503, "Payments are not configured")

    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order.get("shipper_id") != shipper.get("id"):
        raise HTTPException(403, "Not your order")
    if order.get("payment_status") in ("authorized", "captured"):
        raise HTTPException(400, f"Payment already {order.get('payment_status')}")

    amount = float(order.get("price_quote") or order.get("payment_amount") or 0)
    if amount <= 0:
        raise HTTPException(400, "Order has no payable amount")

    # Validates the card belongs to this shipper's Stripe customer.
    customer_id = await _assert_pm_owned(shipper, body.payment_method_id)

    try:
        intent = payments.create_offsession_authorization(
            customer_id=customer_id,
            payment_method_id=body.payment_method_id,
            amount_eur=amount,
            metadata={
                "order_id": order_id,
                "shipper_id": order.get("shipper_id"),
                "driver_id": order.get("driver_id"),
            },
        )
    except payments.stripe.error.CardError as e:
        err = e.error
        code = getattr(err, "code", None)
        msg = getattr(err, "user_message", None) or getattr(err, "message", None) or "Your card was declined."
        if code == "authentication_required":
            msg = "This card needs 3D Secure authentication. Please pay with the card form instead."
        logger.warning(f"Saved-card auth declined for order {order_id}: {code} / {msg}")
        raise HTTPException(402, msg)
    except Exception as exc:
        logger.error(f"Saved-card authorization failed for {order_id}: {exc}")
        raise HTTPException(502, "Could not charge the saved card. Please try again.")

    if getattr(intent, "status", "") not in ("requires_capture", "succeeded"):
        raise HTTPException(402, "Card could not be authorized. Please try another card.")

    await _apply_intent_to_order(order, intent)
    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _payment_summary(fresh)


@router.post("/payments/orders/{order_id}/authorize-test")
async def authorize_payment_test(
    order_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """TEST-ONLY: authorize an order's payment server-side using a Stripe test card.

    Lets QA/automation drive the full authorize -> capture flow without
    completing the hosted Checkout page. Disabled for live keys.
    """
    payload = _auth_payload(credentials)
    if payload.get("type") not in ("shipper", "admin"):
        raise HTTPException(403, "Shipper access required")
    if not payments.is_test_key():
        raise HTTPException(403, "Test authorization is only available with a Stripe test key")

    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order.get("payment_status") in ("authorized", "captured"):
        raise HTTPException(400, f"Payment already {order.get('payment_status')}")

    amount = float(order.get("price_quote") or 0)
    if amount <= 0:
        raise HTTPException(400, "Order has no payable amount")

    try:
        intent = payments.create_test_authorization(amount, metadata={"order_id": order_id})
    except Exception as exc:
        logger.error(f"Test authorization failed for {order_id}: {exc}")
        raise HTTPException(502, f"Authorization failed: {exc}")

    await _apply_intent_to_order(order, intent)
    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _payment_summary(fresh)


@router.get("/payments/orders/{order_id}/status")
async def get_payment_status(
    order_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Return the order's payment status, reconciled with Stripe."""
    payload = _auth_payload(credentials)
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")

    utype = payload.get("type")
    uid = payload.get("sub")
    if utype == "shipper" and order.get("shipper_id") != uid:
        raise HTTPException(403, "Not your order")
    if utype == "driver" and order.get("driver_id") != uid:
        raise HTTPException(403, "Not your order")

    if order.get("payment_status") in ("pending", "authorized") and (
        order.get("stripe_payment_intent_id") or order.get("stripe_checkout_session_id")
    ):
        await _sync_order_payment(order)
        order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _payment_summary(order)


@router.post("/payments/orders/{order_id}/capture")
async def capture_payment(
    order_id: str,
    body: CaptureBody,
    user: dict = Depends(get_admin_user),
):
    """Admin manually captures an authorized payment (e.g. on delivery confirmation)."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")

    if order.get("payment_status") == "captured":
        return _payment_summary(order)

    if order.get("payment_status") != "authorized":
        # try a sync first in case the hold just landed
        await _sync_order_payment(order)
        order = await db.orders.find_one({"id": order_id}, {"_id": 0})
        if order.get("payment_status") != "authorized":
            raise HTTPException(400, f"Order is not authorized (status: {order.get('payment_status')})")

    intent_id = order.get("stripe_payment_intent_id")
    if not intent_id:
        raise HTTPException(400, "No PaymentIntent on this order")

    amount_cents = payments.to_cents(body.amount) if body.amount else None
    try:
        intent = payments.capture_payment_intent(intent_id, amount_cents)
    except Exception as exc:
        logger.error(f"Capture failed for {order_id}: {exc}")
        raise HTTPException(502, f"Capture failed: {exc}")

    await _apply_intent_to_order(order, intent)
    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _payment_summary(fresh)


@router.post("/payments/orders/{order_id}/cancel-authorization")
async def cancel_authorization(
    order_id: str,
    user: dict = Depends(get_admin_user),
):
    """Admin releases an authorization hold (e.g. cancelled before delivery)."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    intent_id = order.get("stripe_payment_intent_id")
    if not intent_id or order.get("payment_status") not in ("authorized", "pending"):
        raise HTTPException(400, "No releasable authorization on this order")
    try:
        payments.cancel_payment_intent(intent_id)
    except Exception as exc:
        raise HTTPException(502, f"Could not release hold: {exc}")
    await db.orders.update_one({"id": order_id}, {"$set": {"payment_status": "canceled"}})
    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _payment_summary(fresh)


@router.post("/payments/orders/{order_id}/refund")
async def refund_payment(
    order_id: str,
    body: RefundBody,
    user: dict = Depends(get_admin_user),
):
    """Admin refunds a CAPTURED payment (full or partial) — e.g. dispute resolution.

    Full refund flips the order to 'refunded' (excluded from the driver's
    earnings); a partial refund keeps it 'captured' and is logged for audit.
    """
    if not payments.is_configured():
        raise HTTPException(503, "Payments are not configured")
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order.get("payment_status") != "captured":
        raise HTTPException(400, f"Only captured payments can be refunded (status: {order.get('payment_status')})")
    intent_id = order.get("stripe_payment_intent_id")
    if not intent_id:
        raise HTTPException(400, "No PaymentIntent on this order")

    captured = float(order.get("payment_amount") or 0)
    amount_eur = body.amount if (body.amount and body.amount > 0) else None
    if amount_eur is not None and amount_eur > captured + 0.01:
        raise HTTPException(400, f"Refund exceeds captured amount (€{captured:.2f})")
    amount_cents = payments.to_cents(amount_eur) if amount_eur is not None else None
    idem = f"refund_{order_id}_{amount_cents or 'full'}"

    try:
        refund = payments.refund_payment_intent(intent_id, amount_cents, idempotency_key=idem)
    except Exception as exc:
        logger.error(f"Refund failed for {order_id}: {exc}")
        raise HTTPException(502, f"Refund failed: {exc}")

    await _apply_refund_to_order(order, refund)
    if body.reason:
        await db.orders.update_one({"id": order_id}, {"$set": {"refund_reason": body.reason}})
    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
    summary = _payment_summary(fresh)
    summary["refunded_amount"] = fresh.get("refunded_amount")
    return summary


@router.get("/payments/return", response_class=HTMLResponse)
async def payment_return(status: str = "success", order_id: str = "", session_id: str = "", redirect: str = ""):
    """Lightweight landing page Stripe redirects to after hosted Checkout."""
    ok = status == "success"
    title = "Payment authorized" if ok else "Payment cancelled"
    color = "#16a34a" if ok else "#dc2626"
    emoji = "✅" if ok else "⚠️"
    msg = ("Your payment has been authorized. You can return to the NadaRuns app."
           if ok else "The payment was not completed. You can return to the app and try again.")

    # If the native app supplied a deep link, bounce straight back to it so the
    # in-app browser auto-closes (no manual "Done" tap needed).
    if redirect:
        sep = "&" if "?" in redirect else "?"
        target = f"{redirect}{sep}status={status}&order_id={order_id}"
        js_target = json.dumps(target)
        html = f"""<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>
<meta http-equiv='refresh' content='0;url={target}'>
<title>{title}</title>
<script>setTimeout(function(){{window.location.replace({js_target});}},60);</script></head>
<body style='font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e5e7eb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0'>
<div style='text-align:center;padding:24px;max-width:420px'>
<div style='font-size:56px'>{emoji}</div>
<h2 style='color:{color}'>{title}</h2>
<p style='color:#9ca3af'>Returning to the app…</p>
<p><a href='{target}' style='color:#60a5fa'>Tap here if not redirected</a></p>
</div></body></html>"""
        return HTMLResponse(content=html)

    html = f"""<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>
<title>{title}</title></head>
<body style='font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e5e7eb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0'>
<div style='text-align:center;padding:24px;max-width:420px'>
<div style='font-size:56px'>{emoji}</div>
<h2 style='color:{color}'>{title}</h2>
<p style='color:#9ca3af;line-height:1.5'>{msg}</p>
</div></body></html>"""
    return HTMLResponse(content=html)


@router.post("/payments/webhook")
async def stripe_webhook(request: Request):
    """Stripe webhook: verify signature, dedupe event ids (retries), reconcile."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    event = None
    if payments.STRIPE_WEBHOOK_SECRET:
        try:
            event = payments.construct_webhook_event(payload, sig)
        except Exception as exc:
            logger.warning(f"Webhook signature verification failed: {exc}")
            raise HTTPException(400, "Invalid signature")
    else:
        # Dev fallback when no signing secret is configured.
        try:
            event = json.loads(payload.decode("utf-8"))
        except Exception:
            raise HTTPException(400, "Invalid payload")

    event_id = event.get("id") if isinstance(event, dict) else getattr(event, "id", None)
    etype = event.get("type") if isinstance(event, dict) else event["type"]
    obj = (event.get("data", {}) or {}).get("object", {}) if isinstance(event, dict) else event["data"]["object"]

    # Idempotency: ignore retried / duplicate deliveries.
    if event_id and await _webhook_event_seen(event_id):
        return {"received": True, "duplicate": True}

    # ---- Refunds (incl. dashboard refunds / disputes refunded) ----
    if etype == "charge.refunded":
        intent_id = obj.get("payment_intent")
        refunds_data = (obj.get("refunds") or {}).get("data") or []
        rf = refunds_data[0] if refunds_data else {"id": obj.get("id"), "amount": obj.get("amount_refunded")}
        if intent_id:
            order = await db.orders.find_one({"stripe_payment_intent_id": intent_id}, {"_id": 0})
            if order:
                shim = type("R", (), {"id": rf.get("id"), "amount": rf.get("amount"), "payment_intent": intent_id})
                try:
                    await _apply_refund_to_order(order, shim)
                except Exception as exc:
                    logger.warning(f"Webhook refund reconcile failed for {intent_id}: {exc}")
        return {"received": True}

    if etype == "charge.dispute.created":
        intent_id = obj.get("payment_intent")
        if intent_id:
            await db.orders.update_one(
                {"stripe_payment_intent_id": intent_id},
                {"$set": {"has_dispute": True, "dispute_at": datetime.now(timezone.utc).isoformat()}},
            )
        return {"received": True}

    # ---- Authorizations / captures / failures ----
    intent_id = None
    if etype.startswith("payment_intent."):
        intent_id = obj.get("id")
    elif etype == "checkout.session.completed":
        intent_id = obj.get("payment_intent")

    if intent_id:
        order = await db.orders.find_one({"stripe_payment_intent_id": intent_id}, {"_id": 0})
        if not order:
            md = obj.get("metadata", {}) or {}
            if md.get("order_id"):
                order = await db.orders.find_one({"id": md["order_id"]}, {"_id": 0})
        if order:
            if etype == "payment_intent.payment_failed":
                await db.orders.update_one(
                    {"id": order["id"]}, {"$set": {"payment_status": "payment_failed"}}
                )
            else:
                try:
                    intent = payments.retrieve_payment_intent(intent_id)
                    await _apply_intent_to_order(order, intent)
                except Exception as exc:
                    logger.warning(f"Webhook reconcile failed for {intent_id}: {exc}")

    return {"received": True}
