"""Auto-extracted admin routes. Handler bodies are unchanged; shared names
(db, models, helpers, FastAPI symbols) are injected from the server module."""
from fastapi import APIRouter
import server as _srv

_g = globals()
for _k in dir(_srv):
    if not _k.startswith('__'):
        _g.setdefault(_k, getattr(_srv, _k))

router = APIRouter()


@router.get("/admin/kyc-applications")
async def get_kyc_applications(user: dict = Depends(get_admin_user)):
    """Get all KYC applications for admin review."""
    applications = []
    async for status in db.kyc_status.find({}, {"_id": 0}):
        # Get driver info
        driver = await db.drivers.find_one({"id": status["driver_id"]}, {"_id": 0, "password_hash": 0})
        
        # Get document images
        docs = {}
        async for doc in db.kyc_documents.find({"driver_id": status["driver_id"]}, {"_id": 0}):
            docs[doc["document_type"]] = {
                "image_data": doc["image_data"],
                "status": doc.get("status", "pending"),
                "uploaded_at": doc.get("uploaded_at"),
            }
        
        applications.append({
            "driver": driver,
            "kyc_status": status,
            "documents": docs,
        })
    
    return applications


@router.post("/admin/kyc/{driver_id}/approve")
async def approve_kyc(driver_id: str, user: dict = Depends(get_admin_user)):
    """Approve a driver's KYC application."""
    now = datetime.now(timezone.utc).isoformat()
    
    result = await db.kyc_status.update_one(
        {"driver_id": driver_id},
        {"$set": {
            "license_front": "approved",
            "license_back": "approved",
            "selfie": "approved",
            "overall_status": "approved",
            "reviewed_at": now,
        }}
    )
    
    if result.matched_count == 0:
        raise HTTPException(404, "KYC application not found")
    
    # Update document statuses
    await db.kyc_documents.update_many(
        {"driver_id": driver_id},
        {"$set": {"status": "approved"}}
    )
    
    logger.info(f"Admin approved KYC for driver {driver_id}")

    drv = await db.drivers.find_one({"id": driver_id}, {"_id": 0, "name": 1, "email": 1})
    if drv and drv.get("email"):
        subj, html = email_tpl.driver_approved(drv.get("name", "there"))
        send_email_bg(drv["email"], subj, html, to_name=drv.get("name"),
                      category="driver_approved", related_id=driver_id)

    return {"message": "KYC approved successfully"}


@router.post("/admin/kyc/{driver_id}/reject")
async def reject_kyc(driver_id: str, reason: str = "Documents not clear", user: dict = Depends(get_admin_user)):
    """Reject a driver's KYC application."""
    now = datetime.now(timezone.utc).isoformat()
    
    result = await db.kyc_status.update_one(
        {"driver_id": driver_id},
        {"$set": {
            "license_front": "rejected",
            "license_back": "rejected",
            "selfie": "rejected",
            "overall_status": "rejected",
            "reviewed_at": now,
            "rejection_reason": reason,
        }}
    )
    
    if result.matched_count == 0:
        raise HTTPException(404, "KYC application not found")
    
    # Update document statuses
    await db.kyc_documents.update_many(
        {"driver_id": driver_id},
        {"$set": {"status": "rejected", "rejection_reason": reason}}
    )
    
    logger.info(f"Admin rejected KYC for driver {driver_id}: {reason}")

    drv = await db.drivers.find_one({"id": driver_id}, {"_id": 0, "name": 1, "email": 1})
    if drv and drv.get("email"):
        subj, html = email_tpl.driver_rejected(drv.get("name", "there"), reason)
        send_email_bg(drv["email"], subj, html, to_name=drv.get("name"),
                      category="driver_rejected", related_id=driver_id)

    return {"message": "KYC rejected"}


@router.get("/admin/stats")
async def get_admin_stats(user: dict = Depends(get_admin_user)):
    """Get platform statistics for admin dashboard."""
    total_drivers = await db.drivers.count_documents({})
    active_drivers = await db.drivers.count_documents({"is_online": True})
    total_shippers = await db.shippers.count_documents({})
    total_orders = await db.orders.count_documents({})
    pending_orders = await db.orders.count_documents({"status": "pending"})
    completed_orders = await db.orders.count_documents({"status": "delivered"})
    pending_kyc = await db.kyc_status.count_documents({"overall_status": "pending"})
    
    # Calculate total revenue from completed orders
    pipeline = [
        {"$match": {"status": "delivered"}},
        {"$group": {"_id": None, "total": {"$sum": "$earnings"}}}
    ]
    revenue_result = await db.orders.aggregate(pipeline).to_list(1)
    total_revenue = revenue_result[0]["total"] if revenue_result else 0
    
    return {
        "total_drivers": total_drivers,
        "active_drivers": active_drivers,
        "total_shippers": total_shippers,
        "total_orders": total_orders,
        "pending_orders": pending_orders,
        "completed_orders": completed_orders,
        "total_revenue": total_revenue,
        "pending_kyc": pending_kyc,
    }


@router.get("/admin/drivers")
async def get_admin_drivers(user: dict = Depends(get_admin_user)):
    """Get all drivers for admin dashboard."""
    drivers = []
    async for driver in db.drivers.find({}, {"_id": 0, "password_hash": 0}):
        drivers.append({
            "id": driver["id"],
            "name": driver["name"],
            "email": driver["email"],
            "is_online": driver.get("is_online", False),
            "rating": driver.get("rating", 5.0),
            "deliveries_today": driver.get("deliveries_today", 0),
        })
    return drivers


@router.get("/admin/shippers")
async def get_admin_shippers(user: dict = Depends(get_admin_user)):
    """Get all shippers for admin dashboard."""
    shippers = []
    async for shipper in db.shippers.find({}, {"_id": 0, "password_hash": 0}):
        # Count orders for this shipper
        order_count = await db.orders.count_documents({"shipper_id": shipper["id"]})
        shippers.append({
            "id": shipper["id"],
            "company_name": shipper.get("company_name", "Unknown"),
            "email": shipper["email"],
            "total_orders": order_count,
        })
    return shippers


