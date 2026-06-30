"""Auto-extracted auth routes. Handler bodies are unchanged; shared names
(db, models, helpers, FastAPI symbols) are injected from the server module."""
from fastapi import APIRouter
import server as _srv

_g = globals()
for _k in dir(_srv):
    if not _k.startswith('__'):
        _g.setdefault(_k, getattr(_srv, _k))

router = APIRouter()


import time as _time

# --- Simple in-memory login throttle (per email). Mitigates brute force.
# NOTE: per-process only; for multi-worker prod use a shared store (Redis).
_LOGIN_MAX_ATTEMPTS = 5
_LOGIN_WINDOW_SECONDS = 300  # 5 minutes
_login_failures: dict = {}


def _throttle_key(email: str) -> str:
    return (email or "").strip().lower()


def _check_login_throttle(email: str):
    key = _throttle_key(email)
    now = _time.time()
    attempts = [t for t in _login_failures.get(key, []) if now - t < _LOGIN_WINDOW_SECONDS]
    _login_failures[key] = attempts
    if len(attempts) >= _LOGIN_MAX_ATTEMPTS:
        retry_in = int(_LOGIN_WINDOW_SECONDS - (now - attempts[0]))
        raise HTTPException(429, f"Too many failed attempts. Try again in {max(1, retry_in)}s.")


def _record_login_failure(email: str):
    key = _throttle_key(email)
    _login_failures.setdefault(key, []).append(_time.time())


def _reset_login_throttle(email: str):
    _login_failures.pop(_throttle_key(email), None)



@router.post("/auth/change-password", status_code=200)
async def change_password(
    body: ChangePasswordRequest,
    user: dict = Depends(get_current_user),
):
    """Authenticated password change for the current driver or shipper.

    Verifies the current password against the stored bcrypt hash, then rehashes
    and stores the new one. The collection is derived from the JWT role (never
    the request body) to avoid cross-account changes.
    """
    user_type = user.get("type")
    if user_type not in ("driver", "shipper"):
        raise HTTPException(403, "Password change not supported for this account")

    collection = db.drivers if user_type == "driver" else db.shippers
    record = await collection.find_one({"id": user["id"]})
    if not record:
        raise HTTPException(404, "User not found")

    stored = record.get("password_hash")
    if not stored or not verify_password(body.current_password, stored):
        raise HTTPException(400, "Current password is incorrect")

    if body.new_password == body.current_password:
        raise HTTPException(400, "New password must be different from the current one")

    new_hash = hash_password(body.new_password)
    await collection.update_one({"id": user["id"]}, {"$set": {"password_hash": new_hash}})
    logger.info(f"Password changed for {user_type}: {user['id']}")

    disp_name = record.get("name") or record.get("company_name") or "there"
    if record.get("email"):
        subj, html = email_tpl.password_changed(disp_name)
        send_email_bg(record["email"], subj, html, to_name=disp_name,
                      category="password_changed", related_id=user["id"])

    return {"status": "ok", "message": "Password updated successfully"}


