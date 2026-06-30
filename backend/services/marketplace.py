"""NadaRuns marketplace intelligence (Phase B).

Deterministic, explainable heuristics that resolve the marketplace adjustment
percentages consumed by the pricing engine:

  * per-region Supply & Demand + Market Heat Score
  * Route-matching discount (shipment overlaps a driver's existing journey)
  * Empty-run discount (driver returning empty after a delivery)
  * 4-tier recommendation engine (Budget / Balanced / Fast / Premium) with
    estimated driver acceptance %, waiting time and savings.

No model decides the price here — these only compute bounded percentages and
hand them to `services.pricing`, which remains the single source of truth.
"""

from typing import Optional, List, Dict, Any
from math import radians, sin, cos, asin, sqrt

from services import pricing

# Approx region centres (Finnish regions used across seed data + display names).
REGIONS: Dict[str, Dict[str, Any]] = {
    "helsinki": {"name": "Uusimaa", "lat": 60.1699, "lng": 24.9384},
    "tampere": {"name": "Pirkanmaa", "lat": 61.4978, "lng": 23.7610},
    "turku": {"name": "Varsinais-Suomi", "lat": 60.4518, "lng": 22.2666},
    "oulu": {"name": "Pohjois-Pohjanmaa", "lat": 65.0121, "lng": 25.4651},
    "kuopio": {"name": "Pohjois-Savo", "lat": 62.8924, "lng": 27.6770},
    "lapland": {"name": "Lapland", "lat": 66.5039, "lng": 25.7294},
}


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return r * 2 * asin(sqrt(a))


def resolve_region(lat: Optional[float], lng: Optional[float]) -> Optional[str]:
    """Map a coordinate to the nearest known region key (within ~150 km)."""
    if lat is None or lng is None:
        return None
    best, best_d = None, 1e9
    for key, r in REGIONS.items():
        d = haversine_km(lat, lng, r["lat"], r["lng"])
        if d < best_d:
            best, best_d = key, d
    return best  # always nearest region (Finland-wide coverage)


def region_name(region: Optional[str]) -> Optional[str]:
    return REGIONS.get(region, {}).get("name") if region else None


async def region_supply_demand(db, region: Optional[str], cfg: Optional[dict] = None) -> Dict[str, Any]:
    """Open jobs (demand) vs available drivers (supply) for a region → heat."""
    cfg = cfg or pricing.get_config()
    if not region:
        return {"region": None, "region_name": None, "demand": 0, "supply": 0,
                "ratio": 1.0, "adjustment_pct": 0.0,
                "heat": {"label": "Normal", "icon": "🟢", "ratio": 1.0, "adjustment_pct": 0.0}}

    # Demand: pending (unassigned) jobs whose pickup is in this region.
    demand = await db.orders.count_documents({"status": "pending", "region": region})

    # Supply: online drivers whose last known location resolves to this region
    # and who are not currently on an active job.
    online = await db.drivers.find(
        {"is_online": True, "is_suspended": {"$ne": True}},
        {"_id": 0, "id": 1, "current_location": 1},
    ).to_list(1000)
    busy_ids = set(await db.orders.distinct("driver_id", {"status": {"$in": list(sm_active_states())}}))
    supply = 0
    for d in online:
        loc = d.get("current_location") or {}
        lat, lng = loc.get("lat"), loc.get("lng")
        if lat is None or lng is None:
            continue
        if resolve_region(lat, lng) == region and d.get("id") not in busy_ids:
            supply += 1

    enabled = cfg.get("supply_demand", {}).get("enabled", True)
    ratio = (demand / max(supply, 1)) if enabled else 1.0
    heat = pricing.market_heat(ratio, cfg)
    return {
        "region": region, "region_name": region_name(region),
        "demand": demand, "supply": supply, "ratio": round(ratio, 2),
        "adjustment_pct": heat["adjustment_pct"] if enabled else 0.0,
        "heat": heat,
    }


def sm_active_states():
    """Active (non-terminal) order states — kept local to avoid hard import."""
    return {"accepted", "enroute_pickup", "arrived_pickup", "picked_up",
            "enroute_dropoff", "arrived_dropoff"}


