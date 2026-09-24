# CLAUDE.md

## Session protocol

- **First action every session:** read `HANDOFF.md`.
- **Last action every session:** rewrite `HANDOFF.md` with current state. Replace it, never append. Keep it under one page.

## What this project is

GI Drone (gi-drone.vercel.app): a safety-first flight planning and site management PWA for professional drone operators. It shows weather, radar, METARs, TFRs, NOTAMs, FAA obstructions, and a flyability heatmap on a map, and lets users save inspection sites with photos.

Version is in `package.json` (v0.4.0 at time of writing). Releases are tagged commits on `main`; there is no branch workflow.

## Stack

- Frontend: React 18, TypeScript 5.6, Vite 6, Tailwind 3, mapbox-gl 3, Space Grotesk font. PWA via vite-plugin-pwa.
- Backend: Supabase project `cakmsciuqaodlgzbrcfu` (Postgres 17, Edge Functions on Deno, pg_cron, Vault). **This project is shared with the owner's other apps** (trading, budgeting). Schema changes and pauses affect all of them. Their tables have RLS with no anon access; do not touch them.
- Hosting: Vercel, deploys from `main`.
- Data sources: NWS (api.weather.gov), FAA TFR (tfr.faa.gov), FAA NMS-API for NOTAMs (CGI Federal staging host, OAuth2), FAA Daily DOF for obstructions, AviationWeather.gov METARs, RainViewer and OpenWeatherMap for radar/weather, Mapbox for basemap and geocoding.

## Directory conventions

- `src/components/` UI. `ConditionsTab.tsx` (~4k lines) and `RadarTab.tsx` (~2.5k) are the big ones and own their Mapbox maps.
- `src/hooks/use*.ts` data hooks; all follow the `useTfrs` pattern.
- `src/lib/aviation/*Client.ts` Edge Function clients. `src/lib/` also holds pure helpers.
- `src/services/weatherService.js` legacy JS: weather fetch + Mapbox geocoding.
- `supabase/functions/<name>/index.ts` Edge Functions; `_shared/aviation.ts` has CORS, cache, fetch helpers.
- `supabase/migrations/` SQL migrations. Apply via the Supabase MCP `apply_migration` so they are recorded, and commit the file.
- `scripts/sync-obstructions.mjs` run daily by `.github/workflows/sync-obstructions.yml`.
- `docs/superpowers/specs/`, `plans/`, `reviews/` design specs, implementation plans, review findings logs.
- `DESIGN_SYSTEM.md` color tokens and component patterns. `CHANGELOG.md` per release.

## Commands

```
npm run dev       # Vite on 0.0.0.0:5173
npm run build     # tsc -b && vite build
npm run lint      # eslint (baseline 2026-09-22: 18 errors, 36 warnings)
npm audit --omit=dev
gh workflow list --all   # check sync-obstructions is not "disabled_inactivity"
```

Tests: none yet. The map cost plan adds Vitest.

## Rules being followed

- Commit directly to `main`; push after each logical unit. Commit messages end with the Claude co-author line.
- Never commit secrets. `.env` holds `VITE_SUPABASE_*`, `VITE_MAPBOX_ACCESS_TOKEN`, `VITE_OPENWEATHER_API_KEY`. Edge Function secrets live in Supabase (`NMS_API_CLIENT_ID/SECRET`, sync tokens).
- Database changes go through a migration file plus `apply_migration`; confirm with the owner before revoking or dropping anything.
- Before debugging any data or auth problem, check the Supabase project status first. It pauses after 7 days idle on the free plan.
- GitHub disables the obstruction sync schedule after 60 days without a commit. Re-enable with `gh workflow enable sync-obstructions.yml`.
- Keep raw tool output out of context: route large command output through the context-mode sandbox tools.
- Creative or feature work goes through brainstorming then a written plan in `docs/superpowers/plans/` before code.
