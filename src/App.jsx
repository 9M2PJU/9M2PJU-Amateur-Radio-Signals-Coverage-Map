import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, Circle, Popup, Polygon } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Radio, MapPin, Activity, HelpCircle, Layers, Zap, Mountain, BarChart3, Maximize2 } from 'lucide-react';
import L from 'leaflet';

// Fix Leaflet marker icons
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Helper: Get coordinate at distance and bearing
const getDestinationPoint = (lat, lon, brng, dist) => {
  const R = 6371; // Earth radius in km
  const ad = dist / R;
  const la1 = lat * Math.PI / 180;
  const lo1 = lon * Math.PI / 180;
  const b = brng * Math.PI / 180;

  const la2 = Math.asin(Math.sin(la1) * Math.cos(ad) + Math.cos(la1) * Math.sin(ad) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(ad) * Math.cos(la1), Math.cos(ad) - Math.sin(la1) * Math.sin(la2));

  return [la2 * 180 / Math.PI, lo2 * 180 / Math.PI];
};

// Helper: Calculate Area of a Polygon using Shoelace Formula (approximate for lat/lng)
const calculateAreaKm2 = (points) => {
  if (!points || points.length < 3) return 0;
  let area = 0;
  const R = 6371; // Earth radius

  // Project points to local flat plane (approximate)
  const lat0 = points[0][0] * Math.PI / 180;
  const projected = points.map(p => {
    const lat = p[0] * Math.PI / 180;
    const lon = p[1] * Math.PI / 180;
    return [
      R * lon * Math.cos(lat0),
      R * lat
    ];
  });

  for (let i = 0; i < projected.length; i++) {
    const j = (i + 1) % projected.length;
    area += projected[i][0] * projected[j][1];
    area -= projected[j][0] * projected[i][1];
  }
  return Math.abs(area) / 2;
};

// Propagation Model: Okumura-Hata
const calculatePathLoss = (freq, hTx, hRx, distanceKm) => {
  if (distanceKm <= 0.1) return 0;
  const logFreq = Math.log10(freq);
  const logHTx = Math.log10(Math.max(2, hTx));
  const aHr = (1.1 * logFreq - 0.7) * hRx - (1.56 * logFreq - 0.8);
  const logDist = Math.log10(distanceKm);
  return 69.55 + 26.16 * logFreq - 13.82 * logHTx - aHr + (44.9 - 6.55 * logHTx) * logDist;
};

const findDistanceFromLoss = (freq, hTx, hRx, targetLoss) => {
  let low = 0.01, high = 500;
  for (let i = 0; i < 20; i++) {
    let mid = (low + high) / 2;
    if (calculatePathLoss(freq, hTx, hRx, mid) < targetLoss) low = mid;
    else high = mid;
  }
  return low;
};

function MapClickHandler({ onClick }) {
  useMapEvents({
    click: (e) => onClick([e.latlng.lat, e.latlng.lng]),
  });
  return null;
}

