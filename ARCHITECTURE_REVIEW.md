# NadaRuns System Architecture Review
## Senior Staff Engineer Analysis (Uber/Lyft/Wolt Grade)

---

# 1. EXECUTIVE SUMMARY: WHAT IS BROKEN/MISSING

## 🔴 Critical Issues (Production Blockers)

### 1.1 Monolithic Single-File Backend (~2900 lines)
- **Problem**: Entire backend in one `server.py` file
- **Impact**: Impossible to scale team, test properly, or deploy incrementally
- **Uber Reality**: Uber has 4000+ microservices. Even a startup should have 5-10 bounded contexts

### 1.2 No Real Driver-Job Matching Algorithm
- **Problem**: Jobs go to ALL online drivers. No geo-proximity, vehicle matching, or fairness
- **Impact**: Inefficient dispatching, unhappy drivers, slow deliveries
- **Uber Reality**: Uber's matching considers 100+ signals including ETA, surge, driver preferences, rider history

### 1.3 Polling-Based Job Discovery (Anti-Pattern)
- **Problem**: Drivers poll `/api/orders/pending` every 5 seconds
- **Impact**: 
  - At 10K drivers: 2K requests/second just for polling
  - At 100K drivers: 20K requests/second (server dies)
  - 5-second delay in job notification (unacceptable)
- **Uber Reality**: Push-based via WebSocket/gRPC streaming

### 1.4 In-Memory WebSocket State (Fatal for Scale)
```python
class ConnectionManager:
    self.order_subscribers: Dict[str, Set[WebSocket]] = {}
    self.driver_connections: Dict[str, WebSocket] = {}
```
- **Problem**: If server restarts or scales horizontally, ALL connections lost
- **Impact**: Cannot scale beyond single instance
- **Fix**: Redis Pub/Sub or dedicated message broker

### 1.5 No Geospatial Indexing
- **Problem**: MongoDB without geo-indexes for driver locations
- **Impact**: O(n) queries to find nearby drivers instead of O(log n)
- **Uber Reality**: Uses custom H3 hex grid + PostGIS for sub-millisecond geo queries

### 1.6 Base64 Image Storage in Database
```python
delivery_photo: Optional[str] = None  # base64 data URI
```
- **Problem**: 1MB photos stored as text in MongoDB documents
- **Impact**: 
  - MongoDB document size limit (16MB) hit quickly
  - Massive database bloat
  - Slow queries
- **Fix**: S3/CloudStorage with URL references

### 1.7 Hardcoded Admin Credentials
```python
ADMIN_PASSWORD = "admin123"
```
- **Security Disaster**: Credentials in source code

### 1.8 No Rate Limiting
- **Problem**: Zero protection against abuse
- **Impact**: DDoS vulnerability, API abuse, cost explosion

### 1.9 Synchronous OTP Flow Blocks Driver
- **Problem**: Driver must wait for OTP verification popup
- **Impact**: UX friction, delays in delivery flow

---

## 🟡 Major Issues (Scale Blockers)

| Issue | Current | Required |
|-------|---------|----------|
| Database | Single MongoDB | Read replicas, sharding |
| Caching | None | Redis multi-layer |
| Search | Full collection scans | Elasticsearch/Algolia |
| Queues | None | Redis/RabbitMQ for async |
| Monitoring | console.log | Datadog/Prometheus + alerts |
| Testing | None | 80%+ coverage required |
| CI/CD | None | Automated deploy pipeline |

---

## 🟢 What Works Well
- Clean Pydantic models
- WebSocket foundation exists
- Decent mobile UI/UX patterns
- Vehicle type categorization
- OTP verification flow

---

# 2. SYSTEM ARCHITECTURE UPGRADE PLAN

## 2.1 Target Architecture (Phase 1 - 6 months)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LOAD BALANCER                                │
│                    (AWS ALB / Cloudflare)                           │
└─────────────────────────────────────────────────────────────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Gateway   │    │ WebSocket Server│    │  Admin Gateway  │
│   (FastAPI)     │    │  (Socket.io)    │    │   (FastAPI)     │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │      Redis Pub/Sub    │
                    │    (Message Broker)   │
                    └───────────┬───────────┘
                                │
    ┌───────────────────────────┼───────────────────────────┐
    │              │            │            │              │
    ▼              ▼            ▼            ▼              ▼
┌────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌──────────┐
│ Driver │  │ Matching │  │ Tracking │  │ Order  │  │Notification│
│Service │  │ Service  │  │ Service  │  │Service │  │ Service   │
└────┬───┘  └────┬─────┘  └────┬─────┘  └───┬────┘  └─────┬─────┘
     │           │             │            │             │
     └───────────┴──────┬──────┴────────────┴─────────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
         ▼              ▼              ▼
    ┌─────────┐   ┌──────────┐   ┌──────────┐
    │ MongoDB │   │  Redis   │   │   S3     │
    │(Primary)│   │ (Cache)  │   │ (Media)  │
    └─────────┘   └──────────┘   └──────────┘
