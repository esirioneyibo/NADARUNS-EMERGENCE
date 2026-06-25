"""Auto-extracted shipper routes. Handler bodies are unchanged; shared names
(db, models, helpers, FastAPI symbols) are injected from the server module."""
from fastapi import APIRouter
import server as _srv

_g = globals()
for _k in dir(_srv):
    if not _k.startswith('__'):
        _g.setdefault(_k, getattr(_srv, _k))

router = APIRouter()


@router.post("/shipper/shipments/{order_id}/rate-driver")
async def rate_driver(
    order_id: str,
    body: StarRatingRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Shipper rates their driver (1-5 stars, one-time) after a delivered job.
    Recomputes and persists the driver's average rating on their profile."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "shipper":
        raise HTTPException(403, "Shipper access required")
    shipper_id = payload["sub"]

    if not (1 <= int(body.rating) <= 5):
        raise HTTPException(400, "Rating must be between 1 and 5 stars")

    order = await db.orders.find_one({"id": order_id, "shipper_id": shipper_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Shipment not found")
    if order.get("status") != "delivered":
        raise HTTPException(400, "You can only rate the driver once the job is delivered")
    if not order.get("driver_id"):
        raise HTTPException(400, "No driver was assigned to this shipment")
    if order.get("driver_rating") is not None:
        raise HTTPException(400, "You have already rated this driver")

    now = datetime.now(timezone.utc).isoformat()
    review = (body.review or "").strip() or None
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"driver_rating": int(body.rating), "driver_review": review, "driver_rated_at": now}},
    )
    new_avg = await _recompute_driver_rating(order["driver_id"])
    return {
        "success": True,
        "driver_rating": int(body.rating),
        "driver_review": review,
        "driver_average_rating": new_avg,
    }


@router.post("/shipper/register")
async def register_shipper(registration: ShipperRegistration):
    """Register a new shipper/business account."""
    # Check if email already exists
    existing = await db.shippers.find_one({"email": registration.email})
    if existing:
        raise HTTPException(400, "A business with this email already exists")
    
    shipper_id = str(uuid.uuid4())
    password_hash = hash_password(registration.password)
    
    new_shipper = Shipper(
        id=shipper_id,
        company_name=registration.company_name,
        contact_name=registration.contact_name,
        email=registration.email,
        phone=registration.phone,
        password_hash=password_hash,
        tax_id=registration.tax_id,
        address=registration.address,
        avatar=f"https://api.dicebear.com/7.x/initials/png?seed={registration.company_name}",
    )
    
    await db.shippers.insert_one(new_shipper.model_dump())
    
    token = create_token(shipper_id, "shipper")
    
    logger.info(f"Registered new shipper: {registration.email} ({shipper_id})")

    subj, html = email_tpl.welcome(registration.company_name, "shipper")
    send_email_bg(registration.email, subj, html, to_name=registration.company_name,
                  category="shipper_welcome", related_id=shipper_id)

    return {
        "shipper_id": shipper_id,
        "token": token,
        "message": "Business registration successful!"
    }


