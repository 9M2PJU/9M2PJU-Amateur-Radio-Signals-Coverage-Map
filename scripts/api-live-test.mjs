/**
 * Live API tests for 9M2PJU Coverage Prediction.
 *
 * Tests all external APIs used by the application:
 * 1. Open Elevation API (primary + fallback)
 * 2. ITM Longley-Rice API (if available)
 * 3. Map tile servers (OpenStreetMap)
 *
 * These tests make real network requests and verify that the APIs
 * are reachable, respond correctly, and return data in the expected format.
 *
 * Run with: npm run test:api
 *
 * Note: These tests require internet connectivity. They will be marked
 * as SKIP if the APIs are unreachable (not FAIL) to avoid false negatives
 * in CI environments without network access.
 */

let passed = 0;
let failed = 0;
let skipped = 0;

const assert = (condition, message) => {
  if (condition) {
    passed += 1;
    console.log(`  PASS: ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${message}`);
  }
};

const skip = (message) => {
  skipped += 1;
  console.log(`  SKIP: ${message}`);
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return resp;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
};

// ===========================================================================
// 1. Open Elevation API (primary)
// ===========================================================================

console.log('Testing Open Elevation API (primary: elevation.hamradio.my)...\n');

const PRIMARY_ELEVATION_URL = 'https://elevation.hamradio.my/api/v1/lookup';

try {
  const resp = await fetchWithTimeout(PRIMARY_ELEVATION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: [
        { latitude: 3.139, longitude: 101.6869 },
        { latitude: 35.6762, longitude: 139.6503 },
      ],
    }),
  });

  assert(resp.ok, 'Primary elevation API should return 200 OK');

  const data = await resp.json();
  assert(Array.isArray(data?.results), 'Elevation API should return results array');
  assert(data?.results?.length === 2, 'Elevation API should return 2 results for 2 queries');
  assert(typeof data?.results?.[0]?.elevation === 'number', 'Each result should have numeric elevation');
  assert(data?.results?.[0]?.elevation >= -500 && data?.results?.[0]?.elevation < 9000, 'Kuala Lumpur elevation should be in valid range');
  assert(typeof data?.results?.[0]?.latitude === 'number', 'Each result should include latitude');
  assert(typeof data?.results?.[0]?.longitude === 'number', 'Each result should include longitude');
} catch (error) {
  if (error.name === 'AbortError') {
    skip('Primary elevation API timed out (network issue, not a code bug)');
  } else {
    skip(`Primary elevation API unreachable: ${error.message}`);
  }
}

// ===========================================================================
// 2. Open Elevation API (fallback)
// ===========================================================================

console.log('\nTesting Open Elevation API (fallback: api.open-elevation.com)...\n');

const FALLBACK_ELEVATION_URL = 'https://api.open-elevation.com/api/v1/lookup';

try {
  const resp = await fetchWithTimeout(FALLBACK_ELEVATION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: [
        { latitude: 40.7128, longitude: -74.006 },
      ],
    }),
  });

  assert(resp.ok, 'Fallback elevation API should return 200 OK');

  const data = await resp.json();
  assert(Array.isArray(data?.results), 'Fallback elevation API should return results array');
  assert(data?.results?.length === 1, 'Fallback elevation API should return 1 result');
  assert(typeof data?.results?.[0]?.elevation === 'number', 'Fallback result should have numeric elevation');
} catch (error) {
  if (error.name === 'AbortError') {
    skip('Fallback elevation API timed out');
  } else {
    skip(`Fallback elevation API unreachable: ${error.message}`);
  }
}

// ===========================================================================
// 3. ITM Longley-Rice API
// ===========================================================================

console.log('\nTesting ITM Longley-Rice API (itm.hamradio.my)...\n');

const ITM_API_URL = 'https://itm.hamradio.my';

