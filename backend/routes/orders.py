"""Auto-extracted orders routes. Handler bodies are unchanged; shared names
(db, models, helpers, FastAPI symbols) are injected from the server module."""
from fastapi import APIRouter
import server as _srv

_g = globals()
for _k in dir(_srv):
    if not _k.startswith('__'):
        _g.setdefault(_k, getattr(_srv, _k))

router = APIRouter()


@router.get("/orders/pending", response_model=Optional[Order])
async def get_pending():
    # Jobs are published to drivers as soon as they are created (1a); payment
    # is handled separately and does not gate marketplace visibility.
    order = await db.orders.find_one(
        {"status": "pending"},
        {"_id": 0},
    )
    if not order:
        return None
    return Order(**order)


@router.get("/orders/available", response_model=List[Order])
async def get_available_orders(
    vehicle_type: Optional[str] = None,
    min_capacity_kg: Optional[int] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: float = 50.0,
):
    """
    Get all available (pending) orders for map-based job discovery.
    Returns orders with their pickup locations for displaying on driver's map.

    Optional filters:
    - vehicle_type: Filter orders requiring a specific vehicle type
    - min_capacity_kg: Filter orders where cargo weight is within this capacity
    - lat/lng + radius_km: only return jobs whose pickup is within radius_km of
      the driver, sorted nearest-first (so the "jobs nearby" count is accurate)
    """
    query = {"status": "pending"}
    # Jobs are visible to drivers as soon as the shipper creates them (1a).
    # Payment is handled separately and no longer gates marketplace visibility.
    
    # Filter by vehicle type if specified
    if vehicle_type:
        # Show orders that either:
        # 1. Require this exact vehicle type
        # 2. Have no vehicle type requirement (legacy orders)
        query["$or"] = [
            {"vehicle_type": vehicle_type},
            {"vehicle_type": None},
            {"vehicle_type": {"$exists": False}},
        ]
    
    # Filter by capacity if specified
    if min_capacity_kg:
        # Show orders where cargo weight is within the driver's capacity
        query["$or"] = query.get("$or", []) + [
            {"cargo_weight_kg": {"$lte": min_capacity_kg}},
            {"cargo_weight_kg": None},
            {"cargo_weight_kg": {"$exists": False}},
        ]
    
    def _enrich(o: dict) -> dict:
        dist = o.get("distance_km") or 0
        try:
            o["payout_per_km"] = round(float(o.get("earnings") or 0) / dist, 2) if dist else None
        except Exception:
            o["payout_per_km"] = None
        return o

    if lat is not None and lng is not None:
        # Make sure pending orders carry a GeoJSON pickup_location for $geoNear.
        try:
            await db.orders.update_many(
                {"status": "pending",
                 "$or": [{"pickup_location": {"$exists": False}}, {"pickup_location": None}],
                 "pickup.lat": {"$type": "number"}, "pickup.lng": {"$type": "number"}},
                [{"$set": {"pickup_location": {"type": "Point", "coordinates": ["$pickup.lng", "$pickup.lat"]}}}],
            )
        except Exception as exc:
            logger.warning(f"lazy pickup_location backfill failed: {exc}")

        # 2dsphere proximity search — returns jobs nearest-first with real distance.
        pipeline = [
            {"$geoNear": {
                "near": {"type": "Point", "coordinates": [lng, lat]},
                "distanceField": "pickup_distance_m",
                "maxDistance": radius_km * 1000,
                "spherical": True,
                "query": query,
            }},
            {"$limit": 50},
            {"$project": {"_id": 0}},
        ]
        items = await db.orders.aggregate(pipeline).to_list(50)
        for o in items:
            o["pickup_distance_km"] = round((o.pop("pickup_distance_m", 0) or 0) / 1000, 1)
            _enrich(o)
    else:
        items = await db.orders.find(query, {"_id": 0}).limit(50).to_list(50)
        for o in items:
            _enrich(o)

    # Defensive serialization: never let a single malformed order 500 the whole
    # feed (which would make ALL jobs vanish from every driver's screen).
    result = []
    for o in items:
        try:
            result.append(Order(**o))
        except Exception as exc:
            logger.warning(f"Skipping malformed order {o.get('order_number') or o.get('id')} in available feed: {exc}")
    return result


