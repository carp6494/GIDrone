# Whole-Codebase Review Plan (errors, broken features, security)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find and log every real defect, non-working feature, and security hole in GIDrone v0.4.0 for close to zero dollars, then fix them in severity order.

**Architecture:** Cheap mechanical checks first (types, lint, dependency audit, Supabase advisors), then targeted Claude review one path at a time at the lowest effort level that still finds real bugs, then a manual smoke test of every feature in the browser, then data-correctness spot checks against the source of truth. Every finding goes into one log file with a severity so fixes happen in order.

**Tech Stack:** TypeScript 5.6, React 18, Vite 6, ESLint 9 (to be added), Supabase CLI and MCP tools, the `code-review` skill in Claude Code, Chrome.

**Baseline facts (2026-09-22):** 19,105 lines of TS/TSX. `tsc -b` passes. No ESLint, no tests. `npm audit`: 14 high, 5 moderate, 2 low, 0 critical. ConditionsTab.tsx is 4,040 lines and RadarTab.tsx is 2,491.

**Budget rule:** Do not run the `ultra` review tier. Everything here uses your existing Claude Code session or free tooling.

---

## Findings log

All tasks write into one file. Create it first.

### Task 1: Create the findings log

**Files:**
- Create: `docs/superpowers/reviews/2026-09-22-findings.md`

- [ ] **Step 1: Create the file with this exact template**

```markdown
# GIDrone review findings — started 2026-09-22

Severity: S1 = data wrong or security hole, S2 = feature broken, S3 = bug with workaround, S4 = cleanup.
Status: open | fixing | fixed | wontfix

| # | Sev | Area | File:line | Finding | Fix | Status |
|---|-----|------|-----------|---------|-----|--------|
| 1 | S1 | security | src/services/weatherService.js:7 | OpenWeatherMap key shipped in browser bundle | move calls behind an Edge Function or accept and cap usage | open |
| 2 | S1 | security | supabase/functions/_shared/aviation.ts:3 | isOriginAllowed always true, CORS `*` on every function | allow-list gi-drone.vercel.app and localhost | open |
| 3 | S1 | security | supabase/functions/* | verify_jwt false on all 9 functions, no rate limiting | require anon JWT, add per-IP limit in shared helper | open |
| 4 | S1 | security | supabase secrets | NOTAM_SYNC_TOKEN, OBSTRUCTION_SYNC_TOKEN, NOTAM_INGEST_TOKEN unset, so anyone can trigger syncs | set all three, send from cron and CI | open |
| 5 | S1 | security | Supabase project cakmsciuqaodlgzbrcfu | shared with trading/budgeting apps incl. bank_accounts and plaid_items tables | decide: separate project or strict RLS review across all tables | open |
| 6 | S2 | cost | src/App.tsx:456 | tab switch destroys and recreates Mapbox map (billed load each time) | see map cost plan | open |
| 7 | S3 | deps | package-lock.json | 14 high npm audit findings | Task 3 | open |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/reviews/2026-09-22-findings.md
git commit -m "docs: start review findings log"
```

---

## Phase A: Mechanical checks (free, about 1 hour)

### Task 2: Add ESLint and get a baseline count

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Install**

```bash
npm install -D eslint@9 typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh globals
```

- [ ] **Step 2: Create `eslint.config.js`**

```js
import js from "@eslint/js"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["dist", "dev-dist", "node_modules", "supabase/functions/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["src/**/*.{ts,tsx,js}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
)
```

- [ ] **Step 3: Add the script to `package.json`**

In the `"scripts"` block add:

```json
"lint": "eslint . --max-warnings=9999"
```

- [ ] **Step 4: Run it and record the count**

```bash
npm run lint 2>&1 | tail -3
```

Expected: a summary line like `✖ N problems (E errors, W warnings)`. Write N, E, W at the top of the findings log under a `## Lint baseline` heading.

- [ ] **Step 5: Triage errors only**

```bash
npx eslint . --quiet
```

`--quiet` hides warnings. Every remaining line is an error. For each one, add a row to the findings log. `react-hooks/exhaustive-deps` errors in the two big components are S3 unless the missing dependency is a piece of state that changes at runtime, in which case they are S2.

- [ ] **Step 6: Commit the tooling, not the fixes**

```bash
git add eslint.config.js package.json package-lock.json
git commit -m "chore: add eslint with typescript and react-hooks rules"
```

### Task 3: Dependency audit, production only

- [ ] **Step 1: See what actually ships**

```bash
npm audit --omit=dev
```

