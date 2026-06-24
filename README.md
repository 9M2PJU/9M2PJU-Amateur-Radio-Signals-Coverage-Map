<p align="center">
  <img src="public/brand_logo_v6.png" width="160" alt="9M2PJU Coverage Prediction Logo">
</p>

<h1 align="center">9M2PJU Coverage Prediction</h1>

<p align="center">
  <strong>Multi-site, terrain-aware RF coverage prediction for amateur radio</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-v4.7.1-0072ff?style=for-the-badge" alt="Version v4.7.1">
  <img src="https://img.shields.io/badge/Default_Model-ITS_ITM_%2F_Longley--Rice-7c3aed?style=for-the-badge" alt="Default model ITS ITM / Longley-Rice">
  <img src="https://img.shields.io/badge/Live-coverage.hamradio.my-0072ff?style=for-the-badge&logo=react" alt="Live">
  <img src="https://img.shields.io/badge/PWA-Offline_App_Shell-4dbd74?style=for-the-badge" alt="PWA offline app shell">
</p>

## Current Status

**9M2PJU Coverage Prediction** is a browser-based RF planning dashboard for amateur radio coverage studies. The current app is version **4.7.1** and is live at [coverage.hamradio.my](https://coverage.hamradio.my).

The app supports planning-grade predictions for up to four transmitter sites, using terrain sampling, link-budget controls, receiver assumptions, and map-based coverage overlays. It is intended for field planning and comparison, not certified RF engineering sign-off.

The default propagation model is the 9M2PJU **ITS Irregular Terrain Model (ITM) / Longley-Rice** service at `https://itm.hamradio.my`. If that service is unavailable, or when the selected frequency is above the ITM service limit, the app falls back to local terrain-aware planning models.

## What Works Now

- Multi-site coverage prediction for up to four transmitter locations.
- Strong, moderate, and fringe coverage polygons for each active site.
- Overlap-aware combined area estimates, so shared coverage is not simply double-counted.
- Terrain sampling across 72 radials with near-site samples at 0.25 km and 0.5 km, then 1 km spacing out to 120 km.
- Site elevation, HAAT, effective antenna height, curvature/refraction, Fresnel clearance, and diffraction-style terrain penalties.
- VHF, UHF, and SHF frequency ranges from 30 MHz to 30 GHz.
- Mode presets for FM voice, APRS/packet, SSB/weak signal, and LoRa SF7/SF9/SF12.
- Link-budget controls for TX power, TX antenna gain, RX height, RX antenna gain, feedline loss, noise figure, required SNR, bandwidth, and fade margin.
- Directional antenna controls plus optional CSV antenna pattern import.
- Clutter profiles for open/rural, suburban, forest/foliage, and dense urban planning.
- Optional GeoJSON clutter-loss polygons using properties such as `lossDb`, `loss_db`, `clutterLoss`, or `rf_loss_db`.
- SHF rain-rate and atmospheric-loss controls for microwave planning.
- CSV and GPX field-measurement import for validation.
- Validation report export with prediction metadata, model assumptions, per-point errors, RMSE, median absolute error, and within-6/within-10 dB statistics.
- Local calibration offset from field measurements when enough matched samples are available.
- Leaflet map layers for OpenStreetMap, OpenStreetMap Humanitarian, OpenTopoMap Terrain, Esri World Imagery, and Carto Dark.
- PWA manifest and service worker with an offline app shell cache.

## Prediction Model

The app builds coverage by sampling terrain around each transmitter site, estimating usable link budget, then searching outward along each radial until the signal no longer meets each service-grade threshold.

Available model choices:

- **ITS Irregular Terrain Model (ITM)**: default path using the 9M2PJU Longley-Rice service for radial path-loss samples.
- **ITM-style hybrid**: local approximation using free-space loss, terrain roughness, horizon effects, and terrain penalties.
- **Enhanced Hata + terrain**: fast browser-side planning model with Hata/COST-style handling where appropriate.

Important safeguards and assumptions:

- Path loss is never allowed to drop below free-space path loss.
- VHF/lower-UHF planning uses Hata-style behavior where it is most appropriate.
- High UHF uses a COST-231-style extension and is treated more cautiously.
- SHF planning uses free-space loss plus practical excess loss, terrain effects, and optional rain/atmospheric loss.
- Coverage edges use the first continuous radial failure point instead of a farthest isolated pass.
- Imported antenna patterns, clutter maps, SHF losses, feedline loss, receiver gain, fade margin, and calibration offset are included in the same link-budget path used for polygons and validation reports.

## Field Validation

CSV measurement imports should include latitude, longitude, and a signal column:

```text
lat,lon,rssi
3.1390,101.6869,-82
```

GPX imports read `trkpt` or `wpt` coordinates and look for signal values in extension fields named `rssi`, `signal`, `signal_dbm`, `dbm`, or `rx_dbm`.

Validation compares measured signal levels against the predicted coverage zones and estimated dBm values. With at least three matched measurements, the app can apply a bounded local calibration offset to reduce local prediction bias.

## Current Limits

- This is a planning tool, not a certified engineering survey.
- Terrain data availability and quality affect the result.
- Building-level blockage, foliage detail, indoor penetration, street-level multipath, receiver desense, local interference, and polarization mismatch are not fully modeled.
- Imported clutter polygons and antenna patterns are only as accurate as the supplied data.
- SHF rain and atmospheric controls are practical planning approximations, not full ITU-R availability modeling.
- Overlap-aware area totals are grid estimates, not exact computational geometry.
- Real deployments should still be checked with field measurements.

## Project Shape

- Main app: `src/App.jsx`
- Styling: `src/index.css`
- PWA assets: `public/manifest.webmanifest`, `public/service-worker.js`
- ITM / Longley-Rice helper service: `itm-longley-rice/`
- RF guardrail tests: `scripts/rf-smoke-test.mjs`

## Maintainer Checks

```bash
npm run test:rf
npm run lint
npm run build
```

These checks cover RF guardrails, linting, and production bundle generation.

## License

This project is licensed under the **GNU Affero General Public License v3.0 or later**. See `LICENSE` for the full license text.

---

<p align="center">
  <img src="public/brand_logo_v6.png" width="40" alt="Logo">
  <br>
  Built for the Amateur Radio Community by <b>9M2PJU</b>
  <br>
  <a href="https://github.com/9M2PJU">GitHub Profile</a>
</p>
