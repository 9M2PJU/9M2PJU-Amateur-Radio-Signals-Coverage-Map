/**
 * Shared RF propagation calculation module.
 *
 * Used by:
 *   - src/App.jsx (frontend, via Vite import)
 *   - scripts/rf-smoke-test.mjs (Node.js test runner)
 *   - itm-longley-rice/server.js (backend, via relative import)
 *
 * All functions are pure (no side effects, no React, no DOM).
 *
 * Accuracy references:
 *   - ITU-R P.525: Free-space path loss
 *   - ITU-R P.526: Knife-edge diffraction
 *   - ITU-R P.838: Rain attenuation coefficients
 *   - ITU-R P.676: Gaseous attenuation (oxygen + water vapor)
 *   - Okumura-Hata: Urban/suburban empirical model
 *   - COST-231 Hata: Extended Hata for 1.5-2 GHz
 *   - NTIA ITM / Longley-Rice: Terrain-aware point-to-point model
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MIN_FREQUENCY_MHZ = 30;
export const MAX_FREQUENCY_MHZ = 30000;
export const HAAT_MIN_DISTANCE_KM = 3;
export const HAAT_MAX_DISTANCE_KM = 16;
export const TERRAIN_PROFILE_STEP_KM = 0.5;
export const EFFECTIVE_EARTH_RADIUS_KM = 6371 * (4 / 3);
export const PREDICTION_SEARCH_ITERATIONS = 18;
export const ITM_API_MIN_DISTANCE_KM = 1;
export const ITM_API_DISTANCE_STEP_KM = 0.5;
export const ITM_API_MAX_FREQUENCY_MHZ = 20000;

// Shared fallback model coefficients (used by both frontend and backend)
export const FALLBACK_HORIZON_LOSS_PER_KM = 0.38;
export const FALLBACK_ROUGHNESS_COEFF = 0.035;
export const FALLBACK_SITE_DELTA_COEFF = 0.05;
export const FALLBACK_TERMINAL_DELTA_COEFF = 0.03;
export const FALLBACK_ROUGHNESS_MAX_DB = 24;
export const FALLBACK_HORIZON_MAX_DB = 28;
export const FALLBACK_TERMINAL_MAX_DB = 12;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------------------
// Unit conversions (ITU-R standard, 50-ohm impedance)
// ---------------------------------------------------------------------------

export const microvoltsToDbm = (microvolts, impedanceOhms = 50) => {
  const volts = Math.max(0.001, microvolts) * 1e-6;
  return 10 * Math.log10(((volts ** 2) / impedanceOhms) * 1000);
};

export const dbmToMicrovolts = (dbm, impedanceOhms = 50) => {
  const watts = 10 ** ((dbm - 30) / 10);
  return Math.sqrt(watts * impedanceOhms) * 1e6;
};

export const calculateNoiseFloorDbm = (bandwidthHz, noiseFigureDb = 6) => (
  -174 + 10 * Math.log10(Math.max(1, bandwidthHz)) + noiseFigureDb
);

export const calculateRequiredSignalDbm = ({ bandwidthHz, noiseFigureDb, requiredSnrDb }) => (
  calculateNoiseFloorDbm(bandwidthHz, noiseFigureDb) + requiredSnrDb
);

// ---------------------------------------------------------------------------
// Free-space path loss (ITU-R P.525)
// ---------------------------------------------------------------------------

export const calculateFreeSpacePathLoss = (freq, distanceKm) => (
  32.44 + 20 * Math.log10(Math.max(0.001, distanceKm)) + 20 * Math.log10(clamp(freq, MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ))
);

// ---------------------------------------------------------------------------
// Hata / COST-231 empirical models
// ---------------------------------------------------------------------------

/** Hata small/medium city mobile antenna correction (Okumura-Hata). */
export const calculateHataMobileCorrection = (freq, hRx) => {
  const logFreq = Math.log10(freq);
  return (1.1 * logFreq - 0.7) * hRx - (1.56 * logFreq - 0.8);
};

/** COST-231 metropolitan mobile antenna correction for medium-small cities. */
export const calculateCost231MobileCorrection = (freq, hRx) => {
  const safeHRx = clamp(hRx, 1, 10);
  return 3.2 * (Math.log10(11.75 * safeHRx) ** 2) - 4.97;
};

