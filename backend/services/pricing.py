"""NadaRuns pricing engine.

Final Price = (Base Fee + Distance x Vehicle KM Rate + Weight Fee)
              x Urgency Multiplier
              x Special-Vehicle Multiplier
              + Fuel Surcharge (8%)

The calculated total is the IMMUTABLE base price (enforced minimum). A shipper
may add an optional `offer` (bonus) on top to attract drivers faster; that bonus
is paid out fully to the driver.

All figures are tuned for Finland / Nordics (EUR).
"""

from typing import Optional

FUEL_SURCHARGE_PCT = 0.08
DRIVER_SHARE = 0.80  # driver keeps 80% of the base price, 100% of any offer

# 1. Base fee per vehicle (covers dispatch, platform, startup, min profit)
BASE_FEES = {
    "cargo_van": 12.0,
    "box_truck": 25.0,
    "flatbed_truck": 35.0,
    "semi_truck": 60.0,
    "trailer_truck": 70.0,
    "container_truck": 90.0,
    "tanker": 120.0,
    "refrigerated": 60.0,
    "crane_truck": 150.0,
    "hazmat": 180.0,
    "other": 40.0,
}

# 2. Distance rate (EUR / km) - the main cost driver
KM_RATES = {
    "cargo_van": 1.10,
    "box_truck": 1.60,
    "flatbed_truck": 1.90,
    "semi_truck": 2.40,
    "trailer_truck": 2.60,
    "container_truck": 3.20,
    "tanker": 3.50,
    "refrigerated": 2.80,
    "crane_truck": 4.00,
    "hazmat": 4.50,
    "other": 2.00,
}

# 3. Freight (chargeable) weight rate — EUR per chargeable kg.
# Finnish road-freight model: the WEIGHT component is charged on the
# "chargeable freight weight" (rahdituspaino) = the GREATEST of actual weight,
# volumetric weight, pallet weight and loading-meter weight (see below).
FREIGHT_KG_RATES = {
    "cargo_van": 0.12,
    "box_truck": 0.10,
    "flatbed_truck": 0.09,
    "semi_truck": 0.07,
    "trailer_truck": 0.06,
    "container_truck": 0.05,
    "tanker": 0.06,
    "refrigerated": 0.11,
    "crane_truck": 0.08,
    "hazmat": 0.15,
    "other": 0.10,
}

# Finnish chargeable-weight conversion factors (Logistiikan Maailma):
#   - 1 m3 of stackable cargo  = 333 kg  (computational/volumetric weight)
#   - 1 FIN pallet (non-stack) = 925 kg
#   - 1 loading meter (full width/height) = 1850 kg (≈ two FIN pallets)
VOLUMETRIC_KG_PER_M3 = 333.0
PALLET_WEIGHT_KG = 925.0
LOADING_METER_WEIGHT_KG = 1850.0

# 4. Special-vehicle surcharge (added to the multiplier, e.g. +15% => 0.15)
SPECIAL_VEHICLE_SURCHARGE = {
    "refrigerated": 0.15,
    "hazmat": 0.35,
    "crane_truck": 0.25,
    "tanker": 0.20,
}
OVERSIZED_SURCHARGE = 0.15  # applied when special handling / oversized cargo

# 5. Urgency / priority multipliers
URGENCY_MULTIPLIERS = {
    "standard": 1.0,
    "express": 1.3,
    "priority": 1.5,
    "emergency": 2.0,
}


def chargeable_weight(
    actual_weight_kg: Optional[float] = 0,
    volume_m3: Optional[float] = 0,
    pallets: Optional[int] = 0,
    loading_meters: Optional[float] = 0,
) -> dict:
    """Finnish chargeable freight weight (rahdituspaino).

    Returns the GREATEST of the four computational weights along with which
    basis won and every candidate (for a transparent breakdown).
    """
    actual = max(0.0, float(actual_weight_kg or 0))
    volumetric = max(0.0, float(volume_m3 or 0)) * VOLUMETRIC_KG_PER_M3
    pallet_w = max(0, int(pallets or 0)) * PALLET_WEIGHT_KG
    loadm_w = max(0.0, float(loading_meters or 0)) * LOADING_METER_WEIGHT_KG

    candidates = {
        "actual": round(actual, 1),
        "volumetric": round(volumetric, 1),
        "pallet": round(pallet_w, 1),
        "loading_meter": round(loadm_w, 1),
    }
    basis = max(candidates, key=lambda k: candidates[k])
    value = candidates[basis]
    if value <= 0:
        basis = "actual"
    return {"chargeable_weight": value, "basis": basis, "candidates": candidates}


def calculate_price(
    vehicle_type: str,
    distance_km: float,
    weight_kg: Optional[float] = 0,
    urgency: str = "standard",
    special_handling: bool = False,
    volume_m3: Optional[float] = 0,
    pallets: Optional[int] = 0,
    loading_meters: Optional[float] = 0,
) -> dict:
    """Return a full pricing breakdown for a shipment.

    The weight component is charged on the Finnish *chargeable freight weight*
    (the greatest of actual / volumetric / pallet / loading-meter weight) at a
    per-kg freight rate, so a bulky-but-light load is priced fairly.
    """
    base_fee = BASE_FEES.get(vehicle_type, BASE_FEES["other"])
    km_rate = KM_RATES.get(vehicle_type, KM_RATES["other"])
    freight_rate = FREIGHT_KG_RATES.get(vehicle_type, FREIGHT_KG_RATES["other"])
    distance_km = max(0.0, float(distance_km or 0))

    distance_fee = distance_km * km_rate

    cw = chargeable_weight(weight_kg, volume_m3, pallets, loading_meters)
    chargeable = cw["chargeable_weight"]
    freight_fee = chargeable * freight_rate
    subtotal = base_fee + distance_fee + freight_fee

    urgency_mult = URGENCY_MULTIPLIERS.get(urgency, 1.0)
    special_mult = 1.0 + SPECIAL_VEHICLE_SURCHARGE.get(vehicle_type, 0.0)
    if special_handling:
        special_mult += OVERSIZED_SURCHARGE

    pre_fuel = subtotal * urgency_mult * special_mult
    fuel = pre_fuel * FUEL_SURCHARGE_PCT
    total = pre_fuel + fuel

    # Floor so very short trips remain viable.
    total = max(total, base_fee + 5.0)

    low = round(total * 0.95)
    high = round(total * 1.15)

    return {
        "currency": "EUR",
        "vehicle_type": vehicle_type,
        "distance_km": round(distance_km, 2),
        "base_fee": round(base_fee, 2),
        "distance_fee": round(distance_fee, 2),
        "freight_fee": round(freight_fee, 2),
        "weight_fee": round(freight_fee, 2),  # back-compat alias
        "freight_rate_per_kg": freight_rate,
        "chargeable_weight": chargeable,
        "chargeable_basis": cw["basis"],
        "weight_candidates": cw["candidates"],
        "actual_weight_kg": round(float(weight_kg or 0), 1),
        "subtotal": round(subtotal, 2),
        "urgency": urgency,
        "urgency_multiplier": urgency_mult,
        "special_multiplier": round(special_mult, 2),
        "fuel_surcharge": round(fuel, 2),
        "total_price": round(total, 2),
        "estimate_low": float(low),
        "estimate_high": float(high),
    }


def driver_earnings(base_total: float, offer: float = 0.0) -> float:
    """Driver keeps 80% of the base price + 100% of any shipper offer (bonus)."""
    return round(base_total * DRIVER_SHARE + max(0.0, offer or 0.0), 2)