Expected: fewer than the 21 total findings, because most Vite-chain advisories are dev-only. Record the production-only counts in the findings log.

- [ ] **Step 2: Apply the non-breaking fixes**

```bash
npm audit fix
npm run build
```

Expected: build exits 0. If `npm audit fix` reports items that need `--force`, do not run `--force`. List those packages in the findings log as S3 with the advisory URL.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: npm audit fix (non-breaking)"
```

### Task 4: Supabase advisors and RLS truth table

- [ ] **Step 1: Security advisors**

In Claude Code, ask: "Run the Supabase security advisors for project cakmsciuqaodlgzbrcfu and list only findings on tables or functions that GIDrone owns." GIDrone tables are: `sites`, `notam_feed`, `obstructions`, `api_cache`, and anything created by the migrations in `supabase/migrations/`. The `orders`, `positions`, `audit_log`, `bank_accounts`, `plaid_items` and similar tables belong to your other apps.

- [ ] **Step 2: RLS truth table**

Run this in the Supabase SQL editor:

```sql
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       count(p.polname) as policy_count,
       string_agg(p.polname || ' (' || p.polcmd || ')', ', ') as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relname;
```

This lists every table in the shared project. GIDrone's are `sites`, `notam_feed`, `obstructions`, `api_cache`, and whatever `supabase/migrations/20260225000100_aviation_cache_tables.sql` created. Tables from the other apps are worth a glance too, since the same anon key reaches them.

Expected: every GIDrone row has `rls_enabled = true`. Any table with `rls_enabled = false`, or with `policy_count = 0` that the anon key can reach, is an S1 finding. `sites` must have policies scoped to `auth.uid()`.

- [ ] **Step 3: Check the exposed SECURITY DEFINER function**

```sql
select proname, prosecdef from pg_proc
where proname in ('rls_auto_enable','prune_notam_feed')
  and pronamespace = 'public'::regnamespace;