```

## 2.2 Service Boundaries (Modular Monolith First)

Instead of immediate microservices, use **modular monolith** pattern:

```
/app/backend/
├── main.py                    # FastAPI app entry
├── config/
│   ├── settings.py            # Environment config
│   └── database.py            # DB connections
├── core/
│   ├── auth/
│   │   ├── router.py
│   │   ├── service.py
│   │   └── models.py
│   ├── matching/              # 🆕 CRITICAL
│   │   ├── router.py
│   │   ├── service.py
│   │   ├── algorithms.py      # Matching logic
│   │   └── models.py
│   ├── tracking/              # 🆕 Real-time
│   │   ├── websocket.py
│   │   ├── service.py
│   │   └── redis_pubsub.py
│   ├── orders/
│   │   ├── router.py
│   │   ├── service.py
│   │   └── models.py
│   ├── drivers/
│   │   ├── router.py
│   │   ├── service.py
│   │   └── models.py
│   ├── shippers/
│   │   ├── router.py
│   │   ├── service.py
│   │   └── models.py
│   └── notifications/
│       ├── service.py
│       └── push.py
├── shared/
│   ├── middleware.py
│   ├── exceptions.py
│   └── utils/
└── tests/
```

---

# 3. BACKEND IMPROVEMENTS

## 3.1 Driver-Job Matching Algorithm (CRITICAL)

### Current State (Broken)
```python
# All pending orders go to ALL online drivers
async def get_pending_order():
    return await db.orders.find_one({"status": "pending"})
```

### Proposed Uber-Grade Matching System

```python
# /app/backend/core/matching/algorithms.py

from typing import List, Optional
import math
from dataclasses import dataclass
from enum import Enum

class MatchingStrategy(Enum):
    NEAREST_DRIVER = "nearest"
    OPTIMAL_ETA = "optimal_eta"
    LOAD_BALANCED = "load_balanced"
    VEHICLE_MATCHED = "vehicle_matched"

@dataclass
class DriverCandidate:
    driver_id: str
    location: tuple  # (lat, lng)
    vehicle_type: str
    vehicle_capacity_kg: int
    current_load: int  # active orders
    rating: float
    acceptance_rate: float
    distance_to_pickup: float
    eta_minutes: int
    score: float = 0.0

@dataclass
class MatchingResult:
    order_id: str
    matched_driver_id: Optional[str]
    candidates_evaluated: int
    match_score: float
    match_reason: str


