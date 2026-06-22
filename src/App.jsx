import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, Popup, Polygon, LayersControl, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Radio, Activity, Layers, Zap, Mountain, BarChart3, Plus, Trash2, Antenna } from 'lucide-react';
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
  { key: 'weak', label: 'Fringe', color: '#ff4444', thresholdDbm: -115, fillOpacity: 0.08, weight: 1, dashArray: '3, 3' },
  { key: 'moderate', label: 'Moderate', color: '#ffc107', thresholdDbm: -105, fillOpacity: 0.16, weight: 1 },
  { key: 'strong', label: 'Strong', color: '#4dbd74', thresholdDbm: -93, fillOpacity: 0.28, weight: 2 },
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
const SAMPLING_INTERVALS_KM = [1, 2, 4, 6, 8, 10, 12, 16, 24, 32, 48, 64];
const MAX_SITES = 4;
const ELEVATION_ENDPOINT = 'https://api.open-elevation.com/api/v1/lookup';
const ELEVATION_CHUNK_SIZE = 60;
const ELEVATION_TIMEOUT_MS = 12000;
const ELEVATION_RETRIES = 2;

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

const calculatePathLoss = (freq, effectiveHTx, hRx, distanceKm) => {
  if (distanceKm <= 0.1) return 0;

  const safeFreq = clamp(freq, 30, 3000);
  const logFreq = Math.log10(safeFreq);
  const logHTx = Math.log10(clamp(effectiveHTx, 2, 300));
  const safeHRx = clamp(hRx, 1, 30);
  const mobileCorrection = (1.1 * logFreq - 0.7) * safeHRx - (1.56 * logFreq - 0.8);
  const logDist = Math.log10(distanceKm);
  const hataUrban = 69.55 + 26.16 * logFreq - 13.82 * logHTx - mobileCorrection + (44.9 - 6.55 * logHTx) * logDist;
  const suburbanCorrection = 2 * (Math.log10(safeFreq / 28) ** 2) + 5.4;
  const cost231Extension = safeFreq > 1500 ? 3 + (safeFreq - 1500) / 1500 * 6 : 0;

  return hataUrban - suburbanCorrection + cost231Extension;
};

const getElevationAtDistance = (radialSamples, distanceKm, fallbackElevation) => {
  const nearest = radialSamples.reduce((best, sample) => {
    if (sample.distanceKm > distanceKm) return best;
    if (!best || sample.distanceKm > best.distanceKm) return sample;
    return best;
  }, null);
  return nearest?.elevation ?? fallbackElevation;
};

const calculateTerrainPenalty = (radialSamples, radiusKm, siteElevation, hTx, hRx, freq) => {
  const samplesInPath = radialSamples.filter((sample) => sample.distanceKm > 0 && sample.distanceKm < radiusKm);
  if (!samplesInPath.length) return 0;

  const wavelength = 300 / freq;
  const txAmsl = siteElevation + hTx;
  const rxGround = getElevationAtDistance(radialSamples, radiusKm, siteElevation);
  const rxAmsl = rxGround + hRx;

  let maxDiffractionLoss = 0;
  let shadowedSamples = 0;

  samplesInPath.forEach((sample) => {
    const pathFraction = sample.distanceKm / radiusKm;
    const lineOfSightHeight = txAmsl + (rxAmsl - txAmsl) * pathFraction;
    const firstFresnelRadius = 17.32 * Math.sqrt((sample.distanceKm * (radiusKm - sample.distanceKm)) / (freq * radiusKm));
    const clearanceDeficit = sample.elevation - (lineOfSightHeight - 0.6 * firstFresnelRadius);

    if (clearanceDeficit <= 0) return;

    shadowedSamples += 1;
    const d1 = Math.max(1, sample.distanceKm * 1000);
    const d2 = Math.max(1, (radiusKm - sample.distanceKm) * 1000);
    const v = clearanceDeficit * Math.sqrt((2 * (d1 + d2)) / (wavelength * d1 * d2));
    const diffractionLoss = v <= -0.78 ? 0 : 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
    maxDiffractionLoss = Math.max(maxDiffractionLoss, diffractionLoss);
  });

  return clamp(maxDiffractionLoss + shadowedSamples * 1.5, 0, 38);
};

const findReliableDistance = ({ freq, effectiveHTx, hTx, hRx, targetLoss, radialSamples, siteElevation }) => {
  let low = 0.1;
  let high = 120;

  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const totalLoss = calculatePathLoss(freq, effectiveHTx, hRx, mid) +
      calculateTerrainPenalty(radialSamples, mid, siteElevation, hTx, hRx, freq);

    if (totalLoss < targetLoss) low = mid;
    else high = mid;
  }

  return low;
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

