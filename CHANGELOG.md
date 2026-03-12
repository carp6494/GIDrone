# GIDrone Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog
and this project adheres to Semantic Versioning.

---

## [0.3.0] - 2026-03-12

### Added
- **FAA Obstruction Integration** — full pipeline from FAA Digital Obstacle File (DOF) to map.
  - Supabase migration for `obstructions` table with spatial indexes and RLS.
  - Edge function for spatial queries (bounding-box + haversine, sortBy, minHeight, types filters).
  - Edge function for DOF sync (backup; replaced by local script due to free-tier WORKER_LIMIT).
  - `scripts/sync-obstructions.mjs` — downloads FAA Daily DOF CSV ZIP, parses and upserts to Supabase in batches. Filters out SIGN, TREE, BLDG, POLE types and dismantled structures.
  - GitHub Actions workflow for daily sync at 07:00 UTC.
- **RadarTab**: Mapbox native clustering for obstruction points (purple circles), click-to-zoom clusters, click popups on individual points.
- **RadarTab**: split-button Obstructions toggle with filter icon dropdown — checkbox type filters, min height input. Dropdown positioned above/right to avoid clipping.
- **AviationPanel**: obstruction tile with cards and MAP button to fly to location on RadarTab.
- **ConditionsTab**: obstruction summary widget (count, tallest, lit/unlit breakdown).
- Frontend client (`obstructionClient.ts`), hook (`useObstructions.ts`), and types (`ObstructionItem`, `ObstructionResponse`, `ObstructionFeatureProperties`).

### Changed
- Obstruction sync excludes non-drone-relevant types (SIGN, TREE, BLDG, POLE) and dismantled structures (action_code=D) to reduce data volume.
- Removed dead code: unused `_createObstructionMarkerElement`, `obstructionMarkersRef`, and commented-out `syncObstructionMarkers` block.
- Removed Sort By from obstruction filter dropdown (hardcoded to distance).

### Fixed
- Focus marker popup no longer blocks clicking other map markers — auto-dismisses after 4s, cleared on any map click.

## [0.2.9] - 2026-03-11

### Added
- Site photos feature with upload/display support.
- GitHub Actions workflow for daily FAA obstruction sync (CI scaffolding).

### Changed
- RLS security improvements across Supabase tables.
- TFR and radar display improvements.

## [0.2.8] - 2026-03-08

### Added
- Radar morph system with multi-layer opacity transitions.
- OpenWeatherMap tile integration for RadarTab.
- Live NOTAM/TFR pan — queries update as map moves.
- NOTAM sync backend edge function (blocked on NMS-API access).

### Changed
- RainViewer integration refactored from dual-slot interpolation to multi-layer morph.
- RadarTab simplified from animation pipeline to single OWM tile layer.

## [0.2.7] - 2026-03-04

### Added
- New NOTAM ingest edge function (`supabase/functions/notam-ingest`) and supporting SQL maintenance scripts/migrations for feed storage, retention, and geometry/owner enrichment fields.
- New SWIFT NOTAM consumer tool (`tools/notam-swift-consumer`) and standalone FCC owner enrichment tool (`tools/notam-owner-enricher`) with docs and package manifests.
- Global location controller (`useGlobalLocation`) and reusable top-bar location UI (`GlobalLocationBar`) for shared search/GPS behavior across tabs.
- Light-mode splash asset support (`src/assets/GIDrone Splash Light Mode.png`) and dedicated location typing (`src/lib/location/types.ts`).

### Changed
- NOTAM pipeline integration updated end-to-end: ingest payload mapping, edge read response shape, aviation types, NOTAM hooks, and radar/aviation presentation.
- Conditions, Aviation, and Radar now consume one global location source; GPS/search updates propagate across tabs and clear Radar focus for recentering.
- Radar tab UI refinements: style controls repositioning, header/layout updates, overlay panel behavior, and map recenter logic when default center changes without explicit map focus.
- Login and authenticated shell backgrounds now switch by theme (dark vs light splash) with fixed background layers for both modes.

### Fixed
- GPS/search UX regressions by moving location ownership out of `ConditionsTab` and preserving backward-safe coordinate-driven fetch behavior.
- Radar timeline slider custom thumb rendering behavior; custom range styles now consistently apply across browsers.
- NOTAM mapping/display gaps for structure, lighting, geometry, and owner-related metadata in Aviation/Radar flows.

### Ops/Deploy
- Supabase config and function provider wiring updated to use `notam-ingest` + updated `notam` function pathing.
- Legacy `supabase/functions/notam/providers/*` provider files removed as ingest/feed-backed NOTAM path became the active implementation.
- Release versions bumped: root app `0.2.7`, `tools/notam-swift-consumer` `0.1.1`, `tools/notam-owner-enricher` `0.1.1`.

## [0.2.6] - 2026-03-04

### Added
- Supabase migration for `public.sites` with indexes and row-level security policies.
- ZIP-aware search handling support in the frontend and edge function flow.

### Changed
- Reworked the top navigation/search layout so Conditions search lives in the shared top bar container and the selected top tab persists on refresh.
- Removed the in-app `Tab Bar` settings UI and consolidated tab presentation into code-defined styling.
- Refined the Conditions page weather tiles, forecast header, descriptors, spacing, and icon layout for improved readability across light and dark themes.
- Improved radar behavior in both the Conditions radar snapshot and the main Radar tab, including smoother playback and theme-aware map styling.
- Switched theme handling to explicit app-controlled `light` / `dark` behavior and hardened global UI styling for controls and scrollbars.

### Fixed
- ZIP code search resolution and prediction behavior.
- U.S. location label formatting, including Current Conditions state naming.
- Aviation edge function ZIP geocoding and CORS handling for allowed origins.
- `Sites` data availability issue by adding the missing table migration.

