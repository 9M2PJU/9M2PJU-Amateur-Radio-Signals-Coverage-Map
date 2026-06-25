<p align="center">
  <img src="public/brand_logo_v6.png" width="160" alt="9M2PJU Coverage Prediction Logo">
</p>

<h1 align="center">9M2PJU Coverage Prediction</h1>

<p align="center">
  <strong>Terrain-aware amateur radio coverage prediction and validation dashboard</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-v4.7.1-0072ff?style=for-the-badge" alt="Version v4.7.1">
  <img src="https://img.shields.io/badge/Default_Model-ITS_ITM_%2F_Longley--Rice-7c3aed?style=for-the-badge" alt="Default model ITS ITM / Longley-Rice">
  <img src="https://img.shields.io/badge/License-AGPL--3.0--or--later-4dbd74?style=for-the-badge" alt="AGPL-3.0-or-later">
</p>

## Current Status

**9M2PJU Coverage Prediction** is a browser-based RF planning app for amateur radio coverage studies. It is reliable and usable for amateur-radio planning, site comparison, and field-test preparation, while staying honest that it is not an RF engineering-grade or certified prediction tool.

The app supports multi-site terrain-aware predictions, Radio Mobile-style comparison settings, field-measurement validation, and result exports. Terrain quality, local clutter, receiver conditions, interference, and real-world installation details can still move the result, so important coverage decisions should be checked with field measurements.

The default engineering model is the 9M2PJU **ITS Irregular Terrain Model (ITM) / Longley-Rice** service. If the ITM service cannot be reached, the app can continue with local terrain-aware fallback models.

## Core Features

- Multi-site coverage prediction for up to four transmitter sites.
- Strong, moderate, and fringe coverage zones.
- Overlap-aware combined area estimates.
- VHF, UHF, and SHF frequency ranges from 30 MHz to 30 GHz.
- Terrain sampling with elevation, HAAT, effective antenna height, curvature/refraction, Fresnel clearance, and diffraction-style penalties.
- DEM/elevation-backed per-cell raster ITM when the helper service supports the raster endpoint.
- Mode presets for FM voice, APRS/packet, SSB/weak signal, and LoRa SF7/SF9/SF12.
- Link-budget controls for TX power, antenna heights, TX/RX gain, TX/RX line loss, RX threshold, fade margin, max range, ITM reliability/confidence, radial density, and render mode.
- Optional land-cover/clutter loss profiles and imported clutter GeoJSON.
- Optional two-ray loss adjustment.
- Directional antenna controls and optional antenna-pattern CSV import.
- SHF rain-rate and atmospheric-loss controls when using SHF bands.
- Field-measurement import from CSV or GPX.
- Local calibration offset from measured field data.
- Export to GeoJSON, PDF, validation JSON, and Radio Mobile comparison CSV.

## Radio Mobile Comparison

The app includes settings intended to make comparison with Radio Mobile by VE2DBE easier:

- Max range
- Required ITM reliability
- ITM confidence
- RX threshold in microvolts and dBm
- RX antenna gain
- TX and RX line loss
- Strong-signal margin
- Land-cover toggle
- Two-ray toggle
- Standard 5 degree radial mode
- Radio Mobile validation 2 degree radial mode
- Raster-cell render mode for a Radio Mobile-style visual surface

The **Radio Mobile validation 2 deg** mode increases the radial count from 72 to 180 for smoother bearing-by-bearing comparison. The **Raster cells** render mode uses per-cell DEM/elevation ITM when the helper service supports it, then falls back to radial-derived raster cells if the raster endpoint is unavailable. After running coverage, the **Download Radio Mobile CSV** export provides strong, moderate, and fringe reach distances for each bearing.

Radio Mobile remains the stronger reference tool today. This app is improving toward comparable behavior, but prediction trust should come from repeated comparison against Radio Mobile and real field measurements.

## Exports

The app provides four export paths:

- **Export GeoJSON**: coverage polygons and site points with RF settings, render mode, raster-cell counts, and prediction metadata.
- **Export PDF**: readable summary report with coverage totals, RF settings, prediction settings, render mode, site details, and thresholds.
- **Download validation report**: JSON report comparing imported field measurements against predicted signal levels.
- **Download Radio Mobile CSV**: bearing-by-bearing reach table for Radio Mobile-style validation.

GeoJSON is best for GIS tools and map reuse. PDF is best for sharing a human-readable result summary.

## Field Validation

CSV measurement imports should include latitude, longitude, and a signal column:

```text
lat,lon,rssi
3.1390,101.6869,-82
```

GPX imports read `trkpt` or `wpt` coordinates and look for signal values in extension fields named `rssi`, `signal`, `signal_dbm`, `dbm`, or `rx_dbm`.

Validation compares measured signal levels against predicted coverage zones and estimated dBm values. With at least three matched measurements, the app can apply a bounded local calibration offset to reduce local prediction bias.

## Prediction Model

Coverage is built by sampling terrain around each transmitter site, estimating usable link budget, then searching outward along each radial until the signal no longer meets each service-grade threshold.

Available model choices:

- **ITS Irregular Terrain Model (ITM)**: default path using the 9M2PJU Longley-Rice service for radial path-loss samples and per-cell raster coverage when available.
- **ITM-style hybrid**: local approximation using free-space loss, terrain roughness, horizon effects, and terrain penalties.
- **Enhanced Hata + terrain**: fast browser-side planning model with Hata/COST-style handling where appropriate.

Important safeguards and assumptions:

- Path loss is never allowed to drop below free-space path loss.
- Native ITM samples start at 1 km; shorter validation points fall back to the browser-side short-path model.
- Coverage edges use the first continuous radial failure point instead of a farthest isolated pass.
- VHF and lower-UHF predictions use Hata-style behavior where appropriate.
- High UHF is treated more cautiously with COST-231-style extension behavior.
- SHF predictions use free-space loss plus practical excess loss, terrain effects, and optional rain/atmospheric loss.
- Imported antenna patterns, clutter maps, losses, receiver gain, fade margin, and calibration offset are included in the same link-budget path used for polygons and validation.

## Current Limits

- This is a reliable planning and validation aid for amateur radio, not a certified RF engineering survey.
- Terrain data availability and quality strongly affect the result.
- Building-level blockage, foliage detail, indoor penetration, street-level multipath, receiver desense, local interference, and polarization mismatch are not fully modeled.
- Imported clutter polygons and antenna patterns are only as accurate as the supplied data.
- SHF rain and atmospheric controls are practical planning approximations, not full ITU-R availability modeling.
- Area totals are estimates and should be treated as planning numbers.
- Real field use should still be checked with measurements.

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