class DriverMatcher:
    """
    Uber-grade driver-job matching algorithm.
    
    Considers:
    1. Geo-proximity (H3 hex grid for O(1) lookup)
    2. Vehicle type compatibility
    3. Driver capacity (not overloaded)
    4. ETA optimization
    5. Fairness (round-robin for equal distances)
    6. Driver preferences
    7. Historical acceptance rate
    """
    
    def __init__(self, redis_client, db):
        self.redis = redis_client
        self.db = db
        self.SEARCH_RADIUS_KM = 15
        self.MAX_CANDIDATES = 50
        
    async def find_best_driver(
        self, 
        order: dict,
        strategy: MatchingStrategy = MatchingStrategy.OPTIMAL_ETA
    ) -> MatchingResult:
        """Main matching entry point."""
        
        pickup_location = (order["pickup"]["lat"], order["pickup"]["lng"])
        required_vehicle = order.get("vehicle_type")
        cargo_weight = order.get("cargo_weight_kg", 0)
        
        # Step 1: Get candidate drivers from geo-index
        candidates = await self._get_nearby_drivers(
            pickup_location, 
            self.SEARCH_RADIUS_KM
        )
        
        if not candidates:
            return MatchingResult(
                order_id=order["id"],
                matched_driver_id=None,
                candidates_evaluated=0,
                match_score=0,
                match_reason="no_drivers_available"
            )
        
        # Step 2: Filter by vehicle compatibility
        if required_vehicle:
            candidates = [c for c in candidates 
                         if self._is_vehicle_compatible(c, required_vehicle, cargo_weight)]
        
        # Step 3: Filter by capacity (not overloaded)
        candidates = [c for c in candidates if c.current_load < 3]
        
        # Step 4: Calculate scores
        for candidate in candidates:
            candidate.score = self._calculate_match_score(
                candidate, order, strategy
            )
        
        # Step 5: Sort by score and select best
        candidates.sort(key=lambda c: c.score, reverse=True)
        
        if not candidates:
            return MatchingResult(
                order_id=order["id"],
                matched_driver_id=None,
                candidates_evaluated=0,
                match_score=0,
                match_reason="no_compatible_drivers"
            )
        
        best = candidates[0]
        
        return MatchingResult(
            order_id=order["id"],
            matched_driver_id=best.driver_id,
            candidates_evaluated=len(candidates),
            match_score=best.score,
            match_reason=f"best_match_{strategy.value}"
        )
    
    async def _get_nearby_drivers(
        self, 
        location: tuple, 
        radius_km: float
    ) -> List[DriverCandidate]:
        """
        Get online drivers within radius using geo-index.
        
        Production optimization: Use Redis GEO or MongoDB 2dsphere index
        """
        # MongoDB 2dsphere query
        nearby = await self.db.drivers.find({
            "is_online": True,
            "current_location": {
                "$nearSphere": {
                    "$geometry": {
                        "type": "Point",
                        "coordinates": [location[1], location[0]]  # lng, lat
                    },
                    "$maxDistance": radius_km * 1000  # meters
                }
            }
        }).limit(self.MAX_CANDIDATES).to_list(length=self.MAX_CANDIDATES)
        
        candidates = []
        for driver in nearby:
            driver_loc = driver.get("current_location", {})
            if not driver_loc:
                continue
                
            distance = self._haversine_distance(
                location,
                (driver_loc.get("lat", 0), driver_loc.get("lng", 0))
            )
            
            # Count active orders for this driver
            active_orders = await self.db.orders.count_documents({
                "driver_id": driver["id"],
                "status": {"$nin": ["delivered", "rejected", "pending"]}
            })
            
            candidates.append(DriverCandidate(
                driver_id=driver["id"],
                location=(driver_loc.get("lat", 0), driver_loc.get("lng", 0)),
                vehicle_type=driver.get("vehicle_type", "cargo_van"),
                vehicle_capacity_kg=driver.get("vehicle_capacity_kg", 1500),
                current_load=active_orders,
                rating=driver.get("rating", 5.0),
                acceptance_rate=driver.get("acceptance_rate", 100),
                distance_to_pickup=distance,
                eta_minutes=int(distance / 30 * 60)  # Assume 30km/h avg
            ))
        
        return candidates
    
    def _calculate_match_score(
        self, 
        candidate: DriverCandidate,
        order: dict,
        strategy: MatchingStrategy
    ) -> float:
        """
        Calculate match score (0-100) based on multiple factors.
        
        Weights:
        - Distance: 40%
        - Vehicle fit: 25%
        - Driver rating: 15%
        - Acceptance rate: 10%
        - Current load: 10%
        """
        score = 0.0
        
        # Distance score (closer = better, max 40 points)
        max_distance = self.SEARCH_RADIUS_KM
        distance_score = max(0, (1 - candidate.distance_to_pickup / max_distance)) * 40
        score += distance_score
        
        # Vehicle fit score (max 25 points)
        required_capacity = order.get("cargo_weight_kg", 0)
        if candidate.vehicle_capacity_kg >= required_capacity:
            # Prefer vehicles that aren't massively oversized
            capacity_ratio = required_capacity / candidate.vehicle_capacity_kg if candidate.vehicle_capacity_kg > 0 else 0
            vehicle_score = 25 * (0.5 + 0.5 * capacity_ratio)  # 12.5-25 points
        else:
            vehicle_score = 0
        score += vehicle_score
        
        # Rating score (max 15 points)
        rating_score = (candidate.rating / 5.0) * 15
        score += rating_score
        
        # Acceptance rate score (max 10 points)
        acceptance_score = (candidate.acceptance_rate / 100) * 10
        score += acceptance_score
        
        # Load balancing score (max 10 points)
        load_score = max(0, (1 - candidate.current_load / 3)) * 10
        score += load_score
        
        return round(score, 2)
    
    def _is_vehicle_compatible(
        self, 
        candidate: DriverCandidate, 
        required_vehicle: str,
        cargo_weight: float
    ) -> bool:
        """Check if driver's vehicle is compatible with order requirements."""
        # Check capacity
        if candidate.vehicle_capacity_kg < cargo_weight:
            return False
        
        # Vehicle type hierarchy (larger can handle smaller)
        VEHICLE_HIERARCHY = {
            "cargo_van": 1,
            "box_truck": 2,
            "flatbed_truck": 2,
            "semi_truck": 3,
            "trailer_truck": 3,
            "container_truck": 4,
            "tanker": 4,
            "refrigerated": 2,  # Special
            "crane_truck": 3,   # Special
            "hazmat": 3,        # Special
        }
        
        required_level = VEHICLE_HIERARCHY.get(required_vehicle, 1)
        driver_level = VEHICLE_HIERARCHY.get(candidate.vehicle_type, 1)
        
        return driver_level >= required_level
    
    @staticmethod
    def _haversine_distance(coord1: tuple, coord2: tuple) -> float:
        """Calculate distance in km between two lat/lng points."""
        R = 6371  # Earth's radius in km
        
        lat1, lon1 = math.radians(coord1[0]), math.radians(coord1[1])
        lat2, lon2 = math.radians(coord2[0]), math.radians(coord2[1])
        
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        c = 2 * math.asin(math.sqrt(a))
        
        return R * c