## [0.2.5] - 2026-02-26

### Added
- New top-level `Aviation` tab that hosts the METAR/TFR/NOTAM aviation panel as its own page section
- Top tab bar settings popover (`Tab Bar`) with localStorage-backed controls for alignment, spacing mode, size, and icon visibility (`tabBar.alignment`, `tabBar.spacing`, `tabBar.size`, `tabBar.icons`)

### Changed
- Reordered top-level tabs to `Conditions | Aviation | Radar | Sites`
- Moved the METAR/TFR/NOTAM block out of the Conditions page and into the new Aviation tab without changing the aviation panel styling/content
- Updated top tab bar layout to support centered/even spacing by default, equal-width tabs, mobile wrapping, and responsive single-row behavior on larger screens

## [0.2.4] - 2026-02-25

### Changed
- Reordered Conditions tab layout so Aviation appears below Current Conditions and above the 8-day forecast and weather metric/flyability cards
- Expanded Aviation tile headers (METAR/TFR/NOTAM) with centered bold labels and aligned refresh actions
- Updated Aviation tile wording (full acronym names, "...near you" titles) and added METAR "Within X mi" line for consistency
- Added a `250 MI` Aviation radius toggle option (shared across METAR/TFR/NOTAM and persisted in `aviationRadiusMiles`)

### Fixed
- NOTAM pane rendering now supports provider `items` responses while preserving the 501 not-configured fallback and empty-state messaging

## [0.2.3] - 2026-02-25

### Added
- FAA NOTAM provider adapter scaffold for `supabase/functions/notam` with provider interface, FAA FNS NDS adapter structure, and `api_cache` response caching

### Changed
- Removed Notamify integration from the NOTAM Edge Function in favor of an FAA-only provider architecture

### Notes
- NOTAM Edge Function now expects FAA Agreement Portal credentials and endpoint secrets (`FAA_NOTAM_ENDPOINT`, `FAA_NOTAM_USERNAME`, `FAA_NOTAM_PASSWORD`, `FAA_NOTAM_AUTH_MODE`)
- FAA FNS NDS SOAP request contract (WSDD operation/envelope) still must be inserted before live FAA NOTAM retrieval can succeed

## [0.2.2] - 2026-02-25

### Changed
- Aviation panel header cleanup (removed coordinate/US-only badge text) and added global radius selector persisted in `localStorage` (`aviationRadiusMiles`)
- Unified METAR/TFR/NOTAM tile styling via shared tile component and consistent header/error layouts
- NOTAM tile now shows a friendly "not configured" state for provider stub responses instead of a fetch failure

### Fixed
- Aviation frontend data fetching now uses `supabase.functions.invoke()` (auth headers + Supabase function routing)
- Edge Function CORS/method handling for `metar`, `tfr`, and `notam` (GET/POST/OPTIONS with consistent JSON+CORS responses)
- Aviation panel reliability issue that surfaced as browser "Failed to fetch" for METAR, TFR, and NOTAM

## [0.2.1] - 2026-02-25

### Added
- METAR proxy via AviationWeather (`supabase/functions/metar`) with stations index + API response caching
- TFR proxy via FAA (`supabase/functions/tfr`) with parsed polygons/circle approximations and radar overlay support
- Nearby aviation UI panel for METAR/TFR data and TFR map-focus actions from Conditions -> Radar
- NOTAM provider stub (`501 not configured`) and UI empty state guidance
- Supabase cache/index tables (`api_cache`, `stations_index`) migration for edge function caching

### Changed
- Radar TFR overlay now uses live FAA geometry and supports bounds-based focus fitting
- Conditions tab aviation summary now uses proxy-backed data instead of visible mock buttons/modals

## [0.2.0] - 2026-02-24

### Added
- Tailwind auth splash screen with Microsoft, Google, and magic link sign-in actions
- Theme mode support (`system`, `light`, `dark`) with local storage persistence
- Theme helper module (`src/lib/theme.ts`) and class-based Tailwind dark mode
- Profile dropdown menu for account actions and settings access
- Settings modal theme controls
- Forecast fallback support using OpenWeather `/forecast` aggregation when One Call is unavailable
- Supabase function config (`verify_jwt = false`) for `aviation-proxy`

### Changed
- Moved settings and auth actions into the top-right profile menu
- Refined Conditions tiles to support per-tile title styling and improved layout controls
- Updated Radar tab to support both legacy and preferred env var names for Mapbox/OpenWeather keys

### Fixed
- 8-day Outlook refresh UX (inline spinner, no extra loading box)
- Forecast wind rendering in outlook cards (`wind_speed` mapping)
- Forecast card date/LIVE alignment and visibility tweaks
- Radar map initialization race causing `Style is not done loading`
- Edge Function CORS/header handling and safer error diagnostics (no OpenWeather key leakage)
- Civil Twilight tile settings action and value alignment behavior

### Notes
- Radar base map requires `VITE_MAPBOX_ACCESS_TOKEN` (or legacy `VITE_MAPBOX_TOKEN`)
- Radar weather overlay requires `VITE_OPENWEATHER_API_KEY` (or legacy `VITE_OPENWEATHER_KEY`)

## [0.1.0] - 2026-02-12

### Added
- Supabase Edge Function proxy for OpenWeather
- Supabase Edge Function proxy for CheckWX
- Geocoding via OpenWeather
- KP index integration (NOAA)
- Mapbox integration
- Weather current + OneCall support

### Fixed
- CORS headers for Edge Functions
- OpenWeather API key validation issue
- Supabase auth toggle misconfiguration
- TypeScript nullability errors in SiteDetail

### Notes
- Local dev server confirmed working
- Edge functions operational
- First stable operational build.
