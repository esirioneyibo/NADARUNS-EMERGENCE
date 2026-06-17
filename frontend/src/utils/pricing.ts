/**
 * NadaRuns client-side pricing estimator.
 *
 * This MIRRORS the authoritative server engine in
 * `backend/services/pricing.py`. Keep the two in sync — if you change a rate
 * here, change it there too. The server always recomputes the real price at
 * order-creation time, so this is a fast, network-free estimate that is shown
 * instantly in the create-shipment flow (no spinner, works offline).
 *
 * Final Price = (Base Fee + Distance x KM Rate + Weight Fee)
 *               x Urgency Multiplier x Special Multiplier
 *               + 8% Fuel Surcharge,  floored at (Base Fee + 5).
 */

export const FUEL_SURCHARGE_PCT = 0.08;

const BASE_FEES: Record<string, number> = {
  cargo_van: 12.0,
  box_truck: 25.0,
  flatbed_truck: 35.0,
  semi_truck: 60.0,
  trailer_truck: 70.0,
  container_truck: 90.0,
  tanker: 120.0,
  refrigerated: 60.0,
  crane_truck: 150.0,
  hazmat: 180.0,
  other: 40.0,
};

const KM_RATES: Record<string, number> = {
  cargo_van: 1.1,
  box_truck: 1.6,
  flatbed_truck: 1.9,
  semi_truck: 2.4,
  trailer_truck: 2.6,
  container_truck: 3.2,
  tanker: 3.5,
  refrigerated: 2.8,
  crane_truck: 4.0,
  hazmat: 4.5,
  other: 2.0,
};

// Freight (chargeable) weight rate — EUR per chargeable kg. Mirrors backend.
const FREIGHT_KG_RATES: Record<string, number> = {
  cargo_van: 0.12,
  box_truck: 0.1,
  flatbed_truck: 0.09,
  semi_truck: 0.07,
  trailer_truck: 0.06,
  container_truck: 0.05,
  tanker: 0.06,
  refrigerated: 0.11,
  crane_truck: 0.08,
  hazmat: 0.15,
  other: 0.1,
};

// Finnish chargeable-weight conversion factors (Logistiikan Maailma).
export const VOLUMETRIC_KG_PER_M3 = 333.0;
export const PALLET_WEIGHT_KG = 925.0;
export const LOADING_METER_WEIGHT_KG = 1850.0;

const SPECIAL_VEHICLE_SURCHARGE: Record<string, number> = {
  refrigerated: 0.15,
  hazmat: 0.35,
  crane_truck: 0.25,
  tanker: 0.2,
};
const OVERSIZED_SURCHARGE = 0.15;

const URGENCY_MULTIPLIERS: Record<string, number> = {
  standard: 1.0,
  express: 1.3,
  priority: 1.5,
  emergency: 2.0,
};

export interface PriceBreakdown {
  distance_km: number;
  estimated_duration_minutes: number;
  base_price: number;
  weight_surcharge: number;
  total_price: number;
  base_fee: number;
  distance_fee: number;
  weight_fee: number;
  freight_fee: number;
  freight_rate_per_kg: number;
  chargeable_weight: number;
  chargeable_basis: string;
  actual_weight_kg: number;
  fuel_surcharge: number;
  urgency: string;
  urgency_multiplier: number;
  special_multiplier: number;
  estimate_low: number;
  estimate_high: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Great-circle distance in km (matches backend `_haversine_km`). */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371.0;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Finnish chargeable freight weight: greatest of actual/volumetric/pallet/loading-meter. */
export function chargeableWeight(
  actualKg: number,
  volumeM3: number,
  pallets: number,
  loadingMeters: number
): { weight: number; basis: string } {
  const candidates: Record<string, number> = {
    actual: Math.max(0, actualKg || 0),
    volumetric: Math.max(0, volumeM3 || 0) * VOLUMETRIC_KG_PER_M3,
    pallet: Math.max(0, pallets || 0) * PALLET_WEIGHT_KG,
    loading_meter: Math.max(0, loadingMeters || 0) * LOADING_METER_WEIGHT_KG,
  };
  let basis = "actual";
  let weight = 0;
  for (const k of Object.keys(candidates)) {
    if (candidates[k] > weight) {
      weight = candidates[k];
      basis = k;
    }
  }
  if (weight <= 0) basis = "actual";
  return { weight: Math.round(weight * 10) / 10, basis };
}

export interface EstimateInput {
  vehicleType: string;
  distanceKm: number;
  weightKg?: number;
  urgency?: string;
  specialHandling?: boolean;
  volumeM3?: number;
  pallets?: number;
  loadingMeters?: number;
}

/** Full pricing breakdown — instant, network-free. Mirrors pricing.calculate_price. */
export function calculatePrice({
  vehicleType,
  distanceKm,
  weightKg = 0,
  urgency = "standard",
  specialHandling = false,
  volumeM3 = 0,
  pallets = 0,
  loadingMeters = 0,
}: EstimateInput): PriceBreakdown {
  const baseFee = BASE_FEES[vehicleType] ?? BASE_FEES.other;
  const kmRate = KM_RATES[vehicleType] ?? KM_RATES.other;
  const freightRate = FREIGHT_KG_RATES[vehicleType] ?? FREIGHT_KG_RATES.other;
  const dist = Math.max(0, Number(distanceKm) || 0);

  const distanceFee = dist * kmRate;
  const cw = chargeableWeight(weightKg, volumeM3, pallets, loadingMeters);
  const freightFee = cw.weight * freightRate;
  const subtotal = baseFee + distanceFee + freightFee;

  const urgencyMult = URGENCY_MULTIPLIERS[urgency] ?? 1.0;
  let specialMult = 1.0 + (SPECIAL_VEHICLE_SURCHARGE[vehicleType] ?? 0.0);
  if (specialHandling) specialMult += OVERSIZED_SURCHARGE;

  const preFuel = subtotal * urgencyMult * specialMult;
  const fuel = preFuel * FUEL_SURCHARGE_PCT;
  let total = preFuel + fuel;
  total = Math.max(total, baseFee + 5.0);

  const durationMinutes = Math.max(30, Math.round(dist));

  return {
    distance_km: round2(dist),
    estimated_duration_minutes: durationMinutes,
    base_price: round2(baseFee + distanceFee),
    weight_surcharge: round2(freightFee),
    total_price: round2(total),
    base_fee: round2(baseFee),
    distance_fee: round2(distanceFee),
    weight_fee: round2(freightFee),
    freight_fee: round2(freightFee),
    freight_rate_per_kg: freightRate,
    chargeable_weight: cw.weight,
    chargeable_basis: cw.basis,
    actual_weight_kg: round2(weightKg || 0),
    fuel_surcharge: round2(fuel),
    urgency,
    urgency_multiplier: urgencyMult,
    special_multiplier: round2(specialMult),
    estimate_low: Math.round(total * 0.95),
    estimate_high: Math.round(total * 1.15),
  };
}
