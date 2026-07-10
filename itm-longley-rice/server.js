import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  clamp,
  calculateShfRainLoss,
  calculateAtmosphericLoss,
  calculateTwoRayLoss,
  calculateFallbackItmStyleLoss,
} from '../src/rf/propagation.js';

const PORT = Number(process.env.PORT ?? 8787);
const ITM_RUNNER = process.env.ITM_RUNNER ?? '/usr/local/bin/itm-runner';
const OPEN_ELEVATION_API_URL = (process.env.OPEN_ELEVATION_API_URL ?? 'https://elevation.hamradio.my/api/v1/lookup').replace(/\/$/, '');
const MAX_BODY_BYTES = 2_000_000;
const MAX_DISTANCES = 260;
const MAX_SAMPLES = 512;
const ITM_MIN_DISTANCE_KM = 1;
const ITM_MAX_FREQ_MHZ = 20000;
const RASTER_MIN_CELL_KM = 1;
const RASTER_MAX_CELL_KM = 10;
const RASTER_DEFAULT_CELL_KM = 3;
const RASTER_MAX_RANGE_KM = 120;
const RASTER_MAX_CELLS = Number(process.env.RASTER_MAX_CELLS ?? 5000);
const RASTER_MAX_PROFILE_SAMPLES = Number(process.env.RASTER_MAX_PROFILE_SAMPLES ?? 96);
const RASTER_PROFILE_STEP_KM = Number(process.env.RASTER_PROFILE_STEP_KM ?? 2);
const ELEVATION_CHUNK_SIZE = Number(process.env.ELEVATION_CHUNK_SIZE ?? 80);
const ELEVATION_TIMEOUT_MS = Number(process.env.ELEVATION_TIMEOUT_MS ?? 12000);
const ELEVATION_RETRIES = Number(process.env.ELEVATION_RETRIES ?? 2);
const RASTER_WORKERS = Number(process.env.RASTER_WORKERS ?? 2);
const EARTH_RADIUS_KM = 6371;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX ?? 60);
const rateLimitMap = new Map();

const checkRateLimit = (ip) => {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.timestamp > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { timestamp: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX_REQUESTS;
};

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.timestamp > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

const ELEVATION_CACHE_MAX = Number(process.env.ELEVATION_CACHE_MAX ?? 50_000);
const elevationCache = new Map();

const elevationCacheGet = (key) => {
  if (!elevationCache.has(key)) return undefined;
  const value = elevationCache.get(key);
  // Move to end (most recently used)
  elevationCache.delete(key);
  elevationCache.set(key, value);
  return value;
};

const elevationCacheSet = (key, value) => {
  if (elevationCache.size >= ELEVATION_CACHE_MAX) {
    // Delete oldest entry (first in Map)
    const firstKey = elevationCache.keys().next().value;
    elevationCache.delete(firstKey);
  }
  elevationCache.set(key, value);
};

const nativeItmAvailable = () => existsSync(ITM_RUNNER);
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const normalizeCoordinate = (value) => Number(value).toFixed(5);
const getElevationCacheKey = (lat, lon) => `${normalizeCoordinate(lat)},${normalizeCoordinate(lon)}`;
const degreesToRadians = (degrees) => degrees * Math.PI / 180;
const radiansToDegrees = (radians) => radians * 180 / Math.PI;
const haversineDistanceKm = ([lat1, lon1], [lat2, lon2]) => {
  const dLat = degreesToRadians(lat2 - lat1);
  const dLon = degreesToRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(degreesToRadians(lat1)) * Math.cos(degreesToRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const calculateBearingDegrees = ([lat1, lon1], [lat2, lon2]) => {
  const phi1 = degreesToRadians(lat1);
  const phi2 = degreesToRadians(lat2);
  const deltaLon = degreesToRadians(lon2 - lon1);
  const y = Math.sin(deltaLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLon);
  return (radiansToDegrees(Math.atan2(y, x)) + 360) % 360;
};
const getDestinationPoint = (lat, lon, bearingDeg, distanceKm) => {
  const bearing = degreesToRadians(bearingDeg);
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const lat1 = degreesToRadians(lat);
  const lon1 = degreesToRadians(lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return [radiansToDegrees(lat2), ((radiansToDegrees(lon2) + 540) % 360) - 180];
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      req.destroy();
      reject(new Error('Request body too large'));
    }
  });
  req.on('end', () => resolve(body));
  req.on('error', reject);
});