export const calculateHataSuburbanPathLoss = (freq, effectiveHTx, hRx, distanceKm) => {
  const logFreq = Math.log10(freq);
  const logHTx = Math.log10(clamp(effectiveHTx, 30, 200));
  const safeHRx = clamp(hRx, 1, 10);
  const mobileCorrection = calculateHataMobileCorrection(freq, safeHRx);
  const logDist = Math.log10(Math.max(1, distanceKm));
  const urbanLoss = 69.55 + 26.16 * logFreq - 13.82 * logHTx - mobileCorrection + (44.9 - 6.55 * logHTx) * logDist;
  const suburbanCorrection = 2 * (Math.log10(freq / 28) ** 2) + 5.4;

  return urbanLoss - suburbanCorrection;
};

export const calculateCost231SuburbanPathLoss = (freq, effectiveHTx, hRx, distanceKm) => {
  const logFreq = Math.log10(freq);
  const logHTx = Math.log10(clamp(effectiveHTx, 30, 200));
  const safeHRx = clamp(hRx, 1, 10);
  // Use the correct COST-231 metropolitan mobile correction
  const mobileCorrection = calculateCost231MobileCorrection(freq, safeHRx);
  const logDist = Math.log10(Math.max(1, distanceKm));

  // COST-231 Hata with C = 0 (suburban/medium city)
  return 46.3 + 33.9 * logFreq - 13.82 * logHTx - mobileCorrection + (44.9 - 6.55 * logHTx) * logDist;
};

// ---------------------------------------------------------------------------
// SHF excess loss (planning heuristic for frequencies > 3 GHz)
// ---------------------------------------------------------------------------

export const calculateShfExcessLoss = (freq, distanceKm) => {
  const safeFreq = clamp(freq, 3000, MAX_FREQUENCY_MHZ);
  const frequencyFactor = clamp((safeFreq - 3000) / (MAX_FREQUENCY_MHZ - 3000), 0, 1);
  return 3 + frequencyFactor * 9 + clamp(distanceKm * 0.02, 0, 8);
};

// ---------------------------------------------------------------------------
// Rain attenuation (ITU-R P.838 regression coefficients)
// ---------------------------------------------------------------------------

/**
 * ITU-R P.838 table of rain attenuation coefficients.
 * Each entry: [freq_GHz, k_h, alpha_h, k_v, alpha_v]
 * Source: ITU-R P.838-3 (2005) representative values.
 */
const RAIN_COEFF_TABLE = [
  [2,    0.000650, 1.121, 0.000591, 1.217],
  [4,    0.001097, 1.118, 0.000991, 1.231],
  [6,    0.001675, 1.080, 0.001418, 1.232],
  [7,    0.002054, 1.052, 0.001715, 1.228],
  [8,    0.002454, 1.026, 0.002028, 1.219],
  [10,   0.010100, 1.276, 0.008870, 1.264],
  [12,   0.018800, 1.217, 0.016800, 1.200],
  [15,   0.036700, 1.154, 0.033500, 1.128],
  [20,   0.075100, 1.099, 0.069100, 1.065],
  [22.4, 0.097400, 1.039, 0.089600, 1.026],
  [24,   0.106000, 1.049, 0.097400, 1.039],
  [30,   0.167000, 1.021, 0.157000, 0.998],
  [40,   0.350000, 0.939, 0.330000, 0.903],
  [50,   0.541000, 0.873, 0.506000, 0.840],
];

/**
 * Interpolate ITU-R P.838 k and alpha coefficients using log-log interpolation.
 * @param {number} freqGhz - Frequency in GHz
 * @param {number} polarization - 0 = horizontal, 1 = vertical
 * @returns {{ k: number, alpha: number }}
 */
const interpolateRainCoeffs = (freqGhz, polarization) => {
  const kIndex = polarization === 0 ? 1 : 3;
  const alphaIndex = polarization === 0 ? 2 : 4;

  if (freqGhz <= RAIN_COEFF_TABLE[0][0]) {
    return { k: RAIN_COEFF_TABLE[0][kIndex], alpha: RAIN_COEFF_TABLE[0][alphaIndex] };
  }

  const last = RAIN_COEFF_TABLE[RAIN_COEFF_TABLE.length - 1];
  if (freqGhz >= last[0]) {
    return { k: last[kIndex], alpha: last[alphaIndex] };
  }

  for (let i = 1; i < RAIN_COEFF_TABLE.length; i++) {
    const prev = RAIN_COEFF_TABLE[i - 1];
    const next = RAIN_COEFF_TABLE[i];
    if (freqGhz <= next[0]) {
      const logF1 = Math.log10(prev[0]);
      const logF2 = Math.log10(next[0]);
      const logF = Math.log10(freqGhz);
      const t = (logF - logF1) / Math.max(1e-9, logF2 - logF1);
      const logK1 = Math.log10(Math.max(1e-9, prev[kIndex]));
      const logK2 = Math.log10(Math.max(1e-9, next[kIndex]));
      return {
        k: 10 ** (logK1 + (logK2 - logK1) * t),
        alpha: prev[alphaIndex] + (next[alphaIndex] - prev[alphaIndex]) * t,
      };
    }
  }

  return { k: last[kIndex], alpha: last[alphaIndex] };
};

