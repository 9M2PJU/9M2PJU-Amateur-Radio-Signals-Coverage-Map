const MIN_FREQUENCY_MHZ = 30;
const MAX_FREQUENCY_MHZ = 30000;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const calculateFreeSpacePathLoss = (freq, distanceKm) => (
  32.44 + 20 * Math.log10(Math.max(0.001, distanceKm)) + 20 * Math.log10(clamp(freq, MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ))
);

const calculateHataMobileCorrection = (freq, hRx) => {
  const logFreq = Math.log10(freq);
  return (1.1 * logFreq - 0.7) * hRx - (1.56 * logFreq - 0.8);
};

const calculateHataSuburbanPathLoss = (freq, effectiveHTx, hRx, distanceKm) => {
  const logFreq = Math.log10(freq);
  const logHTx = Math.log10(clamp(effectiveHTx, 30, 200));
  const safeHRx = clamp(hRx, 1, 10);
  const mobileCorrection = calculateHataMobileCorrection(freq, safeHRx);
  const logDist = Math.log10(Math.max(1, distanceKm));
  const urbanLoss = 69.55 + 26.16 * logFreq - 13.82 * logHTx - mobileCorrection + (44.9 - 6.55 * logHTx) * logDist;
  const suburbanCorrection = 2 * (Math.log10(freq / 28) ** 2) + 5.4;
  return urbanLoss - suburbanCorrection;
};

const calculateCost231SuburbanPathLoss = (freq, effectiveHTx, hRx, distanceKm) => {
  const logFreq = Math.log10(freq);
  const logHTx = Math.log10(clamp(effectiveHTx, 30, 200));
  const safeHRx = clamp(hRx, 1, 10);
  const mobileCorrection = calculateHataMobileCorrection(freq, safeHRx);
  const logDist = Math.log10(Math.max(1, distanceKm));
  return 46.3 + 33.9 * logFreq - 13.82 * logHTx - mobileCorrection + (44.9 - 6.55 * logHTx) * logDist;
};

const calculateShfExcessLoss = (freq, distanceKm) => {
  const safeFreq = clamp(freq, 3000, MAX_FREQUENCY_MHZ);
  const frequencyFactor = clamp((safeFreq - 3000) / (MAX_FREQUENCY_MHZ - 3000), 0, 1);
  return 3 + frequencyFactor * 9 + clamp(distanceKm * 0.02, 0, 8);
};

const calculatePathLoss = (freq, effectiveHTx, hRx, distanceKm) => {
  const safeFreq = clamp(freq, MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ);
  const safeDistanceKm = Math.max(0.001, distanceKm);
  const freeSpaceLoss = calculateFreeSpacePathLoss(safeFreq, safeDistanceKm);

  if (safeFreq > 3000) return freeSpaceLoss + calculateShfExcessLoss(safeFreq, safeDistanceKm);

  const hataLoss = calculateHataSuburbanPathLoss(clamp(safeFreq, 150, 1500), effectiveHTx, hRx, safeDistanceKm);
  if (safeFreq <= 1500) return Math.max(freeSpaceLoss, hataLoss);

  const costLoss = calculateCost231SuburbanPathLoss(clamp(safeFreq, 1500, 2000), effectiveHTx, hRx, safeDistanceKm);
  const highUhfExtension = safeFreq > 2000 ? (safeFreq - 2000) / 1000 * 5 : 0;
  return Math.max(freeSpaceLoss, costLoss + highUhfExtension);
};

const calculateShfRainLoss = (freq, distanceKm, rainRateMmH) => {
  if (freq < 3000 || rainRateMmH <= 0 || distanceKm <= 0) return 0;
  const freqGhz = freq / 1000;
  const k = clamp(0.00012 * (freqGhz ** 1.35), 0, 2.5);
  const alpha = clamp(0.82 + 0.03 * Math.log10(Math.max(1, freqGhz)), 0.75, 1.15);
  const effectiveDistanceKm = distanceKm / (1 + distanceKm / 35);
  return clamp(k * (rainRateMmH ** alpha) * effectiveDistanceKm, 0, 45);
};

const EFFECTIVE_EARTH_RADIUS_KM = 6371 * (4 / 3);
const getElevationAtDistance = (radialSamples, distanceKm, fallbackElevation) => {
  if (!radialSamples.length || distanceKm <= 0) return fallbackElevation;
  const firstSample = radialSamples[0];
  if (distanceKm <= firstSample.distanceKm) {
    const ratio = clamp(distanceKm / firstSample.distanceKm, 0, 1);
    return fallbackElevation + (firstSample.elevation - fallbackElevation) * ratio;
  }

  for (let index = 1; index < radialSamples.length; index += 1) {
    const previous = radialSamples[index - 1];
    const next = radialSamples[index];
    if (distanceKm > next.distanceKm) continue;
    const ratio = (distanceKm - previous.distanceKm) / Math.max(1e-9, next.distanceKm - previous.distanceKm);
    return previous.elevation + (next.elevation - previous.elevation) * clamp(ratio, 0, 1);
  }

  return radialSamples[radialSamples.length - 1].elevation;
};

