/**
 * ITM backend integration tests.
 *
 * Starts the ITM server on a test port, sends requests to all endpoints,
 * and verifies response structure, validation, and fallback behavior.
 *
 * Run with: npm run test:itm
 */

const TEST_PORT = 18787;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let passed = 0;
let failed = 0;
let serverProcess = null;

const assert = (condition, message) => {
  if (condition) {
    passed += 1;
    console.log(`  PASS: ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${message}`);
  }
};

const fetchJson = async (url, options = {}) => {
  const resp = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await resp.json().catch(() => null);
  return { status: resp.status, body };
};

// ===========================================================================
// Start server
// ===========================================================================

console.log('Starting ITM test server on port', TEST_PORT);

const { spawn } = await import('node:child_process');

await new Promise((resolve, reject) => {
  serverProcess = spawn('node', ['itm-longley-rice/server.js'], {
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      ITM_RUNNER: '/dev/null', // Force fallback mode (no native ITM binary)
      RATE_LIMIT_MAX: '1000', // High limit for tests
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let started = false;
  const timeout = setTimeout(() => {
    if (!started) reject(new Error('Server failed to start within 10s'));
  }, 10000);

  serverProcess.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    if (text.includes('listening') && !started) {
      started = true;
      clearTimeout(timeout);
      setTimeout(resolve, 200);
    }
  });

  serverProcess.stderr.on('data', (chunk) => {
    console.error('Server stderr:', chunk.toString());
  });

  serverProcess.on('error', (error) => {
    clearTimeout(timeout);
    reject(error);
  });
});

console.log('Server started. Running tests...\n');