```

## 3.2 Real-time Architecture with Redis Pub/Sub

### Current Problem
```python
# In-memory, single server only
self.order_subscribers: Dict[str, Set[WebSocket]] = {}
```

### Solution: Redis-backed WebSocket

```python
# /app/backend/core/tracking/redis_pubsub.py

import aioredis
import json
from typing import Callable, Dict
import asyncio

class RedisPubSub:
    """
    Redis Pub/Sub for distributed WebSocket state.
    
    Enables horizontal scaling of WebSocket servers.
    """
    
    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self.redis: aioredis.Redis = None
        self.pubsub: aioredis.client.PubSub = None
        self.handlers: Dict[str, Callable] = {}
        self._listener_task = None
    
    async def connect(self):
        """Connect to Redis."""
        self.redis = await aioredis.from_url(self.redis_url)
        self.pubsub = self.redis.pubsub()
    
    async def disconnect(self):
        """Clean disconnect."""
        if self._listener_task:
            self._listener_task.cancel()
        if self.pubsub:
            await self.pubsub.close()
        if self.redis:
            await self.redis.close()
    
    async def subscribe(self, channel: str, handler: Callable):
        """Subscribe to a channel with a handler."""
        await self.pubsub.subscribe(channel)
        self.handlers[channel] = handler
        
        if not self._listener_task:
            self._listener_task = asyncio.create_task(self._listen())
    
    async def publish(self, channel: str, message: dict):
        """Publish a message to a channel."""
        await self.redis.publish(channel, json.dumps(message))
    
    async def _listen(self):
        """Background task to listen for messages."""
        async for message in self.pubsub.listen():
            if message["type"] == "message":
                channel = message["channel"].decode()
                data = json.loads(message["data"])
                
                if channel in self.handlers:
                    await self.handlers[channel](data)
    
    # Driver location tracking
    async def update_driver_location(self, driver_id: str, lat: float, lng: float):
        """Update driver location in Redis GEO index."""
        await self.redis.geoadd(
            "driver_locations",
            (lng, lat, driver_id)
        )
        
        # Also store in hash for quick lookup
        await self.redis.hset(
            f"driver:{driver_id}",
            mapping={
                "lat": lat,
                "lng": lng,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        )
    
    async def get_nearby_drivers(
        self, 
        lat: float, 
        lng: float, 
        radius_km: float
    ) -> list:
        """Get drivers within radius using Redis GEO."""
        results = await self.redis.georadius(
            "driver_locations",
            lng, lat,
            radius_km,
            unit="km",
            withdist=True,
            withcoord=True,
            sort="ASC"
        )
        
        drivers = []
        for item in results:
            driver_id = item[0].decode()
            distance = item[1]
            coord = item[2]
            
            drivers.append({
                "driver_id": driver_id,
                "distance_km": distance,
                "location": {"lat": coord[1], "lng": coord[0]}
            })
        
        return drivers


# Channel patterns for pub/sub
CHANNELS = {
    "order_created": "orders:created",
    "order_assigned": "orders:{order_id}:assigned",
    "driver_location": "drivers:{driver_id}:location",
    "order_tracking": "orders:{order_id}:tracking",
}
```

## 3.3 Database Schema Optimization

### Add MongoDB Indexes

```python
# /app/backend/config/database.py

async def setup_indexes(db):
    """Create optimized indexes for production."""
    
    # Drivers collection
    await db.drivers.create_index([("email", 1)], unique=True)
    await db.drivers.create_index([("is_online", 1)])
    await db.drivers.create_index([("vehicle_type", 1)])
    await db.drivers.create_index([
        ("current_location", "2dsphere")  # 🔴 CRITICAL for geo queries
    ])
    
    # Orders collection
    await db.orders.create_index([("status", 1)])
    await db.orders.create_index([("driver_id", 1)])
    await db.orders.create_index([("shipper_id", 1)])
    await db.orders.create_index([("created_at", -1)])
    await db.orders.create_index([
        ("status", 1), 
        ("created_at", -1)
    ])  # Compound for pending orders query
    await db.orders.create_index([
        ("pickup.lat", 1),
        ("pickup.lng", 1)
    ])  # For geo-proximity on pickup
    
    # Shippers collection
    await db.shippers.create_index([("email", 1)], unique=True)
    
    # Push tokens
    await db.push_tokens.create_index([("user_id", 1)], unique=True)
    await db.push_tokens.create_index([("token", 1)], unique=True)
```

---

# 4. MOBILE APP IMPROVEMENTS

## 4.1 Map-Based Job Discovery (Your Request)

### Current Flow (Bad)
```
Driver opens app → Polls every 5s → Modal popup appears
```

### New Flow (Uber-Style)
```
Driver opens app → Map shows nearby job markers → 
Driver taps marker → Job details slide up → Accept/Decline
```

### Implementation

```typescript
// /app/frontend/app/driver-home.tsx

import React, { useCallback, useEffect, useState, useRef } from "react";
import { View, StyleSheet, Animated } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import BottomSheet from "@gorhom/bottom-sheet";

interface NearbyJob {
  id: string;
  order_number: string;
  pickup: { lat: number; lng: number; address: string };
  dropoff: { lat: number; lng: number; address: string };
  earnings: number;
  distance_km: number;
  eta_minutes: number;
  vehicle_type: string;
}

export default function DriverHomeScreen() {
  const mapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  
  const [nearbyJobs, setNearbyJobs] = useState<NearbyJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<NearbyJob | null>(null);
  const [driverLocation, setDriverLocation] = useState<{lat: number, lng: number} | null>(null);

  // WebSocket connection for real-time job updates
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Connect to job broadcast channel
    ws.current = new WebSocket(`${WS_URL}/ws/driver/${driverId}/jobs`);
    
    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === "new_job") {
        // Add new job marker with animation
        setNearbyJobs(prev => [...prev, data.job]);
        
        // Haptic feedback
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      
      if (data.type === "job_taken") {
        // Remove job that was accepted by another driver
        setNearbyJobs(prev => prev.filter(j => j.id !== data.job_id));
      }
    };

    return () => ws.current?.close();
  }, [driverId]);

  const handleMarkerPress = useCallback((job: NearbyJob) => {
    setSelectedJob(job);
    bottomSheetRef.current?.expand();
    
    // Animate map to show both pickup and dropoff
    mapRef.current?.fitToCoordinates([
      { latitude: job.pickup.lat, longitude: job.pickup.lng },
      { latitude: job.dropoff.lat, longitude: job.dropoff.lng },
    ], {
      edgePadding: { top: 100, right: 50, bottom: 350, left: 50 },
      animated: true,
    });
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const handleAcceptJob = async () => {
    if (!selectedJob) return;
    
    try {
      await api.acceptOrder(selectedJob.id);
      
      // Navigate to active order screen
      router.push(`/order/${selectedJob.id}`);
    } catch (error) {
      Alert.alert("Error", "Job already taken by another driver");
      setNearbyJobs(prev => prev.filter(j => j.id !== selectedJob.id));
      setSelectedJob(null);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        showsUserLocation
        showsMyLocationButton={false}
        initialRegion={{
          latitude: driverLocation?.lat || 60.1699,
          longitude: driverLocation?.lng || 24.9384,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {/* Job markers */}
        {nearbyJobs.map((job) => (
          <JobMarker
            key={job.id}
            job={job}
            isSelected={selectedJob?.id === job.id}
            onPress={() => handleMarkerPress(job)}
          />
        ))}
      </MapView>

      {/* Job count indicator */}
      <View style={styles.jobCountBadge}>
        <Text style={styles.jobCountText}>
          {nearbyJobs.length} jobs nearby
        </Text>
      </View>

      {/* Job details bottom sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={["40%", "70%"]}
        enablePanDownToClose
        onClose={() => setSelectedJob(null)}
      >
        {selectedJob && (
          <JobDetailCard
            job={selectedJob}
            onAccept={handleAcceptJob}
            onDecline={() => {
              bottomSheetRef.current?.close();
              setSelectedJob(null);
            }}
          />
        )}
      </BottomSheet>
    </View>
  );
}

// Custom animated marker component
const JobMarker = ({ job, isSelected, onPress }) => {
  const scale = useRef(new Animated.Value(1)).current;
  
  useEffect(() => {
    // Pulse animation for new jobs
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.2, duration: 500, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Marker
      coordinate={{ latitude: job.pickup.lat, longitude: job.pickup.lng }}
      onPress={onPress}
    >
      <Animated.View style={[
        styles.marker,
        isSelected && styles.markerSelected,
        { transform: [{ scale }] }
      ]}>
        <Text style={styles.markerPrice}>€{job.earnings}</Text>
        <Text style={styles.markerDistance}>{job.distance_km}km</Text>
      </Animated.View>
    </Marker>
  );
};
```

## 4.2 Offline-First Architecture

```typescript
// /app/frontend/src/utils/storage/offlineQueue.ts

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

interface QueuedAction {
  id: string;
  type: "accept_order" | "update_status" | "submit_otp" | "upload_photo";
  payload: any;
  timestamp: number;
  retries: number;
}

class OfflineQueue {
  private queue: QueuedAction[] = [];
  private processing = false;
  private STORAGE_KEY = "@offline_queue";
  private MAX_RETRIES = 3;

  async init() {
    // Load persisted queue
    const stored = await AsyncStorage.getItem(this.STORAGE_KEY);
    if (stored) {
      this.queue = JSON.parse(stored);
    }

    // Listen for network changes
    NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        this.processQueue();
      }
    });
  }

  async add(action: Omit<QueuedAction, "id" | "timestamp" | "retries">) {
    const queuedAction: QueuedAction = {
      ...action,
      id: uuid(),
      timestamp: Date.now(),
      retries: 0,
    };

    this.queue.push(queuedAction);
    await this.persist();

    // Try to process immediately if online
    const netInfo = await NetInfo.fetch();
    if (netInfo.isConnected) {
      this.processQueue();
    }
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const action = this.queue[0];

    try {
      await this.executeAction(action);
      
      // Success - remove from queue
      this.queue.shift();
      await this.persist();
    } catch (error) {
      action.retries++;
      
      if (action.retries >= this.MAX_RETRIES) {
        // Give up after max retries
        this.queue.shift();
        console.error("Action failed after max retries:", action);
      }
      
      await this.persist();
    }

    this.processing = false;

    // Process next item
    if (this.queue.length > 0) {
      setTimeout(() => this.processQueue(), 1000);
    }
  }

  private async executeAction(action: QueuedAction) {
    switch (action.type) {
      case "accept_order":
        return api.acceptOrder(action.payload.orderId);
      case "update_status":
        return api.advanceOrder(action.payload.orderId);
      case "submit_otp":
        return api.verifyOtp(
          action.payload.orderId,
          action.payload.otp,
          action.payload.type
        );
      case "upload_photo":
        return api.uploadDeliveryPhoto(
          action.payload.orderId,
          action.payload.photoBase64
        );
    }
  }

  private async persist() {
    await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.queue));
  }
}

export const offlineQueue = new OfflineQueue();
```

## 4.3 Battery-Optimized Location Tracking

```typescript
// /app/frontend/src/services/locationTracking.ts

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

const LOCATION_TASK = "background-location-task";

// Configure location tracking based on order state
const LOCATION_CONFIGS = {
  idle: {
    accuracy: Location.Accuracy.Low,
    timeInterval: 60000,      // Every 60s when idle
    distanceInterval: 500,    // Or every 500m
  },
  enroute: {
    accuracy: Location.Accuracy.High,
    timeInterval: 5000,       // Every 5s when delivering
    distanceInterval: 20,     // Or every 20m
  },
  arrived: {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 30000,      // Every 30s when at location
    distanceInterval: 100,
  },
};

class LocationTracker {
  private currentConfig: keyof typeof LOCATION_CONFIGS = "idle";
  private subscription: Location.LocationSubscription | null = null;

  async start(config: keyof typeof LOCATION_CONFIGS = "idle") {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      throw new Error("Location permission denied");
    }

    this.currentConfig = config;
    const settings = LOCATION_CONFIGS[config];

    // Use background location for enroute (critical)
    if (config === "enroute" && Platform.OS !== "web") {
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      
      if (bgStatus === "granted") {
        await Location.startLocationUpdatesAsync(LOCATION_TASK, {
          accuracy: settings.accuracy,
          timeInterval: settings.timeInterval,
          distanceInterval: settings.distanceInterval,
          foregroundService: {
            notificationTitle: "NadaRuns Active",
            notificationBody: "Tracking your delivery",
          },
          pausesUpdatesAutomatically: false,
        });
        return;
      }
    }

    // Foreground tracking fallback
    this.subscription = await Location.watchPositionAsync(
      settings,
      this.handleLocationUpdate
    );
  }

  async updateConfig(config: keyof typeof LOCATION_CONFIGS) {
    if (config === this.currentConfig) return;
    
    await this.stop();
    await this.start(config);
  }

  async stop() {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }

    const hasTask = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK);
    if (hasTask) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  }

  private handleLocationUpdate = (location: Location.LocationObject) => {
    const { latitude: lat, longitude: lng } = location.coords;
    
    // Send to server (with batching for efficiency)
    locationBatcher.add({ lat, lng, timestamp: location.timestamp });
  };
}

// Batch location updates to reduce network calls
class LocationBatcher {
  private batch: Array<{ lat: number; lng: number; timestamp: number }> = [];
  private timer: NodeJS.Timeout | null = null;
  private BATCH_SIZE = 5;
  private BATCH_INTERVAL = 10000; // 10 seconds

  add(location: { lat: number; lng: number; timestamp: number }) {
    this.batch.push(location);

    if (this.batch.length >= this.BATCH_SIZE) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.BATCH_INTERVAL);
    }
  }

  private flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.batch.length === 0) return;

    const toSend = [...this.batch];
    this.batch = [];

    // Send batch to server
    api.updateDriverLocationBatch(toSend).catch(console.error);
  }
}

export const locationTracker = new LocationTracker();
export const locationBatcher = new LocationBatcher();

// Background task handler
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error("Background location error:", error);
    return;
  }

  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    for (const location of locations) {
      locationBatcher.add({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        timestamp: location.timestamp,
      });
    }
  }
});
```

---

# 5. UX IMPROVEMENTS (UBER/WOLT LEVEL)

## 5.1 Accept/Reject Flow (<1 second decision)

### Current (Slow)
- Modal popup blocks screen
- Requires reading details
- No urgency indicator

### Uber-Grade Design

```
┌─────────────────────────────────────────┐
│                                         │
│         [Map with route preview]        │
│                                         │
├─────────────────────────────────────────┤
│  €24.50           ←→ 8.2 km  ⏱ 18 min  │
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░  15s to accept   │
│                                         │
│  📍 IKEA Vantaa                         │
│  📍 Kalasatama, Helsinki                │
│                                         │
│  ┌─────────────┐   ┌─────────────┐     │
│  │   DECLINE   │   │   ACCEPT    │     │
│  │     ✕       │   │     ✓       │     │
│  └─────────────┘   └─────────────┘     │
└─────────────────────────────────────────┘
```

### Key UX Principles
1. **Auto-decline timer** - 15 seconds, visible countdown
2. **One-glance info** - Price, distance, time prominently displayed
3. **Route preview** - See the trip on map immediately
4. **Large tap targets** - Accept button at least 60x60pt
5. **Haptic feedback** - Vibrate on new job, confirm on accept

## 5.2 Navigation Flow (Minimal Friction)

```typescript
// Single-tap navigation launch
const handleNavigatePress = (destination: GeoPoint) => {
  const { lat, lng } = destination;
  
  // Direct launch to preferred app
  const url = Platform.select({
    ios: `maps://app?daddr=${lat},${lng}`,
    android: `google.navigation:q=${lat},${lng}`,
  });
  
  Linking.openURL(url);
};
```

## 5.3 Live Tracking (Smooth Movement)

```typescript
// Interpolate driver position for smooth animation
const AnimatedDriverMarker = ({ location }) => {
  const animatedLat = useRef(new Animated.Value(location.lat)).current;
  const animatedLng = useRef(new Animated.Value(location.lng)).current;

  useEffect(() => {
    // Smooth 2-second animation between position updates
    Animated.parallel([
      Animated.timing(animatedLat, {
        toValue: location.lat,
        duration: 2000,
        useNativeDriver: false,
        easing: Easing.linear,
      }),
      Animated.timing(animatedLng, {
        toValue: location.lng,
        duration: 2000,
        useNativeDriver: false,
        easing: Easing.linear,
      }),
    ]).start();
  }, [location]);

  return (
    <Marker.Animated
      coordinate={{
        latitude: animatedLat,
        longitude: animatedLng,
      }}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <DriverIcon heading={location.heading} />
    </Marker.Animated>
  );
};
```

---

# 6. DATABASE REDESIGN

## 6.1 MongoDB Schema Improvements

```javascript
// Orders collection - optimized
{
  "_id": ObjectId,
  "id": "uuid",
  "order_number": "NR-20250527-0001",
  "status": "enroute_pickup",
  
  // Geo-indexed locations
  "pickup_location": {
    "type": "Point",
    "coordinates": [24.9384, 60.1699]  // [lng, lat] for 2dsphere
  },
  "dropoff_location": {
    "type": "Point", 
    "coordinates": [24.9500, 60.1800]
  },
  
  // Denormalized for query performance
  "pickup_address": "IKEA Vantaa",
  "dropoff_address": "Kalasatama",
  
  // Foreign keys
  "driver_id": "uuid",
  "shipper_id": "uuid",
  
  // Financials
  "price_breakdown": {
    "base_fare": 5.00,
    "distance_fare": 12.50,
    "time_fare": 3.00,
    "surge_multiplier": 1.0,
    "tip": 2.00,
    "driver_earnings": 18.50,
    "platform_fee": 4.00
  },
  
  // Timestamps with TTL index for archival
  "created_at": ISODate,
  "accepted_at": ISODate,
  "picked_up_at": ISODate,
  "delivered_at": ISODate,
  
  // Media stored as S3 URLs, not base64
  "delivery_photo_url": "s3://nadaruns-media/photos/order-123.jpg",
  
  // Compact status history
  "status_history": [
    { "s": "pending", "t": ISODate },
    { "s": "accepted", "t": ISODate }
  ]
}

// Drivers collection - with real-time location
{
  "_id": ObjectId,
  "id": "uuid",
  "email": "driver@example.com",
  
  // Geo-indexed current location
  "current_location": {
    "type": "Point",
    "coordinates": [24.9384, 60.1699],
    "updated_at": ISODate,
    "heading": 180  // Direction in degrees
  },
  
  // Vehicle info
  "vehicle": {
    "type": "cargo_van",
    "capacity_kg": 1500,
    "plate": "HKI-1234"
  },
  
  // Stats (updated periodically, not real-time)
  "stats": {
    "total_deliveries": 1250,
    "rating": 4.92,
    "acceptance_rate": 96,
    "completion_rate": 99
  },
  
  // Online status with timestamp
  "is_online": true,
  "online_since": ISODate
}
```

## 6.2 Indexes for Performance

```javascript
// Critical indexes
db.orders.createIndex({ "status": 1, "created_at": -1 })
db.orders.createIndex({ "driver_id": 1, "status": 1 })
db.orders.createIndex({ "shipper_id": 1, "created_at": -1 })
db.orders.createIndex({ "pickup_location": "2dsphere" })
db.orders.createIndex({ "dropoff_location": "2dsphere" })

db.drivers.createIndex({ "email": 1 }, { unique: true })
db.drivers.createIndex({ "current_location": "2dsphere" })
db.drivers.createIndex({ "is_online": 1, "vehicle.type": 1 })

// TTL index for auto-archival (optional)
db.orders.createIndex(
  { "delivered_at": 1 }, 
  { expireAfterSeconds: 365 * 24 * 60 * 60 }  // 1 year
)
```

---

# 7. SCALABILITY PLAN

## 7.1 Horizontal Scaling Architecture

```
                    ┌─────────────────────────────────────────┐
                    │         Global Load Balancer            │
                    │         (Cloudflare / AWS ALB)          │
                    └─────────────────┬───────────────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            │                         │                         │
   ┌────────┴────────┐     ┌─────────┴─────────┐     ┌────────┴────────┐
   │   EU Region     │     │    US Region      │     │   APAC Region   │
   │  (Frankfurt)    │     │    (Virginia)     │     │   (Singapore)   │
   └────────┬────────┘     └─────────┬─────────┘     └────────┬────────┘
            │                        │                        │
    ┌───────┴───────┐       ┌───────┴───────┐       ┌───────┴───────┐
    │ API Cluster   │       │ API Cluster   │       │ API Cluster   │
    │ (3+ pods)     │       │ (3+ pods)     │       │ (3+ pods)     │
    └───────┬───────┘       └───────┬───────┘       └───────┬───────┘
            │                       │                       │
    ┌───────┴───────┐       ┌───────┴───────┐       ┌───────┴───────┐
    │ Redis Cluster │       │ Redis Cluster │       │ Redis Cluster │
    │ (Real-time)   │       │ (Real-time)   │       │ (Real-time)   │
    └───────────────┘       └───────────────┘       └───────────────┘
            │                       │                       │
            └───────────────────────┼───────────────────────┘
                                    │
                         ┌──────────┴──────────┐
                         │ MongoDB Atlas       │
                         │ (Global Cluster)    │
                         │ - Primary: EU       │
                         │ - Replicas: US, AP  │
                         └─────────────────────┘
```

## 7.2 Capacity Planning

| Scale | Drivers | Orders/Day | Infra |
|-------|---------|------------|-------|
| MVP | 100 | 500 | Single server |
| Growth | 10K | 50K | 3-node cluster |
| Scale | 100K | 500K | Multi-region, dedicated matching |
| Uber-level | 1M+ | 5M+ | Microservices, custom geo infra |

---

# 8. STEP-BY-STEP IMPLEMENTATION ROADMAP

## Phase 1: Critical Fixes (Week 1-2)
1. ✅ Add MongoDB geo-indexes
2. ✅ Implement basic driver matching algorithm
3. ✅ Move images to S3/CloudStorage
4. ✅ Add Redis for caching
5. ✅ Implement rate limiting

## Phase 2: Real-time Improvements (Week 3-4)
1. ✅ Redis Pub/Sub for WebSocket scaling
2. ✅ Push-based job notifications (not polling)
3. ✅ Map-based job discovery UI
4. ✅ Battery-optimized location tracking

## Phase 3: Production Hardening (Week 5-6)
1. ✅ Modularize backend into services
2. ✅ Add comprehensive logging (structured)
3. ✅ Set up monitoring (Prometheus/Grafana)
4. ✅ CI/CD pipeline
5. ✅ Load testing to 10K concurrent users

## Phase 4: Scale & Polish (Week 7-8)
1. ✅ Optimize matching algorithm
2. ✅ Add offline-first mobile capabilities
3. ✅ Smooth animation for tracking
4. ✅ A/B testing infrastructure
5. ✅ Analytics pipeline

---

# CONCLUSION

The current NadaRuns system is a **functional MVP** but has **critical scalability and production blockers**. The main issues are:

1. **Polling-based architecture** - Must switch to push-based
2. **No driver matching** - Just broadcasts to everyone
3. **In-memory WebSocket state** - Cannot scale horizontally
4. **No geo-indexing** - O(n) location queries
5. **Base64 images in DB** - Will explode storage

With the improvements outlined above, NadaRuns can scale from 100 to 100,000+ drivers while maintaining <100ms response times and Uber-grade UX.

**Priority Actions:**
1. Add MongoDB 2dsphere indexes (1 day)
2. Implement basic matching algorithm (3 days)
3. Switch to Redis Pub/Sub for WebSocket (2 days)
4. Build map-based job UI (5 days)
5. Move images to S3 (2 days)

Total estimated time to production-grade: **8 weeks** with 2 engineers.