const calculateTerrainPenalty = (radialSamples, radiusKm, siteElevation, hTx, hRx, freq) => {
  const wavelength = 300 / freq;
  const txAmsl = siteElevation + hTx;
  const rxGround = getElevationAtDistance(radialSamples, radiusKm, siteElevation);
  const rxAmsl = rxGround + hRx;
  let maxDiffractionLoss = 0;
  let shadowedSamples = 0;

  for (let distanceKm = 0.5; distanceKm < radiusKm; distanceKm += 0.5) {
    const pathFraction = distanceKm / radiusKm;
    const lineOfSightHeight = txAmsl + (rxAmsl - txAmsl) * pathFraction;
    const firstFresnelRadius = 548 * Math.sqrt((distanceKm * (radiusKm - distanceKm)) / (freq * radiusKm));
    const earthBulge = (distanceKm * (radiusKm - distanceKm) * 1000) / (2 * EFFECTIVE_EARTH_RADIUS_KM);
    const terrainElevation = getElevationAtDistance(radialSamples, distanceKm, siteElevation);
    const clearanceDeficit = (terrainElevation + earthBulge) - (lineOfSightHeight - 0.6 * firstFresnelRadius);
    if (clearanceDeficit <= 0) continue;

    shadowedSamples += 1;
    const d1 = Math.max(1, distanceKm * 1000);
    const d2 = Math.max(1, (radiusKm - distanceKm) * 1000);
    const v = clearanceDeficit * Math.sqrt((2 * (d1 + d2)) / (wavelength * d1 * d2));
    const diffractionLoss = v <= -0.78 ? 0 : 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
    maxDiffractionLoss = Math.max(maxDiffractionLoss, diffractionLoss);
  }

  return shadowedSamples === 0 ? 0 : clamp(maxDiffractionLoss + shadowedSamples * 1.5, 0, 38);
};

const getItmApiPathLoss = (itmLossMap, distanceKm) => {
  if (!itmLossMap?.length) return null;
  if (distanceKm <= itmLossMap[0].distanceKm) return itmLossMap[0].lossDb;
  for (let index = 1; index < itmLossMap.length; index += 1) {
    const previous = itmLossMap[index - 1];
    const next = itmLossMap[index];
    if (distanceKm > next.distanceKm) continue;
    const ratio = (distanceKm - previous.distanceKm) / Math.max(1e-9, next.distanceKm - previous.distanceKm);
    return previous.lossDb + (next.lossDb - previous.lossDb) * clamp(ratio, 0, 1);
  }
  return itmLossMap[itmLossMap.length - 1].lossDb;
};

const findReliableDistanceFromLossMap = (itmLossMap, targetLoss, externalLoss = 0) => {
  let lastPassing = itmLossMap[0].distanceKm;
  let lastLoss = itmLossMap[0].lossDb + externalLoss;
  if (lastLoss > targetLoss) return lastPassing;

  for (let index = 1; index < itmLossMap.length; index += 1) {
    const sample = itmLossMap[index];
    const totalLoss = sample.lossDb + externalLoss;
    if (totalLoss > targetLoss) {
      const ratio = clamp((targetLoss - lastLoss) / Math.max(1e-9, totalLoss - lastLoss), 0, 1);
      return lastPassing + (sample.distanceKm - lastPassing) * ratio;
    }
    lastPassing = sample.distanceKm;
    lastLoss = totalLoss;
  }
  return lastPassing;
};

for (const freq of [30, 50, 145, 433, 900, 1296, 1800, 2400, 3000, 5600, 10368, 24000]) {
  for (const distanceKm of [0.1, 0.5, 1, 10, 50]) {
    const fspl = calculateFreeSpacePathLoss(freq, distanceKm);
    const loss = calculatePathLoss(freq, 45, 1.5, distanceKm);
    assert(loss >= fspl - 1e-9, `Path loss below FSPL at ${freq} MHz / ${distanceKm} km`);
  }
}

for (const freq of [145, 433, 1296, 5600]) {
  let previousLoss = 0;
  for (const distanceKm of [0.1, 0.5, 1, 2, 5, 10, 25, 50]) {
    const loss = calculatePathLoss(freq, 45, 1.5, distanceKm);
    assert(loss >= previousLoss - 1e-9, `Path loss decreased at ${freq} MHz / ${distanceKm} km`);
    previousLoss = loss;
  }
}

assert(calculateShfRainLoss(145, 30, 50) === 0, 'Rain loss must not affect VHF');
assert(calculateShfRainLoss(10368, 30, 50) > calculateShfRainLoss(5600, 30, 50), 'Rain loss should increase with SHF frequency');
assert(calculateShfRainLoss(10368, 30, 80) > calculateShfRainLoss(10368, 30, 10), 'Rain loss should increase with rain rate');

const clearPath = Array.from({ length: 20 }, (_, index) => ({ distanceKm: index + 1, elevation: 100 }));
const blockedPath = clearPath.map((sample) => (
  sample.distanceKm === 5 ? { ...sample, elevation: 260 } : sample
));
assert(
  calculateTerrainPenalty(blockedPath, 10, 100, 30, 1.5, 145) > calculateTerrainPenalty(clearPath, 10, 100, 30, 1.5, 145),
  'Blocked path should add more terrain penalty than the same path without the ridge',
);

const itmLossMap = [
  { distanceKm: 1, lossDb: 90 },
  { distanceKm: 2, lossDb: 100 },
  { distanceKm: 3, lossDb: 120 },
];
assert(getItmApiPathLoss(itmLossMap, 1.5) === 95, 'ITM loss interpolation should be linear');
assert(findReliableDistanceFromLossMap(itmLossMap, 110) > 2 && findReliableDistanceFromLossMap(itmLossMap, 110) < 3, 'Reliable distance should interpolate threshold crossing');
assert(findReliableDistanceFromLossMap(itmLossMap, 110, 10) < findReliableDistanceFromLossMap(itmLossMap, 110, 0), 'External losses should reduce reliable distance');

console.log('RF smoke tests passed.');
