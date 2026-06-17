from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import re
import httpx
import jwt
import bcrypt
import json
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Tuple, Dict, Set
import uuid
from datetime import datetime, timezone, timedelta

# Service layer (production-grade business logic extracted from this monolith)
from services import order_state_machine as sm
from services import audit
from services import idempotency
from services import pricing
from services import payments


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

# Admin credentials from environment variables
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@nadaruns.com')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')

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


async def get_current_shipper(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Dependency to get the current authenticated shipper (full profile doc)."""
    user = await get_current_user(credentials)
    if user["type"] != "shipper":
        raise HTTPException(403, "Shipper access required")
    shipper = dict(user.get("shipper") or {})
    shipper.setdefault("id", user["id"])
    return shipper


async def _notify_shipper_status(shipper_id: str, order_id: str, message: str):
    """Record an in-app notification for a shipper (safe, best-effort)."""
    try:
        await db.shipper_notifications.insert_one({
            "id": str(uuid.uuid4()),
            "shipper_id": shipper_id,
            "order_id": order_id,
            "message": message,
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        logger.warning(f"notify shipper failed: {exc}")


async def get_current_driver_id(request: Request) -> str:
    """Extract the authenticated driver's ID from the request's Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    
    token = auth_header.replace("Bearer ", "")
    payload = decode_token(token)
    driver_id = payload.get("sub")
    user_type = payload.get("type")
    
    if user_type != "driver":
        raise HTTPException(403, "Driver access required")
    
    if not driver_id:
        raise HTTPException(401, "Invalid token: no driver ID")
    
    return driver_id


async def get_optional_driver_id(request: Request) -> Optional[str]:
    """Best-effort driver ID extraction from the JWT.

    Returns the authenticated driver's ID when a valid driver token is
    present, otherwise None. Used by lifecycle endpoints so they can bind
    actions to the real driver without hard-failing legacy/demo callers.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    try:
        payload = decode_token(auth_header.replace("Bearer ", ""))
    except HTTPException:
        return None
    if payload.get("type") != "driver":
        return None
    return payload.get("sub")


# ===================== Models =====================

OrderStatus = Literal[
    "pending", "accepted", "enroute_pickup", "arrived_pickup",
    "picked_up", "enroute_dropoff", "arrived_dropoff",
    "delivered", "rejected", "cancelled", "paused", "failed"
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
    # ---- Distance sources ----
    # road_distance_km (Google Directions, driving) is the SOURCE OF TRUTH for
    # pricing/earnings/ETA. straight_distance_km (Haversine) is kept for
    # reference/geofencing ONLY and must NEVER drive money calculations.
    straight_distance_km: Optional[float] = None
    road_distance_km: Optional[float] = None
    duration_minutes: Optional[float] = None
    route_polyline: Optional[str] = None
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
    # ---- Two-way star ratings (1-5), one-time each ----
    driver_rating: Optional[int] = None       # shipper -> driver
    driver_review: Optional[str] = None
    driver_rated_at: Optional[str] = None
    shipper_rating: Optional[int] = None      # driver -> shipper
    shipper_review: Optional[str] = None
    shipper_rated_at: Optional[str] = None
    # Logistics fields
    shipper_id: Optional[str] = None  # FK to shipper who created the order
    driver_id: Optional[str] = None  # FK to assigned driver
    # ---- Fleet (Phase 2): audit trail for company jobs ----
    assigned_company_id: Optional[str] = None    # company that owns this job
    assigned_driver_id: Optional[str] = None      # driver assigned (mirrors driver_id for fleet)
    assigned_vehicle_id: Optional[str] = None     # fleet vehicle used
    vehicle_type: Optional[str] = None  # Required vehicle type
    cargo_weight_kg: Optional[float] = None
    cargo_dimensions: Optional[str] = None  # LxWxH in cm
    cargo_type: Optional[str] = None  # general, fragile, hazardous, perishable, liquid
    special_requirements: Optional[List[str]] = None  # tail_lift, forklift, straps, refrigeration
    scheduled_pickup: Optional[str] = None  # ISO datetime for scheduled pickups
    price_quote: Optional[float] = None  # Quoted price for shipper
    shipper_notes: Optional[str] = None
    # ---- Payment / Stripe (auth -> capture) ----
    payment_status: str = "unpaid"  # unpaid|pending|authorized|captured|payment_failed|refunded|canceled
    stripe_payment_intent_id: Optional[str] = None
    stripe_checkout_session_id: Optional[str] = None
    payment_amount: Optional[float] = None      # total charged to the shipper (EUR)
    commission_amount: Optional[float] = None   # platform commission (EUR)
    driver_payout_amount: Optional[float] = None  # driver's share (EUR)
    authorized_at: Optional[str] = None
    captured_at: Optional[str] = None
    # ---- Geospatial discovery ----
    pickup_location: Optional[dict] = None       # GeoJSON Point [lng, lat] for 2dsphere index
    pickup_distance_km: Optional[float] = None    # driver -> pickup (computed per query)
    payout_per_km: Optional[float] = None         # earnings / trip distance (computed)


# ===================== Logistics Vehicle Types =====================

VEHICLE_TYPES = {
    # Medium Vehicles
    "cargo_van": {
        "id": "cargo_van",
        "name": "Cargo Van",
        "category": "Medium Vehicles",
        "icon": "🚐",
        "max_weight_kg": 1500,
        "description": "Small cargo, quick deliveries",
        "base_rate_per_km": 1.20,
    },
    "box_truck": {
        "id": "box_truck",
        "name": "Box Truck",
        "category": "Medium Vehicles",
        "icon": "📦",
        "max_weight_kg": 5000,
        "description": "Medium cargo, palletized goods",
        "base_rate_per_km": 1.80,
    },
    "flatbed_truck": {
        "id": "flatbed_truck",
        "name": "Flatbed Truck",
        "category": "Medium Vehicles",
        "icon": "🚚",
        "max_weight_kg": 8000,
        "description": "Open cargo bed",
        "base_rate_per_km": 2.00,
    },
    # Heavy Vehicles
    "semi_truck": {
        "id": "semi_truck",
        "name": "Semi-Truck",
        "category": "Heavy Vehicles",
        "icon": "🚛",
        "max_weight_kg": 20000,
        "description": "Long haul freight",
        "base_rate_per_km": 2.50,
    },
    "trailer_truck": {
        "id": "trailer_truck",
        "name": "Trailer Truck",
        "category": "Heavy Vehicles",
        "icon": "🚜",
        "max_weight_kg": 25000,
        "description": "Large cargo transport",
        "base_rate_per_km": 2.80,
    },
    "container_truck": {
        "id": "container_truck",
        "name": "Container Truck",
        "category": "Heavy Vehicles",
        "icon": "📦",
        "max_weight_kg": 30000,
        "description": "Container shipping",
        "base_rate_per_km": 3.00,
    },
    "tanker": {
        "id": "tanker",
        "name": "Tanker",
        "category": "Heavy Vehicles",
        "icon": "🛢️",
        "max_weight_kg": 35000,
        "description": "Liquid cargo, chemicals",
        "base_rate_per_km": 3.50,
    },
    # Specialized Vehicles
    "refrigerated": {
        "id": "refrigerated",
        "name": "Refrigerated Vehicle",
        "category": "Specialized",
        "icon": "❄️",
        "max_weight_kg": 15000,
        "description": "Temperature controlled",
        "base_rate_per_km": 3.20,
    },
    "crane_truck": {
        "id": "crane_truck",
        "name": "Crane Truck",
        "category": "Specialized",
        "icon": "🏗️",
        "max_weight_kg": 12000,
        "description": "Heavy lifting",
        "base_rate_per_km": 4.00,
    },
    "hazmat": {
        "id": "hazmat",
        "name": "Hazardous Goods Vehicle",
        "category": "Specialized",
        "icon": "⚠️",
        "max_weight_kg": 18000,
        "description": "Dangerous goods transport",
        "base_rate_per_km": 4.50,
    },
    # Other
    "other": {
        "id": "other",
        "name": "Other",
        "category": "Other",
        "icon": "🚚",
        "max_weight_kg": 10000,
        "description": "Custom vehicle type",
        "base_rate_per_km": 2.00,
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
    preferred_vehicle_type: Optional[str] = None  # Preferred vehicle type for shipments
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    is_verified: bool = False
    total_shipments: int = 0
    rating: float = 5.0
    is_suspended: bool = False


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
    cargo_volume_m3: Optional[float] = 0.0   # computed volume (stackable cargo)
    pallet_count: Optional[int] = 0          # FIN pallets (non-stackable)
    loading_meters: Optional[float] = 0.0    # loading meters (full width/height)
    cargo_type: str = "general"
    cargo_description: str
    special_requirements: Optional[List[str]] = None
    # Scheduling
    scheduled_pickup: Optional[str] = None  # ISO datetime, null for ASAP
    # Pricing
    urgency: str = "standard"  # standard | express | priority | emergency
    shipper_offer: Optional[float] = 0.0  # optional bonus on top of base price


class PriceQuoteRequest(BaseModel):
    pickup_lat: float
    pickup_lng: float
    dropoff_lat: float
    dropoff_lng: float
    vehicle_type: str
    cargo_weight_kg: float
    urgency: str = "standard"  # standard | express | priority | emergency
    special_handling: bool = False
    cargo_volume_m3: Optional[float] = 0.0
    pallet_count: Optional[int] = 0
    loading_meters: Optional[float] = 0.0


class PriceQuoteResponse(BaseModel):
    distance_km: float                 # == road_distance_km (used for pricing)
    straight_distance_km: float = 0.0  # Haversine (reference only)
    road_distance_km: float = 0.0      # Google Directions driving distance
    route_source: str = "google"
    estimated_duration_minutes: int
    base_price: float
    weight_surcharge: float
    total_price: float
    vehicle_type: str
    currency: str = "EUR"
    # Detailed breakdown (NadaRuns pricing engine)
    base_fee: float = 0.0
    distance_fee: float = 0.0
    weight_fee: float = 0.0
    freight_fee: float = 0.0
    freight_rate_per_kg: float = 0.0
    chargeable_weight: float = 0.0
    chargeable_basis: str = "actual"
    actual_weight_kg: float = 0.0
    fuel_surcharge: float = 0.0
    urgency: str = "standard"
    urgency_multiplier: float = 1.0
    special_multiplier: float = 1.0
    estimate_low: float = 0.0
    estimate_high: float = 0.0


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


class Vehicle(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    vehicle_type: str = "cargo_van"  # logistics vehicle type id
    label: str = ""                   # display name e.g. "Cargo Van"
    plate: str = ""
    capacity_kg: int = 1500
    is_primary: bool = False


class Driver(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    rating: float
    avatar: str
    vehicle: str
    vehicle_type: str = "cargo_van"  # Logistics vehicle type ID (mirrors primary vehicle)
    vehicle_capacity_kg: int = 1500  # Vehicle capacity in kg (mirrors primary vehicle)
    plate: str = ""
    vehicles: List[Vehicle] = Field(default_factory=list)  # all vehicles owned by the driver
    email: str = ""
    phone: str = ""
    password_hash: Optional[str] = None  # hashed password
    is_online: bool = False
    earnings_today: float = 0.0
    deliveries_today: int = 0
    acceptance_rate: float = 96.0
    completion_rate: float = 98.0
    notifications: NotificationPrefs = Field(default_factory=NotificationPrefs)
    is_suspended: bool = False
    company_id: Optional[str] = None        # Fleet: company this driver belongs to (None = independent)
    company_role: Optional[str] = None       # Fleet: "owner" | "driver" (None = independent)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class DriverUpdate(BaseModel):
    name: Optional[str] = None
    vehicle: Optional[str] = None
    vehicle_type: Optional[str] = None
    vehicle_capacity_kg: Optional[int] = None
    plate: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None
    notifications: Optional[NotificationPrefs] = None


class VehicleInput(BaseModel):
    vehicle_type: str
    plate: str = ""
    capacity_kg: Optional[int] = None
    make_primary: bool = False


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


class StarRatingRequest(BaseModel):
    rating: int  # 1-5 stars
    review: Optional[str] = None


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


# ===================== Fleet / Company Models =====================

JOB_ACCEPTANCE_MODES = {"self_accept", "owner_assign", "hybrid"}


class Company(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_name: str
    owner_driver_id: str
    business_id: Optional[str] = None       # Y-tunnus / VAT id (optional)
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    status: Literal["active", "suspended"] = "active"
    job_acceptance_mode: Literal["self_accept", "owner_assign", "hybrid"] = "self_accept"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CompanyCreate(BaseModel):
    company_name: str = Field(min_length=2, max_length=120)
    business_id: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None


class CompanyUpdate(BaseModel):
    company_name: Optional[str] = None
    business_id: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    job_acceptance_mode: Optional[Literal["self_accept", "owner_assign", "hybrid"]] = None


class FleetDriverInvite(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(default="", max_length=80)
    email: str
    phone: Optional[str] = None
    password: str = Field(min_length=6, max_length=128)
    license_class: Optional[str] = None
    vehicle_type: Optional[str] = "cargo_van"


class FleetVehicle(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    registration_number: str
    vehicle_type: str = "cargo_van"
    capacity_kg: Optional[int] = None
    max_weight_kg: Optional[int] = None
    length_cm: Optional[float] = None
    width_cm: Optional[float] = None
    height_cm: Optional[float] = None
    status: Literal["active", "disabled"] = "active"
    assigned_driver_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class FleetVehicleCreate(BaseModel):
    registration_number: str = Field(min_length=1, max_length=40)
    vehicle_type: str = "cargo_van"
    capacity_kg: Optional[int] = None
    max_weight_kg: Optional[int] = None
    length_cm: Optional[float] = None
    width_cm: Optional[float] = None
    height_cm: Optional[float] = None


class FleetVehicleUpdate(BaseModel):
    registration_number: Optional[str] = None
    vehicle_type: Optional[str] = None
    capacity_kg: Optional[int] = None
    max_weight_kg: Optional[int] = None
    length_cm: Optional[float] = None
    width_cm: Optional[float] = None
    height_cm: Optional[float] = None
    status: Optional[Literal["active", "disabled"]] = None


class AssignDriverRequest(BaseModel):
    driver_id: str


class AssignJobRequest(BaseModel):
    driver_id: str
    vehicle_id: Optional[str] = None


# ===================== Transaction & Wallet Models =====================

class Transaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str  # driver_id or shipper_id
    user_type: Literal["driver", "shipper"] = "driver"
    type: Literal["earning", "payout", "bonus", "fee", "refund", "charge"]
    amount: float  # positive for credit, can be negative for debit
    currency: str = "EUR"
    description: str
    reference_id: Optional[str] = None  # order_id if related to an order
    status: Literal["pending", "completed", "failed", "cancelled"] = "completed"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None
    metadata: Optional[Dict] = None


class WalletAccount(BaseModel):
    """Detailed wallet account model for database storage."""
    user_id: str
    user_type: Literal["driver", "shipper"] = "driver"
    balance: float = 0.0
    pending_balance: float = 0.0
    currency: str = "EUR"
    total_earned: float = 0.0
    total_withdrawn: float = 0.0
    last_payout_date: Optional[str] = None
    next_payout_date: Optional[str] = None
    payout_method: Optional[str] = None  # "bank_transfer", "paypal", etc.


class PayoutRequest(BaseModel):
    amount: float
    method: str = "bank_transfer"


# ===================== Payment / Withdrawal Models =====================

class WithdrawalRequest(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    driver_id: str
    driver_name: Optional[str] = None
    amount: float
    currency: str = "EUR"
    method: str = "bank_transfer"  # bank_transfer | paypal | other
    account_details: Optional[str] = None  # IBAN / PayPal email / note
    status: Literal["pending", "approved", "paid", "rejected"] = "pending"
    reference: Optional[str] = None  # external bank/PayPal reference once paid
    note: Optional[str] = None
    requested_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    processed_at: Optional[str] = None
    processed_by: Optional[str] = None


class WithdrawalCreate(BaseModel):
    amount: float
    method: str = "bank_transfer"
    account_details: Optional[str] = None


class WithdrawalPayBody(BaseModel):
    reference: Optional[str] = None
    note: Optional[str] = None


class WithdrawalRejectBody(BaseModel):
    reason: Optional[str] = None


class CheckoutBody(BaseModel):
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


class CaptureBody(BaseModel):
    amount: Optional[float] = None  # optional partial capture (EUR)


class StripeSettingsBody(BaseModel):
    test_secret_key: Optional[str] = None
    live_secret_key: Optional[str] = None
    mode: Optional[str] = None  # "test" | "live"
    webhook_secret: Optional[str] = None


# ===================== Notification Models =====================

class Notification(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    recipient_id: str  # user_id (driver, shipper, or admin)
    recipient_type: Literal["driver", "shipper", "admin"] = "driver"
    type: Literal["order", "payment", "system", "promotion", "alert"]
    title: str
    message: str
    data: Optional[Dict] = None  # Additional data (order_id, etc.)
    read: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    read_at: Optional[str] = None
    expires_at: Optional[str] = None


# ===================== Registration Models =====================

# Valid logistics vehicle type IDs
VALID_VEHICLE_TYPE_IDS = list(VEHICLE_TYPES.keys())

class DriverRegistration(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str
    password: str  # plain password, will be hashed
    vehicle_type: str  # logistics vehicle type ID (e.g., "cargo_van", "semi_truck")
    city: str
    license_plate: Optional[str] = None
    vehicle_capacity_kg: Optional[int] = None  # Custom capacity for "other" type


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
SEED_VERSION = 12  # bump to force re-seed (fresh order data)

SEED_DRIVER = {
    "id": DRIVER_ID,
    "name": "Eero Virtanen",
    "rating": 4.92,
    "avatar": "https://images.unsplash.com/photo-1551825687-f9de1603ed8b?crop=entropy&cs=srgb&fm=jpg&w=400&q=80",
    "vehicle": "Cargo Van • HKI-2841",
    "vehicle_type": "cargo_van",
    "vehicle_capacity_kg": 1500,
    "plate": "HKI-2841",
    "email": "eero.virtanen@driver.app",
    "phone": "+358 41 911 4422",
    "is_online": False,
    "earnings_today": 0.0,
    "deliveries_today": 0,
    "acceptance_rate": 96.0,
    "notifications": {"push": True, "sound": True, "new_orders": True, "earnings_summary": True},
}

# ===================== Logistics Demo Data =====================

# Logistics pickup locations (warehouses, distribution centers, ports)
LOGISTICS_PICKUPS = [
    {"name": "Helsinki Port Terminal A", "address": "Vuosaari Harbour, Helsinki", "lat": 60.2095, "lng": 25.1478},
    {"name": "DHL Distribution Center", "address": "Vantaankoskentie 14, Vantaa", "lat": 60.2887, "lng": 24.8464},
    {"name": "PostNord Logistics Hub", "address": "Tikkurilantie 146, Vantaa", "lat": 60.2922, "lng": 25.0392},
    {"name": "DB Schenker Warehouse", "address": "Ansatie 5, Vantaa", "lat": 60.2714, "lng": 24.9681},
    {"name": "UPS Express Center", "address": "Koivuhaantie 6, Vantaa", "lat": 60.2943, "lng": 24.9636},
    {"name": "Amazon Fulfillment FI", "address": "Turunlinnantie 8, Espoo", "lat": 60.1754, "lng": 24.7363},
    {"name": "Posti Terminal", "address": "Postintaival 7, Helsinki", "lat": 60.2280, "lng": 24.8763},
    {"name": "K-Citymarket Warehouse", "address": "Lauttasaarentie 39, Helsinki", "lat": 60.1573, "lng": 24.8752},
    {"name": "IKEA Distribution", "address": "Porttipuistontie 3, Vantaa", "lat": 60.2766, "lng": 24.9847},
    {"name": "Matkahuolto Central", "address": "Kamppi, Helsinki", "lat": 60.1690, "lng": 24.9320},
]

# Logistics dropoff locations (businesses, stores, construction sites)
LOGISTICS_DROPOFFS = [
    {"name": "Nokia HQ", "address": "Karakaari 7, Espoo", "lat": 60.2198, "lng": 24.7589, "contact": "Reception Desk"},
    {"name": "Stockmann Department Store", "address": "Aleksanterinkatu 52, Helsinki", "lat": 60.1685, "lng": 24.9410, "contact": "Loading Dock B"},
    {"name": "Oulu Construction Site", "address": "Kalasatama 3, Helsinki", "lat": 60.1872, "lng": 24.9768, "contact": "Site Manager"},
    {"name": "Prisma Kaari", "address": "Kantelettarentie 1, Helsinki", "lat": 60.2286, "lng": 24.8839, "contact": "Goods Receiving"},
    {"name": "HUS Hospital", "address": "Meilahti, Helsinki", "lat": 60.1898, "lng": 24.9061, "contact": "Medical Supplies"},
    {"name": "Aalto University", "address": "Otakaari 1, Espoo", "lat": 60.1865, "lng": 24.8261, "contact": "Facilities"},
    {"name": "Mall of Tripla", "address": "Fredikanterassi 1, Helsinki", "lat": 60.1982, "lng": 24.9295, "contact": "Delivery Zone C"},
    {"name": "Verkkokauppa.com", "address": "Tyynenmerenkatu 11, Helsinki", "lat": 60.1634, "lng": 24.9221, "contact": "Warehouse Team"},
    {"name": "SOK Logistics", "address": "Fleminginkatu 34, Helsinki", "lat": 60.1827, "lng": 24.9475, "contact": "Operations"},
    {"name": "Kone Corporation", "address": "Keilasatama 3, Espoo", "lat": 60.1753, "lng": 24.8294, "contact": "Shipping Dept"},
]

# Logistics customers (businesses)
LOGISTICS_CUSTOMERS = [
    {"name": "Kesko Logistics", "rating": 4.8, "phone": "+358 10 5311"},
    {"name": "S-Group Transport", "rating": 4.9, "phone": "+358 10 7682 000"},
    {"name": "Fazer Supply Chain", "rating": 4.7, "phone": "+358 20 555 3000"},
    {"name": "Marimekko Shipping", "rating": 5.0, "phone": "+358 9 758 711"},
    {"name": "Fiskars Distribution", "rating": 4.6, "phone": "+358 20 439 100"},
    {"name": "Paulig Coffee Co", "rating": 4.8, "phone": "+358 9 319 81"},
    {"name": "Wärtsilä Marine", "rating": 4.5, "phone": "+358 10 709 0000"},
    {"name": "Konecranes Parts", "rating": 4.7, "phone": "+358 20 427 11"},
    {"name": "Valmet Industries", "rating": 4.9, "phone": "+358 10 672 0000"},
    {"name": "Outokumpu Steel", "rating": 4.4, "phone": "+358 9 4211"},
]

# Cargo descriptions for logistics orders
CARGO_DESCRIPTIONS = [
    {"items": [{"name": "Industrial Pallets", "quantity": 12}], "weight_kg": 2400, "type": "general", "vehicle": "flatbed_truck"},
    {"items": [{"name": "Electronics Shipment", "quantity": 50}], "weight_kg": 800, "type": "fragile", "vehicle": "box_truck"},
    {"items": [{"name": "Construction Materials", "quantity": 1}], "weight_kg": 5000, "type": "oversized", "vehicle": "flatbed_truck"},
    {"items": [{"name": "Refrigerated Goods", "quantity": 200}], "weight_kg": 3500, "type": "perishable", "vehicle": "refrigerated"},
    {"items": [{"name": "Medical Supplies", "quantity": 30}], "weight_kg": 150, "type": "fragile", "vehicle": "cargo_van"},
    {"items": [{"name": "Auto Parts Crate", "quantity": 8}], "weight_kg": 1200, "type": "general", "vehicle": "box_truck"},
    {"items": [{"name": "Chemical Drums", "quantity": 20}], "weight_kg": 4000, "type": "hazardous", "vehicle": "hazmat"},
    {"items": [{"name": "Furniture Delivery", "quantity": 15}], "weight_kg": 900, "type": "fragile", "vehicle": "box_truck"},
    {"items": [{"name": "Steel Beams", "quantity": 6}], "weight_kg": 8000, "type": "oversized", "vehicle": "flatbed_truck"},
    {"items": [{"name": "Office Equipment", "quantity": 25}], "weight_kg": 500, "type": "general", "vehicle": "cargo_van"},
]

# Delivery notes for logistics
LOGISTICS_NOTES = [
    "Call 30 min before arrival",
    "Use loading dock B",
    "Forklift required",
    "Check with security first",
    "Fragile - handle with care",
    "Temperature sensitive",
    "Weekend delivery only",
    "Morning delivery preferred",
    None,
]

# ===================== TAMPERE REGION =====================
TAMPERE_PICKUPS = [
    {"name": "Tampere Freight Terminal", "address": "Rahtipolku 5, Tampere", "lat": 61.4978, "lng": 23.7610, "region": "tampere"},
    {"name": "Posti Tampere Hub", "address": "Hatanpään valtatie 30, Tampere", "lat": 61.4858, "lng": 23.7817, "region": "tampere"},
    {"name": "DHL Tampere Center", "address": "Lentokentänkatu 12, Pirkkala", "lat": 61.4214, "lng": 23.5896, "region": "tampere"},
    {"name": "Schenker Tampere", "address": "Ilmailuntie 7, Tampere", "lat": 61.4167, "lng": 23.6044, "region": "tampere"},
    {"name": "Tokmanni Distribution", "address": "Mäentakusenkatu 1, Mänttä", "lat": 62.0289, "lng": 24.6261, "region": "tampere"},
    {"name": "UPM Paper Mill", "address": "Tehtaankatu 1, Valkeakoski", "lat": 61.2640, "lng": 24.0316, "region": "tampere"},
    {"name": "Sandvik Mining Tampere", "address": "Pitkäniemenkatu 15, Tampere", "lat": 61.5100, "lng": 23.6950, "region": "tampere"},
    {"name": "Nokian Tyres Factory", "address": "Pirkkalaistie 7, Nokia", "lat": 61.4674, "lng": 23.5020, "region": "tampere"},
    {"name": "AGCO Factory", "address": "Valmetintie 2, Suolahti", "lat": 61.4891, "lng": 23.7523, "region": "tampere"},
    {"name": "Metso Tampere", "address": "Lokomonkatu 3, Tampere", "lat": 61.5017, "lng": 23.7264, "region": "tampere"},
]

TAMPERE_DROPOFFS = [
    {"name": "Tampere University Hospital", "address": "Teiskontie 35, Tampere", "lat": 61.5098, "lng": 23.8178, "contact": "Medical Logistics", "region": "tampere"},
    {"name": "Prisma Kaleva", "address": "Sammonkatu 73, Tampere", "lat": 61.4922, "lng": 23.8230, "contact": "Goods Reception", "region": "tampere"},
    {"name": "Ideapark Shopping Center", "address": "Ideaparkinkatu 4, Lempäälä", "lat": 61.3139, "lng": 23.7639, "contact": "Dock C", "region": "tampere"},
    {"name": "Tampere Central Hospital", "address": "Biokatu 6, Tampere", "lat": 61.4544, "lng": 23.8564, "contact": "Supply Chain", "region": "tampere"},
    {"name": "Ratina Shopping Mall", "address": "Vuolteenkatu 1, Tampere", "lat": 61.4941, "lng": 23.7687, "contact": "Delivery Entrance", "region": "tampere"},
    {"name": "SSAB Steel Hämeenlinna", "address": "Harvialantie 420, Hämeenlinna", "lat": 61.0156, "lng": 24.4958, "contact": "Gate 3", "region": "tampere"},
    {"name": "K-Rauta Tampere", "address": "Hatanpään valtatie 1, Tampere", "lat": 61.4889, "lng": 23.7762, "contact": "Building Materials", "region": "tampere"},
    {"name": "Fazer Tampere Bakery", "address": "Näsilinnankatu 48, Tampere", "lat": 61.4984, "lng": 23.7583, "contact": "Production", "region": "tampere"},
    {"name": "Pirkanmaa Hospital District", "address": "Finn-Medi 1, Tampere", "lat": 61.4566, "lng": 23.8498, "contact": "Pharmacy", "region": "tampere"},
    {"name": "Nokia Networks", "address": "Visiokatu 1, Tampere", "lat": 61.4496, "lng": 23.8567, "contact": "Tech Park", "region": "tampere"},
]

# ===================== OTHER FINNISH REGIONS =====================
# Turku region
TURKU_PICKUPS = [
    {"name": "Port of Turku", "address": "Satamakatu 1, Turku", "lat": 60.4357, "lng": 22.2189, "region": "turku"},
    {"name": "Turku Logistics Center", "address": "Rieskalähteentie 75, Turku", "lat": 60.4632, "lng": 22.3012, "region": "turku"},
]

TURKU_DROPOFFS = [
    {"name": "Turku University Hospital", "address": "Kiinamyllynkatu 4-8, Turku", "lat": 60.4509, "lng": 22.2866, "contact": "Central Hospital", "region": "turku"},
    {"name": "Meyer Turku Shipyard", "address": "Telakkakatu 1, Turku", "lat": 60.4268, "lng": 22.2231, "contact": "Shipyard Gate", "region": "turku"},
]

# Oulu region
OULU_PICKUPS = [
    {"name": "Oulu Port Terminal", "address": "Poikkimaantie 16, Oulu", "lat": 65.0078, "lng": 25.4211, "region": "oulu"},
    {"name": "Posti Oulu Hub", "address": "Postikuja 2, Oulu", "lat": 65.0172, "lng": 25.4687, "region": "oulu"},
]

OULU_DROPOFFS = [
    {"name": "Oulu University Hospital", "address": "Kajaanintie 50, Oulu", "lat": 65.0074, "lng": 25.5196, "contact": "OYS Logistics", "region": "oulu"},
    {"name": "Technopolis Oulu", "address": "Elektroniikkatie 3, Oulu", "lat": 65.0590, "lng": 25.4420, "contact": "Tech Campus", "region": "oulu"},
]

# Kuopio region
KUOPIO_PICKUPS = [
    {"name": "Kuopio Freight Center", "address": "Volttikatu 1, Kuopio", "lat": 62.8924, "lng": 27.6556, "region": "kuopio"},
]

KUOPIO_DROPOFFS = [
    {"name": "Kuopio University Hospital", "address": "Puijonlaaksontie 2, Kuopio", "lat": 62.8765, "lng": 27.6383, "contact": "KYS Pharmacy", "region": "kuopio"},
]

# All regions combined for easy access
ALL_PICKUPS = LOGISTICS_PICKUPS + TAMPERE_PICKUPS + TURKU_PICKUPS + OULU_PICKUPS + KUOPIO_PICKUPS
ALL_DROPOFFS = LOGISTICS_DROPOFFS + TAMPERE_DROPOFFS + TURKU_DROPOFFS + OULU_DROPOFFS + KUOPIO_DROPOFFS


def build_logistics_order(status: OrderStatus = "pending", completed_offset_hours: Optional[int] = None, override_pickup: dict = None, override_dropoff: dict = None, shipper_id: Optional[str] = None, region: Optional[str] = None) -> dict:
    """Build a logistics order with realistic cargo data.
    
    Args:
        region: Optional region filter - "helsinki", "tampere", "turku", "oulu", "kuopio", or None for random
    """
    # Select pickups and dropoffs based on region
    if region == "tampere":
        pickups = TAMPERE_PICKUPS
        dropoffs = TAMPERE_DROPOFFS
    elif region == "turku":
        pickups = TURKU_PICKUPS
        dropoffs = TURKU_DROPOFFS
    elif region == "oulu":
        pickups = OULU_PICKUPS
        dropoffs = OULU_DROPOFFS
    elif region == "kuopio":
        pickups = KUOPIO_PICKUPS
        dropoffs = KUOPIO_DROPOFFS
    elif region == "helsinki":
        pickups = LOGISTICS_PICKUPS
        dropoffs = LOGISTICS_DROPOFFS
    else:
        # Use all regions
        pickups = ALL_PICKUPS
        dropoffs = ALL_DROPOFFS
    
    pickup_idx = random.randint(0, len(pickups) - 1)
    dropoff_idx = random.randint(0, len(dropoffs) - 1)
    customer_idx = random.randint(0, len(LOGISTICS_CUSTOMERS) - 1)
    cargo_idx = random.randint(0, len(CARGO_DESCRIPTIONS) - 1)
    
    pickup = override_pickup or pickups[pickup_idx]
    dropoff_data = override_dropoff or dropoffs[dropoff_idx]
    customer = LOGISTICS_CUSTOMERS[customer_idx]
    cargo = CARGO_DESCRIPTIONS[cargo_idx]
    
    # Calculate accurate distance using Haversine formula
    import math
    R = 6371.0  # Earth's radius in km
    lat1, lng1 = math.radians(pickup["lat"]), math.radians(pickup["lng"])
    lat2, lng2 = math.radians(dropoff_data["lat"]), math.radians(dropoff_data["lng"])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    distance = round(2 * R * math.asin(math.sqrt(h)), 1)
    
    # Apply road factor (roads are typically 1.3x longer than straight-line distance)
    road_distance = round(distance * 1.3, 1)
    road_distance = max(2.0, road_distance)  # Minimum 2km for any delivery
    
    # Calculate pricing based on vehicle type and distance
    vehicle_type = cargo["vehicle"]
    vehicle_info = VEHICLE_TYPES.get(vehicle_type, VEHICLE_TYPES["cargo_van"])
    base_rate = vehicle_info["base_rate_per_km"]
    earnings = round(road_distance * base_rate + random.uniform(5, 15), 2)
    
    eta = int(road_distance * 2.0) + random.randint(15, 45)  # ~2 min per km + loading time
    
    created = datetime.now(timezone.utc)
    completed = None
    if completed_offset_hours is not None:
        created = created - timedelta(hours=completed_offset_hours, minutes=random.randint(10, 50))
        completed = (created + timedelta(minutes=random.randint(45, 180))).isoformat()
    
    order = Order(
        order_number=f"LD-{random.randint(10000, 99999)}",
        status=status,
        pickup=GeoPoint(
            lat=pickup["lat"], 
            lng=pickup["lng"], 
            address=pickup["address"], 
            name=pickup["name"]
        ),
        dropoff=GeoPoint(
            lat=dropoff_data["lat"], 
            lng=dropoff_data["lng"], 
            address=dropoff_data["address"], 
            name=dropoff_data["name"]
        ),
        customer=Customer(
            name=customer["name"], 
            rating=customer["rating"], 
            phone=customer["phone"],
            apartment=dropoff_data.get("contact", "Loading Dock"),
            gate_code=str(random.randint(1000, 9999)) if random.random() > 0.5 else None,
            notes=random.choice(LOGISTICS_NOTES),
        ),
        items=[OrderItem(**i) for i in cargo["items"]],
        distance_km=road_distance,  # Use accurate road distance
        eta_minutes=eta,
        earnings=earnings,
        tip=0.0,  # B2B logistics typically no tips
        pickup_otp=f"{random.randint(1000, 9999)}",
        dropoff_otp=f"{random.randint(1000, 9999)}",
        pickup_otp_verified=(status not in ("pending", "rejected", "accepted", "enroute_pickup", "arrived_pickup")),
        dropoff_otp_verified=(status == "delivered"),
        created_at=created.isoformat(),
        completed_at=completed,
        rating_given=random.choice([1, 1, 1, -1]) if completed else None,
        # Logistics-specific fields
        shipper_id=shipper_id,
        vehicle_type=vehicle_type,
        cargo_weight_kg=cargo["weight_kg"],
        cargo_type=cargo["type"],
        special_requirements=random.sample(SPECIAL_REQUIREMENTS, k=random.randint(0, 2)) if random.random() > 0.5 else None,
        payment_status="authorized",  # seeded demo jobs are pre-paid so they stay visible in the marketplace
    ).model_dump()
    return order


# Keep old function name for backwards compatibility
def build_order(status: OrderStatus = "pending", completed_offset_hours: Optional[int] = None, override_pickup: dict = None, override_dropoff: dict = None) -> dict:
    """Build a logistics order (legacy wrapper)."""
    return build_logistics_order(status, completed_offset_hours, override_pickup, override_dropoff)


# Additional pickup/dropoff locations for map-based job discovery
# These use the logistics locations for variety
ADDITIONAL_PICKUPS = LOGISTICS_PICKUPS.copy()
ADDITIONAL_DROPOFFS = LOGISTICS_DROPOFFS.copy()


async def seed_multiple_pending_orders():
    """Seed multiple pending logistics orders at different locations for map-based job discovery."""
    for i, pickup in enumerate(ADDITIONAL_PICKUPS):
        dropoff = ADDITIONAL_DROPOFFS[i % len(ADDITIONAL_DROPOFFS)]
        order = build_logistics_order("pending", override_pickup=pickup, override_dropoff=dropoff)
        await db.orders.insert_one(order)
    logger.info(f"Seeded {len(ADDITIONAL_PICKUPS)} pending logistics orders for map discovery")


async def create_database_indexes():
    """Create MongoDB indexes for optimal query performance."""
    try:
        # Orders collection indexes
        await db.orders.create_index("id", unique=True)
        await db.orders.create_index("status")
        await db.orders.create_index("shipper_id")
        await db.orders.create_index("driver_id")
        await db.orders.create_index("created_at")
        await db.orders.create_index([("status", 1), ("created_at", -1)])
        await db.orders.create_index([("shipper_id", 1), ("status", 1)])
        await db.orders.create_index([("driver_id", 1), ("status", 1)])
        # Geospatial index for proximity-based job discovery ($geoNear / $near)
        await db.orders.create_index([("pickup_location", "2dsphere")], sparse=True)
        
        # Drivers collection indexes
        await db.drivers.create_index("id", unique=True)
        await db.drivers.create_index("email", unique=True)
        await db.drivers.create_index("is_online")
        await db.drivers.create_index([("is_online", 1), ("vehicle_type", 1)])
        
        # Shippers collection indexes
        await db.shippers.create_index("id", unique=True)
        await db.shippers.create_index("email", unique=True)
        
        # KYC collections indexes
        await db.kyc_status.create_index("driver_id", unique=True)
        await db.kyc_documents.create_index("driver_id")
        
        # Transactions collection indexes
        await db.transactions.create_index("user_id")
        await db.transactions.create_index([("user_id", 1), ("created_at", -1)])
        await db.transactions.create_index("type")
        
        # Notifications collection indexes
        await db.notifications.create_index("recipient_id")
        await db.notifications.create_index([("recipient_id", 1), ("read", 1)])
        await db.notifications.create_index([("recipient_id", 1), ("created_at", -1)])

        # Order audit trail (immutable event log)
        await db.order_events.create_index("order_id")
        await db.order_events.create_index([("order_id", 1), ("created_at", 1)])

        # Idempotency keys: unique per (key, scope) + 24h TTL auto-cleanup
        await db.idempotency_keys.create_index([("key", 1), ("scope", 1)], unique=True)
        await db.idempotency_keys.create_index("created_at", expireAfterSeconds=86400)

        # Payment ledger (Stripe authorize/capture entries)
        await db.payment_transactions.create_index("order_id")
        await db.payment_transactions.create_index("driver_id")
        await db.payment_transactions.create_index("shipper_id")
        await db.payment_transactions.create_index([("stripe_payment_intent_id", 1), ("type", 1)])
        await db.payment_transactions.create_index([("created_at", -1)])

        # Driver cash-out / withdrawal requests
        await db.withdrawal_requests.create_index("driver_id")
        await db.withdrawal_requests.create_index("status")
        await db.withdrawal_requests.create_index([("requested_at", -1)])

        # Payment lookups on orders
        await db.orders.create_index("stripe_payment_intent_id")
        await db.orders.create_index("payment_status")

        # Fleet / company collections
        await db.companies.create_index("id", unique=True)
        await db.companies.create_index("owner_driver_id")
        await db.companies.create_index("status")
        await db.drivers.create_index("company_id")
        await db.fleet_vehicles.create_index("id", unique=True)
        await db.fleet_vehicles.create_index("company_id")
        await db.fleet_vehicles.create_index("assigned_driver_id")
        await db.fleet_vehicles.create_index([("company_id", 1), ("registration_number", 1)], unique=True)

        logger.info("Database indexes created successfully")
    except Exception as e:
        logger.warning(f"Error creating indexes (may already exist): {e}")


async def ensure_seed():
    """Legacy seed function - now just ensures indexes and basic data migration."""
    # Create indexes
    await create_database_indexes()
    
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
    
    # Add password_hash to legacy Eero Virtanen driver if exists without password
    legacy_driver = await db.drivers.find_one({"email": "eero.virtanen@driver.app"})
    if legacy_driver and not legacy_driver.get("password_hash"):
        await db.drivers.update_one(
            {"email": "eero.virtanen@driver.app"},
            {"$set": {"password_hash": hash_password("driver123")}}
        )
        logger.info("Added password to legacy driver Eero Virtanen")


# ===================== Routes =====================

@api_router.get("/")
async def root():
    return {"message": "NadaRuns Logistics API - Production Ready"}


@api_router.post("/seed-demo")
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


@api_router.delete("/seed-demo")
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


@api_router.get("/driver/me", response_model=Driver)
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


@api_router.post("/driver/toggle-online", response_model=Driver)
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


async def broadcast_driver_status(driver_id: str, is_online: bool):
    """Broadcast driver online/offline status to relevant WebSocket clients."""
    message = json.dumps({
        "type": "driver_status",
        "driver_id": driver_id,
        "is_online": is_online,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    # Broadcast to all connected clients (for admin dashboard, shippers, etc.)
    for ws in list(active_connections):
        try:
            await ws.send_text(message)
        except Exception:
            pass


@api_router.get("/orders/pending", response_model=Optional[Order])
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


@api_router.get("/orders/available", response_model=List[Order])
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


@api_router.get("/orders/available/matched", response_model=List[Order])
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


@api_router.get("/orders/active", response_model=Optional[Order])
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


@api_router.get("/orders/history", response_model=List[Order])
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


@api_router.post("/orders/{order_id}/accept", response_model=Order)
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
    return Order(**order)


@api_router.post("/orders/{order_id}/reject", response_model=Order)
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


@api_router.post("/orders/{order_id}/advance", response_model=Order)
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


@api_router.get("/orders/{order_id}/events")
async def get_order_events(order_id: str):
    """Return the immutable audit timeline for an order (status changes etc.)."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0, "order_number": 1, "status": 1})
    if not order:
        raise HTTPException(404, "Order not found")
    events = await audit.get_events(db, order_id)
    return {"order_id": order_id, "current_status": order.get("status"), "events": events}


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


async def _recompute_driver_rating(driver_id: str) -> Optional[float]:
    """Average all star ratings a driver has received and persist on profile."""
    ratings: List[int] = []
    async for o in db.orders.find(
        {"driver_id": driver_id, "driver_rating": {"$ne": None}},
        {"_id": 0, "driver_rating": 1},
    ):
        try:
            ratings.append(int(o["driver_rating"]))
        except (TypeError, ValueError):
            continue
    if not ratings:
        return None
    avg = round(sum(ratings) / len(ratings), 2)
    await db.drivers.update_one({"id": driver_id}, {"$set": {"rating": avg}})
    return avg


async def _recompute_shipper_rating(shipper_id: str) -> Optional[float]:
    """Average all star ratings a shipper has received and persist on profile."""
    ratings: List[int] = []
    async for o in db.orders.find(
        {"shipper_id": shipper_id, "shipper_rating": {"$ne": None}},
        {"_id": 0, "shipper_rating": 1},
    ):
        try:
            ratings.append(int(o["shipper_rating"]))
        except (TypeError, ValueError):
            continue
    if not ratings:
        return None
    avg = round(sum(ratings) / len(ratings), 2)
    await db.shippers.update_one({"id": shipper_id}, {"$set": {"rating": avg}})
    return avg


@api_router.post("/shipper/shipments/{order_id}/rate-driver")
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


@api_router.post("/orders/{order_id}/rate-shipper")
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


# ===================== Wallet Endpoints =====================

@api_router.get("/driver/wallet")
async def get_driver_wallet(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get driver's wallet with transaction history."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    driver_id = payload.get("sub")
    user_type = payload.get("type")
    
    if user_type != "driver":
        raise HTTPException(403, "Driver access required")
    
    # Get all delivered orders for this driver
    history = await db.orders.find(
        {"status": "delivered", "driver_id": driver_id}, 
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


@api_router.get("/driver/performance")
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

    # Delivered orders for THIS driver only (strict per-driver scoping).
    delivered = await db.orders.find(
        {"status": "delivered", "driver_id": driver_id}, {"_id": 0}
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



@api_router.post("/driver/wallet/payout")
async def request_payout(request: PayoutRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Request a payout from driver's wallet."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    driver_id = payload.get("sub")
    
    if request.amount <= 0:
        raise HTTPException(400, "Payout amount must be positive")
    
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


# ===================== Notification Endpoints =====================

@api_router.get("/notifications")
async def get_notifications(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    unread_only: bool = False,
    limit: int = 50,
):
    """Get notifications for the authenticated user."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    
    query = {"recipient_id": user_id}
    if unread_only:
        query["read"] = False
    
    notifications = await db.notifications.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    
    return {"notifications": notifications, "unread_count": len([n for n in notifications if not n.get("read")])}


@api_router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Mark a notification as read."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    
    result = await db.notifications.update_one(
        {"id": notification_id, "recipient_id": user_id},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(404, "Notification not found")
    
    return {"message": "Notification marked as read"}


@api_router.post("/notifications/read-all")
async def mark_all_notifications_read(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Mark all notifications as read for the authenticated user."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    
    result = await db.notifications.update_many(
        {"recipient_id": user_id, "read": False},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"message": f"Marked {result.modified_count} notifications as read"}


@api_router.delete("/notifications/{notification_id}")
async def delete_notification(notification_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Delete a notification."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    
    result = await db.notifications.delete_one({"id": notification_id, "recipient_id": user_id})
    
    if result.deleted_count == 0:
        raise HTTPException(404, "Notification not found")
    
    return {"message": "Notification deleted"}


class PushTokenRegister(BaseModel):
    push_token: str
    user_id: str
    user_type: Literal["driver", "shipper"]
    platform: str = "ios"


@api_router.post("/notifications/register")
async def register_push_token(body: PushTokenRegister):
    """Register a push token for a user."""
    # Store the push token in the user's document
    if body.user_type == "driver":
        await db.drivers.update_one(
            {"id": body.user_id},
            {"$set": {"push_token": body.push_token, "push_platform": body.platform}}
        )
    else:
        await db.shippers.update_one(
            {"id": body.user_id},
            {"$set": {"push_token": body.push_token, "push_platform": body.platform}}
        )
    
    logger.info(f"Registered push token for {body.user_type} {body.user_id}")
    return {"message": "Push token registered"}


async def send_push_notification(
    push_token: str,
    title: str,
    body: str,
    data: Optional[Dict] = None,
):
    """Send a push notification using Expo's push notification service."""
    import httpx
    
    message = {
        "to": push_token,
        "sound": "default",
        "title": title,
        "body": body,
        "data": data or {},
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://exp.host/--/api/v2/push/send",
                json=message,
                headers={"Content-Type": "application/json"},
            )
            if response.status_code == 200:
                logger.info(f"Push notification sent to {push_token[:20]}...")
                return True
            else:
                logger.error(f"Push notification failed: {response.text}")
                return False
    except Exception as e:
        logger.error(f"Push notification error: {e}")
        return False


# ===================== Emergent Push Notifications (SuprSend relay) =====================
# Background push for delivery lifecycle events. The backend is the ONLY caller of the
# Emergent relay; device tokens are resolved internally by the relay via user_id.
EMERGENT_PUSH_BASE_URL = "https://integrations.emergentagent.com"
EMERGENT_PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

_push_client = httpx.AsyncClient(
    base_url=EMERGENT_PUSH_BASE_URL,
    headers={"X-Push-Key": EMERGENT_PUSH_KEY},
    timeout=10.0,
)


class RegisterPushBody(BaseModel):
    user_id: str
    platform: str  # "android" | "ios"
    device_token: str


@api_router.post("/register-push", status_code=201)
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


async def send_push(recipients: list, data: dict, idempotency_key: Optional[str] = None) -> None:
    """Trigger a push to a list of user ids via the Emergent relay.

    `recipients` is a list of app user ids (driver_id / shipper_id). `data` must
    include `title` and `message`. Chunks recipients to 100 per relay call.
    Callers should wrap this in try/except so push failure never blocks the
    primary operation.
    """
    if not recipients:
        return
    recipients = list(dict.fromkeys(recipients))  # dedupe, preserve order
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    for i in range(0, len(recipients), 100):
        chunk = recipients[i:i + 100]
        payload: dict = {"recipients": chunk, "data": data}
        if idempotency_key:
            payload["$idempotency_key"] = f"{idempotency_key}:{i}"
        resp = await _push_client.post("/api/v1/push/trigger", json=payload)
        if resp.status_code == 401:
            raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
        if resp.status_code >= 500:
            raise HTTPException(502, "Push provider unavailable")
        resp.raise_for_status()


async def push_new_job_to_online_drivers(order: dict) -> None:
    """Background push to online drivers (matching vehicle type) on new job."""
    try:
        query: dict = {"is_online": True}
        if order.get("vehicle_type"):
            query["vehicle_type"] = order["vehicle_type"]
        driver_ids = [d["id"] async for d in db.drivers.find(query, {"_id": 0, "id": 1})]
        if not driver_ids:
            return
        await send_push(
            recipients=driver_ids,
            data={
                "title": "New delivery available",
                "message": f"{order.get('order_number', 'New job')} \u2022 \u20ac{order.get('earnings', 0):.2f} near you.",
                "action_url": "/driver-home",
            },
            idempotency_key=f"newjob:{order.get('id')}",
        )
    except Exception as e:
        logger.warning(f"New-job push failed (non-blocking): {e}")


async def push_status_to_shipper(order: dict, event: str) -> None:
    """Background push to the shipper on a lifecycle transition."""
    EVENT_COPY = {
        "accepted": ("Driver assigned", "A driver is on the way to your pickup."),
        "arrived_pickup": ("Driver at pickup", "Your driver has arrived at the pickup location."),
        "arrived_dropoff": ("Arrived at drop-off", "Your driver has arrived at the drop-off location."),
        "delivered": ("Delivered", "Your shipment has been delivered successfully."),
    }
    copy = EVENT_COPY.get(event)
    shipper_id = order.get("shipper_id")
    if not copy or not shipper_id:
        return
    try:
        title, message = copy
        await send_push(
            recipients=[shipper_id],
            data={"title": title, "message": message, "action_url": f"/shipper-tracking?id={order.get('id')}"},
            idempotency_key=f"{event}:{order.get('id')}",
        )
    except Exception as e:
        logger.warning(f"Status push failed (non-blocking): {e}")


async def notify_drivers_of_new_order(order: dict):
    """Notify online drivers about a new available order."""
    # Find online drivers with matching vehicle type
    query = {"is_online": True, "push_token": {"$exists": True, "$ne": None}}
    
    # If order requires specific vehicle, filter drivers
    if order.get("vehicle_type"):
        query["vehicle_type"] = order["vehicle_type"]
    
    drivers = await db.drivers.find(query, {"_id": 0, "push_token": 1, "name": 1}).to_list(50)
    
    for driver in drivers:
        if driver.get("push_token"):
            await send_push_notification(
                driver["push_token"],
                "🚚 New Delivery Available!",
                f"{order.get('order_number', 'New Order')} • {order['pickup'].get('name', 'Pickup')}\nEarn €{order.get('earnings', 0):.2f}",
                {"type": "new_order", "order_id": order.get("id")}
            )
    
    logger.info(f"Notified {len(drivers)} online drivers about new order {order.get('order_number')}")


async def notify_available_drivers(
    order_id: str,
    order_number: str,
    vehicle_type: str,
    pickup_address: str,
    earnings: float
):
    """Notify online drivers about a new order (called when shipper creates shipment)."""
    try:
        # Find online drivers with matching or compatible vehicle types
        query = {"is_online": True, "push_token": {"$exists": True, "$ne": None}}
        
        # Optionally filter by vehicle type
        if vehicle_type:
            query["vehicle_type"] = vehicle_type
        
        online_drivers = await db.drivers.find(query, {"_id": 0, "push_token": 1, "name": 1, "id": 1}).to_list(100)
        
        vehicle_info = VEHICLE_TYPES.get(vehicle_type, {})
        vehicle_name = vehicle_info.get("name", "Vehicle")
        
        notification_count = 0
        for driver in online_drivers:
            if driver.get("push_token"):
                success = await send_push_notification(
                    driver["push_token"],
                    "🚚 New Delivery Available!",
                    f"{vehicle_name} needed • €{earnings:.2f} • {pickup_address[:40]}...",
                    {"type": "new_order", "order_id": order_id, "order_number": order_number}
                )
                if success:
                    notification_count += 1
                    
                # Also create in-app notification
                await create_notification(
                    recipient_id=driver["id"],
                    recipient_type="driver",
                    notification_type="order",
                    title="New Delivery Available",
                    message=f"{vehicle_name} needed • €{earnings:.2f}",
                    data={"order_id": order_id, "order_number": order_number}
                )
        
        logger.info(f"Notified {notification_count} drivers about new shipment {order_number}")
    except Exception as e:
        logger.error(f"Failed to notify drivers: {e}")


async def create_notification(
    recipient_id: str,
    recipient_type: str,
    notification_type: str,
    title: str,
    message: str,
    data: Optional[Dict] = None,
):
    """Helper function to create and store a notification."""
    notification = Notification(
        recipient_id=recipient_id,
        recipient_type=recipient_type,
        type=notification_type,
        title=title,
        message=message,
        data=data,
    )
    await db.notifications.insert_one(notification.model_dump())
    
    # Broadcast to WebSocket if user is connected
    for ws in list(active_connections):
        try:
            await ws.send_text(json.dumps({
                "type": "notification",
                "notification": notification.model_dump(),
            }))
        except Exception:
            pass
    
    return notification


@api_router.post("/orders/seed-new-pending", response_model=Order)
async def seed_new_pending():
    # remove existing pending then create one
    await db.orders.delete_many({"status": "pending"})
    new_order = build_order("pending")
    await db.orders.insert_one(new_order.copy())
    return Order(**new_order)


@api_router.post("/orders/add-pending", response_model=Order)
async def add_pending_order():
    """Add a single pending order without deleting existing ones."""
    new_order = build_order("pending")
    await db.orders.insert_one(new_order.copy())
    return Order(**new_order)


# ===================== Driver Update =====================

@api_router.patch("/driver/me", response_model=Driver)
async def update_driver(update: DriverUpdate, request: Request):
    """Update the authenticated driver's profile."""
    # Get the authenticated driver ID
    driver_id = await get_current_driver_id(request)
    
    payload = {k: v for k, v in update.model_dump(exclude_unset=True).items() if v is not None}
    if payload.get("notifications") is not None:
        payload["notifications"] = update.notifications.model_dump()
    
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


# ===================== Driver Vehicles (multi-vehicle) =====================

def _vehicle_label(vehicle_type: str) -> str:
    info = VEHICLE_TYPES.get(vehicle_type)
    return info["name"] if info else "Vehicle"


def _default_capacity(vehicle_type: str) -> int:
    info = VEHICLE_TYPES.get(vehicle_type)
    return int(info.get("max_weight_kg", 1500)) if info else 1500


async def _ensure_driver_vehicles(driver: dict) -> dict:
    """Lazily migrate legacy single-vehicle drivers into the vehicles[] array."""
    if driver.get("vehicles"):
        return driver
    vt = driver.get("vehicle_type", "cargo_van")
    veh = {
        "id": str(uuid.uuid4()),
        "vehicle_type": vt,
        "label": _vehicle_label(vt),
        "plate": driver.get("plate", ""),
        "capacity_kg": driver.get("vehicle_capacity_kg") or _default_capacity(vt),
        "is_primary": True,
    }
    await db.drivers.update_one({"id": driver["id"]}, {"$set": {"vehicles": [veh]}})
    driver["vehicles"] = [veh]
    return driver


async def _sync_primary_vehicle(driver_id: str, vehicles: list) -> dict:
    """Persist vehicles[] and mirror the primary one into the driver's top-level
    fields (vehicle_type/plate/capacity), which job-matching relies on."""
    primary = next((v for v in vehicles if v.get("is_primary")), vehicles[0] if vehicles else None)
    set_fields: dict = {"vehicles": vehicles}
    if primary:
        label = primary.get("label") or _vehicle_label(primary["vehicle_type"])
        plate = primary.get("plate", "")
        set_fields.update({
            "vehicle_type": primary["vehicle_type"],
            "vehicle_capacity_kg": primary.get("capacity_kg") or _default_capacity(primary["vehicle_type"]),
            "plate": plate,
            "vehicle": f"{label} • {plate}" if plate else label,
        })
    await db.drivers.update_one({"id": driver_id}, {"$set": set_fields})
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    return driver


@api_router.post("/driver/vehicles", response_model=Driver)
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


@api_router.patch("/driver/vehicles/{vehicle_id}", response_model=Driver)
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


@api_router.post("/driver/vehicles/{vehicle_id}/primary", response_model=Driver)
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


@api_router.delete("/driver/vehicles/{vehicle_id}", response_model=Driver)
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


# ===================== Change Password (driver & shipper) =====================

class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=8, max_length=1024)


@api_router.post("/auth/change-password", status_code=200)
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
    return {"status": "ok", "message": "Password updated successfully"}

@api_router.post("/driver/register", response_model=RegistrationResponse)
async def register_driver(registration: DriverRegistration):
    """Register a new driver account."""
    # Check if email already exists
    existing = await db.drivers.find_one({"email": registration.email})
    if existing:
        raise HTTPException(400, "A driver with this email already exists")
    
    # Validate vehicle type
    if registration.vehicle_type not in VEHICLE_TYPES:
        raise HTTPException(400, f"Invalid vehicle type: {registration.vehicle_type}. Valid types: {list(VEHICLE_TYPES.keys())}")
    
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
    vehicle_type: Optional[str] = "cargo_van"  # Default to cargo van
    vehicle_capacity_kg: Optional[int] = None  # Custom capacity for "other" type


class SimpleShipperRegistration(BaseModel):
    business_name: str
    email: str
    password: str
    phone: Optional[str] = None
    preferred_vehicle_type: Optional[str] = None  # Default preferred vehicle


@api_router.post("/auth/driver-register")
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


class ShipperUpdate(BaseModel):
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    tax_id: Optional[str] = None
    avatar: Optional[str] = None
    preferred_vehicle_type: Optional[str] = None


@api_router.patch("/shipper/me")
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


# ===================== Shipper Orders (Shipments) =====================

@api_router.get("/shipper/vehicle-types")
async def get_vehicle_types():
    """Get available vehicle types for shipping."""
    return list(VEHICLE_TYPES.values())


@api_router.post("/shipper/quote", response_model=PriceQuoteResponse)
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


@api_router.post("/shipper/shipments")
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


# Cancellation policy defaults (admin-overridable via db.settings key="policy").
DEFAULT_FREE_CANCEL_MINUTES = 60
DEFAULT_CANCEL_FEE_PCT = 0.15


async def get_cancellation_policy() -> dict:
    """Free-cancel window (minutes) + cancellation fee (% of price) after it."""
    try:
        doc = await db.settings.find_one({"key": "policy"}, {"_id": 0}) or {}
    except Exception:
        doc = {}
    try:
        free_minutes = int(doc.get("free_cancel_minutes", DEFAULT_FREE_CANCEL_MINUTES))
    except Exception:
        free_minutes = DEFAULT_FREE_CANCEL_MINUTES
    try:
        fee_pct = float(doc.get("cancel_fee_pct", DEFAULT_CANCEL_FEE_PCT))
    except Exception:
        fee_pct = DEFAULT_CANCEL_FEE_PCT
    return {"free_cancel_minutes": free_minutes, "cancel_fee_pct": max(0.0, min(1.0, fee_pct))}


@api_router.post("/shipper/shipments/{order_id}/cancel")
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


@api_router.post("/driver/kyc/upload", response_model=KYCStatus)
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


@api_router.post("/driver/kyc/submit", response_model=KYCStatus)
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


# ===================== Google Directions (source of truth for money) =====================
# IMPORTANT: fetch_road_route() is the ONLY distance source allowed for pricing,
# driver earnings, ETA, and Stripe billing. It HARD-FAILS on any non-OK Google
# status and NEVER falls back to Haversine / straight-line distance. Haversine
# remains allowed ONLY for nearby-driver search and geofencing.

_DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"


async def fetch_road_route(
    origin_lat: float, origin_lng: float,
    dest_lat: float, dest_lng: float,
) -> dict:
    """Compute real-world DRIVING route via Google Directions API.

    Returns: {road_distance_km, duration_minutes, polyline,
              distance_meters, duration_seconds, source}

    Raises HTTPException on ANY failure (timeout, HTTP error, or non-OK Google
    status). Pricing/earnings/billing MUST never silently fall back to
    straight-line distance, so callers should let this propagate.
    """
    if not GOOGLE_DIRECTIONS_API_KEY:
        raise HTTPException(503, "Pricing unavailable - routing service not configured")

    # Cache per normalised (origin, dest) pair to save quota. Driving routes are
    # static enough for pricing (no live-traffic component requested).
    cache_key = f"drive|{origin_lat:.5f},{origin_lng:.5f}|{dest_lat:.5f},{dest_lng:.5f}"
    cached = await db.route_pricing_cache.find_one({"key": cache_key}, {"_id": 0})
    if cached and cached.get("data"):
        return cached["data"]

    params = {
        "origin": f"{origin_lat},{origin_lng}",
        "destination": f"{dest_lat},{dest_lng}",
        "mode": "driving",
        "units": "metric",
        "key": GOOGLE_DIRECTIONS_API_KEY,
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=5.0)) as client_http:
            resp = await client_http.get(_DIRECTIONS_URL, params=params)
    except httpx.TimeoutException as exc:
        logger.error("Directions pricing timeout: %s", exc)
        raise HTTPException(503, "Pricing unavailable - route calculation timed out")
    except httpx.HTTPError as exc:
        logger.error("Directions pricing HTTP error: %s", exc)
        raise HTTPException(502, "Pricing unavailable - route service error")

    if resp.status_code != 200:
        logger.error("Directions pricing bad HTTP status: %s", resp.status_code)
        raise HTTPException(502, "Pricing unavailable - route service error")

    data = resp.json()
    status = data.get("status")
    if status != "OK":
        err = data.get("error_message", "")
        logger.error("Directions pricing non-OK status=%s %s", status, err)
        if status == "ZERO_RESULTS":
            raise HTTPException(422, "No drivable route between pickup and drop-off")
        if status == "OVER_QUERY_LIMIT":
            raise HTTPException(503, "Pricing temporarily unavailable - please retry shortly")
        if status == "REQUEST_DENIED":
            raise HTTPException(500, "Pricing unavailable - routing configuration error")
        raise HTTPException(502, f"Pricing unavailable - routing error ({status})")

    routes = data.get("routes") or []
    if not routes or not routes[0].get("legs"):
        raise HTTPException(502, "Pricing unavailable - empty route from routing service")

    leg = routes[0]["legs"][0]
    try:
        distance_meters = int(leg["distance"]["value"])
        duration_seconds = int(leg["duration"]["value"])
        polyline = str(routes[0]["overview_polyline"]["points"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(502, "Pricing unavailable - malformed route from routing service")

    result = {
        "road_distance_km": round(distance_meters / 1000.0, 2),
        "duration_minutes": round(duration_seconds / 60.0, 1),
        "polyline": polyline,
        "distance_meters": distance_meters,
        "duration_seconds": duration_seconds,
        "source": "google",
    }

    try:
        await db.route_pricing_cache.update_one(
            {"key": cache_key},
            {"$set": {"key": cache_key, "data": result, "cached_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
    except Exception as exc:
        logger.warning("route_pricing_cache write failed: %s", exc)

    return result


# Average urban driving speed (km/h) used to estimate live ETA.
_AVG_SPEED_KMH = 32.0
# Distance (km) the driver may stray from the pickup->dropoff corridor before
# being flagged as off-route.
_ROUTE_DEVIATION_KM = 3.0


def _cross_track_km(p_lat, p_lng, a_lat, a_lng, b_lat, b_lng) -> float:
    """Perpendicular (cross-track) distance in km from point P to the
    great-circle path A->B. Used for lightweight route-deviation detection."""
    import math
    R = 6371.0
    d13 = _haversine_km(a_lat, a_lng, p_lat, p_lng) / R  # angular distance A->P

    def bearing(lat1, lng1, lat2, lng2):
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dl = math.radians(lng2 - lng1)
        y = math.sin(dl) * math.cos(phi2)
        x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dl)
        return math.atan2(y, x)

    theta13 = bearing(a_lat, a_lng, p_lat, p_lng)
    theta12 = bearing(a_lat, a_lng, b_lat, b_lng)
    try:
        dxt = math.asin(math.sin(d13) * math.sin(theta13 - theta12)) * R
    except ValueError:
        return 0.0
    return abs(dxt)


# Statuses in which the driver is heading to the pickup vs. to the dropoff.
_PICKUP_PHASE = {"accepted", "enroute_pickup", "arrived_pickup"}
_DROPOFF_PHASE = {"picked_up", "enroute_dropoff", "arrived_dropoff"}


def compute_live_tracking(order: dict, loc: dict) -> dict:
    """Given an order and the driver's current location, compute the live ETA,
    remaining distance, current target (pickup/dropoff) and an off-route flag."""
    lat = loc.get("lat")
    lng = loc.get("lng")
    status = order.get("status")
    pickup = order.get("pickup") or {}
    dropoff = order.get("dropoff") or {}
    if lat is None or lng is None or not pickup or not dropoff:
        return {"eta_minutes": None, "remaining_km": None, "target": None, "off_route": False}

    if status in _DROPOFF_PHASE:
        target, t_lat, t_lng = "dropoff", dropoff.get("lat"), dropoff.get("lng")
    else:
        target, t_lat, t_lng = "pickup", pickup.get("lat"), pickup.get("lng")

    remaining_km = _haversine_km(lat, lng, t_lat, t_lng)
    eta_minutes = max(1, round(remaining_km / _AVG_SPEED_KMH * 60))

    # Route-deviation: only meaningful once moving toward the dropoff.
    off_route = False
    if status in _DROPOFF_PHASE:
        deviation = _cross_track_km(lat, lng, pickup.get("lat"), pickup.get("lng"), dropoff.get("lat"), dropoff.get("lng"))
        off_route = deviation > _ROUTE_DEVIATION_KM

    return {
        "eta_minutes": eta_minutes,
        "remaining_km": round(remaining_km, 2),
        "target": target,
        "off_route": off_route,
    }



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


# ===================== Admin: world-class management API =====================

def _admin_driver_row(d: dict) -> dict:
    vehicles = d.get("vehicles", []) or []
    vcount = len(vehicles) if vehicles else (1 if d.get("vehicle_type") else 0)
    return {
        "id": d.get("id"),
        "name": d.get("name", ""),
        "email": d.get("email", ""),
        "phone": d.get("phone", ""),
        "avatar": d.get("avatar", ""),
        "is_online": d.get("is_online", False),
        "is_suspended": d.get("is_suspended", False),
        "rating": round(float(d.get("rating", 5.0) or 0), 2),
        "acceptance_rate": d.get("acceptance_rate", 0),
        "completion_rate": d.get("completion_rate", 0),
        "vehicle_type": d.get("vehicle_type", ""),
        "vehicles_count": vcount,
        "earnings_today": round(float(d.get("earnings_today", 0.0) or 0), 2),
        "deliveries_today": d.get("deliveries_today", 0),
        "created_at": d.get("created_at"),
    }


def _admin_shipper_row(s: dict, order_count: int) -> dict:
    return {
        "id": s.get("id"),
        "company_name": s.get("company_name", ""),
        "contact_name": s.get("contact_name", ""),
        "email": s.get("email", ""),
        "phone": s.get("phone", ""),
        "avatar": s.get("avatar", ""),
        "address": s.get("address", ""),
        "tax_id": s.get("tax_id", ""),
        "is_suspended": s.get("is_suspended", False),
        "is_verified": s.get("is_verified", False),
        "total_orders": order_count,
        "rating": round(float(s.get("rating", 5.0) or 0), 2),
        "created_at": s.get("created_at"),
    }


def _addr(point) -> str:
    if isinstance(point, dict):
        return point.get("address") or point.get("name") or ""
    return ""


def _admin_order_row(o: dict) -> dict:
    return {
        "id": o.get("id"),
        "order_number": o.get("order_number", ""),
        "status": o.get("status", ""),
        "vehicle_type": o.get("vehicle_type", ""),
        "cargo_weight_kg": o.get("cargo_weight_kg"),
        "distance_km": round(float(o.get("distance_km", 0) or 0), 1),
        "earnings": round(float(o.get("earnings", 0.0) or 0), 2),
        "price_quote": o.get("price_quote"),
        "tip": round(float(o.get("tip", 0.0) or 0), 2),
        "driver_id": o.get("driver_id"),
        "shipper_id": o.get("shipper_id"),
        "pickup": _addr(o.get("pickup")),
        "dropoff": _addr(o.get("dropoff")),
        "created_at": o.get("created_at"),
        "completed_at": o.get("completed_at"),
    }


@api_router.get("/admin/overview")
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


# ---------- Drivers management ----------

@api_router.get("/admin/manage/drivers")
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


@api_router.get("/admin/manage/drivers/{driver_id}")
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


class AdminDriverUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    vehicle_type: Optional[str] = None
    plate: Optional[str] = None


@api_router.patch("/admin/manage/drivers/{driver_id}")
async def admin_update_driver(driver_id: str, body: AdminDriverUpdate, user: dict = Depends(get_admin_user)):
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(400, "No fields to update")
    res = await db.drivers.update_one({"id": driver_id}, {"$set": patch})
    if res.matched_count == 0:
        raise HTTPException(404, "Driver not found")
    d = await db.drivers.find_one({"id": driver_id}, {"_id": 0, "password_hash": 0})
    return _admin_driver_row(d)


@api_router.post("/admin/manage/drivers/{driver_id}/suspend")
async def admin_suspend_driver(driver_id: str, user: dict = Depends(get_admin_user)):
    res = await db.drivers.update_one({"id": driver_id}, {"$set": {"is_suspended": True, "is_online": False}})
    if res.matched_count == 0:
        raise HTTPException(404, "Driver not found")
    return {"status": "suspended", "driver_id": driver_id}


@api_router.post("/admin/manage/drivers/{driver_id}/activate")
async def admin_activate_driver(driver_id: str, user: dict = Depends(get_admin_user)):
    res = await db.drivers.update_one({"id": driver_id}, {"$set": {"is_suspended": False}})
    if res.matched_count == 0:
        raise HTTPException(404, "Driver not found")
    return {"status": "active", "driver_id": driver_id}


# ---------- Shippers management ----------

@api_router.get("/admin/manage/shippers")
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


@api_router.get("/admin/manage/shippers/{shipper_id}")
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


class AdminShipperUpdate(BaseModel):
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    tax_id: Optional[str] = None
    is_verified: Optional[bool] = None


@api_router.patch("/admin/manage/shippers/{shipper_id}")
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


@api_router.post("/admin/manage/shippers/{shipper_id}/suspend")
async def admin_suspend_shipper(shipper_id: str, user: dict = Depends(get_admin_user)):
    res = await db.shippers.update_one({"id": shipper_id}, {"$set": {"is_suspended": True}})
    if res.matched_count == 0:
        raise HTTPException(404, "Shipper not found")
    return {"status": "suspended", "shipper_id": shipper_id}


@api_router.post("/admin/manage/shippers/{shipper_id}/activate")
async def admin_activate_shipper(shipper_id: str, user: dict = Depends(get_admin_user)):
    res = await db.shippers.update_one({"id": shipper_id}, {"$set": {"is_suspended": False}})
    if res.matched_count == 0:
        raise HTTPException(404, "Shipper not found")
    return {"status": "active", "shipper_id": shipper_id}


# ---------- Orders management ----------

@api_router.get("/admin/manage/orders")
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


@api_router.get("/admin/manage/orders/{order_id}")
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


@api_router.post("/admin/manage/orders/{order_id}/cancel")
async def admin_cancel_order(order_id: str, user: dict = Depends(get_admin_user)):
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    if o.get("status") in ("delivered", "cancelled"):
        raise HTTPException(400, f"Cannot cancel an order that is already {o.get('status')}")
    await db.orders.update_one({"id": order_id}, {"$set": {"status": "cancelled"}})
    o2 = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _admin_order_row(o2)


class AdminReassignRequest(BaseModel):
    driver_id: str


@api_router.post("/admin/manage/orders/{order_id}/reassign")
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


# ============================================================
# Order Management (admin) — assignment, lifecycle, notes
# ============================================================

async def _record_assignment(order_id: str, action: str, driver_id: Optional[str],
                             admin_id: Optional[str], note: Optional[str] = None):
    """Append an immutable assignment-history record for auditability."""
    try:
        await db.assignment_history.insert_one({
            "id": str(uuid.uuid4()),
            "order_id": order_id,
            "action": action,          # assigned | reassigned | unassigned | returned_to_marketplace
            "driver_id": driver_id,
            "admin_id": admin_id,
            "note": note,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        logger.warning(f"assignment_history insert failed: {exc}")


class AdminNoteRequest(BaseModel):
    note: str


class AdminReasonRequest(BaseModel):
    reason: Optional[str] = None


@api_router.post("/admin/manage/orders/{order_id}/assign")
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


@api_router.post("/admin/manage/orders/{order_id}/unassign")
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


@api_router.post("/admin/manage/orders/{order_id}/restore")
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


@api_router.post("/admin/manage/orders/{order_id}/pause")
async def admin_pause_order(order_id: str, user: dict = Depends(get_admin_user)):
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    if o["status"] in ("delivered", "cancelled"):
        raise HTTPException(400, f"Cannot pause an order that is {o['status']}")
    await db.orders.update_one({"id": order_id}, {"$set": {"status": "paused"}})
    o2 = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _admin_order_row(o2)


@api_router.post("/admin/manage/orders/{order_id}/complete")
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


@api_router.post("/admin/manage/orders/{order_id}/fail")
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


@api_router.post("/admin/manage/orders/{order_id}/notes")
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


@api_router.get("/admin/manage/orders/{order_id}/assignment-history")
async def admin_assignment_history(order_id: str, user: dict = Depends(get_admin_user)):
    rows = await db.assignment_history.find({"order_id": order_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"history": rows}


# ============================================================
# Invoicing — "Accept Invoice" flow (Net 14 + admin fee)
# ============================================================

DEFAULT_INVOICE_FEE = 9.0   # EUR, configurable via admin settings
DEFAULT_NET_DAYS = 14

NADARUNS_COMPANY = {
    "name": "Nadaruns Oy",
    "address": "Helsinki, Finland",
    "email": "billing@nadaruns.com",
    "phone": "+358 40 000 0000",
    "business_id": "FI-NADARUNS-001",
}


class Invoice(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    invoice_number: str
    order_id: str
    order_number: str
    shipper_id: str
    # Shipper billing snapshot
    shipper_company: str = ""
    shipper_contact: str = ""
    shipper_email: str = ""
    shipper_phone: str = ""
    shipper_address: Optional[str] = None
    shipper_tax_id: Optional[str] = None
    # Order snapshot
    pickup_address: str = ""
    dropoff_address: str = ""
    description: str = "Delivery service"
    order_value: float = 0.0
    invoice_fee: float = 0.0
    total_amount: float = 0.0
    currency: str = "EUR"
    status: str = "unpaid"     # unpaid | paid | overdue | cancelled
    net_days: int = 14
    issued_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    due_date: str = ""
    paid_at: Optional[str] = None
    last_sent_at: Optional[str] = None


async def get_invoicing_settings() -> dict:
    doc = await db.settings.find_one({"key": "invoicing"}, {"_id": 0}) or {}
    try:
        fee = float(doc.get("invoice_fee", DEFAULT_INVOICE_FEE))
    except Exception:
        fee = DEFAULT_INVOICE_FEE
    try:
        net = int(doc.get("net_days", DEFAULT_NET_DAYS))
    except Exception:
        net = DEFAULT_NET_DAYS
    return {"invoice_fee": max(0.0, fee), "net_days": max(1, net)}


async def _next_invoice_number() -> str:
    doc = await db.settings.find_one_and_update(
        {"key": "invoice_counter"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,  # ReturnDocument.AFTER
    )
    seq = (doc or {}).get("seq", 1)
    return f"NDR-{datetime.now(timezone.utc).year}-{1000 + int(seq)}"


async def _create_invoice_for_order(order: dict, shipper: dict) -> dict:
    """Idempotently create (or return existing) invoice for an order."""
    existing = await db.invoices.find_one({"order_id": order["id"]}, {"_id": 0})
    if existing:
        return existing
    settings = await get_invoicing_settings()
    order_value = float(
        order.get("price_quote")
        or order.get("payment_amount")
        or order.get("price")
        or 0.0
    )
    fee = float(settings["invoice_fee"])
    net = int(settings["net_days"])
    now = datetime.now(timezone.utc)
    due = now + timedelta(days=net)
    items = order.get("items") or []
    description = items[0].get("name") if items and isinstance(items[0], dict) else "Delivery service"
    inv = Invoice(
        invoice_number=await _next_invoice_number(),
        order_id=order["id"],
        order_number=order.get("order_number", ""),
        shipper_id=shipper["id"],
        shipper_company=shipper.get("company_name", ""),
        shipper_contact=shipper.get("contact_name", ""),
        shipper_email=shipper.get("email", ""),
        shipper_phone=shipper.get("phone", ""),
        shipper_address=shipper.get("address"),
        shipper_tax_id=shipper.get("tax_id"),
        pickup_address=(order.get("pickup") or {}).get("address", ""),
        dropoff_address=(order.get("dropoff") or {}).get("address", ""),
        description=description,
        order_value=round(order_value, 2),
        invoice_fee=round(fee, 2),
        total_amount=round(order_value + fee, 2),
        net_days=net,
        issued_at=now.isoformat(),
        due_date=due.isoformat(),
    )
    doc = inv.model_dump()
    await db.invoices.insert_one(doc)
    # Motor's insert_one mutates the dict in place to inject an ObjectId `_id`,
    # which is not JSON-serializable. Drop it before returning to clients.
    doc.pop("_id", None)
    await db.orders.update_one(
        {"id": order["id"]},
        {"$set": {"payment_status": "invoiced", "payment_method_choice": "invoice"}},
    )
    logger.info(f"Invoice {inv.invoice_number} created for order {order.get('order_number')}")
    return doc


def _build_invoice_pdf(inv: dict) -> bytes:
    from fpdf import FPDF

    def s(v):
        return str(v if v is not None else "")

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 22)
    pdf.cell(0, 12, "INVOICE", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"Invoice #: {s(inv.get('invoice_number'))}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Issued: {s(inv.get('issued_at'))[:10]}    Due: {s(inv.get('due_date'))[:10]}  (Net {s(inv.get('net_days'))} days)", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Status: {s(inv.get('status')).upper()}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "From", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 5, f"{NADARUNS_COMPANY['name']}  ({NADARUNS_COMPANY['business_id']})", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, NADARUNS_COMPANY["address"], new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, f"{NADARUNS_COMPANY['email']}  |  {NADARUNS_COMPANY['phone']}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "Bill To", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 5, s(inv.get("shipper_company")), new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, f"Attn: {s(inv.get('shipper_contact'))}", new_x="LMARGIN", new_y="NEXT")
    if inv.get("shipper_address"):
        pdf.cell(0, 5, s(inv.get("shipper_address")), new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, f"{s(inv.get('shipper_email'))}  |  {s(inv.get('shipper_phone'))}", new_x="LMARGIN", new_y="NEXT")
    if inv.get("shipper_tax_id"):
        pdf.cell(0, 5, f"Tax ID: {s(inv.get('shipper_tax_id'))}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "Order", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 5, f"Order #: {s(inv.get('order_number'))}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(pdf.l_margin); pdf.multi_cell(pdf.epw, 5, f"Pickup: {s(inv.get('pickup_address'))}")
    pdf.set_x(pdf.l_margin); pdf.multi_cell(pdf.epw, 5, f"Delivery: {s(inv.get('dropoff_address'))}")
    pdf.set_x(pdf.l_margin); pdf.multi_cell(pdf.epw, 5, f"Description: {s(inv.get('description'))}")
    pdf.ln(4)

    cur = s(inv.get("currency") or "EUR")
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(120, 7, "Item", border=1)
    pdf.cell(0, 7, "Amount", border=1, new_x="LMARGIN", new_y="NEXT", align="R")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(120, 7, "Delivery service", border=1)
    pdf.cell(0, 7, f"{cur} {float(inv.get('order_value') or 0):.2f}", border=1, new_x="LMARGIN", new_y="NEXT", align="R")
    pdf.cell(120, 7, "Invoice administration fee", border=1)
    pdf.cell(0, 7, f"{cur} {float(inv.get('invoice_fee') or 0):.2f}", border=1, new_x="LMARGIN", new_y="NEXT", align="R")
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(120, 8, "TOTAL DUE", border=1)
    pdf.cell(0, 8, f"{cur} {float(inv.get('total_amount') or 0):.2f}", border=1, new_x="LMARGIN", new_y="NEXT", align="R")
    pdf.ln(6)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_x(pdf.l_margin); pdf.multi_cell(pdf.epw, 5, f"Payment terms: Net {s(inv.get('net_days'))} days. Please pay by {s(inv.get('due_date'))[:10]}. "
                         f"Reference invoice {s(inv.get('invoice_number'))} with your payment.")
    out = pdf.output()
    return bytes(out)


@api_router.post("/shipper/shipments/{order_id}/accept-invoice")
async def shipper_accept_invoice(order_id: str, shipper: dict = Depends(get_current_shipper)):
    """Shipper chooses 'Accept Invoice' for an order -> generate a Net-14 invoice."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order.get("shipper_id") != shipper["id"]:
        raise HTTPException(403, "This order does not belong to you")
    invoice = await _create_invoice_for_order(order, shipper)
    return invoice


@api_router.get("/shipper/invoices")
async def shipper_list_invoices(shipper: dict = Depends(get_current_shipper)):
    rows = await db.invoices.find({"shipper_id": shipper["id"]}, {"_id": 0}).sort("issued_at", -1).to_list(200)
    return rows


@api_router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(401, "Authentication required")
    payload = decode_token(credentials.credentials)
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        inv = await db.invoices.find_one({"invoice_number": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    # Shippers may only view their own invoices; admins may view all.
    if payload.get("type") == "shipper" and inv.get("shipper_id") != payload.get("sub"):
        raise HTTPException(403, "Not authorized to view this invoice")
    return inv


@api_router.get("/invoices/{invoice_id}/pdf")
async def get_invoice_pdf(invoice_id: str, token: Optional[str] = None,
                          credentials: HTTPAuthorizationCredentials = Depends(security)):
    from fastapi.responses import Response
    # Allow either header auth or ?token= (for direct browser downloads).
    raw = credentials.credentials if credentials else token
    if not raw:
        raise HTTPException(401, "Authentication required")
    payload = decode_token(raw)
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0}) \
        or await db.invoices.find_one({"invoice_number": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if payload.get("type") == "shipper" and inv.get("shipper_id") != payload.get("sub"):
        raise HTTPException(403, "Not authorized")
    pdf_bytes = _build_invoice_pdf(inv)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={inv['invoice_number']}.pdf"},
    )


# ---------- Admin invoice management ----------

@api_router.get("/admin/invoices")
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


@api_router.post("/admin/invoices/{invoice_id}/mark-paid")
async def admin_mark_invoice_paid(invoice_id: str, user: dict = Depends(get_admin_user)):
    res = await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Invoice not found")
    return await db.invoices.find_one({"id": invoice_id}, {"_id": 0})


@api_router.post("/admin/invoices/{invoice_id}/mark-overdue")
async def admin_mark_invoice_overdue(invoice_id: str, user: dict = Depends(get_admin_user)):
    res = await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": "overdue"}})
    if res.matched_count == 0:
        raise HTTPException(404, "Invoice not found")
    return await db.invoices.find_one({"id": invoice_id}, {"_id": 0})


@api_router.post("/admin/invoices/{invoice_id}/resend")
async def admin_resend_invoice(invoice_id: str, user: dict = Depends(get_admin_user)):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"last_sent_at": now_iso}})
    # Email delivery is not wired yet; this records the resend and notifies the shipper in-app.
    try:
        await _notify_shipper_status(inv["shipper_id"], inv["order_id"],
                                     f"Invoice {inv['invoice_number']} has been re-sent. Amount due: EUR {inv.get('total_amount')}.")
    except Exception:
        pass
    return {"ok": True, "last_sent_at": now_iso, "invoice_number": inv["invoice_number"]}


@api_router.get("/admin/settings/invoicing")
async def admin_get_invoicing_settings(user: dict = Depends(get_admin_user)):
    return await get_invoicing_settings()


class InvoicingSettingsRequest(BaseModel):
    invoice_fee: float
    net_days: int = 14


@api_router.post("/admin/settings/invoicing")
async def admin_update_invoicing_settings(body: InvoicingSettingsRequest, user: dict = Depends(get_admin_user)):
    await db.settings.update_one(
        {"key": "invoicing"},
        {"$set": {"key": "invoicing", "invoice_fee": max(0.0, float(body.invoice_fee)), "net_days": max(1, int(body.net_days))}},
        upsert=True,
    )
    return await get_invoicing_settings()


# ---------- Vehicles overview ----------

@api_router.get("/admin/manage/vehicles")
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


# ===================== WebSocket Real-time Tracking =====================

class ConnectionManager:
    """Manages WebSocket connections for real-time tracking."""
    
    def __init__(self):
        # Map of order_id -> set of WebSocket connections (shippers watching this order)
        self.order_subscribers: Dict[str, Set[WebSocket]] = {}
        # Map of driver_id -> WebSocket connection
        self.driver_connections: Dict[str, WebSocket] = {}
        # Map of driver_id -> current location
        self.driver_locations: Dict[str, dict] = {}
    
    async def connect_shipper(self, websocket: WebSocket, order_id: str):
        """Connect a shipper to watch an order's driver location."""
        await websocket.accept()
        if order_id not in self.order_subscribers:
            self.order_subscribers[order_id] = set()
        self.order_subscribers[order_id].add(websocket)
        logger.info(f"Shipper connected to watch order {order_id}")
    
    async def connect_driver(self, websocket: WebSocket, driver_id: str):
        """Connect a driver for location updates."""
        await websocket.accept()
        self.driver_connections[driver_id] = websocket
        logger.info(f"Driver {driver_id} connected for location tracking")
    
    def disconnect_shipper(self, websocket: WebSocket, order_id: str):
        """Disconnect a shipper from watching an order."""
        if order_id in self.order_subscribers:
            self.order_subscribers[order_id].discard(websocket)
            if not self.order_subscribers[order_id]:
                del self.order_subscribers[order_id]
        logger.info(f"Shipper disconnected from order {order_id}")
    
    def disconnect_driver(self, driver_id: str):
        """Disconnect a driver."""
        if driver_id in self.driver_connections:
            del self.driver_connections[driver_id]
        if driver_id in self.driver_locations:
            del self.driver_locations[driver_id]
        logger.info(f"Driver {driver_id} disconnected")
    
    async def broadcast_driver_location(self, driver_id: str, location: dict, order_id: str):
        """Broadcast driver location to all shippers watching the order."""
        self.driver_locations[driver_id] = location
        
        if order_id in self.order_subscribers:
            message = json.dumps({
                "type": "location_update",
                "driver_id": driver_id,
                "order_id": order_id,
                "location": location,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            disconnected = []
            for ws in self.order_subscribers[order_id]:
                try:
                    await ws.send_text(message)
                except Exception:
                    disconnected.append(ws)
            
            # Clean up disconnected websockets
            for ws in disconnected:
                self.order_subscribers[order_id].discard(ws)
    
    async def broadcast_order_status(self, order_id: str, status: str, data: dict = None):
        """Broadcast order status update to all watchers."""
        if order_id in self.order_subscribers:
            message = json.dumps({
                "type": "status_update",
                "order_id": order_id,
                "status": status,
                "data": data or {},
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            disconnected = []
            for ws in self.order_subscribers[order_id]:
                try:
                    await ws.send_text(message)
                except Exception:
                    disconnected.append(ws)
            
            for ws in disconnected:
                self.order_subscribers[order_id].discard(ws)


# Global connection manager instance
ws_manager = ConnectionManager()

# Global set for tracking all active WebSocket connections (for broadcasts)
active_connections: Set[WebSocket] = set()


@app.websocket("/ws/track/{order_id}")
async def websocket_track_order(websocket: WebSocket, order_id: str):
    """
    WebSocket endpoint for shippers to track their order in real-time.
    Receives driver location updates and order status changes.
    """
    await ws_manager.connect_shipper(websocket, order_id)
    
    try:
        # Send initial order data
        order = await db.orders.find_one({"id": order_id})
        if order:
            # Get driver location if available
            driver_location = None
            if order.get("driver_id"):
                driver = await db.drivers.find_one({"id": order["driver_id"]})
                if driver and driver.get("current_location"):
                    driver_location = driver["current_location"]
            
            await websocket.send_text(json.dumps({
                "type": "initial_state",
                "order_id": order_id,
                "status": order.get("status"),
                "driver_location": driver_location,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }))
        
        # Keep connection alive and listen for messages
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                # Handle ping/pong to keep connection alive
                if data == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                # Send ping to check if client is still connected
                try:
                    await websocket.send_text(json.dumps({"type": "ping"}))
                except Exception:
                    break
                    
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect_shipper(websocket, order_id)


@app.websocket("/ws/driver/{driver_id}")
async def websocket_driver_location(websocket: WebSocket, driver_id: str):
    """
    WebSocket endpoint for drivers to send their location updates.
    Also receives order assignments and notifications.
    """
    await ws_manager.connect_driver(websocket, driver_id)
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "location_update":
                location = message.get("location", {})
                order_id = message.get("order_id")
                
                # Update driver location in database
                await db.drivers.update_one(
                    {"id": driver_id},
                    {"$set": {
                        "current_location": location,
                        "location_updated_at": datetime.now(timezone.utc).isoformat()
                    }}
                )
                
                # If driver has an active order, broadcast to watchers
                if order_id:
                    await ws_manager.broadcast_driver_location(driver_id, location, order_id)
                
            elif message.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
                
    except WebSocketDisconnect:
        pass
    except json.JSONDecodeError:
        pass
    finally:
        ws_manager.disconnect_driver(driver_id)


# API endpoint to update driver location (fallback for HTTP polling)
@api_router.post("/driver/location")
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


# API endpoint to get driver location (for shippers polling)
@api_router.get("/orders/{order_id}/driver-location")
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


# ===================== Chat System =====================

class ChatManager:
    """Manages WebSocket connections for chat."""
    
    def __init__(self):
        # Map of order_id -> list of chat participants (WebSocket, user_id, user_type, user_name)
        self.chat_rooms: Dict[str, list] = {}
    
    async def join_room(self, websocket: WebSocket, order_id: str, user_id: str, user_type: str, user_name: str):
        """Join a chat room for an order."""
        await websocket.accept()
        if order_id not in self.chat_rooms:
            self.chat_rooms[order_id] = []
        self.chat_rooms[order_id].append({
            "ws": websocket,
            "user_id": user_id,
            "user_type": user_type,
            "user_name": user_name,
        })
        logger.info(f"User {user_name} ({user_type}) joined chat for order {order_id}")
        
        # Send chat history
        messages = await db.chat_messages.find({"order_id": order_id}).sort("timestamp", 1).to_list(100)
        history = [{
            "id": str(m.get("_id", m.get("id", ""))),
            "order_id": m["order_id"],
            "sender_id": m["sender_id"],
            "sender_type": m["sender_type"],
            "sender_name": m["sender_name"],
            "message": m["message"],
            "timestamp": m["timestamp"],
            "read": m.get("read", False),
        } for m in messages]
        
        await websocket.send_text(json.dumps({"type": "chat_history", "messages": history}))
    
    def leave_room(self, websocket: WebSocket, order_id: str):
        """Leave a chat room."""
        if order_id in self.chat_rooms:
            self.chat_rooms[order_id] = [p for p in self.chat_rooms[order_id] if p["ws"] != websocket]
            if not self.chat_rooms[order_id]:
                del self.chat_rooms[order_id]
    
    async def send_message(self, order_id: str, sender_id: str, sender_type: str, sender_name: str, message: str):
        """Send a message to all participants in a chat room."""
        msg_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()
        
        # Save to database
        msg_doc = {
            "id": msg_id,
            "order_id": order_id,
            "sender_id": sender_id,
            "sender_type": sender_type,
            "sender_name": sender_name,
            "message": message,
            "timestamp": timestamp,
            "read": False,
        }
        await db.chat_messages.insert_one(dict(msg_doc))
        
        # Broadcast to all participants
        if order_id in self.chat_rooms:
            msg_data = json.dumps({
                "type": "new_message",
                "message": {
                    "id": msg_id,
                    "order_id": order_id,
                    "sender_id": sender_id,
                    "sender_type": sender_type,
                    "sender_name": sender_name,
                    "message": message,
                    "timestamp": timestamp,
                    "read": False,
                },
            })
            
            disconnected = []
            for participant in self.chat_rooms[order_id]:
                try:
                    await participant["ws"].send_text(msg_data)
                except Exception:
                    disconnected.append(participant)
            
            # Clean up disconnected
            for p in disconnected:
                self.chat_rooms[order_id].remove(p)
        
        # Send push notification to other participants
        order = await db.orders.find_one({"id": order_id})
        if order:
            # Notify driver if sender is not the driver
            if sender_type != "driver" and order.get("driver_id"):
                await send_push_notification(
                    order["driver_id"],
                    f"Message from {sender_name}",
                    message[:100],
                    {"type": "chat", "order_id": order_id}
                )
            # Notify shipper if sender is not the shipper
            if sender_type != "shipper" and order.get("shipper_id"):
                await send_push_notification(
                    order["shipper_id"],
                    f"Message from {sender_name}",
                    message[:100],
                    {"type": "chat", "order_id": order_id}
                )
        
        return msg_doc
    
    async def mark_messages_read(self, order_id: str, user_id: str, message_ids: list):
        """Mark messages as read."""
        await db.chat_messages.update_many(
            {"id": {"$in": message_ids}, "order_id": order_id},
            {"$set": {"read": True}}
        )
        
        # Notify other participants
        if order_id in self.chat_rooms:
            msg_data = json.dumps({
                "type": "messages_read",
                "message_ids": message_ids,
                "read_by": user_id,
            })
            for participant in self.chat_rooms[order_id]:
                if participant["user_id"] != user_id:
                    try:
                        await participant["ws"].send_text(msg_data)
                    except Exception:
                        pass


# Global chat manager
chat_manager = ChatManager()


@app.websocket("/ws/chat/{order_id}")
async def websocket_chat(websocket: WebSocket, order_id: str, user_id: str, user_type: str, user_name: str):
    """WebSocket endpoint for real-time chat."""
    await chat_manager.join_room(websocket, order_id, user_id, user_type, user_name)
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "send_message":
                await chat_manager.send_message(
                    order_id,
                    user_id,
                    user_type,
                    user_name,
                    message.get("message", "")
                )
            elif message.get("type") == "mark_read":
                await chat_manager.mark_messages_read(
                    order_id,
                    user_id,
                    message.get("message_ids", [])
                )
            elif message.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
                
    except WebSocketDisconnect:
        pass
    except json.JSONDecodeError:
        pass
    finally:
        chat_manager.leave_room(websocket, order_id)


# API endpoint to get chat history (fallback)
@api_router.get("/orders/{order_id}/chat")
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


# API endpoint to send a chat message (fallback)
@api_router.post("/orders/{order_id}/chat")
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


# ===================== Payments (Stripe Auth -> Capture) =====================

def _auth_payload(credentials: HTTPAuthorizationCredentials):
    if not credentials:
        raise HTTPException(401, "Authentication required")
    return decode_token(credentials.credentials)


def _public_base(request: Request) -> str:
    """Best-effort public origin for Stripe success/cancel URLs."""
    env = os.environ.get("PUBLIC_BASE_URL")
    if env:
        return env.rstrip("/")
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "https"
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


def _payment_summary(order: dict) -> dict:
    return {
        "order_id": order.get("id"),
        "order_number": order.get("order_number"),
        "payment_status": order.get("payment_status", "unpaid"),
        "payment_amount": order.get("payment_amount"),
        "commission_amount": order.get("commission_amount"),
        "driver_payout_amount": order.get("driver_payout_amount"),
        "currency": "EUR",
        "stripe_payment_intent_id": order.get("stripe_payment_intent_id"),
        "authorized_at": order.get("authorized_at"),
        "captured_at": order.get("captured_at"),
    }


# ---------- Shipper saved payment methods (Stripe SetupIntent via Checkout) ----------

async def _get_or_create_shipper_customer(shipper: dict) -> str:
    """Resolve (or lazily create) the Stripe Customer for a shipper.

    The customer id is persisted on the shipper document and reused for both
    saved-card setup and future off-session charges.
    """
    sid = shipper.get("id")
    doc = await db.shippers.find_one({"id": sid}, {"_id": 0, "stripe_customer_id": 1})
    existing = (doc or {}).get("stripe_customer_id")
    if existing:
        return existing
    customer = payments.create_customer(
        email=shipper.get("email"),
        name=shipper.get("company_name") or shipper.get("contact_name"),
        metadata={"shipper_id": sid},
    )
    await db.shippers.update_one({"id": sid}, {"$set": {"stripe_customer_id": customer.id}})
    return customer.id


class SetupCheckoutBody(BaseModel):
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


@api_router.post("/shipper/payment-methods/setup-checkout")
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


@api_router.get("/shipper/payment-methods")
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


async def _assert_pm_owned(shipper: dict, payment_method_id: str) -> str:
    sid = shipper.get("id")
    doc = await db.shippers.find_one({"id": sid}, {"_id": 0, "stripe_customer_id": 1})
    customer_id = (doc or {}).get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(400, "No saved cards for this account")
    try:
        pm = payments.retrieve_payment_method(payment_method_id)
    except Exception:
        raise HTTPException(404, "Payment method not found")
    if getattr(pm, "customer", None) != customer_id:
        raise HTTPException(403, "Payment method does not belong to this account")
    return customer_id


@api_router.post("/shipper/payment-methods/{payment_method_id}/default")
async def shipper_set_default_card(payment_method_id: str, shipper: dict = Depends(get_current_shipper)):
    customer_id = await _assert_pm_owned(shipper, payment_method_id)
    payments.set_default_payment_method(customer_id, payment_method_id)
    return {"ok": True, "default_payment_method_id": payment_method_id}


@api_router.delete("/shipper/payment-methods/{payment_method_id}")
async def shipper_delete_card(payment_method_id: str, shipper: dict = Depends(get_current_shipper)):
    await _assert_pm_owned(shipper, payment_method_id)
    payments.detach_payment_method(payment_method_id)
    return {"ok": True}



async def _record_ledger(order: dict, intent, kind: str, status: str, split: dict):
    """Idempotently write a payment ledger entry (authorization | capture | refund)."""
    intent_id = getattr(intent, "id", None)
    if intent_id:
        exists = await db.payment_transactions.find_one(
            {"stripe_payment_intent_id": intent_id, "type": kind}
        )
        if exists:
            return
    charge_id = getattr(intent, "latest_charge", None)
    doc = {
        "id": str(uuid.uuid4()),
        "order_id": order.get("id"),
        "order_number": order.get("order_number"),
        "shipper_id": order.get("shipper_id"),
        "driver_id": order.get("driver_id"),
        "type": kind,
        "gross_amount": split["gross_amount"],
        "commission_amount": split["commission_amount"],
        "driver_amount": split["driver_amount"],
        "commission_rate": split["commission_rate"],
        "currency": "EUR",
        "stripe_payment_intent_id": intent_id,
        "stripe_charge_id": charge_id,
        "status": status,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.payment_transactions.insert_one(doc)


async def _apply_intent_to_order(order: dict, intent) -> dict:
    """Map a Stripe PaymentIntent onto our order + ledger. Returns updated fields."""
    order_id = order["id"]
    new_status = payments.map_intent_status(getattr(intent, "status", ""))
    now = datetime.now(timezone.utc).isoformat()
    driver_share = float(order.get("earnings") or 0)

    auth_gross = payments.from_cents(getattr(intent, "amount", 0) or 0)
    split = payments.commission_split(auth_gross, driver_share)

    updates: dict = {
        "payment_status": new_status,
        "stripe_payment_intent_id": getattr(intent, "id", order.get("stripe_payment_intent_id")),
        "payment_amount": split["gross_amount"],
        "commission_amount": split["commission_amount"],
        "driver_payout_amount": split["driver_amount"],
    }

    if new_status == "authorized" and not order.get("authorized_at"):
        updates["authorized_at"] = now
        await _record_ledger(order, intent, "authorization", "pending", split)
        # Order is now PAID — publish it to the driver marketplace.
        if order.get("status") == "pending":
            asyncio.create_task(notify_available_drivers(
                order_id=order_id,
                order_number=order.get("order_number", order_id),
                vehicle_type=order.get("vehicle_type"),
                pickup_address=(order.get("pickup") or {}).get("address", ""),
                earnings=float(order.get("earnings") or 0),
            ))
            asyncio.create_task(push_new_job_to_online_drivers({**order, **updates}))

    if new_status == "captured":
        captured_gross = payments.from_cents(
            getattr(intent, "amount_received", 0) or getattr(intent, "amount", 0) or 0
        )
        csplit = payments.commission_split(captured_gross, driver_share)
        updates["payment_amount"] = csplit["gross_amount"]
        updates["commission_amount"] = csplit["commission_amount"]
        updates["driver_payout_amount"] = csplit["driver_amount"]
        if not order.get("captured_at"):
            updates["captured_at"] = now
        await _record_ledger(order, intent, "capture", "completed", csplit)

    await db.orders.update_one({"id": order_id}, {"$set": updates})
    order.update(updates)
    return updates


async def _sync_order_payment(order: dict) -> dict:
    """Pull the authoritative payment state from Stripe and reconcile the order."""
    intent_id = order.get("stripe_payment_intent_id")
    if not intent_id and order.get("stripe_checkout_session_id"):
        try:
            sess = payments.retrieve_session(order["stripe_checkout_session_id"])
            intent_id = getattr(sess, "payment_intent", None) or (sess.get("payment_intent") if isinstance(sess, dict) else None)
            if intent_id:
                await db.orders.update_one({"id": order["id"]}, {"$set": {"stripe_payment_intent_id": intent_id}})
                order["stripe_payment_intent_id"] = intent_id
        except Exception as exc:
            logger.warning(f"Could not retrieve checkout session for {order.get('id')}: {exc}")
    if not intent_id:
        return {}
    try:
        intent = payments.retrieve_payment_intent(intent_id)
    except Exception as exc:
        logger.warning(f"Could not retrieve PaymentIntent {intent_id}: {exc}")
        return {}
    return await _apply_intent_to_order(order, intent)


async def _auto_capture_on_delivery(order_id: str) -> dict:
    """Capture an authorized payment when its order is delivered."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return {}
    status = order.get("payment_status")
    if status not in ("authorized", "pending"):
        return {}
    # If still pending, sync once in case the authorization just landed.
    if status == "pending":
        upd = await _sync_order_payment(order)
        order.update(upd)
        if order.get("payment_status") != "authorized":
            return {}
    intent_id = order.get("stripe_payment_intent_id")
    if not intent_id:
        return {}
    intent = payments.capture_payment_intent(intent_id)
    return await _apply_intent_to_order(order, intent)


async def compute_driver_balance(driver_id: str) -> dict:
    """Driver wallet balance derived from captured payments + cash-out requests."""
    def share(o):
        v = o.get("driver_payout_amount")
        if v is None:
            v = float(o.get("earnings") or 0) + float(o.get("tip") or 0)
        return float(v or 0)

    captured = await db.orders.find(
        {"driver_id": driver_id, "payment_status": "captured"},
        {"_id": 0, "driver_payout_amount": 1, "earnings": 1, "tip": 1},
    ).to_list(2000)
    captured_total = round(sum(share(o) for o in captured), 2)

    authorized = await db.orders.find(
        {"driver_id": driver_id, "payment_status": "authorized"},
        {"_id": 0, "driver_payout_amount": 1, "earnings": 1, "tip": 1},
    ).to_list(2000)
    pending_total = round(sum(share(o) for o in authorized), 2)

    # Legacy / demo delivered orders that never went through Stripe still count.
    legacy = await db.orders.find(
        {"driver_id": driver_id, "status": "delivered", "payment_status": {"$in": [None, "unpaid"]}},
        {"_id": 0, "earnings": 1, "tip": 1},
    ).to_list(2000)
    legacy_total = round(sum(float(o.get("earnings") or 0) + float(o.get("tip") or 0) for o in legacy), 2)

    wds = await db.withdrawal_requests.find(
        {"driver_id": driver_id, "status": {"$in": ["pending", "approved", "paid"]}},
        {"_id": 0, "amount": 1},
    ).to_list(2000)
    withdrawn = round(sum(float(w.get("amount") or 0) for w in wds), 2)

    earned = round(captured_total + legacy_total, 2)
    available = round(earned - withdrawn, 2)
    return {
        "available_balance": max(0.0, available),
        "pending_balance": pending_total,
        "total_earned": earned,
        "total_withdrawn": withdrawn,
        "currency": "EUR",
    }


@api_router.get("/payments/config")
async def payments_config():
    return {
        "configured": payments.is_configured(),
        "test_mode": payments.is_test_key(),
        "currency": "EUR",
    }


@api_router.post("/payments/orders/{order_id}/checkout")
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


class PayWithCardBody(BaseModel):
    payment_method_id: str


@api_router.post("/payments/orders/{order_id}/pay-with-saved-card")
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


@api_router.post("/payments/orders/{order_id}/authorize-test")
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


@api_router.get("/payments/orders/{order_id}/status")
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


@api_router.post("/payments/orders/{order_id}/capture")
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


@api_router.post("/payments/orders/{order_id}/cancel-authorization")
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


@api_router.get("/payments/return", response_class=HTMLResponse)
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


@api_router.post("/payments/webhook")
async def stripe_webhook(request: Request):
    """Stripe webhook: verifies signature (when configured) and reconciles orders."""
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

    etype = event.get("type") if isinstance(event, dict) else event["type"]
    obj = (event.get("data", {}) or {}).get("object", {}) if isinstance(event, dict) else event["data"]["object"]

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
            try:
                intent = payments.retrieve_payment_intent(intent_id)
                await _apply_intent_to_order(order, intent)
            except Exception as exc:
                logger.warning(f"Webhook reconcile failed for {intent_id}: {exc}")

    return {"received": True}


# ===================== Driver Wallet & Cash-out =====================

@api_router.get("/wallet/driver")
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


@api_router.post("/wallet/withdraw")
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


@api_router.get("/wallet/withdrawals")
async def wallet_withdrawals(credentials: HTTPAuthorizationCredentials = Depends(security)):
    payload = _auth_payload(credentials)
    if payload.get("type") != "driver":
        raise HTTPException(403, "Driver access required")
    items = await db.withdrawal_requests.find(
        {"driver_id": payload["sub"]}, {"_id": 0}
    ).sort("requested_at", -1).limit(100).to_list(100)
    return {"withdrawals": items}


# ===================== Admin: Financial Management =====================

@api_router.get("/admin/financials/overview")
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


@api_router.get("/admin/financials/transactions")
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


@api_router.get("/admin/payments/authorized")
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


@api_router.get("/admin/financials/withdrawals")
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


async def _process_withdrawal(withdrawal_id: str, new_status: str, admin_id: str,
                              reference: Optional[str] = None, note: Optional[str] = None):
    wr = await db.withdrawal_requests.find_one({"id": withdrawal_id}, {"_id": 0})
    if not wr:
        raise HTTPException(404, "Withdrawal request not found")
    updates = {
        "status": new_status,
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "processed_by": admin_id,
    }
    if reference is not None:
        updates["reference"] = reference
    if note is not None:
        updates["note"] = note
    await db.withdrawal_requests.update_one({"id": withdrawal_id}, {"$set": updates})
    wr.update(updates)

    title = {"approved": "Cash-out approved", "paid": "Cash-out paid", "rejected": "Cash-out rejected"}.get(new_status, "Cash-out update")
    msg = {
        "approved": f"Your cash-out of €{wr['amount']:.2f} was approved and is being processed.",
        "paid": f"Your cash-out of €{wr['amount']:.2f} has been paid." + (f" Ref: {reference}" if reference else ""),
        "rejected": f"Your cash-out of €{wr['amount']:.2f} was rejected." + (f" {note}" if note else ""),
    }.get(new_status, "Your cash-out status changed.")
    await db.notifications.insert_one(Notification(
        recipient_id=wr["driver_id"], recipient_type="driver", type="payment",
        title=title, message=msg, data={"withdrawal_id": withdrawal_id},
    ).model_dump())
    return wr


@api_router.post("/admin/financials/withdrawals/{withdrawal_id}/approve")
async def admin_approve_withdrawal(withdrawal_id: str, user: dict = Depends(get_admin_user)):
    return await _process_withdrawal(withdrawal_id, "approved", user["id"])


@api_router.post("/admin/financials/withdrawals/{withdrawal_id}/pay")
async def admin_pay_withdrawal(withdrawal_id: str, body: WithdrawalPayBody, user: dict = Depends(get_admin_user)):
    return await _process_withdrawal(withdrawal_id, "paid", user["id"], reference=body.reference, note=body.note)


@api_router.post("/admin/financials/withdrawals/{withdrawal_id}/reject")
async def admin_reject_withdrawal(withdrawal_id: str, body: WithdrawalRejectBody, user: dict = Depends(get_admin_user)):
    return await _process_withdrawal(withdrawal_id, "rejected", user["id"], note=body.reason)


# ===================== Admin: Live Dispatch Map =====================

@api_router.get("/admin/dispatch/map")
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


# ===================== Admin: Stripe Settings =====================

async def load_stripe_settings():
    """Load Stripe credentials from DB on startup, or seed DB from env."""
    try:
        doc = await db.settings.find_one({"key": "stripe"}, {"_id": 0})
        if doc:
            payments.configure(
                test_key=doc.get("test_secret_key", ""),
                live_key=doc.get("live_secret_key", ""),
                mode=doc.get("mode", "test"),
                webhook_secret=doc.get("webhook_secret", ""),
            )
            logger.info("Loaded Stripe settings from DB (mode=%s)", doc.get("mode"))
        else:
            await db.settings.update_one(
                {"key": "stripe"},
                {"$set": {
                    "key": "stripe",
                    "test_secret_key": payments.STRIPE_TEST_KEY,
                    "live_secret_key": payments.STRIPE_LIVE_KEY,
                    "mode": payments.STRIPE_MODE,
                    "webhook_secret": payments.STRIPE_WEBHOOK_SECRET,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )
            logger.info("Seeded Stripe settings into DB from environment")
    except Exception as exc:
        logger.warning(f"Could not load Stripe settings: {exc}")


async def _persist_stripe_settings(admin_id: Optional[str] = None):
    await db.settings.update_one(
        {"key": "stripe"},
        {"$set": {
            "key": "stripe",
            "test_secret_key": payments.STRIPE_TEST_KEY,
            "live_secret_key": payments.STRIPE_LIVE_KEY,
            "mode": payments.STRIPE_MODE,
            "webhook_secret": payments.STRIPE_WEBHOOK_SECRET,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": admin_id,
        }},
        upsert=True,
    )


@api_router.get("/admin/settings/stripe")
async def admin_get_stripe_settings(user: dict = Depends(get_admin_user)):
    return payments.get_status()


@api_router.post("/admin/settings/stripe")
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


# ===================== Fleet / Company Management (Phase 1) =====================

async def _get_driver_doc(credentials: HTTPAuthorizationCredentials) -> dict:
    """Return the full authenticated driver document (403 for non-drivers)."""
    user = await get_current_user(credentials)
    if user["type"] != "driver":
        raise HTTPException(403, "Driver access required")
    return user["driver"]


async def _require_company_owner(credentials: HTTPAuthorizationCredentials):
    """Return (driver_doc, company_doc), ensuring the driver OWNS a company."""
    driver = await _get_driver_doc(credentials)
    company_id = driver.get("company_id")
    if not company_id or driver.get("company_role") != "owner":
        raise HTTPException(403, "Company owner access required")
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(404, "Company not found")
    return driver, company


def _public_driver(d: dict) -> dict:
    """Driver fields safe to expose to a company owner (never finances/hash)."""
    return {
        "id": d.get("id"),
        "name": d.get("name"),
        "email": d.get("email"),
        "phone": d.get("phone"),
        "avatar": d.get("avatar"),
        "vehicle_type": d.get("vehicle_type"),
        "company_role": d.get("company_role"),
        "is_suspended": d.get("is_suspended", False),
        "is_online": d.get("is_online", False),
        "rating": d.get("rating", 5.0),
        "deliveries_today": d.get("deliveries_today", 0),
        "created_at": d.get("created_at"),
    }


@api_router.post("/company")
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


@api_router.get("/company/me")
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


@api_router.patch("/company")
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


# ---- Drivers tab ----

@api_router.get("/company/drivers")
async def list_company_drivers(credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    drivers = [_public_driver(d) async for d in db.drivers.find({"company_id": company["id"]}, {"_id": 0})]
    drivers.sort(key=lambda d: (d.get("company_role") != "owner", (d.get("name") or "").lower()))
    return {"drivers": drivers}


@api_router.post("/company/drivers")
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


async def _get_company_driver(company_id: str, driver_id: str) -> dict:
    target = await db.drivers.find_one({"id": driver_id, "company_id": company_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Driver not found in your company")
    return target


@api_router.patch("/company/drivers/{driver_id}/suspend")
async def suspend_company_driver(driver_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    owner, company = await _require_company_owner(credentials)
    target = await _get_company_driver(company["id"], driver_id)
    if target.get("company_role") == "owner":
        raise HTTPException(400, "The company owner cannot be suspended")
    await db.drivers.update_one({"id": driver_id}, {"$set": {"is_suspended": True, "is_online": False}})
    return {"success": True}


@api_router.patch("/company/drivers/{driver_id}/activate")
async def activate_company_driver(driver_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    owner, company = await _require_company_owner(credentials)
    await _get_company_driver(company["id"], driver_id)
    await db.drivers.update_one({"id": driver_id}, {"$set": {"is_suspended": False}})
    return {"success": True}


@api_router.delete("/company/drivers/{driver_id}")
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


# ---- Vehicles tab ----

@api_router.get("/company/vehicles")
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


@api_router.post("/company/vehicles")
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


async def _get_company_vehicle(company_id: str, vehicle_id: str) -> dict:
    v = await db.fleet_vehicles.find_one({"id": vehicle_id, "company_id": company_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vehicle not found in your company")
    return v


@api_router.patch("/company/vehicles/{vehicle_id}")
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


@api_router.post("/company/vehicles/{vehicle_id}/assign")
async def assign_vehicle_driver(vehicle_id: str, body: AssignDriverRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    await _get_company_vehicle(company["id"], vehicle_id)
    await _get_company_driver(company["id"], body.driver_id)
    await db.fleet_vehicles.update_one({"id": vehicle_id}, {"$set": {"assigned_driver_id": body.driver_id}})
    fresh = await db.fleet_vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    return {"vehicle": fresh}


@api_router.post("/company/vehicles/{vehicle_id}/unassign")
async def unassign_vehicle_driver(vehicle_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    await _get_company_vehicle(company["id"], vehicle_id)
    await db.fleet_vehicles.update_one({"id": vehicle_id}, {"$set": {"assigned_driver_id": None}})
    fresh = await db.fleet_vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    return {"vehicle": fresh}


@api_router.delete("/company/vehicles/{vehicle_id}")
async def delete_company_vehicle(vehicle_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    driver, company = await _require_company_owner(credentials)
    res = await db.fleet_vehicles.delete_one({"id": vehicle_id, "company_id": company["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Vehicle not found in your company")
    return {"success": True}


# ---- Company jobs visibility & owner assignment (Phase 2) ----

@api_router.get("/company/jobs")
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


@api_router.post("/company/jobs/{order_id}/assign")
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


# ===================== Lifecycle =====================

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def backfill_pickup_locations():
    """Populate GeoJSON pickup_location on orders that predate the 2dsphere index."""
    try:
        res = await db.orders.update_many(
            {"$or": [{"pickup_location": {"$exists": False}}, {"pickup_location": None}],
             "pickup.lat": {"$type": "number"}, "pickup.lng": {"$type": "number"}},
            [{"$set": {"pickup_location": {"type": "Point", "coordinates": ["$pickup.lng", "$pickup.lat"]}}}],
        )
        if res.modified_count:
            logger.info("Backfilled pickup_location for %d orders", res.modified_count)
    except Exception as exc:
        logger.warning(f"pickup_location backfill failed: {exc}")


@app.on_event("startup")
async def on_startup():
    await ensure_seed()
    await load_stripe_settings()
    await backfill_pickup_locations()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
