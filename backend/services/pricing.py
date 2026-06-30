"""NadaRuns intelligent marketplace pricing engine.

NadaRuns is a digital logistics *marketplace* (not a freight carrier), so pricing
is built around reducing empty runs, maximising vehicle utilisation and balancing
supply & demand — NOT a linear "base + distance + weight" carrier tariff.

    Final Price = (Base Booking Fee + Distance Cost)
                  × (1 + Weight-category adjustment)
                  × Capacity-utilisation factor
                  × Supply & Demand factor
                  × Empty-run discount
                  × Route-match discount
                  × Urgency multiplier
                  × Special-vehicle factor
                  × Regional factor
                  × Seasonal factor
                  × Reputation factor
                  + Fuel adjustment
                  (+ optional Shipper Bonus → 100% to driver)

Distance remains the primary cost driver. Weight no longer dominates — the
Finnish chargeable freight weight (rahdituspaino) is still computed, but it only
selects a *weight category* that applies a small percentage adjustment.

EVERYTHING is config-driven: all rates/percentages live in a versioned config
that admins edit from the dashboard (no code changes). The pure engine here is
deterministic and explainable; marketplace intelligence (supply/demand,
empty-run, route-match, reputation) is resolved upstream and passed in as
percentage adjustments, so the engine stays testable and the actual price is
never decided by an opaque model.
"""

from typing import Optional, List, Dict, Any
import copy

# Finnish chargeable-weight conversion factors (Logistiikan Maailma):
#   1 m3 stackable cargo = 333 kg, 1 FIN pallet = 925 kg, 1 loading metre = 1850 kg.
VOLUMETRIC_KG_PER_M3 = 333.0
PALLET_WEIGHT_KG = 925.0
LOADING_METER_WEIGHT_KG = 1850.0

