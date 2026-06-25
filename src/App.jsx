import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents, Popup, Polygon, LayersControl, ZoomControl, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Radio, Activity, Layers, Zap, Mountain, BarChart3, Plus, Trash2, Antenna, Info, X, Upload, Download, FileText, Crosshair, MapPin, Database, Share2, Clipboard, Gauge } from 'lucide-react';
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
const APP_VERSION = '4.8.0';
const EMPTY_AREAS = { strong: 0, moderate: 0, weak: 0 };
const EMPTY_POLYGONS = { strong: null, moderate: null, weak: null };
const RADIALS_COUNT = 72;
const COVERAGE_RADIAL_OPTIONS = [
  { key: 'standard', label: 'Standard 5 deg', radials: RADIALS_COUNT },
  { key: 'radioMobile', label: 'Radio Mobile validation 2 deg', radials: 180 },
];
const COVERAGE_RENDER_OPTIONS = [
  { key: 'polygon', label: 'Radial polygons' },
  { key: 'raster', label: 'Raster cells' },
];
const COVERAGE_RASTER_CELL_KM = 3;
const RASTER_CELL_OPTIONS_KM = [1, 2, 3, 5];
const THRESHOLD_MODE_OPTIONS = [
  { key: 'receiver', label: 'RX threshold uV' },
  { key: 'noiseFloor', label: 'Noise + SNR' },
];
const QUICK_STATION_PRESETS = [
  { key: 'handheld', label: 'Handheld', power: 5, hTx: 1.5, hRx: 1.5, gain: 0, rxAntennaGain: 0, fadeMargin: 6 },
  { key: 'mobile', label: 'Mobile', power: 25, hTx: 2, hRx: 2, gain: 2.5, rxAntennaGain: 2.5, fadeMargin: 6 },
  { key: 'base', label: 'Base', power: 50, hTx: 12, hRx: 2, gain: 6, rxAntennaGain: 2, fadeMargin: 8 },
  { key: 'repeater', label: 'Repeater', power: 50, hTx: 40, hRx: 2, gain: 6, rxAntennaGain: 2, fadeMargin: 10 },
  { key: 'lora', label: 'LoRa', power: 1, hTx: 8, hRx: 1.5, gain: 3, rxAntennaGain: 2, modeKey: 'loraSf9', fadeMargin: 8 },
  { key: 'microwave', label: 'Microwave', power: 5, hTx: 15, hRx: 10, gain: 20, rxAntennaGain: 20, freqBand: 'shf', freq: 5600, fadeMargin: 12, useTwoRay: true },
];
const SAMPLE_SCENARIOS = [
  { key: 'flat', label: 'Flat rural', position: [2.0442, 102.5689], freq: 145, hTx: 25, hRx: 2, maxRangeKm: 80, clutterKey: 'open' },
  { key: 'coastal', label: 'Coastal path', position: [1.4927, 103.7414], freq: 145, hTx: 30, hRx: 10, maxRangeKm: 100, clutterKey: 'open' },
  { key: 'hilly', label: 'Hilly terrain', position: [3.8126, 101.8570], freq: 145, hTx: 35, hRx: 2, maxRangeKm: 90, clutterKey: 'forest' },
];
const CLUTTER_CLASS_LOSS_DB = {
  open: 0,
  rural: 2,
  suburban: 6,
  forest: 12,
  foliage: 12,
  urban: 18,
  dense_urban: 24,
  building: 26,
};
const EXPERIMENT_IMPROVEMENTS = [
  'Prediction trust status for every active site',
  'Noise-floor threshold mode using bandwidth, noise figure, and required SNR',
  'Adjustable raster cell size for per-cell coverage experiments',
  'Local DEM CSV/JSON import into the elevation cache',
  'Radio Mobile reference CSV import for parity scoring',
  'Bearing-by-bearing Radio Mobile distance error summary',
  'Map click mode switch between site placement and point query',
  'Point query popup with predicted signal, grade, bearing, and source engine',
  'Terrain profile sparkline for queried receiver points',
  'Quick amateur station presets for handheld, mobile, base, repeater, LoRa, and microwave',
  'Sample scenarios for flat, coastal, and hilly terrain checks',
  'Scenario JSON export for repeatable validation',
  'Scenario JSON import for restoring experiments',
  'Shareable URL with key RF settings and active site position',
  'Experiment package JSON with settings, validation, parity, sites, notes, and improvement manifest',
  'Operator map notes from queried points',
  'Multi-band max-range margin preview',
  'Explicit threshold diagnostics in app exports',
  'PDF map snapshot legend, north arrow, and scale reference',
  'GeoJSON metadata for threshold mode, raster size, and confidence state',
  'Validation JSON expanded with threshold model assumptions',
  'Radio Mobile CSV metadata expanded with raster and threshold mode',
  'Clutter GeoJSON class-name loss mapping',
  'DEM-backed local cache clear/refresh behavior through scenario tools',
  'Debug panel for compact active-site prediction metadata',
  'Current run explanation in plain operator language',
  'Confidence badge tied to ITM/native/fallback/raster status',
  'Visual overlap reduction through compact grouped controls',
  'Automated experiment smoke test for parser and parity helpers',
  'Updated README describing current reliability and experiment workflow',
];
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
const OPEN_ELEVATION_API_URL = (import.meta.env.VITE_OPEN_ELEVATION_API_URL ?? 'https://elevation.hamradio.my/api/v1/lookup').replace(/\/$/, '');
const ELEVATION_ENDPOINTS = [
  OPEN_ELEVATION_API_URL,
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
const ITM_RASTER_TIMEOUT_MS = 180000;
const ITM_API_MIN_DISTANCE_KM = 1;
const ITM_API_DISTANCE_STEP_KM = 0.5;
const ITM_API_MAX_FREQUENCY_MHZ = 20000;
const MIN_PREDICTION_RANGE_KM = 1;
const MAX_PREDICTION_RANGE_KM = SAMPLING_INTERVALS_KM[SAMPLING_INTERVALS_KM.length - 1];

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
const escapeCsvCell = (value) => {
  if (value === null || typeof value === 'undefined') return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const toGeoJsonPolygonRing = (points) => {
  if (!Array.isArray(points) || points.length < 3) return null;
  const ring = points.map(([lat, lon]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return ring;
};
const PDF_LINES_PER_PAGE = 44;
const PDF_MAX_LINE_CHARS = 90;
const PDF_DOWNLOAD_REVOKE_DELAY_MS = 1000;
const PDF_PAGE_WIDTH = 595;
const PDF_PAGE_HEIGHT = 842;
const PDF_MARGIN = 50;
const sanitizePdfText = (value) => String(value ?? '')
  .replace(/\t/g, '  ')
  .replace(/[^\x20-\x7E]/g, '?');
const escapePdfText = (value) => sanitizePdfText(value)
  .replace(/\\/g, '\\\\')
  .replace(/\(/g, '\\(')
  .replace(/\)/g, '\\)');
const wrapPdfLine = (value, maxChars = PDF_MAX_LINE_CHARS) => {
  const line = sanitizePdfText(value);
  if (line.length <= maxChars) return [line];

  const indent = line.match(/^\s*/)?.[0] ?? '';
  const contentMaxChars = Math.max(1, maxChars - indent.length);
  const words = line.trim().split(/\s+/);
  const wrappedLines = [];
  let currentLine = indent;

  words.forEach((word) => {
    const separator = currentLine.trim() ? ' ' : '';
    const candidate = `${currentLine}${separator}${word}`;
    if (candidate.length <= maxChars) {
      currentLine = candidate;
      return;
    }

    if (currentLine.trim()) wrappedLines.push(currentLine);
    if (word.length <= contentMaxChars) {
      currentLine = `${indent}${word}`;
      return;
    }

    for (let index = 0; index < word.length; index += contentMaxChars) {
      wrappedLines.push(`${indent}${word.slice(index, index + contentMaxChars)}`);
    }
    currentLine = indent;
  });

  if (currentLine.trim() || !wrappedLines.length) wrappedLines.push(currentLine);
  return wrappedLines;
};
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), PDF_DOWNLOAD_REVOKE_DELAY_MS);
};
const concatUint8Arrays = (arrays) => {
  const totalLength = arrays.reduce((total, array) => total + array.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  arrays.forEach((array) => {
    merged.set(array, offset);
    offset += array.length;
  });
  return merged;
};
const dataUrlToBytes = (dataUrl) => {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};
const encodePdfBody = (body, encoder) => {
  if (body instanceof Uint8Array) return body;
  if (Array.isArray(body)) {
    return concatUint8Arrays(body.map((part) => encodePdfBody(part, encoder)));
  }
  return encoder.encode(String(body));
};
const buildPdfTextStream = (lines, x = PDF_MARGIN, y = 800, fontSize = 10, lineHeight = 14) => [
  'BT',
  `/F1 ${fontSize} Tf`,
  `${x} ${y} Td`,
  `${lineHeight} TL`,
  ...lines.map((line, lineIndex) => (
    lineIndex === 0
      ? `(${escapePdfText(line)}) Tj`
      : `T* (${escapePdfText(line)}) Tj`
  )),
  'ET',
].join('\n');
const createSimplePdf = (title, sections, options = {}) => {
  const rawLines = [
    title,
    `Generated: ${new Date().toISOString()}`,
    '',
    ...sections.flatMap((section) => [
      section.heading.toUpperCase(),
      ...section.lines,
      '',
    ]),
  ];
  const lines = rawLines.flatMap((line) => wrapPdfLine(line));
  const pages = [];
  for (let index = 0; index < lines.length; index += PDF_LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + PDF_LINES_PER_PAGE));
  }

  const encoder = new TextEncoder();
  const objects = [''];
  const pageObjectNumbers = [];
  const contentObjectNumbers = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length - 1;
  };
  let mapImageNumber = null;
  let mapImagePage = null;

  if (options.mapImage?.bytes?.length && options.mapImage.width > 0 && options.mapImage.height > 0) {
    const image = options.mapImage;
    mapImageNumber = addObject([
      `<< /Type /XObject /Subtype /Image /Width ${Math.round(image.width)} /Height ${Math.round(image.height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      image.bytes,
      '\nendstream',
    ]);
    const imageWidthPt = PDF_PAGE_WIDTH - (PDF_MARGIN * 2);
    const imageHeightPt = Math.min(360, imageWidthPt * (image.height / image.width));
    const imageX = PDF_MARGIN;
    const imageY = 405;
    const captionLines = [
      `Map snapshot: ${options.mapImage.caption ?? 'Current coverage viewport'}`,
      `Coverage source: ${options.mapImage.coverageSource ?? 'map overlay'}`,
    ];
    const stream = [
      buildPdfTextStream([
        title,
        `Generated: ${new Date().toISOString()}`,
      ], PDF_MARGIN, 800, 12, 16),
      'q',
      `${imageWidthPt.toFixed(2)} 0 0 ${imageHeightPt.toFixed(2)} ${imageX.toFixed(2)} ${imageY.toFixed(2)} cm`,
      '/Im1 Do',
      'Q',
      buildPdfTextStream(captionLines, PDF_MARGIN, Math.max(72, imageY - 22), 9, 12),
    ].join('\n');
    const contentNumber = addObject(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
    mapImagePage = { contentNumber, usesMapImage: true };
  }

  pages.forEach((pageLines) => {
    const stream = buildPdfTextStream(pageLines);
    const contentNumber = addObject(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
    contentObjectNumbers.push(contentNumber);
    pageObjectNumbers.push(null);
  });

  const pageDescriptors = [
    ...(mapImagePage ? [mapImagePage] : []),
    ...contentObjectNumbers.map((contentNumber) => ({ contentNumber, usesMapImage: false })),
  ];
  const pagesNumber = objects.length + pageDescriptors.length;
  const fontNumber = pagesNumber + 1;
  const catalogNumber = fontNumber + 1;

  pageDescriptors.forEach((pageDescriptor, index) => {
    const xObjectResource = pageDescriptor.usesMapImage && mapImageNumber
      ? ` /XObject << /Im1 ${mapImageNumber} 0 R >>`
      : '';
    pageObjectNumbers[index] = addObject(`<< /Type /Page /Parent ${pagesNumber} 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontNumber} 0 R >>${xObjectResource} >> /Contents ${pageDescriptor.contentNumber} 0 R >>`);
  });
  addObject(`<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pageObjectNumbers.length} >>`);
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  addObject(`<< /Type /Catalog /Pages ${pagesNumber} 0 R >>`);

  const pdf = '%PDF-1.4\n';
  const offsets = [0];
  const chunks = [];
  let byteLength = 0;
  const pushBytes = (bytes) => {
    chunks.push(bytes);
    byteLength += bytes.length;
  };
  const pushString = (value) => pushBytes(encoder.encode(value));

  pushString(pdf);
  objects.slice(1).forEach((body, index) => {
    offsets.push(byteLength);
    pushString(`${index + 1} 0 obj\n`);
    pushBytes(encodePdfBody(body, encoder));
    pushString('\nendobj\n');
  });
  const xrefOffset = byteLength;
  let trailer = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    trailer += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  trailer += `trailer\n<< /Size ${objects.length} /Root ${catalogNumber} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  pushString(trailer);
  return concatUint8Arrays(chunks);
};
const getTerrainProfileCacheKey = ([lat, lon], radialCount = RADIALS_COUNT) => [
  normalizeCoordinate(lat),
  normalizeCoordinate(lon),
  radialCount,
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
  rasterCells: [],
  coverageSource: 'radial-polygon',
  areas: { ...EMPTY_AREAS },
});

const siteHasPredictionState = (site) => (
  ['analyzing', 'analyzed', 'degraded', 'failed'].includes(site?.status) ||
  Object.values(site?.coveragePolygons ?? {}).some((polygon) => polygon?.length >= 3) ||
  (site?.rasterCells?.length ?? 0) > 0
);

const siteHasUsableCoverage = (site) => (
  ['analyzed', 'degraded'].includes(site?.status) &&
  (
    Object.values(site?.coveragePolygons ?? {}).some((polygon) => polygon?.length >= 3) ||
    (site?.rasterCells?.length ?? 0) > 0
  )
);

