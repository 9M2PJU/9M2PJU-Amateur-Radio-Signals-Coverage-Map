import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, Popup, Polygon, LayersControl, ZoomControl, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Radio, Activity, Layers, Zap, Mountain, BarChart3, Plus, Trash2, Antenna, Info, X, Upload, Download, FileText } from 'lucide-react';
import L from 'leaflet';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

const SITE_COLORS = ['#00a3ff', '#b450ff', '#00b894', '#ff7a45'];
const GRADE_CONFIG = [
  { key: 'weak', label: 'Fringe', color: '#ff4444', fillOpacity: 0.08, weight: 1, dashArray: '3, 3' },
  { key: 'moderate', label: 'Moderate', color: '#ffc107', fillOpacity: 0.16, weight: 1 },
  { key: 'strong', label: 'Strong', color: '#4dbd74', fillOpacity: 0.28, weight: 2 },
];
const MODE_PROFILES = {
  fm: {
    label: 'FM Voice',
    defaultFreq: 145,
    defaultBandwidth: 12500,
    defaultRequiredSnr: 12,
    thresholds: { strong: -93, moderate: -105, weak: -115 },
    note: 'Analog voice planning thresholds',
  },
  packet: {
    label: 'APRS / Packet',
    defaultFreq: 144.39,
    defaultBandwidth: 12500,
    defaultRequiredSnr: 10,
    thresholds: { strong: -100, moderate: -108, weak: -116 },
    note: '1200 baud AFSK-style packet planning',
  },
  ssb: {
    label: 'SSB / Weak Signal',
    defaultFreq: 144.2,
    defaultBandwidth: 3000,
    defaultRequiredSnr: 6,
    thresholds: { strong: -105, moderate: -115, weak: -123 },
    note: 'Weak-signal receiver sensitivity profile',
  },
  loraSf7: {
    label: 'LoRa SF7 125k',
    defaultFreq: 433,
    defaultBandwidth: 125000,
    defaultRequiredSnr: -7,
    thresholds: { strong: -103, moderate: -113, weak: -123 },
    note: 'LoRa short airtime, lower sensitivity',
  },
  loraSf9: {
    label: 'LoRa SF9 125k',
    defaultFreq: 433,
    defaultBandwidth: 125000,
    defaultRequiredSnr: -12,
    thresholds: { strong: -109, moderate: -119, weak: -129 },
    note: 'Balanced LoRa link profile',
  },
  loraSf12: {
    label: 'LoRa SF12 125k',
    defaultFreq: 433,
    defaultBandwidth: 125000,
    defaultRequiredSnr: -20,
    thresholds: { strong: -117, moderate: -127, weak: -137 },
    note: 'LoRa longest-range sensitivity profile',
  },
};
const MODE_OPTIONS = Object.entries(MODE_PROFILES).map(([key, profile]) => ({ key, ...profile }));
const PROPAGATION_MODELS = {
  enhancedHata: {
    label: 'Enhanced Hata + terrain',
    note: 'Fast planning model with Hata-style loss and terrain diffraction.',
  },
  itmHybrid: {
    label: 'ITM-style hybrid',
    note: 'Adds terrain roughness, horizon, and free-space checks inspired by Longley-Rice/ITM behavior.',
  },
  ntiaItmApi: {
    label: 'ITS Irregular Terrain Model (ITM)',
    note: 'Uses the 9M2PJU ITS Irregular Terrain Model / Longley-Rice service with local fallback if the service is unavailable.',
  },
};
const PROPAGATION_MODEL_OPTIONS = Object.entries(PROPAGATION_MODELS).map(([key, model]) => ({ key, ...model }));
const CLUTTER_PROFILES = {
  open: { label: 'Open / rural', lossDb: 0, uncertaintyDb: 6 },
  suburban: { label: 'Suburban', lossDb: 6, uncertaintyDb: 8 },
  forest: { label: 'Forest / foliage', lossDb: 12, uncertaintyDb: 10 },
  urban: { label: 'Dense urban', lossDb: 18, uncertaintyDb: 12 },
};
const CLUTTER_OPTIONS = Object.entries(CLUTTER_PROFILES).map(([key, profile]) => ({ key, ...profile }));
const DEFAULT_SHF_RAIN_RATE_MM_H = 25;
const DEFAULT_ATMOSPHERIC_LOSS_DB_PER_KM = 0.01;
const CLUTTER_MAP_SAMPLE_KM = 2;
const UNION_AREA_GRID_CELLS = 96;
const BANDWIDTH_OPTIONS = [
  { label: '12.5 kHz narrow FM', value: 12500 },
  { label: '25 kHz FM', value: 25000 },
  { label: '3 kHz SSB', value: 3000 },
  { label: '125 kHz LoRa', value: 125000 },
];
const BAND_OPTIONS = [
  { key: 'vhf', label: 'VHF', rangeLabel: '30-300 MHz', defaultFreq: 144, min: 30, max: 300 },
  { key: 'uhf', label: 'UHF', rangeLabel: '300-3000 MHz', defaultFreq: 430, min: 300, max: 3000 },
  { key: 'shf', label: 'SHF', rangeLabel: '3-30 GHz', defaultFreq: 5600, min: 3000, max: 30000 },
];
const MAP_LAYERS = [
  {
    name: 'OpenStreetMap Standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    checked: true,
  },
  {
    name: 'OpenStreetMap Humanitarian',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles style by HOT',
  },
  {
    name: 'OpenTopoMap Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
  },
  {
    name: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    subdomains: '',
  },
  {
    name: 'Carto Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
];
const EMPTY_AREAS = { strong: 0, moderate: 0, weak: 0 };
const EMPTY_POLYGONS = { strong: null, moderate: null, weak: null };
const RADIALS_COUNT = 72;
const SAMPLING_INTERVALS_KM = [
  0.25,
  0.5,
  ...Array.from({ length: 120 }, (_, index) => index + 1),
];
const RELIABILITY_CHECK_DISTANCES_KM = [0.1, ...SAMPLING_INTERVALS_KM];
const HAAT_MIN_DISTANCE_KM = 3;
const HAAT_MAX_DISTANCE_KM = 16;
const TERRAIN_PROFILE_STEP_KM = 0.5;
const EFFECTIVE_EARTH_RADIUS_KM = 6371 * (4 / 3);
const MIN_FREQUENCY_MHZ = 30;
const MAX_FREQUENCY_MHZ = 30000;
const MAX_SITES = 4;
const MAP_MIN_ZOOM = 3;
const MAP_MAX_ZOOM = 19;
const WORLD_BOUNDS = [[-85, -180], [85, 180]];
const FALLBACK_TILE_URL = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"%3E%3Crect width="256" height="256" fill="%23d8eef8"/%3E%3Cpath d="M0 64h256M0 128h256M0 192h256M64 0v256M128 0v256M192 0v256" stroke="%23b5d2df" stroke-width="1" opacity=".55"/%3E%3C/svg%3E';
const ELEVATION_ENDPOINTS = [
  'https://elevation.hamradio.my/api/v1/lookup',
  'https://api.open-elevation.com/api/v1/lookup',
];
const ELEVATION_CHUNK_SIZE = 60;
const ELEVATION_TIMEOUT_MS = 12000;
const ELEVATION_RETRIES = 2;
const ELEVATION_CONCURRENCY = 4;
const PREDICTION_SEARCH_ITERATIONS = 18;
const ELEVATION_CACHE_STORAGE_KEY = '9m2pju-elevation-cache-v1';
const ELEVATION_CACHE_MAX_ENTRIES = 40000;
const ITM_API_URL = (import.meta.env.VITE_ITM_API_URL ?? 'https://itm.hamradio.my').replace(/\/$/, '');
const ITM_API_TIMEOUT_MS = 18000;
const ITM_API_DISTANCE_STEP_KM = 0.5;
const ITM_API_MAX_FREQUENCY_MHZ = 20000;

const loadElevationCache = () => {
  if (typeof window === 'undefined') return new Map();
  try {
    const rawCache = window.localStorage.getItem(ELEVATION_CACHE_STORAGE_KEY);
    const entries = rawCache ? JSON.parse(rawCache) : [];
    return new Map(Array.isArray(entries) ? entries : []);
  } catch {
    return new Map();
  }
};

const elevationCache = loadElevationCache();
let elevationCacheWriteTimer = null;

const normalizeCoordinate = (value) => Number(value).toFixed(5);
const getElevationCacheKey = ([lat, lon]) => `${normalizeCoordinate(lat)},${normalizeCoordinate(lon)}`;
const getTerrainProfileCacheKey = ([lat, lon]) => [
  normalizeCoordinate(lat),
  normalizeCoordinate(lon),
  RADIALS_COUNT,
  SAMPLING_INTERVALS_KM.join('-'),
].join('|');

const persistElevationCache = () => {
  if (typeof window === 'undefined') return;
  window.clearTimeout(elevationCacheWriteTimer);
  elevationCacheWriteTimer = window.setTimeout(() => {
    const entries = Array.from(elevationCache.entries()).slice(-ELEVATION_CACHE_MAX_ENTRIES);
    try {
      window.localStorage.setItem(ELEVATION_CACHE_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Cache persistence is best-effort; prediction should still run if storage is full.
    }
  }, 300);
};

const createSite = (id, position, color) => ({
  id,
  name: `Site ${id}`,
  position,
  color,
  elevation: 0,
  haat: 30,
  status: 'pending',
  coveragePolygons: { ...EMPTY_POLYGONS },
  areas: { ...EMPTY_AREAS },
});

const getDestinationPoint = (lat, lon, brng, dist) => {
  const R = 6371;
  const ad = dist / R;
  const la1 = lat * Math.PI / 180;
  const lo1 = lon * Math.PI / 180;
  const b = brng * Math.PI / 180;

  const la2 = Math.asin(Math.sin(la1) * Math.cos(ad) + Math.cos(la1) * Math.sin(ad) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(ad) * Math.cos(la1), Math.cos(ad) - Math.sin(la1) * Math.sin(la2));

  return [la2 * 180 / Math.PI, lo2 * 180 / Math.PI];
};

const calculateAreaKm2 = (points) => {
  if (!points || points.length < 3) return 0;
  let area = 0;
  const R = 6371;
  const lat0 = points[0][0] * Math.PI / 180;
  const projected = points.map(([pointLat, pointLon]) => {
    const lat = pointLat * Math.PI / 180;
    const lon = pointLon * Math.PI / 180;
    return [R * lon * Math.cos(lat0), R * lat];
  });

  for (let i = 0; i < projected.length; i++) {
    const j = (i + 1) % projected.length;
    area += projected[i][0] * projected[j][1];
    area -= projected[j][0] * projected[i][1];
  }
  return Math.abs(area) / 2;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const formatPower = (value) => (value < 10 ? value.toFixed(1).replace(/\.0$/, '') : value.toFixed(0));
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const thermalNoiseDbm = (bandwidthHz, noiseFigureDb) => -174 + 10 * Math.log10(Math.max(1, bandwidthHz)) + noiseFigureDb;
const calculateNoiseLimitedThreshold = (bandwidthHz, noiseFigureDb, requiredSnrDb) => (
  thermalNoiseDbm(bandwidthHz, noiseFigureDb) + requiredSnrDb
);

const haversineDistanceKm = ([lat1, lon1], [lat2, lon2]) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const calculateBearingDegrees = ([lat1, lon1], [lat2, lon2]) => {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLon);

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

const normalizeBearingDelta = (bearing, centerBearing) => {
  const delta = Math.abs(((bearing - centerBearing + 540) % 360) - 180);
  return delta;
};

const calculateAntennaPatternLoss = (bearing, antennaAzimuth, antennaBeamwidth, frontBackRatio) => {
  if (antennaBeamwidth >= 360 || frontBackRatio <= 0) return 0;
  const halfBeamwidth = Math.max(1, antennaBeamwidth / 2);
  const delta = normalizeBearingDelta(bearing, antennaAzimuth);
  if (delta <= halfBeamwidth) return 0;

  const rearStart = 180 - halfBeamwidth;
  if (delta >= rearStart) return frontBackRatio;
  return clamp(((delta - halfBeamwidth) / Math.max(1, rearStart - halfBeamwidth)) * frontBackRatio, 0, frontBackRatio);
};

const interpolateAntennaPatternLoss = (bearing, antennaPattern) => {
  if (!antennaPattern?.points?.length) return null;
  const normalizedBearing = ((bearing % 360) + 360) % 360;
  const points = antennaPattern.points;
  const extendedPoints = [...points, { ...points[0], angle: points[0].angle + 360 }];

  for (let index = 1; index < extendedPoints.length; index++) {
    const previous = extendedPoints[index - 1];
    const next = extendedPoints[index];
    const targetBearing = normalizedBearing < points[0].angle ? normalizedBearing + 360 : normalizedBearing;
    if (targetBearing > next.angle) continue;

    const ratio = (targetBearing - previous.angle) / Math.max(1e-9, next.angle - previous.angle);
    return previous.lossDb + (next.lossDb - previous.lossDb) * clamp(ratio, 0, 1);
  }

  return points[points.length - 1].lossDb;
};

const getAntennaPatternLoss = ({ bearing, antennaAzimuth, antennaBeamwidth, frontBackRatio, antennaPattern }) => {
  const patternLoss = interpolateAntennaPatternLoss(normalizeBearingDelta(bearing, antennaAzimuth), antennaPattern);
  if (typeof patternLoss === 'number') return patternLoss;
  return calculateAntennaPatternLoss(bearing, antennaAzimuth, antennaBeamwidth, frontBackRatio);
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

const calculateShfRainLoss = (freq, distanceKm, rainRateMmH) => {
  if (freq < 3000 || rainRateMmH <= 0 || distanceKm <= 0) return 0;
  const freqGhz = freq / 1000;
  const k = clamp(0.00012 * (freqGhz ** 1.35), 0, 2.5);
  const alpha = clamp(0.82 + 0.03 * Math.log10(Math.max(1, freqGhz)), 0.75, 1.15);
  const effectiveDistanceKm = distanceKm / (1 + distanceKm / 35);
  return clamp(k * (rainRateMmH ** alpha) * effectiveDistanceKm, 0, 45);
};

const calculateAtmosphericLoss = (freq, distanceKm, atmosphericLossDbPerKm) => {
  if (freq < 3000 || distanceKm <= 0) return 0;
  const freqGhz = freq / 1000;
  const oxygenWaterLossDbPerKm = atmosphericLossDbPerKm + (
    freqGhz > 10 ? (freqGhz - 10) * 0.002 : 0
  );
  return clamp(oxygenWaterLossDbPerKm * distanceKm, 0, 20);
};

const calculatePathLoss = (freq, effectiveHTx, hRx, distanceKm) => {
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

const calculateTerrainRoughness = (radialSamples, siteElevation) => {
  if (!radialSamples.length) return 0;
  const elevations = radialSamples.map((sample) => sample.elevation);
  const average = elevations.reduce((total, elevation) => total + elevation, 0) / elevations.length;
  const variance = elevations.reduce((total, elevation) => total + ((elevation - average) ** 2), 0) / elevations.length;
  const slope = Math.max(...elevations) - Math.min(...elevations);
  const siteDelta = Math.max(0, average - siteElevation);
  return Math.sqrt(variance) * 0.18 + slope * 0.035 + siteDelta * 0.05;
};

const calculateItmStylePathLoss = ({ freq, effectiveHTx, hRx, distanceKm, radialSamples, siteElevation }) => {
  const fspl = calculateFreeSpacePathLoss(freq, distanceKm);
  const hata = calculatePathLoss(freq, effectiveHTx, hRx, distanceKm);
  const roughnessLoss = clamp(calculateTerrainRoughness(radialSamples, siteElevation), 0, 24);
  const radioHorizonKm = 4.12 * (Math.sqrt(Math.max(1, effectiveHTx)) + Math.sqrt(Math.max(1, hRx)));
  const horizonLoss = distanceKm > radioHorizonKm ? clamp((distanceKm - radioHorizonKm) * 0.38, 0, 28) : 0;
  const transitionWeight = clamp((distanceKm - 8) / 40, 0, 1);

  return Math.max(fspl + roughnessLoss + horizonLoss, (hata * (1 - transitionWeight)) + ((fspl + roughnessLoss + horizonLoss) * transitionWeight));
};

const calculateModeThreshold = (gradeThresholdDbm, bandwidthHz, noiseFigureDb, requiredSnrDb) => (
  Math.max(gradeThresholdDbm, calculateNoiseLimitedThreshold(bandwidthHz, noiseFigureDb, requiredSnrDb))
);

const getModelReliability = ({ freq, hTx, hRx, propagationModel, fadeMargin }) => {
  const notes = [];
  let penalty = 0;

  if (freq < 150) {
    penalty += 16;
    notes.push('Low VHF uses an extrapolated terrain-aware model; field validation is strongly recommended.');
  } else if (freq <= 1500) {
    notes.push('Best range for the Hata-style outdoor VHF/UHF estimate.');
  } else if (freq <= 2000) {
    penalty += 6;
    notes.push('Uses COST-231-style high-UHF extension; validate locally when possible.');
  } else if (freq <= 3000) {
    penalty += 12;
    notes.push('High-UHF prediction is extrapolated; terrain and local clutter dominate accuracy.');
  } else {
    penalty += 18;
    notes.push('SHF/microwave prediction is line-of-sight planning; rain, foliage, buildings, and antenna alignment can dominate.');
  }

  if (hTx < 30 && freq <= 3000) {
    penalty += 8;
    notes.push('TX antenna height is below the normal Hata/COST-Hata macro-cell range.');
  }

  if (hRx > 10 && freq <= 3000) {
    penalty += 4;
    notes.push('RX height is above the normal mobile-station range for Hata-style formulas.');
  }

  if (fadeMargin < 6) {
    penalty += 6;
    notes.push('Fade margin below 6 dB may be optimistic for real field use.');
  }

  if (propagationModel === 'itmHybrid') {
    notes.push('ITM-style hybrid is conservative, but not a full Longley-Rice implementation.');
  }

  if (propagationModel === 'ntiaItmApi') {
    if (freq > ITM_API_MAX_FREQUENCY_MHZ) {
      penalty += 14;
      notes.push('NTIA ITM supports paths up to 20 GHz; higher SHF predictions fall back to local SHF planning.');
    } else {
      notes.push('ITS Irregular Terrain Model (ITM) / Longley-Rice is active when the service is reachable.');
    }
  }

  return {
    penalty,
    label: penalty <= 8 ? 'High' : penalty <= 22 ? 'Moderate' : 'Planning only',
    notes,
  };
};

const getElevationAtDistance = (radialSamples, distanceKm, fallbackElevation) => {
  if (!radialSamples.length || distanceKm <= 0) return fallbackElevation;

  const firstSample = radialSamples[0];
  if (distanceKm <= firstSample.distanceKm) {
    const ratio = clamp(distanceKm / firstSample.distanceKm, 0, 1);
    return fallbackElevation + (firstSample.elevation - fallbackElevation) * ratio;
  }

  for (let index = 1; index < radialSamples.length; index++) {
    const previous = radialSamples[index - 1];
    const next = radialSamples[index];
    if (distanceKm > next.distanceKm) continue;

    const ratio = (distanceKm - previous.distanceKm) / (next.distanceKm - previous.distanceKm);
    return previous.elevation + (next.elevation - previous.elevation) * clamp(ratio, 0, 1);
  }

  return radialSamples[radialSamples.length - 1].elevation;
};

const getTerrainCheckDistances = (radialSamples, radiusKm) => {
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

const calculateTerrainPenalty = (radialSamples, radiusKm, siteElevation, hTx, hRx, freq) => {
  const wavelength = 300 / freq;
  const txAmsl = siteElevation + hTx;
  const rxGround = getElevationAtDistance(radialSamples, radiusKm, siteElevation);
  const rxAmsl = rxGround + hRx;

  let maxDiffractionLoss = 0;
  let shadowedSamples = 0;

  getTerrainCheckDistances(radialSamples, radiusKm).forEach((distanceKm) => {
    const pathFraction = distanceKm / radiusKm;
    const lineOfSightHeight = txAmsl + (rxAmsl - txAmsl) * pathFraction;
    const firstFresnelRadius = 548 * Math.sqrt((distanceKm * (radiusKm - distanceKm)) / (freq * radiusKm));
    const earthBulge = (distanceKm * (radiusKm - distanceKm) * 1000) / (2 * EFFECTIVE_EARTH_RADIUS_KM);
    const terrainElevation = getElevationAtDistance(radialSamples, distanceKm, siteElevation);
    const clearanceDeficit = (terrainElevation + earthBulge) - (lineOfSightHeight - 0.6 * firstFresnelRadius);

    if (clearanceDeficit <= 0) return;

    shadowedSamples += 1;
    const d1 = Math.max(1, distanceKm * 1000);
    const d2 = Math.max(1, (radiusKm - distanceKm) * 1000);
    const v = clearanceDeficit * Math.sqrt((2 * (d1 + d2)) / (wavelength * d1 * d2));
    const diffractionLoss = v <= -0.78 ? 0 : 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
    maxDiffractionLoss = Math.max(maxDiffractionLoss, diffractionLoss);
  });

  if (shadowedSamples === 0) return 0;

  return clamp(maxDiffractionLoss + shadowedSamples * 1.5, 0, 38);
};

const calculateModelPathLoss = ({ modelKey, freq, effectiveHTx, hRx, distanceKm, radialSamples, siteElevation }) => {
  if (modelKey === 'itmHybrid' || modelKey === 'ntiaItmApi') {
    return calculateItmStylePathLoss({ freq, effectiveHTx, hRx, distanceKm, radialSamples, siteElevation });
  }

  return calculatePathLoss(freq, effectiveHTx, hRx, distanceKm);
};

const calculateEffectiveTxHeight = (siteElevation, hTx, radialSamples) => {
  if (!radialSamples.length) return clamp(hTx, 2, 300);
  const haatSamples = radialSamples.filter((sample) => (
    sample.distanceKm >= HAAT_MIN_DISTANCE_KM && sample.distanceKm <= HAAT_MAX_DISTANCE_KM
  ));
  const terrainSamples = haatSamples.length ? haatSamples : radialSamples;
  const avgElevation = terrainSamples.reduce((total, sample) => total + sample.elevation, 0) / terrainSamples.length;
  const haat = (siteElevation + hTx) - avgElevation;
  return clamp(Math.max(hTx, haat), 2, 300);
};

const calculateRadialHaat = (siteElevation, hTx, radialSamples) => {
  const haatSamples = radialSamples.filter((sample) => (
    sample.distanceKm >= HAAT_MIN_DISTANCE_KM && sample.distanceKm <= HAAT_MAX_DISTANCE_KM
  ));
  const terrainSamples = haatSamples.length ? haatSamples : radialSamples;
  if (!terrainSamples.length) return hTx;
  const avgElevation = terrainSamples.reduce((total, sample) => total + sample.elevation, 0) / terrainSamples.length;
  return (siteElevation + hTx) - avgElevation;
};

const calculateMappedClutterLoss = ({ sitePosition, bearing, distanceKm, clutterMap }) => {
  if (!clutterMap?.features?.length || distanceKm <= 0) return 0;
  let sampledLoss = 0;
  let samples = 0;

  for (let sampleKm = CLUTTER_MAP_SAMPLE_KM; sampleKm < distanceKm; sampleKm += CLUTTER_MAP_SAMPLE_KM) {
    const point = getDestinationPoint(sitePosition[0], sitePosition[1], bearing, sampleKm);
    const featureLoss = clutterMap.features.reduce((loss, feature) => (
      feature.lossDb > loss && pointInGeoJsonFeature(point, feature) ? feature.lossDb : loss
    ), 0);
    if (featureLoss > 0) {
      sampledLoss += featureLoss;
      samples += 1;
    }
  }

  if (samples === 0) return 0;
  return clamp((sampledLoss / samples) * clamp(distanceKm / 20, 0.25, 1), 0, 24);
};

const calculateTotalPathLoss = ({
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
  sitePosition,
  bearing,
  clutterMap,
  rainRateMmH,
  atmosphericLossDbPerKm,
}) => {
  const cacheKey = distanceKm.toFixed(3);
  let terrainPenalty = terrainPenaltyCache?.get(cacheKey);

  if (typeof terrainPenalty !== 'number') {
    terrainPenalty = calculateTerrainPenalty(radialSamples, distanceKm, siteElevation, hTx, hRx, freq);
    terrainPenaltyCache?.set(cacheKey, terrainPenalty);
  }

  return calculateModelPathLoss({ modelKey, freq, effectiveHTx, hRx, distanceKm, radialSamples, siteElevation }) +
    terrainPenalty +
    clutterLossDb +
    calculateMappedClutterLoss({ sitePosition, bearing, distanceKm, clutterMap }) +
    calculateShfRainLoss(freq, distanceKm, rainRateMmH) +
    calculateAtmosphericLoss(freq, distanceKm, atmosphericLossDbPerKm);
};

const findReliableDistance = ({
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
  sitePosition,
  bearing,
  clutterMap,
  rainRateMmH,
  atmosphericLossDbPerKm,
}) => {
  let low = RELIABILITY_CHECK_DISTANCES_KM[0];
  let high = SAMPLING_INTERVALS_KM[SAMPLING_INTERVALS_KM.length - 1];

  if (calculateTotalPathLoss({
    modelKey,
    freq,
    effectiveHTx,
    hTx,
    hRx,
    distanceKm: low,
    radialSamples,
    siteElevation,
    clutterLossDb,
    terrainPenaltyCache,
    sitePosition,
    bearing,
    clutterMap,
    rainRateMmH,
    atmosphericLossDbPerKm,
  }) > targetLoss) {
    return low;
  }

  for (const distanceKm of RELIABILITY_CHECK_DISTANCES_KM.slice(1)) {
    const totalLoss = calculateTotalPathLoss({
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
      sitePosition,
      bearing,
      clutterMap,
      rainRateMmH,
      atmosphericLossDbPerKm,
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
      modelKey,
      freq,
      effectiveHTx,
      hTx,
      hRx,
      distanceKm: mid,
      radialSamples,
      siteElevation,
      clutterLossDb,
      terrainPenaltyCache,
      sitePosition,
      bearing,
      clutterMap,
      rainRateMmH,
      atmosphericLossDbPerKm,
    });

    if (totalLoss < targetLoss) low = mid;
    else high = mid;
  }

  return low;
};

const getPredictedSignalForMeasurement = ({
  measurement,
  site,
  terrainProfile,
  modelKey,
  freq,
  hTx,
  hRx,
  powerDbm,
  txGain,
  rxAntennaGain,
  systemLossDb,
  clutterLossDb,
  calibrationOffsetDb,
  antennaPattern,
  antennaAzimuth,
  antennaBeamwidth,
  frontBackRatio,
  clutterMap,
  rainRateMmH,
  atmosphericLossDbPerKm,
  serviceGrades,
  itmRadialLosses,
}) => {
  if (!terrainProfile?.radialSampleSets?.length) return null;

  const bearing = calculateBearingDegrees(site.position, measurement.position);
  const radialIndex = Math.round(bearing / (360 / RADIALS_COUNT)) % RADIALS_COUNT;
  const radialSamples = terrainProfile.radialSampleSets[radialIndex] ?? [];
  const distanceKm = haversineDistanceKm(site.position, measurement.position);
  const effectiveHTx = calculateEffectiveTxHeight(terrainProfile.siteElevation, hTx, radialSamples);
  const antennaPatternLoss = getAntennaPatternLoss({ bearing, antennaAzimuth, antennaBeamwidth, frontBackRatio, antennaPattern });
  const directionalGain = txGain - antennaPatternLoss;
  const itmPathLoss = modelKey === 'ntiaItmApi'
    ? getItmApiPathLoss(itmRadialLosses?.[radialIndex], distanceKm)
    : null;
  const pathLoss = typeof itmPathLoss === 'number'
    ? itmPathLoss + calculateExternalLosses({
      freq,
      distanceKm,
      clutterLossDb,
      sitePosition: site.position,
      bearing,
      clutterMap,
      rainRateMmH,
      atmosphericLossDbPerKm,
    })
    : calculateTotalPathLoss({
      modelKey,
      freq,
      effectiveHTx,
      hTx,
      hRx,
      distanceKm,
      radialSamples,
      siteElevation: terrainProfile.siteElevation,
      clutterLossDb,
      terrainPenaltyCache: new Map(),
      sitePosition: site.position,
      bearing,
      clutterMap,
      rainRateMmH,
      atmosphericLossDbPerKm,
    });
  const estimatedDbm = powerDbm + directionalGain + rxAntennaGain - systemLossDb - pathLoss + calibrationOffsetDb;
  const predictedGrade = [...serviceGrades]
    .sort((a, b) => b.thresholdDbm - a.thresholdDbm)
    .find((grade) => estimatedDbm >= grade.thresholdDbm)?.key ?? 'outside';

  return {
    siteId: site.id,
    siteName: site.name,
    gradeKey: predictedGrade,
    distanceKm,
    bearing,
    effectiveHTx,
    estimatedDbm,
    predictionEngine: typeof itmPathLoss === 'number' ? 'itm-api' : 'local-fallback',
  };
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = ELEVATION_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const createItmDistanceGrid = () => {
  const distances = new Set([0.1, 0.25, 0.5, 1]);
  for (let distanceKm = 1.5; distanceKm <= SAMPLING_INTERVALS_KM[SAMPLING_INTERVALS_KM.length - 1]; distanceKm += ITM_API_DISTANCE_STEP_KM) {
    distances.add(Number(distanceKm.toFixed(3)));
  }
  SAMPLING_INTERVALS_KM.forEach((distanceKm) => distances.add(distanceKm));
  return [...distances].sort((a, b) => a - b);
};

const fetchItmRadialLosses = async ({
  freq,
  hTx,
  hRx,
  siteElevation,
  radialSamples,
  distancesKm,
  confidence,
  reliability,
}) => {
  if (!ITM_API_URL || freq > ITM_API_MAX_FREQUENCY_MHZ) return null;

  const resp = await fetchWithTimeout(`${ITM_API_URL}/itm/radial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frequencyMhz: freq,
      txHeightM: hTx,
      rxHeightM: hRx,
      siteElevationM: siteElevation,
      radialSamples,
      distancesKm,
      confidence,
      reliability,
      climate: 1,
      polarization: 1,
      groundPermittivity: 15,
      groundConductivity: 0.005,
      surfaceRefractivity: 301,
    }),
  }, ITM_API_TIMEOUT_MS);

  if (!resp.ok) throw new Error(`ITM API failed: ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data.losses)) throw new Error('ITM API returned no loss array');
  return data;
};

const getItmApiPathLoss = (itmLossMap, distanceKm) => {
  if (!itmLossMap?.length) return null;
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

const calculateExternalLosses = ({
  freq,
  distanceKm,
  clutterLossDb,
  sitePosition,
  bearing,
  clutterMap,
  rainRateMmH,
  atmosphericLossDbPerKm,
}) => (
  clutterLossDb +
  calculateMappedClutterLoss({ sitePosition, bearing, distanceKm, clutterMap }) +
  calculateShfRainLoss(freq, distanceKm, rainRateMmH) +
  calculateAtmosphericLoss(freq, distanceKm, atmosphericLossDbPerKm)
);

const findReliableDistanceFromLossMap = ({
  itmLossMap,
  freq,
  targetLoss,
  clutterLossDb,
  sitePosition,
  bearing,
  clutterMap,
  rainRateMmH,
  atmosphericLossDbPerKm,
}) => {
  if (!itmLossMap?.length) return null;
  let lastPassing = itmLossMap[0].distanceKm;
  let lastLoss = itmLossMap[0].lossDb + calculateExternalLosses({
    freq,
    distanceKm: itmLossMap[0].distanceKm,
    clutterLossDb,
    sitePosition,
    bearing,
    clutterMap,
    rainRateMmH,
    atmosphericLossDbPerKm,
  });

  if (lastLoss > targetLoss) return lastPassing;

  for (let index = 1; index < itmLossMap.length; index++) {
    const sample = itmLossMap[index];
    const totalLoss = sample.lossDb + calculateExternalLosses({
      freq,
      distanceKm: sample.distanceKm,
      clutterLossDb,
      sitePosition,
      bearing,
      clutterMap,
      rainRateMmH,
      atmosphericLossDbPerKm,
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

const fetchElevationChunk = async (chunk) => {
  let lastError;

  for (const endpoint of ELEVATION_ENDPOINTS) {
    for (let attempt = 0; attempt <= ELEVATION_RETRIES; attempt++) {
      try {
        const resp = await fetchWithTimeout(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locations: chunk.map(([latitude, longitude]) => ({ latitude, longitude })),
          }),
        });

        if (!resp.ok) throw new Error(`Elevation lookup failed: ${resp.status}`);

        const data = await resp.json();
        const results = data.results ?? [];
        if (!Array.isArray(results) || results.length === 0) throw new Error('Elevation lookup returned no results');

        return {
          elevations: chunk.map((_, index) => results[index]?.elevation),
          failed: false,
        };
      } catch (error) {
        lastError = error;
        if (attempt < ELEVATION_RETRIES) {
          await delay(450 * (attempt + 1));
        }
      }
    }

    console.warn(`Elevation endpoint failed; trying next endpoint: ${endpoint}`, lastError?.message ?? lastError);
  }

  console.warn('All elevation endpoints failed; using fallback terrain for this chunk:', lastError?.message ?? lastError);
  return {
    elevations: chunk.map(() => undefined),
    failed: true,
  };
};

const fetchElevationBatch = async (points) => {
  const elevations = Array(points.length);
  const uncachedRequests = [];
  let failedChunks = 0;

  points.forEach((point, index) => {
    const cacheKey = getElevationCacheKey(point);
    const cachedElevation = elevationCache.get(cacheKey);

    if (typeof cachedElevation === 'number') {
      elevations[index] = cachedElevation;
      return;
    }

    uncachedRequests.push({ point, index, cacheKey });
  });

  const chunks = [];
  for (let start = 0; start < uncachedRequests.length; start += ELEVATION_CHUNK_SIZE) {
    chunks.push(uncachedRequests.slice(start, start + ELEVATION_CHUNK_SIZE));
  }

  let nextChunkIndex = 0;
  const runNextChunk = async () => {
    const chunkIndex = nextChunkIndex;
    nextChunkIndex += 1;
    const requestChunk = chunks[chunkIndex];
    if (!requestChunk) return;

    const result = await fetchElevationChunk(requestChunk.map(({ point }) => point));
    if (result.failed) failedChunks += 1;

    result.elevations.forEach((elevation, elevationIndex) => {
      const request = requestChunk[elevationIndex];
      elevations[request.index] = elevation;
      if (typeof elevation === 'number') {
        elevationCache.set(request.cacheKey, elevation);
      }
    });

    await runNextChunk();
  };

  if (chunks.length > 0) {
    const workers = Array.from(
      { length: Math.min(ELEVATION_CONCURRENCY, chunks.length) },
      () => runNextChunk(),
    );
    await Promise.all(workers);
    persistElevationCache();
  }

  return { elevations, failedChunks };
};

const pointInPolygon = ([lat, lon], polygon) => {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lonI] = polygon[i];
    const [latJ, lonJ] = polygon[j];
    const intersects = ((lonI > lon) !== (lonJ > lon)) &&
      (lat < ((latJ - latI) * (lon - lonI)) / ((lonJ - lonI) || 1e-9) + latI);
    if (intersects) inside = !inside;
  }

  return inside;
};

const pointInGeoJsonFeature = (position, feature) => {
  const geometry = feature?.geometry;
  if (!geometry) return false;

  const rings = geometry.type === 'Polygon'
    ? geometry.coordinates
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates.flat()
      : [];

  return rings.some((ring) => pointInPolygon(position, ring.map(([lon, lat]) => [lat, lon])));
};

const getPolygonBounds = (polygons) => {
  const points = polygons.flat().filter(Boolean);
  if (!points.length) return null;

  return points.reduce((bounds, [lat, lon]) => ({
    minLat: Math.min(bounds.minLat, lat),
    maxLat: Math.max(bounds.maxLat, lat),
    minLon: Math.min(bounds.minLon, lon),
    maxLon: Math.max(bounds.maxLon, lon),
  }), {
    minLat: points[0][0],
    maxLat: points[0][0],
    minLon: points[0][1],
    maxLon: points[0][1],
  });
};

const calculateUnionAreaKm2 = (polygons) => {
  const usablePolygons = polygons.filter((polygon) => polygon?.length >= 3);
  const bounds = getPolygonBounds(usablePolygons);
  if (!bounds) return 0;

  const latSpan = Math.max(0.0001, bounds.maxLat - bounds.minLat);
  const lonSpan = Math.max(0.0001, bounds.maxLon - bounds.minLon);
  const rows = UNION_AREA_GRID_CELLS;
  const cols = Math.max(12, Math.round(UNION_AREA_GRID_CELLS * lonSpan / latSpan));
  const cellLatKm = latSpan * 111.32 / rows;
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const cellLonKm = lonSpan * 111.32 * Math.cos(midLat * Math.PI / 180) / cols;
  let coveredCells = 0;

  for (let row = 0; row < rows; row++) {
    const lat = bounds.minLat + (row + 0.5) * latSpan / rows;
    for (let col = 0; col < cols; col++) {
      const lon = bounds.minLon + (col + 0.5) * lonSpan / cols;
      if (usablePolygons.some((polygon) => pointInPolygon([lat, lon], polygon))) {
        coveredCells += 1;
      }
    }
  }

  return coveredCells * cellLatKm * cellLonKm;
};

const calculateCombinedCoverageAreas = (sites) => ({
  strong: calculateUnionAreaKm2(sites.map((site) => site.coveragePolygons.strong)),
  moderate: calculateUnionAreaKm2(sites.map((site) => site.coveragePolygons.moderate)),
  weak: calculateUnionAreaKm2(sites.map((site) => site.coveragePolygons.weak)),
});

const parseAntennaPatternCsv = (text) => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const headers = lines[0].split(',').map((header) => header.trim().toLowerCase());
  const angleIndex = headers.findIndex((header) => ['angle', 'azimuth', 'bearing', 'deg', 'degrees'].includes(header));
  const lossIndex = headers.findIndex((header) => ['loss', 'lossdb', 'attenuation', 'attenuationdb', 'pattern_loss'].includes(header));
  const gainIndex = headers.findIndex((header) => ['gain', 'gaindb', 'gain_dbi', 'dbi'].includes(header));
  if (angleIndex < 0 || (lossIndex < 0 && gainIndex < 0)) return null;

  const rawPoints = lines.slice(1).map((line) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const angle = Number(cells[angleIndex]);
    const value = Number(cells[lossIndex >= 0 ? lossIndex : gainIndex]);
    if (!Number.isFinite(angle) || !Number.isFinite(value)) return null;
    return { angle: ((angle % 360) + 360) % 360, value };
  }).filter(Boolean);

  if (rawPoints.length < 2) return null;
  const maxGain = Math.max(...rawPoints.map((point) => point.value));
  const points = rawPoints
    .map((point) => ({
      angle: point.angle,
      lossDb: lossIndex >= 0 ? clamp(point.value, 0, 60) : clamp(maxGain - point.value, 0, 60),
    }))
    .sort((a, b) => a.angle - b.angle);

  return { points };
};

const parseClutterGeoJson = (text) => {
  const data = JSON.parse(text);
  const rawFeatures = data.type === 'FeatureCollection'
    ? data.features
    : data.type === 'Feature'
      ? [data]
      : [{ type: 'Feature', properties: {}, geometry: data }];

  const features = rawFeatures.map((feature) => {
    const lossDb = Number(
      feature.properties?.lossDb ??
      feature.properties?.loss_db ??
      feature.properties?.clutterLoss ??
      feature.properties?.rf_loss_db ??
      0,
    );
    return Number.isFinite(lossDb)
      ? { ...feature, lossDb: clamp(lossDb, 0, 40) }
      : null;
  }).filter((feature) => feature && ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type));

  return features.length ? { features } : null;
};

const parseCsvMeasurements = (text) => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((header) => header.trim().toLowerCase());
  const latIndex = headers.findIndex((header) => ['lat', 'latitude'].includes(header));
  const lonIndex = headers.findIndex((header) => ['lon', 'lng', 'longitude'].includes(header));
  const signalIndex = headers.findIndex((header) => ['rssi', 'signal', 'signal_dbm', 'dbm', 'rx_dbm'].includes(header));
  if (latIndex < 0 || lonIndex < 0 || signalIndex < 0) return [];

  return lines.slice(1).map((line, index) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const lat = Number(cells[latIndex]);
    const lon = Number(cells[lonIndex]);
    const measuredDbm = Number(cells[signalIndex]);
    if (![lat, lon, measuredDbm].every(Number.isFinite)) return null;
    return {
      id: `csv-${index}-${lat}-${lon}`,
      source: 'CSV',
      position: [lat, lon],
      measuredDbm,
    };
  }).filter(Boolean);
};

const parseGpxMeasurements = (text) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) return [];
  const points = Array.from(doc.querySelectorAll('trkpt, wpt'));

  return points.map((point, index) => {
    const lat = Number(point.getAttribute('lat'));
    const lon = Number(point.getAttribute('lon'));
    const signalNode = Array.from(point.querySelectorAll('*')).find((node) => (
      ['rssi', 'signal', 'signal_dbm', 'dbm', 'rx_dbm'].includes(node.localName.toLowerCase())
    ));
    const measuredDbm = Number(signalNode?.textContent);
    if (![lat, lon, measuredDbm].every(Number.isFinite)) return null;
    return {
      id: `gpx-${index}-${lat}-${lon}`,
      source: 'GPX',
      position: [lat, lon],
      measuredDbm,
    };
  }).filter(Boolean);
};