/**
 * Calculate rain attenuation following ITU-R P.838.
 *
 * Uses the specific rain attenuation γ_R = k * R^alpha (dB/km)
 * with a path reduction factor for distributed rain.
 *
 * @param {number} freqMHz - Frequency in MHz
 * @param {number} distanceKm - Path distance in km
 * @param {number} rainRateMmH - Rain rate in mm/h
 * @param {number} polarization - 0 = horizontal, 1 = vertical
 * @returns {number} Rain loss in dB
 */
export const calculateShfRainLoss = (freq, distanceKm, rainRateMmH, polarization = 1) => {
  if (freq < 3000 || rainRateMmH <= 0 || distanceKm <= 0) return 0;
  const freqGhz = freq / 1000;
  const { k, alpha } = interpolateRainCoeffs(freqGhz, polarization);
  // ITU-R P.838 path reduction factor for effective rain path length
  const effectiveDistanceKm = distanceKm / (1 + distanceKm / 35);
  return clamp(k * (rainRateMmH ** alpha) * effectiveDistanceKm, 0, 45);
};

// ---------------------------------------------------------------------------
// Gaseous atmospheric attenuation (ITU-R P.676 simplified)
// ---------------------------------------------------------------------------

/**
 * Reference gaseous attenuation at sea level (1013 hPa, 15C, 7.5 g/m^3 humidity).
 * Values from ITU-R P.676 Annex 2 representative data.
 * Format: [freq_GHz, oxygen_dB_per_km, waterVapor_dB_per_km]
 */
const GASEOUS_ATTEN_TABLE = [
  [1,    0.0082, 0.0003],
  [2,    0.0112, 0.0004],
  [4,    0.0066, 0.0006],
  [5.6,  0.0066, 0.0017],
  [7,    0.0077, 0.0030],
  [8,    0.0089, 0.0043],
  [10,   0.0066, 0.0060],
  [12,   0.0068, 0.0090],
  [15,   0.0078, 0.0150],
  [20,   0.0100, 0.0750],
  [22.2, 0.0115, 0.1800],
  [24,   0.0105, 0.0950],
  [30,   0.0150, 0.0380],
  [40,   0.0400, 0.0200],
  [50,   0.3000, 0.0120],
];

/**
 * Interpolate gaseous attenuation using log-log interpolation.
 * @param {number} freqGhz - Frequency in GHz
 * @returns {{ oxygenDbPerKm: number, waterVaporDbPerKm: number }}
 */
const interpolateGaseousAttenuation = (freqGhz) => {
  if (freqGhz <= GASEOUS_ATTEN_TABLE[0][0]) {
    return { oxygenDbPerKm: GASEOUS_ATTEN_TABLE[0][1], waterVaporDbPerKm: GASEOUS_ATTEN_TABLE[0][2] };
  }

  const last = GASEOUS_ATTEN_TABLE[GASEOUS_ATTEN_TABLE.length - 1];
  if (freqGhz >= last[0]) {
    return { oxygenDbPerKm: last[1], waterVaporDbPerKm: last[2] };
  }

  for (let i = 1; i < GASEOUS_ATTEN_TABLE.length; i++) {
    const prev = GASEOUS_ATTEN_TABLE[i - 1];
    const next = GASEOUS_ATTEN_TABLE[i];
    if (freqGhz <= next[0]) {
      const logF1 = Math.log10(prev[0]);
      const logF2 = Math.log10(next[0]);
      const logF = Math.log10(freqGhz);
      const t = (logF - logF1) / Math.max(1e-9, logF2 - logF1);
      return {
        oxygenDbPerKm: prev[1] + (next[1] - prev[1]) * t,
        waterVaporDbPerKm: prev[2] + (next[2] - prev[2]) * t,
      };
    }
  }

  return { oxygenDbPerKm: last[1], waterVaporDbPerKm: last[2] };
};

