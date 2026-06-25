"""Auto-extracted misc routes. Handler bodies are unchanged; shared names
(db, models, helpers, FastAPI symbols) are injected from the server module."""
from fastapi import APIRouter
import server as _srv

_g = globals()
for _k in dir(_srv):
    if not _k.startswith('__'):
        _g.setdefault(_k, getattr(_srv, _k))

router = APIRouter()


@router.get("/")
async def root():
    return {"message": "NadaRuns Logistics API - Production Ready"}


@router.post("/seed-demo")
async def seed_demo_data():
    """
    Seed demo data for testing purposes.
    Creates a demo driver, demo shipper, and sample logistics orders.
    WARNING: This is for development/testing only!
    """
    result = {
        "message": "Demo data seeded successfully",
        "created": {
            "driver": None,
            "shipper": None,
            "orders": 0,
            "history": 0,
        }
    }
    
    # Create demo driver if not exists
    demo_driver_email = "demo.driver@nadaruns.com"
    existing_driver = await db.drivers.find_one({"email": demo_driver_email})
    if not existing_driver:
        demo_driver_id = str(uuid.uuid4())
        demo_driver = Driver(
            id=demo_driver_id,
            name="Demo Driver",
            rating=4.85,
            avatar=f"https://api.dicebear.com/7.x/avataaars/png?seed={demo_driver_id}",
            vehicle="Cargo Van • DEMO-001",
            vehicle_type="cargo_van",
            vehicle_capacity_kg=1500,
            plate="DEMO-001",
            email=demo_driver_email,
            phone="+358 40 123 4567",
            password_hash=hash_password("demo1234"),
            is_online=False,
            earnings_today=0.0,
            deliveries_today=0,
            acceptance_rate=95.0,
        )
        await db.drivers.insert_one(demo_driver.model_dump())
        result["created"]["driver"] = {"email": demo_driver_email, "password": "demo1234"}
        logger.info(f"Created demo driver: {demo_driver_email}")
    else:
        demo_driver_id = existing_driver["id"]

    # Demo driver is pre-Verified so the demo works end-to-end (KYC approved).
    await db.kyc_status.update_one(
        {"driver_id": demo_driver_id},
        {"$set": {
            "driver_id": demo_driver_id,
            "license_front": "approved",
            "license_back": "approved",
            "selfie": "approved",
            "overall_status": "approved",
            "submitted_at": datetime.now(timezone.utc).isoformat(),
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    
    # Create demo shipper if not exists
    demo_shipper_email = "demo.shipper@nadaruns.com"
    existing_shipper = await db.shippers.find_one({"email": demo_shipper_email})
    if not existing_shipper:
        demo_shipper_id = str(uuid.uuid4())
        demo_shipper = Shipper(
            id=demo_shipper_id,
            company_name="Demo Logistics Co",
            contact_name="Demo Manager",
            email=demo_shipper_email,
            phone="+358 40 987 6543",
            password_hash=hash_password("demo1234"),
            avatar="https://api.dicebear.com/7.x/initials/png?seed=DemoLogistics",
            is_verified=True,
            total_shipments=0,
        )
        await db.shippers.insert_one(demo_shipper.model_dump())
        result["created"]["shipper"] = {"email": demo_shipper_email, "password": "demo1234"}
        logger.info(f"Created demo shipper: {demo_shipper_email}")
    
    # Seed pending orders for all regions
    pending_count = await db.orders.count_documents({"status": "pending"})
    if pending_count < 20:
        orders_created = 0
        
        # Helsinki region - 10 orders
        for i, pickup in enumerate(LOGISTICS_PICKUPS):
            dropoff = LOGISTICS_DROPOFFS[i % len(LOGISTICS_DROPOFFS)]
            order = build_logistics_order("pending", override_pickup=pickup, override_dropoff=dropoff, region="helsinki")
            await db.orders.insert_one(order)
            orders_created += 1
        logger.info("Seeded 10 Helsinki region logistics orders")
        
        # Tampere region - 10 orders
        for i, pickup in enumerate(TAMPERE_PICKUPS):
            dropoff = TAMPERE_DROPOFFS[i % len(TAMPERE_DROPOFFS)]
            order = build_logistics_order("pending", override_pickup=pickup, override_dropoff=dropoff, region="tampere")
            await db.orders.insert_one(order)
            orders_created += 1
        logger.info("Seeded 10 Tampere region logistics orders")
        
        # Turku region - 2 orders
        for i, pickup in enumerate(TURKU_PICKUPS):
            dropoff = TURKU_DROPOFFS[i % len(TURKU_DROPOFFS)]
            order = build_logistics_order("pending", override_pickup=pickup, override_dropoff=dropoff, region="turku")
            await db.orders.insert_one(order)
            orders_created += 1
        logger.info("Seeded 2 Turku region logistics orders")
        
        # Oulu region - 2 orders
        for i, pickup in enumerate(OULU_PICKUPS):
            dropoff = OULU_DROPOFFS[i % len(OULU_DROPOFFS)]
            order = build_logistics_order("pending", override_pickup=pickup, override_dropoff=dropoff, region="oulu")
            await db.orders.insert_one(order)
            orders_created += 1
        logger.info("Seeded 2 Oulu region logistics orders")
        
        # Kuopio region - 1 order
        for i, pickup in enumerate(KUOPIO_PICKUPS):
            dropoff = KUOPIO_DROPOFFS[i % len(KUOPIO_DROPOFFS)]
            order = build_logistics_order("pending", override_pickup=pickup, override_dropoff=dropoff, region="kuopio")
            await db.orders.insert_one(order)
            orders_created += 1
        logger.info("Seeded 1 Kuopio region logistics order")
        
        result["created"]["orders"] = orders_created
        result["created"]["orders_by_region"] = {
            "helsinki": 10,
            "tampere": 10,
            "turku": 2,
            "oulu": 2,
            "kuopio": 1,
        }
        logger.info(f"Seeded total {orders_created} pending logistics orders across all regions")
    
    # Seed delivery history if none exists
    history_count = await db.orders.count_documents({"status": "delivered"})
    if history_count < 6:
        for i in range(8):
            await db.orders.insert_one(build_logistics_order("delivered", completed_offset_hours=i * 6 + random.randint(1, 5)))
        result["created"]["history"] = 8
        logger.info("Seeded delivery history")
    
    return result


@router.delete("/seed-demo")
async def clear_demo_data():
    """
    Clear all demo data.
    WARNING: This will delete orders, drivers, and shippers!
    """
    deleted = {
        "orders": 0,
        "drivers": 0,
        "shippers": 0,
    }
    
    # Delete all orders
    orders_result = await db.orders.delete_many({})
    deleted["orders"] = orders_result.deleted_count
    
    # Delete demo driver (but keep real registered users)
    drivers_result = await db.drivers.delete_many({"email": {"$regex": "demo"}})
    deleted["drivers"] = drivers_result.deleted_count
    
    # Delete demo shipper
    shippers_result = await db.shippers.delete_many({"email": {"$regex": "demo"}})
    deleted["shippers"] = shippers_result.deleted_count
    
    logger.info(f"Cleared demo data: {deleted}")
    return {"message": "Demo data cleared", "deleted": deleted}


@router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
    """Register a native device push token with the Emergent push relay (SuprSend)."""
    try:
        resp = await _push_client.post("/api/v1/push/users/register", json=body.model_dump())
    except Exception as e:
        logger.warning(f"register-push relay error (non-fatal): {e}")
        raise HTTPException(502, "Push provider unavailable")
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()
    return {"status": "registered"}
