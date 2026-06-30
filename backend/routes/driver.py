"""Auto-extracted driver routes. Handler bodies are unchanged; shared names
(db, models, helpers, FastAPI symbols) are injected from the server module."""
from fastapi import APIRouter
import server as _srv

_g = globals()
for _k in dir(_srv):
    if not _k.startswith('__'):
        _g.setdefault(_k, getattr(_srv, _k))

router = APIRouter()


@router.get("/driver/me", response_model=Driver)
async def get_driver(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get current driver profile. Requires authentication."""
    if not credentials:
        raise HTTPException(401, "Authentication required. Please login first.")
    
    payload = decode_token(credentials.credentials)
    driver_id = payload.get("sub")
    user_type = payload.get("type")
    
    if user_type != "driver":
        raise HTTPException(403, "Driver access required")
    
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver:
        raise HTTPException(404, "Driver not found. Please register or login again.")
    driver = await _ensure_driver_vehicles(driver)  # migrate legacy single-vehicle records
    return Driver(**driver)


@router.post("/driver/toggle-online", response_model=Driver)
async def toggle_online(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Toggle driver online/offline status. Requires authentication."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    driver_id = payload.get("sub")
    user_type = payload.get("type")
    
    if user_type != "driver":
        raise HTTPException(403, "Driver access required")
    
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver:
        raise HTTPException(404, "Driver not found")
    
    new_state = not driver["is_online"]
    if new_state and driver.get("is_suspended"):
        raise HTTPException(403, "Your account is suspended. Please contact support.")
    await db.drivers.update_one({"id": driver_id}, {"$set": {"is_online": new_state}})
    driver["is_online"] = new_state
    
    # Broadcast status change to connected clients
    await broadcast_driver_status(driver_id, new_state)
    
    return Driver(**driver)


@router.get("/driver/wallet")
async def get_driver_wallet(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get driver's wallet with transaction history."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    driver_id = payload.get("sub")
    user_type = payload.get("type")
    
    if user_type != "driver":
        raise HTTPException(403, "Driver access required")
    
    # Get all delivered orders for this driver (exclude fully-refunded ones —
    # a refunded delivery must not count toward earnings).
    history = await db.orders.find(
        {"status": "delivered", "driver_id": driver_id, "payment_status": {"$ne": "refunded"}},
        {"_id": 0}
    ).sort("completed_at", -1).limit(100).to_list(100)
    
    txns: List[dict] = []
    available = 0.0
    pending = 0.0
    now = datetime.now(timezone.utc)
    
    for o in history:
        ts = o.get("completed_at") or o.get("created_at")
        try:
            done_at = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            done_at = now
        age_hours = (now - done_at).total_seconds() / 3600
        is_pending = age_hours < 48  # earnings clear after 48h
        base_amount = float(o.get("earnings", 0))
        tip_amount = float(o.get("tip", 0) or 0)
        if is_pending:
            pending += base_amount + tip_amount
        else:
            available += base_amount + tip_amount
        txns.append(WalletTransaction(
            type="delivery",
            amount=base_amount,
            description=f"Delivery {o.get('order_number')} • {o['pickup'].get('name', '')}",
            timestamp=ts,
        ).model_dump())
        if tip_amount > 0:
            txns.append(WalletTransaction(
                type="tip",
                amount=tip_amount,
                description=f"Tip from {o['customer'].get('name', 'customer')}",
                timestamp=ts,
            ).model_dump())

    # Check for actual payouts in transactions collection
    actual_payouts = await db.transactions.find(
        {"user_id": driver_id, "type": "payout"}
    ).sort("created_at", -1).limit(10).to_list(10)
    
    for payout in actual_payouts:
        txns.append(WalletTransaction(
            type="payout",
            amount=-abs(payout.get("amount", 0)),
            description=payout.get("description", "Payout"),
            timestamp=payout.get("created_at"),
        ).model_dump())

    txns.sort(key=lambda t: t["timestamp"], reverse=True)
    next_payout = (now + timedelta(days=(7 - now.weekday()) % 7 or 7)).date().isoformat()

    return {
        "available_balance": round(available, 2),
        "pending_balance": round(pending, 2),
        "payout_schedule": "Weekly • Mondays",
        "next_payout_date": next_payout,
        "transactions": [WalletTransaction(**t) for t in txns],
    }


@router.get("/driver/performance")
async def get_driver_performance(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Driver performance dashboard: earnings (today/week/total), acceptance &
    completion rates (derived from the order audit log), rating, status, and a
    recent-deliveries timeline."""
    if not credentials:
        raise HTTPException(401, "Authentication required")

    payload = decode_token(credentials.credentials)
    driver_id = payload.get("sub")
    if payload.get("type") != "driver":
        raise HTTPException(403, "Driver access required")

    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver:
        raise HTTPException(404, "Driver not found")

    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    today = now.date()

    # Delivered orders for THIS driver only (strict per-driver scoping); a
    # fully-refunded delivery is excluded from earnings/performance.
    delivered = await db.orders.find(
        {"status": "delivered", "driver_id": driver_id, "payment_status": {"$ne": "refunded"}}, {"_id": 0}
    ).sort("completed_at", -1).to_list(500)

    def parse_ts(ts):
        if not ts:
            return now
        try:
            return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        except Exception:
            return now

    total_earnings = week_earnings = today_earnings = 0.0
    total_deliveries = week_deliveries = today_deliveries = 0
    recent = []
    for o in delivered:
        amount = float(o.get("earnings", 0)) + float(o.get("tip", 0) or 0)
        done = parse_ts(o.get("completed_at") or o.get("created_at"))
        total_earnings += amount
        total_deliveries += 1
        if done >= week_ago:
            week_earnings += amount
            week_deliveries += 1
        if done.date() == today:
            today_earnings += amount
            today_deliveries += 1
        if len(recent) < 12:
            recent.append({
                "order_number": o.get("order_number"),
                "pickup_name": (o.get("pickup") or {}).get("name", ""),
                "dropoff_name": (o.get("dropoff") or {}).get("name", ""),
                "earnings": round(amount, 2),
                "distance_km": o.get("distance_km", 0),
                "completed_at": o.get("completed_at") or o.get("created_at"),
            })

    # Acceptance & completion rates derived from the immutable audit log.
    accepted = await db.order_events.count_documents(
        {"actor_id": driver_id, "to_status": "accepted"}
    )
    rejected = await db.order_events.count_documents(
        {"actor_id": driver_id, "event_type": "rejected"}
    )
    cancelled = await db.order_events.count_documents(
        {"actor_id": driver_id, "to_status": "cancelled"}
    )
    delivered_events = await db.order_events.count_documents(
        {"actor_id": driver_id, "to_status": "delivered"}
    )

    if accepted + rejected > 0:
        acceptance_rate = round(accepted / (accepted + rejected) * 100, 1)
    else:
        acceptance_rate = float(driver.get("acceptance_rate", 96.0))

    if delivered_events + cancelled > 0:
        completion_rate = round(delivered_events / (delivered_events + cancelled) * 100, 1)
    else:
        completion_rate = float(driver.get("completion_rate", 98.0))

    # Derived live status for the status system (offline/online/busy/en_route).
    active = await db.orders.find_one(
        {"driver_id": driver_id, "status": {"$in": list(sm.ACTIVE_STATES)}}, {"_id": 0}
    )
    if not driver.get("is_online"):
        status = "offline"
    elif active:
        status = active["status"] if active["status"] in sm.ACTIVE_STATES else "busy"
    else:
        status = "online"

    return {
        "status": status,
        "is_online": driver.get("is_online", False),
        "rating": driver.get("rating", 5.0),
        "acceptance_rate": acceptance_rate,
        "completion_rate": completion_rate,
        "earnings": {
            "today": round(today_earnings, 2),
            "week": round(week_earnings, 2),
            "total": round(total_earnings, 2),
        },
        "deliveries": {
            "today": today_deliveries,
            "week": week_deliveries,
            "total": total_deliveries,
        },
        "recent_deliveries": recent,
    }


@router.post("/driver/wallet/payout")
async def request_payout(request: PayoutRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Request a payout from driver's wallet."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    driver_id = payload.get("sub")
    
    if request.amount <= 0:
        raise HTTPException(400, "Payout amount must be positive")

    # Save/refresh the driver's payout bank details so they don't have to
    # re-enter them on every cash-out (also editable from the profile screen).
    if request.bank_details:
        await db.drivers.update_one(
            {"id": driver_id}, {"$set": {"bank_details": request.bank_details.model_dump()}}
        )
    
    # Create payout transaction
    transaction = Transaction(
        user_id=driver_id,
        user_type="driver",
        type="payout",
        amount=-abs(request.amount),
        description=f"Payout via {request.method}",
        status="pending",
    )
    await db.transactions.insert_one(transaction.model_dump())
    
    # Create notification
    notification = Notification(
        recipient_id=driver_id,
        recipient_type="driver",
        type="payment",
        title="Payout Requested",
        message=f"Your payout of €{request.amount:.2f} is being processed.",
        data={"transaction_id": transaction.id},
    )
    await db.notifications.insert_one(notification.model_dump())
    
    return {"message": "Payout requested successfully", "transaction_id": transaction.id}


@router.patch("/driver/me", response_model=Driver)
async def update_driver(update: DriverUpdate, request: Request):
    """Update the authenticated driver's profile."""
    # Get the authenticated driver ID
    driver_id = await get_current_driver_id(request)
    
    payload = {k: v for k, v in update.model_dump(exclude_unset=True).items() if v is not None}
    if payload.get("notifications") is not None:
        payload["notifications"] = update.notifications.model_dump()

    # Merge bank_details per-field (dot notation) so a partial update (e.g. the
    # wallet sending only the IBAN) never wipes other saved fields.
    if "bank_details" in payload and isinstance(payload["bank_details"], dict):
        bank = payload.pop("bank_details")
        for bk, bv in bank.items():
            payload[f"bank_details.{bk}"] = bv
    
    # Update vehicle string if vehicle_type or plate is updated
    if "vehicle_type" in payload or "plate" in payload:
        # Get current driver data
        current_driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
        if current_driver:
            vehicle_type = payload.get("vehicle_type", current_driver.get("vehicle_type", "cargo_van"))
            plate = payload.get("plate", current_driver.get("plate", ""))
            vehicle_info = VEHICLE_TYPES.get(vehicle_type, VEHICLE_TYPES.get("cargo_van"))
            vehicle_label = vehicle_info["name"] if vehicle_info else "Cargo Van"
            payload["vehicle"] = f"{vehicle_label} • {plate}" if plate else vehicle_label
    
    if payload:
        result = await db.drivers.update_one({"id": driver_id}, {"$set": payload})
        logger.info(f"Driver profile updated: {driver_id}, fields: {list(payload.keys())}, matched: {result.matched_count}, modified: {result.modified_count}")
    
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver:
        raise HTTPException(404, "Driver not found")
    return Driver(**driver)


@router.post("/driver/vehicles", response_model=Driver)
async def add_driver_vehicle(body: VehicleInput, request: Request):
    """Add a vehicle to the authenticated driver's garage."""
    driver_id = await get_current_driver_id(request)
    if body.vehicle_type not in VEHICLE_TYPES:
        raise HTTPException(400, f"Invalid vehicle type: {body.vehicle_type}")
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver:
        raise HTTPException(404, "Driver not found")
    driver = await _ensure_driver_vehicles(driver)
    vehicles = driver.get("vehicles", [])
    new_vehicle = {
        "id": str(uuid.uuid4()),
        "vehicle_type": body.vehicle_type,
        "label": _vehicle_label(body.vehicle_type),
        "plate": body.plate or "",
        "capacity_kg": body.capacity_kg or _default_capacity(body.vehicle_type),
        "is_primary": body.make_primary or len(vehicles) == 0,
    }
    if new_vehicle["is_primary"]:
        for v in vehicles:
            v["is_primary"] = False
    vehicles.append(new_vehicle)
    driver = await _sync_primary_vehicle(driver_id, vehicles)
    return Driver(**driver)


@router.patch("/driver/vehicles/{vehicle_id}", response_model=Driver)
async def update_driver_vehicle(vehicle_id: str, body: VehicleInput, request: Request):
    """Update an existing vehicle (type/plate/capacity)."""
    driver_id = await get_current_driver_id(request)
    if body.vehicle_type not in VEHICLE_TYPES:
        raise HTTPException(400, f"Invalid vehicle type: {body.vehicle_type}")
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver:
        raise HTTPException(404, "Driver not found")
    driver = await _ensure_driver_vehicles(driver)
    vehicles = driver.get("vehicles", [])
    found = next((v for v in vehicles if v["id"] == vehicle_id), None)
    if not found:
        raise HTTPException(404, "Vehicle not found")
    found["vehicle_type"] = body.vehicle_type
    found["label"] = _vehicle_label(body.vehicle_type)
    found["plate"] = body.plate or ""
    found["capacity_kg"] = body.capacity_kg or _default_capacity(body.vehicle_type)
    if body.make_primary:
        for v in vehicles:
            v["is_primary"] = v["id"] == vehicle_id
    driver = await _sync_primary_vehicle(driver_id, vehicles)
    return Driver(**driver)


@router.post("/driver/vehicles/{vehicle_id}/primary", response_model=Driver)
async def set_primary_vehicle(vehicle_id: str, request: Request):
    """Mark a vehicle as the active/primary one used for job matching."""
    driver_id = await get_current_driver_id(request)
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver:
        raise HTTPException(404, "Driver not found")
    driver = await _ensure_driver_vehicles(driver)
    vehicles = driver.get("vehicles", [])
    if not any(v["id"] == vehicle_id for v in vehicles):
        raise HTTPException(404, "Vehicle not found")
    for v in vehicles:
        v["is_primary"] = v["id"] == vehicle_id
    driver = await _sync_primary_vehicle(driver_id, vehicles)
    return Driver(**driver)


@router.delete("/driver/vehicles/{vehicle_id}", response_model=Driver)
async def delete_driver_vehicle(vehicle_id: str, request: Request):
    """Remove a vehicle. The last remaining vehicle cannot be deleted."""
    driver_id = await get_current_driver_id(request)
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver:
        raise HTTPException(404, "Driver not found")
    driver = await _ensure_driver_vehicles(driver)
    vehicles = driver.get("vehicles", [])
    if len(vehicles) <= 1:
        raise HTTPException(400, "You must keep at least one vehicle")
    target = next((v for v in vehicles if v["id"] == vehicle_id), None)
    if not target:
        raise HTTPException(404, "Vehicle not found")
    vehicles = [v for v in vehicles if v["id"] != vehicle_id]
    # If we removed the primary, promote the first remaining one.
    if target.get("is_primary") and vehicles:
        vehicles[0]["is_primary"] = True
    driver = await _sync_primary_vehicle(driver_id, vehicles)
    return Driver(**driver)


@router.post("/driver/register", response_model=RegistrationResponse)
async def register_driver(registration: DriverRegistration):
    """Register a new driver account."""
    # Check if email already exists
    existing = await db.drivers.find_one({"email": registration.email})
    if existing:
        raise HTTPException(400, "A driver with this email already exists")
    
    # Validate vehicle type
    if registration.vehicle_type not in VEHICLE_TYPES:
        raise HTTPException(400, f"Invalid vehicle type: {registration.vehicle_type}. Valid types: {list(VEHICLE_TYPES.keys())}")

    # Fleet accounts must provide a company name
    if registration.account_type == "fleet" and not (registration.company_name and registration.company_name.strip()):
        raise HTTPException(400, "Company name is required for fleet accounts")
    
    # Create new driver
    driver_id = str(uuid.uuid4())
    
    # Get vehicle info from VEHICLE_TYPES
    vehicle_info = VEHICLE_TYPES.get(registration.vehicle_type, VEHICLE_TYPES.get("cargo_van"))
    vehicle_label = vehicle_info["name"] if vehicle_info else "Cargo Van"
    
    # Use custom capacity if provided (for "other" type), otherwise use vehicle default
    if registration.vehicle_type == "other" and registration.vehicle_capacity_kg:
        vehicle_capacity = registration.vehicle_capacity_kg
    else:
        vehicle_capacity = vehicle_info["max_weight_kg"] if vehicle_info else 1500
    
    # Hash the password
    password_hash = hash_password(registration.password)
    
    new_driver = Driver(
        id=driver_id,
        name=f"{registration.first_name} {registration.last_name}",
        rating=5.0,  # New drivers start with 5.0
        avatar="https://api.dicebear.com/7.x/avataaars/png?seed=" + driver_id,
        vehicle=f"{vehicle_label} • {registration.license_plate or '—'}",
        vehicle_type=registration.vehicle_type,
        vehicle_capacity_kg=vehicle_capacity,
        plate=registration.license_plate or "",
        email=registration.email,
        phone=registration.phone,
        password_hash=password_hash,
        is_online=False,
        earnings_today=0.0,
        deliveries_today=0,
        acceptance_rate=100.0,
    )
    
    await db.drivers.insert_one(new_driver.model_dump())
    
    # Initialize KYC status
    kyc_status = {
        "driver_id": driver_id,
        "license_front": None,
        "license_back": None,
        "selfie": None,
        "overall_status": "incomplete",
        "submitted_at": None,
        "reviewed_at": None,
    }
    await db.kyc_status.insert_one(kyc_status)
    
    # Persist license class (extra field on the driver doc)
    if registration.license_class:
        await db.drivers.update_one(
            {"id": driver_id}, {"$set": {"license_class": registration.license_class}}
        )

    # Fleet account: create the owning company + wallet and link this driver as owner.
    if registration.account_type == "fleet":
        company = Company(
            company_name=registration.company_name.strip(),
            owner_driver_id=driver_id,
            business_id=(registration.business_id or None),
            phone=registration.company_phone or registration.phone,
            email=registration.company_email or registration.email,
            address=registration.company_address,
        )
        await db.companies.insert_one(company.model_dump())
        await db.company_wallets.update_one(
            {"company_id": company.id},
            {"$setOnInsert": CompanyWallet(company_id=company.id).model_dump()},
            upsert=True,
        )
        await db.drivers.update_one(
            {"id": driver_id},
            {"$set": {"company_id": company.id, "company_role": "owner"}},
        )
        logger.info(f"Fleet company created on registration: {company.company_name} ({company.id})")

    # Generate JWT token
    token = create_token(driver_id, "driver")
    
    logger.info(f"Registered new driver: {registration.email} ({driver_id})")

    subj, html = email_tpl.welcome(new_driver.name, "driver")
    send_email_bg(new_driver.email, subj, html, to_name=new_driver.name,
                  category="driver_welcome", related_id=driver_id)

    return RegistrationResponse(
        driver_id=driver_id,
        message="Registration successful! Please complete KYC verification to start delivering.",
        token=token,
        kyc_required=True
    )


@router.get("/driver/kyc-status", response_model=KYCStatus)
async def get_kyc_status(driver: dict = Depends(get_current_driver)):
    """Get the authenticated driver's KYC verification status."""
    driver_id = driver["id"]
    status = await db.kyc_status.find_one({"driver_id": driver_id}, {"_id": 0})
    if not status:
        # Initialize if not exists
        status = {
            "driver_id": driver_id,
            "license_front": None,
            "license_back": None,
            "selfie": None,
            "overall_status": "incomplete",
            "submitted_at": None,
            "reviewed_at": None,
        }
        await db.kyc_status.insert_one(status.copy())
    return KYCStatus(**status)


@router.post("/driver/kyc/upload", response_model=KYCStatus)
async def upload_kyc_document(request: KYCUploadRequest, driver: dict = Depends(get_current_driver)):
    """Upload a single KYC document for the authenticated driver."""
    driver_id = driver["id"]
    image_data = (request.image_data or "").strip()
    if not image_data:
        raise HTTPException(400, "Image data is required")
    
    # Normalize to data URI
    if not image_data.startswith("data:"):
        image_data = f"data:image/jpeg;base64,{image_data}"
    
    # Size guard (~6MB)
    if len(image_data) > 7_500_000:
        raise HTTPException(413, "Image too large; please resize")
    
    # Store the document
    doc = KYCDocument(
        driver_id=driver_id,
        document_type=request.document_type,
        image_data=image_data,
        status="pending"
    )
    
    # Upsert - replace if exists
    await db.kyc_documents.update_one(
        {"driver_id": driver_id, "document_type": request.document_type},
        {"$set": doc.model_dump()},
        upsert=True
    )
    
    # Update KYC status
    await db.kyc_status.update_one(
        {"driver_id": driver_id},
        {"$set": {request.document_type: "pending", "driver_id": driver_id}},
        upsert=True
    )
    
    # Check if all documents uploaded
    status = await db.kyc_status.find_one({"driver_id": driver_id}, {"_id": 0})
    if not status:
        status = {"driver_id": driver_id, "overall_status": "incomplete"}
    
    # Update overall status
    all_uploaded = all([
        status.get("license_front") is not None,
        status.get("license_back") is not None,
        status.get("selfie") is not None,
    ])
    
    if all_uploaded:
        await db.kyc_status.update_one(
            {"driver_id": driver_id},
            {"$set": {"overall_status": "pending", "submitted_at": datetime.now(timezone.utc).isoformat()}}
        )
    
    updated_status = await db.kyc_status.find_one({"driver_id": driver_id}, {"_id": 0})
    return KYCStatus(**updated_status)


@router.post("/driver/kyc/submit", response_model=KYCStatus)
async def submit_kyc_documents(request: KYCSubmitRequest, driver: dict = Depends(get_current_driver)):
    """Submit all KYC documents at once for the authenticated driver.

    Sets the application to PENDING and routes it to the admin for review.
    There is NO auto-approval — an admin must approve via the dashboard.
    """
    driver_id = driver["id"]
    documents = [
        ("license_front", request.license_front),
        ("license_back", request.license_back),
        ("selfie", request.selfie),
    ]
    
    for doc_type, image_data in documents:
        if not image_data or not image_data.strip():
            raise HTTPException(400, f"Missing {doc_type} image")
        
        # Normalize
        image = image_data.strip()
        if not image.startswith("data:"):
            image = f"data:image/jpeg;base64,{image}"
        
        if len(image) > 7_500_000:
            raise HTTPException(413, f"{doc_type} image too large")
        
        doc = KYCDocument(
            driver_id=driver_id,
            document_type=doc_type,
            image_data=image,
            status="pending"
        )
        
        await db.kyc_documents.update_one(
            {"driver_id": driver_id, "document_type": doc_type},
            {"$set": doc.model_dump()},
            upsert=True
        )
    
    # Update KYC status to pending review
    now = datetime.now(timezone.utc).isoformat()
    await db.kyc_status.update_one(
        {"driver_id": driver_id},
        {"$set": {
            "driver_id": driver_id,
            "license_front": "pending",
            "license_back": "pending",
            "selfie": "pending",
            "overall_status": "pending",
            "submitted_at": now,
            "reviewed_at": None,
        }},
        upsert=True
    )
    
    logger.info(f"KYC documents submitted for driver {driver_id} — awaiting admin review")
    
    status = await db.kyc_status.find_one({"driver_id": driver_id}, {"_id": 0})
    return KYCStatus(**status)


@router.post("/driver/location")
async def update_driver_location(
    request: Request,
    user: dict = Depends(get_current_user)
):
    """Update driver location via HTTP (fallback when WebSocket not available)."""
    if user.get("type") != "driver":
        raise HTTPException(403, "Only drivers can update location")
    
    data = await request.json()
    driver_id = user["id"]
    location = data.get("location", {})
    order_id = data.get("order_id")
    
    await db.drivers.update_one(
        {"id": driver_id},
        {"$set": {
            "current_location": location,
            "location_updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    # Broadcast to WebSocket subscribers if there's an active order
    if order_id:
        await ws_manager.broadcast_driver_location(driver_id, location, order_id)
    
    return {"status": "ok"}
