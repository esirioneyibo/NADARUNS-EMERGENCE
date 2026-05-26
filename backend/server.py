from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import httpx
import jwt
import bcrypt
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Tuple
import uuid
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

GOOGLE_DIRECTIONS_API_KEY = os.environ.get('GOOGLE_DIRECTIONS_API_KEY')

# JWT Configuration
JWT_SECRET = os.environ.get('JWT_SECRET', 'nadaruns-super-secret-key-change-in-production')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days

# Admin credentials (hardcoded for MVP)
ADMIN_EMAIL = "admin@nadaruns.com"
ADMIN_PASSWORD = "admin123"  # In production, use env variable

app = FastAPI()
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ===================== Auth Helpers =====================

def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against its hash."""
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))


def create_token(user_id: str, user_type: str = "driver") -> str:
    """Create a JWT token."""
    payload = {
        "sub": user_id,
        "type": user_type,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Dependency to get the current authenticated user."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    user_type = payload.get("type", "driver")
    
    if user_type == "admin":
        return {"id": user_id, "type": "admin", "email": ADMIN_EMAIL}
    
    if user_type == "shipper":
        shipper = await db.shippers.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
        if not shipper:
            raise HTTPException(401, "Shipper not found")
        return {"id": user_id, "type": "shipper", "shipper": shipper}
    
    driver = await db.drivers.find_one({"id": user_id}, {"_id": 0})
    if not driver:
        raise HTTPException(401, "User not found")
    
    return {"id": user_id, "type": "driver", "driver": driver}


async def get_current_driver(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Dependency to get the current authenticated driver."""
    user = await get_current_user(credentials)
    if user["type"] != "driver":
        raise HTTPException(403, "Driver access required")
    return user