const fetchWithTimeout = async (url, options = {}, timeoutMs = ELEVATION_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const fetchElevationChunk = async (points) => {
  if (!OPEN_ELEVATION_API_URL) return points.map(() => undefined);
  let lastError;

  for (let attempt = 0; attempt <= ELEVATION_RETRIES; attempt += 1) {
    try {
      const resp = await fetchWithTimeout(OPEN_ELEVATION_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: points.map(([latitude, longitude]) => ({ latitude, longitude })),
        }),
      });

      if (!resp.ok) throw new Error(`Elevation lookup failed: ${resp.status}`);
      const data = await resp.json();
      const results = data.results ?? [];
      if (!Array.isArray(results) || !results.length) throw new Error('Elevation lookup returned no results');
      return points.map((_, index) => results[index]?.elevation);
    } catch (error) {
      lastError = error;
      if (attempt < ELEVATION_RETRIES) await delay(350 * (attempt + 1));
    }
  }

  console.warn('Elevation lookup failed; using fallback terrain for this chunk:', lastError?.message ?? lastError);
  return points.map(() => undefined);
};

const fetchElevationBatch = async (points) => {
  const elevations = Array(points.length);
  const uncached = [];

  points.forEach(([lat, lon], index) => {
    const cacheKey = getElevationCacheKey(lat, lon);
    const cached = elevationCacheGet(cacheKey);
    if (cached !== undefined) {
      elevations[index] = cached;
      return;
    }

    uncached.push({ point: [lat, lon], index, cacheKey });
  });

  for (let start = 0; start < uncached.length; start += ELEVATION_CHUNK_SIZE) {
    const chunk = uncached.slice(start, start + ELEVATION_CHUNK_SIZE);
    const chunkElevations = await fetchElevationChunk(chunk.map(({ point }) => point));
    chunkElevations.forEach((elevation, elevationIndex) => {
      const request = chunk[elevationIndex];
      elevations[request.index] = elevation;
      if (typeof elevation === 'number') elevationCacheSet(request.cacheKey, elevation);
    });
  }

  return elevations;
};

const normalizeRequest = (payload) => {
  const radialSamples = Array.isArray(payload.radialSamples)
    ? payload.radialSamples.slice(0, MAX_SAMPLES).map((sample) => ({
      distanceKm: toNumber(sample.distanceKm),
      elevation: toNumber(sample.elevation),
    })).filter((sample) => sample.distanceKm > 0 && Number.isFinite(sample.elevation))
    : [];

  const distancesKm = Array.isArray(payload.distancesKm)
    ? payload.distancesKm.slice(0, MAX_DISTANCES).map((distanceKm) => toNumber(distanceKm)).filter((distanceKm) => distanceKm >= ITM_MIN_DISTANCE_KM)
    : [];

  return {
    frequencyMhz: clamp(toNumber(payload.frequencyMhz), 20, ITM_MAX_FREQ_MHZ),
    txHeightM: clamp(toNumber(payload.txHeightM, 10), 0.5, 3000),
    rxHeightM: clamp(toNumber(payload.rxHeightM, 1.5), 0.5, 3000),
    siteElevationM: toNumber(payload.siteElevationM),
    radialSamples,
    distancesKm,
    confidence: clamp(toNumber(payload.confidence, 50), 1, 99),
    reliability: clamp(toNumber(payload.reliability, 50), 1, 99),
    climate: clamp(Math.round(toNumber(payload.climate, 1)), 1, 7),
    polarization: clamp(Math.round(toNumber(payload.polarization, 1)), 0, 1),
    groundPermittivity: Math.max(1.1, toNumber(payload.groundPermittivity, 15)),
    groundConductivity: Math.max(0.0001, toNumber(payload.groundConductivity, 0.005)),
    surfaceRefractivity: clamp(toNumber(payload.surfaceRefractivity, 301), 250, 400),
  };
};