const resetSitePrediction = (site, status = 'pending') => ({
  ...site,
  status,
  confidence: null,
  avgMarginDb: null,
  coveragePolygons: { ...EMPTY_POLYGONS },
  rasterCells: [],
  coverageSource: 'radial-polygon',
  rasterEngine: null,
  rasterStats: null,
  areas: { ...EMPTY_AREAS },
  itmRadialLosses: null,
  itmWarningSamples: 0,
  itmErrorSamples: 0,
  radioMobileRows: [],
  failedChunks: 0,
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
const microvoltsToDbm = (microvolts, impedanceOhms = 50) => {
  const volts = Math.max(0.001, microvolts) * 1e-6;
  return 10 * Math.log10(((volts ** 2) / impedanceOhms) * 1000);
};
const dbmToMicrovolts = (dbm, impedanceOhms = 50) => {
  const watts = 10 ** ((dbm - 30) / 10);
  return Math.sqrt(watts * impedanceOhms) * 1e6;
};
const calculateNoiseFloorDbm = (bandwidthHz, noiseFigureDb = 6) => (
  -174 + 10 * Math.log10(Math.max(1, bandwidthHz)) + noiseFigureDb
);
const calculateRequiredSignalDbm = ({ bandwidthHz, noiseFigureDb, requiredSnrDb }) => (
  calculateNoiseFloorDbm(bandwidthHz, noiseFigureDb) + requiredSnrDb
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

const createCoverageRasterCells = ({ sitePosition, polygons, maxRangeKm, cellKm = COVERAGE_RASTER_CELL_KM }) => {
  if (!sitePosition || !polygons?.weak?.length) return [];

  const [siteLat, siteLon] = sitePosition;
  const latStep = cellKm / 111.32;
  const lonKmPerDegree = Math.max(20, 111.32 * Math.cos(siteLat * Math.PI / 180));
  const lonStep = cellKm / lonKmPerDegree;
  const halfLat = latStep / 2;
  const halfLon = lonStep / 2;
  const gridRadius = Math.ceil(maxRangeKm / cellKm);
  const gradeOrder = ['strong', 'moderate', 'weak'];
  const cells = [];

  for (let latIndex = -gridRadius; latIndex <= gridRadius; latIndex++) {
    const lat = siteLat + latIndex * latStep;

    for (let lonIndex = -gridRadius; lonIndex <= gridRadius; lonIndex++) {
      const lon = siteLon + lonIndex * lonStep;
      const center = [lat, lon];
      if (haversineDistanceKm(sitePosition, center) > maxRangeKm) continue;

      const gradeKey = gradeOrder.find((key) => pointInPolygon(center, polygons[key]));
      if (!gradeKey) continue;

      cells.push({
        id: `${gradeKey}-${latIndex}-${lonIndex}`,
        gradeKey,
        bounds: [
          [lat - halfLat, lon - halfLon],
          [lat - halfLat, lon + halfLon],
          [lat + halfLat, lon + halfLon],
          [lat + halfLat, lon - halfLon],
        ],
      });
    }
  }

  return cells;
};

const hexToRgba = (hex, opacity = 1) => {
  const value = String(hex ?? '#000000').replace('#', '');
  const normalized = value.length === 3
    ? value.split('').map((char) => `${char}${char}`).join('')
    : value.padEnd(6, '0').slice(0, 6);
  const numeric = Number.parseInt(normalized, 16);
  const red = (numeric >> 16) & 255;
  const green = (numeric >> 8) & 255;
  const blue = numeric & 255;
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
};

const drawSnapshotPolygon = (ctx, points, { fillStyle, strokeStyle, lineWidth = 1, dashArray = [] }) => {
  if (!points?.length) return;
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dashArray);
  ctx.stroke();
  ctx.setLineDash([]);
};

const drawSnapshotBackground = (ctx, width, height, mapTilesAvailable) => {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#d8eef8');
  gradient.addColorStop(1, '#e9efe1');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(72, 104, 120, 0.16)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (!mapTilesAvailable) {
    ctx.fillStyle = 'rgba(39, 53, 61, 0.72)';
    ctx.font = '18px Helvetica, Arial, sans-serif';
    ctx.fillText('Map tiles unavailable for PDF snapshot', 24, 34);
    ctx.font = '13px Helvetica, Arial, sans-serif';
    ctx.fillText('Coverage overlay and site markers are still shown.', 24, 56);
  }
};

const drawLeafletTiles = (ctx, map, scaleX, scaleY) => {
  const container = map.getContainer();
  const mapRect = container.getBoundingClientRect();
  const tiles = Array.from(container.querySelectorAll('.leaflet-tile-loaded'));

  tiles.forEach((tile) => {
    if (!tile.complete || tile.naturalWidth === 0) return;
    const rect = tile.getBoundingClientRect();
    const sourceX = Math.max(0, mapRect.left - rect.left);
    const sourceY = Math.max(0, mapRect.top - rect.top);
    const sourceWidth = Math.min(rect.right, mapRect.right) - Math.max(rect.left, mapRect.left);
    const sourceHeight = Math.min(rect.bottom, mapRect.bottom) - Math.max(rect.top, mapRect.top);
    if (sourceWidth <= 0 || sourceHeight <= 0) return;

    const destX = (Math.max(rect.left, mapRect.left) - mapRect.left) * scaleX;
    const destY = (Math.max(rect.top, mapRect.top) - mapRect.top) * scaleY;
    ctx.drawImage(
      tile,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      destX,
      destY,
      sourceWidth * scaleX,
      sourceHeight * scaleY,
    );
  });
};

const drawCoverageSnapshot = ({ ctx, map, width, height, scaleX, scaleY, sites, serviceGrades, coverageRenderMode, activeSiteId }) => {
  const toPoint = (position) => {
    const point = map.latLngToContainerPoint(L.latLng(position[0], position[1]));
    return [point.x * scaleX, point.y * scaleY];
  };
  const inView = ([x, y], buffer = 40) => x >= -buffer && x <= width + buffer && y >= -buffer && y <= height + buffer;

  serviceGrades.forEach((grade) => {
    sites.forEach((site) => {
      if (coverageRenderMode === 'raster' && (site.coverageSource === 'per-cell-raster' || site.rasterCells?.length)) {
        site.rasterCells
          ?.filter((cell) => cell.gradeKey === grade.key)
          .forEach((cell) => {
            const points = cell.bounds.map(toPoint);
            if (!points.some((point) => inView(point))) return;
            drawSnapshotPolygon(ctx, points, {
              fillStyle: hexToRgba(grade.color, Math.min(0.52, grade.fillOpacity + 0.18)),
              strokeStyle: hexToRgba(grade.color, 0.18),
              lineWidth: 0.5,
            });
          });
        return;
      }

      const polygon = site.coveragePolygons?.[grade.key];
      if (!polygon?.length) return;
      const points = polygon.map(toPoint);
      if (!points.some((point) => inView(point))) return;
      drawSnapshotPolygon(ctx, points, {
        fillStyle: hexToRgba(grade.color, grade.fillOpacity),
        strokeStyle: grade.color,
        lineWidth: site.id === activeSiteId ? 2.2 : 1.4,
        dashArray: grade.dashArray ? [5, 4] : [],
      });
    });
  });

  sites.forEach((site) => {
    const [x, y] = toPoint(site.position);
    if (!inView([x, y], 24)) return;
    ctx.beginPath();
    ctx.arc(x, y, site.id === activeSiteId ? 10 : 8, 0, Math.PI * 2);
    ctx.fillStyle = site.color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(site.id), x, y);
  });
};

const drawSnapshotLegend = ({ ctx, width, height, map, scaleX, serviceGrades }) => {
  const legendWidth = 172;
  const legendHeight = 24 + serviceGrades.length * 18;
  const x = width - legendWidth - 14;
  const y = height - legendHeight - 14;
  ctx.fillStyle = 'rgba(20, 30, 36, 0.78)';
  ctx.fillRect(x, y, legendWidth, legendHeight);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Coverage legend', x + 10, y + 14);
  serviceGrades.forEach((grade, index) => {
    const rowY = y + 34 + index * 18;
    ctx.fillStyle = grade.color;
    ctx.fillRect(x + 10, rowY - 5, 10, 10);
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px Helvetica, Arial, sans-serif';
    ctx.fillText(`${grade.label} >= ${grade.thresholdDbm.toFixed(0)} dBm`, x + 28, rowY);
  });

  ctx.save();
  ctx.translate(width - 34, 34);
  ctx.fillStyle = 'rgba(20, 30, 36, 0.78)';
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(7, 8);
  ctx.lineTo(0, 4);
  ctx.lineTo(-7, 8);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 10px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 0, -2);
  ctx.restore();

  try {
    const center = map.getCenter();
    const start = map.latLngToContainerPoint(center);
    const endLatLng = getDestinationPoint(center.lat, center.lng, 90, 10);
    const end = map.latLngToContainerPoint(L.latLng(endLatLng[0], endLatLng[1]));
    const scaleWidth = Math.abs(end.x - start.x) * scaleX;
    if (Number.isFinite(scaleWidth) && scaleWidth > 12 && scaleWidth < width * 0.5) {
      const scaleXPos = 24;
      const scaleYPos = height - 56;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(scaleXPos, scaleYPos);
      ctx.lineTo(scaleXPos + scaleWidth, scaleYPos);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('10 km', scaleXPos, scaleYPos - 9);
    }
  } catch {
    // Map scale is decorative in PDF export; ignore if Leaflet cannot project it.
  }
};

const captureMapSnapshot = async ({ map, sites, serviceGrades, coverageRenderMode, activeSiteId }) => {
  if (!map) return null;

  const mapSize = map.getSize();
  if (!mapSize?.x || !mapSize?.y) return null;

  const scale = Math.min(1000 / mapSize.x, 560 / mapSize.y, 1.5);
  const width = Math.max(320, Math.round(mapSize.x * scale));
  const height = Math.max(220, Math.round(mapSize.y * scale));
  const scaleX = width / mapSize.x;
  const scaleY = height / mapSize.y;

  const renderCanvas = (includeTiles) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    drawSnapshotBackground(ctx, width, height, includeTiles);
    if (includeTiles) drawLeafletTiles(ctx, map, scaleX, scaleY);
    drawCoverageSnapshot({ ctx, map, width, height, scaleX, scaleY, sites, serviceGrades, coverageRenderMode, activeSiteId });
    drawSnapshotLegend({ ctx, width, height, map, scaleX, serviceGrades });

    ctx.fillStyle = 'rgba(20, 30, 36, 0.7)';
    ctx.fillRect(12, height - 34, 260, 22);
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('9M2PJU Coverage Prediction', 22, height - 23);
    return canvas;
  };

  let canvas = renderCanvas(true);
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    return {
      bytes: dataUrlToBytes(dataUrl),
      width,
      height,
      caption: 'Current Leaflet map viewport with coverage overlay',
      coverageSource: coverageRenderMode === 'raster' ? 'Raster cells' : 'Radial polygons',
    };
  } catch (error) {
    console.warn('Map tile snapshot was blocked; exporting coverage overlay only.', error);
    canvas = renderCanvas(false);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    return {
      bytes: dataUrlToBytes(dataUrl),
      width,
      height,
      caption: 'Coverage overlay snapshot',
      coverageSource: 'Map tiles blocked by browser CORS; overlay rendered without tile imagery',
    };
  }
};

const normalizeBearingDelta = (bearing, centerBearing) => {
  const delta = Math.abs(((bearing - centerBearing + 540) % 360) - 180);
  return delta;
};

const normalizeRelativeBearing = (bearing, centerBearing) => (
  ((bearing - centerBearing + 360) % 360)
);

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
  const patternLoss = interpolateAntennaPatternLoss(normalizeRelativeBearing(bearing, antennaAzimuth), antennaPattern);
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