@router.get("/admin/overview")
async def admin_overview(user: dict = Depends(get_admin_user)):
    """Rich analytics for the admin dashboard: KPIs, time-series & breakdowns."""
    now = datetime.now(timezone.utc)
    days = 14
    since = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    since_iso = since.isoformat()

    total_drivers = await db.drivers.count_documents({})
    active_drivers = await db.drivers.count_documents({"is_online": True})
    suspended_drivers = await db.drivers.count_documents({"is_suspended": True})
    total_shippers = await db.shippers.count_documents({})
    suspended_shippers = await db.shippers.count_documents({"is_suspended": True})
    total_orders = await db.orders.count_documents({})
    pending_orders = await db.orders.count_documents({"status": "pending"})
    delivered_orders = await db.orders.count_documents({"status": "delivered"})
    cancelled_orders = await db.orders.count_documents({"status": "cancelled"})
    in_progress = await db.orders.count_documents(
        {"status": {"$nin": ["pending", "delivered", "cancelled", "rejected"]}}
    )
    try:
        pending_kyc = await db.kyc_status.count_documents({"overall_status": "pending"})
    except Exception:
        pending_kyc = 0

    rev = await db.orders.aggregate([
        {"$match": {"status": "delivered"}},
        {"$group": {"_id": None, "total": {"$sum": "$earnings"}, "tips": {"$sum": "$tip"}}},
    ]).to_list(1)
    total_revenue = round(float(rev[0]["total"]), 2) if rev else 0.0
    total_tips = round(float(rev[0].get("tips", 0.0) or 0), 2) if rev else 0.0

    status_rows = await db.orders.aggregate([
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]).to_list(50)
    orders_by_status = {r["_id"]: r["count"] for r in status_rows if r.get("_id")}

    veh_rows = await db.orders.aggregate([
        {"$match": {"vehicle_type": {"$ne": None}}},
        {"$group": {"_id": "$vehicle_type", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]).to_list(50)
    orders_by_vehicle = [{"vehicle_type": r["_id"], "count": r["count"]} for r in veh_rows if r.get("_id")]

    day_keys = [(since + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]
    del_rows = {r["_id"]: r for r in await db.orders.aggregate([
        {"$match": {"status": "delivered", "completed_at": {"$gte": since_iso}}},
        {"$group": {"_id": {"$substr": ["$completed_at", 0, 10]},
                    "deliveries": {"$sum": 1}, "revenue": {"$sum": "$earnings"}}},
    ]).to_list(1000)}
    new_rows = {r["_id"]: r["count"] for r in await db.orders.aggregate([
        {"$match": {"created_at": {"$gte": since_iso}}},
        {"$group": {"_id": {"$substr": ["$created_at", 0, 10]}, "count": {"$sum": 1}}},
    ]).to_list(1000)}
    series = []
    for k in day_keys:
        dr = del_rows.get(k, {})
        series.append({
            "date": k,
            "deliveries": dr.get("deliveries", 0),
            "revenue": round(float(dr.get("revenue", 0.0) or 0), 2),
            "new_orders": new_rows.get(k, 0),
        })

    top_rows = await db.orders.aggregate([
        {"$match": {"status": "delivered", "driver_id": {"$ne": None}}},
        {"$group": {"_id": "$driver_id", "deliveries": {"$sum": 1}, "earnings": {"$sum": "$earnings"}}},
        {"$sort": {"deliveries": -1}},
        {"$limit": 5},
    ]).to_list(5)
    top_drivers = []
    for r in top_rows:
        d = await db.drivers.find_one({"id": r["_id"]}, {"_id": 0, "name": 1, "avatar": 1})
        top_drivers.append({
            "driver_id": r["_id"],
            "name": (d or {}).get("name", "Unknown"),
            "avatar": (d or {}).get("avatar", ""),
            "deliveries": r["deliveries"],
            "earnings": round(float(r["earnings"]), 2),
        })

    recent = []
    async for o in db.orders.find({}, {"_id": 0}).sort("created_at", -1).limit(8):
        recent.append(_admin_order_row(o))

    return {
        "kpis": {
            "total_drivers": total_drivers,
            "active_drivers": active_drivers,
            "suspended_drivers": suspended_drivers,
            "total_shippers": total_shippers,
            "suspended_shippers": suspended_shippers,
            "total_orders": total_orders,
            "pending_orders": pending_orders,
            "in_progress_orders": in_progress,
            "delivered_orders": delivered_orders,
            "cancelled_orders": cancelled_orders,
            "pending_kyc": pending_kyc,
            "total_revenue": total_revenue,
            "total_tips": total_tips,
        },
        "orders_by_status": orders_by_status,
        "orders_by_vehicle": orders_by_vehicle,
        "series": series,
        "top_drivers": top_drivers,
        "recent_orders": recent,
    }


@router.get("/admin/manage/drivers")
async def admin_list_drivers(
    user: dict = Depends(get_admin_user),
    search: str = "",
    status: str = "all",
    page: int = 1,
    limit: int = 20,
):
    query: dict = {}
    if search:
        rx = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [{"name": rx}, {"email": rx}, {"phone": rx}, {"plate": rx}]
    if status == "online":
        query["is_online"] = True
    elif status == "offline":
        query["is_online"] = False
    elif status == "suspended":
        query["is_suspended"] = True
    page = max(1, page)
    limit = max(1, min(limit, 100))
    total = await db.drivers.count_documents(query)
    items = []
    cursor = db.drivers.find(query, {"_id": 0, "password_hash": 0}).sort("name", 1).skip((page - 1) * limit).limit(limit)
    async for d in cursor:
        items.append(_admin_driver_row(d))
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/admin/manage/drivers/{driver_id}")
async def admin_driver_detail(driver_id: str, user: dict = Depends(get_admin_user)):
    d = await db.drivers.find_one({"id": driver_id}, {"_id": 0, "password_hash": 0})
    if not d:
        raise HTTPException(404, "Driver not found")
    orders = []
    async for o in db.orders.find({"driver_id": driver_id}, {"_id": 0}).sort("created_at", -1).limit(20):
        orders.append(_admin_order_row(o))
    delivered = await db.orders.count_documents({"driver_id": driver_id, "status": "delivered"})
    total_assigned = await db.orders.count_documents({"driver_id": driver_id})
    er = await db.orders.aggregate([
        {"$match": {"driver_id": driver_id, "status": "delivered"}},
        {"$group": {"_id": None, "total": {"$sum": "$earnings"}}},
    ]).to_list(1)
    lifetime_earnings = round(float(er[0]["total"]), 2) if er else 0.0
    return {
        "driver": d,
        "vehicles": d.get("vehicles", []),
        "recent_orders": orders,
        "stats": {"delivered": delivered, "total_assigned": total_assigned, "lifetime_earnings": lifetime_earnings},
    }


@router.patch("/admin/manage/drivers/{driver_id}")
async def admin_update_driver(driver_id: str, body: AdminDriverUpdate, user: dict = Depends(get_admin_user)):
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(400, "No fields to update")
    res = await db.drivers.update_one({"id": driver_id}, {"$set": patch})
    if res.matched_count == 0:
        raise HTTPException(404, "Driver not found")
    d = await db.drivers.find_one({"id": driver_id}, {"_id": 0, "password_hash": 0})
    return _admin_driver_row(d)


@router.post("/admin/manage/drivers/{driver_id}/suspend")
async def admin_suspend_driver(driver_id: str, user: dict = Depends(get_admin_user)):
    res = await db.drivers.update_one({"id": driver_id}, {"$set": {"is_suspended": True, "is_online": False}})
    if res.matched_count == 0:
        raise HTTPException(404, "Driver not found")
    return {"status": "suspended", "driver_id": driver_id}


@router.post("/admin/manage/drivers/{driver_id}/activate")
async def admin_activate_driver(driver_id: str, user: dict = Depends(get_admin_user)):
    res = await db.drivers.update_one({"id": driver_id}, {"$set": {"is_suspended": False}})
    if res.matched_count == 0:
        raise HTTPException(404, "Driver not found")
    return {"status": "active", "driver_id": driver_id}


@router.get("/admin/manage/shippers")
async def admin_list_shippers(
    user: dict = Depends(get_admin_user),
    search: str = "",
    status: str = "all",
    page: int = 1,
    limit: int = 20,
):
    query: dict = {}
    if search:
        rx = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [{"company_name": rx}, {"contact_name": rx}, {"email": rx}, {"phone": rx}]
    if status == "suspended":
        query["is_suspended"] = True
    elif status == "verified":
        query["is_verified"] = True
    page = max(1, page)
    limit = max(1, min(limit, 100))
    total = await db.shippers.count_documents(query)
    items = []
    cursor = db.shippers.find(query, {"_id": 0, "password_hash": 0}).sort("company_name", 1).skip((page - 1) * limit).limit(limit)
    async for s in cursor:
        oc = await db.orders.count_documents({"shipper_id": s["id"]})
        items.append(_admin_shipper_row(s, oc))
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/admin/manage/shippers/{shipper_id}")
async def admin_shipper_detail(shipper_id: str, user: dict = Depends(get_admin_user)):
    s = await db.shippers.find_one({"id": shipper_id}, {"_id": 0, "password_hash": 0})
    if not s:
        raise HTTPException(404, "Shipper not found")
    orders = []
    async for o in db.orders.find({"shipper_id": shipper_id}, {"_id": 0}).sort("created_at", -1).limit(20):
        orders.append(_admin_order_row(o))
    total_orders = await db.orders.count_documents({"shipper_id": shipper_id})
    delivered = await db.orders.count_documents({"shipper_id": shipper_id, "status": "delivered"})
    sp = await db.orders.aggregate([
        {"$match": {"shipper_id": shipper_id, "status": "delivered"}},
        {"$group": {"_id": None, "total": {"$sum": "$earnings"}}},
    ]).to_list(1)
    total_spend = round(float(sp[0]["total"]), 2) if sp else 0.0
    return {
        "shipper": s,
        "recent_orders": orders,
        "stats": {"total_orders": total_orders, "delivered": delivered, "total_spend": total_spend},
    }


@router.patch("/admin/manage/shippers/{shipper_id}")
async def admin_update_shipper(shipper_id: str, body: AdminShipperUpdate, user: dict = Depends(get_admin_user)):
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(400, "No fields to update")
    res = await db.shippers.update_one({"id": shipper_id}, {"$set": patch})
    if res.matched_count == 0:
        raise HTTPException(404, "Shipper not found")
    s = await db.shippers.find_one({"id": shipper_id}, {"_id": 0, "password_hash": 0})
    oc = await db.orders.count_documents({"shipper_id": shipper_id})
    return _admin_shipper_row(s, oc)


@router.post("/admin/manage/shippers/{shipper_id}/suspend")
async def admin_suspend_shipper(shipper_id: str, user: dict = Depends(get_admin_user)):
    res = await db.shippers.update_one({"id": shipper_id}, {"$set": {"is_suspended": True}})
    if res.matched_count == 0:
        raise HTTPException(404, "Shipper not found")
    return {"status": "suspended", "shipper_id": shipper_id}


@router.post("/admin/manage/shippers/{shipper_id}/activate")
async def admin_activate_shipper(shipper_id: str, user: dict = Depends(get_admin_user)):
    res = await db.shippers.update_one({"id": shipper_id}, {"$set": {"is_suspended": False}})
    if res.matched_count == 0:
        raise HTTPException(404, "Shipper not found")
    return {"status": "active", "shipper_id": shipper_id}


@router.get("/admin/manage/orders")
async def admin_list_orders(
    user: dict = Depends(get_admin_user),
    search: str = "",
    status: str = "all",
    page: int = 1,
    limit: int = 20,
):
    query: dict = {}
    if status and status != "all":
        query["status"] = status
    if search:
        rx = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [{"order_number": rx}, {"pickup.address": rx}, {"dropoff.address": rx}]
    page = max(1, page)
    limit = max(1, min(limit, 100))
    total = await db.orders.count_documents(query)
    items = []
    cursor = db.orders.find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * limit).limit(limit)
    async for o in cursor:
        items.append(_admin_order_row(o))
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/admin/manage/orders/{order_id}")
async def admin_order_detail(order_id: str, user: dict = Depends(get_admin_user)):
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    driver = None
    if o.get("driver_id"):
        driver = await db.drivers.find_one(
            {"id": o["driver_id"]}, {"_id": 0, "id": 1, "name": 1, "phone": 1, "avatar": 1}
        )
    shipper = None
    if o.get("shipper_id"):
        shipper = await db.shippers.find_one(
            {"id": o["shipper_id"]}, {"_id": 0, "id": 1, "company_name": 1, "contact_name": 1, "phone": 1}
        )
    events = []
    try:
        async for e in db.order_events.find({"order_id": order_id}, {"_id": 0}).sort("created_at", 1):
            events.append(e)
    except Exception:
        events = []
    return {"order": o, "driver": driver, "shipper": shipper, "events": events}


@router.post("/admin/manage/orders/{order_id}/cancel")
async def admin_cancel_order(order_id: str, user: dict = Depends(get_admin_user)):
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    if o.get("status") in ("delivered", "cancelled"):
        raise HTTPException(400, f"Cannot cancel an order that is already {o.get('status')}")
    await db.orders.update_one({"id": order_id}, {"$set": {"status": "cancelled"}})
    o2 = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _admin_order_row(o2)


@router.post("/admin/manage/orders/{order_id}/reassign")
async def admin_reassign_order(order_id: str, body: AdminReassignRequest, user: dict = Depends(get_admin_user)):
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    d = await db.drivers.find_one({"id": body.driver_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Driver not found")
    await db.orders.update_one({"id": order_id}, {"$set": {"driver_id": body.driver_id}})
    await _record_assignment(order_id, "reassigned", body.driver_id, user.get("id"))
    o2 = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _admin_order_row(o2)


@router.post("/admin/manage/orders/{order_id}/assign")
async def admin_assign_order(order_id: str, body: AdminReassignRequest, user: dict = Depends(get_admin_user)):
    """Assign (or reassign) a job to a specific driver."""
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    d = await db.drivers.find_one({"id": body.driver_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Driver not found")
    new_status = o["status"] if o["status"] not in ("pending", "cancelled", "paused", "failed") else "accepted"
    await db.orders.update_one({"id": order_id}, {"$set": {"driver_id": body.driver_id, "status": new_status}})
    await _record_assignment(order_id, "assigned", body.driver_id, user.get("id"))
    o2 = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _admin_order_row(o2)


@router.post("/admin/manage/orders/{order_id}/unassign")
async def admin_unassign_order(order_id: str, body: AdminReasonRequest = AdminReasonRequest(), user: dict = Depends(get_admin_user)):
    """Remove the assigned driver and return the job to the open marketplace (pending).

    Used for driver emergencies (illness, breakdown, no-response, etc.).
    """
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    prev_driver = o.get("driver_id")
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"driver_id": None, "status": "pending"}},
    )
    await _record_assignment(order_id, "returned_to_marketplace", prev_driver, user.get("id"),
                             note=(body.reason if body else None))
    # Notify the affected shipper (non-blocking).
    try:
        if o.get("shipper_id"):
            await _notify_shipper_status(o["shipper_id"], order_id,
                                         "Your delivery was returned to the marketplace and will be reassigned shortly.")
    except Exception:
        pass
    o2 = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _admin_order_row(o2)


@router.post("/admin/manage/orders/{order_id}/restore")
async def admin_restore_order(order_id: str, user: dict = Depends(get_admin_user)):
    """Restore a cancelled/paused/failed job back to the open marketplace."""
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    if o["status"] not in ("cancelled", "paused", "failed"):
        raise HTTPException(400, f"Only cancelled/paused/failed orders can be restored (is {o['status']})")
    await db.orders.update_one({"id": order_id}, {"$set": {"status": "pending", "driver_id": None}})
    o2 = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _admin_order_row(o2)


@router.post("/admin/manage/orders/{order_id}/pause")
async def admin_pause_order(order_id: str, user: dict = Depends(get_admin_user)):
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    if o["status"] in ("delivered", "cancelled"):
        raise HTTPException(400, f"Cannot pause an order that is {o['status']}")
    await db.orders.update_one({"id": order_id}, {"$set": {"status": "paused"}})
    o2 = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _admin_order_row(o2)


@router.post("/admin/manage/orders/{order_id}/complete")
async def admin_complete_order(order_id: str, user: dict = Depends(get_admin_user)):
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"status": "delivered", "completed_at": datetime.now(timezone.utc).isoformat()}},
    )
    o2 = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _admin_order_row(o2)