try {
  // Health check
  const healthResp = await fetchWithTimeout(`${ITM_API_URL}/health`, {}, 10000);
  assert(healthResp.ok, 'ITM API health check should return 200 OK');

  const healthData = await healthResp.json();
  assert(healthData?.ok === true, 'ITM health response should have ok: true');
  assert(typeof healthData?.service === 'string', 'ITM health response should include service name');
  assert(typeof healthData?.nativeItm === 'boolean', 'ITM health response should indicate native ITM availability');
  assert(typeof healthData?.itmFrequencyLimitMhz === 'number', 'ITM health response should include frequency limit');

  // Radial loss calculation
  const radialResp = await fetchWithTimeout(`${ITM_API_URL}/itm/radial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frequencyMhz: 145,
      txHeightM: 10,
      rxHeightM: 1.5,
      siteElevationM: 100,
      radialSamples: [
        { distanceKm: 1, elevation: 100 },
        { distanceKm: 5, elevation: 110 },
        { distanceKm: 10, elevation: 105 },
      ],
      distancesKm: [1, 5, 10],
      confidence: 50,
      reliability: 50,
      climate: 1,
      polarization: 1,
      groundPermittivity: 15,
      groundConductivity: 0.005,
      surfaceRefractivity: 301,
    }),
  }, 20000);

  assert(radialResp.ok, 'ITM radial endpoint should return 200 OK');
  const radialData = await radialResp.json();
  assert(radialData?.ok === true, 'ITM radial response should have ok: true');
  assert(Array.isArray(radialData?.losses), 'ITM radial response should include losses array');
  assert(radialData?.losses?.length === 3, 'ITM radial response should have 3 loss entries');
  assert(typeof radialData?.losses?.[0]?.lossDb === 'number', 'ITM loss entries should have numeric lossDb');
  assert(typeof radialData?.engine === 'string', 'ITM radial response should indicate engine');

  // Verify loss increases with distance
  const losses = radialData?.losses?.map((l) => l.lossDb) ?? [];
  if (losses.length === 3) {
    assert(losses[1] > losses[0], 'ITM loss at 5 km should be > loss at 1 km');
    assert(losses[2] > losses[1], 'ITM loss at 10 km should be > loss at 5 km');
  }

  // Test with different frequency (UHF)
  const uhfResp = await fetchWithTimeout(`${ITM_API_URL}/itm/radial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frequencyMhz: 433,
      txHeightM: 10,
      rxHeightM: 1.5,
      siteElevationM: 100,
      radialSamples: [
        { distanceKm: 1, elevation: 100 },
        { distanceKm: 10, elevation: 100 },
      ],
      distancesKm: [1, 10],
    }),
  }, 20000);

  if (uhfResp.ok) {
    const uhfData = await uhfResp.json();
    const vhfLoss10 = losses[2];
    const uhfLoss10 = uhfData?.losses?.[1]?.lossDb;
    if (typeof vhfLoss10 === 'number' && typeof uhfLoss10 === 'number') {
      assert(uhfLoss10 > vhfLoss10, 'UHF (433 MHz) loss should be > VHF (145 MHz) loss at same distance');
    }
  }
} catch (error) {
  if (error.name === 'AbortError') {
    skip('ITM API timed out');
  } else {
    skip(`ITM API unreachable: ${error.message}`);
  }
}

// ===========================================================================
// 4. Map Tile Servers (OpenStreetMap)
// ===========================================================================

console.log('\nTesting OpenStreetMap tile server...\n');

try {
  // Test a single tile (zoom 10, around Kuala Lumpur)
  const tileUrl = 'https://tile.openstreetmap.org/10/635/426.png';
  const resp = await fetchWithTimeout(tileUrl, {}, 10000);
  assert(resp.ok, 'OpenStreetMap tile server should return 200 OK');
  assert(resp.headers.get('content-type')?.includes('image'), 'Tile response should be an image');
  const blob = await resp.blob();
  assert(blob.size > 1000, 'Tile image should be > 1KB');
} catch (error) {
  if (error.name === 'AbortError') {
    skip('OpenStreetMap tile server timed out');
  } else {
    skip(`OpenStreetMap tile server unreachable: ${error.message}`);
  }
}

// ===========================================================================
// 5. OpenStreetMap Nominatim (geocoding, if used)
// ===========================================================================

console.log('\nTesting OpenStreetMap Nominatim geocoding API...\n');

try {
  const resp = await fetchWithTimeout(
    'https://nominatim.openstreetmap.org/search?q=Kuala+Lumpur&format=json&limit=1',
    { headers: { 'User-Agent': '9M2PJU-Coverage-Map-Test/1.0' } },
    10000,
  );
  assert(resp.ok, 'Nominatim API should return 200 OK');
  const data = await resp.json();
  assert(Array.isArray(data), 'Nominatim should return JSON array');
  if (data.length > 0) {
    assert(typeof data[0]?.lat === 'string', 'Nominatim result should include lat');
    assert(typeof data[0]?.lon === 'string', 'Nominatim result should include lon');
  }
} catch (error) {
  if (error.name === 'AbortError') {
    skip('Nominatim API timed out');
  } else {
    skip(`Nominatim API unreachable: ${error.message}`);
  }
}

// ===========================================================================
// Summary
// ===========================================================================

console.log(`\n${passed} tests passed, ${failed} failed, ${skipped} skipped.`);
if (failed > 0) {
  process.exit(1);
}
console.log('API live tests completed.');
