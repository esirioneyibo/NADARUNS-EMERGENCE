from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
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
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal, Tuple, Dict, Set
import uuid
from datetime import datetime, timezone, timedelta

# Service layer (production-grade business logic extracted from this monolith)
from services import order_state_machine as sm
from services import audit
from services import idempotency
from services import pricing
from services import payments
from services import email_service
from services import email_templates as email_tpl


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


# ===================== Transactional Email =====================

def send_email_bg(to_email: Optional[str], subject: str, html: str, *,
                  to_name: Optional[str] = None, category: str = "general",
                  related_id: Optional[str] = None, attachments: Optional[list] = None) -> None:
    """Schedule a branded transactional email without blocking the response.

    Fire-and-forget: a failure here must never break the API request. Every
    send is persisted to ``email_logs`` by the service for an audit trail.
    """
    if not to_email:
        return

    async def _run():
        try:
            await email_service.send_email(
                db, to_email, subject, html, to_name=to_name,
                attachments=attachments, category=category, related_id=related_id,
            )
        except Exception as exc:
            logger.warning(f"email dispatch failed ({category}): {exc}")

    try:
        asyncio.create_task(_run())
    except RuntimeError:
        # No running loop (e.g. called outside a request) — skip silently.
        pass


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


# ---- Phase 3/4: Company Wallet & Payouts ----

