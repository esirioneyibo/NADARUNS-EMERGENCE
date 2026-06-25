"""Auto-extracted company routes. Handler bodies are unchanged; shared names
(db, models, helpers, FastAPI symbols) are injected from the server module."""
from fastapi import APIRouter
import server as _srv

_g = globals()
for _k in dir(_srv):
    if not _k.startswith('__'):
        _g.setdefault(_k, getattr(_srv, _k))

router = APIRouter()


@router.post("/company")
async def create_company(body: CompanyCreate, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """An existing driver creates a company and becomes its owner."""
    driver = await _get_driver_doc(credentials)
    if driver.get("company_id"):
        raise HTTPException(400, "You already belong to a company")
    company = Company(
        company_name=body.company_name.strip(),
        owner_driver_id=driver["id"],
        business_id=body.business_id,
        phone=body.phone,
        email=body.email,
        address=body.address,
    )
    await db.companies.insert_one(company.model_dump())
    await db.drivers.update_one(
        {"id": driver["id"]},
        {"$set": {"company_id": company.id, "company_role": "owner"}},
    )
    logger.info(f"Driver {driver['id']} created company {company.id} ({company.company_name})")
    return {"company": company.model_dump(), "role": "owner"}


@router.get("/company/me")
async def get_my_company(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Return the company the current driver belongs to (or null = independent)."""
    driver = await _get_driver_doc(credentials)
    company_id = driver.get("company_id")
    if not company_id:
        return {"company": None, "role": None}
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        await db.drivers.update_one(
            {"id": driver["id"]}, {"$set": {"company_id": None, "company_role": None}}
        )
        return {"company": None, "role": None}
    driver_count = await db.drivers.count_documents({"company_id": company_id})
    vehicle_count = await db.fleet_vehicles.count_documents({"company_id": company_id})
    return {
        "company": company,
        "role": driver.get("company_role"),
        "driver_count": driver_count,
        "vehicle_count": vehicle_count,
    }


@router.patch("/company")
async def update_company(body: CompanyUpdate, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Owner updates company profile / job-acceptance mode."""
    driver, company = await _require_company_owner(credentials)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "company_name" in updates:
        updates["company_name"] = updates["company_name"].strip()
    if updates:
        await db.companies.update_one({"id": company["id"]}, {"$set": updates})
    fresh = await db.companies.find_one({"id": company["id"]}, {"_id": 0})
    return {"company": fresh}


@router.get("/company/drivers")
async def list_company_drivers(credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    drivers = [_public_driver(d) async for d in db.drivers.find({"company_id": company["id"]}, {"_id": 0})]
    drivers.sort(key=lambda d: (d.get("company_role") != "owner", (d.get("name") or "").lower()))
    return {"drivers": drivers}


@router.post("/company/drivers")
async def invite_company_driver(body: FleetDriverInvite, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Owner creates a new driver account that belongs to the company."""
    driver, company = await _require_company_owner(credentials)
    email = body.email.strip()
    if not email:
        raise HTTPException(400, "Email is required")
    existing = await db.drivers.find_one({"email": email})
    if existing:
        raise HTTPException(400, "A driver with this email already exists")
    vehicle_type = body.vehicle_type if body.vehicle_type in VEHICLE_TYPES else "cargo_van"
    vinfo = VEHICLE_TYPES[vehicle_type]
    new_id = str(uuid.uuid4())
    full_name = (body.first_name.strip() + " " + (body.last_name or "").strip()).strip()
    new_driver = Driver(
        id=new_id,
        name=full_name,
        rating=5.0,
        avatar="https://api.dicebear.com/7.x/avataaars/png?seed=" + new_id,
        vehicle=f"{vinfo['name']} • —",
        vehicle_type=vehicle_type,
        vehicle_capacity_kg=vinfo["max_weight_kg"],
        plate="",
        email=email,
        phone=body.phone or "",
        password_hash=hash_password(body.password),
        company_id=company["id"],
        company_role="driver",
    )
    await db.drivers.insert_one(new_driver.model_dump())
    await db.kyc_status.insert_one({
        "driver_id": new_id, "license_front": None, "license_back": None,
        "selfie": None, "overall_status": "incomplete", "submitted_at": None, "reviewed_at": None,
    })
    logger.info(f"Company {company['id']} added driver {email} ({new_id})")
    return {"driver": _public_driver(new_driver.model_dump())}


@router.patch("/company/drivers/{driver_id}/suspend")
async def suspend_company_driver(driver_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    owner, company = await _require_company_owner(credentials)
    target = await _get_company_driver(company["id"], driver_id)
    if target.get("company_role") == "owner":
        raise HTTPException(400, "The company owner cannot be suspended")
    await db.drivers.update_one({"id": driver_id}, {"$set": {"is_suspended": True, "is_online": False}})
    return {"success": True}


@router.patch("/company/drivers/{driver_id}/activate")
async def activate_company_driver(driver_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    owner, company = await _require_company_owner(credentials)
    await _get_company_driver(company["id"], driver_id)
    await db.drivers.update_one({"id": driver_id}, {"$set": {"is_suspended": False}})
    return {"success": True}


@router.delete("/company/drivers/{driver_id}")
async def remove_company_driver(driver_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Detach a driver from the company (account is kept → becomes independent)."""
    owner, company = await _require_company_owner(credentials)
    target = await _get_company_driver(company["id"], driver_id)
    if target.get("company_role") == "owner":
        raise HTTPException(400, "The company owner cannot be removed")
    await db.drivers.update_one({"id": driver_id}, {"$set": {"company_id": None, "company_role": None}})
    await db.fleet_vehicles.update_many(
        {"company_id": company["id"], "assigned_driver_id": driver_id},
        {"$set": {"assigned_driver_id": None}},
    )
    return {"success": True}


@router.get("/company/vehicles")
async def list_company_vehicles(credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    vehicles = [v async for v in db.fleet_vehicles.find({"company_id": company["id"]}, {"_id": 0})]
    assigned_ids = [v["assigned_driver_id"] for v in vehicles if v.get("assigned_driver_id")]
    names: dict = {}
    if assigned_ids:
        async for d in db.drivers.find({"id": {"$in": assigned_ids}}, {"_id": 0, "id": 1, "name": 1}):
            names[d["id"]] = d["name"]
    for v in vehicles:
        v["assigned_driver_name"] = names.get(v.get("assigned_driver_id"))
    vehicles.sort(key=lambda v: (v.get("registration_number") or ""))
    return {"vehicles": vehicles}


@router.post("/company/vehicles")
async def add_company_vehicle(body: FleetVehicleCreate, credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    reg = body.registration_number.strip().upper()
    if not reg:
        raise HTTPException(400, "Registration number is required")
    dup = await db.fleet_vehicles.find_one({"company_id": company["id"], "registration_number": reg})
    if dup:
        raise HTTPException(400, "A vehicle with this registration already exists")
    vtype = body.vehicle_type if body.vehicle_type in VEHICLE_TYPES else "cargo_van"
    vinfo = VEHICLE_TYPES[vtype]
    vehicle = FleetVehicle(
        company_id=company["id"],
        registration_number=reg,
        vehicle_type=vtype,
        capacity_kg=body.capacity_kg or vinfo["max_weight_kg"],
        max_weight_kg=body.max_weight_kg or vinfo["max_weight_kg"],
        length_cm=body.length_cm,
        width_cm=body.width_cm,
        height_cm=body.height_cm,
    )
    await db.fleet_vehicles.insert_one(vehicle.model_dump())
    return {"vehicle": vehicle.model_dump()}


@router.patch("/company/vehicles/{vehicle_id}")
async def update_company_vehicle(vehicle_id: str, body: FleetVehicleUpdate, credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    await _get_company_vehicle(company["id"], vehicle_id)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "registration_number" in updates:
        updates["registration_number"] = updates["registration_number"].strip().upper()
        dup = await db.fleet_vehicles.find_one({
            "company_id": company["id"],
            "registration_number": updates["registration_number"],
            "id": {"$ne": vehicle_id},
        })
        if dup:
            raise HTTPException(400, "A vehicle with this registration already exists")
    if "vehicle_type" in updates and updates["vehicle_type"] not in VEHICLE_TYPES:
        updates.pop("vehicle_type")
    if updates:
        await db.fleet_vehicles.update_one({"id": vehicle_id}, {"$set": updates})
    fresh = await db.fleet_vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    return {"vehicle": fresh}


@router.post("/company/vehicles/{vehicle_id}/assign")
async def assign_vehicle_driver(vehicle_id: str, body: AssignDriverRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    await _get_company_vehicle(company["id"], vehicle_id)
    await _get_company_driver(company["id"], body.driver_id)
    await db.fleet_vehicles.update_one({"id": vehicle_id}, {"$set": {"assigned_driver_id": body.driver_id}})
    fresh = await db.fleet_vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    return {"vehicle": fresh}


@router.post("/company/vehicles/{vehicle_id}/unassign")
async def unassign_vehicle_driver(vehicle_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    await _get_company_vehicle(company["id"], vehicle_id)
    await db.fleet_vehicles.update_one({"id": vehicle_id}, {"$set": {"assigned_driver_id": None}})
    fresh = await db.fleet_vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    return {"vehicle": fresh}


@router.delete("/company/vehicles/{vehicle_id}")
async def delete_company_vehicle(vehicle_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    res = await db.fleet_vehicles.delete_one({"id": vehicle_id, "company_id": company["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Vehicle not found in your company")
    return {"success": True}


@router.get("/company/jobs")
async def list_company_jobs(
    status: Optional[str] = None,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """All jobs belonging to the company (across every company driver)."""
    driver, company = await _require_company_owner(credentials)
    query: dict = {"assigned_company_id": company["id"]}
    if status:
        query["status"] = status
    raw = [o async for o in db.orders.find(query, {"_id": 0}).sort("created_at", -1).limit(200)]

    drv_ids = list({o.get("assigned_driver_id") for o in raw if o.get("assigned_driver_id")})
    veh_ids = list({o.get("assigned_vehicle_id") for o in raw if o.get("assigned_vehicle_id")})
    dnames: dict = {}
    if drv_ids:
        async for d in db.drivers.find({"id": {"$in": drv_ids}}, {"_id": 0, "id": 1, "name": 1}):
            dnames[d["id"]] = d["name"]
    vregs: dict = {}
    if veh_ids:
        async for v in db.fleet_vehicles.find({"id": {"$in": veh_ids}}, {"_id": 0, "id": 1, "registration_number": 1}):
            vregs[v["id"]] = v["registration_number"]

    def _name(p):
        return p.get("name") if isinstance(p, dict) else None

    jobs = [{
        "id": o["id"],
        "order_number": o.get("order_number"),
        "status": o.get("status"),
        "pickup": _name(o.get("pickup")),
        "dropoff": _name(o.get("dropoff")),
        "earnings": round(float(o.get("earnings", 0) or 0), 2),
        "distance_km": o.get("distance_km"),
        "driver_id": o.get("assigned_driver_id"),
        "driver_name": dnames.get(o.get("assigned_driver_id")),
        "vehicle_id": o.get("assigned_vehicle_id"),
        "vehicle_reg": vregs.get(o.get("assigned_vehicle_id")),
        "created_at": o.get("created_at"),
        "completed_at": o.get("completed_at"),
    } for o in raw]

    active = sum(1 for o in raw if o.get("status") in sm.ACTIVE_STATES)
    completed = sum(1 for o in raw if o.get("status") == sm.DELIVERED)
    earnings = round(sum(float(o.get("earnings", 0) or 0) for o in raw if o.get("status") == sm.DELIVERED), 2)
    return {
        "jobs": jobs,
        "stats": {"total": len(jobs), "active": active, "completed": completed, "completed_earnings": earnings},
    }


@router.post("/company/jobs/{order_id}/assign")
async def owner_assign_job(
    order_id: str,
    body: AssignJobRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Owner assigns a still-pending order to one of their drivers (owner_assign / hybrid)."""
    owner, company = await _require_company_owner(credentials)
    target = await _get_company_driver(company["id"], body.driver_id)
    if target.get("is_suspended"):
        raise HTTPException(400, "That driver is suspended")

    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] != "pending":
        raise HTTPException(400, "Order is no longer available")

    vehicle_id = None
    if body.vehicle_id:
        veh = await _get_company_vehicle(company["id"], body.vehicle_id)
        vehicle_id = veh["id"]
    else:
        veh = await db.fleet_vehicles.find_one(
            {"company_id": company["id"], "assigned_driver_id": body.driver_id, "status": "active"},
            {"_id": 0, "id": 1},
        )
        vehicle_id = veh["id"] if veh else None

    set_fields = {
        "status": sm.ACCEPTED,
        "driver_id": body.driver_id,
        "assigned_company_id": company["id"],
        "assigned_driver_id": body.driver_id,
        "assigned_vehicle_id": vehicle_id,
    }
    res = await db.orders.update_one({"id": order_id, "status": "pending"}, {"$set": set_fields})
    if res.modified_count == 0:
        raise HTTPException(409, "Order already accepted by another driver")
    await audit.record_event(
        db, order_id, "status_change",
        from_status="pending", to_status=sm.ACCEPTED,
        actor_id=owner["id"], actor_type="driver",
    )
    order.update(set_fields)
    asyncio.create_task(push_status_to_shipper(order, "accepted"))
    return {"success": True, "order_id": order_id, "driver_id": body.driver_id, "vehicle_id": vehicle_id}


@router.get("/company/wallet")
async def get_company_wallet(credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    wallet = await _get_or_create_company_wallet(company["id"])
    txns = [
        t async for t in db.company_wallet_txns.find({"company_id": company["id"]}, {"_id": 0})
        .sort("created_at", -1).limit(50)
    ]
    payouts = [
        p async for p in db.company_payouts.find({"company_id": company["id"]}, {"_id": 0})
        .sort("created_at", -1).limit(50)
    ]
    return {"wallet": wallet, "transactions": txns, "payouts": payouts}


@router.post("/company/payouts")
async def request_company_payout(
    body: CompanyPayoutCreate,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    driver, company = await _require_company_owner(credentials)
    wallet = await _get_or_create_company_wallet(company["id"])
    amount = round(float(body.amount), 2)
    if amount <= 0:
        raise HTTPException(400, "Amount must be greater than zero")
    if amount > round(float(wallet.get("available_balance", 0)), 2):
        raise HTTPException(400, "Amount exceeds available balance")
    payout = CompanyPayout(
        company_id=company["id"],
        company_name=company.get("company_name"),
        amount=amount,
        method=body.method or "bank_transfer",
        account_details=body.account_details,
        reference="PO-" + uuid.uuid4().hex[:8].upper(),
    )
    await db.company_payouts.insert_one(payout.model_dump())
    # Move funds from available -> pending (locked while the request is processed).
    await db.company_wallets.update_one(
        {"company_id": company["id"]},
        {"$inc": {"available_balance": -amount, "pending_balance": amount},
         "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"payout": payout.model_dump()}


@router.get("/company/payouts")
async def list_company_payouts(credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    payouts = [
        p async for p in db.company_payouts.find({"company_id": company["id"]}, {"_id": 0})
        .sort("created_at", -1).limit(100)
    ]
    return {"payouts": payouts}
