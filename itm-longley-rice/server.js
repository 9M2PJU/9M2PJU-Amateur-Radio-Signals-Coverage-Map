import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 8787);
const ITM_RUNNER = process.env.ITM_RUNNER ?? '/usr/local/bin/itm-runner';
const MAX_BODY_BYTES = 1_000_000;
const MAX_DISTANCES = 260;
const MAX_SAMPLES = 512;
const ITM_MAX_FREQ_MHZ = 20000;

const nativeItmAvailable = () => existsSync(ITM_RUNNER);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

const interpolateElevation = (samples, distanceKm, siteElevationM) => {
  if (!samples.length || distanceKm <= 0) return siteElevationM;
  if (distanceKm <= samples[0].distanceKm) {
    const ratio = clamp(distanceKm / Math.max(0.001, samples[0].distanceKm), 0, 1);
    return siteElevationM + (samples[0].elevation - siteElevationM) * ratio;
  }

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const next = samples[index];
    if (distanceKm > next.distanceKm) continue;
    const ratio = (distanceKm - previous.distanceKm) / Math.max(1e-9, next.distanceKm - previous.distanceKm);
    return previous.elevation + (next.elevation - previous.elevation) * clamp(ratio, 0, 1);
  }

  return samples[samples.length - 1].elevation;
};

const calculateFreeSpaceLoss = (frequencyMhz, distanceKm) => (
  32.44 + 20 * Math.log10(Math.max(0.001, distanceKm)) + 20 * Math.log10(clamp(frequencyMhz, 20, 30000))
);

const calculateFallbackItmStyleLoss = ({ frequencyMhz, txHeightM, rxHeightM, siteElevationM, radialSamples, distanceKm }) => {
  const samplesInPath = radialSamples.filter((sample) => sample.distanceKm <= distanceKm);
  const elevations = samplesInPath.length ? samplesInPath.map((sample) => sample.elevation) : [siteElevationM];
  const avgElevation = elevations.reduce((total, elevation) => total + elevation, 0) / elevations.length;
  const minElevation = Math.min(...elevations);
  const maxElevation = Math.max(...elevations);
  const roughness = maxElevation - minElevation;
  const sitePenalty = Math.max(0, avgElevation - siteElevationM) * 0.05;
  const roughnessLoss = clamp(roughness * 0.035 + sitePenalty, 0, 28);
  const horizonKm = 4.12 * (Math.sqrt(Math.max(1, txHeightM)) + Math.sqrt(Math.max(1, rxHeightM)));
  const horizonLoss = distanceKm > horizonKm ? clamp((distanceKm - horizonKm) * 0.42, 0, 32) : 0;
  const rxElevation = interpolateElevation(radialSamples, distanceKm, siteElevationM);
  const terminalDelta = Math.max(0, rxElevation - siteElevationM) * 0.03;
  return calculateFreeSpaceLoss(frequencyMhz, distanceKm) + roughnessLoss + horizonLoss + terminalDelta;
};

const normalizeRequest = (payload) => {
  const radialSamples = Array.isArray(payload.radialSamples)
    ? payload.radialSamples.slice(0, MAX_SAMPLES).map((sample) => ({
      distanceKm: toNumber(sample.distanceKm),
      elevation: toNumber(sample.elevation),
    })).filter((sample) => sample.distanceKm > 0 && Number.isFinite(sample.elevation))
    : [];

  const distancesKm = Array.isArray(payload.distancesKm)
    ? payload.distancesKm.slice(0, MAX_DISTANCES).map((distanceKm) => toNumber(distanceKm)).filter((distanceKm) => distanceKm > 0)
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

const runNativeItm = (input) => {
  const profile = [
    `0:${input.siteElevationM}`,
    ...input.radialSamples.map((sample) => `${sample.distanceKm}:${sample.elevation}`),
  ].join(',');
  const distances = input.distancesKm.join(',');

  const result = spawnSync(ITM_RUNNER, [
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
  ], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `ITM runner exited with status ${result.status}`);
  }

  return JSON.parse(result.stdout);
};

const calculateRadial = (input) => {
  if (nativeItmAvailable() && input.frequencyMhz <= ITM_MAX_FREQ_MHZ) {
    try {
      const nativeResult = runNativeItm(input);
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, {
      ok: true,
      service: '9m2pju-itm-api',
      engine: nativeItmAvailable() ? 'ntia-itm-native' : 'server-fallback-itm-style',
      nativeItm: nativeItmAvailable(),
      itmFrequencyLimitMhz: ITM_MAX_FREQ_MHZ,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/itm/radial') {
    try {
      const payload = JSON.parse(await readBody(req));
      const input = normalizeRequest(payload);
      if (!input.distancesKm.length) {
        sendJson(res, 400, { error: 'distancesKm must contain at least one positive distance.' });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        ...calculateRadial(input),
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