const normalizeRasterRequest = (payload) => {
  const site = payload.site ?? {};
  const thresholds = payload.thresholdsDbm ?? {};

  return {
    site: {
      lat: clamp(toNumber(site.lat), -85, 85),
      lon: clamp(toNumber(site.lon), -180, 180),
      elevationM: Number.isFinite(Number(site.elevationM)) ? Number(site.elevationM) : null,
    },
    frequencyMhz: clamp(toNumber(payload.frequencyMhz), 20, ITM_MAX_FREQ_MHZ),
    txHeightM: clamp(toNumber(payload.txHeightM, 10), 0.5, 3000),
    rxHeightM: clamp(toNumber(payload.rxHeightM, 1.5), 0.5, 3000),
    txPowerDbm: toNumber(payload.txPowerDbm, 37),
    txGainDbi: toNumber(payload.txGainDbi, 0),
    rxGainDbi: toNumber(payload.rxGainDbi, 0),
    systemLossDb: clamp(toNumber(payload.systemLossDb, 0), 0, 80),
    clutterLossDb: clamp(toNumber(payload.clutterLossDb, 0), 0, 80),
    rainRateMmH: clamp(toNumber(payload.rainRateMmH, 0), 0, 200),
    atmosphericLossDbPerKm: clamp(toNumber(payload.atmosphericLossDbPerKm, 0), 0, 2),
    useTwoRay: Boolean(payload.useTwoRay),
    maxRangeKm: clamp(toNumber(payload.maxRangeKm, 30), ITM_MIN_DISTANCE_KM, RASTER_MAX_RANGE_KM),
    cellSizeKm: clamp(toNumber(payload.cellSizeKm, RASTER_DEFAULT_CELL_KM), RASTER_MIN_CELL_KM, RASTER_MAX_CELL_KM),
    profileStepKm: clamp(toNumber(payload.profileStepKm, Number.isFinite(RASTER_PROFILE_STEP_KM) ? RASTER_PROFILE_STEP_KM : 2), 0.5, 10),
    confidence: clamp(toNumber(payload.confidence, 50), 1, 99),
    reliability: clamp(toNumber(payload.reliability, 50), 1, 99),
    climate: clamp(Math.round(toNumber(payload.climate, 1)), 1, 7),
    polarization: clamp(Math.round(toNumber(payload.polarization, 1)), 0, 1),
    groundPermittivity: Math.max(1.1, toNumber(payload.groundPermittivity, 15)),
    groundConductivity: Math.max(0.0001, toNumber(payload.groundConductivity, 0.005)),
    surfaceRefractivity: clamp(toNumber(payload.surfaceRefractivity, 301), 250, 400),
    thresholdsDbm: {
      strong: toNumber(thresholds.strong, -95),
      moderate: toNumber(thresholds.moderate, -105),
      weak: toNumber(thresholds.weak, -115),
    },
  };
};

const runNativeItm = (input) => new Promise((resolve, reject) => {
  const profile = [
    `0:${input.siteElevationM}`,
    ...input.radialSamples.map((sample) => `${sample.distanceKm}:${sample.elevation}`),
  ].join(',');
  const distances = input.distancesKm.join(',');

  const child = spawn(ITM_RUNNER, [
    '--frequency-mhz', String(input.frequencyMhz),
    '--tx-height-m', String(input.txHeightM),
    '--rx-height-m', String(input.rxHeightM),
    '--climate', String(input.climate),
    '--surface-refractivity', String(input.surfaceRefractivity),
    '--polarization', String(input.polarization),
    '--permittivity', String(input.groundPermittivity),
    '--conductivity', String(input.groundConductivity),
    '--confidence', String(input.confidence),
    '--reliability', String(input.reliability),
    '--profile', profile,
    '--distances-km', distances,
  ]);

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, 15000);

  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  child.on('close', (code) => {
    clearTimeout(timeoutId);
    if (timedOut) {
      reject(new Error('ITM runner timed out after 15s'));
      return;
    }
    if (code !== 0) {
      reject(new Error(stderr || `ITM runner exited with status ${code}`));
      return;
    }
    try {
      resolve(JSON.parse(stdout));
    } catch (error) {
      reject(new Error(`ITM runner produced invalid JSON: ${error.message}`));
    }
  });

  child.on('error', (error) => {
    clearTimeout(timeoutId);
    reject(error);
  });
});