@router.post("/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Login with email and password."""
    _check_login_throttle(request.email)
    driver = await db.drivers.find_one({"email": request.email}, {"_id": 0})
    if not driver:
        _record_login_failure(request.email)
        raise HTTPException(401, "Invalid email or password")
    
    if not driver.get("password_hash"):
        _record_login_failure(request.email)
        raise HTTPException(401, "Invalid email or password")
    
    if not verify_password(request.password, driver["password_hash"]):
        _record_login_failure(request.email)
        raise HTTPException(401, "Invalid email or password")

    if driver.get("is_suspended"):
        raise HTTPException(403, "This account has been suspended. Contact support.")

    _reset_login_throttle(request.email)
    token = create_token(driver["id"], "driver")
    
    logger.info(f"Driver logged in: {request.email}")
    
    return LoginResponse(
        token=token,
        driver_id=driver["id"],
        name=driver["name"],
        is_admin=False
    )


@router.post("/auth/admin-login", response_model=LoginResponse)
async def admin_login(request: AdminLoginRequest):
    """Admin login with hardcoded credentials."""
    _check_login_throttle(request.email)
    if request.email != ADMIN_EMAIL or request.password != ADMIN_PASSWORD:
        _record_login_failure(request.email)
        raise HTTPException(401, "Invalid admin credentials")

    _reset_login_throttle(request.email)
    token = create_token("admin", "admin")
    
    logger.info(f"Admin logged in: {request.email}")
    
    return LoginResponse(
        token=token,
        driver_id="admin",
        name="Admin",
        is_admin=True
    )


@router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Get current authenticated user info."""
    if user["type"] == "admin":
        return {"id": "admin", "type": "admin", "email": ADMIN_EMAIL, "name": "Admin"}
    if user["type"] == "shipper":
        return {"id": user["id"], "type": "shipper", "shipper": user["shipper"]}
    return {"id": user["id"], "type": "driver", "driver": user["driver"]}


@router.post("/auth/driver-register")
async def simple_driver_register(registration: SimpleDriverRegistration):
    """Simple driver registration endpoint."""
    # Check if email already exists
    existing = await db.drivers.find_one({"email": registration.email})
    if existing:
        raise HTTPException(400, "A driver with this email already exists")
    
    # Validate vehicle type
    vehicle_type = registration.vehicle_type or "cargo_van"
    if vehicle_type not in VEHICLE_TYPES:
        vehicle_type = "cargo_van"  # Fallback to cargo van
    
    driver_id = str(uuid.uuid4())
    password_hash = hash_password(registration.password)
    
    # Get vehicle info
    vehicle_info = VEHICLE_TYPES[vehicle_type]
    vehicle_label = vehicle_info["name"]
    
    # Use custom capacity if provided (for "other" type), otherwise use vehicle default
    if vehicle_type == "other" and registration.vehicle_capacity_kg:
        vehicle_capacity = registration.vehicle_capacity_kg
    else:
        vehicle_capacity = vehicle_info["max_weight_kg"]
    
    new_driver = Driver(
        id=driver_id,
        name=registration.name,
        rating=5.0,
        avatar="https://api.dicebear.com/7.x/avataaars/png?seed=" + driver_id,
        vehicle=f"{vehicle_label} • —",
        vehicle_type=vehicle_type,
        vehicle_capacity_kg=vehicle_capacity,
        plate="",
        email=registration.email,
        phone=registration.phone or "",
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
    
    token = create_token(driver_id, "driver")
    
    logger.info(f"Registered new driver: {registration.email} ({driver_id})")

    subj, html = email_tpl.welcome(registration.name, "driver")
    send_email_bg(registration.email, subj, html, to_name=registration.name,
                  category="driver_welcome", related_id=driver_id)

    return {
        "driver_id": driver_id,
        "name": registration.name,
        "message": "Registration successful! Please complete KYC verification.",
        "token": token,
        "kyc_required": True
    }


@router.post("/auth/shipper-register")
async def simple_shipper_register(registration: SimpleShipperRegistration):
    """Simple shipper/business registration endpoint."""
    # Check if email already exists
    existing = await db.shippers.find_one({"email": registration.email})
    if existing:
        raise HTTPException(400, "A business with this email already exists")
    
    # Validate preferred vehicle type if provided
    preferred_vehicle = registration.preferred_vehicle_type
    if preferred_vehicle and preferred_vehicle not in VEHICLE_TYPES:
        preferred_vehicle = None  # Reset to no preference if invalid
    
    shipper_id = str(uuid.uuid4())
    password_hash = hash_password(registration.password)
    
    new_shipper = Shipper(
        id=shipper_id,
        company_name=registration.business_name,
        contact_name=registration.business_name,
        email=registration.email,
        phone=registration.phone or "",
        password_hash=password_hash,
        avatar=f"https://api.dicebear.com/7.x/initials/png?seed={registration.business_name}",
        preferred_vehicle_type=preferred_vehicle,
    )
    
    await db.shippers.insert_one(new_shipper.model_dump())
    
    token = create_token(shipper_id, "shipper")
    
    logger.info(f"Registered new shipper: {registration.email} ({shipper_id})")

    subj, html = email_tpl.welcome(registration.business_name, "shipper")
    send_email_bg(registration.email, subj, html, to_name=registration.business_name,
                  category="shipper_welcome", related_id=shipper_id)

    return {
        "shipper_id": shipper_id,
        "business_name": registration.business_name,
        "token": token,
        "message": "Business registration successful!"
    }


@router.post("/auth/shipper-login")
async def shipper_login(request: LoginRequest):
    """Login for shippers/businesses."""
    _check_login_throttle(request.email)
    shipper = await db.shippers.find_one({"email": request.email}, {"_id": 0})
    if not shipper:
        _record_login_failure(request.email)
        raise HTTPException(401, "Invalid email or password")
    
    if not shipper.get("password_hash"):
        _record_login_failure(request.email)
        raise HTTPException(401, "Invalid email or password")
    
    if not verify_password(request.password, shipper["password_hash"]):
        _record_login_failure(request.email)
        raise HTTPException(401, "Invalid email or password")

    if shipper.get("is_suspended"):
        raise HTTPException(403, "This account has been suspended. Contact support.")

    _reset_login_throttle(request.email)
    
    token = create_token(shipper["id"], "shipper")
    
    logger.info(f"Shipper logged in: {request.email}")
    
    return LoginResponse(
        token=token,
        driver_id=shipper["id"],  # reusing field name for simplicity
        name=shipper["company_name"],
        is_admin=False
    )
