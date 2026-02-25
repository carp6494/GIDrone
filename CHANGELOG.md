# GIDrone Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog
and this project adheres to Semantic Versioning.

---

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
