from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import httpx
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

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


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
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None
    rating_given: Optional[int] = None  # thumbs up/down: 1 or -1
    feedback: Optional[str] = None


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


# ===================== Seed Data =====================

DRIVER_ID = "driver-001"

SEED_DRIVER = {
    "id": DRIVER_ID,
    "name": "Alex Lindqvist",
    "rating": 4.92,
    "avatar": "https://images.unsplash.com/photo-1551825687-f9de1603ed8b?crop=entropy&cs=srgb&fm=jpg&w=400&q=80",
    "vehicle": "Bicycle • Black",
    "vehicle_type": "bicycle",
    "plate": "STO-2841",
    "email": "alex.lindqvist@driver.app",
    "phone": "+46 70 911 4422",
    "is_online": False,
    "earnings_today": 0.0,
    "deliveries_today": 0,
    "acceptance_rate": 96.0,
    "notifications": {"push": True, "sound": True, "new_orders": True, "earnings_summary": True},
}

RESTAURANTS = [
    {"name": "Nordic Bowl", "address": "12 Hamngatan, Stockholm", "lat": 59.3326, "lng": 18.0649},
    {"name": "Söder Pizzeria", "address": "44 Götgatan, Stockholm", "lat": 59.3145, "lng": 18.0731},
    {"name": "Kaffekoppen", "address": "20 Stortorget, Stockholm", "lat": 59.3251, "lng": 18.0710},
    {"name": "Östermalm Sushi", "address": "8 Karlavägen, Stockholm", "lat": 59.3380, "lng": 18.0760},
    {"name": "Vasa Burger", "address": "61 Odengatan, Stockholm", "lat": 59.3437, "lng": 18.0577},
]

CUSTOMERS = [
    {"name": "Emma S.", "rating": 4.8, "phone": "+46 70 123 4567"},
    {"name": "Liam K.", "rating": 4.6, "phone": "+46 70 234 5678"},
    {"name": "Saga N.", "rating": 5.0, "phone": "+46 70 345 6789"},
    {"name": "Noah B.", "rating": 4.4, "phone": "+46 70 456 7890"},
    {"name": "Alma R.", "rating": 4.9, "phone": "+46 70 567 8901"},
]

DROPOFFS = [
    {"address": "15 Birger Jarlsgatan, Stockholm", "lat": 59.3360, "lng": 18.0710, "apt": "Apt 4B"},
    {"address": "92 Sveavägen, Stockholm", "lat": 59.3420, "lng": 18.0610, "apt": "Apt 12"},
    {"address": "5 Folkungagatan, Stockholm", "lat": 59.3160, "lng": 18.0770, "apt": "Apt 2A"},
    {"address": "33 Kungsgatan, Stockholm", "lat": 59.3349, "lng": 18.0633, "apt": "Apt 7"},
    {"address": "18 Drottninggatan, Stockholm", "lat": 59.3328, "lng": 18.0620, "apt": "Apt 3C"},
]

ITEM_SETS = [
    [{"name": "Salmon Poke Bowl", "quantity": 1}, {"name": "Miso Soup", "quantity": 1}, {"name": "Sparkling Water", "quantity": 2}],
    [{"name": "Margherita Pizza", "quantity": 1}, {"name": "Caesar Salad", "quantity": 1}],
    [{"name": "Cappuccino", "quantity": 2}, {"name": "Cinnamon Bun", "quantity": 3}],
    [{"name": "Rainbow Maki", "quantity": 2}, {"name": "Edamame", "quantity": 1}],
    [{"name": "Classic Burger", "quantity": 1}, {"name": "Fries", "quantity": 1}, {"name": "Coke", "quantity": 1}],
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
        created_at=created.isoformat(),
        completed_at=completed,
        rating_given=random.choice([1, 1, 1, -1]) if completed else None,
    ).model_dump()
    return order


async def ensure_seed():
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