const calculateRadial = async (input) => {
  if (nativeItmAvailable() && input.frequencyMhz <= ITM_MAX_FREQ_MHZ) {
    try {
      const nativeResult = await runNativeItm(input);
      return {
        engine: 'ntia-itm-native',
        nativeItm: true,
        losses: nativeResult.losses,
      };
    } catch (error) {
      console.warn('Native NTIA ITM failed; using fallback model:', error.message);
    }
  }

  return {
    engine: 'server-fallback-itm-style',
    nativeItm: false,
    losses: input.distancesKm.map((distanceKm) => ({
      distanceKm,
      lossDb: calculateFallbackItmStyleLoss({ ...input, distanceKm }),
      warnings: 0,
    })),
  };
};

const createRasterGrid = (input) => {
  const maxCells = Math.max(1, Math.round(toNumber(RASTER_MAX_CELLS, 5000)));
  const latStep = input.cellSizeKm / 111.32;
  const lonKmPerDegree = Math.max(20, 111.32 * Math.cos(degreesToRadians(input.site.lat)));
  const lonStep = input.cellSizeKm / lonKmPerDegree;
  const halfLat = latStep / 2;
  const halfLon = lonStep / 2;
  const gridRadius = Math.ceil(input.maxRangeKm / input.cellSizeKm);
  const cells = [];

  for (let latIndex = -gridRadius; latIndex <= gridRadius; latIndex += 1) {
    const lat = input.site.lat + latIndex * latStep;

    for (let lonIndex = -gridRadius; lonIndex <= gridRadius; lonIndex += 1) {
      const lon = input.site.lon + lonIndex * lonStep;
      const center = [lat, lon];
      const distanceKm = haversineDistanceKm([input.site.lat, input.site.lon], center);
      if (distanceKm > input.maxRangeKm || distanceKm < 0.05) continue;

      cells.push({
        id: `${latIndex}:${lonIndex}`,
        center,
        distanceKm,
        bearingDeg: calculateBearingDegrees([input.site.lat, input.site.lon], center),
        bounds: [
          [lat - halfLat, lon - halfLon],
          [lat - halfLat, lon + halfLon],
          [lat + halfLat, lon + halfLon],
          [lat + halfLat, lon - halfLon],
        ],
      });

      if (cells.length > maxCells) {
        throw new Error(`Raster request has ${cells.length} cells; increase cell size or lower range. Limit is ${maxCells}.`);
      }
    }
  }

  return cells;
};

const createPathSampleDistances = (distanceKm, profileStepKm) => {
  const sampleLimit = Math.max(1, Math.round(toNumber(RASTER_MAX_PROFILE_SAMPLES, 96)));
  const sampleCount = clamp(Math.ceil(distanceKm / profileStepKm), 1, sampleLimit);
  return Array.from({ length: sampleCount }, (_, index) => Number((distanceKm * (index + 1) / sampleCount).toFixed(3)));
};

const classifyRasterGrade = (rxDbm, thresholdsDbm) => {
  if (rxDbm >= thresholdsDbm.strong) return 'strong';
  if (rxDbm >= thresholdsDbm.moderate) return 'moderate';
  if (rxDbm >= thresholdsDbm.weak) return 'weak';
  return null;
};