const calculateTwoRayLoss = ({ freq, distanceKm, hTx, hRx }) => {
  if (distanceKm <= 0) return 0;
  const wavelengthM = 300 / clamp(freq, MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ);
  const breakpointKm = Math.max(0.1, (4 * Math.max(0.5, hTx) * Math.max(0.5, hRx)) / wavelengthM / 1000);
  if (distanceKm <= breakpointKm) return 0;
  return clamp(6 * Math.log10(distanceKm / breakpointKm), 0, 18);
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
  useTwoRay,
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
    calculateAtmosphericLoss(freq, distanceKm, atmosphericLossDbPerKm) +
    (useTwoRay ? calculateTwoRayLoss({ freq, distanceKm, hTx, hRx }) : 0);
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
  useTwoRay,
  maxRangeKm = MAX_PREDICTION_RANGE_KM,
}) => {
  const searchDistances = RELIABILITY_CHECK_DISTANCES_KM.filter((distanceKm) => distanceKm <= maxRangeKm);
  let low = RELIABILITY_CHECK_DISTANCES_KM[0];
  let high = maxRangeKm;

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
    useTwoRay,
  }) > targetLoss) {
    return low;
  }

  for (const distanceKm of searchDistances.slice(1)) {
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
      useTwoRay,
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
      useTwoRay,
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
  useTwoRay,
}) => {
  if (!terrainProfile?.radialSampleSets?.length) return null;

  const bearing = calculateBearingDegrees(site.position, measurement.position);
  const radialCount = terrainProfile.radialSampleSets.length;
  const radialIndex = Math.round(bearing / (360 / radialCount)) % radialCount;
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
      hTx,
      hRx,
      clutterLossDb,
      sitePosition: site.position,
      bearing,
      clutterMap,
      rainRateMmH,
      atmosphericLossDbPerKm,
      useTwoRay,
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
      useTwoRay,
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

const createItmDistanceGrid = (maxRangeKm = MAX_PREDICTION_RANGE_KM) => {
  const cappedRangeKm = Math.max(ITM_API_MIN_DISTANCE_KM, maxRangeKm);
  const distances = new Set([ITM_API_MIN_DISTANCE_KM, cappedRangeKm]);
  for (let distanceKm = ITM_API_MIN_DISTANCE_KM + ITM_API_DISTANCE_STEP_KM; distanceKm <= cappedRangeKm; distanceKm += ITM_API_DISTANCE_STEP_KM) {
    distances.add(Number(distanceKm.toFixed(3)));
  }
  SAMPLING_INTERVALS_KM.forEach((distanceKm) => {
    if (distanceKm >= ITM_API_MIN_DISTANCE_KM && distanceKm <= cappedRangeKm) distances.add(distanceKm);
  });
  return [...distances].filter((distanceKm) => distanceKm >= ITM_API_MIN_DISTANCE_KM && distanceKm <= cappedRangeKm).sort((a, b) => a - b);
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

const fetchPerCellRasterCoverage = async ({
  site,
  freq,
  hTx,
  hRx,
  powerDbm,
  gain,
  rxAntennaGain,
  systemLossDb,
  activeClutterLossDb,
  maxRangeKm,
  serviceGrades,
  confidence,
  reliability,
  antennaAzimuth,
  antennaBeamwidth,
  frontBackRatio,
  antennaPattern,
  rainRateMmH,
  atmosphericLossDbPerKm,
  useTwoRay,
  rasterCellKm = COVERAGE_RASTER_CELL_KM,
}) => {
  if (!ITM_API_URL || freq > ITM_API_MAX_FREQUENCY_MHZ) return null;
  const thresholdsDbm = serviceGrades.reduce((thresholds, grade) => ({
    ...thresholds,
    [grade.key]: grade.thresholdDbm,
  }), {});

  const resp = await fetchWithTimeout(`${ITM_API_URL}/coverage/raster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      site: {
        lat: site.position[0],
        lon: site.position[1],
        elevationM: site.elevation,
      },
      frequencyMhz: freq,
      txHeightM: hTx,
      rxHeightM: hRx,
      txPowerDbm: powerDbm,
      txGainDbi: gain,
      rxGainDbi: rxAntennaGain,
      systemLossDb,
      clutterLossDb: activeClutterLossDb,
      maxRangeKm,
      cellSizeKm: rasterCellKm,
      profileStepKm: 2,
      thresholdsDbm,
      confidence,
      reliability,
      climate: 1,
      polarization: 1,
      groundPermittivity: 15,
      groundConductivity: 0.005,
      surfaceRefractivity: 301,
        antenna: {
          azimuth: antennaAzimuth,
          beamwidth: antennaBeamwidth,
          frontBackRatio,
          patternPoints: antennaPattern?.points ?? [],
        },
      rainRateMmH,
      atmosphericLossDbPerKm,
      useTwoRay,
    }),
  }, ITM_RASTER_TIMEOUT_MS);

  if (!resp.ok) throw new Error(`ITM raster API failed: ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data.cells) || !data.areas) throw new Error('ITM raster API returned no cell result');
  return data;
};

const getItmApiPathLoss = (itmLossMap, distanceKm) => {
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

const calculateExternalLosses = ({
  freq,
  distanceKm,
  hTx,
  hRx,
  clutterLossDb,
  sitePosition,
  bearing,
  clutterMap,
  rainRateMmH,
  atmosphericLossDbPerKm,
  useTwoRay,
}) => (
  clutterLossDb +
  calculateMappedClutterLoss({ sitePosition, bearing, distanceKm, clutterMap }) +
  calculateShfRainLoss(freq, distanceKm, rainRateMmH) +
  calculateAtmosphericLoss(freq, distanceKm, atmosphericLossDbPerKm) +
  (useTwoRay ? calculateTwoRayLoss({ freq, distanceKm, hTx, hRx }) : 0)
);

const findReliableDistanceFromLossMap = ({
  itmLossMap,
  freq,
  hTx,
  hRx,
  targetLoss,
  clutterLossDb,
  sitePosition,
  bearing,
  clutterMap,
  rainRateMmH,
  atmosphericLossDbPerKm,
  useTwoRay,
}) => {
  if (!itmLossMap?.length) return null;
  let lastPassing = itmLossMap[0].distanceKm;
  let lastLoss = itmLossMap[0].lossDb + calculateExternalLosses({
    freq,
    distanceKm: itmLossMap[0].distanceKm,
    hTx,
    hRx,
    clutterLossDb,
    sitePosition,
    bearing,
    clutterMap,
    rainRateMmH,
    atmosphericLossDbPerKm,
    useTwoRay,
  });

  if (lastLoss > targetLoss) return null;

  for (let index = 1; index < itmLossMap.length; index++) {
    const sample = itmLossMap[index];
    const totalLoss = sample.lossDb + calculateExternalLosses({
      freq,
      distanceKm: sample.distanceKm,
      hTx,
      hRx,
      clutterLossDb,
      sitePosition,
      bearing,
      clutterMap,
      rainRateMmH,
      atmosphericLossDbPerKm,
      useTwoRay,
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

const geoJsonRingToLatLon = (ring) => ring.map(([lon, lat]) => [lat, lon]);

const pointInGeoJsonRingSet = (position, rings) => {
  if (!Array.isArray(rings) || !rings.length) return false;
  const [outerRing, ...holeRings] = rings;
  if (!pointInPolygon(position, geoJsonRingToLatLon(outerRing))) return false;
  return !holeRings.some((ring) => pointInPolygon(position, geoJsonRingToLatLon(ring)));
};

const pointInGeoJsonFeature = (position, feature) => {
  const geometry = feature?.geometry;
  if (!geometry) return false;

  if (geometry.type === 'Polygon') {
    return pointInGeoJsonRingSet(position, geometry.coordinates);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((rings) => pointInGeoJsonRingSet(position, rings));
  }

  return false;
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

const RASTER_GRADE_RANK = { weak: 1, moderate: 2, strong: 3 };
const getCoverageGeometryForGrade = (site, gradeKey) => {
  if (site.coverageSource === 'per-cell-raster' && site.rasterCells?.length) {
    const minimumRank = RASTER_GRADE_RANK[gradeKey] ?? 0;
    return site.rasterCells
      .filter((cell) => (RASTER_GRADE_RANK[cell.gradeKey] ?? 0) >= minimumRank)
      .map((cell) => cell.bounds)
      .filter((bounds) => bounds?.length >= 3);
  }

  const polygon = site.coveragePolygons?.[gradeKey];
  return polygon?.length >= 3 ? [polygon] : [];
};

const calculateCombinedCoverageAreas = (sites) => ({
  strong: calculateUnionAreaKm2(sites.flatMap((site) => getCoverageGeometryForGrade(site, 'strong'))),
  moderate: calculateUnionAreaKm2(sites.flatMap((site) => getCoverageGeometryForGrade(site, 'moderate'))),
  weak: calculateUnionAreaKm2(sites.flatMap((site) => getCoverageGeometryForGrade(site, 'weak'))),
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
    const className = String(
      feature.properties?.class ??
      feature.properties?.landcover ??
      feature.properties?.land_use ??
      feature.properties?.landuse ??
      feature.properties?.type ??
      feature.properties?.name ??
      '',
    ).toLowerCase().replace(/\s+/g, '_');
    const lossDb = Number(
      feature.properties?.lossDb ??
      feature.properties?.loss_db ??
      feature.properties?.clutterLoss ??
      feature.properties?.rf_loss_db ??
      CLUTTER_CLASS_LOSS_DB[className] ??
      0,
    );
    return Number.isFinite(lossDb)
      ? { ...feature, lossDb: clamp(lossDb, 0, 40), clutterClass: className || 'custom' }
      : null;
  }).filter((feature) => feature && ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type));

  return features.length ? { features } : null;
};

const parseLocalDemText = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const data = JSON.parse(trimmed);
    const rawItems = Array.isArray(data)
      ? data
      : data.type === 'FeatureCollection'
        ? data.features
        : data.results ?? data.points ?? [];
    return rawItems.map((item) => {
      if (item.geometry?.type === 'Point') {
        const [lon, lat] = item.geometry.coordinates ?? [];
        return {
          lat: Number(lat),
          lon: Number(lon),
          elevation: Number(item.properties?.elevation ?? item.properties?.elevationM ?? item.properties?.ele),
        };
      }
      return {
        lat: Number(item.lat ?? item.latitude),
        lon: Number(item.lon ?? item.lng ?? item.longitude),
        elevation: Number(item.elevation ?? item.elevationM ?? item.ele),
      };
    }).filter(({ lat, lon, elevation }) => [lat, lon, elevation].every(Number.isFinite));
  } catch {
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map((header) => header.trim().toLowerCase());
    const latIndex = headers.findIndex((header) => ['lat', 'latitude'].includes(header));
    const lonIndex = headers.findIndex((header) => ['lon', 'lng', 'longitude'].includes(header));
    const elevationIndex = headers.findIndex((header) => ['elevation', 'elevationm', 'ele', 'height'].includes(header));
    if (latIndex < 0 || lonIndex < 0 || elevationIndex < 0) return [];
    return lines.slice(1).map((line) => {
      const cells = line.split(',').map((cell) => cell.trim());
      return {
        lat: Number(cells[latIndex]),
        lon: Number(cells[lonIndex]),
        elevation: Number(cells[elevationIndex]),
      };
    }).filter(({ lat, lon, elevation }) => [lat, lon, elevation].every(Number.isFinite));
  }
};

const parseRadioMobileComparisonCsv = (text) => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((header) => header.trim().toLowerCase());
  const findHeader = (names) => headers.findIndex((header) => names.includes(header));
  const bearingIndex = findHeader(['bearing', 'bearingdeg', 'azimuth', 'azimuthdeg', 'deg']);
  const strongIndex = findHeader(['strong', 'strongkm', 'strongreachkm', 'strong_distance_km']);
  const moderateIndex = findHeader(['moderate', 'moderatekm', 'moderatereachkm', 'moderate_distance_km']);
  const weakIndex = findHeader(['fringe', 'fringekm', 'fringereachkm', 'weak', 'weakkm', 'weakreachkm', 'distancekm']);
  if (bearingIndex < 0 || weakIndex < 0) return [];

  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const bearingDeg = Number(cells[bearingIndex]);
    const weakReachKm = Number(cells[weakIndex]);
    if (!Number.isFinite(bearingDeg) || !Number.isFinite(weakReachKm)) return null;
    return {
      bearingDeg: ((bearingDeg % 360) + 360) % 360,
      strongReachKm: Number(cells[strongIndex]),
      moderateReachKm: Number(cells[moderateIndex]),
      weakReachKm,
    };
  }).filter(Boolean);
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

const summarizeNumericErrors = (errors, withinTolerances = [3, 5, 10]) => {
  const valid = errors.filter(Number.isFinite);
  if (!valid.length) {
    return {
      count: 0,
      meanError: 0,
      mae: 0,
      rmse: 0,
      maxAbs: 0,
      within: withinTolerances.reduce((acc, tolerance) => ({ ...acc, [tolerance]: 0 }), {}),
    };
  }

  const absErrors = valid.map(Math.abs);
  const meanError = valid.reduce((total, error) => total + error, 0) / valid.length;
  return {
    count: valid.length,
    meanError,
    mae: absErrors.reduce((total, error) => total + error, 0) / absErrors.length,
    rmse: Math.sqrt(valid.reduce((total, error) => total + error ** 2, 0) / valid.length),
    maxAbs: Math.max(...absErrors),
    within: withinTolerances.reduce((acc, tolerance) => ({
      ...acc,
      [tolerance]: valid.filter((error) => Math.abs(error) <= tolerance).length / valid.length * 100,
    }), {}),
  };
};

const findNearestBearingRow = (rows, bearingDeg) => {
  if (!rows?.length) return null;
  return rows.reduce((best, row) => {
    const diff = normalizeBearingDelta(row.bearingDeg, bearingDeg);
    return !best || diff < best.diff ? { row, diff } : best;
  }, null);
};

const createRadioMobileComparisonReport = (referenceRows, sites) => {
  const appRows = sites.flatMap((site) => site.radioMobileRows ?? []);
  if (!referenceRows?.length || !appRows.length) return null;
  const rows = [];

  referenceRows.forEach((referenceRow) => {
    const match = findNearestBearingRow(appRows, referenceRow.bearingDeg);
    if (!match || match.diff > 1.1) return;
    rows.push({
      bearingDeg: referenceRow.bearingDeg,
      bearingDeltaDeg: match.diff,
      strongErrorKm: Number.isFinite(referenceRow.strongReachKm) && Number.isFinite(match.row.strongReachKm)
        ? match.row.strongReachKm - referenceRow.strongReachKm
        : null,
      moderateErrorKm: Number.isFinite(referenceRow.moderateReachKm) && Number.isFinite(match.row.moderateReachKm)
        ? match.row.moderateReachKm - referenceRow.moderateReachKm
        : null,
      fringeErrorKm: match.row.weakReachKm - referenceRow.weakReachKm,
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    referenceRows: referenceRows.length,
    matchedRows: rows.length,
    strong: summarizeNumericErrors(rows.map((row) => row.strongErrorKm)),
    moderate: summarizeNumericErrors(rows.map((row) => row.moderateErrorKm)),
    fringe: summarizeNumericErrors(rows.map((row) => row.fringeErrorKm)),
    rows,
  };
};

const getSiteTrustProfile = (site) => {
  if (!site) {
    return { level: 'Pending', tone: 'warning', detail: 'Run coverage to calculate engine and terrain status.' };
  }
  if (site.status === 'failed') return { level: 'Failed', tone: 'error', detail: 'Prediction failed for this site.' };
  if (!siteHasUsableCoverage(site)) {
    return { level: 'Pending', tone: 'warning', detail: 'Run coverage to calculate engine and terrain status.' };
  }
  const stats = site.rasterStats ?? {};
  if ((site.itmErrorSamples ?? 0) > 0 || Number(stats.errorSamples ?? 0) > 0) {
    return { level: 'Flagged', tone: 'warning', detail: 'Native ITM returned error-code samples; inspect edges before relying on them.' };
  }
  if (site.coverageSource === 'per-cell-raster' && Number(stats.fallbackCells ?? 0) === 0) {
    return { level: 'Native raster ITM', tone: 'ready', detail: 'True per-cell raster path was used with native ITM where available.' };
  }
  if (site.itmRadialLosses?.some(Boolean) && (site.itmRadialLosses ?? []).every((losses) => losses?.length)) {
    return { level: 'Native radial ITM', tone: 'ready', detail: 'Radial boundaries were sampled with the ITM helper.' };
  }
  if (site.status === 'degraded' || (site.failedChunks ?? 0) > 0) {
    return { level: 'Fallback terrain', tone: 'warning', detail: 'Some elevation chunks failed and were filled with fallback terrain.' };
  }
  return { level: 'Planning fallback', tone: 'warning', detail: 'Local planning model or radial-derived raster was used.' };
};

const getSiteResultExplanation = (site) => {
  if (!site) return 'No active site selected.';
  const profile = getSiteTrustProfile(site);
  if (!siteHasUsableCoverage(site)) return `${profile.level}: ${profile.detail}`;
  const source = site.coverageSource === 'per-cell-raster' ? 'per-cell raster' : 'radial polygon';
  const terrainNote = (site.failedChunks ?? 0) > 0
    ? `${site.failedChunks} elevation chunk fallback${site.failedChunks > 1 ? 's' : ''}`
    : 'terrain samples available';
  return `${profile.level}: ${source}, ${terrainNote}, HAAT ${(site.haat ?? 0).toFixed(1)} m, fringe ${(site.areas?.weak ?? 0).toFixed(0)} km2.`;
};

const createTerrainSparklinePoints = (samples, width = 250, height = 54) => {
  if (!samples?.length) return '';
  const elevations = samples.map((sample) => sample.elevation).filter(Number.isFinite);
  if (!elevations.length) return '';
  const minElevation = Math.min(...elevations);
  const maxElevation = Math.max(...elevations);
  const elevationSpan = Math.max(1, maxElevation - minElevation);
  const maxDistance = Math.max(...samples.map((sample) => sample.distanceKm), 1);
  return samples.map((sample) => {
    const x = (sample.distanceKm / maxDistance) * width;
    const y = height - ((sample.elevation - minElevation) / elevationSpan) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
};

const formatDb = (value, digits = 1) => (
  Number.isFinite(value) ? `${value.toFixed(digits)} dB` : 'n/a'
);

const buildScenarioPayload = ({
  sites,
  activeSiteId,
  settings,
  measurements,
  mapNotes,
}) => ({
  app: '9M2PJU Coverage Prediction',
  version: APP_VERSION,
  exportedAt: new Date().toISOString(),
  activeSiteId,
  settings,
  sites: sites.map((site) => ({
    id: site.id,
    name: site.name,
    position: site.position,
    color: site.color,
    elevation: site.elevation,
  })),
  measurements,
  mapNotes,
});

function MapClickHandler({ onClick }) {
  useMapEvents({
    click: (e) => onClick([e.latlng.lat, e.latlng.lng]),
  });
  return null;
}

function MapInstanceTracker({ mapRef }) {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
    return () => {
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [map, mapRef]);

  return null;
}

function App() {
  const mapRef = useRef(null);
  const [sites, setSites] = useState(() => [
    createSite(1, [3.1390, 101.6869], SITE_COLORS[0]),
  ]);
  const [activeSiteId, setActiveSiteId] = useState(1);
  const [power, setPower] = useState(5);
  const [freq, setFreq] = useState(145);
  const [hTx, setHTx] = useState(10);
  const [gain, setGain] = useState(6);
  const [hRx, setHRx] = useState(10);
  const [modeKey, setModeKey] = useState('fm');
  const [propagationModel, setPropagationModel] = useState('ntiaItmApi');
  const [clutterKey, setClutterKey] = useState('suburban');
  const [txLineLoss, setTxLineLoss] = useState(3);
  const [rxLineLoss, setRxLineLoss] = useState(0.5);
  const [rxAntennaGain, setRxAntennaGain] = useState(2);
  const [fadeMargin, setFadeMargin] = useState(0);
  const [rxThresholdUv, setRxThresholdUv] = useState(0.5);
  const [thresholdMode, setThresholdMode] = useState('receiver');
  const [noiseFigureDb, setNoiseFigureDb] = useState(6);
  const [requiredSnrDb, setRequiredSnrDb] = useState(MODE_PROFILES.fm.defaultRequiredSnr);
  const [strongSignalMarginDb, setStrongSignalMarginDb] = useState(10);
  const [maxRangeKm, setMaxRangeKm] = useState(100);
  const [itmReliabilityPercent, setItmReliabilityPercent] = useState(70);
  const [itmConfidencePercent, setItmConfidencePercent] = useState(50);
  const [coverageRadialMode, setCoverageRadialMode] = useState('standard');
  const [coverageRenderMode, setCoverageRenderMode] = useState('polygon');
  const [rasterCellKm, setRasterCellKm] = useState(COVERAGE_RASTER_CELL_KM);
  const [useLandCover, setUseLandCover] = useState(false);
  const [useTwoRay, setUseTwoRay] = useState(false);
  const [antennaAzimuth, setAntennaAzimuth] = useState(0);
  const [antennaBeamwidth, setAntennaBeamwidth] = useState(360);
  const [frontBackRatio, setFrontBackRatio] = useState(0);
  const [antennaPattern, setAntennaPattern] = useState(null);
  const [patternNotice, setPatternNotice] = useState('Optional: import antenna pattern CSV with relative angle/lossDb or relative angle/gain_dBi.');
  const [clutterMap, setClutterMap] = useState(null);
  const [clutterMapNotice, setClutterMapNotice] = useState('Optional: import GeoJSON polygons with lossDb properties.');
  const [localDemNotice, setLocalDemNotice] = useState('Optional: import local DEM CSV/JSON with lat, lon, elevation.');
  const [radioMobileReferenceRows, setRadioMobileReferenceRows] = useState([]);
  const [radioMobileNotice, setRadioMobileNotice] = useState('Optional: import Radio Mobile bearing CSV for parity scoring.');
  const [rainRate, setRainRate] = useState(DEFAULT_SHF_RAIN_RATE_MM_H);
  const [atmosphericLoss, setAtmosphericLoss] = useState(DEFAULT_ATMOSPHERIC_LOSS_DB_PER_KM);
  const [calibrationOffset, setCalibrationOffset] = useState(0);
  const [calibrationEnabled, setCalibrationEnabled] = useState(false);
  const [measurements, setMeasurements] = useState([]);
  const [measurementNotice, setMeasurementNotice] = useState('Import CSV or GPX measurements for validation.');
  const [mapToolMode, setMapToolMode] = useState('place');
  const [queryPoint, setQueryPoint] = useState(null);
  const [mapNotes, setMapNotes] = useState([]);
  const [debugMode, setDebugMode] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [freqBand, setFreqBand] = useState('vhf');
  const [nextSiteId, setNextSiteId] = useState(2);
  const [analysisNotice, setAnalysisNotice] = useState('Ready for coverage prediction.');
  const [itmApiStatus, setItmApiStatus] = useState({ state: 'unchecked', message: `ITS ITM service: ${ITM_API_URL}` });
  const isAnalyzingRef = useRef(false);
  const predictionRevisionRef = useRef(0);
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
  const activeClutterLossDb = useLandCover ? clutterProfile.lossDb : 0;
  const activeClutterUncertaintyDb = useLandCover ? clutterProfile.uncertaintyDb : 0;
  const activeBand = BAND_OPTIONS.find((band) => band.key === freqBand) ?? BAND_OPTIONS[0];
  const activeRadialOption = COVERAGE_RADIAL_OPTIONS.find((option) => option.key === coverageRadialMode) ?? COVERAGE_RADIAL_OPTIONS[0];
  const activeRadialCount = activeRadialOption.radials;
  const receiverThresholdDbm = microvoltsToDbm(rxThresholdUv);
  const noiseFloorDbm = calculateNoiseFloorDbm(modeProfile.defaultBandwidth, noiseFigureDb);
  const noiseRequiredSignalDbm = calculateRequiredSignalDbm({
    bandwidthHz: modeProfile.defaultBandwidth,
    noiseFigureDb,
    requiredSnrDb,
  });
  const fringeThresholdDbm = thresholdMode === 'noiseFloor' ? noiseRequiredSignalDbm : receiverThresholdDbm;
  const serviceGrades = useMemo(() => GRADE_CONFIG.map((grade) => ({
    ...grade,
    thresholdDbm: grade.key === 'weak'
      ? fringeThresholdDbm
      : grade.key === 'strong'
        ? fringeThresholdDbm + strongSignalMarginDb
        : fringeThresholdDbm + strongSignalMarginDb / 2,
  })), [fringeThresholdDbm, strongSignalMarginDb]);
  const powerDbm = 10 * Math.log10(power * 1000);
  const combinedAreas = useMemo(() => calculateCombinedCoverageAreas(sites), [sites]);
  const activeSiteTrust = useMemo(() => getSiteTrustProfile(activeSite), [activeSite]);
  const activeSiteExplanation = useMemo(() => getSiteResultExplanation(activeSite), [activeSite]);
  const radioMobileComparisonReport = useMemo(
    () => createRadioMobileComparisonReport(radioMobileReferenceRows, sites),
    [radioMobileReferenceRows, sites],
  );

  const analyzedSites = sites.filter(siteHasUsableCoverage).length;
  const systemLossDb = txLineLoss + rxLineLoss + fadeMargin;
  const modelReliability = useMemo(() => getModelReliability({
    freq,
    hTx,
    hRx,
    propagationModel,
    fadeMargin,
  }), [fadeMargin, freq, hRx, hTx, propagationModel]);
  const confidenceScore = clamp(
    100 - activeClutterUncertaintyDb * 2 - fadeMargin * 0.7 - modelReliability.penalty - (propagationModel === 'ntiaItmApi' ? 2 : propagationModel === 'itmHybrid' ? 4 : 9),
    35,
    95,
  );
  const activeCalibrationOffset = calibrationEnabled ? calibrationOffset : 0;
  const scenarioSettings = useMemo(() => ({
    power,
    freq,
    hTx,
    hRx,
    gain,
    rxAntennaGain,
    txLineLoss,
    rxLineLoss,
    fadeMargin,
    rxThresholdUv,
    thresholdMode,
    noiseFigureDb,
    requiredSnrDb,
    strongSignalMarginDb,
    maxRangeKm,
    modeKey,
    propagationModel,
    clutterKey,
    useLandCover,
    useTwoRay,
    itmReliabilityPercent,
    itmConfidencePercent,
    coverageRadialMode,
    coverageRenderMode,
    rasterCellKm,
    antennaAzimuth,
    antennaBeamwidth,
    frontBackRatio,
    freqBand,
    rainRate,
    atmosphericLoss,
  }), [
    antennaAzimuth,
    antennaBeamwidth,
    atmosphericLoss,
    clutterKey,
    coverageRadialMode,
    coverageRenderMode,
    fadeMargin,
    freq,
    freqBand,
    frontBackRatio,
    gain,
    hRx,
    hTx,
    itmConfidencePercent,
    itmReliabilityPercent,
    maxRangeKm,
    modeKey,
    noiseFigureDb,
    power,
    propagationModel,
    rainRate,
    rasterCellKm,
    requiredSnrDb,
    rxAntennaGain,
    rxLineLoss,
    rxThresholdUv,
    strongSignalMarginDb,
    thresholdMode,
    txLineLoss,
    useLandCover,
    useTwoRay,
  ]);
  const multiBandPreview = useMemo(() => BAND_OPTIONS.map((band) => {
    const lossDb = calculatePathLoss(band.defaultFreq, Math.max(hTx, activeSite?.haat ?? hTx), hRx, maxRangeKm);
    const marginDb = powerDbm + gain + rxAntennaGain - systemLossDb - lossDb - fringeThresholdDbm;
    return {
      ...band,
      lossDb,
      marginDb,
    };
  }), [activeSite?.haat, fringeThresholdDbm, gain, hRx, hTx, maxRangeKm, powerDbm, rxAntennaGain, systemLossDb]);
  const isStationPresetActive = useCallback((preset) => (
    Math.abs(power - preset.power) < 0.001 &&
    Math.abs(hTx - preset.hTx) < 0.001 &&
    Math.abs(hRx - preset.hRx) < 0.001 &&
    Math.abs(gain - preset.gain) < 0.001 &&
    Math.abs(rxAntennaGain - preset.rxAntennaGain) < 0.001 &&
    Math.abs(fadeMargin - preset.fadeMargin) < 0.001 &&
    (!preset.modeKey || modeKey === preset.modeKey) &&
    (!preset.freqBand || freqBand === preset.freqBand) &&
    (!preset.freq || Math.abs(freq - preset.freq) < 0.001) &&
    (typeof preset.useTwoRay !== 'boolean' || useTwoRay === preset.useTwoRay)
  ), [fadeMargin, freq, freqBand, gain, hRx, hTx, modeKey, power, rxAntennaGain, useTwoRay]);
  const isSampleScenarioActive = useCallback((scenario) => (
    activeSite &&
    Math.abs(activeSite.position[0] - scenario.position[0]) < 0.0001 &&
    Math.abs(activeSite.position[1] - scenario.position[1]) < 0.0001 &&
    Math.abs(freq - scenario.freq) < 0.001 &&
    Math.abs(hTx - scenario.hTx) < 0.001 &&
    Math.abs(hRx - scenario.hRx) < 0.001 &&
    Math.abs(maxRangeKm - scenario.maxRangeKm) < 0.001 &&
    clutterKey === scenario.clutterKey
  ), [activeSite, clutterKey, freq, hRx, hTx, maxRangeKm]);
  const validationReport = useMemo(() => {
    const comparisons = measurements.map((measurement) => {
      let bestMatch = null;

      sites.forEach((site) => {
        const terrainProfile = terrainProfileCacheRef.current.get(getTerrainProfileCacheKey(site.position, site.coverageRadials ?? activeRadialCount));
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
          clutterLossDb: activeClutterLossDb,
          calibrationOffsetDb: activeCalibrationOffset,
          antennaPattern,
          antennaAzimuth,
          antennaBeamwidth,
          frontBackRatio,
          clutterMap: useLandCover ? clutterMap : null,
          rainRateMmH: rainRate,
          atmosphericLossDbPerKm: atmosphericLoss,
          serviceGrades,
          itmRadialLosses: site.itmRadialLosses,
          useTwoRay,
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
            estimatedDbm: serviceGrades.find((grade) => grade.key === gradeKey)?.thresholdDbm ?? fringeThresholdDbm,
          };
        }
      });

      const estimatedDbm = bestMatch?.estimatedDbm ?? fringeThresholdDbm - 12;
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
        useLandCover,
        useTwoRay,
        txLineLoss,
        rxLineLoss,
        rxAntennaGain,
        rxThresholdUv,
        receiverThresholdDbm,
        thresholdMode,
        noiseFloorDbm,
        noiseFigureDb,
        requiredSnrDb,
        fadeMargin,
        fringeThresholdDbm,
        strongSignalMarginDb,
        maxRangeKm,
        itmReliabilityPercent,
        itmConfidencePercent,
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
        radialCount: activeRadialCount,
        renderMode: coverageRenderMode,
        rasterCellKm: coverageRenderMode === 'raster' ? rasterCellKm : null,
        terrainSamplesPerRadial: SAMPLING_INTERVALS_KM.length,
        terrainMaxDistanceKm: maxRangeKm,
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
    activeRadialCount,
    antennaPattern,
    atmosphericLoss,
    activeClutterLossDb,
    calibrationEnabled,
    clutterMap,
    clutterKey,
    confidenceScore,
    coverageRenderMode,
    fadeMargin,
    fringeThresholdDbm,
    frontBackRatio,
    freq,
    gain,
    hRx,
    hTx,
    itmConfidencePercent,
    itmReliabilityPercent,
    maxRangeKm,
    measurements,
    modelReliability.label,
    modelReliability.notes,
    noiseFigureDb,
    noiseFloorDbm,
    itmApiStatus,
    powerDbm,
    propagationModel,
    rainRate,
    rasterCellKm,
    receiverThresholdDbm,
    requiredSnrDb,
    rxAntennaGain,
    rxLineLoss,
    rxThresholdUv,
    serviceGrades,
    sites,
    strongSignalMarginDb,
    systemLossDb,
    thresholdMode,
    txLineLoss,
    useLandCover,
    useTwoRay,
  ]);

  useEffect(() => {
    sitesRef.current = sites;
  }, [sites]);

  const markCoverageStale = useCallback((notice = 'Settings changed. Run coverage to recalculate.') => {
    const hasPrediction = isAnalyzingRef.current || sitesRef.current.some(siteHasPredictionState);
    if (!hasPrediction) return;

    predictionRevisionRef.current += 1;
    setSites((currentSites) => currentSites.map((site) => (
      siteHasPredictionState(site) ? resetSitePrediction(site) : site
    )));
    setAnalysisNotice(notice);
  }, []);

  const updatePredictionSetting = useCallback((setter, value, notice) => {
    setter(value);
    markCoverageStale(notice);
  }, [markCoverageStale]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (![...params.keys()].length) return;
    const getParamNumber = (key, fallback) => {
      const value = Number(params.get(key));
      return Number.isFinite(value) ? value : fallback;
    };

    const lat = getParamNumber('lat', null);
    const lon = getParamNumber('lon', null);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      setSites((currentSites) => currentSites.map((site) => (
        site.id === activeSiteId
          ? { ...site, position: [lat, lon], status: 'pending', coveragePolygons: { ...EMPTY_POLYGONS }, rasterCells: [], areas: { ...EMPTY_AREAS } }
          : site
      )));
    }

    if (params.has('freq')) setFreq(clamp(getParamNumber('freq', freq), MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ));
    if (params.has('power')) setPower(clamp(getParamNumber('power', power), 0.1, 100));
    if (params.has('hTx')) setHTx(clamp(getParamNumber('hTx', hTx), 0, 300));
    if (params.has('hRx')) setHRx(clamp(getParamNumber('hRx', hRx), 1, 30));
    if (params.has('gain')) setGain(clamp(getParamNumber('gain', gain), 0, 20));
    if (params.has('rxGain')) setRxAntennaGain(clamp(getParamNumber('rxGain', rxAntennaGain), -20, 30));
    if (params.has('range')) setMaxRangeKm(clamp(getParamNumber('range', maxRangeKm), MIN_PREDICTION_RANGE_KM, MAX_PREDICTION_RANGE_KM));
    if (params.has('threshold')) setRxThresholdUv(clamp(getParamNumber('threshold', rxThresholdUv), 0.01, 1000));
    if (params.has('mode') && MODE_PROFILES[params.get('mode')]) setModeKey(params.get('mode'));
    if (params.has('model') && PROPAGATION_MODELS[params.get('model')]) setPropagationModel(params.get('model'));
    if (params.has('render') && COVERAGE_RENDER_OPTIONS.some((option) => option.key === params.get('render'))) setCoverageRenderMode(params.get('render'));
    if (params.has('radials') && COVERAGE_RADIAL_OPTIONS.some((option) => option.key === params.get('radials'))) setCoverageRadialMode(params.get('radials'));
    if (params.has('thresholdMode') && THRESHOLD_MODE_OPTIONS.some((option) => option.key === params.get('thresholdMode'))) setThresholdMode(params.get('thresholdMode'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('lat')) return;
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
        ? { ...site, position, status: 'pending', coveragePolygons: { ...EMPTY_POLYGONS }, rasterCells: [], coverageSource: 'radial-polygon', areas: { ...EMPTY_AREAS } }
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
        setPatternNotice('Pattern import failed. CSV needs relative angle plus lossDb or gain_dBi columns.');
        return;
      }

        setAntennaPattern(parsed);
        setPatternNotice(`Imported ${parsed.points.length} antenna pattern points from ${file.name}; angles are relative to antenna azimuth.`);
        markCoverageStale('Antenna pattern changed. Run coverage to recalculate.');
      } catch (error) {
        setPatternNotice(`Pattern import failed: ${error.message}`);
      } finally {
        event.target.value = '';
      }
    }, [markCoverageStale]);

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
        markCoverageStale('Clutter map changed. Run coverage to recalculate.');
      } catch (error) {
        setClutterMapNotice(`Clutter import failed: ${error.message}`);
      } finally {
        event.target.value = '';
      }
    }, [markCoverageStale]);

  const importLocalDem = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const rows = parseLocalDemText(await file.text());
      if (!rows.length) {
        setLocalDemNotice('DEM import failed. Use CSV/JSON with lat, lon, and elevation values.');
        return;
      }

      rows.forEach((row) => {
        elevationCache.set(getElevationCacheKey([row.lat, row.lon]), row.elevation);
      });
        persistElevationCache();
        terrainProfileCacheRef.current.clear();
        const notice = 'Local DEM cache updated. Run coverage again to use it.';
        setLocalDemNotice(`Imported ${rows.length} DEM elevation point${rows.length > 1 ? 's' : ''} from ${file.name}.`);
        markCoverageStale(notice);
        setAnalysisNotice(notice);
      } catch (error) {
        setLocalDemNotice(`DEM import failed: ${error.message}`);
      } finally {
        event.target.value = '';
      }
    }, [markCoverageStale]);

  const importRadioMobileReference = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const rows = parseRadioMobileComparisonCsv(await file.text());
      setRadioMobileReferenceRows(rows);
      setRadioMobileNotice(rows.length
        ? `Imported ${rows.length} Radio Mobile reference bearing${rows.length > 1 ? 's' : ''} from ${file.name}.`
        : 'Radio Mobile CSV needs bearing plus fringe/weak distance columns.');
    } catch (error) {
      setRadioMobileNotice(`Radio Mobile import failed: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }, []);

  const exportScenario = useCallback(() => {
    const scenario = buildScenarioPayload({
      sites,
      activeSiteId,
      settings: scenarioSettings,
      measurements,
      mapNotes,
    });
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `9m2pju-scenario-${new Date().toISOString().slice(0, 10)}.json`);
  }, [activeSiteId, mapNotes, measurements, scenarioSettings, sites]);

  const importScenario = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const scenario = JSON.parse(await file.text());
      const settings = scenario.settings ?? {};
      if (Array.isArray(scenario.sites) && scenario.sites.length) {
        setSites(scenario.sites.slice(0, MAX_SITES).map((site, index) => ({
          ...createSite(Number(site.id ?? index + 1), site.position ?? [3.1390, 101.6869], site.color ?? SITE_COLORS[index % SITE_COLORS.length]),
          name: site.name ?? `Site ${index + 1}`,
          elevation: Number.isFinite(Number(site.elevation)) ? Number(site.elevation) : 0,
          status: 'pending',
        })));
        setActiveSiteId(Number(scenario.activeSiteId ?? scenario.sites[0]?.id ?? 1));
        setNextSiteId(Math.min(MAX_SITES + 1, Math.max(...scenario.sites.map((site) => Number(site.id) || 1)) + 1));
      }

      if (Number.isFinite(Number(settings.power))) setPower(clamp(Number(settings.power), 0.1, 100));
      if (Number.isFinite(Number(settings.freq))) setFreq(clamp(Number(settings.freq), MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ));
      if (Number.isFinite(Number(settings.hTx))) setHTx(clamp(Number(settings.hTx), 0, 300));
      if (Number.isFinite(Number(settings.hRx))) setHRx(clamp(Number(settings.hRx), 1, 30));
      if (Number.isFinite(Number(settings.gain))) setGain(clamp(Number(settings.gain), 0, 20));
      if (Number.isFinite(Number(settings.rxAntennaGain))) setRxAntennaGain(clamp(Number(settings.rxAntennaGain), -20, 30));
      if (Number.isFinite(Number(settings.txLineLoss))) setTxLineLoss(clamp(Number(settings.txLineLoss), 0, 20));
      if (Number.isFinite(Number(settings.rxLineLoss))) setRxLineLoss(clamp(Number(settings.rxLineLoss), 0, 20));
      if (Number.isFinite(Number(settings.fadeMargin))) setFadeMargin(clamp(Number(settings.fadeMargin), 0, 40));
      if (Number.isFinite(Number(settings.rxThresholdUv))) setRxThresholdUv(clamp(Number(settings.rxThresholdUv), 0.01, 1000));
      if (Number.isFinite(Number(settings.noiseFigureDb))) setNoiseFigureDb(clamp(Number(settings.noiseFigureDb), 0, 30));
      if (Number.isFinite(Number(settings.requiredSnrDb))) setRequiredSnrDb(clamp(Number(settings.requiredSnrDb), -30, 40));
      if (Number.isFinite(Number(settings.strongSignalMarginDb))) setStrongSignalMarginDb(clamp(Number(settings.strongSignalMarginDb), 0, 60));
      if (Number.isFinite(Number(settings.maxRangeKm))) setMaxRangeKm(clamp(Number(settings.maxRangeKm), MIN_PREDICTION_RANGE_KM, MAX_PREDICTION_RANGE_KM));
      if (Number.isFinite(Number(settings.itmReliabilityPercent))) setItmReliabilityPercent(clamp(Number(settings.itmReliabilityPercent), 1, 99));
      if (Number.isFinite(Number(settings.itmConfidencePercent))) setItmConfidencePercent(clamp(Number(settings.itmConfidencePercent), 1, 99));
      if (Number.isFinite(Number(settings.rasterCellKm))) setRasterCellKm(RASTER_CELL_OPTIONS_KM.includes(Number(settings.rasterCellKm)) ? Number(settings.rasterCellKm) : COVERAGE_RASTER_CELL_KM);
      if (MODE_PROFILES[settings.modeKey]) setModeKey(settings.modeKey);
      if (PROPAGATION_MODELS[settings.propagationModel]) setPropagationModel(settings.propagationModel);
      if (CLUTTER_PROFILES[settings.clutterKey]) setClutterKey(settings.clutterKey);
      if (COVERAGE_RADIAL_OPTIONS.some((option) => option.key === settings.coverageRadialMode)) setCoverageRadialMode(settings.coverageRadialMode);
      if (COVERAGE_RENDER_OPTIONS.some((option) => option.key === settings.coverageRenderMode)) setCoverageRenderMode(settings.coverageRenderMode);
      if (THRESHOLD_MODE_OPTIONS.some((option) => option.key === settings.thresholdMode)) setThresholdMode(settings.thresholdMode);
      if (BAND_OPTIONS.some((option) => option.key === settings.freqBand)) setFreqBand(settings.freqBand);
      setUseLandCover(Boolean(settings.useLandCover));
      setUseTwoRay(Boolean(settings.useTwoRay));
      if (Array.isArray(scenario.measurements)) setMeasurements(scenario.measurements);
      if (Array.isArray(scenario.mapNotes)) setMapNotes(scenario.mapNotes);
      setAnalysisNotice(`Scenario imported from ${file.name}. Run coverage to recalculate.`);
    } catch (error) {
      setAnalysisNotice(`Scenario import failed: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }, []);

  const copyShareLink = useCallback(async () => {
    if (typeof window === 'undefined' || !activeSite) return;
    const params = new URLSearchParams({
      lat: activeSite.position[0].toFixed(6),
      lon: activeSite.position[1].toFixed(6),
      freq: String(freq),
      power: String(power),
      hTx: String(hTx),
      hRx: String(hRx),
      gain: String(gain),
      rxGain: String(rxAntennaGain),
      range: String(maxRangeKm),
      threshold: String(rxThresholdUv),
      mode: modeKey,
      model: propagationModel,
      render: coverageRenderMode,
      radials: coverageRadialMode,
      thresholdMode,
    });
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      setAnalysisNotice('Share link copied with current site and RF settings.');
    } catch {
      setAnalysisNotice(url);
    }
  }, [activeSite, coverageRadialMode, coverageRenderMode, freq, gain, hRx, hTx, maxRangeKm, modeKey, power, propagationModel, rxAntennaGain, rxThresholdUv, thresholdMode]);

  const downloadExperimentPackage = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      improvements: EXPERIMENT_IMPROVEMENTS,
      scenario: buildScenarioPayload({
        sites,
        activeSiteId,
        settings: scenarioSettings,
        measurements,
        mapNotes,
      }),
      validationReport,
      radioMobileComparisonReport,
      activeSiteTrust,
      activeSiteExplanation,
      queryPoint,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `9m2pju-experiment-package-${new Date().toISOString().slice(0, 10)}.json`);
  }, [activeSiteExplanation, activeSiteId, activeSiteTrust, mapNotes, measurements, queryPoint, radioMobileComparisonReport, scenarioSettings, sites, validationReport]);

  const applyStationPreset = useCallback((preset) => {
    setPower(preset.power);
    setHTx(preset.hTx);
    setHRx(preset.hRx);
    setGain(preset.gain);
    setRxAntennaGain(preset.rxAntennaGain);
    setFadeMargin(preset.fadeMargin);
    if (preset.modeKey) {
      const profile = MODE_PROFILES[preset.modeKey] ?? MODE_PROFILES.fm;
      setModeKey(preset.modeKey);
      setRequiredSnrDb(profile.defaultRequiredSnr);
      setRxThresholdUv(Number(dbmToMicrovolts(profile.thresholds.weak).toFixed(3)));
    }
    if (preset.freqBand) setFreqBand(preset.freqBand);
    if (preset.freq) setFreq(preset.freq);
    if (typeof preset.useTwoRay === 'boolean') setUseTwoRay(preset.useTwoRay);
    const notice = `${preset.label} preset applied. Run coverage to recalculate.`;
    markCoverageStale(notice);
    setAnalysisNotice(notice);
  }, [markCoverageStale]);

  const applySampleScenario = useCallback((scenario) => {
    setSites((currentSites) => currentSites.map((site) => (
      resetSitePrediction(
        site.id === activeSiteId
          ? {
            ...site,
            position: scenario.position,
          }
          : site,
      )
    )));
    predictionRevisionRef.current += 1;
    setFreq(scenario.freq);
    setFreqBand(scenario.freq < 300 ? 'vhf' : scenario.freq < 3000 ? 'uhf' : 'shf');
    setHTx(scenario.hTx);
    setHRx(scenario.hRx);
    setMaxRangeKm(scenario.maxRangeKm);
    setClutterKey(scenario.clutterKey);
    setUseLandCover(scenario.clutterKey !== 'open');
    setAnalysisNotice(`${scenario.label} sample loaded. Run coverage to compare terrain behavior.`);
  }, [activeSiteId]);

  const calculatePointQuery = useCallback((position) => {
    let bestSignal = null;
    let bestTerrainSamples = [];

    sites.forEach((site) => {
      const terrainProfile = terrainProfileCacheRef.current.get(getTerrainProfileCacheKey(site.position, site.coverageRadials ?? activeRadialCount));
      const predictedSignal = getPredictedSignalForMeasurement({
        measurement: { position, measuredDbm: 0 },
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
        clutterLossDb: activeClutterLossDb,
        calibrationOffsetDb: activeCalibrationOffset,
        antennaPattern,
        antennaAzimuth,
        antennaBeamwidth,
        frontBackRatio,
        clutterMap: useLandCover ? clutterMap : null,
        rainRateMmH: rainRate,
        atmosphericLossDbPerKm: atmosphericLoss,
        serviceGrades,
        itmRadialLosses: site.itmRadialLosses,
        useTwoRay,
      });

      if (predictedSignal) {
        if (!bestSignal || predictedSignal.estimatedDbm > bestSignal.estimatedDbm) {
          const radialIndex = Math.round(predictedSignal.bearing / (360 / (terrainProfile?.radialSampleSets?.length ?? activeRadialCount))) % (terrainProfile?.radialSampleSets?.length ?? activeRadialCount);
          bestSignal = predictedSignal;
          bestTerrainSamples = (terrainProfile?.radialSampleSets?.[radialIndex] ?? [])
            .filter((sample) => sample.distanceKm <= Math.max(predictedSignal.distanceKm, 1));
        }
        return;
      }

      const gradeKey = ['strong', 'moderate', 'weak'].find((key) => pointInPolygon(position, site.coveragePolygons[key]));
      if (gradeKey && !bestSignal) {
        bestSignal = {
          siteId: site.id,
          siteName: site.name,
          gradeKey,
          distanceKm: haversineDistanceKm(site.position, position),
          bearing: calculateBearingDegrees(site.position, position),
          estimatedDbm: serviceGrades.find((grade) => grade.key === gradeKey)?.thresholdDbm ?? fringeThresholdDbm,
          predictionEngine: 'polygon-threshold',
        };
      }
    });

    return {
      id: `query-${Date.now()}`,
      position,
      ...bestSignal,
      terrainSamples: bestTerrainSamples,
      createdAt: new Date().toISOString(),
    };
  }, [
    activeCalibrationOffset,
    activeClutterLossDb,
    activeRadialCount,
    antennaAzimuth,
    antennaBeamwidth,
    antennaPattern,
    atmosphericLoss,
    clutterMap,
    freq,
    fringeThresholdDbm,
    frontBackRatio,
    gain,
    hRx,
    hTx,
    powerDbm,
    propagationModel,
    rainRate,
    rxAntennaGain,
    serviceGrades,
    sites,
    systemLossDb,
    useLandCover,
    useTwoRay,
  ]);

  const handleMapClick = useCallback((position) => {
    if (mapToolMode === 'query') {
      setQueryPoint(calculatePointQuery(position));
      return;
    }
    updateActiveSitePosition(position);
  }, [calculatePointQuery, mapToolMode, updateActiveSitePosition]);

  const addMapNoteFromQuery = useCallback(() => {
    if (!queryPoint?.position) return;
    setMapNotes((currentNotes) => [
      ...currentNotes.slice(-19),
      {
        id: queryPoint.id,
        position: queryPoint.position,
        label: `${queryPoint.siteName ?? 'No site'} ${queryPoint.estimatedDbm?.toFixed?.(1) ?? 'n/a'} dBm`,
        gradeKey: queryPoint.gradeKey ?? 'outside',
      },
    ]);
    setAnalysisNotice('Map note saved from the current query point.');
  }, [queryPoint]);

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
    markCoverageStale('Local calibration changed. Run coverage to recalculate.');
  }, [markCoverageStale, validationReport.summary]);

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

  const exportCoverageResult = useCallback(() => {
    const analyzedCoverageSites = sites.filter(siteHasUsableCoverage);

    if (!analyzedCoverageSites.length) {
      setAnalysisNotice('Run coverage first, then export the result.');
      return;
    }

    const generatedAt = new Date().toISOString();
    const settings = {
      app: '9M2PJU Coverage Prediction',
      appVersion: APP_VERSION,
      generatedAt,
      frequencyMhz: freq,
      txPowerW: power,
      txPowerDbm: Number(powerDbm.toFixed(2)),
      txHeightM: hTx,
      rxHeightM: hRx,
      txGainDbi: gain,
      rxGainDbi: rxAntennaGain,
      txLineLossDb: txLineLoss,
      rxLineLossDb: rxLineLoss,
      fadeMarginDb: fadeMargin,
      totalSystemLossDb: Number(systemLossDb.toFixed(2)),
      rxThresholdUv,
      receiverThresholdDbm: Number(receiverThresholdDbm.toFixed(2)),
      thresholdMode,
      noiseFloorDbm: Number(noiseFloorDbm.toFixed(2)),
      noiseFigureDb,
      requiredSnrDb,
      fringeThresholdDbm: Number(fringeThresholdDbm.toFixed(2)),
      strongSignalMarginDb,
      maxRangeKm,
      itmReliabilityPercent,
      itmConfidencePercent,
      propagationModel,
      propagationModelLabel: PROPAGATION_MODELS[propagationModel]?.label ?? propagationModel,
      useLandCover,
      clutterProfile: useLandCover ? CLUTTER_PROFILES[clutterKey]?.label ?? clutterKey : 'off',
      useTwoRay,
      coverageRadialMode,
      coverageRadials: activeRadialCount,
      coverageRenderMode,
      rasterCellKm: coverageRenderMode === 'raster' ? rasterCellKm : null,
      antennaAzimuth,
      antennaBeamwidth,
      frontBackRatio,
      antennaPatternPoints: antennaPattern?.points?.length ?? 0,
      rainRateMmH: freqBand === 'shf' ? rainRate : null,
      atmosphericLossDbPerKm: freqBand === 'shf' ? atmosphericLoss : null,
    };

    const siteFeatures = analyzedCoverageSites.map((site) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          Number(site.position[1].toFixed(6)),
          Number(site.position[0].toFixed(6)),
        ],
      },
      properties: {
        featureType: 'site',
        siteId: site.id,
        siteName: site.name,
        elevationM: site.elevation,
        haatM: Number((site.haat ?? 0).toFixed(2)),
        confidence: site.confidence,
        status: site.status,
        coverageSource: site.coverageSource,
        rasterEngine: site.rasterEngine,
        color: site.color,
      },
    }));

    const coverageFeatures = analyzedCoverageSites.flatMap((site) => {
      if (site.coverageSource === 'per-cell-raster' && site.rasterCells?.length) {
        const cellAreaKm2 = (site.rasterCellKm ?? rasterCellKm) ** 2;
        return site.rasterCells.map((cell) => {
          const grade = serviceGrades.find((item) => item.key === cell.gradeKey);
          const ring = toGeoJsonPolygonRing(cell.bounds);
          if (!grade || !ring) return null;

          return {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [ring],
            },
            properties: {
              featureType: 'coverage-cell',
              siteId: site.id,
              siteName: site.name,
              cellId: cell.id,
              grade: grade.key,
              gradeLabel: grade.label,
              thresholdDbm: Number(grade.thresholdDbm.toFixed(2)),
              areaKm2: Number(cellAreaKm2.toFixed(3)),
              centerLat: cell.center?.[0],
              centerLon: cell.center?.[1],
              distanceKm: cell.distanceKm,
              bearingDeg: cell.bearingDeg,
              rxDbm: cell.rxDbm,
              pathLossDb: cell.lossDb,
              itmLossDb: cell.itmLossDb,
              color: grade.color,
              fillOpacity: grade.fillOpacity,
              model: site.model,
              engine: cell.engine ?? site.rasterEngine,
              nativeItm: cell.nativeItm,
              coverageSource: site.coverageSource,
              rasterEngine: site.rasterEngine,
              rasterCellKm: site.rasterCellKm ?? rasterCellKm,
              itmWarnings: cell.warnings ?? 0,
              itmErrorCode: cell.errorCode ?? 0,
            },
          };
        }).filter(Boolean);
      }

      return serviceGrades
        .map((grade) => {
          const ring = toGeoJsonPolygonRing(site.coveragePolygons[grade.key]);
          if (!ring) return null;

          return {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [ring],
            },
            properties: {
              featureType: 'coverage',
              siteId: site.id,
              siteName: site.name,
              grade: grade.key,
              gradeLabel: grade.label,
              thresholdDbm: Number(grade.thresholdDbm.toFixed(2)),
              areaKm2: Number((site.areas?.[grade.key] ?? 0).toFixed(3)),
              color: grade.color,
              fillOpacity: grade.fillOpacity,
              model: site.model,
              engine: site.model === 'ntiaItmApi' ? 'itm-api-with-local-fallback' : site.model,
              coverageSource: site.coverageSource,
              rasterEngine: site.rasterEngine,
              coverageRadials: site.coverageRadials,
              rasterCells: site.rasterCells?.filter((cell) => cell.gradeKey === grade.key).length ?? 0,
              itmWarningSamples: site.itmWarningSamples ?? 0,
              itmErrorSamples: site.itmErrorSamples ?? 0,
            },
          };
        })
        .filter(Boolean);
    });

    const geojson = {
      type: 'FeatureCollection',
      name: '9M2PJU Coverage Prediction Result',
      properties: {
        ...settings,
        combinedAreasKm2: {
          strong: Number(combinedAreas.strong.toFixed(3)),
          moderate: Number(combinedAreas.moderate.toFixed(3)),
          fringe: Number(combinedAreas.weak.toFixed(3)),
        },
        siteCount: analyzedCoverageSites.length,
      },
      features: [...siteFeatures, ...coverageFeatures],
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    downloadBlob(blob, `9m2pju-coverage-result-${new Date().toISOString().slice(0, 10)}.geojson`);
  }, [
    activeRadialCount,
    antennaAzimuth,
    antennaBeamwidth,
    antennaPattern,
    atmosphericLoss,
    clutterKey,
    combinedAreas,
    coverageRadialMode,
    coverageRenderMode,
    fadeMargin,
    freq,
    freqBand,
    fringeThresholdDbm,
    frontBackRatio,
    gain,
    hRx,
    hTx,
    itmConfidencePercent,
    itmReliabilityPercent,
    maxRangeKm,
    noiseFigureDb,
    noiseFloorDbm,
    power,
    powerDbm,
    propagationModel,
    rainRate,
    rasterCellKm,
    receiverThresholdDbm,
    requiredSnrDb,
    rxAntennaGain,
    rxLineLoss,
    rxThresholdUv,
    serviceGrades,
    sites,
    strongSignalMarginDb,
    systemLossDb,
    thresholdMode,
    txLineLoss,
    useLandCover,
    useTwoRay,
  ]);

  const exportCoveragePdf = useCallback(async () => {
    const analyzedCoverageSites = sites.filter(siteHasUsableCoverage);

    if (!analyzedCoverageSites.length) {
      setAnalysisNotice('Run coverage first, then export the PDF report.');
      return;
    }

    setAnalysisNotice('Preparing PDF report with map snapshot...');

    const formatArea = (value) => `${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} km2`;
    const sections = [
      {
        heading: 'Coverage Summary',
        lines: [
          `App version: ${APP_VERSION}`,
          `Sites analyzed: ${analyzedCoverageSites.length}`,
          `Strong total: ${formatArea(combinedAreas.strong)}`,
          `Moderate total: ${formatArea(combinedAreas.moderate)}`,
          `Fringe total: ${formatArea(combinedAreas.weak)}`,
        ],
      },
      {
        heading: 'RF Settings',
        lines: [
          `Frequency: ${freq} MHz`,
          `TX power: ${power} W (${powerDbm.toFixed(2)} dBm)`,
          `TX height: ${hTx} m AGL`,
          `RX height: ${hRx} m AGL`,
          `TX gain: ${gain} dBi`,
          `RX gain: ${rxAntennaGain} dBi`,
          `TX line loss: ${txLineLoss} dB`,
          `RX line loss: ${rxLineLoss} dB`,
          `Fade margin: ${fadeMargin} dB`,
          `Total system loss: ${systemLossDb.toFixed(1)} dB`,
          `RX threshold: ${rxThresholdUv} uV (${receiverThresholdDbm.toFixed(2)} dBm)`,
          `Threshold mode: ${THRESHOLD_MODE_OPTIONS.find((option) => option.key === thresholdMode)?.label ?? thresholdMode}`,
          `Noise floor: ${noiseFloorDbm.toFixed(2)} dBm, NF ${noiseFigureDb} dB, required SNR ${requiredSnrDb} dB`,
          `Fringe threshold used: ${fringeThresholdDbm.toFixed(2)} dBm`,
          `Strong signal margin: ${strongSignalMarginDb} dB`,
        ],
      },
      {
        heading: 'Prediction Settings',
        lines: [
          `Model: ${PROPAGATION_MODELS[propagationModel]?.label ?? propagationModel}`,
          `ITM reliability: ${itmReliabilityPercent}%`,
          `ITM confidence: ${itmConfidencePercent}%`,
          `Max range: ${maxRangeKm} km`,
          `Radial mode: ${coverageRadialMode} (${activeRadialCount} radials)`,
          `Render mode: ${coverageRenderMode}${coverageRenderMode === 'raster' ? ` (${rasterCellKm} km cells)` : ''}`,
          `Land cover: ${useLandCover ? CLUTTER_PROFILES[clutterKey]?.label ?? clutterKey : 'off'}`,
          `Two-ray loss: ${useTwoRay ? 'on' : 'off'}`,
          `Antenna azimuth: ${antennaAzimuth} deg`,
          `Antenna beamwidth: ${antennaBeamwidth} deg`,
          `Front/back ratio: ${frontBackRatio} dB`,
          `Imported antenna pattern points: ${antennaPattern?.points?.length ?? 0}`,
          ...(freqBand === 'shf' ? [
            `Rain rate: ${rainRate} mm/h`,
            `Atmospheric loss: ${atmosphericLoss} dB/km`,
          ] : []),
        ],
      },
      {
        heading: 'Sites',
        lines: analyzedCoverageSites.flatMap((site) => [
          `${site.name}: ${site.position[0].toFixed(6)}, ${site.position[1].toFixed(6)}`,
          `  Elevation: ${site.elevation} m AMSL, HAAT: ${(site.haat ?? 0).toFixed(1)} m, confidence: ${site.confidence?.toFixed?.(0) ?? site.confidence}%`,
          `  Strong: ${formatArea(site.areas?.strong)}, Moderate: ${formatArea(site.areas?.moderate)}, Fringe: ${formatArea(site.areas?.weak)}`,
          `  Render source: ${site.coverageSource === 'per-cell-raster' ? 'per-cell DEM raster ITM' : 'radial-derived coverage'}`,
          `  Raster cells: ${site.rasterCells?.length ?? 0}, tested cells: ${site.rasterStats?.testedCells ?? 'n/a'}`,
          `  Engine warnings: ${site.itmWarningSamples ?? 0}, errors: ${site.itmErrorSamples ?? 0}`,
        ]),
      },
      {
        heading: 'Thresholds',
        lines: serviceGrades.map((grade) => `${grade.label}: ${grade.thresholdDbm.toFixed(2)} dBm`),
      },
    ];

    let mapImage = null;
    try {
      mapImage = await captureMapSnapshot({
        map: mapRef.current,
        sites: analyzedCoverageSites,
        serviceGrades,
        coverageRenderMode,
        activeSiteId,
      });
    } catch (error) {
      console.warn('Map snapshot capture failed; exporting text-only PDF.', error);
    }

    const pdf = createSimplePdf('9M2PJU Coverage Prediction Result', sections, { mapImage });
    const blob = new Blob([pdf], { type: 'application/pdf' });
    downloadBlob(blob, `9m2pju-coverage-result-${new Date().toISOString().slice(0, 10)}.pdf`);
    setAnalysisNotice(mapImage
      ? 'PDF report exported with map snapshot.'
      : 'PDF report exported without map snapshot.');
  }, [
    activeSiteId,
    activeRadialCount,
    antennaAzimuth,
    antennaBeamwidth,
    antennaPattern,
    atmosphericLoss,
    clutterKey,
    combinedAreas,
    coverageRadialMode,
    coverageRenderMode,
    fadeMargin,
    freq,
    freqBand,
    fringeThresholdDbm,
    frontBackRatio,
    gain,
    hRx,
    hTx,
    itmConfidencePercent,
    itmReliabilityPercent,
    maxRangeKm,
    noiseFigureDb,
    noiseFloorDbm,
    power,
    powerDbm,
    propagationModel,
    rainRate,
    rasterCellKm,
    receiverThresholdDbm,
    requiredSnrDb,
    rxAntennaGain,
    rxLineLoss,
    rxThresholdUv,
    serviceGrades,
    sites,
    strongSignalMarginDb,
    systemLossDb,
    thresholdMode,
    txLineLoss,
    useLandCover,
    useTwoRay,
  ]);

  const downloadRadioMobileComparison = useCallback(() => {
    const rows = sites.flatMap((site) => (site.radioMobileRows ?? []).map((row) => ({
      siteId: site.id,
      siteName: site.name,
      latitude: site.position[0],
      longitude: site.position[1],
      siteElevationM: site.elevation,
      haatM: site.haat,
      coverageRadials: site.coverageRadials,
      radialMode: site.coverageRadialMode,
      bearingDeg: row.bearingDeg,
      strongReachKm: row.strongReachKm,
      moderateReachKm: row.moderateReachKm,
      fringeReachKm: row.weakReachKm,
      strongThresholdDbm: row.strongThresholdDbm,
      moderateThresholdDbm: row.moderateThresholdDbm,
      fringeThresholdDbm: row.weakThresholdDbm,
      engine: row.engine,
      frequencyMhz: freq,
      txPowerW: power,
      txHeightM: hTx,
      rxHeightM: hRx,
      txGainDbi: gain,
      rxGainDbi: rxAntennaGain,
      txLineLossDb: txLineLoss,
      rxLineLossDb: rxLineLoss,
      totalSystemLossDb: systemLossDb,
      rxThresholdUv,
      receiverThresholdDbm,
      thresholdMode,
      noiseFloorDbm,
      noiseFigureDb,
      requiredSnrDb,
      itmReliabilityPercent,
      itmConfidencePercent,
      maxRangeKm,
      useLandCover,
      useTwoRay,
      propagationModel,
      coverageRenderMode,
      rasterCellKm,
    })));

    if (!rows.length) {
      setAnalysisNotice('Run coverage first, then download the Radio Mobile comparison CSV.');
      return;
    }

    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `9m2pju-radio-mobile-comparison-${new Date().toISOString().slice(0, 10)}.csv`);
  }, [
    coverageRenderMode,
    freq,
    gain,
    hRx,
    hTx,
    itmConfidencePercent,
    itmReliabilityPercent,
    maxRangeKm,
    noiseFigureDb,
    noiseFloorDbm,
    power,
    propagationModel,
    rasterCellKm,
    receiverThresholdDbm,
    requiredSnrDb,
    rxAntennaGain,
    rxLineLoss,
    rxThresholdUv,
    sites,
    systemLossDb,
    thresholdMode,
    txLineLoss,
    useLandCover,
    useTwoRay,
  ]);

  const analyzeSite = useCallback(async (site) => {
    const radialCount = activeRadialCount;
    const terrainCacheKey = getTerrainProfileCacheKey(site.position, radialCount);
    let terrainProfile = terrainProfileCacheRef.current.get(terrainCacheKey);

    if (!terrainProfile) {
      const radialPoints = [];

      for (let i = 0; i < radialCount; i++) {
        const bearing = (i * 360) / radialCount;
        SAMPLING_INTERVALS_KM.forEach((distanceKm) => {
          radialPoints.push(getDestinationPoint(site.position[0], site.position[1], bearing, distanceKm));
        });
      }

      const { elevations, failedChunks } = await fetchElevationBatch([site.position, ...radialPoints]);
      const siteElevation = elevations[0] ?? site.elevation;
      const radialElevations = elevations.slice(1);
      const radialSampleSets = [];

      for (let radialIndex = 0; radialIndex < radialCount; radialIndex++) {
        const offset = radialIndex * SAMPLING_INTERVALS_KM.length;
        radialSampleSets.push(SAMPLING_INTERVALS_KM.map((distanceKm, sampleIndex) => ({
          distanceKm,
          elevation: radialElevations[offset + sampleIndex] ?? siteElevation,
        })));
      }

      terrainProfile = { siteElevation, radialSampleSets, failedChunks, radialCount };
      terrainProfileCacheRef.current.set(terrainCacheKey, terrainProfile);
    }

    const { siteElevation, radialSampleSets, failedChunks } = terrainProfile;
    const haatSamples = [];
    const newPolygons = { strong: [], moderate: [], weak: [] };
    const radialMargins = [];
    const radioMobileRows = [];
    const itmDistanceGrid = createItmDistanceGrid(maxRangeKm);
    const itmRadialLosses = Array(radialCount).fill(null);
    let itmApiFailures = 0;
    let itmApiFallbacks = 0;
    let itmWarningSamples = 0;
    let itmErrorSamples = 0;

    for (let radialIndex = 0; radialIndex < radialCount; radialIndex++) {
      const bearing = (radialIndex * 360) / radialCount;
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
            confidence: itmConfidencePercent,
            reliability: itmReliabilityPercent,
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

      const radioMobileRow = {
        siteId: site.id,
        siteName: site.name,
        bearingDeg: Number(bearing.toFixed(2)),
        engine: itmApiLossMap ? 'itm-api' : 'local-fallback',
      };

      serviceGrades.forEach((grade) => {
        const targetLoss = powerDbm + directionalGain + rxAntennaGain - systemLossDb + activeCalibrationOffset - grade.thresholdDbm;
        const itmRadius = findReliableDistanceFromLossMap({
          itmLossMap: itmApiLossMap,
          freq,
          hTx,
          hRx,
          targetLoss,
          clutterLossDb: activeClutterLossDb,
          sitePosition: site.position,
          bearing,
          clutterMap: useLandCover ? clutterMap : null,
          rainRateMmH: rainRate,
          atmosphericLossDbPerKm: atmosphericLoss,
          useTwoRay,
          maxRangeKm,
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
          clutterLossDb: activeClutterLossDb,
          terrainPenaltyCache,
          sitePosition: site.position,
          bearing,
          clutterMap: useLandCover ? clutterMap : null,
          rainRateMmH: rainRate,
          atmosphericLossDbPerKm: atmosphericLoss,
          useTwoRay,
          maxRangeKm,
        });
        newPolygons[grade.key].push(getDestinationPoint(site.position[0], site.position[1], bearing, radius));
        radioMobileRow[`${grade.key}ReachKm`] = Number(radius.toFixed(3));
        radioMobileRow[`${grade.key}ThresholdDbm`] = Number(grade.thresholdDbm.toFixed(2));

        if (grade.key === 'weak') {
          const itmPathLoss = getItmApiPathLoss(itmApiLossMap, radius);
          const pathLossAtRadius = typeof itmPathLoss === 'number'
            ? itmPathLoss + calculateExternalLosses({
              freq,
              distanceKm: radius,
              hTx,
              hRx,
              clutterLossDb: activeClutterLossDb,
              sitePosition: site.position,
              bearing,
              clutterMap: useLandCover ? clutterMap : null,
              rainRateMmH: rainRate,
              atmosphericLossDbPerKm: atmosphericLoss,
              useTwoRay,
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
              clutterLossDb: activeClutterLossDb,
              terrainPenaltyCache,
              sitePosition: site.position,
              bearing,
              clutterMap: useLandCover ? clutterMap : null,
              rainRateMmH: rainRate,
              atmosphericLossDbPerKm: atmosphericLoss,
              useTwoRay,
            });
          radialMargins.push(targetLoss - pathLossAtRadius);
        }
      });
      radioMobileRows.push(radioMobileRow);
    }

    if (propagationModel === 'ntiaItmApi') {
      if (freq > ITM_API_MAX_FREQUENCY_MHZ) {
        setItmApiStatus({ state: 'fallback', message: 'Frequency above 20 GHz; local SHF fallback used.' });
      } else if (itmApiFailures > 0) {
        setItmApiStatus({ state: 'error', message: `ITM API failed on ${itmApiFailures}/${radialCount} radials; local fallback filled gaps.` });
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
    let rasterCells = createCoverageRasterCells({
      sitePosition: site.position,
      polygons: newPolygons,
      maxRangeKm,
      cellKm: rasterCellKm,
    });
    let coverageSource = 'radial-polygon';
    let rasterStats = null;
    let rasterEngine = 'radial-derived';
    let actualRasterCellKm = rasterCellKm;
    let rasterAreas = {
      strong: calculateAreaKm2(newPolygons.strong),
      moderate: calculateAreaKm2(newPolygons.moderate),
      weak: calculateAreaKm2(newPolygons.weak),
    };

    if (coverageRenderMode === 'raster' && propagationModel === 'ntiaItmApi' && freq <= ITM_API_MAX_FREQUENCY_MHZ) {
      try {
        const rasterResult = await fetchPerCellRasterCoverage({
          site: { ...site, elevation: siteElevation },
          freq,
          hTx,
          hRx,
          powerDbm,
          gain,
          rxAntennaGain,
          systemLossDb,
          activeClutterLossDb,
          maxRangeKm,
          serviceGrades,
          confidence: itmConfidencePercent,
          reliability: itmReliabilityPercent,
            antennaAzimuth,
            antennaBeamwidth,
            frontBackRatio,
            antennaPattern,
            rainRateMmH: rainRate,
            atmosphericLossDbPerKm: atmosphericLoss,
            useTwoRay,
          rasterCellKm,
        });

        if (rasterResult) {
            rasterCells = rasterResult.cells ?? [];
            coverageSource = 'per-cell-raster';
            rasterEngine = rasterResult.engine ?? 'per-cell-raster';
            rasterStats = rasterResult.stats ?? null;
            actualRasterCellKm = Number(rasterResult.cellSizeKm ?? rasterCellKm);
            rasterAreas = {
              strong: Number(rasterResult.areas?.strong ?? 0),
            moderate: Number(rasterResult.areas?.moderate ?? 0),
            weak: Number(rasterResult.areas?.weak ?? 0),
          };
          itmWarningSamples += Number(rasterStats?.warningSamples ?? 0);
          itmErrorSamples += Number(rasterStats?.errorSamples ?? 0);
          if (Number(rasterStats?.fallbackCells ?? 0) > 0) itmApiFallbacks += 1;
          if (Number(rasterStats?.errorSamples ?? 0) > 0) {
            setItmApiStatus({ state: 'warning', message: `Per-cell raster ITM completed with ${rasterStats.errorSamples} native error-code cell${rasterStats.errorSamples > 1 ? 's' : ''}.` });
          } else if (Number(rasterStats?.warningSamples ?? 0) > 0) {
            setItmApiStatus({ state: 'warning', message: `Per-cell raster ITM completed with ${rasterStats.warningSamples} warning cell${rasterStats.warningSamples > 1 ? 's' : ''}.` });
          } else if (Number(rasterStats?.fallbackCells ?? 0) > 0) {
            setItmApiStatus({ state: 'fallback', message: 'Per-cell raster completed, but some cells used the helper fallback engine.' });
          } else {
            setItmApiStatus({ state: 'ready', message: `Per-cell DEM raster ITM completed for ${rasterStats?.testedCells ?? rasterCells.length} receiver cells.` });
          }
        }
      } catch (error) {
        console.warn(`Per-cell raster ITM failed for ${site.name}; using radial-derived raster`, error);
        setItmApiStatus({ state: 'warning', message: 'Per-cell raster ITM was unavailable; raster display fell back to radial-derived cells.' });
      }
    }

    return {
      ...site,
      elevation: siteElevation,
      haat: Number.isFinite(avgHaat) ? avgHaat : hTx,
      confidence: confidenceScore,
      avgMarginDb,
      model: propagationModel,
      clutter: clutterKey,
      coverageRadialMode,
        coverageRadials: radialCount,
        rasterCellKm: actualRasterCellKm,
        itmRadialLosses: propagationModel === 'ntiaItmApi' ? itmRadialLosses : null,
      itmWarningSamples,
      itmErrorSamples,
      radioMobileRows,
      coveragePolygons: newPolygons,
      rasterCells,
      coverageSource,
      rasterEngine,
      rasterStats,
      areas: rasterAreas,
      status: failedChunks > 0 ? 'degraded' : 'analyzed',
      failedChunks,
    };
  }, [
    antennaAzimuth,
    antennaBeamwidth,
    activeCalibrationOffset,
    activeClutterLossDb,
    activeRadialCount,
    antennaPattern,
    atmosphericLoss,
    clutterKey,
    clutterMap,
    confidenceScore,
    coverageRadialMode,
    coverageRenderMode,
    freq,
    frontBackRatio,
    gain,
    hRx,
    hTx,
    itmConfidencePercent,
    itmReliabilityPercent,
    maxRangeKm,
    powerDbm,
    propagationModel,
    rainRate,
    rasterCellKm,
    rxAntennaGain,
    serviceGrades,
    systemLossDb,
    useLandCover,
    useTwoRay,
  ]);

  const analyzeTerrain = useCallback(async () => {
    if (isAnalyzingRef.current) return;

    const sitesToAnalyze = sitesRef.current;
    const runRevision = predictionRevisionRef.current;
    if (!sitesToAnalyze.length) {
      setAnalysisNotice('Add at least one coverage site before running prediction.');
      return;
    }

    isAnalyzingRef.current = true;
    setIsAnalyzing(true);
    setAnalysisNotice(`Running terrain prediction for ${sitesToAnalyze.length} site${sitesToAnalyze.length > 1 ? 's' : ''}...`);
    setSites((currentSites) => currentSites.map((site) => resetSitePrediction(site, 'analyzing')));

    const analyzed = await Promise.all(sitesToAnalyze.map(async (site) => {
      try {
        const result = await analyzeSite(site);
        return result;
      } catch (e) {
        console.error(`Coverage analysis failed for ${site.name}`, e);
        return resetSitePrediction(site, 'failed');
      }
    }));

    const failedSites = analyzed.filter((site) => site.status === 'failed').length;
    const degradedSites = analyzed.filter((site) => site.status === 'degraded').length;

    if (runRevision !== predictionRevisionRef.current) {
      setAnalysisNotice('Settings changed during prediction. Run coverage again with the current values.');
      setIsAnalyzing(false);
      isAnalyzingRef.current = false;
      return;
    }

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
              <p style={{ fontSize: '0.75rem', fontWeight: '600' }}>Multi-Site Coverage Prediction v4.8.0</p>
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
                  <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Multi-Site Coverage Prediction v4.8.0</p>
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
              <button className="secondary-button export-result-button" type="button" onClick={exportCoverageResult} disabled={!analyzedSites}>
                <Download size={14} /> Export GeoJSON
              </button>
              <button className="secondary-button export-result-button" type="button" onClick={exportCoveragePdf} disabled={!analyzedSites}>
                <FileText size={14} /> Export PDF
              </button>
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
            <button className="secondary-button export-result-button" type="button" onClick={exportCoverageResult} disabled={!analyzedSites}>
              <Download size={14} /> Export GeoJSON
            </button>
            <button className="secondary-button export-result-button" type="button" onClick={exportCoveragePdf} disabled={!analyzedSites}>
              <FileText size={14} /> Export PDF
            </button>
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
            <label><Gauge size={12} style={{ marginRight: '6px' }} /> EXPERIMENT TOOLS</label>
            <div className={`trust-banner ${activeSiteTrust.tone}`}>
              <strong>{activeSiteTrust.level}</strong>
              <span>{activeSiteExplanation}</span>
            </div>
            <div className="segmented-control" role="group" aria-label="Map tool mode">
              <button type="button" className={mapToolMode === 'place' ? 'active' : ''} onClick={() => setMapToolMode('place')}>
                <MapPin size={14} /> Place
              </button>
              <button type="button" className={mapToolMode === 'query' ? 'active' : ''} onClick={() => setMapToolMode('query')}>
                <Crosshair size={14} /> Query
              </button>
            </div>
            {queryPoint && (
              <div className="query-card">
                <div className="query-card-title">
                  {queryPoint.siteName ? `${queryPoint.siteName} point` : 'Point outside analyzed coverage'}
                </div>
                <div className="query-card-grid">
                  <span>Signal</span><strong>{queryPoint.estimatedDbm?.toFixed?.(1) ?? 'n/a'} dBm</strong>
                  <span>Grade</span><strong>{queryPoint.gradeKey ?? 'outside'}</strong>
                  <span>Distance</span><strong>{queryPoint.distanceKm?.toFixed?.(2) ?? 'n/a'} km</strong>
                  <span>Bearing</span><strong>{queryPoint.bearing?.toFixed?.(0) ?? 'n/a'} deg</strong>
                  <span>Engine</span><strong>{queryPoint.predictionEngine ?? 'n/a'}</strong>
                </div>
                {queryPoint.terrainSamples?.length > 1 && (
                  <svg className="terrain-sparkline" viewBox="0 0 250 54" role="img" aria-label="Terrain profile">
                    <polyline points={createTerrainSparklinePoints(queryPoint.terrainSamples)} />
                  </svg>
                )}
                <button className="secondary-button compact-button" type="button" onClick={addMapNoteFromQuery}>
                  <Clipboard size={14} /> Save note
                </button>
              </div>
            )}
            <div className="compact-button-grid">
              {QUICK_STATION_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  className={`secondary-button compact-button ${isStationPresetActive(preset) ? 'active-preset' : ''}`}
                  type="button"
                  aria-pressed={isStationPresetActive(preset)}
                  onClick={() => applyStationPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="compact-button-grid">
              {SAMPLE_SCENARIOS.map((scenario) => (
                <button
                  key={scenario.key}
                  className={`secondary-button compact-button ${isSampleScenarioActive(scenario) ? 'active-preset' : ''}`}
                  type="button"
                  aria-pressed={isSampleScenarioActive(scenario)}
                  onClick={() => applySampleScenario(scenario)}
                >
                  {scenario.label}
                </button>
              ))}
            </div>
            <div className="validation-stats">
              {multiBandPreview.map((band) => (
                <span key={band.key}>{band.label}: {formatDb(band.marginDb)}</span>
              ))}
            </div>
            <label className="file-import-button">
              <Database size={14} /> Import local DEM
              <input type="file" accept=".csv,.json,.geojson,text/csv,application/json" onChange={importLocalDem} />
            </label>
            <div className="mode-note">{localDemNotice}</div>
            <div className="compact-button-grid">
              <button className="secondary-button compact-button" type="button" onClick={exportScenario}>
                <Download size={14} /> Scenario
              </button>
              <label className="file-import-button compact-file-button">
                <Upload size={14} /> Scenario
                <input type="file" accept=".json,application/json" onChange={importScenario} />
              </label>
              <button className="secondary-button compact-button" type="button" onClick={copyShareLink}>
                <Share2 size={14} /> Link
              </button>
              <button className="secondary-button compact-button" type="button" onClick={downloadExperimentPackage}>
                <Download size={14} /> Package
              </button>
            </div>
            <label className="toggle-field full-width-toggle">
              <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
              Show debug summary
            </label>
            {debugMode && (
              <pre className="debug-summary">
                {JSON.stringify({
                  activeSite: activeSite?.name,
                  trust: activeSiteTrust.level,
                  coverageSource: activeSite?.coverageSource,
                  rasterStats: activeSite?.rasterStats,
                  itmWarnings: activeSite?.itmWarningSamples ?? 0,
                  itmErrors: activeSite?.itmErrorSamples ?? 0,
                  thresholds: serviceGrades.map(({ key, thresholdDbm }) => ({ key, thresholdDbm: Number(thresholdDbm.toFixed(2)) })),
                }, null, 2)}
              </pre>
            )}
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
              <input type="range" min="0.1" max="100" step="0.1" value={power} onChange={(e) => updatePredictionSetting(setPower, Number(e.target.value))} />
              <input
                className="numeric-input"
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                value={power}
                aria-label="TX power in watts"
                onChange={(e) => updatePredictionSetting(setPower, clamp(Number(e.target.value), 0.1, 100))}
              />
            </div>
          </div>

          <div className="control-group">
            <label><Layers size={12} style={{ marginRight: '6px' }} /> TOWER HEIGHT: {hTx}m AGL</label>
            <div className="slider-container">
              <input type="range" min="0" max="300" value={hTx} onChange={(e) => updatePredictionSetting(setHTx, Number(e.target.value))} />
              <input
                className="numeric-input"
                type="number"
                min="0"
                max="300"
                step="1"
                value={hTx}
                aria-label="Tower height above ground in meters"
                  onChange={(e) => updatePredictionSetting(setHTx, clamp(Number(e.target.value), 0, 300))}
              />
            </div>
          </div>

          <div className="control-group">
            <label><Activity size={12} style={{ marginRight: '6px' }} /> ANTENNA GAIN: {gain}dBi</label>
            <div className="slider-container">
                <input type="range" min="0" max="20" step="0.5" value={gain} onChange={(e) => updatePredictionSetting(setGain, Number(e.target.value))} />
              <input
                className="numeric-input"
                type="number"
                min="0"
                max="20"
                step="0.5"
                value={gain}
                aria-label="TX antenna gain in dBi"
                  onChange={(e) => updatePredictionSetting(setGain, clamp(Number(e.target.value), 0, 20))}
              />
            </div>
          </div>

          <div className="control-group">
            <label><Activity size={12} style={{ marginRight: '6px' }} /> RX HEIGHT: {hRx.toFixed(1)}m AGL</label>
            <div className="slider-container">
                <input type="range" min="1" max="30" step="0.5" value={hRx} onChange={(e) => updatePredictionSetting(setHRx, Number(e.target.value))} />
              <input
                className="numeric-input"
                type="number"
                min="1"
                max="30"
                step="0.5"
                value={hRx}
                aria-label="Receiver antenna height above ground in meters"
                  onChange={(e) => updatePredictionSetting(setHRx, clamp(Number(e.target.value), 1, 30))}
              />
            </div>
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
                  setRequiredSnrDb(nextProfile.defaultRequiredSnr);
                  setRxThresholdUv(Number(dbmToMicrovolts(nextProfile.thresholds.weak).toFixed(3)));
                  markCoverageStale('Mode profile changed. Run coverage to recalculate.');
                }}
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
            <div className="mode-note">
              {modeProfile.note} · active fringe {fringeThresholdDbm.toFixed(2)} dBm · receiver {receiverThresholdDbm.toFixed(2)} dBm
            </div>
          </div>

          <div className="control-group engineering-group">
            <label><FileText size={12} style={{ marginRight: '6px' }} /> ENGINEERING MODEL</label>
              <select className="mode-select" value={propagationModel} onChange={(e) => updatePredictionSetting(setPropagationModel, e.target.value, 'Engineering model changed. Run coverage to recalculate.')}>
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
            <label className="toggle-field full-width-toggle">
                <input type="checkbox" checked={useLandCover} onChange={(e) => updatePredictionSetting(setUseLandCover, e.target.checked, 'Land-cover setting changed. Run coverage to recalculate.')} />
              Apply land cover / clutter
            </label>
            {useLandCover && (
              <>
                  <select className="mode-select stacked-select" value={clutterKey} onChange={(e) => updatePredictionSetting(setClutterKey, e.target.value, 'Clutter profile changed. Run coverage to recalculate.')}>
                  {CLUTTER_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label} (+{option.lossDb} dB)</option>
                  ))}
                </select>
                <label className="file-import-button">
                  <Upload size={14} /> Import clutter GeoJSON
                  <input type="file" accept=".json,.geojson,application/geo+json,application/json" onChange={importClutterMap} />
                </label>
                <div className="mode-note">{clutterMapNotice}</div>
              </>
            )}
            <div className="engineering-summary">
              Planning confidence: {confidenceScore.toFixed(0)}% · {modelReliability.label} reliability · clutter uncertainty ±{activeClutterUncertaintyDb} dB
            </div>
            <div className="mode-note">
              {modelReliability.notes[0]}
            </div>
          </div>

          <div className="control-group engineering-group">
            <label><Activity size={12} style={{ marginRight: '6px' }} /> LINK BUDGET</label>
            <div className="engineering-grid">
              <label>TX line loss
                  <input className="numeric-input compact-input" type="number" min="0" max="20" step="0.1" value={txLineLoss} onChange={(e) => updatePredictionSetting(setTxLineLoss, clamp(toNumber(e.target.value), 0, 20))} />
              </label>
              <label>RX line loss
                  <input className="numeric-input compact-input" type="number" min="0" max="20" step="0.1" value={rxLineLoss} onChange={(e) => updatePredictionSetting(setRxLineLoss, clamp(toNumber(e.target.value), 0, 20))} />
              </label>
              <label>RX gain
                  <input className="numeric-input compact-input" type="number" min="-20" max="30" step="0.5" value={rxAntennaGain} onChange={(e) => updatePredictionSetting(setRxAntennaGain, clamp(toNumber(e.target.value), -20, 30))} />
              </label>
              <label>RX threshold uV
                  <input className="numeric-input compact-input" type="number" min="0.01" max="1000" step="0.01" value={rxThresholdUv} onChange={(e) => updatePredictionSetting(setRxThresholdUv, clamp(toNumber(e.target.value), 0.01, 1000))} />
              </label>
              <label>Threshold source
                  <select className="mini-select" value={thresholdMode} onChange={(e) => updatePredictionSetting(setThresholdMode, e.target.value)}>
                  {THRESHOLD_MODE_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>Noise figure
                  <input className="numeric-input compact-input" type="number" min="0" max="30" step="0.5" value={noiseFigureDb} onChange={(e) => updatePredictionSetting(setNoiseFigureDb, clamp(toNumber(e.target.value), 0, 30))} />
              </label>
              <label>Required SNR
                  <input className="numeric-input compact-input" type="number" min="-30" max="40" step="0.5" value={requiredSnrDb} onChange={(e) => updatePredictionSetting(setRequiredSnrDb, clamp(toNumber(e.target.value), -30, 40))} />
              </label>
              <label>Strong margin
                  <input className="numeric-input compact-input" type="number" min="0" max="60" step="1" value={strongSignalMarginDb} onChange={(e) => updatePredictionSetting(setStrongSignalMarginDb, clamp(toNumber(e.target.value), 0, 60))} />
              </label>
              <label>Max range km
                  <input className="numeric-input compact-input" type="number" min={MIN_PREDICTION_RANGE_KM} max={MAX_PREDICTION_RANGE_KM} step="1" value={maxRangeKm} onChange={(e) => updatePredictionSetting(setMaxRangeKm, clamp(toNumber(e.target.value), MIN_PREDICTION_RANGE_KM, MAX_PREDICTION_RANGE_KM))} />
              </label>
              <label>ITM reliability %
                  <input className="numeric-input compact-input" type="number" min="1" max="99" step="1" value={itmReliabilityPercent} onChange={(e) => updatePredictionSetting(setItmReliabilityPercent, clamp(toNumber(e.target.value), 1, 99), 'ITM reliability changed. Run coverage to recalculate.')} />
              </label>
              <label>ITM confidence %
                  <input className="numeric-input compact-input" type="number" min="1" max="99" step="1" value={itmConfidencePercent} onChange={(e) => updatePredictionSetting(setItmConfidencePercent, clamp(toNumber(e.target.value), 1, 99), 'ITM confidence changed. Run coverage to recalculate.')} />
              </label>
              <label>Validation mode
                  <select className="mini-select" value={coverageRadialMode} onChange={(e) => updatePredictionSetting(setCoverageRadialMode, e.target.value, 'Validation mode changed. Run coverage to recalculate.')}>
                  {COVERAGE_RADIAL_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>Render mode
                  <select className="mini-select" value={coverageRenderMode} onChange={(e) => updatePredictionSetting(setCoverageRenderMode, e.target.value, 'Render mode changed. Run coverage to recalculate.')}>
                  {COVERAGE_RENDER_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>Raster cell km
                  <select className="mini-select" value={rasterCellKm} onChange={(e) => updatePredictionSetting(setRasterCellKm, Number(e.target.value), 'Raster cell size changed. Run coverage to recalculate.')}>
                  {RASTER_CELL_OPTIONS_KM.map((option) => (
                    <option key={option} value={option}>{option} km</option>
                  ))}
                </select>
              </label>
              <label>Fade margin
                  <input className="numeric-input compact-input" type="number" min="0" max="40" step="1" value={fadeMargin} onChange={(e) => updatePredictionSetting(setFadeMargin, clamp(toNumber(e.target.value), 0, 40))} />
              </label>
              {freqBand === 'shf' && (
                <>
                  <label>Rain rate
                      <input className="numeric-input compact-input" type="number" min="0" max="150" step="1" value={rainRate} onChange={(e) => updatePredictionSetting(setRainRate, clamp(toNumber(e.target.value), 0, 150))} />
                  </label>
                  <label>Atm loss/km
                      <input className="numeric-input compact-input" type="number" min="0" max="1" step="0.005" value={atmosphericLoss} onChange={(e) => updatePredictionSetting(setAtmosphericLoss, clamp(toNumber(e.target.value), 0, 1))} />
                  </label>
                </>
              )}
              <label className="toggle-field">
                  <input type="checkbox" checked={useTwoRay} onChange={(e) => updatePredictionSetting(setUseTwoRay, e.target.checked, 'Two-ray setting changed. Run coverage to recalculate.')} />
                Use two rays
              </label>
            </div>
            <div className="engineering-summary">
              Fringe {fringeThresholdDbm.toFixed(2)} dBm · receiver {receiverThresholdDbm.toFixed(2)} dBm · noise floor {noiseFloorDbm.toFixed(1)} dBm · ITM {itmReliabilityPercent}%/{itmConfidencePercent}% · {activeRadialCount} radials · {coverageRenderMode === 'raster' ? `${rasterCellKm} km raster` : 'polygon render'} · total loss {systemLossDb.toFixed(1)} dB
            </div>
          </div>

          <div className="control-group engineering-group">
            <label><Antenna size={12} style={{ marginRight: '6px' }} /> ANTENNA PATTERN</label>
            <div className="engineering-grid">
              <label>Azimuth
                  <input className="numeric-input compact-input" type="number" min="0" max="359" step="1" value={antennaAzimuth} onChange={(e) => updatePredictionSetting(setAntennaAzimuth, clamp(toNumber(e.target.value), 0, 359), 'Antenna azimuth changed. Run coverage to recalculate.')} />
              </label>
              <label>Beamwidth
                  <input className="numeric-input compact-input" type="number" min="5" max="360" step="5" value={antennaBeamwidth} onChange={(e) => updatePredictionSetting(setAntennaBeamwidth, clamp(toNumber(e.target.value), 5, 360), 'Antenna beamwidth changed. Run coverage to recalculate.')} />
              </label>
              <label>F/B ratio
                  <input className="numeric-input compact-input" type="number" min="0" max="40" step="1" value={frontBackRatio} onChange={(e) => updatePredictionSetting(setFrontBackRatio, clamp(toNumber(e.target.value), 0, 40), 'Antenna F/B ratio changed. Run coverage to recalculate.')} />
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
                      markCoverageStale('Band changed. Run coverage to recalculate.');
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
                onChange={(e) => updatePredictionSetting(setFreq, Number(e.target.value), 'Frequency changed. Run coverage to recalculate.')}
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
            <button className="secondary-button" type="button" onClick={downloadRadioMobileComparison} disabled={!sites.some((site) => site.radioMobileRows?.length)}>
              <Download size={14} /> Download Radio Mobile CSV
            </button>
            <label className="file-import-button">
              <Upload size={14} /> Import Radio Mobile CSV
              <input type="file" accept=".csv,text/csv" onChange={importRadioMobileReference} />
            </label>
            <div className="engineering-summary">{radioMobileNotice}</div>
            {radioMobileComparisonReport && (
              <>
                <div className="validation-stats">
                  <span>Matched: {radioMobileComparisonReport.matchedRows}</span>
                  <span>Fringe MAE: {radioMobileComparisonReport.fringe.mae.toFixed(1)} km</span>
                  <span>Within 5km: {radioMobileComparisonReport.fringe.within[5].toFixed(0)}%</span>
                </div>
                <div className="engineering-summary">
                  Strong MAE {radioMobileComparisonReport.strong.mae.toFixed(1)} km · moderate MAE {radioMobileComparisonReport.moderate.mae.toFixed(1)} km · fringe max error {radioMobileComparisonReport.fringe.maxAbs.toFixed(1)} km
                </div>
              </>
            )}
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
                crossOrigin="anonymous"
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
        <MapInstanceTracker mapRef={mapRef} />
        <MapClickHandler onClick={handleMapClick} />

        {sites.map((site) => (
          <React.Fragment key={`coverage-${site.id}`}>
            {coverageRenderMode === 'raster' && (site.coverageSource === 'per-cell-raster' || site.rasterCells?.length)
              ? site.rasterCells.map((cell) => {
                const grade = serviceGrades.find((item) => item.key === cell.gradeKey);
                if (!grade) return null;

                return (
                  <Polygon
                    key={`${site.id}-cell-${cell.id}`}
                    positions={cell.bounds}
                    pathOptions={{
                      color: grade.color,
                      fillColor: grade.color,
                      fillOpacity: Math.min(0.42, grade.fillOpacity + 0.12),
                      weight: 0,
                      interactive: false,
                    }}
                  />
                );
              })
                : serviceGrades.map((grade) => site.coveragePolygons[grade.key]?.length >= 3 && (
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
                Render: {site.coverageSource === 'per-cell-raster' ? `per-cell raster (${site.rasterStats?.testedCells ?? site.rasterCells?.length ?? 0} cells)` : 'radial polygon'}<br />
                Confidence: {(site.confidence ?? confidenceScore).toFixed(0)}% | Avg margin: {(site.avgMarginDb ?? 0).toFixed(1)} dB
              </div>
            </Popup>
          </Marker>
        ))}

        {queryPoint?.position && (
          <CircleMarker
            center={queryPoint.position}
            radius={8}
            pathOptions={{ color: '#ffffff', fillColor: queryPoint.gradeKey === 'strong' ? '#4dbd74' : queryPoint.gradeKey === 'moderate' ? '#ffc107' : queryPoint.gradeKey === 'weak' ? '#ff4444' : '#6c757d', fillOpacity: 0.9, weight: 3 }}
          >
            <Popup>
              <div style={{ color: '#000', fontSize: '0.8rem' }}>
                <strong>QUERY POINT</strong><br />
                Signal: {queryPoint.estimatedDbm?.toFixed?.(1) ?? 'n/a'} dBm<br />
                Grade: {queryPoint.gradeKey ?? 'outside'}<br />
                Site: {queryPoint.siteName ?? 'No analyzed site'}<br />
                Distance: {queryPoint.distanceKm?.toFixed?.(2) ?? 'n/a'} km
              </div>
            </Popup>
          </CircleMarker>
        )}

        {mapNotes.map((note) => (
          <CircleMarker
            key={note.id}
            center={note.position}
            radius={5}
            pathOptions={{ color: '#111827', fillColor: '#ffffff', fillOpacity: 0.86, weight: 2 }}
          >
            <Popup>
              <div style={{ color: '#000', fontSize: '0.8rem' }}>
                <strong>OPERATOR NOTE</strong><br />
                {note.label}
              </div>
            </Popup>
          </CircleMarker>
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
              <dt>RX threshold</dt>
              <dd>Minimum receive level for the fringe boundary, entered in microvolts and shown as dBm.</dd>
              <dt>ITM reliability</dt>
              <dd>Reliability percentage sent to the ITM service for Longley-Rice path-loss sampling.</dd>
              <dt>ITM confidence</dt>
              <dd>Confidence percentage sent to the ITM service. Keep 50% for Radio Mobile-style comparison unless you need a more conservative statistical case.</dd>
              <dt>Render mode</dt>
              <dd>Choose radial polygons for clean boundaries or raster cells for Radio Mobile-style visual comparison.</dd>
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
          margin: 8px 0 14px;
          padding: 9px 10px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.06);
          color: var(--text-secondary);
          font-size: 0.72rem;
          line-height: 1.35;
          font-weight: 700;
          overflow-wrap: anywhere;
          word-break: normal;
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
        .toggle-field {
          min-height: 34px;
          display: flex !important;
          align-items: center;
          gap: 8px;
          padding: 7px 8px;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 8px;
          background: rgba(255,255,255,0.06);
          color: var(--text-primary) !important;
          font-weight: 800;
        }
        .toggle-field input {
          width: 14px;
          height: 14px;
          accent-color: var(--accent-blue);
        }
        .full-width-toggle {
          margin: 10px 0 8px;
        }
        .export-result-button {
          width: 100%;
          margin: 0 0 10px;
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