const summarizeErrors = (comparisons) => {
  const valid = comparisons.filter((item) => Number.isFinite(item.errorDb));
  if (!valid.length) {
    return { count: 0, meanError: 0, rmse: 0, medianAbsError: 0, within6Db: 0, within10Db: 0 };
  }

  const errors = valid.map((item) => item.errorDb);
  const absErrors = errors.map(Math.abs).sort((a, b) => a - b);
  const meanError = errors.reduce((total, error) => total + error, 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((total, error) => total + error ** 2, 0) / errors.length);
  const medianAbsError = absErrors[Math.floor(absErrors.length / 2)];

  return {
    count: valid.length,
    meanError,
    rmse,
    medianAbsError,
    within6Db: valid.filter((item) => Math.abs(item.errorDb) <= 6).length / valid.length * 100,
    within10Db: valid.filter((item) => Math.abs(item.errorDb) <= 10).length / valid.length * 100,
  };
};

function MapClickHandler({ onClick }) {
  useMapEvents({
    click: (e) => onClick([e.latlng.lat, e.latlng.lng]),
  });
  return null;
}

function App() {
  const [sites, setSites] = useState(() => [
    createSite(1, [3.1390, 101.6869], SITE_COLORS[0]),
  ]);
  const [activeSiteId, setActiveSiteId] = useState(1);
  const [power, setPower] = useState(5);
  const [freq, setFreq] = useState(145);
  const [hTx, setHTx] = useState(10);
  const [gain, setGain] = useState(6);
  const [hRx, setHRx] = useState(1.5);
  const [modeKey, setModeKey] = useState('fm');
  const [propagationModel, setPropagationModel] = useState('ntiaItmApi');
  const [clutterKey, setClutterKey] = useState('suburban');
  const [feedlineLoss, setFeedlineLoss] = useState(1);
  const [rxAntennaGain, setRxAntennaGain] = useState(0);
  const [noiseFigure, setNoiseFigure] = useState(6);
  const [requiredSnr, setRequiredSnr] = useState(12);
  const [receiverBandwidth, setReceiverBandwidth] = useState(12500);
  const [fadeMargin, setFadeMargin] = useState(10);
  const [antennaAzimuth, setAntennaAzimuth] = useState(0);
  const [antennaBeamwidth, setAntennaBeamwidth] = useState(360);
  const [frontBackRatio, setFrontBackRatio] = useState(0);
  const [antennaPattern, setAntennaPattern] = useState(null);
  const [patternNotice, setPatternNotice] = useState('Optional: import antenna pattern CSV with angle/lossDb or angle/gain_dBi.');
  const [clutterMap, setClutterMap] = useState(null);
  const [clutterMapNotice, setClutterMapNotice] = useState('Optional: import GeoJSON polygons with lossDb properties.');
  const [rainRate, setRainRate] = useState(DEFAULT_SHF_RAIN_RATE_MM_H);
  const [atmosphericLoss, setAtmosphericLoss] = useState(DEFAULT_ATMOSPHERIC_LOSS_DB_PER_KM);
  const [calibrationOffset, setCalibrationOffset] = useState(0);
  const [calibrationEnabled, setCalibrationEnabled] = useState(false);
  const [measurements, setMeasurements] = useState([]);
  const [measurementNotice, setMeasurementNotice] = useState('Import CSV or GPX measurements for validation.');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [freqBand, setFreqBand] = useState('vhf');
  const [nextSiteId, setNextSiteId] = useState(2);
  const [analysisNotice, setAnalysisNotice] = useState('Ready for coverage prediction.');
  const [itmApiStatus, setItmApiStatus] = useState({ state: 'unchecked', message: `ITS ITM service: ${ITM_API_URL}` });
  const isAnalyzingRef = useRef(false);
  const sitesRef = useRef(sites);
  const terrainProfileCacheRef = useRef(new Map());

  const activeSite = sites.find((site) => site.id === activeSiteId) ?? sites[0];
  const mapCenter = activeSite?.position ?? [3.1390, 101.6869];
  const activeSitePreviewId = activeSite?.id;
  const activeSiteLat = activeSite?.position[0];
  const activeSiteLon = activeSite?.position[1];
  const modeProfile = MODE_PROFILES[modeKey] ?? MODE_PROFILES.fm;
  const modelProfile = PROPAGATION_MODELS[propagationModel] ?? PROPAGATION_MODELS.enhancedHata;
  const clutterProfile = CLUTTER_PROFILES[clutterKey] ?? CLUTTER_PROFILES.suburban;
  const activeBand = BAND_OPTIONS.find((band) => band.key === freqBand) ?? BAND_OPTIONS[0];
  const serviceGrades = useMemo(() => GRADE_CONFIG.map((grade) => ({
    ...grade,
    thresholdDbm: calculateModeThreshold(modeProfile.thresholds[grade.key], receiverBandwidth, noiseFigure, requiredSnr),
  })), [modeProfile, noiseFigure, receiverBandwidth, requiredSnr]);
  const powerDbm = 10 * Math.log10(power * 1000);
  const combinedAreas = useMemo(() => calculateCombinedCoverageAreas(sites), [sites]);

  const analyzedSites = sites.filter((site) => site.coveragePolygons.weak).length;
  const systemLossDb = feedlineLoss + fadeMargin;
  const modelReliability = useMemo(() => getModelReliability({
    freq,
    hTx,
    hRx,
    propagationModel,
    fadeMargin,
  }), [fadeMargin, freq, hRx, hTx, propagationModel]);
  const confidenceScore = clamp(
    100 - clutterProfile.uncertaintyDb * 2 - fadeMargin * 0.7 - modelReliability.penalty - (propagationModel === 'ntiaItmApi' ? 2 : propagationModel === 'itmHybrid' ? 4 : 9),
    35,
    95,
  );
  const activeCalibrationOffset = calibrationEnabled ? calibrationOffset : 0;
  const validationReport = useMemo(() => {
    const comparisons = measurements.map((measurement) => {
      let bestMatch = null;

      sites.forEach((site) => {
        const terrainProfile = terrainProfileCacheRef.current.get(getTerrainProfileCacheKey(site.position));
        const predictedSignal = getPredictedSignalForMeasurement({
          measurement,
          site,
          terrainProfile,
          modelKey: propagationModel,
          freq,
          hTx,
          hRx,
          powerDbm,
          txGain: gain,
          rxAntennaGain,
          systemLossDb,
          clutterLossDb: clutterProfile.lossDb,
          calibrationOffsetDb: activeCalibrationOffset,
          antennaPattern,
          antennaAzimuth,
          antennaBeamwidth,
          frontBackRatio,
          clutterMap,
          rainRateMmH: rainRate,
          atmosphericLossDbPerKm: atmosphericLoss,
          serviceGrades,
          itmRadialLosses: site.itmRadialLosses,
        });

        if (predictedSignal) {
          if (!bestMatch || predictedSignal.estimatedDbm > bestMatch.estimatedDbm) {
            bestMatch = predictedSignal;
          }
          return;
        }

        const gradeKey = ['strong', 'moderate', 'weak'].find((key) => pointInPolygon(measurement.position, site.coveragePolygons[key]));
        if (gradeKey && !bestMatch) {
          const distanceKm = haversineDistanceKm(site.position, measurement.position);
          bestMatch = {
            siteId: site.id,
            siteName: site.name,
            gradeKey,
            distanceKm,
            estimatedDbm: serviceGrades.find((grade) => grade.key === gradeKey)?.thresholdDbm ?? modeProfile.thresholds.weak,
          };
        }
      });

      const estimatedDbm = bestMatch?.estimatedDbm ?? modeProfile.thresholds.weak - 12;
      return {
        ...measurement,
        predictedGrade: bestMatch?.gradeKey ?? 'outside',
        predictedSite: bestMatch?.siteName ?? 'No analyzed site',
        predictionEngine: bestMatch?.predictionEngine ?? 'polygon-threshold',
        estimatedDbm,
        distanceKm: bestMatch?.distanceKm,
        bearing: bestMatch?.bearing,
        errorDb: measurement.measuredDbm - estimatedDbm,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      model: PROPAGATION_MODELS[propagationModel]?.label ?? propagationModel,
      clutter: CLUTTER_PROFILES[clutterKey]?.label ?? clutterKey,
      assumptions: {
        propagationModel,
        clutterKey,
        feedlineLoss,
        rxAntennaGain,
        noiseFigure,
        requiredSnr,
        receiverBandwidth,
        fadeMargin,
        antennaAzimuth,
        antennaBeamwidth,
        frontBackRatio,
        confidenceScore,
        reliability: modelReliability.label,
        reliabilityNotes: modelReliability.notes,
        itmApiUrl: propagationModel === 'ntiaItmApi' ? ITM_API_URL : null,
        itmApiStatus: propagationModel === 'ntiaItmApi' ? itmApiStatus : null,
        calibrationEnabled,
        calibrationOffsetDb: activeCalibrationOffset,
        antennaPatternPoints: antennaPattern?.points?.length ?? 0,
        clutterMapFeatures: clutterMap?.features?.length ?? 0,
        rainRateMmH: rainRate,
        atmosphericLossDbPerKm: atmosphericLoss,
        radialCount: RADIALS_COUNT,
        terrainSamplesPerRadial: SAMPLING_INTERVALS_KM.length,
        terrainMaxDistanceKm: SAMPLING_INTERVALS_KM[SAMPLING_INTERVALS_KM.length - 1],
        sites: sites.map((site) => ({
          id: site.id,
          name: site.name,
          model: site.model,
          status: site.status,
          itmWarningSamples: site.itmWarningSamples ?? 0,
          itmErrorSamples: site.itmErrorSamples ?? 0,
        })),
      },
      summary: summarizeErrors(comparisons),
      comparisons,
    };
  }, [
    antennaAzimuth,
    antennaBeamwidth,
    activeCalibrationOffset,
    antennaPattern,
    atmosphericLoss,
    calibrationEnabled,
    clutterMap,
    clutterKey,
    confidenceScore,
    fadeMargin,
    feedlineLoss,
    frontBackRatio,
    freq,
    gain,
    hRx,
    hTx,
    measurements,
    modeProfile.thresholds.weak,
    modelReliability.label,
    modelReliability.notes,
    itmApiStatus,
    noiseFigure,
    powerDbm,
    propagationModel,
    rainRate,
    receiverBandwidth,
    requiredSnr,
    rxAntennaGain,
    serviceGrades,
    sites,
    systemLossDb,
    clutterProfile.lossDb,
  ]);

  useEffect(() => {
    sitesRef.current = sites;
  }, [sites]);

  useEffect(() => {
    let cancelled = false;
    fetchWithTimeout(`${ITM_API_URL}/health`, {}, 5000)
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((data) => {
        if (cancelled) return;
        setItmApiStatus({
          state: data.nativeItm ? 'ready' : 'fallback',
          message: data.nativeItm
            ? `ITS Irregular Terrain Model (ITM) ready (${data.engine}).`
            : `ITM API reachable, native engine unavailable (${data.engine}).`,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setItmApiStatus({ state: 'error', message: `ITM API unavailable: ${error.message}` });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setSites((currentSites) => currentSites.map((site) => (
            site.id === 1
              ? { ...site, position: [latitude, longitude], status: 'pending' }
              : site
          )));
        },
        (err) => {
          console.warn('Geolocation access denied or failed:', err.message);
        }
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!activeSitePreviewId || typeof activeSiteLat !== 'number' || typeof activeSiteLon !== 'number') return undefined;

    fetchElevationBatch([[activeSiteLat, activeSiteLon]])
      .then(({ elevations }) => {
        const elevation = elevations[0];
        if (cancelled || typeof elevation !== 'number') return;
        setSites((currentSites) => currentSites.map((currentSite) => (
          currentSite.id === activeSitePreviewId && currentSite.elevation !== elevation
            ? { ...currentSite, elevation }
            : currentSite
        )));
      })
      .catch((err) => console.warn('Elevation preview failed:', err.message));

    return () => {
      cancelled = true;
    };
  }, [activeSitePreviewId, activeSiteLat, activeSiteLon]);

  const updateActiveSitePosition = useCallback((position) => {
    setSites((currentSites) => currentSites.map((site) => (
      site.id === activeSiteId
        ? { ...site, position, status: 'pending', coveragePolygons: { ...EMPTY_POLYGONS }, areas: { ...EMPTY_AREAS } }
        : site
    )));
  }, [activeSiteId]);

  const addCoverageSite = useCallback(() => {
    if (sites.length >= MAX_SITES || !activeSite) return;

    const offset = 0.035 * sites.length;
    const newSite = createSite(
      nextSiteId,
      [activeSite.position[0] + offset, activeSite.position[1] + offset],
      SITE_COLORS[sites.length % SITE_COLORS.length],
    );

    setSites((currentSites) => [...currentSites, newSite]);
    setActiveSiteId(nextSiteId);
    setNextSiteId((id) => id + 1);
  }, [activeSite, nextSiteId, sites.length]);

  const removeActiveSite = useCallback(() => {
    if (sites.length <= 1) return;
    setSites((currentSites) => {
      const nextSites = currentSites.filter((site) => site.id !== activeSiteId);
      setActiveSiteId(nextSites[0].id);
      return nextSites;
    });
  }, [activeSiteId, sites.length]);

  const importMeasurements = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = file.name.toLowerCase().endsWith('.gpx')
        ? parseGpxMeasurements(text)
        : parseCsvMeasurements(text);

      setMeasurements(parsed);
      setMeasurementNotice(parsed.length
        ? `Imported ${parsed.length} measurement${parsed.length > 1 ? 's' : ''} from ${file.name}.`
        : 'No usable measurements found. CSV needs lat, lon, and rssi/signal_dbm columns.');
    } catch (error) {
      setMeasurementNotice(`Measurement import failed: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }, []);

  const importAntennaPattern = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = parseAntennaPatternCsv(await file.text());
      if (!parsed) {
        setPatternNotice('Pattern import failed. CSV needs angle plus lossDb or gain_dBi columns.');
        return;
      }

      setAntennaPattern(parsed);
      setPatternNotice(`Imported ${parsed.points.length} antenna pattern points from ${file.name}.`);
    } catch (error) {
      setPatternNotice(`Pattern import failed: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }, []);

  const importClutterMap = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = parseClutterGeoJson(await file.text());
      if (!parsed) {
        setClutterMapNotice('Clutter import failed. GeoJSON polygons need numeric lossDb properties.');
        return;
      }

      setClutterMap(parsed);
      setClutterMapNotice(`Imported ${parsed.features.length} clutter polygon${parsed.features.length > 1 ? 's' : ''} from ${file.name}.`);
    } catch (error) {
      setClutterMapNotice(`Clutter import failed: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }, []);

  const applyMeasurementCalibration = useCallback(() => {
    const { count, meanError } = validationReport.summary;
    if (count < 3) {
      setMeasurementNotice('Need at least 3 matched measurements before applying calibration.');
      return;
    }

    const nextOffset = clamp(meanError, -20, 20);
    setCalibrationOffset(nextOffset);
    setCalibrationEnabled(true);
    setMeasurementNotice(`Applied local calibration offset ${nextOffset.toFixed(1)} dB from ${count} measurements.`);
  }, [validationReport.summary]);

  const downloadValidationReport = useCallback(() => {
    const blob = new Blob([JSON.stringify(validationReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `9m2pju-validation-report-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [validationReport]);

  const analyzeSite = useCallback(async (site) => {
    const terrainCacheKey = getTerrainProfileCacheKey(site.position);
    let terrainProfile = terrainProfileCacheRef.current.get(terrainCacheKey);

    if (!terrainProfile) {
      const radialPoints = [];

      for (let i = 0; i < RADIALS_COUNT; i++) {
        const bearing = (i * 360) / RADIALS_COUNT;
        SAMPLING_INTERVALS_KM.forEach((distanceKm) => {
          radialPoints.push(getDestinationPoint(site.position[0], site.position[1], bearing, distanceKm));
        });
      }

      const { elevations, failedChunks } = await fetchElevationBatch([site.position, ...radialPoints]);
      const siteElevation = elevations[0] ?? site.elevation;
      const radialElevations = elevations.slice(1);
      const radialSampleSets = [];

      for (let radialIndex = 0; radialIndex < RADIALS_COUNT; radialIndex++) {
        const offset = radialIndex * SAMPLING_INTERVALS_KM.length;
        radialSampleSets.push(SAMPLING_INTERVALS_KM.map((distanceKm, sampleIndex) => ({
          distanceKm,
          elevation: radialElevations[offset + sampleIndex] ?? siteElevation,
        })));
      }

      terrainProfile = { siteElevation, radialSampleSets, failedChunks };
      terrainProfileCacheRef.current.set(terrainCacheKey, terrainProfile);
    }

    const { siteElevation, radialSampleSets, failedChunks } = terrainProfile;
    const haatSamples = [];
    const newPolygons = { strong: [], moderate: [], weak: [] };
    const radialMargins = [];
    const itmDistanceGrid = createItmDistanceGrid();
    const itmRadialLosses = Array(RADIALS_COUNT).fill(null);
    let itmApiFailures = 0;
    let itmApiFallbacks = 0;
    let itmWarningSamples = 0;
    let itmErrorSamples = 0;

    for (let radialIndex = 0; radialIndex < RADIALS_COUNT; radialIndex++) {
      const bearing = (radialIndex * 360) / RADIALS_COUNT;
      const radialSamples = radialSampleSets[radialIndex];
      const terrainPenaltyCache = new Map();
      haatSamples.push(calculateRadialHaat(siteElevation, hTx, radialSamples));

      const effectiveHTx = calculateEffectiveTxHeight(siteElevation, hTx, radialSamples);
      const antennaPatternLoss = getAntennaPatternLoss({ bearing, antennaAzimuth, antennaBeamwidth, frontBackRatio, antennaPattern });
      const directionalGain = gain - antennaPatternLoss;
      let itmApiLossMap = null;

      if (propagationModel === 'ntiaItmApi' && freq <= ITM_API_MAX_FREQUENCY_MHZ) {
        try {
          const apiResult = await fetchItmRadialLosses({
            freq,
            hTx,
            hRx,
            siteElevation,
            radialSamples,
            distancesKm: itmDistanceGrid,
            confidence: confidenceScore,
            reliability: Math.max(50, confidenceScore),
          });
          itmApiLossMap = apiResult?.losses
            ?.filter((loss) => Number.isFinite(loss.distanceKm) && Number.isFinite(loss.lossDb))
            ?.sort((a, b) => a.distanceKm - b.distanceKm) ?? null;
          itmWarningSamples += itmApiLossMap?.filter((loss) => Number(loss.warnings) > 0).length ?? 0;
          itmErrorSamples += itmApiLossMap?.filter((loss) => Number(loss.errorCode) !== 0).length ?? 0;
          itmRadialLosses[radialIndex] = itmApiLossMap;
          if (apiResult && apiResult.nativeItm === false) itmApiFallbacks += 1;
        } catch (error) {
          itmApiFailures += 1;
          console.warn(`ITM API radial ${radialIndex} failed; using local fallback`, error);
        }
      }

      serviceGrades.forEach((grade) => {
        const targetLoss = powerDbm + directionalGain + rxAntennaGain - systemLossDb + activeCalibrationOffset - grade.thresholdDbm;
        const itmRadius = findReliableDistanceFromLossMap({
          itmLossMap: itmApiLossMap,
          freq,
          targetLoss,
          clutterLossDb: clutterProfile.lossDb,
          sitePosition: site.position,
          bearing,
          clutterMap,
          rainRateMmH: rainRate,
          atmosphericLossDbPerKm: atmosphericLoss,
        });
        const radius = itmRadius ?? findReliableDistance({
          modelKey: propagationModel,
          freq,
          effectiveHTx,
          hTx,
          hRx,
          targetLoss,
          radialSamples,
          siteElevation,
          clutterLossDb: clutterProfile.lossDb,
          terrainPenaltyCache,
          sitePosition: site.position,
          bearing,
          clutterMap,
          rainRateMmH: rainRate,
          atmosphericLossDbPerKm: atmosphericLoss,
        });
        newPolygons[grade.key].push(getDestinationPoint(site.position[0], site.position[1], bearing, radius));

        if (grade.key === 'weak') {
          const itmPathLoss = getItmApiPathLoss(itmApiLossMap, radius);
          const pathLossAtRadius = typeof itmPathLoss === 'number'
            ? itmPathLoss + calculateExternalLosses({
              freq,
              distanceKm: radius,
              clutterLossDb: clutterProfile.lossDb,
              sitePosition: site.position,
              bearing,
              clutterMap,
              rainRateMmH: rainRate,
              atmosphericLossDbPerKm: atmosphericLoss,
            })
            : calculateTotalPathLoss({
              modelKey: propagationModel,
              freq,
              effectiveHTx,
              hTx,
              hRx,
              distanceKm: radius,
              radialSamples,
              siteElevation,
              clutterLossDb: clutterProfile.lossDb,
              terrainPenaltyCache,
              sitePosition: site.position,
              bearing,
              clutterMap,
              rainRateMmH: rainRate,
              atmosphericLossDbPerKm: atmosphericLoss,
            });
          radialMargins.push(targetLoss - pathLossAtRadius);
        }
      });
    }

    if (propagationModel === 'ntiaItmApi') {
      if (freq > ITM_API_MAX_FREQUENCY_MHZ) {
        setItmApiStatus({ state: 'fallback', message: 'Frequency above 20 GHz; local SHF fallback used.' });
      } else if (itmApiFailures > 0) {
        setItmApiStatus({ state: 'error', message: `ITM API failed on ${itmApiFailures}/${RADIALS_COUNT} radials; local fallback filled gaps.` });
      } else if (itmErrorSamples > 0) {
        setItmApiStatus({ state: 'warning', message: `ITM completed with ${itmErrorSamples} native error-code sample${itmErrorSamples > 1 ? 's' : ''}; inspect validation before relying on edges.` });
      } else if (itmWarningSamples > 0) {
        setItmApiStatus({ state: 'warning', message: `ITM completed with ${itmWarningSamples} warning sample${itmWarningSamples > 1 ? 's' : ''}; prediction is usable but flagged.` });
      } else if (itmApiFallbacks > 0) {
        setItmApiStatus({ state: 'fallback', message: 'ITM API responded, but native NTIA engine was unavailable for this run.' });
      } else {
        setItmApiStatus({ state: 'ready', message: 'ITS Irregular Terrain Model (ITM) completed this prediction.' });
      }
    }

    const avgHaat = haatSamples.reduce((total, haat) => total + haat, 0) / haatSamples.length;
    const avgMarginDb = radialMargins.length
      ? radialMargins.reduce((total, margin) => total + margin, 0) / radialMargins.length
      : 0;

    return {
      ...site,
      elevation: siteElevation,
      haat: Math.max(2, avgHaat),
      confidence: confidenceScore,
      avgMarginDb,
      model: propagationModel,
      clutter: clutterKey,
      itmRadialLosses: propagationModel === 'ntiaItmApi' ? itmRadialLosses : null,
      itmWarningSamples,
      itmErrorSamples,
      coveragePolygons: newPolygons,
      areas: {
        strong: calculateAreaKm2(newPolygons.strong),
        moderate: calculateAreaKm2(newPolygons.moderate),
        weak: calculateAreaKm2(newPolygons.weak),
      },
      status: failedChunks > 0 ? 'degraded' : 'analyzed',
      failedChunks,
    };
  }, [
    antennaAzimuth,
    antennaBeamwidth,
    activeCalibrationOffset,
    antennaPattern,
    atmosphericLoss,
    clutterKey,
    clutterProfile.lossDb,
    clutterMap,
    confidenceScore,
    freq,
    frontBackRatio,
    gain,
    hRx,
    hTx,
    powerDbm,
    propagationModel,
    rainRate,
    rxAntennaGain,
    serviceGrades,
    systemLossDb,
  ]);

  const analyzeTerrain = useCallback(async () => {
    if (isAnalyzingRef.current) return;

    const sitesToAnalyze = sitesRef.current;
    if (!sitesToAnalyze.length) {
      setAnalysisNotice('Add at least one coverage site before running prediction.');
      return;
    }

    isAnalyzingRef.current = true;
    setIsAnalyzing(true);
    setAnalysisNotice(`Running terrain prediction for ${sitesToAnalyze.length} site${sitesToAnalyze.length > 1 ? 's' : ''}...`);
    setSites((currentSites) => currentSites.map((site) => ({ ...site, status: 'analyzing' })));

    const analyzed = await Promise.all(sitesToAnalyze.map(async (site) => {
      try {
        const result = await analyzeSite(site);
        return result;
      } catch (e) {
        console.error(`Coverage analysis failed for ${site.name}`, e);
        return { ...site, status: 'failed' };
      }
    }));

    const failedSites = analyzed.filter((site) => site.status === 'failed').length;
    const degradedSites = analyzed.filter((site) => site.status === 'degraded').length;

    setSites(analyzed);

    if (failedSites > 0) {
      setAnalysisNotice(`${failedSites} site${failedSites > 1 ? 's' : ''} could not be predicted. Check connection and retry.`);
    } else if (degradedSites > 0) {
      setAnalysisNotice(`Prediction completed with fallback terrain for ${degradedSites} site${degradedSites > 1 ? 's' : ''}.`);
    } else {
      setAnalysisNotice('Coverage prediction completed.');
    }

    setIsAnalyzing(false);
    isAnalyzingRef.current = false;
    setIsPanelOpen(false);
  }, [analyzeSite]);

  return (
    <div className="app-container">
      <div className="pro-metrics-bar glass-panel" style={{
        position: 'absolute', top: '20px', left: '360px', right: '20px', zIndex: 1000,
        display: 'flex', padding: '12px 24px', gap: '40px', alignItems: 'center', pointerEvents: 'auto'
      }}>
        <div style={{ display: 'flex', gap: '15px' }}>
          <div className="metric-box">
            <span style={{ color: '#4dbd74', fontSize: '0.65rem', fontWeight: 'bold' }}>STRONG TOTAL</span>
            <p style={{ fontSize: '1rem', fontWeight: '800' }}>{combinedAreas.strong.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</p>
          </div>
          <div className="metric-box">
            <span style={{ color: '#ffc107', fontSize: '0.65rem', fontWeight: 'bold' }}>MODERATE TOTAL</span>
            <p style={{ fontSize: '1rem', fontWeight: '800' }}>{combinedAreas.moderate.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</p>
          </div>
          <div className="metric-box">
            <span style={{ color: '#ff4444', fontSize: '0.65rem', fontWeight: 'bold' }}>FRINGE TOTAL</span>
            <p style={{ fontSize: '1rem', fontWeight: '800' }}>{combinedAreas.weak.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</p>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '20px' }} className="pc-only-metrics">
          <div className="metric-badge">
            <Mountain size={14} style={{ marginRight: '6px' }} />
            <span>SITE: {activeSite?.elevation ?? 0}m AMSL</span>
          </div>
          <div className="metric-badge">
            <BarChart3 size={14} style={{ marginRight: '6px' }} />
            <span>HAAT: {(activeSite?.haat ?? 0).toFixed(1)}m</span>
          </div>
          <div className="metric-badge">
            <Antenna size={14} style={{ marginRight: '6px' }} />
            <span>{analyzedSites}/{sites.length} SITES</span>
          </div>
        </div>
      </div>

      <div className="ui-overlay">
        <button
          className="fab-scan mobile-only"
          onClick={analyzeTerrain}
          disabled={isAnalyzing}
        >
          {isAnalyzing ? <div className="loading-spinner" /> : <Zap size={24} fill="white" />}
        </button>

        <div className="glass-panel header-panel pc-only">
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div style={{ background: 'white', padding: '6px', borderRadius: '10px', display: 'flex', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', border: '1px solid #eee' }}>
              <img src="/brand_logo_v6.png" alt="Brand" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.2rem', fontWeight: '900', letterSpacing: '0.5px' }}>9M2PJU Coverage Prediction</h1>
              <p style={{ fontSize: '0.75rem', fontWeight: '600' }}>Multi-Site Coverage Prediction v4.7.1</p>
            </div>
          </div>
        </div>

        <div className={`glass-panel control-panel ${isPanelOpen ? 'open' : ''}`}>
          <div className="bottom-sheet-drag mobile-only" onClick={() => setIsPanelOpen(!isPanelOpen)} />

          <div className="mobile-header-content mobile-only" onClick={() => setIsPanelOpen(!isPanelOpen)} style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src="/brand_logo_v6.png" alt="Logo" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
              <div>
                <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '900', color: 'var(--title-blue)', letterSpacing: '0.5px' }}>9M2PJU Coverage Prediction</h1>
                  <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Multi-Site Coverage Prediction v4.7.1</p>
              </div>
            </div>
          </div>

          <div className="pc-only">
            <div className="control-group">
              <button
                className={`action-button pro-btn ${isAnalyzing ? 'loading' : ''}`}
                onClick={analyzeTerrain}
                disabled={isAnalyzing}
                style={{
                  width: '100%', padding: '14px', borderRadius: '12px',
                  background: 'linear-gradient(135deg, #00c6ff, #0072ff)',
                  color: 'white', border: 'none', cursor: 'pointer', fontWeight: '900',
                  fontSize: '0.9rem', marginBottom: '20px', boxShadow: '0 4px 15px rgba(0, 114, 255, 0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px'
                }}
              >
                {isAnalyzing ? <div className="loading-spinner" style={{ width: '18px', height: '18px' }} /> : <Zap size={18} fill="white" />}
                {isAnalyzing ? 'SCALING TERRAIN...' : `RUN ${sites.length}-SITE COVERAGE`}
              </button>
              <div className={`analysis-notice ${analysisNotice.includes('could not') ? 'error' : analysisNotice.includes('fallback') ? 'warning' : ''}`}>
                {analysisNotice}
              </div>
              <button className="about-button" type="button" onClick={() => setIsAboutOpen(true)}>
                <Info size={14} /> About
              </button>
            </div>
          </div>

          <div className="mobile-only">
            <p style={{ fontSize: '0.7rem', color: '#888', marginBottom: '15px', fontWeight: 'bold' }}>RF METRICS (km²)</p>
            <div className={`analysis-notice ${analysisNotice.includes('could not') ? 'error' : analysisNotice.includes('fallback') ? 'warning' : ''}`}>
              {analysisNotice}
            </div>
            <div className="mobile-metrics">
              <div className="mobile-metric-card">
                <span style={{ fontSize: '0.6rem', color: '#4dbd74', display: 'block' }}>STRONG</span>
                <strong style={{ fontSize: '0.9rem' }}>{combinedAreas.strong.toFixed(0)}</strong>
              </div>
              <div className="mobile-metric-card">
                <span style={{ fontSize: '0.6rem', color: '#f57f17', display: 'block' }}>MODERATE</span>
                <strong style={{ fontSize: '0.9rem' }}>{combinedAreas.moderate.toFixed(0)}</strong>
              </div>
              <div className="mobile-metric-card">
                <span style={{ fontSize: '0.6rem', color: '#d32f2f', display: 'block' }}>FRINGE</span>
                <strong style={{ fontSize: '0.9rem' }}>{combinedAreas.weak.toFixed(0)}</strong>
              </div>
            </div>
            <button className="about-button" type="button" onClick={() => setIsAboutOpen(true)}>
              <Info size={14} /> About
            </button>
          </div>

          <div className="control-group">
            <label><Antenna size={12} style={{ marginRight: '6px' }} /> COVERAGE SITES</label>
            <div className="site-list">
              {sites.map((site) => (
                <button
                  key={site.id}
                  className={`site-chip ${site.id === activeSiteId ? 'active' : ''}`}
                  type="button"
                  onClick={() => setActiveSiteId(site.id)}
                  style={{ '--site-color': site.color }}
                >
                  <span className="site-dot" />
                  <span>{site.name}</span>
                  <small>
                    {site.status === 'analyzing'
                      ? 'scan'
                      : site.status === 'failed'
                        ? 'retry'
                        : site.status === 'degraded'
                          ? `${site.areas.weak.toFixed(0)} km² est.`
                          : `${site.areas.weak.toFixed(0)} km²`}
                  </small>
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 44px', gap: '8px' }}>
              <button className="secondary-button" type="button" onClick={addCoverageSite} disabled={sites.length >= MAX_SITES || isAnalyzing}>
                <Plus size={14} /> Add site
              </button>
              <button className="icon-button" type="button" onClick={removeActiveSite} disabled={sites.length <= 1 || isAnalyzing} aria-label="Remove active site">
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <div className="control-group">
            <label><Activity size={12} style={{ marginRight: '6px' }} /> TX POWER: {formatPower(power)}W</label>
            <div className="slider-container">
              <input type="range" min="0.1" max="100" step="0.1" value={power} onChange={(e) => setPower(Number(e.target.value))} />
              <input
                className="numeric-input"
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                value={power}
                aria-label="TX power in watts"
                onChange={(e) => setPower(clamp(Number(e.target.value), 0.1, 100))}
              />
            </div>
          </div>

          <div className="control-group">
            <label><Layers size={12} style={{ marginRight: '6px' }} /> TOWER HEIGHT: {hTx}m AGL</label>
            <div className="slider-container">
              <input type="range" min="0" max="300" value={hTx} onChange={(e) => setHTx(Number(e.target.value))} />
              <input
                className="numeric-input"
                type="number"
                min="0"
                max="300"
                step="1"
                value={hTx}
                aria-label="Tower height above ground in meters"
                onChange={(e) => setHTx(clamp(Number(e.target.value), 0, 300))}
              />
            </div>
          </div>

          <div className="control-group">
            <label><Activity size={12} style={{ marginRight: '6px' }} /> ANTENNA GAIN: {gain}dBi</label>
            <input type="range" min="0" max="20" value={gain} onChange={(e) => setGain(Number(e.target.value))} />
          </div>

          <div className="control-group">
            <label><Activity size={12} style={{ marginRight: '6px' }} /> RX HEIGHT: {hRx.toFixed(1)}m AGL</label>
            <input type="range" min="1" max="30" step="0.5" value={hRx} onChange={(e) => setHRx(Number(e.target.value))} />
          </div>

          <div className="control-group">
            <label><Radio size={12} style={{ marginRight: '6px' }} /> MODE PROFILE</label>
            <select
              className="mode-select"
              value={modeKey}
              onChange={(e) => {
                const nextMode = e.target.value;
                const nextProfile = MODE_PROFILES[nextMode] ?? MODE_PROFILES.fm;
                setModeKey(nextMode);
                setFreq(nextProfile.defaultFreq);
                setFreqBand(nextProfile.defaultFreq < 300 ? 'vhf' : nextProfile.defaultFreq < 3000 ? 'uhf' : 'shf');
                setReceiverBandwidth(nextProfile.defaultBandwidth);
                setRequiredSnr(nextProfile.defaultRequiredSnr);
              }}
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
            <div className="mode-note">
              {modeProfile.note} · Fringe {modeProfile.thresholds.weak} dBm
            </div>
          </div>

          <div className="control-group engineering-group">
            <label><FileText size={12} style={{ marginRight: '6px' }} /> ENGINEERING MODEL</label>
            <select className="mode-select" value={propagationModel} onChange={(e) => setPropagationModel(e.target.value)}>
              {PROPAGATION_MODEL_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
            <div className="mode-note">{modelProfile.note}</div>
            {propagationModel === 'ntiaItmApi' && (
              <div className={`analysis-notice ${itmApiStatus.state === 'error' ? 'error' : ['fallback', 'warning'].includes(itmApiStatus.state) ? 'warning' : ''}`}>
                {itmApiStatus.message}
              </div>
            )}
            <select className="mode-select stacked-select" value={clutterKey} onChange={(e) => setClutterKey(e.target.value)}>
              {CLUTTER_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label} (+{option.lossDb} dB)</option>
              ))}
            </select>
            <div className="engineering-summary">
              Confidence estimate: {confidenceScore.toFixed(0)}% · {modelReliability.label} reliability · clutter uncertainty ±{clutterProfile.uncertaintyDb} dB
            </div>
            <div className="mode-note">
              {modelReliability.notes[0]}
            </div>
            <label className="file-import-button">
              <Upload size={14} /> Import clutter GeoJSON
              <input type="file" accept=".json,.geojson,application/geo+json,application/json" onChange={importClutterMap} />
            </label>
            <div className="mode-note">{clutterMapNotice}</div>
          </div>

          <div className="control-group engineering-group">
            <label><Activity size={12} style={{ marginRight: '6px' }} /> LINK BUDGET</label>
            <div className="engineering-grid">
              <label>Feedline loss
                <input className="numeric-input compact-input" type="number" min="0" max="20" step="0.1" value={feedlineLoss} onChange={(e) => setFeedlineLoss(clamp(toNumber(e.target.value), 0, 20))} />
              </label>
              <label>RX gain
                <input className="numeric-input compact-input" type="number" min="-20" max="30" step="0.5" value={rxAntennaGain} onChange={(e) => setRxAntennaGain(clamp(toNumber(e.target.value), -20, 30))} />
              </label>
              <label>Fade margin
                <input className="numeric-input compact-input" type="number" min="0" max="40" step="1" value={fadeMargin} onChange={(e) => setFadeMargin(clamp(toNumber(e.target.value), 0, 40))} />
              </label>
              <label>Noise figure
                <input className="numeric-input compact-input" type="number" min="0" max="25" step="0.5" value={noiseFigure} onChange={(e) => setNoiseFigure(clamp(toNumber(e.target.value), 0, 25))} />
              </label>
              <label>Required SNR
                <input className="numeric-input compact-input" type="number" min="-20" max="40" step="1" value={requiredSnr} onChange={(e) => setRequiredSnr(clamp(toNumber(e.target.value), -20, 40))} />
              </label>
              <label>Bandwidth
                <select className="mini-select" value={receiverBandwidth} onChange={(e) => setReceiverBandwidth(Number(e.target.value))}>
                  {BANDWIDTH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>Rain rate
                <input className="numeric-input compact-input" type="number" min="0" max="150" step="1" value={rainRate} onChange={(e) => setRainRate(clamp(toNumber(e.target.value), 0, 150))} />
              </label>
              <label>Atm loss/km
                <input className="numeric-input compact-input" type="number" min="0" max="1" step="0.005" value={atmosphericLoss} onChange={(e) => setAtmosphericLoss(clamp(toNumber(e.target.value), 0, 1))} />
              </label>
            </div>
            <div className="engineering-summary">
              Noise floor {thermalNoiseDbm(receiverBandwidth, noiseFigure).toFixed(1)} dBm · system loss {systemLossDb.toFixed(1)} dB
            </div>
          </div>

          <div className="control-group engineering-group">
            <label><Antenna size={12} style={{ marginRight: '6px' }} /> ANTENNA PATTERN</label>
            <div className="engineering-grid">
              <label>Azimuth
                <input className="numeric-input compact-input" type="number" min="0" max="359" step="1" value={antennaAzimuth} onChange={(e) => setAntennaAzimuth(clamp(toNumber(e.target.value), 0, 359))} />
              </label>
              <label>Beamwidth
                <input className="numeric-input compact-input" type="number" min="5" max="360" step="5" value={antennaBeamwidth} onChange={(e) => setAntennaBeamwidth(clamp(toNumber(e.target.value), 5, 360))} />
              </label>
              <label>F/B ratio
                <input className="numeric-input compact-input" type="number" min="0" max="40" step="1" value={frontBackRatio} onChange={(e) => setFrontBackRatio(clamp(toNumber(e.target.value), 0, 40))} />
              </label>
            </div>
            <label className="file-import-button">
              <Upload size={14} /> Import antenna pattern
              <input type="file" accept=".csv,text/csv" onChange={importAntennaPattern} />
            </label>
            <div className="mode-note">{patternNotice}</div>
          </div>

          <div className="control-group">
            <label style={{ fontSize: '0.7rem', color: '#888', display: 'block', marginBottom: '10px' }}><Radio size={12} /> BAND SELECTOR</label>
            <div className="band-selector" role="group" aria-label="Band selector">
              {BAND_OPTIONS.map((band) => (
                <button
                  key={band.key}
                  type="button"
                  className={`band-button ${freqBand === band.key ? 'active' : ''}`}
                  onClick={() => {
                    setFreqBand(band.key);
                    setFreq(band.defaultFreq);
                  }}
                >
                  <span>{band.label}</span>
                  <small>{band.rangeLabel}</small>
                </button>
              ))}
            </div>
            <label>FREQUENCY: {freq}MHz</label>
            <input
              type="range"
              min={activeBand.min}
              max={activeBand.max}
              value={freq}
              onChange={(e) => setFreq(Number(e.target.value))}
            />
          </div>

          <div className="control-group" style={{ marginTop: '25px', borderTop: '1px solid var(--glass-border)', paddingTop: '15px' }}>
            <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '10px', letterSpacing: '1px' }}>PREDICTED ZONES</p>
            <div className="pro-legend-item">
              <div style={{ width: 10, height: 10, background: '#4dbd74', border: '1px solid white' }}></div>
              <span>Strong signal &gt; {serviceGrades.find((grade) => grade.key === 'strong')?.thresholdDbm.toFixed(0)} dBm</span>
            </div>
            <div className="pro-legend-item">
              <div style={{ width: 10, height: 10, background: '#ffc107', border: '1px solid white' }}></div>
              <span>Moderate signal &gt; {serviceGrades.find((grade) => grade.key === 'moderate')?.thresholdDbm.toFixed(0)} dBm</span>
            </div>
            <div className="pro-legend-item">
              <div style={{ width: 10, height: 10, background: '#ff4444', border: '1px solid white' }}></div>
              <span>Fringe signal &gt; {serviceGrades.find((grade) => grade.key === 'weak')?.thresholdDbm.toFixed(0)} dBm</span>
            </div>
          </div>

          <div className="control-group engineering-group validation-group">
            <label><Upload size={12} style={{ marginRight: '6px' }} /> FIELD VALIDATION</label>
            <label className="file-import-button">
              <Upload size={14} /> Import CSV / GPX
              <input type="file" accept=".csv,.gpx,text/csv,application/gpx+xml" onChange={importMeasurements} />
            </label>
            <div className="engineering-summary">{measurementNotice}</div>
            <div className="validation-stats">
              <span>Samples: {validationReport.summary.count}</span>
              <span>RMSE: {validationReport.summary.rmse.toFixed(1)} dB</span>
              <span>Within 10 dB: {validationReport.summary.within10Db.toFixed(0)}%</span>
            </div>
            <div className="engineering-summary">
              Calibration {calibrationEnabled ? `applied ${calibrationOffset.toFixed(1)} dB` : 'off'} · measured bias {validationReport.summary.meanError.toFixed(1)} dB
            </div>
            <button className="secondary-button" type="button" onClick={applyMeasurementCalibration} disabled={validationReport.summary.count < 3}>
              <Activity size={14} /> Apply local calibration
            </button>
            <button className="secondary-button" type="button" onClick={downloadValidationReport} disabled={!measurements.length}>
              <Download size={14} /> Download validation report
            </button>
          </div>
        </div>
      </div>

      <MapContainer
        center={mapCenter}
        zoom={11}
        minZoom={MAP_MIN_ZOOM}
        maxZoom={MAP_MAX_ZOOM}
        maxBounds={WORLD_BOUNDS}
        maxBoundsViscosity={0.85}
        className="map-container"
        zoomControl={false}
        scrollWheelZoom
        wheelPxPerZoomLevel={80}
        doubleClickZoom
        touchZoom
        keyboard
      >
        <LayersControl position="topright">
          {MAP_LAYERS.map((layer) => (
            <LayersControl.BaseLayer key={layer.name} name={layer.name} checked={layer.checked}>
              <TileLayer
                url={layer.url}
                attribution={layer.attribution}
                minZoom={MAP_MIN_ZOOM}
                maxZoom={MAP_MAX_ZOOM}
                maxNativeZoom={layer.maxZoom ?? MAP_MAX_ZOOM}
                keepBuffer={4}
                updateWhenZooming={false}
                updateWhenIdle
                errorTileUrl={FALLBACK_TILE_URL}
                subdomains={layer.subdomains ?? 'abc'}
              />
            </LayersControl.BaseLayer>
          ))}
        </LayersControl>
        <ZoomControl position="topright" />
        <MapClickHandler onClick={updateActiveSitePosition} />

        {sites.map((site) => (
          <React.Fragment key={`coverage-${site.id}`}>
            {serviceGrades.map((grade) => site.coveragePolygons[grade.key] && (
              <Polygon
                key={`${site.id}-${grade.key}`}
                positions={site.coveragePolygons[grade.key]}
                pathOptions={{
                  color: grade.color,
                  fillColor: grade.color,
                  fillOpacity: grade.fillOpacity,
                  weight: site.id === activeSiteId ? grade.weight + 1 : grade.weight,
                  dashArray: grade.dashArray,
                }}
              />
            ))}
          </React.Fragment>
        ))}

        {sites.map((site) => (
          <Marker
            key={site.id}
            position={site.position}
            eventHandlers={{ click: () => setActiveSiteId(site.id) }}
          >
            <Popup>
              <div style={{ color: '#000', fontSize: '0.8rem' }}>
                <strong style={{ fontSize: '0.9rem' }}>{site.name.toUpperCase()} TRANSMITTER</strong><br />
                Lat/Lon: {site.position[0].toFixed(4)}, {site.position[1].toFixed(4)}<br />
                Elev: {site.elevation}m AMSL | HAAT: {site.haat.toFixed(1)}m<br />
                Fringe: {site.areas.weak.toFixed(0)} km²<br />
                Model: {PROPAGATION_MODELS[site.model]?.label ?? modelProfile.label}<br />
                Confidence: {(site.confidence ?? confidenceScore).toFixed(0)}% | Avg margin: {(site.avgMarginDb ?? 0).toFixed(1)} dB
              </div>
            </Popup>
          </Marker>
        ))}

        {validationReport.comparisons.map((measurement) => {
          const absError = Math.abs(measurement.errorDb);
          const color = absError <= 6 ? '#4dbd74' : absError <= 10 ? '#ffc107' : '#ff4444';
          return (
            <CircleMarker
              key={measurement.id}
              center={measurement.position}
              radius={6}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.78, weight: 2 }}
            >
              <Popup>
                <div style={{ color: '#000', fontSize: '0.8rem' }}>
                  <strong>FIELD MEASUREMENT</strong><br />
                  Measured: {measurement.measuredDbm.toFixed(1)} dBm<br />
                  Predicted: {measurement.estimatedDbm.toFixed(1)} dBm ({measurement.predictedGrade})<br />
                  Error: {measurement.errorDb.toFixed(1)} dB<br />
                  Site: {measurement.predictedSite}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {isAboutOpen && (
        <div className="about-modal-backdrop" role="presentation" onClick={() => setIsAboutOpen(false)}>
          <div className="about-modal glass-panel" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(event) => event.stopPropagation()}>
            <button className="about-close-button" type="button" aria-label="Close about dialog" onClick={() => setIsAboutOpen(false)}>
              <X size={18} />
            </button>
            <h2 id="about-title">About</h2>
            <p>
              This app uses ITS Irregular Terrain Model (ITM) when the service is reachable, with local terrain-aware fallback models, so it should give useful planning-grade coverage zones. Real-world results can still differ due to buildings, foliage, antenna pattern, local noise, receiver quality, weather, and terrain data accuracy.
            </p>
            <p>
              In simple words: use this app for planning and estimating coverage, not as certified RF engineering truth. The prediction becomes more reliable when you compare it with real field measurements and adjust the settings.
            </p>
            <p>
              You can import CSV or GPX field measurements to compare real signal readings with the predicted coverage and download a validation report.
            </p>
            <h3>How to use</h3>
            <ol className="about-list">
              <li>Add or select a coverage site, then click the map to place it.</li>
              <li>Set TX power, antenna gain, frequency, tower height, and RX height.</li>
              <li>Choose the mode profile, engineering model, clutter type, and link budget values.</li>
              <li>Press Run Coverage to draw strong, moderate, and fringe coverage zones.</li>
              <li>Import CSV or GPX field readings to check how close the prediction is to real signals.</li>
            </ol>
            <h3>Settings</h3>
            <dl className="about-settings">
              <dt>Coverage sites</dt>
              <dd>Transmitter locations. Add more sites when several repeaters or stations share coverage.</dd>
              <dt>TX power</dt>
              <dd>Power from the transmitter in watts before antenna and cable effects.</dd>
              <dt>Antenna gain</dt>
              <dd>Transmit antenna gain in dBi. Higher gain can extend coverage in the antenna direction.</dd>
              <dt>RX height</dt>
              <dd>Receiver antenna height above ground, such as handheld, mobile, or home antenna height.</dd>
              <dt>Mode profile</dt>
              <dd>Radio mode and signal threshold profile, for example FM voice, APRS, or weak-signal modes.</dd>
              <dt>Engineering model</dt>
              <dd>Prediction method. ITS ITM is the default; local Hata and ITM-style fallback models remain available.</dd>
              <dt>Clutter</dt>
              <dd>Extra loss for the environment, such as open land, suburban, forest, or dense urban areas.</dd>
              <dt>Feedline loss</dt>
              <dd>Signal lost in coax, connectors, duplexer, filters, or other hardware before the antenna.</dd>
              <dt>RX gain</dt>
              <dd>Receiver antenna gain. Use negative values for poor antennas or body/vehicle loss.</dd>
              <dt>Fade margin</dt>
              <dd>Extra safety margin in dB for fading, weather, movement, and real-world uncertainty.</dd>
              <dt>Noise figure</dt>
              <dd>Receiver noise performance. Lower is better; higher values need stronger signals.</dd>
              <dt>Required SNR</dt>
              <dd>Signal-to-noise ratio needed for usable copy. Higher SNR means smaller predicted coverage.</dd>
              <dt>Bandwidth</dt>
              <dd>Receiver bandwidth. Wider bandwidth raises noise floor and may need stronger signal.</dd>
              <dt>Antenna pattern</dt>
              <dd>Azimuth points the antenna, beamwidth sets its main lobe width, and F/B ratio reduces back-side coverage.</dd>
              <dt>Frequency</dt>
              <dd>Operating frequency in MHz. VHF/UHF/SHF behave differently over distance and terrain.</dd>
              <dt>Tower height</dt>
              <dd>Transmitter antenna height above ground. More height usually improves line-of-sight coverage.</dd>
              <dt>Field validation</dt>
              <dd>Import measured signal points to compare predicted and real results, then export a report.</dd>
            </dl>
            <p className="about-credit">
              Made by <a href="https://hamradio.my" target="_blank" rel="noreferrer">9M2PJU</a>
            </p>
          </div>
        </div>
      )}

      <style>{`
        .loading-spinner {
          border: 3px solid rgba(0,0,0,0.1);
          border-top: 3px solid white;
          border-radius: 50%;
          width: 24px;
          height: 24px;
          animation: spin 1s linear infinite;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @media (max-width: 768px) {
          .pc-only, .pc-only-metrics { display: none !important; }
          .leaflet-top.leaflet-right {
            top: 0;
          }
          .leaflet-top.leaflet-right .leaflet-control {
            margin-right: 10px;
          }
        }
        @media (min-width: 769px) {
          .mobile-only { display: none !important; }
        }
        .pro-legend-item {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
          font-size: 0.75rem;
        }
        .metric-badge {
          display: flex;
          align-items: center;
          background: rgba(0,0,0,0.05);
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 0.7rem;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .analysis-notice {
          margin: -10px 0 18px;
          padding: 9px 10px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.06);
          color: var(--text-secondary);
          font-size: 0.72rem;
          line-height: 1.35;
          font-weight: 700;
        }
        .analysis-notice.warning {
          border-color: rgba(255, 193, 7, 0.35);
          color: #ffd56a;
          background: rgba(255, 193, 7, 0.1);
        }
        .analysis-notice.error {
          border-color: rgba(255, 68, 68, 0.35);
          color: #ff9b9b;
          background: rgba(255, 68, 68, 0.1);
        }
        .about-button {
          width: 100%;
          min-height: 38px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.08);
          color: var(--text-primary);
          cursor: pointer;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: -6px;
          margin-bottom: 14px;
        }
        .about-button:hover,
        .about-button:focus-visible {
          border-color: rgba(0, 163, 255, 0.55);
          background: rgba(0, 163, 255, 0.16);
          outline: none;
        }
        .about-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 3000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(0, 0, 0, 0.56);
          pointer-events: auto;
        }
        .about-modal {
          position: relative;
          width: min(680px, calc(100vw - 40px));
          max-height: min(86vh, 760px);
          overflow-y: auto;
          padding: 24px;
          color: var(--text-primary);
        }
        .about-modal h2 {
          margin: 0 36px 14px 0;
          color: var(--title-blue);
          font-size: 1.05rem;
          font-weight: 900;
        }
        .about-modal p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 0.86rem;
          line-height: 1.55;
          font-weight: 650;
        }
        .about-modal h3 {
          margin: 18px 0 8px;
          color: var(--text-primary);
          font-size: 0.82rem;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .about-list {
          margin: 0;
          padding-left: 20px;
          color: var(--text-secondary);
          font-size: 0.82rem;
          line-height: 1.45;
          font-weight: 650;
        }
        .about-list li {
          margin: 5px 0;
        }
        .about-settings {
          display: grid;
          grid-template-columns: minmax(120px, 0.36fr) 1fr;
          gap: 8px 14px;
          margin: 0;
        }
        .about-settings dt {
          color: var(--text-primary);
          font-size: 0.78rem;
          font-weight: 900;
        }
        .about-settings dd {
          margin: 0;
          color: var(--text-secondary);
          font-size: 0.78rem;
          line-height: 1.4;
          font-weight: 650;
        }
        .about-modal .about-credit {
          margin-top: 18px;
          color: var(--text-primary);
        }
        .about-modal a {
          color: var(--title-blue);
          font-weight: 900;
          text-decoration: none;
        }
        .about-modal a:hover,
        .about-modal a:focus-visible {
          text-decoration: underline;
          outline: none;
        }
        .about-close-button {
          position: absolute;
          top: 14px;
          right: 14px;
          width: 34px;
          height: 34px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.08);
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .about-close-button:hover,
        .about-close-button:focus-visible {
          border-color: rgba(0, 163, 255, 0.55);
          background: rgba(0, 163, 255, 0.16);
          outline: none;
        }
        .leaflet-control-layers {
          border: 1px solid rgba(255,255,255,0.18) !important;
          border-radius: 10px !important;
          background: rgba(20, 24, 33, 0.88) !important;
          backdrop-filter: blur(12px);
          color: #f0f6fc;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35) !important;
        }
        .leaflet-top.leaflet-right {
          top: 82px;
        }
        .leaflet-top.leaflet-right .leaflet-control {
          margin-right: 20px;
        }
        .leaflet-control-layers-expanded {
          padding: 10px 12px !important;
        }
        .leaflet-control-layers label {
          margin-bottom: 6px;
          font-size: 0.78rem;
          font-weight: 700;
        }
        .leaflet-control-layers-separator {
          border-top-color: rgba(255,255,255,0.18) !important;
        }
        @media (max-width: 768px) {
          .leaflet-top.leaflet-right {
            top: 0;
          }
          .leaflet-top.leaflet-right .leaflet-control {
            margin-right: 10px;
          }
          .analysis-notice {
            margin: 0 0 14px;
          }
          .about-button {
            margin: -4px 0 16px;
          }
          .about-modal {
            padding: 22px;
          }
          .about-settings {
            grid-template-columns: 1fr;
            gap: 3px;
          }
          .about-settings dd {
            margin-bottom: 9px;
          }
        }
        .site-list {
          display: grid;
          gap: 8px;
          margin-bottom: 10px;
        }
        .site-chip {
          display: grid;
          grid-template-columns: 12px 1fr auto;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.05);
          color: var(--text-primary);
          cursor: pointer;
          font-weight: 700;
          text-align: left;
        }
        .site-chip.active {
          border-color: var(--site-color);
          background: color-mix(in srgb, var(--site-color) 18%, rgba(255,255,255,0.05));
        }
        .site-chip small {
          color: var(--text-secondary);
          font-size: 0.65rem;
          font-weight: 700;
        }
        .site-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: var(--site-color);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--site-color) 20%, transparent);
        }
        .secondary-button,
        .icon-button {
          min-height: 38px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.08);
          color: var(--text-primary);
          cursor: pointer;
          font-weight: 800;
        }
        .secondary-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .secondary-button:disabled,
        .icon-button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

export default App;