# ---------------------------------------------------------------------------
# Default configuration (version 1 seed). Admins clone/edit this from the UI.
# ---------------------------------------------------------------------------
DEFAULT_CONFIG: Dict[str, Any] = {
    # 1. Base booking fee per vehicle (dispatch, payments, platform, min profit)
    "base_fees": {
        "cargo_van": 12.0, "box_truck": 25.0, "flatbed_truck": 35.0,
        "semi_truck": 60.0, "trailer_truck": 70.0, "container_truck": 90.0,
        "tanker": 120.0, "refrigerated": 60.0, "crane_truck": 150.0,
        "hazmat": 180.0, "other": 40.0,
    },
    # 2. Distance €/km — the primary cost driver
    "km_rates": {
        "cargo_van": 1.10, "box_truck": 1.60, "flatbed_truck": 1.90,
        "semi_truck": 2.40, "trailer_truck": 2.60, "container_truck": 3.20,
        "tanker": 3.50, "refrigerated": 2.80, "crane_truck": 4.00,
        "hazmat": 4.50, "other": 2.00,
    },
    # 3. Weight CATEGORY adjustments (chargeable weight → small % bump).
    #    max_kg=None is the catch-all top band. Percentages are configurable.
    "weight_bands": [
        {"label": "Very Light", "max_kg": 500, "adjustment_pct": 0.00},
        {"label": "Light", "max_kg": 2000, "adjustment_pct": 0.05},
        {"label": "Medium", "max_kg": 8000, "adjustment_pct": 0.10},
        {"label": "Heavy", "max_kg": 16000, "adjustment_pct": 0.18},
        {"label": "Very Heavy", "max_kg": None, "adjustment_pct": 0.25},
    ],
    # 4. Capacity utilisation: higher utilisation → slightly higher price
    #    (remaining space is scarce); low utilisation → cheaper (encourage match).
    "capacity_bands": [
        {"label": "Low", "max_pct": 40, "adjustment_pct": -0.05},
        {"label": "Moderate", "max_pct": 70, "adjustment_pct": 0.00},
        {"label": "High", "max_pct": 90, "adjustment_pct": 0.05},
        {"label": "Scarce", "max_pct": None, "adjustment_pct": 0.10},
    ],
    # 7. Supply & demand (market heat). Resolved per region upstream; these are
    #    the bounds + heat thresholds the engine/route layer use.
    "supply_demand": {
        "enabled": True,
        "max_surge_pct": 0.25,      # busiest market: up to +25%
        "max_discount_pct": 0.15,   # over-supplied market: down to -15%
        "sensitivity": 1.0,         # multiplier on the demand/supply ratio
        # Heat label thresholds on the demand-vs-supply ratio (open jobs / online vehicles)
        "heat_thresholds": {"cold": 0.5, "normal": 1.0, "busy": 1.5, "very_busy": 2.5},
    },
    # 5. Empty-run discount (driver returning empty → discount; still earns extra)
    "empty_run": {"enabled": True, "discount_pct": 0.25, "min_driver_uplift_pct": 0.0},
    # 6. Route-match discount: shipment overlaps an existing driver journey →
    #    charge mostly the incremental detour. Discount scales with overlap.
    "route_match": {"enabled": True, "max_discount_pct": 0.30, "min_overlap_pct": 0.4},
    # 8. Fuel adjustment (replaces the fixed 8% — fully configurable)
    "fuel_pct": 0.08,
    # 9. Special-vehicle adjustments (configurable)
    "special_vehicle_surcharge": {
        "refrigerated": 0.15, "hazmat": 0.35, "crane_truck": 0.25, "tanker": 0.20,
    },
    "special_handling_surcharge": {
        "oversized": 0.15, "fragile": 0.08, "dangerous": 0.20,
    },
    # 10. Urgency multipliers (configurable)
    "urgency_multipliers": {
        "standard": 1.0, "express": 1.3, "priority": 1.5, "emergency": 2.0,
    },
    # 13. Revenue split (driver share increased to 85%; configurable)
    "commission": {"driver_share": 0.85, "platform_share": 0.15},
    # Regional adjustments (per region key, e.g. "pirkanmaa": 0.0)
    "regional_adjustments": {},
    # Seasonal adjustments (per month 1-12 or season key, percentage)
    "seasonal_adjustments": {},
    # Reputation pricing bounds (Phase E) — resolved upstream, bounded here.
    "reputation": {"enabled": True, "max_uplift_pct": 0.08, "max_discount_pct": 0.05},
    # Savings comparison vs a traditional freight carrier estimate.
    "traditional_freight_multiplier": 1.30,
    # Pricing floor so very short trips stay viable: base_fee + this.
    "min_price_floor_add": 5.0,
    # Recommendation tiers (Phase B): % offset from the balanced price + assumed
    # acceptance characteristics. Acceptance %/wait resolved with market heat.
    "recommendation_tiers": {
        "budget": {"offset_pct": -0.08, "base_acceptance": 0.55},
        "balanced": {"offset_pct": 0.00, "base_acceptance": 0.80},
        "fast": {"offset_pct": 0.08, "base_acceptance": 0.95},
        "premium": {"offset_pct": 0.18, "base_acceptance": 0.99},
    },
    # CO2 / environmental model (Phase C)
    "environment": {"co2_kg_per_km": 0.90, "fuel_l_per_km": 0.32},
}

# Module-level active config (loaded from DB on startup, falls back to default).
_CONFIG: Dict[str, Any] = copy.deepcopy(DEFAULT_CONFIG)
_CONFIG_VERSION: Optional[int] = None


def configure(config: Optional[dict] = None, version: Optional[int] = None):
    """Install the active pricing config (merged over defaults for safety)."""
    global _CONFIG, _CONFIG_VERSION
    merged = copy.deepcopy(DEFAULT_CONFIG)
    if config:
        for k, v in config.items():
            merged[k] = v
    _CONFIG = merged
    _CONFIG_VERSION = version
    return _CONFIG


def get_config() -> Dict[str, Any]:
    return _CONFIG


def get_config_version() -> Optional[int]:
    return _CONFIG_VERSION