@router.get("/shipper/me")
async def get_shipper_profile(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get current shipper profile."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "shipper":
        raise HTTPException(403, "Shipper access required")
    
    shipper = await db.shippers.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not shipper:
        raise HTTPException(404, "Shipper not found")
    
    return shipper


@router.patch("/shipper/me")
async def update_shipper_profile(
    update: ShipperUpdate,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Update shipper profile."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "shipper":
        raise HTTPException(403, "Shipper access required")
    
    shipper_id = payload["sub"]
    
    # Build update payload (only include non-None fields)
    update_data = {k: v for k, v in update.model_dump(exclude_unset=True).items() if v is not None}
    
    # Validate vehicle type if provided
    if update_data.get("preferred_vehicle_type") and update_data["preferred_vehicle_type"] not in VEHICLE_TYPES:
        raise HTTPException(400, f"Invalid vehicle type: {update_data['preferred_vehicle_type']}")
    
    if update_data:
        await db.shippers.update_one({"id": shipper_id}, {"$set": update_data})
    
    shipper = await db.shippers.find_one({"id": shipper_id}, {"_id": 0, "password_hash": 0})
    if not shipper:
        raise HTTPException(404, "Shipper not found")
    
    logger.info(f"Updated shipper profile: {shipper_id}")
    
    return shipper


@router.get("/shipper/vehicle-types")
async def get_vehicle_types():
    """Get available vehicle types for shipping."""
    return list(VEHICLE_TYPES.values())


@router.post("/shipper/quote", response_model=PriceQuoteResponse)
async def get_price_quote(request: PriceQuoteRequest):
    """Get a price quote for a shipment.

    Pricing uses REAL-WORLD road distance from Google Directions (driving). If
    the route cannot be computed we hard-fail (NO Haversine fallback for money).
    """
    # Validate vehicle type first (cheap check before hitting Google).
    vehicle = VEHICLE_TYPES.get(request.vehicle_type)
    if not vehicle:
        raise HTTPException(400, f"Invalid vehicle type: {request.vehicle_type}")

    # Haversine kept ONLY as a reference value (not used for pricing).
    straight_km = _haversine_km(
        request.pickup_lat, request.pickup_lng,
        request.dropoff_lat, request.dropoff_lng,
    )

    # SOURCE OF TRUTH: Google Directions road distance + duration.
    route = await fetch_road_route(
        request.pickup_lat, request.pickup_lng,
        request.dropoff_lat, request.dropoff_lng,
    )
    road_km = route["road_distance_km"]

    # NadaRuns pricing engine (driven by ROAD distance)
    breakdown = pricing.calculate_price(
        vehicle_type=request.vehicle_type,
        distance_km=road_km,
        weight_kg=request.cargo_weight_kg,
        urgency=request.urgency,
        special_handling=request.special_handling,
        volume_m3=request.cargo_volume_m3,
        pallets=request.pallet_count,
        loading_meters=request.loading_meters,
    )

    estimated_duration = max(1, int(round(route["duration_minutes"])))

    return PriceQuoteResponse(
        distance_km=road_km,
        straight_distance_km=round(straight_km, 2),
        road_distance_km=road_km,
        route_source=route["source"],
        estimated_duration_minutes=estimated_duration,
        base_price=round(breakdown["base_fee"] + breakdown["distance_fee"], 2),
        weight_surcharge=breakdown["freight_fee"],
        total_price=breakdown["total_price"],
        vehicle_type=request.vehicle_type,
        base_fee=breakdown["base_fee"],
        distance_fee=breakdown["distance_fee"],
        weight_fee=breakdown["freight_fee"],
        freight_fee=breakdown["freight_fee"],
        freight_rate_per_kg=breakdown["freight_rate_per_kg"],
        chargeable_weight=breakdown["chargeable_weight"],
        chargeable_basis=breakdown["chargeable_basis"],
        actual_weight_kg=breakdown["actual_weight_kg"],
        fuel_surcharge=breakdown["fuel_surcharge"],
        urgency=breakdown["urgency"],
        urgency_multiplier=breakdown["urgency_multiplier"],
        special_multiplier=breakdown["special_multiplier"],
        estimate_low=breakdown["estimate_low"],
        estimate_high=breakdown["estimate_high"],
    )


@router.post("/shipper/shipments")
async def create_shipment(
    request: ShipmentCreateRequest,
    http_request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Create a new shipment order.

    Supports an optional `Idempotency-Key` header so a retried request (e.g.
    after a flaky mobile network) replays the original result instead of
    creating a duplicate job.
    """
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "shipper":
        raise HTTPException(403, "Shipper access required")
    
    shipper_id = payload["sub"]

    # Idempotency: replay the stored response if this key was already used.
    idem_key = idempotency.extract_key(http_request)
    if idem_key:
        existing = await idempotency.get_existing(db, idem_key, scope=f"shipment:{shipper_id}")
        if existing and existing.get("response"):
            return existing["response"]

    shipper = await db.shippers.find_one({"id": shipper_id}, {"_id": 0})
    if not shipper:
        raise HTTPException(404, "Shipper not found")

    if shipper.get("is_suspended"):
        raise HTTPException(403, "Your account is suspended. Please contact support.")
    
    # Validate vehicle type
    vehicle = VEHICLE_TYPES.get(request.vehicle_type)
    if not vehicle:
        raise HTTPException(400, f"Invalid vehicle type: {request.vehicle_type}")
    
    # Check weight capacity
    if request.cargo_weight_kg > vehicle["max_weight_kg"]:
        raise HTTPException(400, f"Cargo weight exceeds vehicle capacity ({vehicle['max_weight_kg']} kg)")
    
    # Haversine kept ONLY as a reference value (geofencing) - NOT for pricing.
    straight_km = _haversine_km(
        request.pickup_lat, request.pickup_lng,
        request.dropoff_lat, request.dropoff_lng
    )

    # SOURCE OF TRUTH for pricing/earnings/ETA: Google Directions road distance.
    # Hard-fail BEFORE creating the order so we never publish/charge a job whose
    # price was computed from straight-line distance.
    route = await fetch_road_route(
        request.pickup_lat, request.pickup_lng,
        request.dropoff_lat, request.dropoff_lng,
    )
    road_km = route["road_distance_km"]
    duration_minutes = route["duration_minutes"]

    # NadaRuns pricing engine (immutable base price, driven by ROAD distance)
    special_handling = bool(
        (request.special_requirements and len(request.special_requirements) > 0)
        or request.cargo_type == "oversized"
    )
    breakdown = pricing.calculate_price(
        vehicle_type=request.vehicle_type,
        distance_km=road_km,
        weight_kg=request.cargo_weight_kg,
        urgency=request.urgency,
        special_handling=special_handling,
        volume_m3=request.cargo_volume_m3,
        pallets=request.pallet_count,
        loading_meters=request.loading_meters,
    )
    base_total = breakdown["total_price"]

    # Optional shipper bonus on top of the base (paid fully to the driver).
    offer = max(0.0, float(request.shipper_offer or 0.0))
    total_price = round(base_total + offer, 2)

    # Generate order
    order_id = str(uuid.uuid4())
    order_number = f"SHP-{random.randint(1000, 9999)}"
    
    # Create OTPs
    pickup_otp = str(random.randint(1000, 9999))
    dropoff_otp = str(random.randint(1000, 9999))
    
    # Driver keeps 80% of base + 100% of the shipper's bonus.
    driver_earnings = pricing.driver_earnings(base_total, offer)
    
    new_order = Order(
        id=order_id,
        order_number=order_number,
        status="pending",
        pickup=GeoPoint(
            lat=request.pickup_lat,
            lng=request.pickup_lng,
            address=request.pickup_address,
            name=request.pickup_contact_name,
        ),
        dropoff=GeoPoint(
            lat=request.dropoff_lat,
            lng=request.dropoff_lng,
            address=request.dropoff_address,
            name=request.dropoff_contact_name,
        ),
        customer=Customer(
            name=request.dropoff_contact_name,
            rating=5.0,
            phone=request.dropoff_contact_phone,
            notes=request.dropoff_notes,
        ),
        items=[OrderItem(name=request.cargo_description, quantity=1)],
        distance_km=round(road_km, 2),
        straight_distance_km=round(straight_km, 2),
        road_distance_km=round(road_km, 2),
        duration_minutes=duration_minutes,
        route_polyline=route["polyline"],
        eta_minutes=max(1, int(round(duration_minutes))),
        earnings=round(driver_earnings, 2),
        tip=round(offer, 2),
        pickup_otp=pickup_otp,
        dropoff_otp=dropoff_otp,
        shipper_id=shipper_id,
        vehicle_type=request.vehicle_type,
        cargo_weight_kg=request.cargo_weight_kg,
        cargo_dimensions=request.cargo_dimensions,
        cargo_type=request.cargo_type,
        special_requirements=request.special_requirements,
        scheduled_pickup=request.scheduled_pickup,
        price_quote=round(total_price, 2),
        shipper_notes=request.pickup_notes,
    )
    
    await db.orders.insert_one(new_order.model_dump())
    
    # Update shipper stats
    await db.shippers.update_one(
        {"id": shipper_id},
        {"$inc": {"total_shipments": 1}}
    )
    
    logger.info(f"Shipper {shipper_id} created shipment {order_id}")

    if shipper.get("email"):
        subj, html = email_tpl.order_created(
            shipper.get("contact_name") or shipper.get("company_name") or "there",
            {
                "order_number": order_number,
                "pickup": request.pickup_address,
                "dropoff": request.dropoff_address,
                "price": total_price,
            },
        )
        send_email_bg(shipper["email"], subj, html,
                      to_name=shipper.get("contact_name") or shipper.get("company_name"),
                      category="order_created", related_id=order_id)

    # Audit trail: record order creation.
    await audit.record_event(
        db, order_id, "order_created",
        from_status=None, to_status="pending",
        actor_id=shipper_id, actor_type="shipper",
        metadata={"vehicle_type": request.vehicle_type, "price": round(total_price, 2)},
    )

    # NOTE: drivers are NOT notified here. The order is only published to the
    # marketplace once the shipper's payment is AUTHORIZED (see
    # _apply_intent_to_order), enforcing pay-at-creation.
    
    response = {
        "order_id": order_id,
        "order_number": order_number,
        "status": "pending",
        "pickup_otp": pickup_otp,
        "dropoff_otp": dropoff_otp,
        "price": total_price,
        "base_price": base_total,
        "offer": round(offer, 2),
        "breakdown": breakdown,
        "distance_km": round(road_km, 2),
        "straight_distance_km": round(straight_km, 2),
        "road_distance_km": round(road_km, 2),
        "duration_minutes": duration_minutes,
        "polyline": route["polyline"],
        "estimated_duration_minutes": new_order.eta_minutes,
        "message": "Shipment created successfully! Waiting for driver assignment."
    }

    # Persist idempotent response for safe client retries.
    await idempotency.store(db, idem_key, scope=f"shipment:{shipper_id}", response=response)

    return response


@router.get("/shipper/shipments")
async def get_shipper_shipments(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get all shipments for the current shipper."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "shipper":
        raise HTTPException(403, "Shipper access required")
    
    shipper_id = payload["sub"]
    
    shipments = []
    async for order in db.orders.find({"shipper_id": shipper_id}, {"_id": 0}).sort("created_at", -1):
        # Get driver info if assigned
        driver_info = None
        if order.get("driver_id"):
            driver = await db.drivers.find_one({"id": order["driver_id"]}, {"_id": 0, "password_hash": 0})
            if driver:
                driver_info = {
                    "id": driver["id"],
                    "name": driver["name"],
                    "phone": driver.get("phone"),
                    "vehicle": driver.get("vehicle"),
                    "rating": driver.get("rating"),
                    "avatar": driver.get("avatar"),
                }
        
        shipments.append({
            **order,
            "driver": driver_info,
        })
    
    return shipments


@router.get("/shipper/shipments/{order_id}")
async def get_shipment_details(
    order_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Get details of a specific shipment."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "shipper":
        raise HTTPException(403, "Shipper access required")
    
    shipper_id = payload["sub"]
    
    order = await db.orders.find_one({"id": order_id, "shipper_id": shipper_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Shipment not found")
    
    # Get driver info if assigned
    driver_info = None
    if order.get("driver_id"):
        driver = await db.drivers.find_one({"id": order["driver_id"]}, {"_id": 0, "password_hash": 0})
        if driver:
            driver_info = {
                "id": driver["id"],
                "name": driver["name"],
                "phone": driver.get("phone"),
                "vehicle": driver.get("vehicle"),
                "rating": driver.get("rating"),
                "avatar": driver.get("avatar"),
                "location": driver.get("location"),
            }
    
    return {
        **order,
        "driver": driver_info,
    }


@router.post("/shipper/shipments/{order_id}/cancel")
async def cancel_shipment(
    order_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Cancel a shipment before pickup.

    Cancellation policy:
      * Within the free window (default 60 min of creation) -> the payment
        authorization is released; the shipper is charged nothing.
      * After the free window -> a cancellation fee (default 15% of the price)
        is captured and the remaining hold is released.
    """
    if not credentials:
        raise HTTPException(401, "Authentication required")

    payload = decode_token(credentials.credentials)
    if payload.get("type") != "shipper":
        raise HTTPException(403, "Shipper access required")

    shipper_id = payload["sub"]

    order = await db.orders.find_one({"id": order_id, "shipper_id": shipper_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Shipment not found")

    # Can only cancel if not yet picked up
    if order["status"] in ["picked_up", "enroute_dropoff", "arrived_dropoff", "delivered"]:
        raise HTTPException(400, "Cannot cancel shipment after pickup")
    if order["status"] in ["rejected", "cancelled"]:
        raise HTTPException(400, "Shipment is already cancelled")

    policy = await get_cancellation_policy()
    free_minutes = policy["free_cancel_minutes"]
    fee_pct = policy["cancel_fee_pct"]

    # Minutes elapsed since the order was created.
    minutes_since = 0.0
    created_raw = order.get("created_at")
    if created_raw:
        try:
            created_dt = datetime.fromisoformat(str(created_raw).replace("Z", "+00:00"))
            if created_dt.tzinfo is None:
                created_dt = created_dt.replace(tzinfo=timezone.utc)
            minutes_since = (datetime.now(timezone.utc) - created_dt).total_seconds() / 60.0
        except Exception:
            minutes_since = 0.0

    within_free = minutes_since <= free_minutes
    cancellation_fee = 0.0
    refund_note = "No payment was charged."
    intent_id = order.get("stripe_payment_intent_id")
    pay_status = order.get("payment_status")
    amount = float(order.get("payment_amount") or order.get("price_quote") or 0)
    new_pay_status = pay_status or "unpaid"

    if intent_id and pay_status == "authorized":
        try:
            if within_free or fee_pct <= 0 or amount <= 0:
                payments.cancel_payment_intent(intent_id)
                new_pay_status = "canceled"
                refund_note = "Authorization released — you were not charged."
            else:
                fee_cents = max(1, payments.to_cents(round(amount * fee_pct, 2)))
                payments.capture_payment_intent(intent_id, amount_cents=fee_cents)
                cancellation_fee = payments.from_cents(fee_cents)
                new_pay_status = "captured"
                refund_note = (
                    f"Cancellation fee of €{cancellation_fee:.2f} charged; "
                    f"the remaining hold was released."
                )
        except Exception as exc:
            logger.error(f"Cancel payment handling failed for {order_id}: {exc}")
            raise HTTPException(502, f"Could not process cancellation payment: {exc}")

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "status": "rejected",
            "completed_at": now_iso,
            "cancelled_at": now_iso,
            "payment_status": new_pay_status,
            "cancellation_fee": round(cancellation_fee, 2),
        }},
    )

    try:
        await audit.record_event(
            db, order_id, "order_cancelled",
            from_status=order["status"], to_status="rejected",
            actor_id=shipper_id, actor_type="shipper",
            metadata={
                "minutes_since_create": round(minutes_since, 1),
                "within_free": within_free,
                "cancellation_fee": round(cancellation_fee, 2),
            },
        )
    except Exception:
        pass

    logger.info(
        f"Shipper {shipper_id} cancelled shipment {order_id} "
        f"(fee €{cancellation_fee:.2f}, within_free={within_free})"
    )

    return {
        "message": "Shipment cancelled",
        "cancellation_fee": round(cancellation_fee, 2),
        "within_free_window": within_free,
        "free_cancel_minutes": free_minutes,
        "cancel_fee_pct": fee_pct,
        "refund_note": refund_note,
    }


@router.get("/shipper/shipments/{order_id}/tracking")
async def track_shipment(
    order_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Get real-time tracking info for a shipment."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "shipper":
        raise HTTPException(403, "Shipper access required")
    
    shipper_id = payload["sub"]
    
    order = await db.orders.find_one({"id": order_id, "shipper_id": shipper_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Shipment not found")
    
    # Get driver location if assigned and in transit
    driver_location = None
    driver_info = None
    if order.get("driver_id") and order["status"] in ["enroute_pickup", "arrived_pickup", "picked_up", "enroute_dropoff", "arrived_dropoff"]:
        driver = await db.drivers.find_one({"id": order["driver_id"]}, {"_id": 0})
        if driver:
            driver_info = {
                "name": driver["name"],
                "phone": driver.get("phone"),
                "vehicle": driver.get("vehicle"),
                "avatar": driver.get("avatar"),
            }
            # Simulate driver location (in real app, this would come from driver's location updates)
            if order["status"] in ["enroute_pickup", "arrived_pickup"]:
                driver_location = {"lat": order["pickup"]["lat"], "lng": order["pickup"]["lng"]}
            else:
                driver_location = {"lat": order["dropoff"]["lat"], "lng": order["dropoff"]["lng"]}
    
    # Status descriptions
    status_messages = {
        "pending": "Waiting for driver assignment",
        "accepted": "Driver assigned, preparing for pickup",
        "enroute_pickup": "Driver is on the way to pickup",
        "arrived_pickup": "Driver arrived at pickup location",
        "picked_up": "Cargo picked up, preparing for delivery",
        "enroute_dropoff": "Driver is on the way to delivery",
        "arrived_dropoff": "Driver arrived at delivery location",
        "delivered": "Delivery completed",
        "rejected": "Shipment cancelled",
    }
    
    return {
        "order_id": order_id,
        "status": order["status"],
        "status_message": status_messages.get(order["status"], "Unknown status"),
        "pickup": order["pickup"],
        "dropoff": order["dropoff"],
        "driver": driver_info,
        "driver_location": driver_location,
        "eta_minutes": order.get("eta_minutes"),
        "created_at": order.get("created_at"),
        "completed_at": order.get("completed_at"),
    }


@router.get("/shipper/receipts")
async def shipper_list_receipts(shipper: dict = Depends(get_current_shipper)):
    rows = await db.receipts.find(
        {"user_id": shipper["id"], "user_type": "shipper"}, {"_id": 0}
    ).sort("issued_at", -1).to_list(200)
    return rows


@router.post("/shipper/shipments/{order_id}/accept-invoice")
async def shipper_accept_invoice(order_id: str, shipper: dict = Depends(get_current_shipper)):
    """Shipper chooses 'Accept Invoice' for an order -> generate a Net-14 invoice."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order.get("shipper_id") != shipper["id"]:
        raise HTTPException(403, "This order does not belong to you")
    already = await db.invoices.find_one({"order_id": order_id}, {"_id": 0, "id": 1})
    invoice = await _create_invoice_for_order(order, shipper)
    if not already:
        await _email_invoice_pdf(invoice)
    return invoice


@router.get("/shipper/invoices")
async def shipper_list_invoices(shipper: dict = Depends(get_current_shipper)):
    rows = await db.invoices.find({"shipper_id": shipper["id"]}, {"_id": 0}).sort("issued_at", -1).to_list(200)
    return rows


@router.post("/shipper/payment-methods/setup-checkout")
async def shipper_setup_card_checkout(
    body: SetupCheckoutBody,
    request: Request,
    shipper: dict = Depends(get_current_shipper),
):
    """Start a hosted Checkout (setup mode) so the shipper can save a card."""
    if not payments.is_configured():
        raise HTTPException(503, "Payments are not configured")
    customer_id = await _get_or_create_shipper_customer(shipper)
    base = _public_base(request)
    success = body.success_url or f"{base}/api/payments/return?status=success&redirect="
    cancel = body.cancel_url or f"{base}/api/payments/return?status=cancel&redirect="
    try:
        session = payments.create_setup_checkout_session(
            customer_id=customer_id,
            success_url=success,
            cancel_url=cancel,
            metadata={"shipper_id": shipper.get("id")},
        )
    except Exception as exc:
        logger.error(f"Stripe setup checkout failed for shipper {shipper.get('id')}: {exc}")
        raise HTTPException(502, "Could not start card setup")
    return {"url": session.url, "session_id": session.id}


@router.get("/shipper/payment-methods")
async def shipper_list_payment_methods(shipper: dict = Depends(get_current_shipper)):
    """List the shipper's saved cards (default first)."""
    sid = shipper.get("id")
    doc = await db.shippers.find_one({"id": sid}, {"_id": 0, "stripe_customer_id": 1})
    customer_id = (doc or {}).get("stripe_customer_id")
    if not customer_id:
        return {"customer_id": None, "payment_methods": []}
    try:
        pms = payments.list_payment_methods(customer_id)
    except Exception as exc:
        logger.warning(f"list payment methods failed for shipper {sid}: {exc}")
        pms = []
    return {"customer_id": customer_id, "payment_methods": pms}


@router.post("/shipper/payment-methods/{payment_method_id}/default")
async def shipper_set_default_card(payment_method_id: str, shipper: dict = Depends(get_current_shipper)):
    customer_id = await _assert_pm_owned(shipper, payment_method_id)
    payments.set_default_payment_method(customer_id, payment_method_id)
    return {"ok": True, "default_payment_method_id": payment_method_id}


@router.delete("/shipper/payment-methods/{payment_method_id}")
async def shipper_delete_card(payment_method_id: str, shipper: dict = Depends(get_current_shipper)):
    await _assert_pm_owned(shipper, payment_method_id)
    payments.detach_payment_method(payment_method_id)
    return {"ok": True}