const calculateRasterCell = async ({ cell, input, siteElevationM }) => {
  const sampleDistances = createPathSampleDistances(cell.distanceKm, input.profileStepKm);
  const samplePoints = sampleDistances.map((distanceKm) => (
    getDestinationPoint(input.site.lat, input.site.lon, cell.bearingDeg, distanceKm)
  ));
  const elevations = await fetchElevationBatch(samplePoints);
  let fallbackElevationSamples = 0;
  const radialSamples = sampleDistances.map((distanceKm, index) => {
    const elevation = elevations[index];
    if (typeof elevation !== 'number') fallbackElevationSamples += 1;
    return {
      distanceKm,
      elevation: typeof elevation === 'number' ? elevation : siteElevationM,
    };
  });

  const itmInput = {
    frequencyMhz: input.frequencyMhz,
    txHeightM: input.txHeightM,
    rxHeightM: input.rxHeightM,
    siteElevationM,
    radialSamples,
    distancesKm: [Math.max(ITM_MIN_DISTANCE_KM, Number(cell.distanceKm.toFixed(3)))],
    confidence: input.confidence,
    reliability: input.reliability,
    climate: input.climate,
    polarization: input.polarization,
    groundPermittivity: input.groundPermittivity,
    groundConductivity: input.groundConductivity,
    surfaceRefractivity: input.surfaceRefractivity,
  };

  const result = cell.distanceKm >= ITM_MIN_DISTANCE_KM
    ? await calculateRadial(itmInput)
    : {
      engine: 'server-fallback-itm-style',
      nativeItm: false,
      losses: [{
        distanceKm: cell.distanceKm,
        lossDb: calculateFallbackItmStyleLoss({ ...itmInput, distanceKm: cell.distanceKm }),
        warnings: 0,
      }],
    };
  const loss = result.losses?.[0];
  const itmLossDb = toNumber(loss?.lossDb, calculateFallbackItmStyleLoss({ ...itmInput, distanceKm: cell.distanceKm }));
  const externalLossDb = input.clutterLossDb +
    calculateShfRainLoss(input.frequencyMhz, cell.distanceKm, input.rainRateMmH) +
    calculateAtmosphericLoss(input.frequencyMhz, cell.distanceKm, input.atmosphericLossDbPerKm) +
    (input.useTwoRay ? calculateTwoRayLoss({
      freq: input.frequencyMhz,
      distanceKm: cell.distanceKm,
      hTx: input.txHeightM,
      hRx: input.rxHeightM,
    }) : 0);
  const pathLossDb = itmLossDb + externalLossDb;
  const rxDbm = input.txPowerDbm +
    input.txGainDbi +
    input.rxGainDbi -
    input.systemLossDb -
    pathLossDb;
  const gradeKey = classifyRasterGrade(rxDbm, input.thresholdsDbm);

  if (!gradeKey) {
    return {
      covered: false,
      engine: result.engine,
      nativeItm: result.nativeItm,
      fallbackElevationSamples,
      warnings: Number(loss?.warnings ?? 0),
      errorCode: Number(loss?.errorCode ?? 0),
    };
  }

  return {
    covered: true,
    cell: {
      id: cell.id,
      gradeKey,
      center: [Number(cell.center[0].toFixed(6)), Number(cell.center[1].toFixed(6))],
      bounds: cell.bounds.map(([lat, lon]) => [Number(lat.toFixed(6)), Number(lon.toFixed(6))]),
      distanceKm: Number(cell.distanceKm.toFixed(3)),
      bearingDeg: Number(cell.bearingDeg.toFixed(2)),
      lossDb: Number(pathLossDb.toFixed(2)),
      itmLossDb: Number(itmLossDb.toFixed(2)),
      rxDbm: Number(rxDbm.toFixed(2)),
      engine: result.engine,
      nativeItm: result.nativeItm,
      warnings: Number(loss?.warnings ?? 0),
      errorCode: Number(loss?.errorCode ?? 0),
    },
    engine: result.engine,
    nativeItm: result.nativeItm,
    fallbackElevationSamples,
    warnings: Number(loss?.warnings ?? 0),
    errorCode: Number(loss?.errorCode ?? 0),
  };
};