```

If `rls_auto_enable` has `prosecdef = true`, log S1: revoke execute from anon and authenticated.

```sql
revoke execute on function public.rls_auto_enable() from anon, authenticated;
```

- [ ] **Step 4: Log every result, commit the log**

```bash
git add docs/superpowers/reviews/2026-09-22-findings.md
git commit -m "docs: phase A findings"
```

---

## Phase B: Claude review by path (session tokens only, about 2 hours)

Run each command below as a separate prompt in Claude Code. One path per run. After each run, copy the reported findings into the log with a severity. Do not accept a finding you cannot reproduce or point at a line for.

### Task 5: Shared libraries and hooks

- [ ] **Step 1:** `/code-review medium src/lib`
- [ ] **Step 2:** `/code-review medium src/hooks`
- [ ] **Step 3:** `/code-review medium src/services/weatherService.js`

What to look for specifically: unhandled promise rejections in fetch wrappers, cache keys that omit a query parameter (stale data served for a different location), and unit conversions (knots vs mph, feet vs meters).

- [ ] **Step 4:** Log and commit.

### Task 6: Edge Functions with a security lens

- [ ] **Step 1:** `/code-review high supabase/functions/_shared`
- [ ] **Step 2:** `/code-review medium supabase/functions/tfr`
- [ ] **Step 3:** `/code-review medium supabase/functions/notam`
- [ ] **Step 4:** `/code-review medium supabase/functions/obstruction`
- [ ] **Step 5:** `/code-review medium supabase/functions/heatmap-weather`
- [ ] **Step 6:** `/code-review medium supabase/functions/notam-sync`

For each, add this sentence to the prompt: "Also report any input that reaches a database query or an upstream URL without validation, and any place a caller can make the function do unbounded work."

- [ ] **Step 7:** Log and commit.

### Task 7: The two large components, in slices

These files are too big for one pass to be reliable. Review by responsibility.

- [ ] **Step 1:** `/code-review high src/components/RadarTab.tsx` with the added sentence: "Focus on the map lifecycle effects, layer add/remove ordering, and every place state is read inside a Mapbox event handler (stale closure risk)."
- [ ] **Step 2:** `/code-review high src/components/ConditionsTab.tsx` with: "Focus on the RadarSnapshotPanel frame lifecycle, the weather fetch and unit conversion path, and any effect whose dependency array omits something it reads."
- [ ] **Step 3:** `/code-review medium src/App.tsx`
- [ ] **Step 4:** `/code-review medium src/components/AuthWrapper.tsx` with: "Focus on session bootstrap, token refresh, and what happens when the Supabase project is paused or unreachable."
- [ ] **Step 5:** Log and commit.

---

## Phase C: Manual smoke test (free, about 1 hour)

### Task 8: Exercise every feature and watch the console

- [ ] **Step 1: Start the app**

```bash
npm run dev
```

Open http://localhost:5173 in Chrome with DevTools open on the Console and Network tabs. Tick "Preserve log" on both.

- [ ] **Step 2: Walk this checklist. Each line is pass only if the result matches and no red console line or 4xx/5xx network row appeared.**

| Area | Action | Expected |
|---|---|---|
| Auth | Sign in with Google | lands on Conditions tab, avatar shows |
| Auth | Sign out, request magic link | email arrives within 2 minutes (free tier allows 2 per hour) |
| Auth | Reload page while signed in | no flash of the sign-in screen longer than 1 second |
| Conditions | Type a city in the location bar | suggestions appear after 3 characters, selecting one updates the label and weather |
| Conditions | Click GPS | coordinates update, accuracy shown |
| Conditions | Toggle units | temps and wind change consistently in every panel |
| Conditions | Radar snapshot: play, pause, click a dot | frames morph, dot navigation jumps, no gap frames |
| Conditions | Switch map style Streets/Satellite/Hybrid | style changes, marker stays, radar frames still render |
| Aviation | Open tab | METAR, TFR, NOTAM, Obstruction tiles all populate |
| Aviation | Obstruction sort dropdown | order changes, count unchanged |
| Aviation | Click a TFR "show on map" | Radar tab opens centered on it with a popup |
| Radar | Pan 50 miles away, wait 2 seconds | TFR/NOTAM/obstruction markers refresh for the new area |
| Radar | Toggle heatmap, switch grid/heatmap mode | overlay renders, popups work on cells |
| Radar | Switch base style | overlays survive the style change |
| Radar | Toggle dark/light theme in Settings | map restyles, overlays survive |
| Sites | Add a site by clicking the map | appears in list and as a marker |
| Sites | Upload a photo | shows in detail; mini map renders under it |
| Sites | CSV import with 3 rows | 3 sites added, bad rows reported |
| Sites | Delete a site | gone from list and map |
| Settings | Change time format | timestamps update everywhere |
| Offline | DevTools, Network, Offline; reload | PWA shell loads, panels show a clear error rather than spinning forever |

- [ ] **Step 3: Log every failure as S2, every console error as S3 (S2 if it accompanies a failure), commit the log.**

---

## Phase D: Data correctness spot checks (free, about 30 minutes)

### Task 9: Compare against the sources of truth

- [ ] **Step 1: NOTAM freshness**

```sql
select max(updated_at), count(*) from notam_feed;
```

Expected: `max(updated_at)` within the last 15 minutes. If older, the cron job is failing. Check `cron.job_run_details` for jobid 3.

- [ ] **Step 2: TFR count vs FAA**

Open https://tfr.faa.gov/tfr2/list.html, count active TFRs in one state. Pan the Radar tab to that state at a zoom that shows the whole state. Counts should match within the ones that are NOTAM-only with no geometry.

- [ ] **Step 3: METAR vs AviationWeather**

Pick the nearest airport in the Aviation tab. Open https://aviationweather.gov/data/metar/?id=KXXX for it. Wind, visibility, and ceiling must match the latest observation time.

- [ ] **Step 4: Obstruction sample vs DOF**

```sql
select oas_number, height_agl_ft, latitude, longitude from obstructions
order by random() limit 3;
```

Look each OAS number up in the FAA DOF viewer. Height and coordinates must match.

- [ ] **Step 5: Obstruction sync age**

```bash
gh run list --workflow=sync-obstructions.yml --limit 3
```

Expected: a successful run within the last 24 hours. If the newest run is older than 60 days, GitHub disabled the schedule for inactivity again. Re-enable with `gh workflow enable sync-obstructions.yml`.

- [ ] **Step 6: Log and commit.**

---

## Phase E: Fix in order

### Task 10: Work the log

- [ ] **Step 1:** Sort the findings log by severity. Fix every S1 first, one commit per finding, message `fix(security): <finding #N> <one line>`.
- [ ] **Step 2:** For each S2, write the smallest reproduction as a Vitest test where the logic is pure (unit conversion, cache keys, geometry). Where it is UI-only, re-run the smoke checklist row after the fix.
- [ ] **Step 3:** S3 and S4 go into a follow-up milestone. Do not let them delay the S1 and S2 work.
- [ ] **Step 4:** When all S1 and S2 rows read `fixed`, bump the version to 0.4.1 and tag.

```bash
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: v0.4.1 - review fixes"
git tag v0.4.1
git push origin main --tags
```