class CompanyWallet(BaseModel):
    company_id: str
    available_balance: float = 0.0
    pending_balance: float = 0.0
    total_earnings: float = 0.0
    total_withdrawn: float = 0.0
    currency: str = "EUR"
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CompanyWalletTxn(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    type: Literal["earning", "payout", "payout_reversal"] = "earning"
    amount: float = 0.0
    gross_amount: Optional[float] = None
    platform_fee: Optional[float] = None
    company_earnings: Optional[float] = None
    order_id: Optional[str] = None
    order_number: Optional[str] = None
    driver_id: Optional[str] = None
    note: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CompanyPayout(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    company_name: Optional[str] = None
    amount: float
    currency: str = "EUR"
    method: str = "bank_transfer"
    account_details: Optional[str] = None
    status: Literal["pending", "approved", "paid", "rejected"] = "pending"
    reference: Optional[str] = None
    note: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    reviewed_at: Optional[str] = None
    paid_at: Optional[str] = None


class CompanyPayoutCreate(BaseModel):
    amount: float = Field(gt=0)
    method: str = "bank_transfer"
    account_details: Optional[str] = None


class PayoutRefRequest(BaseModel):
    reference: Optional[str] = None


class PayoutReasonRequest(BaseModel):
    reason: Optional[str] = None


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


class RefundBody(BaseModel):
    amount: Optional[float] = None  # optional partial refund (EUR); None = full
    reason: Optional[str] = None    # admin note / dispute reference


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
    license_class: Optional[str] = None  # e.g. B, C, CE
    # ---- Account type: individual driver vs fleet/company owner ----
    account_type: Literal["individual", "fleet"] = "individual"
    company_name: Optional[str] = None
    business_id: Optional[str] = None      # Y-tunnus / VAT id
    company_phone: Optional[str] = None
    company_email: Optional[str] = None
    company_address: Optional[str] = None


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
        # Webhook event dedupe (Stripe retries) — auto-expire after 30 days.
        await db.processed_webhook_events.create_index("created_at", expireAfterSeconds=2592000)

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

        # Phase 3/4: company wallet & payouts
        await db.company_wallets.create_index("company_id", unique=True)
        await db.company_wallet_txns.create_index("company_id")
        await db.company_payouts.create_index("company_id")
        await db.company_payouts.create_index("status")
        await db.orders.create_index("assigned_company_id")

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
















async def _get_or_create_company_wallet(company_id: str) -> dict:
    w = await db.company_wallets.find_one({"company_id": company_id}, {"_id": 0})
    if not w:
        w = CompanyWallet(company_id=company_id).model_dump()
        await db.company_wallets.insert_one(w)
    return w


async def _credit_company_wallet_on_delivery(order: dict):
    """Phase 3: route a completed company job's net earnings into the company wallet.

    Solo (non-company) drivers are unaffected — their personal stats stay as-is.
    """
    company_id = order.get("assigned_company_id")
    if not company_id:
        return
    net = round(float(order.get("earnings") or 0) + float(order.get("tip") or 0), 2)
    gross = float(
        order.get("price_quote") or order.get("total_price") or order.get("payment_amount") or net
    )
    fee = round(max(0.0, gross - float(order.get("earnings") or 0)), 2)
    await _get_or_create_company_wallet(company_id)
    await db.company_wallets.update_one(
        {"company_id": company_id},
        {
            "$inc": {"available_balance": net, "total_earnings": net},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
        },
    )
    txn = CompanyWalletTxn(
        company_id=company_id, type="earning", amount=net,
        gross_amount=round(gross, 2), platform_fee=fee, company_earnings=net,
        order_id=order.get("id"), order_number=order.get("order_number"),
        driver_id=order.get("assigned_driver_id") or order.get("driver_id"),
    )
    await db.company_wallet_txns.insert_one(txn.model_dump())
    await db.orders.update_one(
        {"id": order.get("id")},
        {"$set": {"gross_amount": round(gross, 2), "platform_fee": fee, "company_earnings": net}},
    )








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












# ===================== Wallet Endpoints =====================








# ===================== Notification Endpoints =====================









class PushTokenRegister(BaseModel):
    push_token: str
    user_id: str
    user_type: Literal["driver", "shipper"]
    platform: str = "ios"




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

    # Branded transactional email to the shipper on key lifecycle transitions.
    try:
        shipper = await db.shippers.find_one(
            {"id": shipper_id}, {"_id": 0, "email": 1, "contact_name": 1, "company_name": 1}
        )
        if shipper and shipper.get("email"):
            name = shipper.get("contact_name") or shipper.get("company_name") or "there"
            order_no = order.get("order_number", "")
            if event == "accepted":
                drv = None
                if order.get("driver_id"):
                    drv = await db.drivers.find_one(
                        {"id": order["driver_id"]}, {"_id": 0, "name": 1, "vehicle": 1}
                    )
                subj, html = email_tpl.driver_assigned(name, {
                    "order_number": order_no,
                    "driver_name": (drv or {}).get("name", ""),
                    "vehicle": (drv or {}).get("vehicle", ""),
                })
            else:
                subj, html = email_tpl.shipment_status(name, order_no, title)
            send_email_bg(shipper["email"], subj, html, to_name=name,
                          category=f"shipment_{event}", related_id=order.get("id"))
    except Exception as e:
        logger.warning(f"Status email failed (non-blocking): {e}")


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






# ===================== Driver Update =====================



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










# ===================== Change Password (driver & shipper) =====================

class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=8, max_length=1024)





# ===================== Authentication Endpoints =====================







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










# ===================== Shipper Profile =====================



class ShipperUpdate(BaseModel):
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    tax_id: Optional[str] = None
    avatar: Optional[str] = None
    preferred_vehicle_type: Optional[str] = None




# ===================== Shipper Orders (Shipments) =====================











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






# ===================== KYC Endpoints =====================







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





# ===================== Admin Endpoints =====================













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




# ---------- Drivers management ----------





class AdminDriverUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    vehicle_type: Optional[str] = None
    plate: Optional[str] = None








# ---------- Shippers management ----------





class AdminShipperUpdate(BaseModel):
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    tax_id: Optional[str] = None
    is_verified: Optional[bool] = None








# ---------- Orders management ----------







class AdminReassignRequest(BaseModel):
    driver_id: str




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


# ===================== Receipts & Document PDFs =====================

class Receipt(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    receipt_number: str
    doc_type: Literal["payment_receipt", "withdrawal_invoice", "withdrawal_receipt"]
    # Recipient snapshot
    user_id: str
    user_type: Literal["shipper", "driver"]
    user_name: str = ""
    user_email: str = ""
    # References
    order_id: Optional[str] = None
    order_number: Optional[str] = None
    withdrawal_id: Optional[str] = None
    # Amounts
    amount: float = 0.0
    currency: str = "EUR"
    method: Optional[str] = None
    reference: Optional[str] = None
    status: str = "issued"          # issued | paid | pending
    issued_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    paid_at: Optional[str] = None
    last_sent_at: Optional[str] = None


async def _next_doc_number(prefix: str) -> str:
    doc = await db.settings.find_one_and_update(
        {"key": f"counter_{prefix.lower()}"},
        {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    seq = (doc or {}).get("seq", 1)
    return f"{prefix}-{datetime.now(timezone.utc).year}-{1000 + int(seq)}"


def _build_doc_pdf(*, doc_title: str, ref_label: str, ref_value: str, issued: str,
                   status: str, bill_to: list, rows: list, total_value: float,
                   currency: str = "EUR", note: str = "") -> bytes:
    """Generic branded PDF for receipts / withdrawal documents."""
    from fpdf import FPDF

    def s(v):
        return str(v if v is not None else "")

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 22)
    pdf.cell(0, 12, doc_title.upper(), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"{ref_label}: {s(ref_value)}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Issued: {s(issued)[:10]}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Status: {s(status).upper()}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "From", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 5, f"{NADARUNS_COMPANY['name']}  ({NADARUNS_COMPANY['business_id']})", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, NADARUNS_COMPANY["address"], new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, f"{NADARUNS_COMPANY['email']}  |  {NADARUNS_COMPANY['phone']}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "To", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    for line in bill_to:
        if line:
            pdf.cell(0, 5, s(line), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    cur = s(currency or "EUR")
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(120, 7, "Item", border=1)
    pdf.cell(0, 7, "Amount", border=1, new_x="LMARGIN", new_y="NEXT", align="R")
    pdf.set_font("Helvetica", "", 10)
    for label, amount in rows:
        pdf.cell(120, 7, s(label), border=1)
        pdf.cell(0, 7, f"{cur} {float(amount or 0):.2f}", border=1, new_x="LMARGIN", new_y="NEXT", align="R")
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(120, 8, "TOTAL", border=1)
    pdf.cell(0, 8, f"{cur} {float(total_value or 0):.2f}", border=1, new_x="LMARGIN", new_y="NEXT", align="R")
    pdf.ln(6)
    if note:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_x(pdf.l_margin)
        pdf.multi_cell(pdf.epw, 5, note)
    out = pdf.output()
    return bytes(out)


def _receipt_pdf(rec: dict) -> bytes:
    titles = {
        "payment_receipt": "Receipt",
        "withdrawal_invoice": "Withdrawal Invoice",
        "withdrawal_receipt": "Payout Receipt",
    }
    method = (rec.get("method") or "").replace("_", " ").title()
    rows = [("Delivery payment" if rec["doc_type"] == "payment_receipt" else "Driver cash-out", rec.get("amount"))]
    note_map = {
        "payment_receipt": f"Thank you for your payment. Order {rec.get('order_number') or ''}.",
        "withdrawal_invoice": "This document confirms your cash-out request. Funds are released after admin approval.",
        "withdrawal_receipt": f"Your payout has been sent. Reference: {rec.get('reference') or '-'}.",
    }
    bill_to = [
        rec.get("user_name"),
        rec.get("user_email"),
    ]
    if method:
        bill_to.append(f"Method: {method}")
    if rec.get("reference"):
        bill_to.append(f"Reference: {rec.get('reference')}")
    return _build_doc_pdf(
        doc_title=titles.get(rec["doc_type"], "Receipt"),
        ref_label="Receipt #" if "receipt" in rec["doc_type"] else "Invoice #",
        ref_value=rec.get("receipt_number", ""),
        issued=rec.get("issued_at", ""),
        status=rec.get("status", "issued"),
        bill_to=bill_to,
        rows=rows,
        total_value=rec.get("amount", 0),
        currency=rec.get("currency", "EUR"),
        note=note_map.get(rec["doc_type"], ""),
    )


async def _send_receipt_email(rec: dict):
    """Build the right template + PDF attachment and email the recipient."""
    if not rec.get("user_email"):
        return
    pdf_bytes = _receipt_pdf(rec)
    fname = f"{rec.get('receipt_number', 'document')}.pdf"
    attachment = email_service.pdf_attachment(fname, pdf_bytes)
    name = rec.get("user_name") or "there"
    dt = rec["doc_type"]
    if dt == "payment_receipt":
        subj, html = email_tpl.payment_receipt(name, {
            "receipt_number": rec.get("receipt_number"),
            "order_number": rec.get("order_number"),
            "shipment_id": rec.get("order_id"),
            "amount": rec.get("amount"),
            "paid_at": (rec.get("paid_at") or rec.get("issued_at") or "")[:19].replace("T", " "),
        })
    elif dt == "withdrawal_invoice":
        subj, html = email_tpl.withdrawal_invoice(name, {
            "invoice_number": rec.get("receipt_number"),
            "amount": rec.get("amount"),
            "method": rec.get("method"),
            "date": (rec.get("issued_at") or "")[:10],
        })
    else:  # withdrawal_receipt
        subj, html = email_tpl.withdrawal_receipt(name, {
            "receipt_number": rec.get("receipt_number"),
            "amount": rec.get("amount"),
            "method": rec.get("method"),
            "reference": rec.get("reference"),
            "paid_at": (rec.get("paid_at") or rec.get("issued_at") or "")[:19].replace("T", " "),
        })
    send_email_bg(rec["user_email"], subj, html, to_name=name,
                  category=dt, related_id=rec.get("id"), attachments=[attachment])


async def _create_payment_receipt(order: dict) -> Optional[dict]:
    """Idempotently create + email a payment receipt for a captured order."""
    existing = await db.receipts.find_one(
        {"order_id": order["id"], "doc_type": "payment_receipt"}, {"_id": 0}
    )
    if existing:
        return existing
    shipper = await db.shippers.find_one({"id": order.get("shipper_id")}, {"_id": 0}) or {}
    now = datetime.now(timezone.utc).isoformat()
    rec = Receipt(
        receipt_number=await _next_doc_number("RCP"),
        doc_type="payment_receipt",
        user_id=order.get("shipper_id", ""),
        user_type="shipper",
        user_name=shipper.get("contact_name") or shipper.get("company_name") or "",
        user_email=shipper.get("email", ""),
        order_id=order["id"],
        order_number=order.get("order_number"),
        amount=round(float(order.get("payment_amount") or order.get("price_quote") or 0), 2),
        status="paid",
        paid_at=now,
    ).model_dump()
    await db.receipts.insert_one(rec)
    rec.pop("_id", None)
    await _send_receipt_email(rec)
    await db.receipts.update_one({"id": rec["id"]}, {"$set": {"last_sent_at": now}})
    logger.info(f"Payment receipt {rec['receipt_number']} created for order {order.get('order_number')}")
    return rec


async def _create_withdrawal_doc(wr: dict, doc_type: str) -> Optional[dict]:
    """Create + email a withdrawal invoice (on request) or receipt (on payout)."""
    existing = await db.receipts.find_one(
        {"withdrawal_id": wr["id"], "doc_type": doc_type}, {"_id": 0}
    )
    if existing:
        return existing
    driver = await db.drivers.find_one({"id": wr.get("driver_id")}, {"_id": 0}) or {}
    now = datetime.now(timezone.utc).isoformat()
    prefix = "WRC" if doc_type == "withdrawal_receipt" else "WIN"
    rec = Receipt(
        receipt_number=await _next_doc_number(prefix),
        doc_type=doc_type,
        user_id=wr.get("driver_id", ""),
        user_type="driver",
        user_name=driver.get("name") or wr.get("driver_name") or "",
        user_email=driver.get("email", ""),
        withdrawal_id=wr["id"],
        amount=round(float(wr.get("amount") or 0), 2),
        method=wr.get("method"),
        reference=wr.get("reference"),
        status="paid" if doc_type == "withdrawal_receipt" else "pending",
        paid_at=now if doc_type == "withdrawal_receipt" else None,
    ).model_dump()
    await db.receipts.insert_one(rec)
    rec.pop("_id", None)
    await _send_receipt_email(rec)
    await db.receipts.update_one({"id": rec["id"]}, {"$set": {"last_sent_at": now}})
    logger.info(f"{doc_type} {rec['receipt_number']} created for withdrawal {wr['id']}")
    return rec


async def _email_invoice_pdf(inv: dict):
    """Build the invoice PDF and email it to the shipper."""
    if not inv.get("shipper_email"):
        return
    pdf_bytes = _build_invoice_pdf(inv)
    attachment = email_service.pdf_attachment(f"{inv['invoice_number']}.pdf", pdf_bytes)
    name = inv.get("shipper_contact") or inv.get("shipper_company") or "there"
    subj, html = email_tpl.payment_invoice(name, {
        "invoice_number": inv.get("invoice_number"),
        "order_number": inv.get("order_number"),
        "shipment_id": inv.get("order_id"),
        "amount": inv.get("total_amount"),
        "date": (inv.get("issued_at") or "")[:10],
    })
    send_email_bg(inv["shipper_email"], subj, html, to_name=name,
                  category="payment_invoice", related_id=inv.get("id"), attachments=[attachment])


# ---------- Admin receipts management ----------











# ---------- Admin email template preview / test-send ----------

# Registry of every transactional template with realistic sample data so admins
# can preview branding and trigger a real test send before go-live.
def _email_template_registry() -> dict:
    et = email_tpl
    sample_order = {"order_number": "SHP-2645", "pickup": "Mannerheimintie 1, Helsinki",
                    "dropoff": "Aleksanterinkatu 52, Helsinki", "price": 148.50,
                    "driver_name": "Eero Virtanen", "vehicle": "Cargo van (FIN-204)"}
    sample_inv = {"invoice_number": "NDR-2026-1013", "order_number": "SHP-2645",
                  "shipment_id": "ord_123", "amount": 157.50, "date": "2026-06-21"}
    sample_rcp = {"receipt_number": "RCP-2026-1001", "order_number": "SHP-2645",
                  "shipment_id": "ord_123", "amount": 148.50, "paid_at": "2026-06-21 10:24"}
    sample_win = {"invoice_number": "WIN-2026-1002", "amount": 320.00,
                  "method": "bank_transfer", "date": "2026-06-21"}
    sample_wrc = {"receipt_number": "WRC-2026-1002", "amount": 320.00, "method": "bank_transfer",
                  "reference": "TXN-88421", "paid_at": "2026-06-21 14:02"}
    name = "Aino Korhonen"
    return {
        "welcome_driver":       ("Driver welcome",        "driver_welcome",     lambda: et.welcome(name, "driver")),
        "welcome_shipper":      ("Shipper welcome",       "shipper_welcome",    lambda: et.welcome("Demo Logistics Co", "shipper")),
        "driver_reg_received":  ("Driver registration received", "driver_registration", lambda: et.driver_registration_received(name)),
        "driver_approved":      ("Driver KYC approved",   "driver_approved",    lambda: et.driver_approved(name)),
        "driver_rejected":      ("Driver KYC rejected",   "driver_rejected",    lambda: et.driver_rejected(name, "Driver licence photo was unclear.")),
        "password_changed":     ("Password changed",      "password_changed",   lambda: et.password_changed(name)),
        "password_reset":       ("Password reset",        "password_reset",     lambda: et.password_reset(name, "https://nadaruns.com/reset?token=sample")),
        "order_created":        ("Order created",         "order_created",      lambda: et.order_created(name, sample_order)),
        "driver_assigned":      ("Driver assigned",       "shipment_accepted",  lambda: et.driver_assigned(name, sample_order)),
        "shipment_status":      ("Shipment status update","shipment_status",    lambda: et.shipment_status(name, sample_order["order_number"], "Arrived at pickup")),
        "payment_invoice":      ("Payment invoice",       "payment_invoice",    lambda: et.payment_invoice(name, sample_inv)),
        "payment_receipt":      ("Payment receipt",       "payment_receipt",    lambda: et.payment_receipt(name, sample_rcp)),
        "withdrawal_invoice":   ("Withdrawal invoice",    "withdrawal_invoice", lambda: et.withdrawal_invoice(name, sample_win)),
        "withdrawal_receipt":   ("Payout receipt",        "withdrawal_receipt", lambda: et.withdrawal_receipt(name, sample_wrc)),
        "test_email":           ("Connectivity test",     "test",               lambda: et.test_email()),
    }






class EmailTestSendRequest(BaseModel):
    to_email: EmailStr














# ---------- Admin invoice management ----------











class InvoicingSettingsRequest(BaseModel):
    invoice_fee: float
    net_days: int = 14




# ---------- Vehicles overview ----------




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


# API endpoint to get driver location (for shippers polling)


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


# API endpoint to send a chat message (fallback)


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


async def _webhook_event_seen(event_id: str) -> bool:
    """Atomically record a Stripe webhook event id. Returns True if it was
    already processed (so retried/duplicate deliveries are ignored)."""
    if not event_id:
        return False
    try:
        await db.processed_webhook_events.insert_one(
            {"_id": event_id, "created_at": datetime.now(timezone.utc)}
        )
        return False
    except DuplicateKeyError:
        return True


async def _apply_refund_to_order(order: dict, refund) -> dict:
    """Record a Stripe refund against an order + ledger and update its status.

    Full refund -> payment_status 'refunded' (the delivery is excluded from the
    driver's captured earnings). Partial refund keeps 'captured' and is logged
    for audit (the platform absorbs the partial amount). Idempotent per refund id.
    """
    order_id = order["id"]
    refund_eur = payments.from_cents(getattr(refund, "amount", 0) or 0)
    refund_id = getattr(refund, "id", None)
    intent_id = getattr(refund, "payment_intent", None) or order.get("stripe_payment_intent_id")
    captured_gross = float(order.get("payment_amount") or 0)
    is_full = refund_eur >= (captured_gross - 0.01)

    if refund_id:
        already = await db.payment_transactions.find_one({"stripe_refund_id": refund_id})
        if not already:
            await db.payment_transactions.insert_one({
                "id": str(uuid.uuid4()),
                "order_id": order_id,
                "order_number": order.get("order_number"),
                "shipper_id": order.get("shipper_id"),
                "driver_id": order.get("driver_id"),
                "type": "refund",
                "gross_amount": -round(refund_eur, 2),
                "commission_amount": 0.0,
                "driver_amount": 0.0,
                "commission_rate": 0.0,
                "currency": "EUR",
                "stripe_payment_intent_id": intent_id,
                "stripe_refund_id": refund_id,
                "status": "completed",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

    updates: dict = {
        "refunded_amount": round(refund_eur, 2),
        "refunded_at": datetime.now(timezone.utc).isoformat(),
    }
    if is_full:
        updates["payment_status"] = "refunded"
    await db.orders.update_one({"id": order_id}, {"$set": updates})
    order.update(updates)
    return updates


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
        # Auto-generate + email a payment receipt (idempotent, non-blocking).
        asyncio.create_task(_create_payment_receipt({**order, **updates}))

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






class PayWithCardBody(BaseModel):
    payment_method_id: str
















# ===================== Driver Wallet & Cash-out =====================







# ===================== Admin: Financial Management =====================









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
    # On payout, auto-generate + email a payout receipt (idempotent, non-blocking).
    if new_status == "paid":
        asyncio.create_task(_create_withdrawal_doc(wr, "withdrawal_receipt"))
    return wr








# ===================== Admin: Live Dispatch Map =====================



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








# ---- Drivers tab ----





async def _get_company_driver(company_id: str, driver_id: str) -> dict:
    target = await db.drivers.find_one({"id": driver_id, "company_id": company_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Driver not found in your company")
    return target








# ---- Vehicles tab ----





async def _get_company_vehicle(company_id: str, vehicle_id: str) -> dict:
    v = await db.fleet_vehicles.find_one({"id": vehicle_id, "company_id": company_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vehicle not found in your company")
    return v










# ---- Company jobs visibility & owner assignment (Phase 2) ----





# ---- Company wallet & payouts (Phase 3/4, owner) ----







# ---- Admin Fleet dashboard (Phase 5) ----











async def _get_company_payout(payout_id: str) -> dict:
    p = await db.company_payouts.find_one({"id": payout_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Payout not found")
    return p








# ===================== Lifecycle =====================


# ---- Modular routers (auto-extracted from this monolith) ----
from routes import misc as _r_misc
from routes import driver as _r_driver
from routes import orders as _r_orders
from routes import shipper as _r_shipper
from routes import notifications as _r_notifications
from routes import auth as _r_auth
from routes import admin as _r_admin
from routes import receipts as _r_receipts
from routes import invoices as _r_invoices
from routes import payments as _r_payments
from routes import wallet as _r_wallet
from routes import company as _r_company
api_router.include_router(_r_misc.router)
api_router.include_router(_r_driver.router)
api_router.include_router(_r_orders.router)
api_router.include_router(_r_shipper.router)
api_router.include_router(_r_notifications.router)
api_router.include_router(_r_auth.router)
api_router.include_router(_r_admin.router)
api_router.include_router(_r_receipts.router)
api_router.include_router(_r_invoices.router)
api_router.include_router(_r_payments.router)
api_router.include_router(_r_wallet.router)
api_router.include_router(_r_company.router)

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