@router.post("/admin/manage/orders/{order_id}/fail")
async def admin_fail_order(order_id: str, body: AdminReasonRequest = AdminReasonRequest(), user: dict = Depends(get_admin_user)):
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    update = {"status": "failed"}
    if body and body.reason:
        update["fail_reason"] = body.reason
    await db.orders.update_one({"id": order_id}, {"$set": update})
    o2 = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _admin_order_row(o2)


@router.post("/admin/manage/orders/{order_id}/notes")
async def admin_add_order_note(order_id: str, body: AdminNoteRequest, user: dict = Depends(get_admin_user)):
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    note = {
        "id": str(uuid.uuid4()),
        "note": body.note,
        "admin_id": user.get("id"),
        "admin_name": user.get("name") or user.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.orders.update_one({"id": order_id}, {"$push": {"admin_notes": note}})
    o2 = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return {"order": _admin_order_row(o2), "notes": o2.get("admin_notes", [])}


@router.get("/admin/manage/orders/{order_id}/assignment-history")
async def admin_assignment_history(order_id: str, user: dict = Depends(get_admin_user)):
    rows = await db.assignment_history.find({"order_id": order_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"history": rows}


@router.get("/admin/receipts")
async def admin_list_receipts(
    doc_type: Optional[str] = None, q: Optional[str] = None,
    user: dict = Depends(get_admin_user),
):
    query: dict = {}
    if doc_type and doc_type != "all":
        query["doc_type"] = doc_type
    if q:
        rx = {"$regex": q, "$options": "i"}
        query["$or"] = [
            {"receipt_number": rx}, {"order_number": rx},
            {"user_name": rx}, {"user_email": rx},
        ]
    rows = await db.receipts.find(query, {"_id": 0}).sort("issued_at", -1).to_list(500)
    totals = {
        "count": len(rows),
        "payment_receipts": sum(1 for r in rows if r.get("doc_type") == "payment_receipt"),
        "withdrawal_receipts": sum(1 for r in rows if r.get("doc_type") == "withdrawal_receipt"),
        "withdrawal_invoices": sum(1 for r in rows if r.get("doc_type") == "withdrawal_invoice"),
        "total_amount": round(sum(float(r.get("amount") or 0) for r in rows), 2),
    }
    return {"receipts": rows, "totals": totals}


@router.post("/admin/receipts/{receipt_id}/resend")
async def admin_resend_receipt(receipt_id: str, user: dict = Depends(get_admin_user)):
    rec = await db.receipts.find_one({"id": receipt_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Receipt not found")
    await _send_receipt_email(rec)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.receipts.update_one({"id": receipt_id}, {"$set": {"last_sent_at": now_iso}})
    return {"ok": True, "last_sent_at": now_iso, "receipt_number": rec["receipt_number"]}


@router.get("/admin/email-logs")
async def admin_list_email_logs(
    category: Optional[str] = None, status: Optional[str] = None,
    q: Optional[str] = None, limit: int = 200,
    user: dict = Depends(get_admin_user),
):
    query: dict = {}
    if category and category != "all":
        query["category"] = category
    if status and status != "all":
        query["status"] = status
    if q:
        rx = {"$regex": q, "$options": "i"}
        query["$or"] = [{"to_email": rx}, {"subject": rx}]
    rows = await db.email_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(max(1, min(500, limit)))
    totals = {
        "count": len(rows),
        "sent": sum(1 for r in rows if r.get("status") == "sent"),
        "failed": sum(1 for r in rows if r.get("status") == "failed"),
        "dry_run": sum(1 for r in rows if r.get("status") == "dry_run"),
    }
    return {"logs": rows, "totals": totals}


@router.get("/admin/email-templates")
async def admin_list_email_templates(user: dict = Depends(get_admin_user)):
    reg = _email_template_registry()
    items = []
    for key, (label, category, fn) in reg.items():
        subject, _ = fn()
        items.append({"key": key, "label": label, "category": category, "subject": subject})
    return {"templates": items, "provider": email_service.EMAIL_PROVIDER,
            "sender": email_service.SENDER_EMAIL, "dry_run": email_service.DRY_RUN,
            "configured": email_service.is_configured()}


@router.get("/admin/email-templates/{key}/preview")
async def admin_preview_email_template(key: str, user: dict = Depends(get_admin_user)):
    reg = _email_template_registry()
    if key not in reg:
        raise HTTPException(404, "Unknown template")
    label, category, fn = reg[key]
    subject, html = fn()
    return {"key": key, "label": label, "category": category, "subject": subject, "html": html}


@router.post("/admin/email-templates/{key}/test-send")
async def admin_test_send_email_template(key: str, body: EmailTestSendRequest,
                                         user: dict = Depends(get_admin_user)):
    reg = _email_template_registry()
    if key not in reg:
        raise HTTPException(404, "Unknown template")
    label, category, fn = reg[key]
    subject, html = fn()
    result = await email_service.send_email(
        db, body.to_email, f"[TEST] {subject}", html, to_name="Admin Test",
        category=f"test_{category}", related_id=None,
    )
    if result.get("status") == "failed":
        raise HTTPException(502, f"Send failed: {result.get('error') or 'unknown error'}")
    return {"ok": True, "status": result.get("status"), "to": body.to_email,
            "provider_message_id": result.get("provider_message_id"), "template": key}


@router.get("/admin/invoices")
async def admin_list_invoices(
    status: Optional[str] = None,
    q: Optional[str] = None,
    user: dict = Depends(get_admin_user),
):
    query: dict = {}
    if status and status != "all":
        query["status"] = status
    if q:
        rx = {"$regex": q, "$options": "i"}
        query["$or"] = [
            {"invoice_number": rx}, {"order_number": rx},
            {"shipper_company": rx}, {"shipper_email": rx},
        ]
    # Auto-flag overdue (unpaid past due date) on read.
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        await db.invoices.update_many(
            {"status": "unpaid", "due_date": {"$lt": now_iso}},
            {"$set": {"status": "overdue"}},
        )
    except Exception:
        pass
    rows = await db.invoices.find(query, {"_id": 0}).sort("issued_at", -1).to_list(500)
    totals = {
        "count": len(rows),
        "unpaid": sum(1 for r in rows if r.get("status") == "unpaid"),
        "overdue": sum(1 for r in rows if r.get("status") == "overdue"),
        "paid": sum(1 for r in rows if r.get("status") == "paid"),
        "total_outstanding": round(sum(float(r.get("total_amount") or 0) for r in rows if r.get("status") in ("unpaid", "overdue")), 2),
    }
    return {"invoices": rows, "totals": totals}


@router.post("/admin/invoices/{invoice_id}/mark-paid")
async def admin_mark_invoice_paid(invoice_id: str, user: dict = Depends(get_admin_user)):
    res = await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Invoice not found")
    return await db.invoices.find_one({"id": invoice_id}, {"_id": 0})


@router.post("/admin/invoices/{invoice_id}/mark-overdue")
async def admin_mark_invoice_overdue(invoice_id: str, user: dict = Depends(get_admin_user)):
    res = await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": "overdue"}})
    if res.matched_count == 0:
        raise HTTPException(404, "Invoice not found")
    return await db.invoices.find_one({"id": invoice_id}, {"_id": 0})


@router.post("/admin/invoices/{invoice_id}/resend")
async def admin_resend_invoice(invoice_id: str, user: dict = Depends(get_admin_user)):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"last_sent_at": now_iso}})
    # Email the invoice PDF to the shipper and record an in-app notice.
    await _email_invoice_pdf(inv)
    try:
        await _notify_shipper_status(inv["shipper_id"], inv["order_id"],
                                     f"Invoice {inv['invoice_number']} has been re-sent. Amount due: EUR {inv.get('total_amount')}.")
    except Exception:
        pass
    return {"ok": True, "last_sent_at": now_iso, "invoice_number": inv["invoice_number"]}


@router.get("/admin/settings/invoicing")
async def admin_get_invoicing_settings(user: dict = Depends(get_admin_user)):
    return await get_invoicing_settings()


@router.post("/admin/settings/invoicing")
async def admin_update_invoicing_settings(body: InvoicingSettingsRequest, user: dict = Depends(get_admin_user)):
    await db.settings.update_one(
        {"key": "invoicing"},
        {"$set": {"key": "invoicing", "invoice_fee": max(0.0, float(body.invoice_fee)), "net_days": max(1, int(body.net_days))}},
        upsert=True,
    )
    return await get_invoicing_settings()


@router.get("/admin/manage/vehicles")
async def admin_list_vehicles(
    user: dict = Depends(get_admin_user), search: str = "", vehicle_type: str = "all"
):
    """Flatten all vehicles across drivers into one admin list."""
    rows = []
    async for d in db.drivers.find({}, {"_id": 0, "password_hash": 0}):
        vehicles = d.get("vehicles", []) or []
        if not vehicles and d.get("vehicle_type"):
            vehicles = [{
                "id": str(d["id"]) + "-primary",
                "vehicle_type": d.get("vehicle_type"),
                "label": d.get("vehicle", ""),
                "plate": d.get("plate", ""),
                "capacity_kg": d.get("vehicle_capacity_kg", 0),
                "is_primary": True,
            }]
        for v in vehicles:
            if vehicle_type != "all" and v.get("vehicle_type") != vehicle_type:
                continue
            row = {
                "id": v.get("id"),
                "vehicle_type": v.get("vehicle_type"),
                "label": v.get("label", ""),
                "plate": v.get("plate", ""),
                "capacity_kg": v.get("capacity_kg", 0),
                "is_primary": v.get("is_primary", False),
                "driver_id": d["id"],
                "driver_name": d.get("name", ""),
                "driver_suspended": d.get("is_suspended", False),
            }
            if search:
                hay = f"{row['plate']} {row['label']} {row['driver_name']} {row['vehicle_type']}".lower()
                if search.lower() not in hay:
                    continue
            rows.append(row)
    return {"items": rows, "total": len(rows)}


@router.get("/admin/financials/overview")
async def admin_financials_overview(user: dict = Depends(get_admin_user)):
    now = datetime.now(timezone.utc)
    days = 14
    since = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    since_iso = since.isoformat()

    cap = await db.orders.aggregate([
        {"$match": {"payment_status": "captured"}},
        {"$group": {"_id": None,
                    "revenue": {"$sum": "$payment_amount"},
                    "commission": {"$sum": "$commission_amount"},
                    "driver_payouts": {"$sum": "$driver_payout_amount"},
                    "count": {"$sum": 1}}},
    ]).to_list(1)
    captured = cap[0] if cap else {}
    total_revenue = round(float(captured.get("revenue", 0) or 0), 2)
    total_commission = round(float(captured.get("commission", 0) or 0), 2)
    total_driver_payouts = round(float(captured.get("driver_payouts", 0) or 0), 2)
    captured_count = captured.get("count", 0)

    auth = await db.orders.aggregate([
        {"$match": {"payment_status": "authorized"}},
        {"$group": {"_id": None, "amount": {"$sum": "$payment_amount"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    authorized_amount = round(float(auth[0]["amount"], ) if auth else 0.0, 2)
    authorized_count = auth[0]["count"] if auth else 0

    wd_pending = await db.withdrawal_requests.aggregate([
        {"$match": {"status": {"$in": ["pending", "approved"]}}},
        {"$group": {"_id": None, "amount": {"$sum": "$amount"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    pending_withdrawals = round(float(wd_pending[0]["amount"]) if wd_pending else 0.0, 2)
    pending_withdrawals_count = wd_pending[0]["count"] if wd_pending else 0

    wd_paid = await db.withdrawal_requests.aggregate([
        {"$match": {"status": "paid"}},
        {"$group": {"_id": None, "amount": {"$sum": "$amount"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    paid_withdrawals = round(float(wd_paid[0]["amount"]) if wd_paid else 0.0, 2)
    paid_withdrawals_count = wd_paid[0]["count"] if wd_paid else 0

    day_keys = [(since + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]
    rows = {r["_id"]: r for r in await db.orders.aggregate([
        {"$match": {"payment_status": "captured", "captured_at": {"$gte": since_iso}}},
        {"$group": {"_id": {"$substr": ["$captured_at", 0, 10]},
                    "revenue": {"$sum": "$payment_amount"},
                    "commission": {"$sum": "$commission_amount"},
                    "count": {"$sum": 1}}},
    ]).to_list(1000)}
    series = []
    for k in day_keys:
        r = rows.get(k, {})
        series.append({
            "date": k,
            "revenue": round(float(r.get("revenue", 0) or 0), 2),
            "commission": round(float(r.get("commission", 0) or 0), 2),
            "captures": r.get("count", 0),
        })

    return {
        "kpis": {
            "total_revenue": total_revenue,
            "total_commission": total_commission,
            "total_driver_payouts": total_driver_payouts,
            "captured_payments": captured_count,
            "authorized_amount": authorized_amount,
            "authorized_count": authorized_count,
            "pending_withdrawals_amount": pending_withdrawals,
            "pending_withdrawals_count": pending_withdrawals_count,
            "paid_withdrawals_amount": paid_withdrawals,
            "paid_withdrawals_count": paid_withdrawals_count,
            "net_platform": round(total_commission, 2),
        },
        "series": series,
        "currency": "EUR",
    }


@router.get("/admin/financials/transactions")
async def admin_financials_transactions(
    page: int = 1, limit: int = 25, type: Optional[str] = None,
    user: dict = Depends(get_admin_user),
):
    page = max(1, page)
    limit = max(1, min(100, limit))
    query: dict = {}
    if type:
        query["type"] = type
    total = await db.payment_transactions.count_documents(query)
    items = await db.payment_transactions.find(query, {"_id": 0}).sort("created_at", -1) \
        .skip((page - 1) * limit).limit(limit).to_list(limit)
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/admin/payments/authorized")
async def admin_payments_authorized(user: dict = Depends(get_admin_user)):
    """Orders with funds authorized and awaiting capture."""
    items = []
    async for o in db.orders.find({"payment_status": "authorized"}, {"_id": 0}).sort("authorized_at", -1).limit(100):
        items.append({
            "order_id": o.get("id"),
            "order_number": o.get("order_number"),
            "status": o.get("status"),
            "payment_amount": o.get("payment_amount"),
            "commission_amount": o.get("commission_amount"),
            "driver_payout_amount": o.get("driver_payout_amount"),
            "shipper_id": o.get("shipper_id"),
            "driver_id": o.get("driver_id"),
            "authorized_at": o.get("authorized_at"),
        })
    return {"items": items, "total": len(items)}


@router.get("/admin/financials/withdrawals")
async def admin_list_withdrawals(
    status: Optional[str] = None, page: int = 1, limit: int = 25,
    user: dict = Depends(get_admin_user),
):
    page = max(1, page)
    limit = max(1, min(100, limit))
    query: dict = {}
    if status:
        query["status"] = status
    total = await db.withdrawal_requests.count_documents(query)
    items = await db.withdrawal_requests.find(query, {"_id": 0}).sort("requested_at", -1) \
        .skip((page - 1) * limit).limit(limit).to_list(limit)
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.post("/admin/financials/withdrawals/{withdrawal_id}/approve")
async def admin_approve_withdrawal(withdrawal_id: str, user: dict = Depends(get_admin_user)):
    return await _process_withdrawal(withdrawal_id, "approved", user["id"])


@router.post("/admin/financials/withdrawals/{withdrawal_id}/pay")
async def admin_pay_withdrawal(withdrawal_id: str, body: WithdrawalPayBody, user: dict = Depends(get_admin_user)):
    return await _process_withdrawal(withdrawal_id, "paid", user["id"], reference=body.reference, note=body.note)


@router.post("/admin/financials/withdrawals/{withdrawal_id}/reject")
async def admin_reject_withdrawal(withdrawal_id: str, body: WithdrawalRejectBody, user: dict = Depends(get_admin_user)):
    return await _process_withdrawal(withdrawal_id, "rejected", user["id"], note=body.reason)


@router.get("/admin/dispatch/map")
async def admin_dispatch_map(user: dict = Depends(get_admin_user)):
    """Feed for the live dispatch map: open jobs, in-transit jobs, online drivers + alerts."""
    def _pkg(o: dict) -> str:
        items = o.get("items") or []
        if items:
            names = ", ".join(f"{it.get('quantity', 1)}× {it.get('name')}" for it in items[:2] if it.get("name"))
            if names:
                return names
        return o.get("cargo_type") or "Package"

    jobs = []

    # Open (pending) jobs — green markers
    async for o in db.orders.find({"status": "pending"}, {"_id": 0}).limit(300):
        p = o.get("pickup") or {}
        d = o.get("dropoff") or {}
        if p.get("lat") is None or p.get("lng") is None:
            continue
        jobs.append({
            "id": o.get("id"), "order_number": o.get("order_number"), "status": "open",
            "lat": p.get("lat"), "lng": p.get("lng"),
            "dropoff_lat": d.get("lat"), "dropoff_lng": d.get("lng"),
            "pickup_name": p.get("name") or p.get("address"),
            "dropoff_name": d.get("name") or d.get("address"),
            "package": _pkg(o), "earnings": o.get("earnings"),
            "vehicle_type": o.get("vehicle_type"), "distance_km": o.get("distance_km"),
        })

    # In-transit jobs — blue markers (use live driver location when available)
    async for o in db.orders.find({"status": {"$in": list(sm.ACTIVE_STATES)}}, {"_id": 0}).limit(300):
        p = o.get("pickup") or {}
        d = o.get("dropoff") or {}
        loc = None
        if o.get("driver_id"):
            drv = await db.drivers.find_one({"id": o["driver_id"]}, {"_id": 0, "current_location": 1})
            loc = (drv or {}).get("current_location")
        lat = (loc or {}).get("lat") if loc else p.get("lat")
        lng = (loc or {}).get("lng") if loc else p.get("lng")
        if lat is None or lng is None:
            continue
        jobs.append({
            "id": o.get("id"), "order_number": o.get("order_number"), "status": "in_transit",
            "lat": lat, "lng": lng,
            "dropoff_lat": d.get("lat"), "dropoff_lng": d.get("lng"),
            "pickup_name": p.get("name") or p.get("address"),
            "dropoff_name": d.get("name") or d.get("address"),
            "package": _pkg(o), "earnings": o.get("earnings"),
            "vehicle_type": o.get("vehicle_type"), "order_status": o.get("status"),
        })

    # Online drivers — car markers
    drivers = []
    async for drv in db.drivers.find({"is_online": True}, {"_id": 0}):
        loc = drv.get("current_location")
        if not loc or loc.get("lat") is None or loc.get("lng") is None:
            continue
        drivers.append({
            "id": drv.get("id"), "name": drv.get("name"),
            "lat": loc.get("lat"), "lng": loc.get("lng"),
            "vehicle_type": drv.get("vehicle_type"),
            "updated_at": drv.get("location_updated_at"),
        })

    open_count = sum(1 for j in jobs if j["status"] == "open")
    transit_count = sum(1 for j in jobs if j["status"] == "in_transit")
    online_count = len(drivers)

    alerts = []
    if open_count > 0 and online_count == 0:
        alerts.append({"severity": "high", "message": f"{open_count} open jobs but no drivers online — consider surge pricing."})
    elif online_count > 0 and open_count / online_count > 8:
        alerts.append({"severity": "medium", "message": f"High demand: {open_count} open jobs for only {online_count} online drivers."})

    return {
        "jobs": jobs,
        "drivers": drivers,
        "alerts": alerts,
        "summary": {"open": open_count, "in_transit": transit_count, "online_drivers": online_count},
    }


@router.get("/admin/settings/stripe")
async def admin_get_stripe_settings(user: dict = Depends(get_admin_user)):
    return payments.get_status()


@router.post("/admin/settings/stripe")
async def admin_update_stripe_settings(body: StripeSettingsBody, user: dict = Depends(get_admin_user)):
    updates: dict = {}

    if body.test_secret_key:
        key = body.test_secret_key.strip()
        if not key.startswith("sk_test_"):
            raise HTTPException(400, "Test secret key must start with 'sk_test_'")
        ok, err = payments.validate_key(key)
        if not ok:
            raise HTTPException(400, f"Stripe rejected the test key: {err}")
        updates["test_secret_key"] = key

    if body.live_secret_key:
        key = body.live_secret_key.strip()
        if not key.startswith("sk_live_"):
            raise HTTPException(400, "Live secret key must start with 'sk_live_'")
        ok, err = payments.validate_key(key)
        if not ok:
            raise HTTPException(400, f"Stripe rejected the live key: {err}")
        updates["live_secret_key"] = key

    if body.webhook_secret is not None:
        updates["webhook_secret"] = body.webhook_secret.strip()

    mode = body.mode
    if mode and mode not in ("test", "live"):
        raise HTTPException(400, "mode must be 'test' or 'live'")

    new_test = updates.get("test_secret_key", payments.STRIPE_TEST_KEY)
    new_live = updates.get("live_secret_key", payments.STRIPE_LIVE_KEY)
    if mode == "live" and not new_live:
        raise HTTPException(400, "Add a live secret key before switching to LIVE mode")
    if mode == "test" and not new_test:
        raise HTTPException(400, "Add a test secret key before switching to TEST mode")

    payments.configure(
        test_key=updates.get("test_secret_key"),
        live_key=updates.get("live_secret_key"),
        mode=mode,
        webhook_secret=updates.get("webhook_secret"),
    )
    await _persist_stripe_settings(user.get("id"))
    return payments.get_status()


@router.get("/admin/fleet/companies")
async def admin_list_companies(
    search: Optional[str] = None,
    status: Optional[str] = None,
    user: dict = Depends(get_admin_user),
):
    query: dict = {}
    if status:
        query["status"] = status
    if search:
        query["company_name"] = {"$regex": re.escape(search), "$options": "i"}
    companies = [c async for c in db.companies.find(query, {"_id": 0}).sort("created_at", -1).limit(200)]
    out = []
    for c in companies:
        wallet = await db.company_wallets.find_one({"company_id": c["id"]}, {"_id": 0}) or {}
        owner = await db.drivers.find_one({"id": c["owner_driver_id"]}, {"_id": 0, "name": 1, "email": 1})
        out.append({
            **c,
            "owner_name": (owner or {}).get("name"),
            "owner_email": (owner or {}).get("email"),
            "driver_count": await db.drivers.count_documents({"company_id": c["id"]}),
            "vehicle_count": await db.fleet_vehicles.count_documents({"company_id": c["id"]}),
            "available_balance": round(float(wallet.get("available_balance", 0)), 2),
            "pending_balance": round(float(wallet.get("pending_balance", 0)), 2),
            "total_earnings": round(float(wallet.get("total_earnings", 0)), 2),
            "total_withdrawn": round(float(wallet.get("total_withdrawn", 0)), 2),
        })
    return {"items": out, "total": len(out)}


@router.get("/admin/fleet/companies/{company_id}")
async def admin_company_detail(company_id: str, user: dict = Depends(get_admin_user)):
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(404, "Company not found")
    wallet = await _get_or_create_company_wallet(company_id)
    drivers = [_public_driver(d) async for d in db.drivers.find({"company_id": company_id}, {"_id": 0})]
    drivers.sort(key=lambda d: (d.get("company_role") != "owner", (d.get("name") or "").lower()))
    vehicles = [v async for v in db.fleet_vehicles.find({"company_id": company_id}, {"_id": 0})]
    payouts = [
        p async for p in db.company_payouts.find({"company_id": company_id}, {"_id": 0})
        .sort("created_at", -1).limit(100)
    ]
    completed = await db.orders.count_documents({"assigned_company_id": company_id, "status": sm.DELIVERED})
    active = await db.orders.count_documents({"assigned_company_id": company_id, "status": {"$in": list(sm.ACTIVE_STATES)}})
    return {
        "company": company, "wallet": wallet, "drivers": drivers, "vehicles": vehicles,
        "payouts": payouts, "stats": {"completed_jobs": completed, "active_jobs": active},
    }


@router.post("/admin/fleet/companies/{company_id}/suspend")
async def admin_suspend_company(company_id: str, user: dict = Depends(get_admin_user)):
    res = await db.companies.update_one({"id": company_id}, {"$set": {"status": "suspended"}})
    if res.matched_count == 0:
        raise HTTPException(404, "Company not found")
    return {"success": True}


@router.post("/admin/fleet/companies/{company_id}/activate")
async def admin_activate_company(company_id: str, user: dict = Depends(get_admin_user)):
    res = await db.companies.update_one({"id": company_id}, {"$set": {"status": "active"}})
    if res.matched_count == 0:
        raise HTTPException(404, "Company not found")
    return {"success": True}


@router.get("/admin/fleet/payouts")
async def admin_list_company_payouts(
    status: Optional[str] = None,
    user: dict = Depends(get_admin_user),
):
    query: dict = {}
    if status:
        query["status"] = status
    payouts = [p async for p in db.company_payouts.find(query, {"_id": 0}).sort("created_at", -1).limit(300)]
    totals = {
        "pending": sum(1 for p in payouts if p["status"] == "pending"),
        "approved": sum(1 for p in payouts if p["status"] == "approved"),
        "paid_amount": round(sum(float(p["amount"]) for p in payouts if p["status"] == "paid"), 2),
    }
    return {"payouts": payouts, "totals": totals}


@router.post("/admin/fleet/payouts/{payout_id}/approve")
async def admin_approve_company_payout(payout_id: str, user: dict = Depends(get_admin_user)):
    p = await _get_company_payout(payout_id)
    if p["status"] != "pending":
        raise HTTPException(400, f"Cannot approve a {p['status']} payout")
    await db.company_payouts.update_one(
        {"id": payout_id},
        {"$set": {"status": "approved", "reviewed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"success": True}


@router.post("/admin/fleet/payouts/{payout_id}/pay")
async def admin_pay_company_payout(
    payout_id: str, body: PayoutRefRequest, user: dict = Depends(get_admin_user)
):
    p = await _get_company_payout(payout_id)
    if p["status"] not in ("approved", "pending"):
        raise HTTPException(400, f"Cannot pay a {p['status']} payout")
    amount = round(float(p["amount"]), 2)
    updates = {"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()}
    if body.reference:
        updates["reference"] = body.reference
    await db.company_payouts.update_one({"id": payout_id}, {"$set": updates})
    # Settle: remove from pending, add to total_withdrawn.
    await db.company_wallets.update_one(
        {"company_id": p["company_id"]},
        {"$inc": {"pending_balance": -amount, "total_withdrawn": amount},
         "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    await db.company_wallet_txns.insert_one(CompanyWalletTxn(
        company_id=p["company_id"], type="payout", amount=-amount,
        note=f"Payout {p.get('reference') or payout_id} paid",
    ).model_dump())
    return {"success": True}


@router.post("/admin/fleet/payouts/{payout_id}/reject")
async def admin_reject_company_payout(
    payout_id: str, body: PayoutReasonRequest, user: dict = Depends(get_admin_user)
):
    p = await _get_company_payout(payout_id)
    if p["status"] in ("paid", "rejected"):
        raise HTTPException(400, f"Cannot reject a {p['status']} payout")
    amount = round(float(p["amount"]), 2)
    await db.company_payouts.update_one(
        {"id": payout_id},
        {"$set": {"status": "rejected", "reviewed_at": datetime.now(timezone.utc).isoformat(),
                  "note": body.reason}},
    )
    # Refund the locked funds back to available.
    await db.company_wallets.update_one(
        {"company_id": p["company_id"]},
        {"$inc": {"pending_balance": -amount, "available_balance": amount},
         "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"success": True}