# ---------------------------------------------------------------------------
# Finnish chargeable freight weight (unchanged calculation, still authoritative)
# ---------------------------------------------------------------------------
def chargeable_weight(
    actual_weight_kg: Optional[float] = 0,
    volume_m3: Optional[float] = 0,
    pallets: Optional[int] = 0,
    loading_meters: Optional[float] = 0,
) -> dict:
    actual = max(0.0, float(actual_weight_kg or 0))
    volumetric = max(0.0, float(volume_m3 or 0)) * VOLUMETRIC_KG_PER_M3
    pallet_w = max(0, int(pallets or 0)) * PALLET_WEIGHT_KG
    loadm_w = max(0.0, float(loading_meters or 0)) * LOADING_METER_WEIGHT_KG
    candidates = {
        "actual": round(actual, 1), "volumetric": round(volumetric, 1),
        "pallet": round(pallet_w, 1), "loading_meter": round(loadm_w, 1),
    }
    basis = max(candidates, key=lambda k: candidates[k])
    value = candidates[basis]
    if value <= 0:
        basis = "actual"
    return {"chargeable_weight": value, "basis": basis, "candidates": candidates}


def _band_for(bands: List[dict], value: float, key: str = "max_kg") -> dict:
    ordered = sorted(bands, key=lambda b: (b.get(key) is None, b.get(key) or 0))
    for b in ordered:
        cap = b.get(key)
        if cap is None or value <= cap:
            return b
    return ordered[-1] if ordered else {"label": "", "adjustment_pct": 0.0}


def market_heat(demand_supply_ratio: float, cfg: Optional[dict] = None) -> dict:
    """Map a demand/supply ratio to a human heat label + surge/discount %."""
    cfg = cfg or _CONFIG
    sd = cfg.get("supply_demand", {})
    th = sd.get("heat_thresholds", {})
    r = max(0.0, float(demand_supply_ratio or 0))
    if r < th.get("cold", 0.5):
        label, icon = "Cold", "❄️"
    elif r < th.get("normal", 1.0):
        label, icon = "Normal", "🟢"
    elif r < th.get("busy", 1.5):
        label, icon = "Busy", "🔥"
    elif r < th.get("very_busy", 2.5):
        label, icon = "Very Busy", "🔥🔥"
    else:
        label, icon = "Critical", "🚨"
    # Resolve surge/discount % from the ratio, bounded by config.
    sens = float(sd.get("sensitivity", 1.0) or 1.0)
    if r >= 1.0:
        pct = min((r - 1.0) * sens * 0.2, float(sd.get("max_surge_pct", 0.25)))
    else:
        pct = -min((1.0 - r) * sens * 0.2, float(sd.get("max_discount_pct", 0.15)))
    return {"label": label, "icon": icon, "ratio": round(r, 2), "adjustment_pct": round(pct, 4)}


