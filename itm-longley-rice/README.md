# 9M2PJU ITM / Longley-Rice API

Self-hosted Docker service for NTIA ITM / Longley-Rice propagation calculations.

This folder is intentionally separate from the GitHub Pages app. Clone the repository on your server, enter this folder, run Docker Compose, then send the public API URL back so the main app can be configured to call it.

## Run

```bash
cd itm-longley-rice
docker compose up -d --build
```

The service listens on:

```text
http://SERVER_IP:8787
```

Health check:

```bash
curl http://SERVER_IP:8787/health
```

Expected response:

```json
{
  "ok": true,
  "service": "9m2pju-itm-api",
  "engine": "ntia-itm-native",
  "nativeItm": true,
  "itmFrequencyLimitMhz": 20000
}
```

## API

### `POST /itm/radial`

Calculates ITM path loss for one terrain radial at multiple distances. Native ITM point-to-point samples are accepted at 1 km and farther; use a short-path local model below 1 km.

Request:

```json
{
  "frequencyMhz": 146,
  "txHeightM": 10,
  "rxHeightM": 1.5,
  "siteElevationM": 440,
  "radialSamples": [
    { "distanceKm": 0.25, "elevation": 438 },
    { "distanceKm": 0.5, "elevation": 436 },
    { "distanceKm": 1, "elevation": 430 }
  ],
  "distancesKm": [1, 2, 5, 10, 20],
  "confidence": 50,
  "reliability": 50,
  "climate": 1,
  "polarization": 1,
  "groundPermittivity": 15,
  "groundConductivity": 0.005,
  "surfaceRefractivity": 301
}
```

Response:

```json
{
  "ok": true,
  "engine": "ntia-itm-native",
  "nativeItm": true,
  "losses": [
    { "distanceKm": 0.5, "lossDb": 72.1, "warnings": 0, "errorCode": 0 }
  ]
}
```

### `POST /coverage/raster`

Calculates true per-cell raster coverage. The service builds a square receiver grid, samples the elevation API along each TX-to-cell path, runs ITM for that path, converts path loss to received signal, and returns only covered cells.

Request:

```json
{
  "site": { "lat": 2.025, "lon": 103.33, "elevationM": 440 },
  "frequencyMhz": 145,
  "txHeightM": 10,
  "rxHeightM": 10,
  "txPowerDbm": 36.99,
  "txGainDbi": 6,
  "rxGainDbi": 2,
  "systemLossDb": 3.5,
  "clutterLossDb": 0,
  "maxRangeKm": 100,
  "cellSizeKm": 3,
  "profileStepKm": 2,
  "thresholdsDbm": { "strong": -103, "moderate": -108, "weak": -113 },
  "confidence": 50,
  "reliability": 70,
  "antenna": { "azimuth": 0, "beamwidth": 360, "frontBackRatio": 0 }
}
```

Response:

```json
{
  "ok": true,
  "engine": "ntia-itm-native-per-cell-raster",
  "nativeItm": true,
  "siteElevationM": 440,
  "cellSizeKm": 3,
  "areas": { "strong": 180, "moderate": 450, "weak": 720 },
  "cells": [
    {
      "id": "12:-4",
      "gradeKey": "strong",
      "center": [2.1, 103.2],
      "bounds": [[2.08, 103.18], [2.08, 103.21], [2.11, 103.21], [2.11, 103.18]],
      "distanceKm": 14.2,
      "bearingDeg": 312.4,
      "lossDb": 124.5,
      "rxDbm": -86.0
    }
  ],
  "stats": {
    "testedCells": 3450,
    "coveredCells": 720,
    "fallbackCells": 0
  }
}
```

## Notes

- The Docker build downloads and compiles [NTIA/itm](https://github.com/NTIA/itm).
- NTIA ITM is normally used from about 20 MHz to 20 GHz.
- `/itm/radial` accepts one radial at a time. `/coverage/raster` calculates DEM/elevation-backed per-cell raster coverage.
- `OPEN_ELEVATION_API_URL` defaults to `https://elevation.hamradio.my/api/v1/lookup`.
- `RASTER_MAX_CELLS`, `RASTER_MAX_PROFILE_SAMPLES`, `RASTER_PROFILE_STEP_KM`, and `RASTER_WORKERS` control raster workload size.
- If native ITM fails inside the container, the API returns a conservative fallback model and marks `"nativeItm": false`.
- For public hosting, put this behind HTTPS using nginx, Caddy, Cloudflare Tunnel, or your preferred reverse proxy.