const fetchElevationChunk = async (chunk) => {
  let lastError;

  for (let attempt = 0; attempt <= ELEVATION_RETRIES; attempt++) {
    try {
      const resp = await fetchWithTimeout(ELEVATION_ENDPOINT, {
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

  console.warn('Elevation chunk failed; using fallback terrain for this chunk:', lastError?.message ?? lastError);
  return {
    elevations: chunk.map(() => undefined),
    failed: true,
  };
};

const fetchElevationBatch = async (points) => {
  const elevations = [];
  let failedChunks = 0;

  for (let start = 0; start < points.length; start += ELEVATION_CHUNK_SIZE) {
    const chunk = points.slice(start, start + ELEVATION_CHUNK_SIZE);
    const result = await fetchElevationChunk(chunk);
    elevations.push(...result.elevations);
    if (result.failed) failedChunks += 1;
  }

  return { elevations, failedChunks };
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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [freqBand, setFreqBand] = useState('vhf');
  const [nextSiteId, setNextSiteId] = useState(2);
  const [analysisNotice, setAnalysisNotice] = useState('Ready for coverage prediction.');
  const isAnalyzingRef = useRef(false);
  const sitesRef = useRef(sites);

  const activeSite = sites.find((site) => site.id === activeSiteId) ?? sites[0];
  const mapCenter = activeSite?.position ?? [3.1390, 101.6869];
  const activeSitePreviewId = activeSite?.id;
  const activeSiteLat = activeSite?.position[0];
  const activeSiteLon = activeSite?.position[1];
  const powerDbm = 10 * Math.log10(power * 1000);
  const combinedAreas = useMemo(() => sites.reduce((total, site) => ({
    strong: total.strong + site.areas.strong,
    moderate: total.moderate + site.areas.moderate,
    weak: total.weak + site.areas.weak,
  }), { ...EMPTY_AREAS }), [sites]);

  const analyzedSites = sites.filter((site) => site.coveragePolygons.weak).length;

  useEffect(() => {
    sitesRef.current = sites;
  }, [sites]);

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

  const analyzeSite = useCallback(async (site) => {
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
    const haatSamples = [];
    const newPolygons = { strong: [], moderate: [], weak: [] };

    for (let radialIndex = 0; radialIndex < RADIALS_COUNT; radialIndex++) {
      const bearing = (radialIndex * 360) / RADIALS_COUNT;
      const offset = radialIndex * SAMPLING_INTERVALS_KM.length;
      const radialSamples = SAMPLING_INTERVALS_KM.map((distanceKm, sampleIndex) => ({
        distanceKm,
        elevation: radialElevations[offset + sampleIndex] ?? siteElevation,
      }));
      const avgElevation = radialSamples.reduce((total, sample) => total + sample.elevation, 0) / radialSamples.length;
      haatSamples.push(avgElevation);

      const haat = (siteElevation + hTx) - avgElevation;
      const effectiveHTx = clamp(hTx + Math.max(0, haat), 2, 300);

      GRADE_CONFIG.forEach((grade) => {
        const targetLoss = powerDbm + gain - grade.thresholdDbm;
        const radius = findReliableDistance({
          freq,
          effectiveHTx,
          hTx,
          hRx,
          targetLoss,
          radialSamples,
          siteElevation,
        });
        newPolygons[grade.key].push(getDestinationPoint(site.position[0], site.position[1], bearing, radius));
      });
    }

    const avgHaat = (siteElevation + hTx) - (haatSamples.reduce((total, elevation) => total + elevation, 0) / haatSamples.length);

    return {
      ...site,
      elevation: siteElevation,
      haat: Math.max(2, avgHaat),
      coveragePolygons: newPolygons,
      areas: {
        strong: calculateAreaKm2(newPolygons.strong),
        moderate: calculateAreaKm2(newPolygons.moderate),
        weak: calculateAreaKm2(newPolygons.weak),
      },
      status: failedChunks > 0 ? 'degraded' : 'analyzed',
      failedChunks,
    };
  }, [freq, gain, hRx, hTx, powerDbm]);

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

    const analyzed = [];
    let failedSites = 0;
    let degradedSites = 0;

    for (const site of sitesToAnalyze) {
      try {
        const result = await analyzeSite(site);
        if (result.status === 'degraded') degradedSites += 1;
        analyzed.push(result);
      } catch (e) {
        failedSites += 1;
        console.error(`Coverage analysis failed for ${site.name}`, e);
        analyzed.push({ ...site, status: 'failed' });
      }
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
              <img src="/brand_logo_v5.png" alt="Brand" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.2rem', fontWeight: '900', letterSpacing: '0.5px' }}>9M2PJU Coverage Prediction</h1>
              <p style={{ fontSize: '0.75rem', fontWeight: '600' }}>Multi-Site Coverage Prediction v4.3</p>
            </div>
          </div>
        </div>

        <div className={`glass-panel control-panel ${isPanelOpen ? 'open' : ''}`}>
          <div className="bottom-sheet-drag mobile-only" onClick={() => setIsPanelOpen(!isPanelOpen)} />

          <div className="mobile-header-content mobile-only" onClick={() => setIsPanelOpen(!isPanelOpen)} style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src="/brand_logo_v4.png" alt="Logo" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
              <div>
                <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '900', color: 'var(--title-blue)', letterSpacing: '0.5px' }}>9M2PJU Coverage Prediction</h1>
                <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Multi-Site Coverage Prediction v4.3</p>
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
            <label><Activity size={12} style={{ marginRight: '6px' }} /> TX POWER: {power}W</label>
            <input type="range" min="1" max="100" value={power} onChange={(e) => setPower(Number(e.target.value))} />
          </div>

          <div className="control-group">
            <label><Activity size={12} style={{ marginRight: '6px' }} /> ANTENNA GAIN: {gain}dBi</label>
            <input type="range" min="0" max="20" value={gain} onChange={(e) => setGain(Number(e.target.value))} />
          </div>

          <div className="control-group">
            <label><Activity size={12} style={{ marginRight: '6px' }} /> RX HEIGHT: {hRx.toFixed(1)}m AGL</label>
            <input type="range" min="1" max="15" step="0.5" value={hRx} onChange={(e) => setHRx(Number(e.target.value))} />
          </div>

          <div className="control-group">
            <label style={{ fontSize: '0.7rem', color: '#888', display: 'block', marginBottom: '10px' }}><Radio size={12} /> BAND SELECTOR</label>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <button
                onClick={() => { setFreqBand('vhf'); setFreq(144); }}
                style={{ flex: 1, padding: '6px', fontSize: '0.75rem', borderRadius: '8px', border: '1px solid #ddd', background: freqBand === 'vhf' ? '#0072ff' : 'white', color: freqBand === 'vhf' ? 'white' : '#333', fontWeight: 'bold' }}
              >VHF (30-300)</button>
              <button
                onClick={() => { setFreqBand('uhf'); setFreq(430); }}
                style={{ flex: 1, padding: '6px', fontSize: '0.75rem', borderRadius: '8px', border: '1px solid #ddd', background: freqBand === 'uhf' ? '#0072ff' : 'white', color: freqBand === 'uhf' ? 'white' : '#333', fontWeight: 'bold' }}
              >UHF/SHF (300-3000)</button>
            </div>
            <label>FREQUENCY: {freq}MHz</label>
            <input
              type="range"
              min={freqBand === 'vhf' ? 30 : 300}
              max={freqBand === 'vhf' ? 300 : 3000}
              value={freq}
              onChange={(e) => setFreq(Number(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label><Layers size={12} style={{ marginRight: '6px' }} /> TOWER HEIGHT: {hTx}m AGL</label>
            <input type="range" min="2" max="200" value={hTx} onChange={(e) => setHTx(Number(e.target.value))} />
          </div>

          <div className="control-group" style={{ marginTop: '25px', borderTop: '1px solid var(--glass-border)', paddingTop: '15px' }}>
            <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '10px', letterSpacing: '1px' }}>SIGNAL LEVELS</p>
            <div className="pro-legend-item">
              <div style={{ width: 10, height: 10, background: '#4dbd74', border: '1px solid white' }}></div>
              <span>Service Grade A (Reliable)</span>
            </div>
            <div className="pro-legend-item">
              <div style={{ width: 10, height: 10, background: '#ffc107', border: '1px solid white' }}></div>
              <span>Service Grade B (Mobile)</span>
            </div>
            <div className="pro-legend-item">
              <div style={{ width: 10, height: 10, background: '#ff4444', border: '1px solid white' }}></div>
              <span>Fringe (Occasional)</span>
            </div>
          </div>
        </div>
      </div>

      <MapContainer
        center={mapCenter}
        zoom={11}
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
                maxZoom={layer.maxZoom}
                subdomains={layer.subdomains ?? 'abc'}
              />
            </LayersControl.BaseLayer>
          ))}
        </LayersControl>
        <ZoomControl position="topright" />
        <MapClickHandler onClick={updateActiveSitePosition} />

        {sites.map((site) => (
          <React.Fragment key={`coverage-${site.id}`}>
            {GRADE_CONFIG.map((grade) => site.coveragePolygons[grade.key] && (
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
                Fringe: {site.areas.weak.toFixed(0)} km²
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

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