async def get_admin_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Dependency to ensure admin access."""
    user = await get_current_user(credentials)
    if user["type"] != "admin":
        raise HTTPException(403, "Admin access required")
    return user


# ===================== Models =====================

OrderStatus = Literal[
    "pending", "accepted", "enroute_pickup", "arrived_pickup",
    "picked_up", "enroute_dropoff", "arrived_dropoff",
    "delivered", "rejected"
]

ADVANCE_FLOW = {
    "accepted": "enroute_pickup",
    "enroute_pickup": "arrived_pickup",
    "arrived_pickup": "picked_up",
    "picked_up": "enroute_dropoff",
    "enroute_dropoff": "arrived_dropoff",
    "arrived_dropoff": "delivered",
}


class GeoPoint(BaseModel):
    lat: float
    lng: float
    address: str
    name: Optional[str] = None


class OrderItem(BaseModel):
    name: str
    quantity: int
    note: Optional[str] = None


class Customer(BaseModel):
    name: str
    rating: float
    avatar: Optional[str] = None
    phone: Optional[str] = None
    apartment: Optional[str] = None
    gate_code: Optional[str] = None
    notes: Optional[str] = None


class Order(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    order_number: str
    status: OrderStatus = "pending"
    pickup: GeoPoint
    dropoff: GeoPoint
    customer: Customer
    items: List[OrderItem]
    distance_km: float
    eta_minutes: int
    earnings: float
    tip: float = 0.0
    pickup_otp: str = ""
    dropoff_otp: str = ""
    pickup_otp_verified: bool = False
    dropoff_otp_verified: bool = False
    pickup_photo: Optional[str] = None  # base64 data URI captured at pickup
    delivery_photo: Optional[str] = None  # base64 data URI captured at dropoff
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None
    rating_given: Optional[int] = None  # thumbs up/down: 1 or -1
    feedback: Optional[str] = None
    # Logistics fields
    shipper_id: Optional[str] = None  # FK to shipper who created the order
    driver_id: Optional[str] = None  # FK to assigned driver
    vehicle_type: Optional[str] = None  # Required vehicle type
    cargo_weight_kg: Optional[float] = None
    cargo_dimensions: Optional[str] = None  # LxWxH in cm
    cargo_type: Optional[str] = None  # general, fragile, hazardous, perishable, liquid
    special_requirements: Optional[List[str]] = None  # tail_lift, forklift, straps, refrigeration
    scheduled_pickup: Optional[str] = None  # ISO datetime for scheduled pickups
    price_quote: Optional[float] = None  # Quoted price for shipper
    shipper_notes: Optional[str] = None


# ===================== Logistics Vehicle Types =====================

VEHICLE_TYPES = {
    "sprinter_van": {
        "id": "sprinter_van",
        "name": "Sprinter Van",
        "icon": "🚐",
        "max_weight_kg": 1500,
        "description": "Small cargo, quick deliveries",
        "base_rate_per_km": 1.20,
    },
    "box_truck": {
        "id": "box_truck",
        "name": "Box Truck",
        "icon": "📦",
        "max_weight_kg": 5000,
        "description": "Medium cargo, palletized goods",
        "base_rate_per_km": 1.80,
    },
    "flatbed": {
        "id": "flatbed",
        "name": "Flatbed Truck",
        "icon": "🚚",
        "max_weight_kg": 15000,
        "description": "Heavy equipment, construction materials",
        "base_rate_per_km": 2.50,
    },
    "refrigerated": {
        "id": "refrigerated",
        "name": "Refrigerated Truck",
        "icon": "❄️",
        "max_weight_kg": 10000,
        "description": "Temperature controlled, perishables",
        "base_rate_per_km": 3.00,
    },
    "tanker": {
        "id": "tanker",
        "name": "Tanker",
        "icon": "🛢️",
        "max_weight_kg": 20000,
        "description": "Liquid cargo, chemicals",
        "base_rate_per_km": 3.50,
    },
    "container": {
        "id": "container",
        "name": "Container Truck",
        "icon": "📦",
        "max_weight_kg": 20000,
        "description": "20ft/40ft containers",
        "base_rate_per_km": 3.20,
    },
    "semi_trailer": {
        "id": "semi_trailer",
        "name": "Semi-Trailer",
        "icon": "🚜",
        "max_weight_kg": 25000,
        "description": "Heavy freight, long haul",
        "base_rate_per_km": 2.80,
    },
}

CARGO_TYPES = ["general", "fragile", "hazardous", "perishable", "liquid", "oversized"]

SPECIAL_REQUIREMENTS = ["tail_lift", "forklift", "straps", "refrigeration", "hazmat_certified", "covered_transport"]


# ===================== Shipper Models =====================

class Shipper(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_name: str
    contact_name: str
    email: str
    phone: str
    password_hash: Optional[str] = None
    tax_id: Optional[str] = None
    address: Optional[str] = None
    avatar: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    is_verified: bool = False
    total_shipments: int = 0
    rating: float = 5.0


class ShipperRegistration(BaseModel):
    company_name: str
    contact_name: str
    email: str
    phone: str
    password: str
    tax_id: Optional[str] = None
    address: Optional[str] = None


class ShipmentCreateRequest(BaseModel):
    # Pickup details
    pickup_address: str
    pickup_lat: float
    pickup_lng: float
    pickup_contact_name: str
    pickup_contact_phone: str
    pickup_notes: Optional[str] = None
    # Dropoff details
    dropoff_address: str
    dropoff_lat: float
    dropoff_lng: float
    dropoff_contact_name: str
    dropoff_contact_phone: str
    dropoff_notes: Optional[str] = None
    # Cargo details
    vehicle_type: str
    cargo_weight_kg: float
    cargo_dimensions: Optional[str] = None  # LxWxH
    cargo_type: str = "general"
    cargo_description: str
    special_requirements: Optional[List[str]] = None
    # Scheduling
    scheduled_pickup: Optional[str] = None  # ISO datetime, null for ASAP


class PriceQuoteRequest(BaseModel):
    pickup_lat: float
    pickup_lng: float
    dropoff_lat: float
    dropoff_lng: float
    vehicle_type: str
    cargo_weight_kg: float


class PriceQuoteResponse(BaseModel):
    distance_km: float
    estimated_duration_minutes: int
    base_price: float
    weight_surcharge: float
    total_price: float
    vehicle_type: str
    currency: str = "EUR"


class OtpRequest(BaseModel):
    otp: str
    kind: Literal["pickup", "dropoff"]


class PhotoRequest(BaseModel):
    photo: str  # base64 data URI


class WalletTransaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["delivery", "tip", "payout", "bonus"]
    amount: float
    description: str
    timestamp: str


class Wallet(BaseModel):
    available_balance: float
    pending_balance: float
    payout_schedule: str
    next_payout_date: str
    transactions: List[WalletTransaction]


class NotificationPrefs(BaseModel):
    push: bool = True
    sound: bool = True
    new_orders: bool = True
    earnings_summary: bool = True


class Driver(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    rating: float
    avatar: str
    vehicle: str
    vehicle_type: str = "bicycle"  # bicycle | scooter | car | motorbike
    plate: str = ""
    email: str = ""
    phone: str = ""
    password_hash: Optional[str] = None  # hashed password
    is_online: bool = False
    earnings_today: float = 0.0
    deliveries_today: int = 0
    acceptance_rate: float = 96.0
    notifications: NotificationPrefs = Field(default_factory=NotificationPrefs)


class DriverUpdate(BaseModel):
    name: Optional[str] = None
    vehicle: Optional[str] = None
    vehicle_type: Optional[str] = None
    plate: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notifications: Optional[NotificationPrefs] = None


class RoutePoint(BaseModel):
    lat: float
    lng: float


class DirectionsResponse(BaseModel):
    points: List[RoutePoint]
    distance_meters: int
    duration_seconds: int
    source: str  # "google" or "fallback"


class AdvanceRequest(BaseModel):
    next_status: Optional[OrderStatus] = None  # optional override


class RateRequest(BaseModel):
    rating: int  # 1 or -1
    feedback: Optional[str] = None


# ===================== KYC Models =====================

class KYCDocument(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    driver_id: str
    document_type: Literal["license_front", "license_back", "selfie"]
    image_data: str  # base64 data URI
    uploaded_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    status: Literal["pending", "approved", "rejected"] = "pending"
    rejection_reason: Optional[str] = None


class KYCStatus(BaseModel):
    driver_id: str
    license_front: Optional[str] = None  # "pending" | "approved" | "rejected" | None
    license_back: Optional[str] = None
    selfie: Optional[str] = None
    overall_status: Literal["incomplete", "pending", "approved", "rejected"] = "incomplete"
    submitted_at: Optional[str] = None
    reviewed_at: Optional[str] = None


class KYCUploadRequest(BaseModel):
    document_type: Literal["license_front", "license_back", "selfie"]
    image_data: str  # base64 data URI


class KYCSubmitRequest(BaseModel):
    license_front: str  # base64 data URI
    license_back: str
    selfie: str


# ===================== Registration Models =====================

class DriverRegistration(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str
    password: str  # plain password, will be hashed
    vehicle_type: Literal["bicycle", "scooter", "motorbike", "car"]
    city: str
    license_plate: Optional[str] = None


class RegistrationResponse(BaseModel):
    driver_id: str
    message: str
    token: str  # JWT token
    kyc_required: bool = True


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    token: str
    driver_id: str
    name: str
    is_admin: bool = False


class AdminLoginRequest(BaseModel):
    email: str
    password: str


# ===================== Seed Data =====================

DRIVER_ID = "driver-001"
SEED_VERSION = 7  # bump to force re-seed (fresh order data)

SEED_DRIVER = {
    "id": DRIVER_ID,
    "name": "Eero Virtanen",
    "rating": 4.92,
    "avatar": "https://images.unsplash.com/photo-1551825687-f9de1603ed8b?crop=entropy&cs=srgb&fm=jpg&w=400&q=80",
    "vehicle": "Bicycle • Black",
    "vehicle_type": "bicycle",
    "plate": "HKI-2841",
    "email": "eero.virtanen@driver.app",
    "phone": "+358 41 911 4422",
    "is_online": False,
    "earnings_today": 0.0,
    "deliveries_today": 0,
    "acceptance_rate": 96.0,
    "notifications": {"push": True, "sound": True, "new_orders": True, "earnings_summary": True},
}

RESTAURANTS = [
    {"name": "Karl Fazer Café", "address": "3 Kluuvikatu, Helsinki", "lat": 60.1696, "lng": 24.9442},
    {"name": "Pizzeria Forza", "address": "12 Kolmas Linja, Helsinki", "lat": 60.1822, "lng": 24.9498},
    {"name": "Café Esplanad", "address": "37 Pohjoisesplanadi, Helsinki", "lat": 60.1683, "lng": 24.9460},
    {"name": "Sushibar Punavuori", "address": "21 Iso Roobertinkatu, Helsinki", "lat": 60.1620, "lng": 24.9385},
    {"name": "Hesburger Kamppi", "address": "1 Urho Kekkosen katu, Helsinki", "lat": 60.1690, "lng": 24.9320},
]

CUSTOMERS = [
    {"name": "Aino K.", "rating": 4.8, "phone": "+358 41 123 4567"},
    {"name": "Onni L.", "rating": 4.6, "phone": "+358 41 234 5678"},
    {"name": "Liisa N.", "rating": 5.0, "phone": "+358 41 345 6789"},
    {"name": "Mikko B.", "rating": 4.4, "phone": "+358 41 456 7890"},
    {"name": "Sanna R.", "rating": 4.9, "phone": "+358 41 567 8901"},
]

DROPOFFS = [
    {"address": "15 Mannerheimintie, Helsinki", "lat": 60.1729, "lng": 24.9356, "apt": "Apt 4B"},
    {"address": "92 Hämeentie, Helsinki", "lat": 60.1872, "lng": 24.9543, "apt": "Apt 12"},
    {"address": "5 Bulevardi, Helsinki", "lat": 60.1645, "lng": 24.9395, "apt": "Apt 2A"},
    {"address": "33 Aleksanterinkatu, Helsinki", "lat": 60.1685, "lng": 24.9410, "apt": "Apt 7"},
    {"address": "18 Fredrikinkatu, Helsinki", "lat": 60.1655, "lng": 24.9320, "apt": "Apt 3C"},
]

ITEM_SETS = [
    [{"name": "Korvapuusti", "quantity": 2}, {"name": "Cappuccino", "quantity": 1}],
    [{"name": "Margherita Pizza", "quantity": 1}, {"name": "Caesar Salad", "quantity": 1}],
    [{"name": "Salmon Soup", "quantity": 1}, {"name": "Rye Bread", "quantity": 1}, {"name": "Sparkling Water", "quantity": 2}],
    [{"name": "Rainbow Maki", "quantity": 2}, {"name": "Edamame", "quantity": 1}],
    [{"name": "Megamaster Burger", "quantity": 1}, {"name": "Fries", "quantity": 1}, {"name": "Kotijuoma", "quantity": 1}],
]

NOTES = ["Please knock softly", "Leave at door", "Ring buzzer 3 times", "No contact please", None]


def build_order(status: OrderStatus = "pending", completed_offset_hours: Optional[int] = None) -> dict:
    idx = random.randint(0, 4)
    r = RESTAURANTS[idx]
    c = CUSTOMERS[idx]
    d = DROPOFFS[idx]
    items = ITEM_SETS[idx]
    distance = round(random.uniform(1.4, 5.2), 1)
    eta = int(distance * 4) + random.randint(3, 8)
    earnings = round(random.uniform(8.5, 22.5), 2)
    tip = round(random.uniform(0, 4.5), 2)
    created = datetime.now(timezone.utc)
    completed = None
    if completed_offset_hours is not None:
        created = created - timedelta(hours=completed_offset_hours, minutes=random.randint(10, 50))
        completed = (created + timedelta(minutes=random.randint(18, 45))).isoformat()
    order = Order(
        order_number=f"#{random.choice(['A','B','C','D'])}{random.randint(100,999)}{random.choice(['X','Y','Z','K'])}",
        status=status,
        pickup=GeoPoint(lat=r["lat"], lng=r["lng"], address=r["address"], name=r["name"]),
        dropoff=GeoPoint(lat=d["lat"], lng=d["lng"], address=d["address"], name=c["name"]),
        customer=Customer(
            name=c["name"], rating=c["rating"], phone=c["phone"],
            apartment=d["apt"], gate_code=str(random.randint(1000, 9999)),
            notes=random.choice(NOTES),
        ),
        items=[OrderItem(**i) for i in items],
        distance_km=distance,
        eta_minutes=eta,
        earnings=earnings,
        tip=tip,
        pickup_otp=f"{random.randint(1000, 9999)}",
        dropoff_otp=f"{random.randint(1000, 9999)}",
        pickup_otp_verified=(status not in ("pending", "rejected", "accepted", "enroute_pickup", "arrived_pickup")),
        dropoff_otp_verified=(status == "delivered"),
        created_at=created.isoformat(),
        completed_at=completed,
        rating_given=random.choice([1, 1, 1, -1]) if completed else None,
    ).model_dump()
    return order


async def ensure_seed():
    # Detect a seed version bump (e.g., locale change Stockholm → Helsinki) and wipe stale data
    meta = await db.meta.find_one({"_id": "seed"})
    current_version = (meta or {}).get("version", 0)
    if current_version < SEED_VERSION:
        logger.info("Seed version bump %s -> %s: wiping orders + driver", current_version, SEED_VERSION)
        await db.orders.delete_many({})
        await db.drivers.delete_many({})
        await db.meta.update_one({"_id": "seed"}, {"$set": {"version": SEED_VERSION}}, upsert=True)

    driver = await db.drivers.find_one({"id": DRIVER_ID}, {"_id": 0})
    if not driver:
        await db.drivers.insert_one(SEED_DRIVER.copy())
        logger.info("Seeded driver")
    else:
        # Migrate missing fields into existing driver doc
        missing = {k: v for k, v in SEED_DRIVER.items() if k not in driver or driver.get(k) in (None, "")}
        # Don't overwrite live numeric state
        for k in ("is_online", "earnings_today", "deliveries_today", "acceptance_rate", "rating"):
            missing.pop(k, None)
        if missing:
            await db.drivers.update_one({"id": DRIVER_ID}, {"$set": missing})
            logger.info("Migrated driver fields: %s", list(missing.keys()))

    pending = await db.orders.find_one({"status": "pending"}, {"_id": 0})
    if not pending:
        await db.orders.insert_one(build_order("pending"))
        logger.info("Seeded pending order")

    # Migrate any orders missing OTPs (added in a later version)
    missing_otp = await db.orders.update_many(
        {"$or": [{"pickup_otp": {"$exists": False}}, {"pickup_otp": ""}]},
        [{"$set": {
            "pickup_otp": {"$toString": {"$floor": {"$add": [1000, {"$multiply": [{"$rand": {}}, 9000]}]}}},
            "dropoff_otp": {"$toString": {"$floor": {"$add": [1000, {"$multiply": [{"$rand": {}}, 9000]}]}}},
            "pickup_otp_verified": {"$ifNull": ["$pickup_otp_verified", False]},
            "dropoff_otp_verified": {"$ifNull": ["$dropoff_otp_verified", False]},
        }}],
    )
    if missing_otp.modified_count:
        logger.info("Migrated %d orders with OTPs", missing_otp.modified_count)

    # Ensure delivery_photo field exists on all orders
    await db.orders.update_many(
        {"delivery_photo": {"$exists": False}},
        {"$set": {"delivery_photo": None}},
    )

    history_count = await db.orders.count_documents({"status": "delivered"})
    if history_count < 6:
        for i in range(8):
            await db.orders.insert_one(build_order("delivered", completed_offset_hours=i * 6 + random.randint(1, 5)))
        logger.info("Seeded delivery history")


# ===================== Routes =====================

@api_router.get("/")
async def root():
    return {"message": "Driver delivery API"}


@api_router.get("/driver/me", response_model=Driver)
async def get_driver():
    driver = await db.drivers.find_one({"id": DRIVER_ID}, {"_id": 0})
    if not driver:
        await ensure_seed()
        driver = await db.drivers.find_one({"id": DRIVER_ID}, {"_id": 0})
    return Driver(**driver)


@api_router.post("/driver/toggle-online", response_model=Driver)
async def toggle_online():
    driver = await db.drivers.find_one({"id": DRIVER_ID}, {"_id": 0})
    new_state = not driver["is_online"]
    await db.drivers.update_one({"id": DRIVER_ID}, {"$set": {"is_online": new_state}})
    driver["is_online"] = new_state
    return Driver(**driver)


@api_router.get("/orders/pending", response_model=Optional[Order])
async def get_pending():
    order = await db.orders.find_one({"status": "pending"}, {"_id": 0})
    if not order:
        return None
    return Order(**order)


@api_router.get("/orders/active", response_model=Optional[Order])
async def get_active():
    active_statuses = ["accepted", "enroute_pickup", "arrived_pickup", "picked_up", "enroute_dropoff", "arrived_dropoff"]
    order = await db.orders.find_one({"status": {"$in": active_statuses}}, {"_id": 0})
    if not order:
        return None
    return Order(**order)


@api_router.get("/orders/history", response_model=List[Order])
async def get_history():
    cursor = db.orders.find({"status": "delivered"}, {"_id": 0}).sort("completed_at", -1).limit(50)
    items = await cursor.to_list(50)
    return [Order(**o) for o in items]


@api_router.post("/orders/{order_id}/accept", response_model=Order)
async def accept_order(order_id: str):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] != "pending":
        raise HTTPException(400, "Order not in pending state")
    await db.orders.update_one({"id": order_id}, {"$set": {"status": "accepted"}})
    order["status"] = "accepted"
    return Order(**order)


@api_router.post("/orders/{order_id}/reject", response_model=Order)
async def reject_order(order_id: str):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    await db.orders.update_one({"id": order_id}, {"$set": {"status": "rejected"}})
    # generate a fresh pending order so the demo continues
    await db.orders.insert_one(build_order("pending"))
    order["status"] = "rejected"
    return Order(**order)


@api_router.post("/orders/{order_id}/advance", response_model=Order)
async def advance_order(order_id: str, body: AdvanceRequest):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    current = order["status"]
    next_status = body.next_status or ADVANCE_FLOW.get(current)
    if not next_status:
        raise HTTPException(400, f"Cannot advance from {current}")
    update: dict = {"status": next_status}
    if next_status == "delivered":
        update["completed_at"] = datetime.now(timezone.utc).isoformat()
        # increment driver earnings & deliveries
        await db.drivers.update_one(
            {"id": DRIVER_ID},
            {"$inc": {"earnings_today": order["earnings"] + order.get("tip", 0), "deliveries_today": 1}},
        )
        # seed a fresh pending request to keep the demo flowing
        await db.orders.insert_one(build_order("pending"))
    await db.orders.update_one({"id": order_id}, {"$set": update})
    order.update(update)
    return Order(**order)


@api_router.post("/orders/{order_id}/rate", response_model=Order)
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


@api_router.post("/orders/{order_id}/verify-otp", response_model=Order)
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


@api_router.post("/orders/{order_id}/photo", response_model=Order)
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


@api_router.post("/orders/{order_id}/pickup-photo", response_model=Order)
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
async def get_wallet():
    history = await db.orders.find({"status": "delivered"}, {"_id": 0}).sort("completed_at", -1).limit(40).to_list(40)
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

    # Add a fake recent payout
    payout_ts = (now - timedelta(days=3)).isoformat()
    txns.append(WalletTransaction(
        type="payout",
        amount=-min(available * 0.6, 240.0) if available > 0 else -120.0,
        description="Weekly payout to **** 4422",
        timestamp=payout_ts,
    ).model_dump())

    txns.sort(key=lambda t: t["timestamp"], reverse=True)
    next_payout = (now + timedelta(days=(7 - now.weekday()) % 7 or 7)).date().isoformat()

    return Wallet(
        available_balance=round(available, 2),
        pending_balance=round(pending, 2),
        payout_schedule="Weekly • Mondays",
        next_payout_date=next_payout,
        transactions=[WalletTransaction(**t) for t in txns],
    )


@api_router.post("/orders/seed-new-pending", response_model=Order)
async def seed_new_pending():
    # remove existing pending then create one
    await db.orders.delete_many({"status": "pending"})
    new_order = build_order("pending")
    await db.orders.insert_one(new_order.copy())
    return Order(**new_order)


# ===================== Driver Update =====================

@api_router.patch("/driver/me", response_model=Driver)
async def update_driver(update: DriverUpdate):
    payload = {k: v for k, v in update.model_dump(exclude_unset=True).items() if v is not None}
    if payload.get("notifications") is not None:
        payload["notifications"] = update.notifications.model_dump()
    if payload:
        await db.drivers.update_one({"id": DRIVER_ID}, {"$set": payload})
    driver = await db.drivers.find_one({"id": DRIVER_ID}, {"_id": 0})
    return Driver(**driver)


# ===================== Driver Registration =====================

@api_router.post("/driver/register", response_model=RegistrationResponse)
async def register_driver(registration: DriverRegistration):
    """Register a new driver account."""
    # Check if email already exists
    existing = await db.drivers.find_one({"email": registration.email})
    if existing:
        raise HTTPException(400, "A driver with this email already exists")
    
    # Create new driver
    driver_id = str(uuid.uuid4())
    vehicle_labels = {
        "bicycle": "Bicycle",
        "scooter": "Scooter",
        "motorbike": "Motorbike",
        "car": "Car"
    }
    vehicle_label = vehicle_labels.get(registration.vehicle_type, "Bicycle")
    
    # Hash the password
    password_hash = hash_password(registration.password)
    
    new_driver = Driver(
        id=driver_id,
        name=f"{registration.first_name} {registration.last_name}",
        rating=5.0,  # New drivers start with 5.0
        avatar="https://api.dicebear.com/7.x/avataaars/png?seed=" + driver_id,
        vehicle=f"{vehicle_label} • {registration.license_plate or '—'}",
        vehicle_type=registration.vehicle_type,
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
    
    # Generate JWT token
    token = create_token(driver_id, "driver")
    
    logger.info(f"Registered new driver: {registration.email} ({driver_id})")
    
    return RegistrationResponse(
        driver_id=driver_id,
        message="Registration successful! Please complete KYC verification to start delivering.",
        token=token,
        kyc_required=True
    )


# ===================== Authentication Endpoints =====================

@api_router.post("/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Login with email and password."""
    driver = await db.drivers.find_one({"email": request.email}, {"_id": 0})
    if not driver:
        raise HTTPException(401, "Invalid email or password")
    
    if not driver.get("password_hash"):
        raise HTTPException(401, "Invalid email or password")
    
    if not verify_password(request.password, driver["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    
    token = create_token(driver["id"], "driver")
    
    logger.info(f"Driver logged in: {request.email}")
    
    return LoginResponse(
        token=token,
        driver_id=driver["id"],
        name=driver["name"],
        is_admin=False
    )


@api_router.post("/auth/admin-login", response_model=LoginResponse)
async def admin_login(request: AdminLoginRequest):
    """Admin login with hardcoded credentials."""
    if request.email != ADMIN_EMAIL or request.password != ADMIN_PASSWORD:
        raise HTTPException(401, "Invalid admin credentials")
    
    token = create_token("admin", "admin")
    
    logger.info(f"Admin logged in: {request.email}")
    
    return LoginResponse(
        token=token,
        driver_id="admin",
        name="Admin",
        is_admin=True
    )


@api_router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Get current authenticated user info."""
    if user["type"] == "admin":
        return {"id": "admin", "type": "admin", "email": ADMIN_EMAIL, "name": "Admin"}
    if user["type"] == "shipper":
        return {"id": user["id"], "type": "shipper", "shipper": user["shipper"]}
    return {"id": user["id"], "type": "driver", "driver": user["driver"]}


# ===================== Shipper Registration & Auth =====================

class SimpleDriverRegistration(BaseModel):
    name: str
    email: str
    password: str
    phone: Optional[str] = None


class SimpleShipperRegistration(BaseModel):
    business_name: str
    email: str
    password: str
    phone: Optional[str] = None


@api_router.post("/auth/driver-register")
async def simple_driver_register(registration: SimpleDriverRegistration):
    """Simple driver registration endpoint."""
    # Check if email already exists
    existing = await db.drivers.find_one({"email": registration.email})
    if existing:
        raise HTTPException(400, "A driver with this email already exists")
    
    driver_id = str(uuid.uuid4())
    password_hash = hash_password(registration.password)
    
    new_driver = Driver(
        id=driver_id,
        name=registration.name,
        rating=5.0,
        avatar="https://api.dicebear.com/7.x/avataaars/png?seed=" + driver_id,
        vehicle="Bicycle • —",
        vehicle_type="bicycle",
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
    
    return {
        "driver_id": driver_id,
        "name": registration.name,
        "message": "Registration successful! Please complete KYC verification.",
        "token": token,
        "kyc_required": True
    }


@api_router.post("/auth/shipper-register")
async def simple_shipper_register(registration: SimpleShipperRegistration):
    """Simple shipper/business registration endpoint."""
    # Check if email already exists
    existing = await db.shippers.find_one({"email": registration.email})
    if existing:
        raise HTTPException(400, "A business with this email already exists")
    
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
    )
    
    await db.shippers.insert_one(new_shipper.model_dump())
    
    token = create_token(shipper_id, "shipper")
    
    logger.info(f"Registered new shipper: {registration.email} ({shipper_id})")
    
    return {
        "shipper_id": shipper_id,
        "business_name": registration.business_name,
        "token": token,
        "message": "Business registration successful!"
    }


@api_router.post("/shipper/register")
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
    
    return {
        "shipper_id": shipper_id,
        "token": token,
        "message": "Business registration successful!"
    }


@api_router.post("/auth/shipper-login")
async def shipper_login(request: LoginRequest):
    """Login for shippers/businesses."""
    shipper = await db.shippers.find_one({"email": request.email}, {"_id": 0})
    if not shipper:
        raise HTTPException(401, "Invalid email or password")
    
    if not shipper.get("password_hash"):
        raise HTTPException(401, "Invalid email or password")
    
    if not verify_password(request.password, shipper["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    
    token = create_token(shipper["id"], "shipper")
    
    logger.info(f"Shipper logged in: {request.email}")
    
    return LoginResponse(
        token=token,
        driver_id=shipper["id"],  # reusing field name for simplicity
        name=shipper["company_name"],
        is_admin=False
    )


# ===================== Shipper Profile =====================

@api_router.get("/shipper/me")
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


# ===================== Shipper Orders (Shipments) =====================

@api_router.get("/shipper/vehicle-types")
async def get_vehicle_types():
    """Get available vehicle types for shipping."""
    return list(VEHICLE_TYPES.values())


@api_router.post("/shipper/quote", response_model=PriceQuoteResponse)
async def get_price_quote(request: PriceQuoteRequest):
    """Get a price quote for a shipment."""
    # Calculate distance
    distance_km = _haversine_km(
        request.pickup_lat, request.pickup_lng,
        request.dropoff_lat, request.dropoff_lng
    )
    
    # Get vehicle rate
    vehicle = VEHICLE_TYPES.get(request.vehicle_type)
    if not vehicle:
        raise HTTPException(400, f"Invalid vehicle type: {request.vehicle_type}")
    
    # Calculate price
    base_rate = vehicle["base_rate_per_km"]
    base_price = distance_km * base_rate
    
    # Weight surcharge (€0.01 per kg over 500kg)
    weight_surcharge = max(0, (request.cargo_weight_kg - 500) * 0.01)
    
    # Minimum price
    total_price = max(15.0, base_price + weight_surcharge)
    
    # Estimate duration (average 60 km/h for trucks)
    estimated_duration = int(distance_km / 60 * 60)  # minutes
    
    return PriceQuoteResponse(
        distance_km=round(distance_km, 2),
        estimated_duration_minutes=max(30, estimated_duration),
        base_price=round(base_price, 2),
        weight_surcharge=round(weight_surcharge, 2),
        total_price=round(total_price, 2),
        vehicle_type=request.vehicle_type,
    )


@api_router.post("/shipper/shipments")
async def create_shipment(
    request: ShipmentCreateRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Create a new shipment order."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "shipper":
        raise HTTPException(403, "Shipper access required")
    
    shipper_id = payload["sub"]
    shipper = await db.shippers.find_one({"id": shipper_id}, {"_id": 0})
    if not shipper:
        raise HTTPException(404, "Shipper not found")
    
    # Validate vehicle type
    vehicle = VEHICLE_TYPES.get(request.vehicle_type)
    if not vehicle:
        raise HTTPException(400, f"Invalid vehicle type: {request.vehicle_type}")
    
    # Check weight capacity
    if request.cargo_weight_kg > vehicle["max_weight_kg"]:
        raise HTTPException(400, f"Cargo weight exceeds vehicle capacity ({vehicle['max_weight_kg']} kg)")
    
    # Calculate distance and price
    distance_km = _haversine_km(
        request.pickup_lat, request.pickup_lng,
        request.dropoff_lat, request.dropoff_lng
    )
    
    base_price = distance_km * vehicle["base_rate_per_km"]
    weight_surcharge = max(0, (request.cargo_weight_kg - 500) * 0.01)
    total_price = max(15.0, base_price + weight_surcharge)
    
    # Generate order
    order_id = str(uuid.uuid4())
    order_number = f"SHP-{random.randint(1000, 9999)}"
    
    # Create OTPs
    pickup_otp = str(random.randint(1000, 9999))
    dropoff_otp = str(random.randint(1000, 9999))
    
    # Driver earnings (80% of price)
    driver_earnings = total_price * 0.80
    
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
        distance_km=round(distance_km, 2),
        eta_minutes=max(30, int(distance_km / 60 * 60)),
        earnings=round(driver_earnings, 2),
        tip=0.0,
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
    
    return {
        "order_id": order_id,
        "order_number": order_number,
        "status": "pending",
        "pickup_otp": pickup_otp,
        "dropoff_otp": dropoff_otp,
        "price": total_price,
        "distance_km": round(distance_km, 2),
        "estimated_duration_minutes": new_order.eta_minutes,
        "message": "Shipment created successfully! Waiting for driver assignment."
    }


@api_router.get("/shipper/shipments")
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


@api_router.get("/shipper/shipments/{order_id}")
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


@api_router.post("/shipper/shipments/{order_id}/cancel")
async def cancel_shipment(
    order_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Cancel a shipment (only if not yet picked up)."""
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
    
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"status": "rejected", "completed_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    logger.info(f"Shipper {shipper_id} cancelled shipment {order_id}")
    
    return {"message": "Shipment cancelled successfully"}


@api_router.get("/shipper/shipments/{order_id}/tracking")
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


# ===================== KYC Endpoints =====================

@api_router.get("/driver/kyc-status", response_model=KYCStatus)
async def get_kyc_status():
    """Get the current driver's KYC verification status."""
    status = await db.kyc_status.find_one({"driver_id": DRIVER_ID}, {"_id": 0})
    if not status:
        # Initialize if not exists
        status = {
            "driver_id": DRIVER_ID,
            "license_front": None,
            "license_back": None,
            "selfie": None,
            "overall_status": "incomplete",
            "submitted_at": None,
            "reviewed_at": None,
        }
        await db.kyc_status.insert_one(status.copy())
    return KYCStatus(**status)


@api_router.post("/driver/kyc/upload", response_model=KYCStatus)
async def upload_kyc_document(request: KYCUploadRequest):
    """Upload a single KYC document."""
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
        driver_id=DRIVER_ID,
        document_type=request.document_type,
        image_data=image_data,
        status="pending"
    )
    
    # Upsert - replace if exists
    await db.kyc_documents.update_one(
        {"driver_id": DRIVER_ID, "document_type": request.document_type},
        {"$set": doc.model_dump()},
        upsert=True
    )
    
    # Update KYC status
    await db.kyc_status.update_one(
        {"driver_id": DRIVER_ID},
        {"$set": {request.document_type: "pending"}},
        upsert=True
    )
    
    # Check if all documents uploaded
    status = await db.kyc_status.find_one({"driver_id": DRIVER_ID}, {"_id": 0})
    if not status:
        status = {"driver_id": DRIVER_ID, "overall_status": "incomplete"}
    
    # Update overall status
    all_uploaded = all([
        status.get("license_front") is not None,
        status.get("license_back") is not None,
        status.get("selfie") is not None,
    ])
    
    if all_uploaded:
        await db.kyc_status.update_one(
            {"driver_id": DRIVER_ID},
            {"$set": {"overall_status": "pending", "submitted_at": datetime.now(timezone.utc).isoformat()}}
        )
    
    updated_status = await db.kyc_status.find_one({"driver_id": DRIVER_ID}, {"_id": 0})
    return KYCStatus(**updated_status)


@api_router.post("/driver/kyc/submit", response_model=KYCStatus)
async def submit_kyc_documents(request: KYCSubmitRequest):
    """Submit all KYC documents at once."""
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
            driver_id=DRIVER_ID,
            document_type=doc_type,
            image_data=image,
            status="pending"
        )
        
        await db.kyc_documents.update_one(
            {"driver_id": DRIVER_ID, "document_type": doc_type},
            {"$set": doc.model_dump()},
            upsert=True
        )
    
    # Update KYC status to pending review
    now = datetime.now(timezone.utc).isoformat()
    await db.kyc_status.update_one(
        {"driver_id": DRIVER_ID},
        {"$set": {
            "license_front": "pending",
            "license_back": "pending",
            "selfie": "pending",
            "overall_status": "pending",
            "submitted_at": now,
        }},
        upsert=True
    )
    
    logger.info(f"KYC documents submitted for driver {DRIVER_ID}")
    
    status = await db.kyc_status.find_one({"driver_id": DRIVER_ID}, {"_id": 0})
    return KYCStatus(**status)