def compute(
    *,
    vehicle_type: str,
    distance_km: float,
    actual_weight_kg: Optional[float] = 0,
    volume_m3: Optional[float] = 0,
    pallets: Optional[int] = 0,
    loading_meters: Optional[float] = 0,
    urgency: str = "standard",
    special_handling: bool = False,
    special_flags: Optional[List[str]] = None,
    capacity_utilization_pct: Optional[float] = None,
    supply_demand_pct: float = 0.0,
    empty_run_discount_pct: float = 0.0,
    route_match_discount_pct: float = 0.0,
    regional_pct: float = 0.0,
    seasonal_pct: float = 0.0,
    reputation_pct: float = 0.0,
    config: Optional[dict] = None,
) -> dict:
    """Deterministic, fully-explainable marketplace price.

    Marketplace adjustments (supply/demand, empty-run, route-match, regional,
    seasonal, reputation, capacity) are resolved UPSTREAM and passed in as
    signed percentages so this stays a pure function. Returns the final price,
    a transparent line-by-line breakdown (euro deltas), driver earnings, and a
    savings-vs-traditional comparison.
    """
    cfg = config or _CONFIG
    base_fees = cfg.get("base_fees", {})
    km_rates = cfg.get("km_rates", {})
    base_fee = float(base_fees.get(vehicle_type, base_fees.get("other", 40.0)))
    km_rate = float(km_rates.get(vehicle_type, km_rates.get("other", 2.0)))
    distance_km = max(0.0, float(distance_km or 0))
    distance_fee = distance_km * km_rate

    # Chargeable weight → weight category adjustment
    cw = chargeable_weight(actual_weight_kg, volume_m3, pallets, loading_meters)
    wband = _band_for(cfg.get("weight_bands", []), cw["chargeable_weight"], "max_kg")
    weight_pct = float(wband.get("adjustment_pct", 0.0))

    # Capacity utilisation adjustment (neutral if unknown)
    cap_pct = 0.0
    cap_label = None
    if capacity_utilization_pct is not None:
        cband = _band_for(cfg.get("capacity_bands", []), float(capacity_utilization_pct), "max_pct")
        cap_pct = float(cband.get("adjustment_pct", 0.0))
        cap_label = cband.get("label")

    # Urgency
    urgency_mult = float(cfg.get("urgency_multipliers", {}).get(urgency, 1.0))

    # Special vehicle + special handling
    special_pct = float(cfg.get("special_vehicle_surcharge", {}).get(vehicle_type, 0.0))
    handling_extra = 0.0
    sh_cfg = cfg.get("special_handling_surcharge", {})
    flags = [f.lower() for f in (special_flags or [])]
    if special_handling:
        handling_extra += float(sh_cfg.get("oversized", 0.15))
    for f in flags:
        if f in sh_cfg:
            handling_extra += float(sh_cfg[f])
    special_total_pct = special_pct + handling_extra

    fuel_pct = float(cfg.get("fuel_pct", 0.08))

    # ---- Build the transparent breakdown, applying each factor in order ----
    lines: List[dict] = []
    running = base_fee
    lines.append({"key": "base_fee", "label": "Base booking fee", "type": "base",
                  "amount": round(base_fee, 2), "detail": vehicle_type})
    running += distance_fee
    lines.append({"key": "distance", "label": "Distance", "type": "add",
                  "amount": round(distance_fee, 2),
                  "detail": f"{round(distance_km,1)} km × €{km_rate:.2f}/km"})

    def apply(pct: float, key: str, label: str, kind: str):
        nonlocal running
        if not pct:
            return
        delta = running * pct
        running += delta
        lines.append({"key": key, "label": label,
                      "type": ("discount" if delta < 0 else kind),
                      "amount": round(delta, 2),
                      "detail": f"{'+' if pct >= 0 else ''}{round(pct*100,1)}%"})

    apply(weight_pct, "weight_category", f"Weight · {wband.get('label','')}", "add")
    if capacity_utilization_pct is not None:
        apply(cap_pct, "capacity", f"Capacity · {cap_label}", "add")
    apply(supply_demand_pct, "supply_demand", "Supply & demand", "add")
    apply(-abs(empty_run_discount_pct), "empty_run", "Empty-run discount", "discount")
    apply(-abs(route_match_discount_pct), "route_match", "Route-match discount", "discount")
    apply(urgency_mult - 1.0, "urgency", f"Urgency · {urgency}", "add")
    apply(special_total_pct, "special_vehicle", "Special vehicle / handling", "add")
    apply(regional_pct, "regional", "Regional adjustment", "add")
    apply(seasonal_pct, "seasonal", "Seasonal adjustment", "add")
    apply(reputation_pct, "reputation", "Driver reputation", "add")

    pre_fuel = running
    fuel = pre_fuel * fuel_pct
    running += fuel
    lines.append({"key": "fuel", "label": "Fuel adjustment", "type": "add",
                  "amount": round(fuel, 2), "detail": f"+{round(fuel_pct*100,1)}%"})

    floor = base_fee + float(cfg.get("min_price_floor_add", 5.0))
    total = max(running, floor)
    if total != running:
        lines.append({"key": "floor", "label": "Minimum price floor", "type": "add",
                      "amount": round(total - running, 2), "detail": f"€{round(floor,2)} min"})

    lines.append({"key": "total", "label": "NadaRuns price", "type": "total",
                  "amount": round(total, 2), "detail": None})

    # Savings vs a traditional freight carrier estimate
    trad_mult = float(cfg.get("traditional_freight_multiplier", 1.30))
    traditional = round(total * trad_mult, 2)
    savings = round(traditional - total, 2)
    savings_pct = round((savings / traditional) * 100, 1) if traditional > 0 else 0.0

    driver_share = float(cfg.get("commission", {}).get("driver_share", 0.85))
    low = round(total * 0.95)
    high = round(total * 1.15)

    return {
        "currency": "EUR",
        "vehicle_type": vehicle_type,
        "distance_km": round(distance_km, 2),
        "base_fee": round(base_fee, 2),
        "distance_fee": round(distance_fee, 2),
        "km_rate": km_rate,
        # weight (category model)
        "weight_category": wband.get("label"),
        "weight_adjustment_pct": weight_pct,
        "chargeable_weight": cw["chargeable_weight"],
        "chargeable_basis": cw["basis"],
        "weight_candidates": cw["candidates"],
        "actual_weight_kg": round(float(actual_weight_kg or 0), 1),
        # back-compat aliases (older clients/tests)
        "freight_fee": round(running * 0, 2),  # legacy: no separate freight line now
        "weight_fee": 0.0,
        "freight_rate_per_kg": 0.0,
        # capacity / marketplace
        "capacity_utilization_pct": capacity_utilization_pct,
        "capacity_label": cap_label,
        "supply_demand_pct": round(supply_demand_pct, 4),
        "empty_run_discount_pct": round(abs(empty_run_discount_pct), 4),
        "route_match_discount_pct": round(abs(route_match_discount_pct), 4),
        "regional_pct": round(regional_pct, 4),
        "seasonal_pct": round(seasonal_pct, 4),
        "reputation_pct": round(reputation_pct, 4),
        # urgency / special
        "urgency": urgency,
        "urgency_multiplier": urgency_mult,
        "special_multiplier": round(1.0 + special_total_pct, 4),
        "special_total_pct": round(special_total_pct, 4),
        # totals
        "subtotal": round(base_fee + distance_fee, 2),
        "fuel_surcharge": round(fuel, 2),
        "fuel_pct": fuel_pct,
        "total_price": round(total, 2),
        "estimate_low": float(low),
        "estimate_high": float(high),
        # transparency + value
        "breakdown_lines": lines,
        "traditional_estimate": traditional,
        "savings": savings,
        "savings_pct": savings_pct,
        "driver_share": driver_share,
        "config_version": _CONFIG_VERSION,
    }