/**
 * Calculate total gaseous atmospheric attenuation (ITU-R P.676).
 *
 * Combines oxygen + water vapor specific attenuation from the reference table
 * with any user-specified additional atmospheric loss.
 *
 * @param {number} freqMHz - Frequency in MHz
 * @param {number} distanceKm - Path distance in km
 * @param {number} atmosphericLossDbPerKm - User-specified additional loss (dB/km)
 * @returns {number} Total atmospheric loss in dB
 */
export const calculateAtmosphericLoss = (freq, distanceKm, atmosphericLossDbPerKm) => {
  if (freq < 3000 || distanceKm <= 0) return 0;
  const freqGhz = freq / 1000;
  const { oxygenDbPerKm, waterVaporDbPerKm } = interpolateGaseousAttenuation(freqGhz);
  const baseGaseousLossDbPerKm = oxygenDbPerKm + waterVaporDbPerKm;
  const userLossDbPerKm = clamp(atmosphericLossDbPerKm, 0, 2);
  return clamp((baseGaseousLossDbPerKm + userLossDbPerKm) * distanceKm, 0, 20);
};

// ---------------------------------------------------------------------------
// Two-ray ground reflection model
// ---------------------------------------------------------------------------

/**
 * Calculate two-ray ground reflection excess loss.
 *
 * Beyond the Fresnel breakpoint distance, the two-ray model gives
 * 40 dB/decade path loss (20 from FSPL + 20 excess). The excess is:
 *   L_excess = 20 * log10(d / d_breakpoint)
 *
 * @param {{ freq: number, distanceKm: number, hTx: number, hRx: number }} params
 * @returns {number} Excess loss in dB (0 if below breakpoint)
 */
export const calculateTwoRayLoss = ({ freq, distanceKm, hTx, hRx }) => {
  if (distanceKm <= 0) return 0;
  const wavelengthM = 300 / clamp(freq, MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ);
  const breakpointKm = Math.max(0.1, (4 * Math.max(0.5, hTx) * Math.max(0.5, hRx)) / wavelengthM / 1000);
  if (distanceKm <= breakpointKm) return 0;
  return clamp(20 * Math.log10(distanceKm / breakpointKm), 0, 18);
};

// ---------------------------------------------------------------------------
// Main path loss dispatcher
// ---------------------------------------------------------------------------

export const calculatePathLoss = (freq, effectiveHTx, hRx, distanceKm) => {
  const safeFreq = clamp(freq, MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ);
  const safeDistanceKm = Math.max(0.001, distanceKm);
  const freeSpaceLoss = calculateFreeSpacePathLoss(safeFreq, safeDistanceKm);

  if (safeFreq > 3000) {
    return freeSpaceLoss + calculateShfExcessLoss(safeFreq, safeDistanceKm);
  }

  const hataFreq = clamp(safeFreq, 150, 1500);
  const hataLoss = calculateHataSuburbanPathLoss(hataFreq, effectiveHTx, hRx, safeDistanceKm);

  if (safeFreq <= 1500) {
    return Math.max(freeSpaceLoss, hataLoss);
  }

  const costFreq = clamp(safeFreq, 1500, 2000);
  const costLoss = calculateCost231SuburbanPathLoss(costFreq, effectiveHTx, hRx, safeDistanceKm);
  const highUhfExtension = safeFreq > 2000 ? (safeFreq - 2000) / 1000 * 5 : 0;

  return Math.max(freeSpaceLoss, costLoss + highUhfExtension);
};

// ---------------------------------------------------------------------------
// Terrain analysis
// ---------------------------------------------------------------------------

export const calculateTerrainRoughness = (radialSamples, siteElevation) => {
  if (!radialSamples.length) return 0;
  const elevations = radialSamples.map((sample) => sample.elevation);
  const average = elevations.reduce((total, elevation) => total + elevation, 0) / elevations.length;
  const variance = elevations.reduce((total, elevation) => total + ((elevation - average) ** 2), 0) / elevations.length;
  const slope = Math.max(...elevations) - Math.min(...elevations);
  const siteDelta = Math.max(0, average - siteElevation);
  return Math.sqrt(variance) * 0.18 + slope * 0.035 + siteDelta * 0.05;
};

