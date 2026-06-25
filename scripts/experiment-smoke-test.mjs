const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const normalizeBearingDelta = (bearing, centerBearing) => (
  Math.abs(((bearing - centerBearing + 540) % 360) - 180)
);

const summarizeNumericErrors = (errors, tolerances = [3, 5, 10]) => {
  const valid = errors.filter(Number.isFinite);
  if (!valid.length) {
    return {
      count: 0,
      mae: 0,
      rmse: 0,
      within: Object.fromEntries(tolerances.map((tolerance) => [tolerance, 0])),
    };
  }

  const abs = valid.map(Math.abs);
  return {
    count: valid.length,
    mae: abs.reduce((total, value) => total + value, 0) / abs.length,
    rmse: Math.sqrt(valid.reduce((total, value) => total + value ** 2, 0) / valid.length),
    within: Object.fromEntries(tolerances.map((tolerance) => [
      tolerance,
      valid.filter((value) => Math.abs(value) <= tolerance).length / valid.length * 100,
    ])),
  };
};

const parseRadioMobileComparisonCsv = (text) => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headers = lines[0].split(',').map((header) => header.trim().toLowerCase());
  const findHeader = (names) => headers.findIndex((header) => names.includes(header));
  const bearingIndex = findHeader(['bearing', 'bearingdeg', 'azimuth', 'azimuthdeg', 'deg']);
  const strongIndex = findHeader(['strong', 'strongkm', 'strongreachkm', 'strong_distance_km']);
  const moderateIndex = findHeader(['moderate', 'moderatekm', 'moderatereachkm', 'moderate_distance_km']);
  const weakIndex = findHeader(['fringe', 'fringekm', 'fringereachkm', 'weak', 'weakkm', 'weakreachkm', 'distancekm']);
  if (bearingIndex < 0 || weakIndex < 0) return [];

  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((cell) => cell.trim());
    return {
      bearingDeg: ((Number(cells[bearingIndex]) % 360) + 360) % 360,
      strongReachKm: Number(cells[strongIndex]),
      moderateReachKm: Number(cells[moderateIndex]),
      weakReachKm: Number(cells[weakIndex]),
    };
  }).filter((row) => Number.isFinite(row.bearingDeg) && Number.isFinite(row.weakReachKm));
};

const rows = parseRadioMobileComparisonCsv(`bearing,strong,moderate,fringe
0,45,60,75
359,44,59,74
`);

assert(rows.length === 2, 'Radio Mobile parser should read two rows');
assert(normalizeBearingDelta(rows[1].bearingDeg, 1) === 2, 'Bearing delta should wrap around north');

const summary = summarizeNumericErrors([1, -2, 8, Number.NaN]);
assert(summary.count === 3, 'Error summary should ignore invalid values');
assert(Math.round(summary.within[3]) === 67, 'Within-3km score should be percentage based');
assert(summary.mae > 3.6 && summary.mae < 3.7, 'MAE should be mean absolute error');

console.log('Experiment smoke checks passed.');