# ---------------------------------------------------------------------------
# Backward-compatible wrappers used across the codebase
# ---------------------------------------------------------------------------
def calculate_price(
    vehicle_type: str,
    distance_km: float,
    weight_kg: Optional[float] = 0,
    urgency: str = "standard",
    special_handling: bool = False,
    volume_m3: Optional[float] = 0,
    pallets: Optional[int] = 0,
    loading_meters: Optional[float] = 0,
    **marketplace,
) -> dict:
    """Compatibility entrypoint. Marketplace adjustments default to neutral; the
    route layer may pass capacity/supply/empty-run/route-match via **marketplace.
    """
    return compute(
        vehicle_type=vehicle_type,
        distance_km=distance_km,
        actual_weight_kg=weight_kg,
        volume_m3=volume_m3,
        pallets=pallets,
        loading_meters=loading_meters,
        urgency=urgency,
        special_handling=special_handling,
        capacity_utilization_pct=marketplace.get("capacity_utilization_pct"),
        supply_demand_pct=marketplace.get("supply_demand_pct", 0.0),
        empty_run_discount_pct=marketplace.get("empty_run_discount_pct", 0.0),
        route_match_discount_pct=marketplace.get("route_match_discount_pct", 0.0),
        regional_pct=marketplace.get("regional_pct", 0.0),
        seasonal_pct=marketplace.get("seasonal_pct", 0.0),
        reputation_pct=marketplace.get("reputation_pct", 0.0),
        special_flags=marketplace.get("special_flags"),
    )


def driver_earnings(base_total: float, offer: float = 0.0) -> float:
    """Driver keeps the configured share of base + 100% of any shipper bonus."""
    share = float(_CONFIG.get("commission", {}).get("driver_share", 0.85))
    return round(base_total * share + max(0.0, offer or 0.0), 2)