export const calculateItmStylePathLoss = ({ freq, effectiveHTx, hRx, distanceKm, radialSamples, siteElevation }) => {
  const fspl = calculateFreeSpacePathLoss(freq, distanceKm);
  const hata = calculatePathLoss(freq, effectiveHTx, hRx, distanceKm);
  const roughnessLoss = clamp(calculateTerrainRoughness(radialSamples, siteElevation), 0, FALLBACK_ROUGHNESS_MAX_DB);
  const radioHorizonKm = 4.12 * (Math.sqrt(Math.max(1, effectiveHTx)) + Math.sqrt(Math.max(1, hRx)));
  const horizonLoss = distanceKm > radioHorizonKm ? clamp((distanceKm - radioHorizonKm) * FALLBACK_HORIZON_LOSS_PER_KM, 0, FALLBACK_HORIZON_MAX_DB) : 0;
  const transitionWeight = clamp((distanceKm - 8) / 40, 0, 1);

  return Math.max(fspl + roughnessLoss + horizonLoss, (hata * (1 - transitionWeight)) + ((fspl + roughnessLoss + horizonLoss) * transitionWeight));
};

export const getElevationAtDistance = (radialSamples, distanceKm, fallbackElevation) => {
  if (!radialSamples.length || distanceKm <= 0) return fallbackElevation;

  const firstSample = radialSamples[0];
  if (distanceKm <= firstSample.distanceKm) {
    const ratio = clamp(distanceKm / Math.max(1e-9, firstSample.distanceKm), 0, 1);
    return fallbackElevation + (firstSample.elevation - fallbackElevation) * ratio;
  }

  for (let index = 1; index < radialSamples.length; index++) {
    const previous = radialSamples[index - 1];
    const next = radialSamples[index];
    if (distanceKm > next.distanceKm) continue;

    const ratio = (distanceKm - previous.distanceKm) / Math.max(1e-9, next.distanceKm - previous.distanceKm);
    return previous.elevation + (next.elevation - previous.elevation) * clamp(ratio, 0, 1);
  }

  return radialSamples[radialSamples.length - 1].elevation;
};

export const getTerrainCheckDistances = (radialSamples, radiusKm) => {
  const distances = new Set();

  for (let distanceKm = TERRAIN_PROFILE_STEP_KM; distanceKm < radiusKm; distanceKm += TERRAIN_PROFILE_STEP_KM) {
    distances.add(Number(distanceKm.toFixed(3)));
  }

  radialSamples.forEach((sample) => {
    if (sample.distanceKm > 0 && sample.distanceKm < radiusKm) {
      distances.add(Number(sample.distanceKm.toFixed(3)));
    }
  });

  return [...distances].sort((a, b) => a - b);
};

/**
 * Knife-edge diffraction loss (ITU-R P.526).
 * @param {number} v - Fresnel-Kirchoff diffraction parameter
 * @returns {number} Diffraction loss in dB
 */
const knifeEdgeLoss = (v) => {
  if (v <= -0.78) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
};

/**
 * Compute the v-parameter for a terrain point along a path.
 * @returns {number} v-parameter (NaN if the point is not an obstruction)
 */
const computeVParameter = (terrainElevation, lineOfSightHeight, earthBulge, firstFresnelRadius, distanceKm, radiusKm, wavelength) => {
  const clearanceDeficit = (terrainElevation + earthBulge) - (lineOfSightHeight - 0.6 * firstFresnelRadius);
  if (clearanceDeficit <= 0) return null;

  const d1 = Math.max(1, distanceKm * 1000);
  const d2 = Math.max(1, (radiusKm - distanceKm) * 1000);
  return clearanceDeficit * Math.sqrt((2 * (d1 + d2)) / (wavelength * d1 * d2));
};

/**
 * Deygout multi-obstruction diffraction model.
 *
 * Finds the dominant obstacle (highest v-parameter), computes its knife-edge
 * loss, then recursively evaluates subsidiary obstacles on each side.
 * Total loss = dominant loss + subsidiary losses.
 *
 * @param {Array} points - Array of { distanceKm, v } sorted by distance
 * @returns {number} Total diffraction loss in dB
 */
const deygoutDiffractionLoss = (points) => {
  if (points.length === 0) return 0;

  // Find dominant obstacle (highest v)
  let dominantIndex = -1;
  let maxV = -Infinity;
  for (let i = 0; i < points.length; i++) {
    if (points[i].v > maxV) {
      maxV = points[i].v;
      dominantIndex = i;
    }
  }

  if (dominantIndex < 0 || maxV <= 0) return 0;

  const dominantLoss = knifeEdgeLoss(maxV);

  // Recursively evaluate subsidiary obstacles
  const leftPoints = points.slice(0, dominantIndex);
  const rightPoints = points.slice(dominantIndex + 1);

  // Subsidiary obstacles use a modified geometry (edge-to-edge)
  // but for planning purposes we use the same v-parameter approximation
  const subsidiaryLoss = deygoutDiffractionLoss(leftPoints) + deygoutDiffractionLoss(rightPoints);

  return dominantLoss + subsidiaryLoss;
};

