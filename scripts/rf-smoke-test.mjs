/**
 * RF smoke tests for 9M2PJU Coverage Prediction.
 *
 * Tests are organized into two categories:
 * 1. Invariant tests — verify internal consistency (path loss >= FSPL, monotonicity, etc.)
 * 2. Reference value tests — verify formulas against authoritative ITU-R / Hata reference values
 *
 * All RF math is imported from the shared module (src/rf/propagation.js),
 * eliminating code duplication between the app and the test.
 */

import {
  microvoltsToDbm,
  dbmToMicrovolts,
  calculateNoiseFloorDbm,
  calculateRequiredSignalDbm,
  calculateFreeSpacePathLoss,
  calculateHataSuburbanPathLoss,
  calculateCost231SuburbanPathLoss,
  calculateCost231MobileCorrection,
  calculateHataMobileCorrection,
  calculateShfRainLoss,
  calculateAtmosphericLoss,
  calculateTwoRayLoss,
  calculatePathLoss,
  calculateTerrainPenalty,
  createItmDistanceGrid,
  getItmApiPathLoss,
  findReliableDistanceFromLossMap,
  calculateFallbackItmStyleLoss,
  calculateTotalPathLoss,
  findReliableDistance,
  ITM_API_MIN_DISTANCE_KM,
} from '../src/rf/propagation.js';

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL: ${message}`);
    throw new Error(message);
  }
};

const approx = (value, expected, tolerance) => Math.abs(value - expected) <= tolerance;

// ===========================================================================
// 1. Unit Conversion Tests
// ===========================================================================

console.log('Running unit conversion tests...');

const fmHalfMicrovoltDbm = microvoltsToDbm(0.5);
assert(approx(fmHalfMicrovoltDbm, -113.01, 0.02), '0.5 uV in 50 ohms should be about -113.01 dBm');
assert(approx(dbmToMicrovolts(fmHalfMicrovoltDbm), 0.5, 0.001), 'dBm/uV conversion should round-trip for FM threshold');
assert(approx(dbmToMicrovolts(-107.01), 1.0, 0.01), '1.0 uV should be about -107.01 dBm');
assert(approx(dbmToMicrovolts(-93.01), 5.0, 0.05), '5.0 uV should be about -93.01 dBm');

assert(
  approx(calculateRequiredSignalDbm({ bandwidthHz: 12500, noiseFigureDb: 6, requiredSnrDb: 14 }), fmHalfMicrovoltDbm, 0.1),
  'FM noise-floor mode should align with the 0.5 uV planning threshold',
);
assert(
  calculateRequiredSignalDbm({ bandwidthHz: 125000, noiseFigureDb: 6, requiredSnrDb: -20 }) < -136.9,
  'LoRa SF12 125 kHz threshold should be near -137 dBm with 6 dB NF',
);

// Noise floor reference: -174 + 10*log10(12500) + 6 = -127.03
assert(approx(calculateNoiseFloorDbm(12500, 6), -127.03, 0.05), 'Noise floor for 12.5 kHz / 6 dB NF should be ~-127 dBm');

// ===========================================================================
// 2. Free Space Path Loss Tests (ITU-R P.525)
// ===========================================================================

console.log('Running free space path loss tests...');

// FSPL = 32.44 + 20*log10(d_km) + 20*log10(f_MHz)
assert(approx(calculateFreeSpacePathLoss(145, 10), 95.67, 0.1), 'FSPL at 145 MHz / 10 km should be ~95.67 dB');
assert(approx(calculateFreeSpacePathLoss(430, 10), 105.11, 0.1), 'FSPL at 430 MHz / 10 km should be ~105.11 dB');
assert(approx(calculateFreeSpacePathLoss(5600, 10), 127.40, 0.1), 'FSPL at 5600 MHz / 10 km should be ~127.40 dB');
assert(approx(calculateFreeSpacePathLoss(145, 1), 75.63, 0.1), 'FSPL at 145 MHz / 1 km should be ~75.63 dB');
assert(approx(calculateFreeSpacePathLoss(145, 100), 115.67, 0.1), 'FSPL at 145 MHz / 100 km should be ~115.67 dB');

// ===========================================================================
// 3. Hata Model Tests (Okumura-Hata)
// ===========================================================================

console.log('Running Hata model tests...');

// Hata mobile correction for small/medium city at 145 MHz, hRx=1.5m
// a(hr) = (1.1*log(f) - 0.7)*hr - (1.56*log(f) - 0.8)
const hataCorr = calculateHataMobileCorrection(145, 1.5);
assert(Number.isFinite(hataCorr), 'Hata mobile correction should be finite');

// Hata suburban path loss at 145 MHz, hTx=30m, hRx=1.5m, d=10km
// Should be in the range 130-140 dB (typical for suburban VHF)
const hataLoss = calculateHataSuburbanPathLoss(145, 30, 1.5, 10);
assert(hataLoss > 125 && hataLoss < 145, `Hata suburban loss at 145 MHz / 10 km should be 125-145 dB, got ${hataLoss.toFixed(2)}`);

// COST-231 mobile correction (metropolitan) at 1800 MHz, hRx=1.5m
// a(hr) = 3.2*(log(11.75*hr))^2 - 4.97
const cost231Corr = calculateCost231MobileCorrection(1800, 1.5);
assert(approx(cost231Corr, 3.2 * (Math.log10(11.75 * 1.5) ** 2) - 4.97, 0.01), 'COST-231 mobile correction should match metropolitan formula');

// COST-231 suburban at 1800 MHz
// L = 46.3 + 33.9*log(1800) - 13.82*log(30) - a(1.5) + (44.9-6.55*log(30))*log(10) ≈ 171 dB
const costLoss = calculateCost231SuburbanPathLoss(1800, 30, 1.5, 10);
assert(costLoss > 165 && costLoss < 180, `COST-231 loss at 1800 MHz / 10 km should be 165-180 dB, got ${costLoss.toFixed(2)}`);

// ===========================================================================
// 4. Path Loss Invariant Tests
// ===========================================================================

console.log('Running path loss invariant tests...');

// Path loss should never be below free space
for (const freq of [30, 50, 145, 433, 900, 1296, 1800, 2400, 3000, 5600, 10368, 24000]) {
  for (const distanceKm of [0.1, 0.5, 1, 10, 50]) {
    const fspl = calculateFreeSpacePathLoss(freq, distanceKm);
    const loss = calculatePathLoss(freq, 45, 1.5, distanceKm);
    assert(loss >= fspl - 1e-9, `Path loss below FSPL at ${freq} MHz / ${distanceKm} km`);
  }
}

// Path loss should monotonically increase with distance
for (const freq of [145, 433, 1296, 5600]) {
  let previousLoss = 0;
  for (const distanceKm of [0.1, 0.5, 1, 2, 5, 10, 25, 50]) {
    const loss = calculatePathLoss(freq, 45, 1.5, distanceKm);
    assert(loss >= previousLoss - 1e-9, `Path loss decreased at ${freq} MHz / ${distanceKm} km`);
    previousLoss = loss;
  }
}

// ===========================================================================
// 5. Rain Attenuation Tests (ITU-R P.838)
// ===========================================================================

console.log('Running rain attenuation tests (ITU-R P.838)...');

// Rain loss should not affect VHF
assert(calculateShfRainLoss(145, 30, 50) === 0, 'Rain loss must not affect VHF');

// Rain loss should increase with SHF frequency
assert(calculateShfRainLoss(10368, 30, 50) > calculateShfRainLoss(5600, 30, 50), 'Rain loss should increase with SHF frequency');

// Rain loss should increase with rain rate
assert(calculateShfRainLoss(10368, 30, 80) > calculateShfRainLoss(10368, 30, 10), 'Rain loss should increase with rain rate');

// ITU-R P.838 reference value checks (vertical polarization)
// At 10 GHz, 50 mm/h, 10 km: should be in range 8-15 dB (much higher than old 0.58 dB)
const rainLoss10Ghz = calculateShfRainLoss(10000, 10, 50);
assert(rainLoss10Ghz > 5, `Rain loss at 10 GHz / 50 mm/h / 10 km should be > 5 dB (ITU-R P.838), got ${rainLoss10Ghz.toFixed(2)}`);
assert(rainLoss10Ghz < 20, `Rain loss at 10 GHz / 50 mm/h / 10 km should be < 20 dB, got ${rainLoss10Ghz.toFixed(2)}`);

// At 24 GHz, 50 mm/h, 10 km: should be significant (much higher than old 1.98 dB)
const rainLoss24Ghz = calculateShfRainLoss(24000, 10, 50);
assert(rainLoss24Ghz > 15, `Rain loss at 24 GHz / 50 mm/h / 10 km should be > 15 dB (ITU-R P.838), got ${rainLoss24Ghz.toFixed(2)}`);
assert(rainLoss24Ghz < 50, `Rain loss at 24 GHz / 50 mm/h / 10 km should be < 50 dB, got ${rainLoss24Ghz.toFixed(2)}`);

// At 5.6 GHz, 50 mm/h, 10 km: should be > 1 dB (old code gave 0.26 dB)
const rainLoss56Ghz = calculateShfRainLoss(5600, 10, 50);
assert(rainLoss56Ghz > 1, `Rain loss at 5.6 GHz / 50 mm/h / 10 km should be > 1 dB (ITU-R P.838), got ${rainLoss56Ghz.toFixed(2)}`);

// ===========================================================================
// 6. Atmospheric Loss Tests (ITU-R P.676)
// ===========================================================================

console.log('Running atmospheric loss tests (ITU-R P.676)...');

// Atmospheric loss should not affect VHF
assert(calculateAtmosphericLoss(145, 30, 0.01) === 0, 'Atmospheric loss must not affect VHF');

// Atmospheric loss should increase above 10 GHz
assert(calculateAtmosphericLoss(24000, 30, 0.01) > calculateAtmosphericLoss(5600, 30, 0.01), 'Atmospheric loss should increase above 10 GHz');

// Atmospheric loss should be capped for planning stability
assert(calculateAtmosphericLoss(24000, 1000, 0.5) === 20, 'Atmospheric loss should be capped for planning stability');

// ITU-R P.676 reference: at 22 GHz (water vapor line), loss should be significant
const atmLoss22Ghz = calculateAtmosphericLoss(22000, 10, 0.01);
assert(atmLoss22Ghz > 1.0, `Atmospheric loss at 22 GHz / 10 km should be > 1.0 dB (water vapor line), got ${atmLoss22Ghz.toFixed(3)}`);

// At 10 GHz, atmospheric loss should be small but non-zero
const atmLoss10Ghz = calculateAtmosphericLoss(10000, 10, 0.01);
assert(atmLoss10Ghz > 0.05, `Atmospheric loss at 10 GHz / 10 km should be > 0.05 dB, got ${atmLoss10Ghz.toFixed(3)}`);

// ===========================================================================
// 7. Two-Ray Model Tests
// ===========================================================================

console.log('Running two-ray model tests...');

// Two-ray should return 0 below breakpoint
const twoRayBelow = calculateTwoRayLoss({ freq: 5600, distanceKm: 5, hTx: 15, hRx: 10 });
assert(twoRayBelow === 0, 'Two-ray loss should be 0 below breakpoint');

// Two-ray excess should use 20*log10(d/d_bp) not 6*log10(d/d_bp)
// At 5600 MHz, hTx=15, hRx=10: breakpoint = 4*15*10/(300/5600*1000) = 11.2 km
// At 50 km: excess = 20*log10(50/11.2) = 13.0 dB (old code gave 3.9 dB)
const twoRay50km = calculateTwoRayLoss({ freq: 5600, distanceKm: 50, hTx: 15, hRx: 10 });
assert(twoRay50km > 10, `Two-ray excess at 50 km should be > 10 dB with 20log10 coefficient, got ${twoRay50km.toFixed(2)}`);
assert(twoRay50km <= 18, 'Two-ray excess should be capped at 18 dB');

// At 20 km: excess = 20*log10(20/11.2) = 5.04 dB (old code gave 1.51 dB)
const twoRay20km = calculateTwoRayLoss({ freq: 5600, distanceKm: 20, hTx: 15, hRx: 10 });
assert(twoRay20km > 4, `Two-ray excess at 20 km should be > 4 dB with 20log10 coefficient, got ${twoRay20km.toFixed(2)}`);

// ===========================================================================
// 8. ITM Distance Grid Tests
// ===========================================================================

console.log('Running ITM distance grid tests...');

const itmDistanceGrid = createItmDistanceGrid(100);
assert(itmDistanceGrid[0] === ITM_API_MIN_DISTANCE_KM, 'Native ITM distance grid should start at 1 km');
assert(!itmDistanceGrid.some((distanceKm) => distanceKm < ITM_API_MIN_DISTANCE_KM), 'Native ITM distance grid must not include sub-1 km samples');
assert(itmDistanceGrid.includes(100), 'Native ITM distance grid should include the requested max range');

// ===========================================================================
// 9. Terrain Penalty Tests (Deygout diffraction)
// ===========================================================================

console.log('Running terrain penalty tests...');

// Use high antennas (100m TX) and UHF frequency so the clear path is actually clear
const clearPath = Array.from({ length: 20 }, (_, index) => ({ distanceKm: index + 1, elevation: 100 }));
const blockedPath = clearPath.map((sample) => (
  sample.distanceKm === 5 ? { ...sample, elevation: 260 } : sample
));
const clearLoss = calculateTerrainPenalty(clearPath, 10, 100, 100, 1.5, 1296);
const blockedLoss = calculateTerrainPenalty(blockedPath, 10, 100, 100, 1.5, 1296);
assert(
  blockedLoss > clearLoss,
  `Blocked path should add more terrain penalty than clear path (clear=${clearLoss.toFixed(2)}, blocked=${blockedLoss.toFixed(2)})`,
);

// Multi-obstruction: two ridges should produce more loss than one
const singleRidge = clearPath.map((s) => s.distanceKm === 5 ? { ...s, elevation: 260 } : s);
const doubleRidge = clearPath.map((s) => (s.distanceKm === 3 || s.distanceKm === 7) ? { ...s, elevation: 260 } : s);
const singleLoss = calculateTerrainPenalty(singleRidge, 10, 100, 100, 1.5, 1296);
const doubleLoss = calculateTerrainPenalty(doubleRidge, 10, 100, 100, 1.5, 1296);
assert(doubleLoss >= singleLoss, 'Double ridge should produce >= loss than single ridge (Deygout)');

// Terrain penalty should be capped
const extremeRidge = clearPath.map((s) => s.distanceKm === 5 ? { ...s, elevation: 1000 } : s);
const extremeLoss = calculateTerrainPenalty(extremeRidge, 10, 100, 100, 1.5, 1296);
assert(extremeLoss <= 40, 'Terrain penalty should be capped at 40 dB');

// ===========================================================================
// 10. ITM API Interpolation Tests
// ===========================================================================

console.log('Running ITM API interpolation tests...');

const itmLossMap = [
  { distanceKm: 1, lossDb: 90 },
  { distanceKm: 2, lossDb: 100 },
  { distanceKm: 3, lossDb: 120 },
];
assert(getItmApiPathLoss(itmLossMap, 0.5) === null, 'Sub-1 km ITM interpolation should fall back to local model');
assert(approx(getItmApiPathLoss(itmLossMap, 1.5), 95, 0.01), 'ITM loss interpolation should be linear');
assert(findReliableDistanceFromLossMap({ itmLossMap, freq: 145, hTx: 30, hRx: 1.5, clutterLossDb: 0, rainRateMmH: 0, atmosphericLossDbPerKm: 0, useTwoRay: false, targetLoss: 85 }) === null, 'ITM search should fall back locally when first ITM sample already fails');

const reliable110 = findReliableDistanceFromLossMap({ itmLossMap, freq: 145, hTx: 30, hRx: 1.5, clutterLossDb: 0, rainRateMmH: 0, atmosphericLossDbPerKm: 0, useTwoRay: false, targetLoss: 110 });
assert(reliable110 > 2 && reliable110 < 3, 'Reliable distance should interpolate threshold crossing');
assert(
  findReliableDistanceFromLossMap({ itmLossMap, freq: 145, hTx: 30, hRx: 1.5, clutterLossDb: 0, rainRateMmH: 0, atmosphericLossDbPerKm: 0, useTwoRay: false, targetLoss: 110, extraLossFn: () => 10 }) < reliable110,
  'External losses should reduce reliable distance',
);

// ===========================================================================
// 11. Server Fallback ITM-Style Loss Tests
// ===========================================================================

console.log('Running server fallback loss tests...');

const fallbackInput = {
  frequencyMhz: 145,
  txHeightM: 10,
  rxHeightM: 1.5,
  siteElevationM: 100,
  radialSamples: [
    { distanceKm: 1, elevation: 100 },
    { distanceKm: 5, elevation: 110 },
    { distanceKm: 10, elevation: 105 },
  ],
  distanceKm: 10,
};
const fallbackLoss = calculateFallbackItmStyleLoss(fallbackInput);
assert(fallbackLoss > calculateFreeSpacePathLoss(145, 10), 'Fallback ITM loss should be > FSPL (includes terrain roughness)');
assert(Number.isFinite(fallbackLoss), 'Fallback ITM loss should be finite');

// Fallback should increase with rougher terrain
const flatInput = { ...fallbackInput, radialSamples: [{ distanceKm: 1, elevation: 100 }, { distanceKm: 5, elevation: 100 }, { distanceKm: 10, elevation: 100 }] };
const roughInput = { ...fallbackInput, radialSamples: [{ distanceKm: 1, elevation: 100 }, { distanceKm: 5, elevation: 300 }, { distanceKm: 10, elevation: 80 }] };
assert(calculateFallbackItmStyleLoss(roughInput) > calculateFallbackItmStyleLoss(flatInput), 'Rougher terrain should produce higher fallback loss');

// ===========================================================================
// 12. Total Path Loss Integration Tests
// ===========================================================================

console.log('Running total path loss integration tests...');

const totalLossParams = {
  modelKey: 'enhancedHata',
  freq: 145,
  effectiveHTx: 30,
  hTx: 30,
  hRx: 1.5,
  distanceKm: 10,
  radialSamples: [{ distanceKm: 1, elevation: 100 }, { distanceKm: 5, elevation: 105 }, { distanceKm: 10, elevation: 100 }],
  siteElevation: 100,
  clutterLossDb: 6,
  terrainPenaltyCache: new Map(),
  rainRateMmH: 0,
  atmosphericLossDbPerKm: 0,
  useTwoRay: false,
};
const totalLoss = calculateTotalPathLoss(totalLossParams);
assert(totalLoss > calculatePathLoss(145, 30, 1.5, 10), 'Total path loss should be > base model loss (includes clutter + terrain)');
assert(Number.isFinite(totalLoss), 'Total path loss should be finite');

// With rain at SHF, total loss should increase
const shfParams = { ...totalLossParams, freq: 5600, rainRateMmH: 50 };
const shfLossNoRain = calculateTotalPathLoss({ ...shfParams, rainRateMmH: 0 });
const shfLossWithRain = calculateTotalPathLoss(shfParams);
assert(shfLossWithRain > shfLossNoRain, 'Total path loss with rain should be > without rain at SHF');

// ===========================================================================
// 13. Find Reliable Distance Tests
// ===========================================================================

console.log('Running reliable distance search tests...');

const reliableDistParams = {
  modelKey: 'enhancedHata',
  freq: 145,
  effectiveHTx: 30,
  hTx: 30,
  hRx: 1.5,
  targetLoss: 140,
  radialSamples: [{ distanceKm: 1, elevation: 100 }, { distanceKm: 5, elevation: 105 }, { distanceKm: 10, elevation: 100 }],
  siteElevation: 100,
  clutterLossDb: 0,
  terrainPenaltyCache: new Map(),
  rainRateMmH: 0,
  atmosphericLossDbPerKm: 0,
  useTwoRay: false,
  maxRangeKm: 50,
};
const reliableDist = findReliableDistance(reliableDistParams);
assert(reliableDist > 0, 'Reliable distance should be > 0 for achievable target loss');
assert(reliableDist <= 50, 'Reliable distance should not exceed max range');

// Higher target loss should give larger reliable distance
const largerDist = findReliableDistance({ ...reliableDistParams, targetLoss: 160 });
assert(largerDist >= reliableDist, 'Larger target loss should give >= reliable distance');

// ===========================================================================
// Summary
// ===========================================================================

console.log(`\n${passed} tests passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
console.log('RF smoke tests passed.');