@router.get("/orders/available/matched", response_model=List[Order])
async def get_matched_orders(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Get available orders matched to the driver's vehicle type and capacity.
    Orders are sorted by best match (exact vehicle type match first).
    """
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "driver":
        raise HTTPException(403, "Driver access required")
    
    driver = await db.drivers.find_one({"id": payload["sub"]}, {"_id": 0})
    if not driver:
        raise HTTPException(404, "Driver not found")
    
    driver_vehicle_type = driver.get("vehicle_type", "cargo_van")
    driver_capacity = driver.get("vehicle_capacity_kg", 1500)
    
    # Get all pending orders
    all_orders = await db.orders.find({"status": "pending"}, {"_id": 0}).limit(100).to_list(100)
    
    # Score and filter orders based on vehicle match
    matched_orders = []
    for order in all_orders:
        order_vehicle_type = order.get("vehicle_type")
        order_weight = order.get("cargo_weight_kg", 0) or 0
        
        # Check if driver can handle this order
        if order_weight > driver_capacity:
            continue  # Skip orders that exceed driver's capacity
        
        # Calculate match score
        score = 0
        if order_vehicle_type is None:
            # No vehicle preference - any driver can take it
            score = 1
        elif order_vehicle_type == driver_vehicle_type:
            # Exact match - highest priority
            score = 3
        else:
            # Check if driver's vehicle can handle this type of order
            # Allow higher capacity vehicles to take lower capacity orders
            order_vehicle_info = VEHICLE_TYPES.get(order_vehicle_type)
            driver_vehicle_info = VEHICLE_TYPES.get(driver_vehicle_type)
            
            if order_vehicle_info and driver_vehicle_info:
                if driver_vehicle_info["max_weight_kg"] >= order_vehicle_info["max_weight_kg"]:
                    score = 2  # Driver has bigger/equal vehicle
                # Special case: specialized vehicles can only take their own type
                if order_vehicle_info["category"] == "Specialized" and order_vehicle_type != driver_vehicle_type:
                    continue  # Skip specialized orders if vehicle doesn't match
        
        if score > 0:
            matched_orders.append((score, order))
    
    # Sort by score (highest first), then by earnings (highest first)
    matched_orders.sort(key=lambda x: (-x[0], -(x[1].get("earnings", 0) or 0)))
    
    return [Order(**order) for _, order in matched_orders[:50]]


@router.get("/orders/active", response_model=Optional[Order])
async def get_active(request: Request):
    """Return the authenticated driver's current active order.

    Filters by the driver bound to the order so a driver only ever sees
    their own in-progress job. Legacy orders with no driver_id remain
    visible for backward compatibility.
    """
    driver_id = await get_optional_driver_id(request)
    query: dict = {"status": {"$in": list(sm.ACTIVE_STATES)}}
    if driver_id:
        query["driver_id"] = {"$in": [driver_id, None]}
    order = await db.orders.find_one(query, {"_id": 0})
    if not order:
        return None
    return Order(**order)


@router.get("/orders/history", response_model=List[Order])
async def get_history(request: Request):
    """Get delivery history for the authenticated driver."""
    # Get the authenticated driver
    driver_id = await get_current_driver_id(request)
    
    # Return only orders that were delivered by this driver
    cursor = db.orders.find(
        {"status": "delivered", "driver_id": driver_id}, 
        {"_id": 0}
    ).sort("completed_at", -1).limit(50)
    items = await cursor.to_list(50)
    return [Order(**o) for o in items]


@router.get("/orders/{order_id}/match")
async def order_marketplace_match(order_id: str, request: Request, empty: bool = False):
    """Per-driver marketplace pricing for a job: empty-run + route-match
    discounts and the region's supply/demand, with the driver's resulting
    earnings. `?empty=true` is the manual "returning empty" override; otherwise
    it is auto-inferred from the driver's recent delivery + current location.
    """
    driver_id = await get_current_driver_id(request)
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0}) or {}

    pickup = {"lat": order["pickup"]["lat"], "lng": order["pickup"]["lng"]}
    dropoff = {"lat": order["dropoff"]["lat"], "lng": order["dropoff"]["lng"]}
    origin = driver.get("current_location") or None
    if origin and (origin.get("lat") is None or origin.get("lng") is None):
        origin = None

    # Driver's existing journey destination (active job drop-off), if any.
    active = await db.orders.find_one(
        {"driver_id": driver_id, "status": {"$in": list(sm.ACTIVE_STATES)}}, {"_id": 0})
    driver_dest = None
    if active and active.get("dropoff"):
        driver_dest = {"lat": active["dropoff"]["lat"], "lng": active["dropoff"]["lng"]}

    # Empty-run detection: manual override OR auto-infer from a recent delivery
    # whose drop-off is near this job's pickup while the driver is now idle.
    returning_empty = bool(empty)
    auto_empty = False
    if not returning_empty and not active and origin:
        recent = await db.orders.find_one(
            {"driver_id": driver_id, "status": "delivered"},
            {"_id": 0, "dropoff": 1, "completed_at": 1}, sort=[("completed_at", -1)])
        if recent and recent.get("dropoff"):
            d = marketplace.haversine_km(
                recent["dropoff"]["lat"], recent["dropoff"]["lng"], pickup["lat"], pickup["lng"])
            if d <= 40:
                returning_empty = True
                auto_empty = True

    region = marketplace.resolve_region(pickup["lat"], pickup["lng"])
    sd = await marketplace.region_supply_demand(db, region)
    rm = marketplace.route_match_discount(origin, driver_dest, pickup, dropoff)
    empty_pct = marketplace.empty_run_discount(returning_empty)

    cfg = pricing.get_config()
    regional_pct = float(cfg.get("regional_adjustments", {}).get(region, 0.0)) if region else 0.0
    common = dict(
        vehicle_type=order.get("vehicle_type", "cargo_van"),
        distance_km=order.get("road_distance_km") or order.get("distance_km") or 0,
        weight_kg=order.get("cargo_weight_kg") or 0,
        urgency=order.get("urgency", "standard"),
        special_handling=order.get("special_handling", False),
        supply_demand_pct=sd["adjustment_pct"],
        regional_pct=regional_pct,
        reputation_pct=marketplace.reputation_adjustment(driver),
    )
    # Baseline = normal market price (NO empty-run / route-match discounts).
    baseline = pricing.calculate_price(**common)
    # Marketplace price = baseline with the empty-run + route-match discounts.
    breakdown = pricing.calculate_price(
        **common,
        empty_run_discount_pct=empty_pct,
        route_match_discount_pct=rm["discount_pct"],
    )
    tip = float(order.get("tip") or 0.0)
    earnings = pricing.driver_earnings(breakdown["total_price"], tip)
    standard_price = baseline["total_price"]
    return {
        "order_id": order_id,
        "standard_price": standard_price,
        "marketplace_price": breakdown["total_price"],
        "driver_earnings": earnings,
        "discounts": {
            "empty_run_pct": empty_pct,
            "route_match_pct": rm["discount_pct"],
            "route_overlap_pct": rm["overlap_pct"],
            "detour_km": rm["detour_km"],
            "supply_demand_pct": sd["adjustment_pct"],
        },
        "returning_empty": returning_empty,
        "empty_run_auto_detected": auto_empty,
        "marketplace": {"region": sd["region"], "region_name": sd["region_name"], "heat": sd["heat"]},
        "environment": marketplace.env_savings(
            order.get("road_distance_km") or order.get("distance_km") or 0, cfg),
        "breakdown_lines": breakdown["breakdown_lines"],
    }


@router.get("/orders/{order_id}/bundle-suggestions")
async def order_bundle_suggestions(order_id: str, request: Request):
    """Phase F: smart load bundling. For a candidate job, find other pending,
    vehicle-compatible shipments that fit along the same corridor (small detour),
    so a driver can combine them into one profitable route.
    """
    await get_current_driver_id(request)
    main = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not main:
        raise HTTPException(404, "Order not found")
    m_pickup = {"lat": main["pickup"]["lat"], "lng": main["pickup"]["lng"]}
    m_dropoff = {"lat": main["dropoff"]["lat"], "lng": main["dropoff"]["lng"]}
    vt = main.get("vehicle_type", "cargo_van")
    capacity = float((VEHICLE_TYPES.get(vt) or {}).get("capacity_kg") or 0)
    main_weight = float(main.get("cargo_weight_kg") or 0)

    candidates = await db.orders.find(
        {"status": "pending", "vehicle_type": vt, "id": {"$ne": order_id}}, {"_id": 0},
    ).limit(50).to_list(50)

    suggestions = []
    combined_weight = main_weight
    for c in candidates:
        try:
            c_pickup = {"lat": c["pickup"]["lat"], "lng": c["pickup"]["lng"]}
            c_dropoff = {"lat": c["dropoff"]["lat"], "lng": c["dropoff"]["lng"]}
        except Exception:
            continue
        detour = marketplace.corridor_bundle_match(m_pickup, m_dropoff, c_pickup, c_dropoff)
        if detour is None:
            continue
        c_weight = float(c.get("cargo_weight_kg") or 0)
        if capacity and (combined_weight + c_weight) > capacity:
            continue  # would exceed payload
        c_price = float(c.get("price_quote") or 0)
        suggestions.append({
            "order_id": c["id"],
            "pickup_name": (c.get("pickup") or {}).get("name"),
            "dropoff_name": (c.get("dropoff") or {}).get("name"),
            "cargo_weight_kg": c_weight,
            "extra_distance_km": detour,
            "price": round(c_price, 2),
            "driver_earnings": pricing.driver_earnings(c_price, float(c.get("tip") or 0)),
        })
    suggestions.sort(key=lambda s: s["extra_distance_km"])
    suggestions = suggestions[:5]
    extra_earnings = round(sum(s["driver_earnings"] for s in suggestions), 2)
    return {
        "order_id": order_id,
        "vehicle_type": vt,
        "payload_capacity_kg": capacity,
        "bundle_count": len(suggestions),
        "extra_earnings_if_all": extra_earnings,
        "suggestions": suggestions,
    }



@router.post("/orders/{order_id}/accept", response_model=Order)
async def accept_order(order_id: str, request: Request):
    """Atomically claim a pending order for the authenticated driver.

    Uses a conditional update on `status == pending` so two drivers can never
    accept the same job (race-safe). Idempotent: a driver re-accepting their
    own order gets a 200; a driver accepting a job already claimed by someone
    else gets a 409 Conflict.
    """
    driver_id = await get_optional_driver_id(request)

    # KYC gate: a driver must be Verified (admin-approved) before accepting jobs.
    fleet_fields: dict = {}
    if driver_id:
        kyc = await db.kyc_status.find_one({"driver_id": driver_id}, {"_id": 0})
        if not kyc or kyc.get("overall_status") != "approved":
            raise HTTPException(
                403,
                "KYC verification required. Please complete identity verification and wait for admin approval before accepting jobs.",
            )
        # Fleet: enforce job-acceptance mode and record company audit fields.
        drv = await db.drivers.find_one(
            {"id": driver_id}, {"_id": 0, "company_id": 1, "is_suspended": 1}
        )
        if drv and drv.get("is_suspended"):
            raise HTTPException(403, "Your account is suspended. Contact your company owner.")
        company_id = drv.get("company_id") if drv else None
        if company_id:
            company = await db.companies.find_one({"id": company_id}, {"_id": 0})
            if company and company.get("status") == "suspended":
                raise HTTPException(403, "Your company is suspended. Contact support.")
            mode = (company or {}).get("job_acceptance_mode", "self_accept")
            if mode == "owner_assign":
                raise HTTPException(
                    403, "Self-accept is disabled. Your company owner assigns jobs."
                )
            veh = await db.fleet_vehicles.find_one(
                {"company_id": company_id, "assigned_driver_id": driver_id, "status": "active"},
                {"_id": 0, "id": 1},
            )
            fleet_fields = {
                "assigned_company_id": company_id,
                "assigned_driver_id": driver_id,
                "assigned_vehicle_id": veh["id"] if veh else None,
            }

    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")

    current = order["status"]

    # Idempotent replay / conflict detection for already-claimed orders.
    if current in sm.ACTIVE_STATES:
        existing_driver = order.get("driver_id")
        if driver_id and existing_driver and existing_driver == driver_id:
            return Order(**order)  # this driver already owns it
        if existing_driver and driver_id and existing_driver != driver_id:
            raise HTTPException(409, "Order already accepted by another driver")
        # legacy active order with no bound driver -> allow claim below isn't
        # possible (status no longer pending); just return as-is to be safe.
        return Order(**order)

    if not sm.can_transition(current, sm.ACCEPTED):
        raise HTTPException(400, f"Order not in pending state (current: {current})")

    set_fields: dict = {"status": sm.ACCEPTED}
    if driver_id:
        set_fields["driver_id"] = driver_id
    set_fields.update(fleet_fields)

    # Atomic claim: only succeeds if the order is still pending.
    result = await db.orders.update_one(
        {"id": order_id, "status": "pending"}, {"$set": set_fields}
    )
    if result.modified_count == 0:
        fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
        if fresh and fresh.get("driver_id") == driver_id:
            return Order(**fresh)
        raise HTTPException(409, "Order already accepted by another driver")

    order.update(set_fields)
    await audit.record_event(
        db, order_id, "status_change",
        from_status=current, to_status=sm.ACCEPTED,
        actor_id=driver_id, actor_type="driver",
    )
    # Background push to the shipper: a driver has been assigned.
    asyncio.create_task(push_status_to_shipper(order, "accepted"))
    # Phase D: record the accepted pricing signal (time-to-accept).
    await marketplace.mark_signal_accepted(db, order_id)
    return Order(**order)


@router.post("/orders/{order_id}/reject", response_model=Order)
async def reject_order(order_id: str, request: Request):
    driver_id = await get_optional_driver_id(request)
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    current = order["status"]
    await db.orders.update_one({"id": order_id}, {"$set": {"status": "rejected"}})
    await audit.record_event(
        db, order_id, "rejected",
        from_status=current, to_status="rejected",
        actor_id=driver_id, actor_type="driver",
    )
    # generate a fresh pending order so the demo continues
    await db.orders.insert_one(build_order("pending"))
    order["status"] = "rejected"
    return Order(**order)


@router.post("/orders/{order_id}/advance", response_model=Order)
async def advance_order(order_id: str, body: AdvanceRequest, request: Request):
    """Advance an order through its lifecycle, validated by the state machine.

    - Rejects illegal transitions (e.g. pending -> delivered) with 400.
    - Idempotent: requesting the current status returns the order unchanged.
    - Credits the AUTHENTICATED driver on delivery (fixes the legacy bug that
      always credited a hardcoded driver id).
    """
    driver_id = await get_optional_driver_id(request)
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")

    current = order["status"]

    # Idempotent: already at requested state -> no-op.
    if body.next_status and body.next_status == current:
        return Order(**order)

    try:
        next_status = sm.resolve_target(current, body.next_status)
    except sm.InvalidTransition as exc:
        raise HTTPException(400, str(exc))

    update: dict = {"status": next_status}
    if next_status == sm.DELIVERED:
        update["completed_at"] = datetime.now(timezone.utc).isoformat()
        # Credit the authenticated driver, falling back to the order's bound
        # driver, then the legacy demo driver as a last resort.
        credit_driver_id = driver_id or order.get("driver_id") or DRIVER_ID
        await db.drivers.update_one(
            {"id": credit_driver_id},
            {"$inc": {"earnings_today": order["earnings"] + order.get("tip", 0), "deliveries_today": 1}},
        )
        # Phase 3: for company jobs, the net earnings belong to the COMPANY wallet.
        try:
            await _credit_company_wallet_on_delivery(order)
        except Exception as exc:  # never block delivery on a wallet error
            logger.warning(f"Company wallet credit failed for {order_id}: {exc}")
        # Note: we intentionally do NOT auto-seed a replacement pending order
        # here. The available-jobs pool should shrink as jobs are completed so
        # the "jobs nearby" counter reflects reality. Use POST
        # /api/orders/seed-new-pending to top up demo data when needed.

    await db.orders.update_one({"id": order_id}, {"$set": update})
    order.update(update)
    await audit.record_event(
        db, order_id, "status_change",
        from_status=current, to_status=next_status,
        actor_id=driver_id, actor_type="driver",
    )
    # On delivery completion, capture the previously authorized payment (auth -> capture).
    if next_status == sm.DELIVERED:
        try:
            captured = await _auto_capture_on_delivery(order_id)
            if captured:
                order.update(captured)
        except Exception as exc:  # never block delivery on a payment error
            logger.warning(f"Auto-capture on delivery failed for {order_id}: {exc}")
    # Background push to the shipper on key lifecycle transitions.
    if next_status in ("arrived_pickup", "arrived_dropoff", "delivered"):
        asyncio.create_task(push_status_to_shipper(order, next_status))
    return Order(**order)


@router.get("/orders/{order_id}/events")
async def get_order_events(order_id: str):
    """Return the immutable audit timeline for an order (status changes etc.)."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0, "order_number": 1, "status": 1})
    if not order:
        raise HTTPException(404, "Order not found")
    events = await audit.get_events(db, order_id)
    return {"order_id": order_id, "current_status": order.get("status"), "events": events}


@router.post("/orders/{order_id}/rate", response_model=Order)
async def rate_order(order_id: str, body: RateRequest):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"rating_given": body.rating, "feedback": body.feedback}},
    )
    order["rating_given"] = body.rating
    order["feedback"] = body.feedback
    return Order(**order)