/**
 * Calculate terrain diffraction penalty using the Deygout multi-obstruction model.
 *
 * @param {Array} radialSamples - Terrain samples [{ distanceKm, elevation }]
 * @param {number} radiusKm - Total path length
 * @param {number} siteElevation - TX site elevation AMSL (m)
 * @param {number} hTx - TX antenna height (m)
 * @param {number} hRx - RX antenna height (m)
 * @param {number} freq - Frequency (MHz)
 * @returns {number} Terrain penalty in dB
 */
export const calculateTerrainPenalty = (radialSamples, radiusKm, siteElevation, hTx, hRx, freq) => {
  const wavelength = 300 / freq;
  const txAmsl = siteElevation + hTx;
  const rxGround = getElevationAtDistance(radialSamples, radiusKm, siteElevation);
  const rxAmsl = rxGround + hRx;

  const checkDistances = getTerrainCheckDistances(radialSamples, radiusKm);
  const obstructionPoints = [];

  for (const distanceKm of checkDistances) {
    const pathFraction = distanceKm / radiusKm;
    const lineOfSightHeight = txAmsl + (rxAmsl - txAmsl) * pathFraction;
    const firstFresnelRadius = 548 * Math.sqrt((distanceKm * (radiusKm - distanceKm)) / (freq * radiusKm));
    const earthBulge = (distanceKm * (radiusKm - distanceKm) * 1000) / (2 * EFFECTIVE_EARTH_RADIUS_KM);
    const terrainElevation = getElevationAtDistance(radialSamples, distanceKm, siteElevation);
    const v = computeVParameter(terrainElevation, lineOfSightHeight, earthBulge, firstFresnelRadius, distanceKm, radiusKm, wavelength);

    if (v !== null && v > 0) {
      obstructionPoints.push({ distanceKm, v });
    }
  }

  if (obstructionPoints.length === 0) return 0;

  const diffractionLoss = deygoutDiffractionLoss(obstructionPoints);

  // Cap total terrain penalty
  return clamp(diffractionLoss, 0, 40);
};

// ---------------------------------------------------------------------------
// Effective antenna height (HAAT)
// ---------------------------------------------------------------------------

export const calculateEffectiveTxHeight = (siteElevation, hTx, radialSamples) => {
  if (!radialSamples.length) return clamp(hTx, 2, 300);
  const haatSamples = radialSamples.filter((sample) => (
    sample.distanceKm >= HAAT_MIN_DISTANCE_KM && sample.distanceKm <= HAAT_MAX_DISTANCE_KM
  ));
  const terrainSamples = haatSamples.length ? haatSamples : radialSamples;
  const avgElevation = terrainSamples.reduce((total, sample) => total + sample.elevation, 0) / terrainSamples.length;
  const haat = (siteElevation + hTx) - avgElevation;
  return clamp(Math.max(hTx, haat), 2, 300);
};

export const calculateRadialHaat = (siteElevation, hTx, radialSamples) => {
  const haatSamples = radialSamples.filter((sample) => (
    sample.distanceKm >= HAAT_MIN_DISTANCE_KM && sample.distanceKm <= HAAT_MAX_DISTANCE_KM
  ));
  const terrainSamples = haatSamples.length ? haatSamples : radialSamples;
  if (!terrainSamples.length) return hTx;
  const avgElevation = terrainSamples.reduce((total, sample) => total + sample.elevation, 0) / terrainSamples.length;
  return (siteElevation + hTx) - avgElevation;
};

// ---------------------------------------------------------------------------
// Model dispatch and total path loss
// ---------------------------------------------------------------------------

export const calculateModelPathLoss = ({ modelKey, freq, effectiveHTx, hRx, distanceKm, radialSamples, siteElevation }) => {
  if (modelKey === 'itmHybrid' || modelKey === 'ntiaItmApi') {
    return calculateItmStylePathLoss({ freq, effectiveHTx, hRx, distanceKm, radialSamples, siteElevation });
  }

  return calculatePathLoss(freq, effectiveHTx, hRx, distanceKm);
};

