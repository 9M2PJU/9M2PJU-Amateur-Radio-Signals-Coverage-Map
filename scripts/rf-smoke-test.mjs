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

for (const freq of [30, 50, 145, 433, 900, 1296, 1800, 2400, 3000, 5600, 10368, 24000]) {
  for (const distanceKm of [0.1, 0.5, 1, 10, 50]) {
    const fspl = calculateFreeSpacePathLoss(freq, distanceKm);
    const loss = calculatePathLoss(freq, 45, 1.5, distanceKm);
    assert(loss >= fspl - 1e-9, `Path loss below FSPL at ${freq} MHz / ${distanceKm} km`);
  }
}

assert(calculateShfRainLoss(145, 30, 50) === 0, 'Rain loss must not affect VHF');
assert(calculateShfRainLoss(10368, 30, 50) > calculateShfRainLoss(5600, 30, 50), 'Rain loss should increase with SHF frequency');
assert(calculateShfRainLoss(10368, 30, 80) > calculateShfRainLoss(10368, 30, 10), 'Rain loss should increase with rain rate');

console.log('RF smoke tests passed.');