@router.post("/orders/{order_id}/rate-shipper")
async def rate_shipper(
    order_id: str,
    body: StarRatingRequest,
    request: Request,
):
    """Driver rates the shipper (1-5 stars, one-time) after a delivered job.
    Recomputes and persists the shipper's average rating on their profile."""
    driver_id = await get_current_driver_id(request)

    if not (1 <= int(body.rating) <= 5):
        raise HTTPException(400, "Rating must be between 1 and 5 stars")

    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    # Only the assigned driver may rate (legacy/demo orders with no driver bound are allowed).
    if order.get("driver_id") and order.get("driver_id") != driver_id:
        raise HTTPException(403, "You can only rate shipments you delivered")
    if order.get("status") != "delivered":
        raise HTTPException(400, "You can only rate the shipper once the job is delivered")
    if not order.get("shipper_id"):
        raise HTTPException(400, "This order has no shipper to rate")
    if order.get("shipper_rating") is not None:
        raise HTTPException(400, "You have already rated this shipper")

    now = datetime.now(timezone.utc).isoformat()
    review = (body.review or "").strip() or None
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"shipper_rating": int(body.rating), "shipper_review": review, "shipper_rated_at": now}},
    )
    new_avg = await _recompute_shipper_rating(order["shipper_id"])
    return {
        "success": True,
        "shipper_rating": int(body.rating),
        "shipper_review": review,
        "shipper_average_rating": new_avg,
    }