const calculateRasterCoverage = async (input) => {
  const siteElevationM = input.site.elevationM ?? (await fetchElevationBatch([[input.site.lat, input.site.lon]]))[0] ?? 0;
  const candidateCells = createRasterGrid(input);
  const cells = [];
  const stats = {
    testedCells: candidateCells.length,
    coveredCells: 0,
    fallbackElevationSamples: 0,
    warningSamples: 0,
    errorSamples: 0,
    fallbackCells: 0,
  };
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < candidateCells.length) {
      const cell = candidateCells[nextIndex];
      nextIndex += 1;
      const result = await calculateRasterCell({ cell, input, siteElevationM });
      stats.fallbackElevationSamples += result.fallbackElevationSamples;
      if (result.warnings > 0) stats.warningSamples += 1;
      if (result.errorCode !== 0) stats.errorSamples += 1;
      if (result.nativeItm === false) stats.fallbackCells += 1;

      if (result.covered) {
        stats.coveredCells += 1;
        cells.push(result.cell);
      }
    }
  };

  const workerCount = clamp(Math.round(toNumber(RASTER_WORKERS, 2)), 1, 8);
  await Promise.all(Array.from({ length: Math.min(workerCount, candidateCells.length) }, () => worker()));

  const cellAreaKm2 = input.cellSizeKm ** 2;
  const gradeCounts = {
    strong: cells.filter((cell) => cell.gradeKey === 'strong').length,
    moderate: cells.filter((cell) => cell.gradeKey === 'moderate').length,
    weak: cells.filter((cell) => cell.gradeKey === 'weak').length,
  };
  const areas = {
    strong: gradeCounts.strong * cellAreaKm2,
    moderate: (gradeCounts.strong + gradeCounts.moderate) * cellAreaKm2,
    weak: (gradeCounts.strong + gradeCounts.moderate + gradeCounts.weak) * cellAreaKm2,
  };

  return {
    engine: nativeItmAvailable() ? 'ntia-itm-native-per-cell-raster' : 'server-fallback-per-cell-raster',
    nativeItm: nativeItmAvailable(),
    siteElevationM,
    cellSizeKm: input.cellSizeKm,
    profileStepKm: input.profileStepKm,
    thresholdsDbm: input.thresholdsDbm,
    areas,
    gradeCounts,
    cells,
    stats,
  };
};

const logRequest = (req, res, requestId, startTime) => {
  const duration = Date.now() - startTime;
  console.log(JSON.stringify({
    requestId,
    method: req.method,
    url: req.url,
    status: res.statusCode,
    durationMs: duration,
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress,
  }));
};

const server = http.createServer(async (req, res) => {
  const requestId = randomUUID().slice(0, 8);
  const startTime = Date.now();
  res.on('finish', () => logRequest(req, res, requestId, startTime));

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  if (!checkRateLimit(clientIp)) {
    sendJson(res, 429, { error: 'Rate limit exceeded. Please slow down.' });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/health')) {
    const isDeep = req.url.includes('deep=true');
    const baseResponse = {
      ok: true,
      service: '9m2pju-itm-api',
      engine: nativeItmAvailable() ? 'ntia-itm-native' : 'server-fallback-itm-style',
      nativeItm: nativeItmAvailable(),
      itmFrequencyLimitMhz: ITM_MAX_FREQ_MHZ,
      raster: {
        endpoint: '/coverage/raster',
        maxCells: Math.max(1, Math.round(toNumber(RASTER_MAX_CELLS, 5000))),
        maxRangeKm: RASTER_MAX_RANGE_KM,
        defaultCellKm: RASTER_DEFAULT_CELL_KM,
        elevationApi: Boolean(OPEN_ELEVATION_API_URL),
      },
    };

    if (!isDeep || !nativeItmAvailable()) {
      sendJson(res, 200, baseResponse);
      return;
    }

    try {
      const testResult = await runNativeItm({
        frequencyMhz: 145,
        txHeightM: 10,
        rxHeightM: 1.5,
        siteElevationM: 100,
        radialSamples: [{ distanceKm: 1, elevation: 100 }, { distanceKm: 5, elevation: 110 }],
        distancesKm: [1, 5],
        confidence: 50,
        reliability: 50,
        climate: 1,
        polarization: 1,
        groundPermittivity: 15,
        groundConductivity: 0.005,
        surfaceRefractivity: 301,
      });
      sendJson(res, 200, {
        ...baseResponse,
        deepCheck: {
          ok: true,
          testLoss: testResult.losses?.[0]?.lossDb,
          testWarnings: testResult.losses?.[0]?.warnings,
        },
      });
    } catch (error) {
      sendJson(res, 200, {
        ...baseResponse,
        deepCheck: { ok: false, error: error.message },
      });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/itm/radial') {
    try {
      const payload = JSON.parse(await readBody(req));
      const input = normalizeRequest(payload);
      if (!input.distancesKm.length) {
        sendJson(res, 400, { error: 'distancesKm must contain at least one distance greater than or equal to 1 km.' });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        ...(await calculateRadial(input)),
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/coverage/raster') {
    try {
      const payload = JSON.parse(await readBody(req));
      const input = normalizeRasterRequest(payload);
      const result = await calculateRasterCoverage(input);
      sendJson(res, 200, {
        ok: true,
        ...result,
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`9M2PJU ITM API listening on ${PORT}`);
});
