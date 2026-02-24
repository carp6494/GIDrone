# GIDrone Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog
and this project adheres to Semantic Versioning.

---

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