export const calculateExternalLosses = ({
  freq,
  distanceKm,
  hTx,
  hRx,
  clutterLossDb,
  rainRateMmH,
  atmosphericLossDbPerKm,
  useTwoRay,
  extraLossFn,
}) => (
  clutterLossDb +
  (typeof extraLossFn === 'function' ? extraLossFn(distanceKm) : 0) +
  calculateShfRainLoss(freq, distanceKm, rainRateMmH) +
  calculateAtmosphericLoss(freq, distanceKm, atmosphericLossDbPerKm) +
  (useTwoRay ? calculateTwoRayLoss({ freq, distanceKm, hTx, hRx }) : 0)
);

export const calculateTotalPathLoss = ({
  modelKey,
  freq,
  effectiveHTx,
  hTx,
  hRx,
  distanceKm,
  radialSamples,
  siteElevation,
  clutterLossDb,
  terrainPenaltyCache,
  rainRateMmH,
  atmosphericLossDbPerKm,
  useTwoRay,
  extraLossFn,
}) => {
  const cacheKey = distanceKm.toFixed(3);
  let terrainPenalty = terrainPenaltyCache?.get(cacheKey);

  if (typeof terrainPenalty !== 'number') {
    terrainPenalty = calculateTerrainPenalty(radialSamples, distanceKm, siteElevation, hTx, hRx, freq);
    terrainPenaltyCache?.set(cacheKey, terrainPenalty);
  }

  return calculateModelPathLoss({ modelKey, freq, effectiveHTx, hRx, distanceKm, radialSamples, siteElevation }) +
    terrainPenalty +
    calculateExternalLosses({
      freq,
      distanceKm,
      hTx,
      hRx,
      clutterLossDb,
      rainRateMmH,
      atmosphericLossDbPerKm,
      useTwoRay,
      extraLossFn,
    });
};

// ---------------------------------------------------------------------------
// Reliable distance search (binary search for threshold crossing)
// ---------------------------------------------------------------------------

export const findReliableDistance = ({
  modelKey,
  freq,
  effectiveHTx,
  hTx,
  hRx,
  targetLoss,
  radialSamples,
  siteElevation,
  clutterLossDb,
  terrainPenaltyCache,
  rainRateMmH,
  atmosphericLossDbPerKm,
  useTwoRay,
  maxRangeKm = 120,
  searchDistances = null,
  extraLossFn,
}) => {
  const distances = searchDistances ?? [0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120].filter((d) => d <= maxRangeKm);
  let low = distances[0];
  let high = maxRangeKm;

  if (calculateTotalPathLoss({
    modelKey, freq, effectiveHTx, hTx, hRx, distanceKm: low,
    radialSamples, siteElevation, clutterLossDb, terrainPenaltyCache,
    rainRateMmH, atmosphericLossDbPerKm, useTwoRay, extraLossFn,
  }) > targetLoss) {
    return 0;
  }

  for (const distanceKm of distances.slice(1)) {
    const totalLoss = calculateTotalPathLoss({
      modelKey, freq, effectiveHTx, hTx, hRx, distanceKm,
      radialSamples, siteElevation, clutterLossDb, terrainPenaltyCache,
      rainRateMmH, atmosphericLossDbPerKm, useTwoRay, extraLossFn,
    });

    if (totalLoss > targetLoss) {
      high = distanceKm;
      break;
    }
    low = distanceKm;
  }

  if (low === high) return low;

  for (let i = 0; i < PREDICTION_SEARCH_ITERATIONS; i++) {
    const mid = (low + high) / 2;
    const totalLoss = calculateTotalPathLoss({
      modelKey, freq, effectiveHTx, hTx, hRx, distanceKm: mid,
      radialSamples, siteElevation, clutterLossDb, terrainPenaltyCache,
      rainRateMmH, atmosphericLossDbPerKm, useTwoRay, extraLossFn,
    });

    if (totalLoss < targetLoss) low = mid;
    else high = mid;
  }

  return low;
};

// ---------------------------------------------------------------------------
// ITM API helpers
// ---------------------------------------------------------------------------

export const createItmDistanceGrid = (maxRangeKm = 120) => {
  const cappedRangeKm = Math.max(ITM_API_MIN_DISTANCE_KM, maxRangeKm);
  const distances = new Set([ITM_API_MIN_DISTANCE_KM, cappedRangeKm]);
  for (let distanceKm = ITM_API_MIN_DISTANCE_KM + ITM_API_DISTANCE_STEP_KM; distanceKm <= cappedRangeKm; distanceKm += ITM_API_DISTANCE_STEP_KM) {
    distances.add(Number(distanceKm.toFixed(3)));
  }
  return [...distances].filter((distanceKm) => distanceKm >= ITM_API_MIN_DISTANCE_KM && distanceKm <= cappedRangeKm).sort((a, b) => a - b);
};

