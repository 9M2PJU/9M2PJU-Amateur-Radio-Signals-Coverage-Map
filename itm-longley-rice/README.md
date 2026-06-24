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

Calculates ITM path loss for one terrain radial at multiple distances.

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
  "distancesKm": [0.5, 1, 2, 5, 10, 20],
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

## Notes

- The Docker build downloads and compiles [NTIA/itm](https://github.com/NTIA/itm).
- NTIA ITM is normally used from about 20 MHz to 20 GHz.
- This service accepts one radial at a time. The web app can call it for each bearing when we integrate your server URL.
- If native ITM fails inside the container, the API returns a conservative fallback model and marks `"nativeItm": false`.
- For public hosting, put this behind HTTPS using nginx, Caddy, Cloudflare Tunnel, or your preferred reverse proxy.