@router.post("/orders/{order_id}/verify-otp", response_model=Order)
async def verify_otp(order_id: str, body: OtpRequest):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    expected = order.get("pickup_otp") if body.kind == "pickup" else order.get("dropoff_otp")
    if str(body.otp).strip() != str(expected):
        raise HTTPException(400, "Invalid OTP")
    field = "pickup_otp_verified" if body.kind == "pickup" else "dropoff_otp_verified"
    await db.orders.update_one({"id": order_id}, {"$set": {field: True}})
    order[field] = True
    return Order(**order)


@router.post("/orders/{order_id}/photo", response_model=Order)
async def attach_photo(order_id: str, body: PhotoRequest):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    photo = (body.photo or "").strip()
    if not photo:
        raise HTTPException(400, "Photo payload is empty")
    # accept either raw base64 or full data URI; normalise to data URI
    if not photo.startswith("data:"):
        photo = f"data:image/jpeg;base64,{photo}"
    # Soft size guard (~6MB encoded ≈ 4.5MB raw)
    if len(photo) > 7_500_000:
        raise HTTPException(413, "Photo too large; please resize")
    await db.orders.update_one({"id": order_id}, {"$set": {"delivery_photo": photo}})
    order["delivery_photo"] = photo
    return Order(**order)


@router.post("/orders/{order_id}/pickup-photo", response_model=Order)
async def attach_pickup_photo(order_id: str, body: PhotoRequest):
    """Attach a photo proof taken at pickup (order items received from merchant)."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    photo = (body.photo or "").strip()
    if not photo:
        raise HTTPException(400, "Photo payload is empty")
    # accept either raw base64 or full data URI; normalise to data URI
    if not photo.startswith("data:"):
        photo = f"data:image/jpeg;base64,{photo}"
    # Soft size guard (~6MB encoded ≈ 4.5MB raw)
    if len(photo) > 7_500_000:
        raise HTTPException(413, "Photo too large; please resize")
    await db.orders.update_one({"id": order_id}, {"$set": {"pickup_photo": photo}})
    order["pickup_photo"] = photo
    return Order(**order)


@router.post("/orders/seed-new-pending", response_model=Order)
async def seed_new_pending():
    # remove existing pending then create one
    await db.orders.delete_many({"status": "pending"})
    new_order = build_order("pending")
    await db.orders.insert_one(new_order.copy())
    return Order(**new_order)


@router.post("/orders/add-pending", response_model=Order)
async def add_pending_order():
    """Add a single pending order without deleting existing ones."""
    new_order = build_order("pending")
    await db.orders.insert_one(new_order.copy())
    return Order(**new_order)


@router.get("/orders/{order_id}/route", response_model=DirectionsResponse)
async def get_route(order_id: str):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")

    origin = order["pickup"]
    dest = order["dropoff"]

    # Cache routes per (origin, dest) pair to save quota.
    cache_key = f"{origin['lat']:.5f},{origin['lng']:.5f}|{dest['lat']:.5f},{dest['lng']:.5f}"
    cached = await db.route_cache.find_one({"key": cache_key}, {"_id": 0})
    if cached:
        return DirectionsResponse(**cached["response"])

    if GOOGLE_DIRECTIONS_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=10) as client_http:
                resp = await client_http.get(
                    "https://maps.googleapis.com/maps/api/directions/json",
                    params={
                        "origin": f"{origin['lat']},{origin['lng']}",
                        "destination": f"{dest['lat']},{dest['lng']}",
                        "mode": "driving",
                        "units": "metric",
                        "key": GOOGLE_DIRECTIONS_API_KEY,
                    },
                )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "OK" and data.get("routes"):
                    route = data["routes"][0]
                    encoded = route.get("overview_polyline", {}).get("points")
                    if encoded:
                        decoded = decode_polyline(encoded)
                        legs = route.get("legs", [])
                        total_distance = sum(leg.get("distance", {}).get("value", 0) for leg in legs)
                        total_duration = sum(leg.get("duration", {}).get("value", 0) for leg in legs)
                        response = DirectionsResponse(
                            points=[RoutePoint(lat=lat, lng=lng) for lat, lng in decoded],
                            distance_meters=total_distance,
                            duration_seconds=total_duration,
                            source="google",
                        )
                        await db.route_cache.insert_one({"key": cache_key, "response": response.model_dump()})
                        return response
                else:
                    logger.warning("Directions API status: %s", data.get("status"))
            else:
                logger.warning("Directions API HTTP %s", resp.status_code)
        except Exception as e:
            logger.warning("Directions API call failed: %s", e)

    # Fallback: straight-line polyline (2 points)
    distance_km = _haversine_km(origin["lat"], origin["lng"], dest["lat"], dest["lng"])
    response = DirectionsResponse(
        points=[RoutePoint(lat=origin["lat"], lng=origin["lng"]),
                RoutePoint(lat=dest["lat"], lng=dest["lng"])],
        distance_meters=int(distance_km * 1000),
        duration_seconds=int(distance_km * 240),  # ~15 km/h for bicycle
        source="fallback",
    )
    return response


@router.get("/orders/{order_id}/driver-location")
async def get_driver_location(order_id: str, user: dict = Depends(get_current_user)):
    """Get the current driver location for an order."""
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    
    if not order.get("driver_id"):
        return {"driver_location": None, "message": "No driver assigned yet"}
    
    driver = await db.drivers.find_one({"id": order["driver_id"]})
    if not driver:
        return {"driver_location": None, "message": "Driver not found"}

    loc = driver.get("current_location")
    tracking = compute_live_tracking(order, loc) if loc else {
        "eta_minutes": None, "remaining_km": None, "target": None, "off_route": False
    }
    # Upgrade ETA to a real road estimate via Google Directions when possible;
    # fall back to the straight-line estimate on any routing error/quota.
    if loc and tracking.get("target"):
        tgt = order.get("dropoff") if tracking["target"] == "dropoff" else order.get("pickup")
        try:
            route = await fetch_road_route(loc["lat"], loc["lng"], tgt["lat"], tgt["lng"])
            tracking["eta_minutes"] = int(round(route["duration_minutes"]))
            tracking["remaining_km"] = route["road_distance_km"]
        except Exception:
            pass

    return {
        "driver_id": driver["id"],
        "driver_name": driver.get("name"),
        "driver_location": loc,
        "location_updated_at": driver.get("location_updated_at"),
        "status": order.get("status"),
        "eta_minutes": tracking["eta_minutes"],
        "remaining_km": tracking["remaining_km"],
        "target": tracking["target"],
        "off_route": tracking["off_route"],
    }


@router.get("/orders/{order_id}/chat")
async def get_chat_history(order_id: str, user: dict = Depends(get_current_user)):
    """Get chat history for an order."""
    messages = await db.chat_messages.find({"order_id": order_id}).sort("timestamp", 1).to_list(100)
    return [{
        "id": str(m.get("_id", m.get("id", ""))),
        "order_id": m["order_id"],
        "sender_id": m["sender_id"],
        "sender_type": m["sender_type"],
        "sender_name": m["sender_name"],
        "message": m["message"],
        "timestamp": m["timestamp"],
        "read": m.get("read", False),
    } for m in messages]


@router.post("/orders/{order_id}/chat")
async def send_chat_message(order_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Send a chat message (HTTP fallback when WebSocket not available)."""
    data = await request.json()
    message = data.get("message", "")
    
    if not message.strip():
        raise HTTPException(400, "Message cannot be empty")
    
    # Determine sender info
    sender_id = user["id"]
    sender_type = user.get("type", "driver")
    
    if sender_type == "driver":
        driver = await db.drivers.find_one({"id": sender_id})
        sender_name = driver.get("name", "Driver") if driver else "Driver"
    elif sender_type == "shipper":
        shipper = await db.shippers.find_one({"id": sender_id})
        sender_name = shipper.get("company_name", "Business") if shipper else "Business"
    else:
        sender_name = "User"
    
    msg_doc = await chat_manager.send_message(order_id, sender_id, sender_type, sender_name, message)
    return msg_doc
