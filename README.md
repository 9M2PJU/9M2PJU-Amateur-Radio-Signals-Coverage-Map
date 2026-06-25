<p align="center">
  <img src="public/brand_logo_v6.png" width="160" alt="9M2PJU Coverage Prediction Logo">
</p>

<h1 align="center">9M2PJU Coverage Prediction</h1>

<p align="center">
  <strong>Terrain-aware amateur radio coverage prediction, validation, and comparison dashboard</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-v4.8.0-0072ff?style=for-the-badge" alt="Version v4.8.0">
  <img src="https://img.shields.io/badge/Default_Model-ITS_ITM_%2F_Longley--Rice-7c3aed?style=for-the-badge" alt="Default model ITS ITM / Longley-Rice">
  <img src="https://img.shields.io/badge/License-AGPL--3.0--or--later-4dbd74?style=for-the-badge" alt="AGPL-3.0-or-later">
</p>

## Current Status

**9M2PJU Coverage Prediction v4.8.0** is a usable planning and validation tool for amateur radio operators. It is suitable for repeater/site planning, coverage comparison, field-test preparation, and operator-level “will this likely work?” studies.

It should not be described as certified RF engineering software. Prediction quality still depends on terrain data, ITM service availability, antenna details, clutter, local noise, receiver performance, and real field measurements.

The default model uses the 9M2PJU **ITS Irregular Terrain Model (ITM) / Longley-Rice** helper service. If the service or native engine is unavailable, the app reports that status and can continue with local terrain-aware fallback logic.

## What It Does

- Predicts strong, moderate, and fringe amateur-radio coverage zones.
- Supports up to four transmitter sites.
- Estimates overlap-aware combined coverage area.
- Covers VHF, UHF, and SHF planning from 30 MHz to 30 GHz.
- Samples terrain for elevation, HAAT, effective antenna height, curvature/refraction, Fresnel clearance, and diffraction-style terrain penalties.
- Uses ITM radial sampling and per-cell raster ITM when the helper service supports it.
- Falls back to local terrain-aware models when ITM is unavailable.
- Supports FM voice, APRS/packet, SSB/weak-signal, and LoRa profiles.
- Includes TX/RX antenna gain, TX/RX line loss, receiver threshold, fade margin, max range, ITM reliability, ITM confidence, antenna pattern, clutter, two-ray, rain, and atmospheric controls.
- Imports field measurements from CSV or GPX.
- Applies a bounded local calibration offset from measured signal data.
- Exports GeoJSON, PDF, validation JSON, Radio Mobile comparison CSV, scenario JSON, share links, and experiment packages.

## Latest Experiment

This version adds an experiment layer for deeper validation and Radio Mobile-style comparison:

- Prediction trust status for each active site.
- Receiver-threshold or noise-floor threshold mode.
- Adjustable raster cell size.
- Local DEM CSV/JSON import into the elevation cache.
- Radio Mobile reference CSV import and bearing-by-bearing parity scoring.
- Map query mode for checking predicted signal at a receiver point.
- Terrain profile sparkline for queried points.
- Quick presets for handheld, mobile, base, repeater, LoRa, and microwave stations.
- Sample flat, coastal, and hilly validation scenarios.
- Scenario import/export and shareable links.
- Experiment package export with settings, validation, parity, notes, and result metadata.
- PDF map snapshots with coverage overlay, legend, north arrow, and scale reference.

These tools make the app easier to validate. They do not magically make every prediction correct; they make wrong assumptions more visible and easier to measure.

## Radio Mobile Comparison

Radio Mobile by VE2DBE remains the stronger reference tool for mature amateur-radio propagation studies. This app is not yet Radio Mobile-equivalent, but it now has the pieces needed for practical parity work:

- Set the same site coordinates, antenna heights, frequency, TX power, RX gain, line losses, reliability, threshold, and max range.
- Use **Radio Mobile validation 2 deg** radial mode for smoother bearing comparison.
- Use raster render mode when comparing visual coverage surfaces.
- Export the app’s **Radio Mobile CSV** after running coverage.
- Import a Radio Mobile bearing/distance CSV back into the app to compare strong, moderate, and fringe reach distances.
- Track distance error in km and use field measurements to decide which model is closer in your area.

Good parity work means using the same DEM/terrain data, same RF assumptions, and repeated comparisons over flat, coastal, hilly, urban, and forested paths.

## Reliability

For amateur-radio planning, this app is now reliable and usable when the operator understands its limits:

- Best used for outdoor VHF/UHF planning, repeater/site comparison, and coverage expectations.
- More trustworthy when ITM is reachable and terrain data is available.
- More trustworthy when field measurements are imported and local calibration is applied.
- Less trustworthy for indoor coverage, dense city streets, heavy foliage, receiver desense, local interference, SHF availability, and building-level blockage.

Treat the map as a planning estimate. For important coverage promises, validate with real signal reports or measured RSSI points.

## Exports

- **GeoJSON**: coverage polygons, site points, RF settings, thresholds, render mode, raster metadata, and prediction status.
- **PDF**: human-readable result report with map snapshot, coverage totals, RF settings, prediction settings, site details, and thresholds.
- **Validation JSON**: imported field measurements compared against predicted signal levels.
- **Radio Mobile CSV**: bearing-by-bearing strong, moderate, and fringe reach distances.
- **Scenario JSON**: repeatable site and settings bundle.
- **Experiment package JSON**: scenario, validation report, parity report, query point, notes, and experiment metadata.

## Field Validation

CSV measurement imports should include latitude, longitude, and signal level:

```text
lat,lon,rssi
3.1390,101.6869,-82
```

GPX imports read `trkpt` or `wpt` coordinates and look for signal values in fields named `rssi`, `signal`, `signal_dbm`, `dbm`, or `rx_dbm`.

With at least three matched measurements, the app can apply a bounded calibration offset to reduce local bias.

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
