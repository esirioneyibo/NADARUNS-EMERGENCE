from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect
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
    "delivered", "rejected", "cancelled"
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
    vehicle_type: str = "cargo_van"  # Logistics vehicle type ID
    vehicle_capacity_kg: int = 1500  # Vehicle capacity in kg
    plate: str = ""
    email: str = ""
    phone: str = ""
    password_hash: Optional[str] = None  # hashed password
    is_online: bool = False
    earnings_today: float = 0.0
    deliveries_today: int = 0
    acceptance_rate: float = 96.0
    completion_rate: float = 98.0
    notifications: NotificationPrefs = Field(default_factory=NotificationPrefs)


class DriverUpdate(BaseModel):
    name: Optional[str] = None
    vehicle: Optional[str] = None
    vehicle_type: Optional[str] = None
    vehicle_capacity_kg: Optional[int] = None
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
    order = await db.orders.find_one({"status": "pending"}, {"_id": 0})
    if not order:
        return None
    return Order(**order)


@api_router.get("/orders/available", response_model=List[Order])
async def get_available_orders(
    vehicle_type: Optional[str] = None,
    min_capacity_kg: Optional[int] = None,
):
    """
    Get all available (pending) orders for map-based job discovery.
    Returns orders with their pickup locations for displaying on driver's map.
    
    Optional filters:
    - vehicle_type: Filter orders requiring a specific vehicle type
    - min_capacity_kg: Filter orders where cargo weight is within this capacity
    """
    query = {"status": "pending"}
    
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
    
    cursor = db.orders.find(query, {"_id": 0}).limit(50)
    items = await cursor.to_list(50)
    return [Order(**o) for o in items]


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
        # seed a fresh pending request to keep the demo flowing
        await db.orders.insert_one(build_order("pending"))

    await db.orders.update_one({"id": order_id}, {"$set": update})
    order.update(update)
    await audit.record_event(
        db, order_id, "status_change",
        from_status=current, to_status=next_status,
        actor_id=driver_id, actor_type="driver",
    )
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
    
    # Also get orders without driver_id for backward compatibility with seeded data
    if not history:
        history = await db.orders.find(
            {"status": "delivered"}, 
            {"_id": 0}
        ).sort("completed_at", -1).limit(40).to_list(40)
    
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

    # Delivered orders for this driver (fallback to global for legacy/demo data).
    delivered = await db.orders.find(
        {"status": "delivered", "driver_id": driver_id}, {"_id": 0}
    ).sort("completed_at", -1).to_list(500)
    if not delivered:
        delivered = await db.orders.find(
            {"status": "delivered"}, {"_id": 0}
        ).sort("completed_at", -1).to_list(200)

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


# ===================== Driver Registration =====================

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

    # Audit trail: record order creation.
    await audit.record_event(
        db, order_id, "order_created",
        from_status=None, to_status="pending",
        actor_id=shipper_id, actor_type="shipper",
        metadata={"vehicle_type": request.vehicle_type, "price": round(total_price, 2)},
    )

    # Send push notification to online drivers with matching vehicle type
    asyncio.create_task(notify_available_drivers(
        order_id=order_id,
        order_number=order_number,
        vehicle_type=request.vehicle_type,
        pickup_address=request.pickup_address,
        earnings=driver_earnings,
    ))
    
    response = {
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
        await db.chat_messages.insert_one(msg_doc)
        
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