export const getItmApiPathLoss = (itmLossMap, distanceKm) => {
  if (!itmLossMap?.length) return null;
  if (distanceKm < itmLossMap[0].distanceKm) return null;
  if (distanceKm <= itmLossMap[0].distanceKm) return itmLossMap[0].lossDb;

  for (let index = 1; index < itmLossMap.length; index++) {
    const previous = itmLossMap[index - 1];
    const next = itmLossMap[index];
    if (distanceKm > next.distanceKm) continue;

    const ratio = (distanceKm - previous.distanceKm) / Math.max(1e-9, next.distanceKm - previous.distanceKm);
    return previous.lossDb + (next.lossDb - previous.lossDb) * clamp(ratio, 0, 1);
  }

  return itmLossMap[itmLossMap.length - 1].lossDb;
};

export const findReliableDistanceFromLossMap = ({
  itmLossMap,
  freq,
  hTx,
  hRx,
  targetLoss,
  clutterLossDb,
  rainRateMmH,
  atmosphericLossDbPerKm,
  useTwoRay,
  extraLossFn,
}) => {
  if (!itmLossMap?.length) return null;
  let lastPassing = itmLossMap[0].distanceKm;
  let lastLoss = itmLossMap[0].lossDb + calculateExternalLosses({
    freq, distanceKm: itmLossMap[0].distanceKm, hTx, hRx,
    clutterLossDb, rainRateMmH, atmosphericLossDbPerKm, useTwoRay, extraLossFn,
  });

  if (lastLoss > targetLoss) return null;

  for (let index = 1; index < itmLossMap.length; index++) {
    const sample = itmLossMap[index];
    const totalLoss = sample.lossDb + calculateExternalLosses({
      freq, distanceKm: sample.distanceKm, hTx, hRx,
      clutterLossDb, rainRateMmH, atmosphericLossDbPerKm, useTwoRay, extraLossFn,
    });

    if (totalLoss > targetLoss) {
      const ratio = clamp((targetLoss - lastLoss) / Math.max(1e-9, totalLoss - lastLoss), 0, 1);
      return lastPassing + (sample.distanceKm - lastPassing) * ratio;
    }

    lastPassing = sample.distanceKm;
    lastLoss = totalLoss;
  }

  return lastPassing;
};

// ---------------------------------------------------------------------------
// Server-side fallback ITM-style loss (shared with backend)
// ---------------------------------------------------------------------------

export const calculateFallbackItmStyleLoss = ({ frequencyMhz, txHeightM, rxHeightM, siteElevationM, radialSamples, distanceKm }) => {
  const samplesInPath = radialSamples.filter((sample) => sample.distanceKm <= distanceKm);
  const elevations = samplesInPath.length ? samplesInPath.map((sample) => sample.elevation) : [siteElevationM];
  const avgElevation = elevations.reduce((total, elevation) => total + elevation, 0) / elevations.length;
  const minElevation = Math.min(...elevations);
  const maxElevation = Math.max(...elevations);
  const roughness = maxElevation - minElevation;
  const sitePenalty = Math.max(0, avgElevation - siteElevationM) * FALLBACK_SITE_DELTA_COEFF;
  const roughnessLoss = clamp(roughness * FALLBACK_ROUGHNESS_COEFF + sitePenalty, 0, FALLBACK_ROUGHNESS_MAX_DB);
  const horizonKm = 4.12 * (Math.sqrt(Math.max(1, txHeightM)) + Math.sqrt(Math.max(1, rxHeightM)));
  const horizonLoss = distanceKm > horizonKm ? clamp((distanceKm - horizonKm) * FALLBACK_HORIZON_LOSS_PER_KM, 0, FALLBACK_HORIZON_MAX_DB) : 0;
  const rxElevation = getElevationAtDistance(radialSamples, distanceKm, siteElevationM);
  const terminalDelta = Math.max(0, rxElevation - siteElevationM) * FALLBACK_TERMINAL_DELTA_COEFF;
  return calculateFreeSpacePathLoss(frequencyMhz, distanceKm) + roughnessLoss + horizonLoss + clamp(terminalDelta, 0, FALLBACK_TERMINAL_MAX_DB);
};
