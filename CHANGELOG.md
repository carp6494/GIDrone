# Changelog

## v0.4.0 — 2026-03-19

### Features

- **Flyability heatmap overlay** — new map layer on RadarTab showing drone flyability scores across the US, powered by NWS weather data and the FlyabilityEngine scoring system
  - Grid-fill and heatmap render modes with opacity control
  - State picker with zoom-to-state and boundary clipping (US Census TIGERweb)
  - Color-coded cells (red → green) with interactive popups showing wind, temp, visibility, precipitation, humidity, cloud cover, and caution/danger reasons
  - Auto-refreshes every 15 minutes
  - New `heatmap-weather` Supabase Edge Function fetching NWS gridpoint data with per-cell and per-state caching
- **NMS-API migration for NOTAM sync** — rewrote `notam-sync` Edge Function from deprecated FAA External API v2 to the new NMS-API (GeoJSON-based)
  - OAuth2 client-credentials auth with token caching
  - Delta sync (30-min window) and full bootstrap modes
  - ICAO coordinate parsing, GeometryCollection support, polygon centroid extraction
  - Drone-relevant feature codes: OBST, AIRSPACE, SECURITY, SPECIAL, RWY

### Added

- `src/hooks/useHeatmapWeather.ts` — React hook for heatmap weather data
- `src/lib/aviation/heatmapClient.ts` — Edge Function client for heatmap-weather
- `src/lib/aviation/heatmapFlyability.ts` — GeoJSON computation from weather grid + flyability thresholds
- `src/lib/aviation/stateBoundary.ts` — Census TIGERweb boundary fetcher + point-in-polygon test
- `src/lib/aviation/stateBounds.ts` — US state bounding boxes for grid generation and zoom
- `src/lib/aviation/types.ts` — `HeatmapGridCell` and `HeatmapWeatherResponse` types
- `supabase/functions/heatmap-weather/index.ts` — NWS weather grid Edge Function
- `supabase/config.toml` — registered obstruction, obstruction-sync, and heatmap-weather functions
- `docs/` — NMS-API reference documentation (PDF, YAML, curl examples, sample payloads)

### Changed

- `src/components/RadarTab.tsx` — integrated heatmap layers, split-button UI, state picker dropdown, popup interactions, visibility toggles, opacity sync, localStorage persistence

---

## v0.3.0 — 2026-03-15

- FAA obstruction integration, map clustering, sync pipeline

## v0.2.9 — 2026-03-11

- Site photos, RLS security, TFR/radar improvements

## v0.2.7

- Obstruction filter/sort improvements, lit-only sync
