import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, Circle, Popup, Polygon } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Radio, MapPin, Activity, HelpCircle, Layers, Zap, Mountain, AlertTriangle } from 'lucide-react';
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

// Propagation Model: Okumura-Hata
const calculatePathLoss = (freq, hTx, hRx, distanceKm) => {
  if (distanceKm <= 0.1) return 0;
  const logFreq = Math.log10(freq);
  const logHTx = Math.log10(Math.max(2, hTx));
  const logDist = Math.log10(distanceKm);
  const aHr = (1.1 * logFreq - 0.7) * hRx - (1.56 * logFreq - 0.8);
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
  const [terrainShadows, setTerrainShadows] = useState(null);

  const powerDbm = 10 * Math.log10(power * 1000);

  // Fetch base elevation
  useEffect(() => {
    fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${position[0]},${position[1]}`)
      .then(r => r.json())
      .then(d => d.results?.[0] && setElevation(d.results[0].elevation));
  }, [position]);

  // Deep Terrain Analysis: Sample radials to find HAAT and shadowing
  const analyzeTerrain = useCallback(async () => {
    setIsAnalyzing(true);
    setTerrainShadows(null);

    // Thresholds for coverage (standard)
    const thresholdLoss = powerDbm - (-105); // S5 coverage limit
    const baseRadius = findDistanceFromLoss(freq, hTx, hRx, thresholdLoss);

    const radialsCount = 16;
    const samplingDistances = [3.2, 5, 8, 11, 14, 16]; // Standard HAAT distances (km)

    let allPoints = [];
    for (let i = 0; i < radialsCount; i++) {
      const bearing = (i * 360) / radialsCount;
      samplingDistances.forEach(d => {
        allPoints.push(getDestinationPoint(position[0], position[1], bearing, d));
      });
    }

    try {
      // Fetch batch elevation for all radial points
      const resp = await fetch("https://api.open-elevation.com/api/v1/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations: allPoints.map(p => ({ latitude: p[0], longitude: p[1] })) })
      });
      const data = await resp.json();

      const results = data.results;
      let radialData = [];
      let totalAvgElev = 0;

      for (let i = 0; i < radialsCount; i++) {
        const offset = i * samplingDistances.length;
        const radialElevs = results.slice(offset, offset + samplingDistances.length).map(r => r.elevation);
        const avgElev = radialElevs.reduce((a, b) => a + b, 0) / radialElevs.length;
        totalAvgElev += avgElev;

        // Simple LoS Check: If any point on radial > hTx + baseElev + small buffer, signal is blocked
        const blockingPointIdx = radialElevs.findIndex(e => e > (elevation + hTx));
        const bearing = (i * 360) / radialsCount;

        let radialDist = baseRadius;
        if (blockingPointIdx !== -1) {
          radialDist = samplingDistances[blockingPointIdx] * 0.8; // Cut coverage if blocked
        }

        radialData.push(getDestinationPoint(position[0], position[1], bearing, radialDist));
      }

      setHaat(Math.max(2, elevation + hTx - (totalAvgElev / radialsCount)));
      setTerrainShadows(radialData);
    } catch (e) {
      console.error("Terrain analysis failed", e);
    } finally {
      setIsAnalyzing(false);
    }
  }, [position, elevation, hTx, powerDbm, freq, hRx]);

  // Dynamic Coverage Radii
  const coverageData = useMemo(() => {
    const thresholds = [
      { color: '#00a3ff', loss: powerDbm - (-93), label: 'Strong (S9+)' },
      { color: '#8a2be2', loss: powerDbm - (-105), label: 'Moderate (S5)' },
      { color: '#ff0055', loss: powerDbm - (-115), label: 'Weak (Marginal)' }
    ];

    return thresholds.map(t => ({
      ...t,
      radius: findDistanceFromLoss(freq, haat, hRx, t.loss) * 1000
    })).sort((a, b) => b.radius - a.radius);
  }, [powerDbm, freq, haat, hRx]);

  return (
    <div className="app-container">
      <div className="ui-overlay">
        <div className="glass-panel header-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Zap color="var(--accent-blue)" size={24} />
            <div>
              <h1>9M2PJU Coverage Map</h1>
              <p>Advanced Repeater Analysis</p>
            </div>
          </div>
        </div>

        <div className="glass-panel control-panel">
          <div className="control-group" style={{ marginBottom: '24px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Site Elevation</span>
              <span style={{ fontSize: '0.85rem' }}>{elevation}m AMSL</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>HAAT (Effective)</span>
              <span style={{ fontSize: '0.85rem', color: 'var(--accent-blue)', fontWeight: 'bold' }}>{haat.toFixed(1)}m</span>
            </div>
            <button
              className={`action-button ${isAnalyzing ? 'loading' : ''}`}
              onClick={analyzeTerrain}
              disabled={isAnalyzing}
              style={{
                width: '100%', padding: '10px', borderRadius: '8px',
                background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))',
                color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold',
                marginTop: '8px', transition: 'all 0.3s'
              }}
            >
              {isAnalyzing ? 'Analyzing Topography...' : 'Analyze Real Terrain'}
            </button>
          </div>

          <div className="control-group">
            <label><Activity size={12} style={{ marginRight: '6px' }} /> Power: {power}W</label>
            <input type="range" min="1" max="100" value={power} onChange={(e) => setPower(Number(e.target.value))} />
          </div>

          <div className="control-group">
            <label><Radio size={12} style={{ marginRight: '6px' }} /> Freq: {freq}MHz</label>
            <input type="range" min="130" max="450" value={freq} onChange={(e) => setFreq(Number(e.target.value))} />
          </div>

          <div className="control-group">
            <label><Layers size={12} style={{ marginRight: '6px' }} /> Ant Height: {hTx}m AGL</label>
            <input type="range" min="2" max="200" value={hTx} onChange={(e) => setHTx(Number(e.target.value))} />
          </div>

          <div className="control-group legend" style={{ marginTop: '20px' }}>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '8px uppercase' }}>Signal Strengths</p>
            {coverageData.slice().reverse().map(c => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.color }}></div>
                <span style={{ fontSize: '0.75rem' }}>{c.label}: {(c.radius / 1000).toFixed(1)}km</span>
              </div>
            ))}
            {terrainShadows && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', padding: '8px', background: 'rgba(255,0,0,0.1)', borderRadius: '4px' }}>
                <Mountain size={12} color="#ff4444" />
                <span style={{ fontSize: '0.7rem', color: '#ff4444' }}>Terrain Shadowing Active</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <MapContainer center={position} zoom={11} className="map-container" zoomControl={false}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution="&copy; OpenStreetMap contributors &copy; CARTO"
        />
        <MapClickHandler onClick={(pos) => { setPosition(pos); setTerrainShadows(null); }} />

        {terrainShadows ? (
          <Polygon
            positions={terrainShadows}
            pathOptions={{ color: '#00a3ff', fillColor: '#00a3ff', fillOpacity: 0.2, weight: 2, dashArray: '5, 5' }}
          />
        ) : (
          coverageData.map((c, idx) => (
            <Circle key={idx} center={position} radius={c.radius}
              pathOptions={{ color: c.color, fillColor: c.color, fillOpacity: 0.1, weight: 1 }}
            />
          ))
        )}

        <Marker position={position}>
          <Popup>
            <div style={{ color: '#000' }}>
              <strong>TX Site: {position[0].toFixed(4)}, {position[1].toFixed(4)}</strong><br />
              Ground: {elevation}m AMSL<br />
              Antenna: {hTx}m AGL<br />
              HAAT: {haat.toFixed(1)}m
            </div>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}

export default App;