def route_match_discount(
    driver_origin: Optional[dict], driver_dest: Optional[dict],
    pickup: dict, dropoff: dict, cfg: Optional[dict] = None,
) -> Dict[str, Any]:
    """If the shipment mostly overlaps the driver's existing journey, only the
    incremental detour is charged. Returns a bounded discount %.

    overlap heuristic: detour = (origin→pickup) + (pickup→dropoff) + (dropoff→dest)
    minus the driver's existing (origin→dest). The smaller the extra distance
    relative to the shipment distance, the larger the discount.
    """
    cfg = (cfg or pricing.get_config()).get("route_match", {})
    if not cfg.get("enabled", True) or not driver_origin or not driver_dest:
        return {"discount_pct": 0.0, "overlap_pct": 0.0, "detour_km": None}

    def km(a, b):
        return haversine_km(a["lat"], a["lng"], b["lat"], b["lng"])

    ship_km = km(pickup, dropoff)
    if ship_km <= 0:
        return {"discount_pct": 0.0, "overlap_pct": 0.0, "detour_km": None}

    existing = km(driver_origin, driver_dest)
    with_job = (km(driver_origin, pickup) + ship_km + km(dropoff, driver_dest))
    detour = max(0.0, with_job - existing)  # extra distance the job adds
    # How much of the shipment distance is "free" (already covered by the route).
    overlap = max(0.0, min(1.0, 1.0 - (detour / max(ship_km, 1.0))))
    max_disc = float(cfg.get("max_discount_pct", 0.30))
    min_overlap = float(cfg.get("min_overlap_pct", 0.4))
    discount = max_disc * overlap if overlap >= min_overlap else 0.0
    return {"discount_pct": round(min(discount, max_disc), 4),
            "overlap_pct": round(overlap, 3), "detour_km": round(detour, 1)}


def empty_run_discount(returning_empty: bool, cfg: Optional[dict] = None) -> float:
    cfg = (cfg or pricing.get_config()).get("empty_run", {})
    if not cfg.get("enabled", True) or not returning_empty:
        return 0.0
    return round(float(cfg.get("discount_pct", 0.25)), 4)


def env_savings(distance_km: float, cfg: Optional[dict] = None, empty_km: Optional[float] = None) -> Dict[str, Any]:
    """Estimated environmental benefit of filling a run that would otherwise be
    empty/under-utilised. `empty_km` defaults to the trip distance.
    """
    env = (cfg or pricing.get_config()).get("environment", {})
    km = float(empty_km if empty_km is not None else (distance_km or 0))
    co2 = float(env.get("co2_kg_per_km", 0.90))
    fuel = float(env.get("fuel_l_per_km", 0.32))
    return {
        "empty_km_eliminated": round(km, 1),
        "co2_saved_kg": round(km * co2, 1),
        "fuel_saved_l": round(km * fuel, 1),
    }


def build_recommendations(balanced_total: float, traditional_estimate: float,
                          heat: Dict[str, Any], cfg: Optional[dict] = None) -> List[Dict[str, Any]]:
    """4 price tiers with estimated acceptance %, wait time and savings.

    Acceptance rises with price (more attractive to drivers) and with market
    heat (more demand → drivers grab jobs faster). Wait time is the inverse.
    """
    cfg = cfg or pricing.get_config()
    tiers_cfg = cfg.get("recommendation_tiers", {})
    heat_adj = float(heat.get("adjustment_pct", 0.0))  # -0.15 .. +0.25
    out: List[Dict[str, Any]] = []
    labels = {"budget": "Budget", "balanced": "Balanced", "fast": "Fast match", "premium": "Premium"}
    order = ["budget", "balanced", "fast", "premium"]
    for key in order:
        t = tiers_cfg.get(key)
        if not t:
            continue
        offset = float(t.get("offset_pct", 0.0))
        price = round(balanced_total * (1 + offset), 2)
        base_acc = float(t.get("base_acceptance", 0.8))
        # Hot market lifts acceptance; cold market lowers it (bounded 5–99%).
        acceptance = max(0.05, min(0.99, base_acc + heat_adj * 0.6))
        # Wait time (minutes): inversely proportional to acceptance, eased by heat.
        wait = (1.0 - acceptance) * 45.0
        wait = wait / (1.0 + max(heat_adj, 0.0) * 2.0)
        wait_min = max(2, int(round(wait)))
        savings = round(traditional_estimate - price, 2)
        savings_pct = round((savings / traditional_estimate) * 100, 1) if traditional_estimate > 0 else 0.0
        out.append({
            "tier": key, "label": labels.get(key, key.title()),
            "price": price,
            "acceptance_pct": int(round(acceptance * 100)),
            "wait_minutes": wait_min,
            "savings": savings, "savings_pct": savings_pct,
            "recommended": key == "balanced",
        })
    return out
