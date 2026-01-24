import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, Circle, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Radio, MapPin, Activity, HelpCircle, Layers } from 'lucide-react';
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

// Propagation Model: Okumura-Hata
// This is a simplified version for common ham radio frequencies (150-1500MHz)
const calculatePathLoss = (freq, hTx, hRx, distanceKm) => {
  if (distanceKm <= 0) return 0;

  // A is for small/medium cities
  const logFreq = Math.log10(freq);
  const logHTx = Math.log10(hTx);
  const logDist = Math.log10(distanceKm);

  // Correction factor for receiver height (small city)
  const aHr = (1.1 * logFreq - 0.7) * hRx - (1.56 * logFreq - 0.8);

  const loss = 69.55 + 26.16 * logFreq - 13.82 * logHTx - aHr + (44.9 - 6.55 * logHTx) * logDist;
  return loss;
};

// Calculate distance for a given target loss
const findDistanceFromLoss = (freq, hTx, hRx, targetLoss) => {
  // Simple binary search or iterative approach for distance
  let low = 0.01;
  let high = 500; // max 500km
  for (let i = 0; i < 20; i++) {
    let mid = (low + high) / 2;
    if (calculatePathLoss(freq, hTx, hRx, mid) < targetLoss) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
};

function MapClickHandler({ onClick }) {
  useMapEvents({
    click: (e) => onClick(e.latlng),
  });
  return null;
}

function App() {
  const [position, setPosition] = useState([3.1390, 101.6869]); // Default to Kuala Lumpur
  const [elevation, setElevation] = useState(0);
  const [power, setPower] = useState(50); // Watts
  const [freq, setFreq] = useState(144); // MHz (2m band)
  const [hTx, setHTx] = useState(30); // Meters (Height above ground)
  const [hRx, setHRx] = useState(1.5); // Meters
  const [isLoadingElev, setIsLoadingElev] = useState(false);

  // Fetch elevation when position changes
  useEffect(() => {
    const fetchElevation = async () => {
      setIsLoadingElev(true);
      try {
        const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${position[0]},${position[1]}`);
        const data = await response.json();
        if (data.results && data.results[0]) {
          setElevation(data.results[0].elevation);
        }
      } catch (error) {
        console.error("Failed to fetch elevation:", error);
      } finally {
        setIsLoadingElev(false);
      }
    };

    fetchElevation();
  }, [position]);

  const powerDbm = 10 * Math.log10(power * 1000);

  // Effective height for Hata model
  // In a more complex model, we'd use HAAT (Height Above Average Terrain)
  const effectiveHTx = Math.max(2, hTx);

  // Coverage radii based on signal strength thresholds
  const coverageData = useMemo(() => {
    // S9 signal usually around -93 dBm
    // S5 signal usually around -109 dBm
    // Limit/Noise floor usually -120 dBm
    const thresholds = [
      { color: '#00a3ff', loss: powerDbm - (-93), label: 'Strong (S9+)' },
      { color: '#8a2be2', loss: powerDbm - (-105), label: 'Moderate (S5)' },
      { color: '#ff0055', loss: powerDbm - (-115), label: 'Weak (Marginal)' }
    ];

    return thresholds.map(t => ({
      ...t,
      radius: findDistanceFromLoss(freq, effectiveHTx, hRx, t.loss) * 1000 // Convert km to meters
    })).sort((a, b) => b.radius - a.radius);
  }, [powerDbm, freq, effectiveHTx, hRx]);

  return (
    <div className="app-container">
      <div className="ui-overlay">
        <div className="glass-panel header-panel">
          <h1>9M2PJU Amateur Radio Signals Coverage Map</h1>
          <p>Professional Propagation Analysis</p>
        </div>

        <div className="glass-panel control-panel">
          <div className="control-group" style={{ marginBottom: '24px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Site Elevation</span>
              <span className="value-badge" style={{ color: 'var(--accent-blue)' }}>
                {isLoadingElev ? '...' : `${elevation}m`} AMSL
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Antenna Total</span>
              <span className="value-badge">
                {elevation + hTx}m AMSL
              </span>
            </div>
          </div>

          <div className="control-group">
            <label><Activity size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} /> Transmit Power (Watts)</label>
            <div className="slider-container">
              <input
                type="range" min="1" max="100" value={power}
                onChange={(e) => setPower(Number(e.target.value))}
              />
              <span className="value-badge">{power}W</span>
            </div>
          </div>

          <div className="control-group">
            <label><Radio size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} /> Frequency (MHz)</label>
            <div className="slider-container">
              <input
                type="range" min="130" max="450" value={freq}
                onChange={(e) => setFreq(Number(e.target.value))}
              />
              <span className="value-badge">{freq}MHz</span>
            </div>
          </div>

          <div className="control-group">
            <label><Layers size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} /> Antenna Height (m AGL)</label>
            <div className="slider-container">
              <input
                type="range" min="2" max="100" value={hTx}
                onChange={(e) => setHTx(Number(e.target.value))}
              />
              <span className="value-badge">{hTx}m</span>
            </div>
          </div>

          <div className="control-group" style={{ marginTop: '20px', borderTop: '1px solid var(--glass-border)', paddingTop: '16px' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Legend</p>
            {coverageData.slice().reverse().map(c => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <div style={{ width: 12, height: 12, borderRadius: '2px', backgroundColor: c.color }}></div>
                <span style={{ fontSize: '0.75rem' }}>{c.label}: {(c.radius / 1000).toFixed(1)}km</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <HelpCircle size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
          Click on map to move transmitter
        </div>
      </div>

      <MapContainer
        center={position}
        zoom={11}
        className="map-container"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <MapClickHandler onClick={setPosition} />

        {coverageData.map((c, idx) => (
          <Circle
            key={idx}
            center={position}
            radius={c.radius}
            pathOptions={{
              color: c.color,
              fillColor: c.color,
              fillOpacity: 0.15,
              weight: 1
            }}
          />
        ))}

        <Marker position={position}>
          <Popup>
            <strong>Transmitter Site</strong><br />
            {position[0].toFixed(4)}, {position[1].toFixed(4)}<br />
            Elev: {elevation}m AMSL
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}

export default App;