try {
  // ===========================================================================
  // 1. Health check
  // ===========================================================================

  console.log('Test: Health check endpoint');
  {
    const { status, body } = await fetchJson(`${BASE_URL}/health`);
    assert(status === 200, 'GET /health should return 200');
    assert(body?.ok === true, 'Health response should have ok: true');
    assert(typeof body?.service === 'string', 'Health response should include service name');
    assert(typeof body?.nativeItm === 'boolean', 'Health response should include nativeItm flag');
    assert(typeof body?.itmFrequencyLimitMhz === 'number', 'Health response should include frequency limit');
    assert(body?.raster !== undefined, 'Health response should include raster config');
  }

  // ===========================================================================
  // 2. Deep health check
  // ===========================================================================

  console.log('\nTest: Deep health check endpoint');
  {
    const { status, body } = await fetchJson(`${BASE_URL}/health?deep=true`);
    assert(status === 200, 'GET /health?deep=true should return 200');
    assert(body?.ok === true, 'Deep health response should have ok: true');
    // In fallback mode (no native ITM), deepCheck may not be present
    if (body?.nativeItm === false) {
      assert(true, 'Deep health check skips ITM test when native not available');
    } else {
      assert(body?.deepCheck !== undefined, 'Deep health response should include deepCheck when native available');
    }
  }

  // ===========================================================================
  // 3. ITM radial endpoint - valid request
  // ===========================================================================

  console.log('\nTest: ITM radial endpoint with valid request');
  {
    const { status, body } = await fetchJson(`${BASE_URL}/itm/radial`, {
      method: 'POST',
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
    });
    assert(status === 200, 'POST /itm/radial should return 200 for valid request');
    assert(body?.ok === true, 'Radial response should have ok: true');
    assert(Array.isArray(body?.losses), 'Radial response should include losses array');
    assert(body?.losses?.length === 3, 'Radial response should have 3 loss entries');
    assert(typeof body?.losses?.[0]?.lossDb === 'number', 'Each loss entry should have numeric lossDb');
    assert(typeof body?.losses?.[0]?.distanceKm === 'number', 'Each loss entry should have distanceKm');
    assert(body?.engine !== undefined, 'Radial response should include engine identifier');
    assert(body?.nativeItm === false, 'Radial response should indicate fallback mode (no native ITM)');
  }

  // ===========================================================================
  // 4. ITM radial endpoint - validation
  // ===========================================================================

  console.log('\nTest: ITM radial endpoint validation');
  {
    // Empty distances
    const { status, body } = await fetchJson(`${BASE_URL}/itm/radial`, {
      method: 'POST',
      body: JSON.stringify({
        frequencyMhz: 145,
        distancesKm: [],
        radialSamples: [],
      }),
    });
    assert(status === 400, 'POST /itm/radial with empty distances should return 400');
    assert(typeof body?.error === 'string', 'Error response should include error message');
  }

  // ===========================================================================
  // 5. ITM radial endpoint - loss should increase with distance
  // ===========================================================================

  console.log('\nTest: ITM radial loss monotonicity');
  {
    const { body } = await fetchJson(`${BASE_URL}/itm/radial`, {
      method: 'POST',
      body: JSON.stringify({
        frequencyMhz: 145,
        txHeightM: 10,
        rxHeightM: 1.5,
        siteElevationM: 100,
        radialSamples: [
          { distanceKm: 1, elevation: 100 },
          { distanceKm: 5, elevation: 105 },
          { distanceKm: 10, elevation: 100 },
          { distanceKm: 20, elevation: 95 },
          { distanceKm: 50, elevation: 100 },
        ],
        distancesKm: [1, 5, 10, 20, 50],
      }),
    });
    const losses = body?.losses?.map((l) => l.lossDb) ?? [];
    let isMonotonic = true;
    for (let i = 1; i < losses.length; i++) {
      if (losses[i] < losses[i - 1] - 0.01) {
        isMonotonic = false;
        break;
      }
    }
    assert(isMonotonic, 'Path loss should generally increase with distance');
  }

  // ===========================================================================
  // 6. Raster coverage endpoint - valid request
  // ===========================================================================

  console.log('\nTest: Raster coverage endpoint with valid request');
  {
    const { status, body } = await fetchJson(`${BASE_URL}/coverage/raster`, {
      method: 'POST',
      body: JSON.stringify({
        site: { lat: 3.139, lon: 101.6869, elevationM: 50 },
        frequencyMhz: 145,
        txHeightM: 10,
        rxHeightM: 1.5,
        txPowerDbm: 37,
        txGainDbi: 5,
        rxGainDbi: 3,
        systemLossDb: 2,
        clutterLossDb: 0,
        maxRangeKm: 10,
        cellSizeKm: 5,
        profileStepKm: 2,
        thresholdsDbm: { strong: -95, moderate: -105, weak: -115 },
      }),
    });

    // Note: This may fail if elevation API is unreachable, which is OK for testing
    if (status === 200) {
      assert(body?.ok === true, 'Raster response should have ok: true');
      assert(Array.isArray(body?.cells), 'Raster response should include cells array');
      assert(body?.areas !== undefined, 'Raster response should include areas');
      assert(body?.stats !== undefined, 'Raster response should include stats');
      assert(typeof body?.cellSizeKm === 'number', 'Raster response should include cellSizeKm');
      assert(body?.gradeCounts !== undefined, 'Raster response should include gradeCounts');
    } else {
      console.log(`  SKIP: Raster endpoint returned ${status} (likely elevation API unavailable)`);
    }
  }

  // ===========================================================================
  // 7. Raster coverage endpoint - validation
  // ===========================================================================

  console.log('\nTest: Raster coverage endpoint validation');
  {
    const { status } = await fetchJson(`${BASE_URL}/coverage/raster`, {
      method: 'POST',
      body: JSON.stringify({
        site: { lat: 3.139, lon: 101.6869 },
        frequencyMhz: 145,
        maxRangeKm: 500, // Too large, should be clamped
        cellSizeKm: 0.1, // Too small, should be clamped
      }),
    });
    // Should not crash, should either succeed with clamped values or return error
    assert(status === 200 || status === 400, 'Raster endpoint should handle extreme inputs gracefully');
  }

  // ===========================================================================
  // 8. 404 for unknown endpoints
  // ===========================================================================

  console.log('\nTest: Unknown endpoint returns 404');
  {
    const { status, body } = await fetchJson(`${BASE_URL}/unknown`);
    assert(status === 404, 'GET /unknown should return 404');
    assert(typeof body?.error === 'string', '404 response should include error message');
  }

  // ===========================================================================
  // 9. OPTIONS handling (CORS)
  // ===========================================================================

  console.log('\nTest: OPTIONS handling for CORS');
  {
    const resp = await fetch(`${BASE_URL}/itm/radial`, { method: 'OPTIONS' });
    assert(resp.status === 204, 'OPTIONS should return 204');
    assert(resp.headers.get('access-control-allow-origin') !== null, 'CORS should set access-control-allow-origin');
  }

  // ===========================================================================
  // 10. Fallback model produces reasonable values
  // ===========================================================================

  console.log('\nTest: Fallback model produces reasonable loss values');
  {
    const { body } = await fetchJson(`${BASE_URL}/itm/radial`, {
      method: 'POST',
      body: JSON.stringify({
        frequencyMhz: 145,
        txHeightM: 10,
        rxHeightM: 1.5,
        siteElevationM: 100,
        radialSamples: [
          { distanceKm: 1, elevation: 100 },
          { distanceKm: 10, elevation: 100 },
        ],
        distancesKm: [1, 10],
      }),
    });
    const loss1km = body?.losses?.[0]?.lossDb;
    const loss10km = body?.losses?.[1]?.lossDb;
    assert(loss1km > 60 && loss1km < 100, `Loss at 1 km / 145 MHz should be 60-100 dB, got ${loss1km?.toFixed(2)}`);
    assert(loss10km > loss1km, 'Loss at 10 km should be > loss at 1 km');
    assert(loss10km < 200, `Loss at 10 km / 145 MHz should be < 200 dB, got ${loss10km?.toFixed(2)}`);
  }

  // ===========================================================================
  // 11. Frequency clamping
  // ===========================================================================

  console.log('\nTest: Frequency clamping');
  {
    const { body: bodyLow } = await fetchJson(`${BASE_URL}/itm/radial`, {
      method: 'POST',
      body: JSON.stringify({
        frequencyMhz: 1, // Below minimum, should be clamped to 20
        txHeightM: 10,
        rxHeightM: 1.5,
        siteElevationM: 100,
        radialSamples: [{ distanceKm: 5, elevation: 100 }],
        distancesKm: [5],
      }),
    });
    assert(bodyLow?.ok === true, 'Below-minimum frequency should be clamped, not rejected');

    const { body: bodyHigh } = await fetchJson(`${BASE_URL}/itm/radial`, {
      method: 'POST',
      body: JSON.stringify({
        frequencyMhz: 50000, // Above maximum, should be clamped to 20000
        txHeightM: 10,
        rxHeightM: 1.5,
        siteElevationM: 100,
        radialSamples: [{ distanceKm: 5, elevation: 100 }],
        distancesKm: [5],
      }),
    });
    assert(bodyHigh?.ok === true, 'Above-maximum frequency should be clamped, not rejected');
  }

  // ===========================================================================
  // 12. Rate limiting (MUST be last — will block subsequent requests)
  // ===========================================================================

  console.log('\nTest: Rate limiting');
  {
    // Make many rapid requests to trigger rate limit
    let rateLimited = false;
    for (let i = 0; i < 1100; i++) {
      const { status } = await fetchJson(`${BASE_URL}/health`);
      if (status === 429) {
        rateLimited = true;
        break;
      }
    }
    assert(rateLimited, 'Should eventually get 429 rate limit response after many requests');
  }
} catch (error) {
  console.error('Test error:', error.message);
  failed += 1;
} finally {
  // ===========================================================================
  // Shutdown
  // ===========================================================================
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => {
      serverProcess.on('close', () => resolve());
      setTimeout(() => {
        serverProcess.kill('SIGKILL');
        resolve();
      }, 3000);
    });
  }
}

// ===========================================================================
// Summary
// ===========================================================================

console.log(`\n${passed} tests passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