function App() {
  const [position, setPosition] = useState([3.1390, 101.6869]);
  const [elevation, setElevation] = useState(0);
  const [power, setPower] = useState(50);
  const [freq, setFreq] = useState(144);
  const [hTx, setHTx] = useState(30);
  const [hRx, setHRx] = useState(1.5);
  const [haat, setHaat] = useState(30);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [freqBand, setFreqBand] = useState('vhf');

  // Coverage Polygons
  const [coveragePolygons, setCoveragePolygons] = useState({
    strong: null,
    moderate: null,
    weak: null
  });

  const [areas, setAreas] = useState({ strong: 0, moderate: 0, weak: 0 });

  const powerDbm = 10 * Math.log10(power * 1000);

  // Fetch base elevation
  useEffect(() => {
    fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${position[0]},${position[1]}`)
      .then(r => r.json())
      .then(d => d.results?.[0] && setElevation(d.results[0].elevation));
  }, [position]);

  // High-Resolution Terrain Analysis
  const analyzeTerrain = useCallback(async () => {
    setIsAnalyzing(true);

    // Thresholds: Strong (S9/-93dBm), Moderate (S5/-105dBm), Marginal (-115dBm)
    const thresholds = [
      { key: 'strong', loss: powerDbm - (-93) },
      { key: 'moderate', loss: powerDbm - (-105) },
      { key: 'weak', loss: powerDbm - (-115) }
    ];

    const radialsCount = 72; // Much higher density for "jagged" professional look
    const samplingIntervals = [2, 4, 6, 8, 10, 12, 14, 16]; // Samples for HAAT and blocking

    let allPoints = [];
    for (let i = 0; i < radialsCount; i++) {
      const bearing = (i * 360) / radialsCount;
      samplingIntervals.forEach(d => {
        allPoints.push(getDestinationPoint(position[0], position[1], bearing, d));
      });
    }

    try {
      // Chunking requests to handle large batch sizes if needed
      const resp = await fetch("https://api.open-elevation.com/api/v1/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations: allPoints.map(p => ({ latitude: p[0], longitude: p[1] })) })
      });
      const data = await resp.json();
      const results = data.results;

      let newPolygons = { strong: [], moderate: [], weak: [] };
      let haatSamples = [];

      for (let i = 0; i < radialsCount; i++) {
        const offset = i * samplingIntervals.length;
        const radialElevs = results.slice(offset, offset + samplingIntervals.length).map(r => r.elevation);
        const avgElevForHaat = radialElevs.reduce((a, b) => a + b, 0) / radialElevs.length;
        haatSamples.push(avgElevForHaat);

        const bearing = (i * 360) / radialsCount;

        // Knife-Edge Blocking Logic: Find if terrain ever exceeds LoS
        const blockingIdx = radialElevs.findIndex(e => e > (elevation + hTx));

        thresholds.forEach(t => {
          let radius = findDistanceFromLoss(freq, hTx, hRx, t.loss);

          if (blockingIdx !== -1) {
            const blockedDist = samplingIntervals[blockingIdx];
            if (radius > blockedDist) {
              radius = blockedDist * 0.9; // Intense shadowing
            }
          }

          newPolygons[t.key].push(getDestinationPoint(position[0], position[1], bearing, radius));
        });
      }

      setCoveragePolygons(newPolygons);
      setAreas({
        strong: calculateAreaKm2(newPolygons.strong),
        moderate: calculateAreaKm2(newPolygons.moderate),
        weak: calculateAreaKm2(newPolygons.weak)
      });

      const avgHaat = (elevation + hTx) - (haatSamples.reduce((a, b) => a + b, 0) / haatSamples.length);
      setHaat(Math.max(2, avgHaat));

    } catch (e) {
      console.error("Pro Analysis failed", e);
    } finally {
      setIsAnalyzing(false);
      setIsPanelOpen(false); // Close sheet after analysis
    }
  }, [position, elevation, hTx, powerDbm, freq, hRx]);

  return (
    <div className="app-container">
      {/* Top Pro Metrics Bar */}
      <div className="pro-metrics-bar glass-panel" style={{
        position: 'absolute', top: '20px', left: '360px', right: '20px', zIndex: 1000,
        display: 'flex', padding: '12px 24px', gap: '40px', alignItems: 'center', pointerEvents: 'auto'
      }}>
        <div style={{ display: 'flex', gap: '15px' }}>
          <div className="metric-box">
            <span style={{ color: '#4dbd74', fontSize: '0.65rem', fontWeight: 'bold' }}>STRONG (56.0 dBμV/m)</span>
            <p style={{ fontSize: '1rem', fontWeight: '800' }}>{areas.strong.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</p>
          </div>
          <div className="metric-box">
            <span style={{ color: '#ffc107', fontSize: '0.65rem', fontWeight: 'bold' }}>MODERATE (48.0 dBμV/m)</span>
            <p style={{ fontSize: '1rem', fontWeight: '800' }}>{areas.moderate.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</p>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '20px' }} className="pc-only-metrics">
          <div className="metric-badge">
            <Mountain size={14} style={{ marginRight: '6px' }} />
            <span>SITE: {elevation}m AMSL</span>
          </div>
          <div className="metric-badge">
            <BarChart3 size={14} style={{ marginRight: '6px' }} />
            <span>HAAT: {haat.toFixed(1)}m</span>
          </div>
        </div>
      </div>

      <div className="ui-overlay">
        {/* Mobile Header */}
        <div className="glass-panel header-panel mobile-only">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src="/brand_logo_v4.png" alt="Logo" style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
              <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '800' }}>9M2PJU</h1>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-secondary)' }}>HAAT: {haat.toFixed(1)}m</div>
          </div>
        </div>

        {/* FAB (Mobile) */}
        <button
          className="fab-scan mobile-only"
          onClick={analyzeTerrain}
          disabled={isAnalyzing}
        >
          {isAnalyzing ? <div className="loading-spinner" /> : <Zap size={24} fill="white" />}
        </button>

        {/* PC Header */}
        <div className="glass-panel header-panel pc-only">
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div style={{ background: 'white', padding: '6px', borderRadius: '10px', display: 'flex', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', border: '1px solid #eee' }}>
              <img src="/brand_logo_v5.png" alt="Brand" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.2rem', fontWeight: '900', letterSpacing: '0.5px' }}>9M2PJU PRO SIGNAL</h1>
              <p style={{ fontSize: '0.75rem', fontWeight: '600' }}>Terrain-Aware Coverage v4.1</p>
            </div>
          </div>
        </div>

        <div className={`glass-panel control-panel ${isPanelOpen ? 'open' : ''}`}>
          <div className="bottom-sheet-drag mobile-only" onClick={() => setIsPanelOpen(!isPanelOpen)} />

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
                {isAnalyzing ? 'SCALING TERRAIN...' : 'RUN RF COVERAGE ANALYSIS'}
              </button>
            </div>
          </div>

          <div className="mobile-only">
            <p style={{ fontSize: '0.7rem', color: '#888', marginBottom: '15px', fontWeight: 'bold' }}>RF METRICS (km²)</p>
            <div className="mobile-metrics">
              <div className="mobile-metric-card">
                <span style={{ fontSize: '0.6rem', color: '#4dbd74', display: 'block' }}>STRONG</span>
                <strong style={{ fontSize: '0.9rem' }}>{areas.strong.toFixed(0)}</strong>
              </div>
              <div className="mobile-metric-card">
                <span style={{ fontSize: '0.6rem', color: '#f57f17', display: 'block' }}>MODERATE</span>
                <strong style={{ fontSize: '0.9rem' }}>{areas.moderate.toFixed(0)}</strong>
              </div>
              <div className="mobile-metric-card">
                <span style={{ fontSize: '0.6rem', color: '#d32f2f', display: 'block' }}>FRINGE</span>
                <strong style={{ fontSize: '0.9rem' }}>{areas.weak.toFixed(0)}</strong>
              </div>
            </div>
          </div>

          <div className="control-group">
            <label><Activity size={12} style={{ marginRight: '6px' }} /> TX POWER: {power}W</label>
            <input type="range" min="1" max="100" value={power} onChange={(e) => setPower(Number(e.target.value))} />
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

      <MapContainer center={position} zoom={11} className="map-container" zoomControl={false}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <MapClickHandler onClick={(pos) => {
          setPosition(pos);
          setCoveragePolygons({ strong: null, moderate: null, weak: null });
        }} />

        {coveragePolygons.weak && (
          <Polygon positions={coveragePolygons.weak} pathOptions={{
            color: '#ff4444', fillColor: '#ff4444', fillOpacity: 0.1, weight: 1, dashArray: '3, 3'
          }} />
        )}
        {coveragePolygons.moderate && (
          <Polygon positions={coveragePolygons.moderate} pathOptions={{
            color: '#ffc107', fillColor: '#ffc107', fillOpacity: 0.2, weight: 1
          }} />
        )}
        {coveragePolygons.strong && (
          <Polygon positions={coveragePolygons.strong} pathOptions={{
            color: '#4dbd74', fillColor: '#4dbd74', fillOpacity: 0.4, weight: 2
          }} />
        )}

        <Marker position={position}>
          <Popup>
            <div style={{ color: '#000', fontSize: '0.8rem' }}>
              <strong style={{ fontSize: '0.9rem' }}>REPEATER SITE</strong><br />
              Lat/Lon: {position[0].toFixed(4)}, {position[1].toFixed(4)}<br />
              Elev: {elevation}m AMSL | HAAT: {haat.toFixed(1)}m
            </div>
          </Popup>
        </Marker>
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
        /* Visibility Classes */
        @media (max-width: 768px) {
          .pc-only, .pc-only-metrics { display: none !important; }
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
      `}</style>
    </div >
  );
}

export default App;