@api_router.post("/driver/kyc/simulate-approval", response_model=KYCStatus)
async def simulate_kyc_approval():
    """Simulate KYC approval (for testing/demo purposes)."""
    now = datetime.now(timezone.utc).isoformat()
    await db.kyc_status.update_one(
        {"driver_id": DRIVER_ID},
        {"$set": {
            "license_front": "approved",
            "license_back": "approved",
            "selfie": "approved",
            "overall_status": "approved",
            "reviewed_at": now,
        }}
    )
    
    # Update documents status
    await db.kyc_documents.update_many(
        {"driver_id": DRIVER_ID},
        {"$set": {"status": "approved"}}
    )
    
    logger.info(f"KYC approved for driver {DRIVER_ID}")
    
    status = await db.kyc_status.find_one({"driver_id": DRIVER_ID}, {"_id": 0})
    return KYCStatus(**status)


# ===================== Directions =====================

def decode_polyline(polyline_str: str) -> List[Tuple[float, float]]:
    """Decode Google encoded polyline algorithm into list of (lat, lng)."""
    index = 0
    lat = 0
    lng = 0
    coordinates: List[Tuple[float, float]] = []
    while index < len(polyline_str):
        result = 0
        shift = 0
        while True:
            b = ord(polyline_str[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        delta_lat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += delta_lat
        result = 0
        shift = 0
        while True:
            b = ord(polyline_str[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        delta_lng = ~(result >> 1) if (result & 1) else (result >> 1)
        lng += delta_lng
        coordinates.append((lat / 1e5, lng / 1e5))
    return coordinates


def _haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    import math
    R = 6371.0
    dlat = math.radians(b_lat - a_lat)
    dlng = math.radians(b_lng - a_lng)
    h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


@api_router.get("/orders/{order_id}/route", response_model=DirectionsResponse)
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
                        "mode": "bicycling",
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


# ===================== Admin Endpoints =====================

@api_router.get("/admin/kyc-applications")
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


@api_router.post("/admin/kyc/{driver_id}/approve")
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
    
    return {"message": "KYC approved successfully"}


@api_router.post("/admin/kyc/{driver_id}/reject")
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
    
    return {"message": "KYC rejected"}


@api_router.get("/admin/stats")
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


@api_router.get("/admin/drivers")
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


@api_router.get("/admin/shippers")
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


# ===================== Admin Dashboard HTML =====================

ADMIN_DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NadaRuns Admin - KYC Review</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #f8fafc; min-height: 100vh; }
        .header { background: #1c1c1e; padding: 1rem 2rem; border-bottom: 1px solid #2d2d30; display: flex; justify-content: space-between; align-items: center; }
        .logo { color: #1bb5a0; font-size: 1.5rem; font-weight: 800; }
        .logout-btn { background: #ef4444; color: white; border: none; padding: 0.5rem 1rem; border-radius: 8px; cursor: pointer; font-weight: 600; }
        .login-container { display: flex; justify-content: center; align-items: center; min-height: calc(100vh - 80px); padding: 2rem; }
        .login-box { background: #1c1c1e; padding: 2rem; border-radius: 16px; width: 100%; max-width: 400px; }
        .login-box h2 { margin-bottom: 1.5rem; text-align: center; color: #1bb5a0; }
        .form-group { margin-bottom: 1rem; }
        .form-group label { display: block; margin-bottom: 0.5rem; color: #94a3b8; font-size: 0.875rem; }
        .form-group input { width: 100%; padding: 0.75rem 1rem; background: #26262a; border: 1px solid #2d2d30; border-radius: 8px; color: #f8fafc; font-size: 1rem; }
        .form-group input:focus { outline: none; border-color: #1bb5a0; }
        .login-btn { width: 100%; padding: 0.875rem; background: #1bb5a0; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; margin-top: 1rem; }
        .login-btn:hover { background: #22d3b8; }
        .error-msg { color: #ef4444; text-align: center; margin-top: 1rem; font-size: 0.875rem; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .page-title { font-size: 1.5rem; font-weight: 700; margin-bottom: 1.5rem; }
        .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .stat-card { background: #1c1c1e; padding: 1.25rem; border-radius: 12px; }
        .stat-value { font-size: 2rem; font-weight: 800; color: #1bb5a0; }
        .stat-label { color: #94a3b8; font-size: 0.875rem; margin-top: 0.25rem; }
        .applications-list { display: flex; flex-direction: column; gap: 1rem; }
        .app-card { background: #1c1c1e; border-radius: 16px; overflow: hidden; }
        .app-header { padding: 1.25rem; border-bottom: 1px solid #2d2d30; display: flex; justify-content: space-between; align-items: center; }
        .driver-info { display: flex; align-items: center; gap: 1rem; }
        .driver-avatar { width: 48px; height: 48px; border-radius: 50%; background: #26262a; }
        .driver-name { font-weight: 700; }
        .driver-email { color: #94a3b8; font-size: 0.875rem; }
        .status-badge { padding: 0.375rem 0.75rem; border-radius: 100px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; }
        .status-pending { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
        .status-approved { background: rgba(52, 211, 153, 0.2); color: #34d399; }
        .status-rejected { background: rgba(248, 113, 113, 0.2); color: #f87171; }
        .status-incomplete { background: rgba(148, 163, 184, 0.2); color: #94a3b8; }
        .docs-grid { padding: 1.25rem; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
        .doc-item { text-align: center; }
        .doc-preview { width: 100%; aspect-ratio: 4/3; background: #26262a; border-radius: 8px; overflow: hidden; margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .doc-preview img { width: 100%; height: 100%; object-fit: cover; }
        .doc-preview.empty { color: #64748b; font-size: 0.875rem; }
        .doc-label { font-size: 0.75rem; color: #94a3b8; }
        .app-actions { padding: 1.25rem; border-top: 1px solid #2d2d30; display: flex; gap: 0.75rem; justify-content: flex-end; }
        .btn { padding: 0.625rem 1.25rem; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; font-size: 0.875rem; }
        .btn-approve { background: #10b981; color: white; }
        .btn-reject { background: #ef4444; color: white; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .empty-state { text-align: center; padding: 4rem 2rem; color: #94a3b8; }
        .modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 1000; align-items: center; justify-content: center; }
        .modal.active { display: flex; }
        .modal img { max-width: 90vw; max-height: 90vh; border-radius: 8px; }
        .modal-close { position: absolute; top: 1rem; right: 1rem; background: #1c1c1e; color: white; border: none; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; font-size: 1.5rem; }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">⚡ NadaRuns Admin</div>
        <button class="logout-btn" id="logoutBtn" style="display:none;" onclick="logout()">Logout</button>
    </div>
    
    <div id="loginView" class="login-container">
        <div class="login-box">
            <h2>Admin Login</h2>
            <form id="loginForm">
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="email" value="admin@nadaruns.com" required>
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" id="password" value="admin123" required>
                </div>
                <button type="submit" class="login-btn">Login</button>
                <div class="error-msg" id="loginError"></div>
            </form>
        </div>
    </div>
    
    <div id="dashboardView" class="container" style="display:none;">
        <h1 class="page-title">KYC Applications</h1>
        
        <div class="stats-row">
            <div class="stat-card">
                <div class="stat-value" id="totalCount">0</div>
                <div class="stat-label">Total Applications</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="pendingCount">0</div>
                <div class="stat-label">Pending Review</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="approvedCount">0</div>
                <div class="stat-label">Approved</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="rejectedCount">0</div>
                <div class="stat-label">Rejected</div>
            </div>
        </div>
        
        <div class="applications-list" id="applicationsList"></div>
    </div>
    
    <div class="modal" id="imageModal" onclick="closeModal()">
        <button class="modal-close" onclick="closeModal()">×</button>
        <img id="modalImage" src="" alt="Document">
    </div>
    
    <script>
        let token = localStorage.getItem('admin_token');
        
        function showView(view) {
            document.getElementById('loginView').style.display = view === 'login' ? 'flex' : 'none';
            document.getElementById('dashboardView').style.display = view === 'dashboard' ? 'block' : 'none';
            document.getElementById('logoutBtn').style.display = view === 'dashboard' ? 'block' : 'none';
        }
        
        async function login(email, password) {
            try {
                const res = await fetch('/api/auth/admin-login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                if (!res.ok) throw new Error('Invalid credentials');
                const data = await res.json();
                token = data.token;
                localStorage.setItem('admin_token', token);
                showView('dashboard');
                loadApplications();
            } catch (e) {
                document.getElementById('loginError').textContent = e.message;
            }
        }
        
        function logout() {
            token = null;
            localStorage.removeItem('admin_token');
            showView('login');
        }
        
        async function loadApplications() {
            try {
                const res = await fetch('/api/admin/kyc-applications', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) throw new Error('Unauthorized');
                const apps = await res.json();
                renderApplications(apps);
            } catch (e) {
                if (e.message === 'Unauthorized') logout();
            }
        }
        
        function renderApplications(apps) {
            const list = document.getElementById('applicationsList');
            const pending = apps.filter(a => a.kyc_status.overall_status === 'pending').length;
            const approved = apps.filter(a => a.kyc_status.overall_status === 'approved').length;
            const rejected = apps.filter(a => a.kyc_status.overall_status === 'rejected').length;
            
            document.getElementById('totalCount').textContent = apps.length;
            document.getElementById('pendingCount').textContent = pending;
            document.getElementById('approvedCount').textContent = approved;
            document.getElementById('rejectedCount').textContent = rejected;
            
            if (apps.length === 0) {
                list.innerHTML = '<div class="empty-state">No KYC applications yet</div>';
                return;
            }
            
            list.innerHTML = apps.map(app => {
                const driver = app.driver || {};
                const status = app.kyc_status.overall_status;
                const docs = app.documents || {};
                
                return `
                    <div class="app-card">
                        <div class="app-header">
                            <div class="driver-info">
                                <img class="driver-avatar" src="${driver.avatar || ''}" alt="">
                                <div>
                                    <div class="driver-name">${driver.name || 'Unknown'}</div>
                                    <div class="driver-email">${driver.email || ''} · ${driver.phone || ''}</div>
                                </div>
                            </div>
                            <span class="status-badge status-${status}">${status}</span>
                        </div>
                        <div class="docs-grid">
                            ${renderDoc('License Front', docs.license_front)}
                            ${renderDoc('License Back', docs.license_back)}
                            ${renderDoc('Selfie', docs.selfie)}
                        </div>
                        <div class="app-actions">
                            <button class="btn btn-reject" onclick="rejectKYC('${driver.id}')" ${status !== 'pending' ? 'disabled' : ''}>Reject</button>
                            <button class="btn btn-approve" onclick="approveKYC('${driver.id}')" ${status !== 'pending' ? 'disabled' : ''}>Approve</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
        
        function renderDoc(label, doc) {
            if (!doc || !doc.image_data) {
                return `<div class="doc-item"><div class="doc-preview empty">No image</div><div class="doc-label">${label}</div></div>`;
            }
            return `<div class="doc-item"><div class="doc-preview" onclick="showImage('${doc.image_data}')"><img src="${doc.image_data}" alt="${label}"></div><div class="doc-label">${label}</div></div>`;
        }
        
        function showImage(src) {
            event.stopPropagation();
            document.getElementById('modalImage').src = src;
            document.getElementById('imageModal').classList.add('active');
        }
        
        function closeModal() {
            document.getElementById('imageModal').classList.remove('active');
        }
        
        async function approveKYC(driverId) {
            if (!confirm('Approve this driver?')) return;
            try {
                const res = await fetch('/api/admin/kyc/' + driverId + '/approve', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) throw new Error('Failed to approve');
                loadApplications();
            } catch (e) {
                alert(e.message);
            }
        }
        
        async function rejectKYC(driverId) {
            const reason = prompt('Rejection reason:', 'Documents not clear');
            if (!reason) return;
            try {
                const res = await fetch('/api/admin/kyc/' + driverId + '/reject?reason=' + encodeURIComponent(reason), {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) throw new Error('Failed to reject');
                loadApplications();
            } catch (e) {
                alert(e.message);
            }
        }
        
        // Init
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            login(document.getElementById('email').value, document.getElementById('password').value);
        });
        
        if (token) {
            showView('dashboard');
            loadApplications();
        } else {
            showView('login');
        }
    </script>
</body>
</html>
"""


@app.get("/admin", response_class=HTMLResponse)
async def admin_dashboard():
    """Serve the admin dashboard HTML page."""
    return ADMIN_DASHBOARD_HTML


# ===================== Lifecycle =====================

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await ensure_seed()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
