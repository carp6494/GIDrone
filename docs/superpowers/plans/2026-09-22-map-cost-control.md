# Map Cost Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Mapbox spend near zero at thousands of users without changing what the user sees or how fresh the aviation and weather data is.

**Architecture:** Mapbox bills per *Map object initialization* (a "map load"), not per pan, zoom, or data refresh. So the whole strategy is: initialize each map once per session and keep it alive, never recreate it for a style or theme change, replace the one-off thumbnail map with a static image, and cache geocoding. Data freshness is untouched: every TTL and refresh interval stays as it is, and the only background work that pauses is on a hidden tab, with an immediate refresh when the tab comes back so the user never sees stale data.

**Tech Stack:** React 18, mapbox-gl 3.18, Vite 6, Vitest (added in Task 2), Mapbox Static Images API.

**Where the loads come from today (2026-09-22):**

| Source | File | Loads per user session today |
|---|---|---|
| Tab switch destroys and recreates the map | `src/App.tsx:456` (`panel` useMemo renders one tab) | 1 per return to Conditions or Radar |
| Style or theme change recreates the map | `src/components/RadarTab.tsx:1733`, `src/components/ConditionsTab.tsx:2418` (style in the init effect deps) | 1 per toggle |
| Site thumbnail is a full Map | `src/components/SitePhoto.tsx:24` | 1 per site opened |
| Reverse geocode per location change | `src/services/weatherService.js:77` | geocoding call, separate quota |

A typical session today: open app (1), Radar (2), back to Conditions (3), open a site (4), toggle satellite (5). After this plan: 2, and the second one only if the user opens Radar.

**Mapbox pricing as published (verify on mapbox.com/pricing before relying on it):** Map Loads for Web, 50,000 free per month then about $5 per 1,000. Static Images, 50,000 free then about $1 per 1,000, and browser-cacheable. Geocoding, 100,000 free then about $0.75 per 1,000.

---

## File structure

- Create `src/lib/mapLoadTracker.ts`: counts Map initializations per session, warns in dev if a session exceeds a budget. Pure logic, injectable storage, testable.
- Create `src/lib/location/geocodeCache.ts`: rounding and TTL cache for reverse and forward geocode results. Pure logic, injectable storage, testable.
- Create `src/lib/mapbox/staticImage.ts`: builds a Static Images URL for a lat/lng/zoom. Pure, testable.
- Modify `src/App.tsx`: keep Conditions and Radar mounted after first visit, hidden with CSS, and pass `isActive`.
- Modify `src/components/RadarTab.tsx`: accept `isActive`, remove style from the init effect deps, resize on activate, pause the heatmap interval while hidden and refresh on return.
- Modify `src/components/ConditionsTab.tsx`: remove style from the map init effect deps; resize on activate.
- Modify `src/components/SitePhoto.tsx`: replace `MiniMap` with a static image that keeps the zoom buttons.
- Modify `src/services/weatherService.js`: wrap both geocode calls with the cache.
- Add tests under `src/lib/**/__tests__/`.

---

### Task 1: Restrict the Mapbox token (no code, 10 minutes)

This is the only step that protects you from someone else's traffic. Without it, anyone who copies the token from your bundle can run their own site on your account.

- [ ] **Step 1:** In the Mapbox account dashboard, open Tokens. Create a new public token named `gi-drone-prod` with only these scopes: `styles:tiles`, `styles:read`, `fonts:read`, `datasets:read`, `vision:read`. Under URL restrictions add `https://gi-drone.vercel.app/*` and `https://*.vercel.app/*`.
- [ ] **Step 2:** Create a second token `gi-drone-dev` with the same scopes and URL restriction `http://localhost:*`.
- [ ] **Step 3:** In Vercel, set `VITE_MAPBOX_ACCESS_TOKEN` to the prod token for Production and the dev token for Preview and Development. Locally, put the dev token in `.env.local`.
- [ ] **Step 4:** Redeploy. Open the live site, confirm maps render. Delete or rotate the old unrestricted token.
- [ ] **Step 5:** Open the Mapbox Statistics page and write down this month's map loads so far. This is the baseline every later task is measured against.

---

### Task 2: Test runner and the map load tracker

**Files:**
- Create: `src/lib/mapLoadTracker.ts`
- Create: `src/lib/__tests__/mapLoadTracker.test.ts`
- Modify: `package.json` (scripts, devDependencies)

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Write the failing test**

`src/lib/__tests__/mapLoadTracker.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { createMapLoadTracker } from "../mapLoadTracker"

const memoryStorage = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe("mapLoadTracker", () => {
  it("counts loads per source and in total", () => {
    const t = createMapLoadTracker({ storage: memoryStorage(), budget: 3 })
    t.record("radar")
    t.record("radar")
    t.record("conditions")
    expect(t.snapshot()).toEqual({ total: 3, bySource: { radar: 2, conditions: 1 } })
  })

  it("reports over budget once the budget is exceeded", () => {
    const t = createMapLoadTracker({ storage: memoryStorage(), budget: 2 })
    t.record("a")
    expect(t.isOverBudget()).toBe(false)
    t.record("b")
    expect(t.isOverBudget()).toBe(false)
    t.record("c")
    expect(t.isOverBudget()).toBe(true)
  })

  it("persists across instances sharing storage", () => {
    const s = memoryStorage()
    createMapLoadTracker({ storage: s, budget: 5 }).record("x")
    expect(createMapLoadTracker({ storage: s, budget: 5 }).snapshot().total).toBe(1)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npm test -- src/lib/__tests__/mapLoadTracker.test.ts
```

Expected: FAIL, cannot find module `../mapLoadTracker`.

- [ ] **Step 4: Implement**

`src/lib/mapLoadTracker.ts`:

```ts
type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

type Snapshot = { total: number; bySource: Record<string, number> }

const KEY = "gi-drone:map-loads"

export const createMapLoadTracker = (opts: { storage: StorageLike; budget: number }) => {
  const read = (): Snapshot => {
    try {
      const raw = opts.storage.getItem(KEY)
      if (!raw) return { total: 0, bySource: {} }
      const parsed = JSON.parse(raw) as Snapshot
      return { total: parsed.total ?? 0, bySource: parsed.bySource ?? {} }
    } catch {
      return { total: 0, bySource: {} }
    }
  }
  const write = (s: Snapshot) => {
    try {
      opts.storage.setItem(KEY, JSON.stringify(s))
    } catch {
      /* storage unavailable: counting is best-effort */
    }
  }
  return {
    record(source: string) {
      const s = read()
      s.total += 1
      s.bySource[source] = (s.bySource[source] ?? 0) + 1
      write(s)
      return s
    },
    snapshot: read,
    isOverBudget: () => read().total > opts.budget,
  }
}

// Session-scoped singleton for the app. sessionStorage resets per tab, which is
// what we want: the budget is "map loads per visit".
const sessionStorageOrMemory = (): StorageLike => {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage
  } catch {
    /* fall through */
  }
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

export const mapLoadTracker = createMapLoadTracker({ storage: sessionStorageOrMemory(), budget: 3 })

/** Call exactly once per `new mapboxgl.Map(...)`. */
export const recordMapLoad = (source: "conditions" | "radar" | "site-photo") => {
  const s = mapLoadTracker.record(source)
  if (import.meta.env.DEV && mapLoadTracker.isOverBudget()) {
    console.warn(`[map-loads] ${s.total} Mapbox map loads this session (budget 3)`, s.bySource)
  }
}
```

- [ ] **Step 5: Run the test**

```bash
npm test -- src/lib/__tests__/mapLoadTracker.test.ts
```

Expected: 3 passed.

- [ ] **Step 6: Wire it into the three creation sites**

In `src/components/RadarTab.tsx`, directly after the line `mapRef.current = map` inside the map init effect (near line 1675):

```ts
recordMapLoad("radar")
```

In `src/components/ConditionsTab.tsx`, directly after `mapRef.current = map` in the map init effect (near line 2400):

```ts
recordMapLoad("conditions")
```

In `src/components/SitePhoto.tsx` after `mapRef.current = map` (near line 43; this site is removed in Task 6 but count it until then):

```ts
recordMapLoad("site-photo")
```

Add to each file's imports:

```ts
import { recordMapLoad } from "../lib/mapLoadTracker"
```

- [ ] **Step 7: Verify in the browser**

```bash
npm run dev
```

Open the app, switch Conditions to Radar and back twice, open a site. Expected: the console shows the over-budget warning with a total of 5 or more. That is today's behavior, and the number this plan drives down.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/mapLoadTracker.ts src/lib/__tests__/mapLoadTracker.test.ts src/components/RadarTab.tsx src/components/ConditionsTab.tsx src/components/SitePhoto.tsx
git commit -m "feat: count Mapbox map loads per session with dev budget warning"
```

---

### Task 3: Stop recreating the map on style and theme changes

Both components already have a correct `setStyle` effect. The bug is that the *init* effect also lists the style in its dependencies, so a style change tears the map down and builds a new one (a billed load), and then the setStyle effect runs on the new map. Fix: capture the initial style in a ref and take it out of the init deps.

**Files:**
- Modify: `src/components/RadarTab.tsx:1663-1733`
- Modify: `src/components/ConditionsTab.tsx:2385-2418`

- [ ] **Step 1: RadarTab, add a ref above the init effect**

Just before the comment `// Map initialization` (line 1662):

```ts
const initialStyleRef = useRef(resolvedBaseStyle)
initialStyleRef.current = resolvedBaseStyle
```

- [ ] **Step 2: RadarTab, use the ref in the constructor and drop the dep**

Change:

```ts
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: resolvedBaseStyle,
```

to:

```ts
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: initialStyleRef.current,
```

and change the dependency array at line 1733 from:

```ts
  }, [missingToken, mapboxToken, resolvedBaseStyle])
```

to:

```ts
  }, [missingToken, mapboxToken])
```

- [ ] **Step 3: RadarTab, the existing style effect already skips its first run**

Confirm the block at lines 1735-1763 still starts with the `didRunInitialStyleEffectRef` guard. It does today. No change needed there.

- [ ] **Step 4: ConditionsTab, same pattern**

Just before the comment `// Map init` (line 2384):

```ts
const initialMapStyleRef = useRef(mapStyle)
initialMapStyleRef.current = mapStyle
```

Change the constructor's `style: mapStyle,` to `style: initialMapStyleRef.current,`.

Change the dependency array at line 2418 from:

```ts
  }, [hasMapboxToken, mapStyle, mapboxToken])
```

to:

```ts
  }, [hasMapboxToken, mapboxToken])
```

The existing `// Style switch` effect at line 2422 compares `appliedMapStyleRef.current === mapStyle` and calls `setStyle`, so it now handles every style change on the live map.

- [ ] **Step 5: Verify**

```bash
npx tsc -b && npm run dev
```

In the browser with the console open: on the Conditions tab switch Streets, Satellite, Hybrid, then toggle dark mode in Settings. On the Radar tab do the same. Expected: the map restyles each time, overlays and markers survive, and the `[map-loads]` counter does not increase. Reload and repeat to confirm the count is exactly 1 per tab after all toggles.

- [ ] **Step 6: Commit**

```bash
git add src/components/RadarTab.tsx src/components/ConditionsTab.tsx
git commit -m "fix: do not recreate Mapbox map on style or theme change"
```

---

### Task 4: Keep the map tabs mounted across tab switches

Today `panel` in `App.tsx` returns exactly one tab component, so leaving Radar unmounts it and `map.remove()` runs. Coming back creates a new map. Instead, mount Conditions and Radar the first time they are opened and then keep them alive, hidden with the `hidden` attribute. Aviation and Sites keep the existing conditional rendering since they have no map.

**Files:**
- Modify: `src/App.tsx:456-600` (the `panel` useMemo)
- Modify: `src/components/RadarTab.tsx` (props type, resize on activate)
- Modify: `src/components/ConditionsTab.tsx` (props type, resize on activate)

- [ ] **Step 1: Add an `isActive` prop to RadarTab**

Find the props type (search for `type RadarTabProps` or the inline props object on the `RadarTab` function) and add:

```ts
  /** false while another tab is showing; the map stays mounted but paused */
  isActive?: boolean
```

Destructure it with a default of `true` so existing callers are unaffected:

```ts
isActive = true,
```

- [ ] **Step 2: RadarTab, resize the map when the tab becomes visible**

A map inside a `hidden` container has a zero-size canvas. When it reappears it must be told to measure again. Add this effect after the `// Style switching` effect:

```ts
  // Re-measure the canvas when this tab is shown again after being hidden
  useEffect(() => {
    if (!isActive) return
    const map = mapRef.current
    if (!map) return
    const id = requestAnimationFrame(() => map.resize())
    return () => cancelAnimationFrame(id)
  }, [isActive])
```

- [ ] **Step 3: Same two changes in ConditionsTab**

Add `isActive?: boolean` to the `ConditionsTab` props type with default `true`, and thread it down to `RadarSnapshotPanel` as a prop (the panel is rendered at line 3631; add `isActive={isActive}` there and to `RadarSnapshotPanelProps`). Inside `RadarSnapshotPanel`, add the same resize effect after the `// Style switch` effect:

```ts
  useEffect(() => {
    if (!isActive) return
    const map = mapRef.current
    if (!map) return
    const id = requestAnimationFrame(() => map.resize())
    return () => cancelAnimationFrame(id)
  }, [isActive])
```

- [ ] **Step 4: App.tsx, track which map tabs have been visited**

Near the other `useState` calls (after `activeTab` at line 116):

```ts
  // Map-bearing tabs stay mounted after first visit so Mapbox is initialized once per session.
  const [mountedMapTabs, setMountedMapTabs] = useState<Set<TabKey>>(() => new Set())
  useEffect(() => {
    if (activeTab !== "conditions" && activeTab !== "radar") return
    setMountedMapTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)))
  }, [activeTab])
```

- [ ] **Step 5: App.tsx, split the panel into persistent and transient parts**

Replace the `if (activeTab === "conditions") { return (<ConditionsTab .../>) }` block and the `if (activeTab === "radar") { return (<RadarTab .../>) }` block inside the `panel` useMemo with nothing (delete both `if` blocks), and leave the Aviation and Sites branches as they are. Then add `mountedMapTabs` to the `panel` dependency array only if you reference it inside; you should not.

Directly above `{panel}` inside the `<Suspense>` at line 847, add:

```tsx
              {mountedMapTabs.has("conditions") && (
                <div hidden={activeTab !== "conditions"}>
                  <ConditionsTab
                    isActive={activeTab === "conditions"}
                    unit={unit}
                    timeFormat={timeFormat}
                    theme={theme}
                    onTabChange={setActiveTab}
                    activeCoords={activeCoords}
                    activeLocationLabel={activeLocationLabel}
                    activeGpsAccuracy={activeGpsAccuracy}
                  />
                </div>
              )}
              {mountedMapTabs.has("radar") && (
                <div hidden={activeTab !== "radar"}>
                  <RadarTab
                    isActive={activeTab === "radar"}
                    theme={theme}
                    focusLocation={mapFocus ?? undefined}
                    defaultCenter={activeCoords}
                    sites={radarSites}
                  />
                </div>
              )}
```

The props are exactly the ones the deleted blocks passed. `panel` now only ever returns Aviation, Sites, or null; make the end of the useMemo return `null` when `activeTab` is `"conditions"` or `"radar"`:

```ts
    if (activeTab === "conditions" || activeTab === "radar") return null
```

Put that line first inside the useMemo body.

- [ ] **Step 6: Type check and run**

```bash
npx tsc -b && npm run dev
```

In the browser: Conditions, Radar, Aviation, Radar, Sites, Conditions, Radar. Expected: `[map-loads]` total is 2 for the whole sequence. The Radar map keeps its position and zoom when you return. The Conditions radar snapshot keeps its frame. No layout jump when a hidden tab reappears (the resize effect handles it).

- [ ] **Step 7: Check the Sites to Radar hand-off still works**

Open Sites, click "show on map" on a site. Expected: Radar tab shows with the focus marker and popup. `focusLocation` is a prop, so the existing `applyFocusLocation` path handles it whether or not the map already existed. If the marker does not appear on a *second* hand-off, the effect that watches `focusLocation` needs `isActive` added to its dependency array so it re-applies when the tab is revealed.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/RadarTab.tsx src/components/ConditionsTab.tsx
git commit -m "feat: keep map tabs mounted across tab switches (one Mapbox load per tab per session)"
```

---

### Task 5: Pause hidden-tab background work, refresh instantly on return

Keeping Radar mounted means its 15-minute heatmap timer and its pan-driven TFR/NOTAM/obstruction queries keep running while the user is elsewhere. None of that is Mapbox cost, but it is Supabase and NWS traffic for a screen nobody is looking at. Pause it while hidden and refresh the moment the tab returns, so data on screen is never older than it would have been.

**Files:**
- Modify: `src/components/RadarTab.tsx` (the effect at line 1874 that sets `heatmapRefreshRef`)

- [ ] **Step 1: Replace the heatmap refresh interval effect**

Find the effect containing `heatmapRefreshRef.current = setInterval(() => { heatmapWeather.refresh() }, HEATMAP_REFRESH_MS)`. Replace the whole effect with:

```ts
  // Heatmap auto-refresh: runs only while this tab is visible. On return, refresh
  // immediately if the data is older than one interval so nothing stale is shown.
  const heatmapLastRefreshRef = useRef<number>(Date.now())
  useEffect(() => {
    if (!isActive) {
      if (heatmapRefreshRef.current) clearInterval(heatmapRefreshRef.current)
      heatmapRefreshRef.current = null
      return
    }
    if (Date.now() - heatmapLastRefreshRef.current >= HEATMAP_REFRESH_MS) {
      heatmapWeather.refresh()
      heatmapLastRefreshRef.current = Date.now()
    }
    heatmapRefreshRef.current = setInterval(() => {
      heatmapWeather.refresh()
      heatmapLastRefreshRef.current = Date.now()
    }, HEATMAP_REFRESH_MS)
    return () => {
      if (heatmapRefreshRef.current) clearInterval(heatmapRefreshRef.current)
      heatmapRefreshRef.current = null
    }
  }, [isActive, heatmapWeather])
```

If the original effect had other dependencies (for example a heatmap-enabled flag), keep them in the array and keep the early return that checks them, placed after the `isActive` check.

- [ ] **Step 2: Check whether the data hooks poll**

```bash
grep -n -E "setInterval|refetch|poll" src/hooks/useTfrs.ts src/hooks/useNotams.ts src/hooks/useObstructions.ts src/hooks/useHeatmapWeather.ts
```

If any hook has its own interval, add an `enabled` option to that hook that skips the interval when false, and pass `enabled: isActive` from RadarTab. If none poll (they refetch only when lat/lon change), nothing more is needed: a hidden map does not move, so `mapQueryCenter` does not change, so no queries fire.

- [ ] **Step 3: Verify**

In the browser with the Network tab filtered to `functions/v1`: open Radar, switch to Aviation, wait 16 minutes (or temporarily set `HEATMAP_REFRESH_MS` to 20 seconds for the test and restore it). Expected: no `heatmap-weather` requests while on Aviation. Switch back to Radar. Expected: one `heatmap-weather` request fires immediately, then the normal interval resumes.

- [ ] **Step 4: Commit**

```bash
git add src/components/RadarTab.tsx
git commit -m "perf: pause radar heatmap refresh while tab hidden, refresh on return"
```

---

### Task 6: Replace the site thumbnail map with a static image

`MiniMap` in `SitePhoto.tsx` creates a full interactive Map for a non-interactive 16:9 thumbnail. A Static Images request costs one fifth as much, is cached by the browser, and looks identical. The zoom buttons stay: they change the zoom in the URL and the browser fetches (or serves from cache) the new image.

**Files:**
- Create: `src/lib/mapbox/staticImage.ts`
- Create: `src/lib/mapbox/__tests__/staticImage.test.ts`
- Modify: `src/components/SitePhoto.tsx:15-60` (the `MiniMap` function)

- [ ] **Step 1: Write the failing test**

`src/lib/mapbox/__tests__/staticImage.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { buildStaticMapUrl } from "../staticImage"

describe("buildStaticMapUrl", () => {
  it("builds a satellite-streets image with a marker at the site", () => {
    const url = buildStaticMapUrl({
      token: "pk.test",
      lat: 40.7128,
      lng: -74.006,
      zoom: 14,
      width: 640,
      height: 360,
    })
    expect(url).toBe(
      "https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/" +
        "pin-s+34d399(-74.006,40.7128)/-74.006,40.7128,14,0/640x360@2x?access_token=pk.test",
    )
  })

  it("clamps zoom to the Static Images range 0..22 and rounds to 2 decimals", () => {
    const url = buildStaticMapUrl({ token: "t", lat: 1, lng: 2, zoom: 25.123, width: 100, height: 100 })
    expect(url).toContain("/2,1,22,0/")
  })

  it("caps dimensions at 1280 (the API maximum)", () => {
    const url = buildStaticMapUrl({ token: "t", lat: 1, lng: 2, zoom: 10, width: 4000, height: 50 })
    expect(url).toContain("/1280x50@2x")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -- src/lib/mapbox/__tests__/staticImage.test.ts
```

Expected: FAIL, cannot find module `../staticImage`.

- [ ] **Step 3: Implement**

`src/lib/mapbox/staticImage.ts`:

```ts
type Opts = {
  token: string
  lat: number
  lng: number
  zoom: number
  width: number
  height: number
}

const STYLE = "mapbox/satellite-streets-v12"
const MARKER_COLOR = "34d399" // emerald-400, matches the RadarTab site marker

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

/**
 * Mapbox Static Images URL for a site thumbnail. Deterministic for the same
 * inputs, so the browser cache serves repeat views for free.
 */
export const buildStaticMapUrl = ({ token, lat, lng, zoom, width, height }: Opts) => {
  const z = Math.round(clamp(zoom, 0, 22) * 100) / 100
  const w = clamp(Math.round(width), 1, 1280)
  const h = clamp(Math.round(height), 1, 1280)
  const pin = `pin-s+${MARKER_COLOR}(${lng},${lat})`
  return (
    `https://api.mapbox.com/styles/v1/${STYLE}/static/` +
    `${pin}/${lng},${lat},${z},0/${w}x${h}@2x?access_token=${encodeURIComponent(token)}`
  )
}
```

- [ ] **Step 4: Run the test**

```bash
npm test -- src/lib/mapbox/__tests__/staticImage.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Replace `MiniMap` in `SitePhoto.tsx`**

Delete the whole `function MiniMap(...) { ... }` (lines 15 through its closing brace, just before `export function SitePhoto`). Replace with:

```tsx
const MIN_ZOOM = BASE_ZOOM
const MAX_ZOOM = 19
// 16:9 thumbnail. 640x360 at @2x renders crisp on retina at up to ~640 css px wide.
const THUMB_W = 640
const THUMB_H = 360

function MiniMap({ lat, lng }: { lat: number; lng: number }) {
  const [zoom, setZoom] = useState(BASE_ZOOM)
  const token = CONFIG.mapboxToken
  const src = token
    ? buildStaticMapUrl({ token, lat, lng, zoom, width: THUMB_W, height: THUMB_H })
    : null

  const handleZoom = (dir: 1 | -1) => {
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + dir)))
  }

  return (
    <div className="relative w-full aspect-video overflow-hidden bg-slate-900">
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
          Map unavailable
        </div>
      )}
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => handleZoom(1)}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
          className="rounded-full border border-slate-700 bg-slate-950/80 p-1.5 text-slate-200 transition hover:border-emerald-400 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handleZoom(-1)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
          className="rounded-full border border-slate-700 bg-slate-950/80 p-1.5 text-slate-200 transition hover:border-emerald-400 disabled:opacity-40"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
```

Update the imports at the top of the file. Remove:

```ts
import { useEffect, useRef, useState } from "react"
import mapboxgl from "mapbox-gl"
import { recordMapLoad } from "../lib/mapLoadTracker"
```

Add:

```ts
import { useState } from "react"
import { buildStaticMapUrl } from "../lib/mapbox/staticImage"
```

Keep `useEffect` or `useRef` in the import only if the rest of `SitePhoto` (the lightbox below `MiniMap`) still uses them; `tsc` will tell you.

- [ ] **Step 6: Verify**

```bash
npx tsc -b && npm run dev
```

Open Sites, open a site with coordinates. Expected: a satellite thumbnail with the emerald pin, zoom buttons work with a short image swap, and the `[map-loads]` counter does not change. In the Network tab the request is to `api.mapbox.com/styles/v1/.../static/...` and a second open of the same site is served from cache (status `200 (from disk cache)` or `304`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/mapbox/staticImage.ts src/lib/mapbox/__tests__/staticImage.test.ts src/components/SitePhoto.tsx
git commit -m "perf: site thumbnail uses Static Images API instead of a live map"
```

---

### Task 7: Cache geocoding

Reverse geocoding runs every time the active location changes, and forward geocoding runs as the user types. Place names for a coordinate do not change, and the same query returns the same suggestions for weeks. Cache both in localStorage with a 30-day TTL, keyed on coordinates rounded to 3 decimals (about 100 m, well inside the "place, locality" granularity the app asks Mapbox for).

**Files:**
- Create: `src/lib/location/geocodeCache.ts`
- Create: `src/lib/location/__tests__/geocodeCache.test.ts`
- Modify: `src/services/weatherService.js:76-95` and `:272-292`

- [ ] **Step 1: Write the failing test**

`src/lib/location/__tests__/geocodeCache.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { createGeocodeCache, reverseKey, forwardKey } from "../geocodeCache"

const memoryStorage = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe("geocode cache keys", () => {
  it("rounds coordinates to 3 decimals so nearby points share a key", () => {
    expect(reverseKey(40.71284, -74.00601)).toBe("rev:40.713,-74.006")
    expect(reverseKey(40.71251, -74.00649)).toBe("rev:40.713,-74.006")
  })
  it("normalizes forward queries", () => {
    expect(forwardKey("  New  York ", 5)).toBe("fwd:new york:5")
  })
})

describe("geocode cache", () => {
  it("returns null on miss, value on hit", () => {
    const c = createGeocodeCache({ storage: memoryStorage(), ttlMs: 1000, now: () => 0 })
    expect(c.get("k")).toBeNull()
    c.set("k", { label: "x" })
    expect(c.get("k")).toEqual({ label: "x" })
  })
  it("expires after ttl", () => {
    let t = 0
    const c = createGeocodeCache({ storage: memoryStorage(), ttlMs: 1000, now: () => t })
    c.set("k", 1)
    t = 999
    expect(c.get("k")).toBe(1)
    t = 1001
    expect(c.get("k")).toBeNull()
  })
  it("survives corrupt storage entries", () => {
    const s = memoryStorage()
    s.setItem("gi-drone:geocode:k", "not json")
    const c = createGeocodeCache({ storage: s, ttlMs: 1000, now: () => 0 })
    expect(c.get("k")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -- src/lib/location/__tests__/geocodeCache.test.ts
```

Expected: FAIL, cannot find module `../geocodeCache`.

- [ ] **Step 3: Implement**

`src/lib/location/geocodeCache.ts`:

```ts
type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const PREFIX = "gi-drone:geocode:"
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export const reverseKey = (lat: number, lon: number) =>
  `rev:${lat.toFixed(3)},${lon.toFixed(3)}`

export const forwardKey = (query: string, limit: number) =>
  `fwd:${query.trim().toLowerCase().replace(/\s+/g, " ")}:${limit}`

export const createGeocodeCache = (opts: {
  storage: StorageLike
  ttlMs: number
  now: () => number
}) => ({
  get<T>(key: string): T | null {
    try {
      const raw = opts.storage.getItem(PREFIX + key)
      if (!raw) return null
      const entry = JSON.parse(raw) as { v: T; exp: number }
      if (typeof entry?.exp !== "number" || entry.exp <= opts.now()) {
        opts.storage.removeItem(PREFIX + key)
        return null
      }
      return entry.v
    } catch {
      return null
    }
  },
  set(key: string, value: unknown) {
    try {
      opts.storage.setItem(PREFIX + key, JSON.stringify({ v: value, exp: opts.now() + opts.ttlMs }))
    } catch {
      /* quota or private mode: caching is best-effort */
    }
  },
})

const localStorageOrMemory = (): StorageLike => {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage
  } catch {
    /* fall through */
  }
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

export const geocodeCache = createGeocodeCache({
  storage: localStorageOrMemory(),
  ttlMs: THIRTY_DAYS_MS,
  now: () => Date.now(),
})
```

- [ ] **Step 4: Run the test**

```bash
npm test -- src/lib/location/__tests__/geocodeCache.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Use it in the reverse geocode path**

In `src/services/weatherService.js`, add at the top with the other imports:

```js
import { geocodeCache, reverseKey, forwardKey } from "../lib/location/geocodeCache"
```

In the reverse geocode function, replace:

```js
  if (!MAPBOX_PUBLIC_KEY) return null

  const endpoint = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json`
  )
```

with:

```js
  if (!MAPBOX_PUBLIC_KEY) return null

  const cacheKey = reverseKey(lat, lon)
  const cached = geocodeCache.get(cacheKey)
  if (cached) return cached

  const endpoint = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json`
  )
```

Then find the `return` at the end of that function that returns the built result object (the one with `label` and `country`). Change it from `return result` (whatever the local name is) to:

```js
  geocodeCache.set(cacheKey, result)
  return result
```

If the function returns an object literal directly, assign it to `const result = { ... }` first.

- [ ] **Step 6: Use it in the forward geocode path**

In `lookupMapboxLocations`, replace:

```js
const lookupMapboxLocations = async (query, limit = 5) => {
  if (!MAPBOX_PUBLIC_KEY) return []

  const endpoint = new URL(
```

with:

```js
const lookupMapboxLocations = async (query, limit = 5) => {
  if (!MAPBOX_PUBLIC_KEY) return []
  if (query.trim().length < 3) return []

  const cacheKey = forwardKey(query, limit)
  const cached = geocodeCache.get(cacheKey)
  if (cached) return cached

  const endpoint = new URL(
```

and at the end of that function, where it returns the mapped array, store it first:

```js
  geocodeCache.set(cacheKey, results)
  return results
```

The `length < 3` guard also means one- and two-character queries never hit Mapbox at all. Autocomplete at one character is noise anyway.

- [ ] **Step 7: Check the caller debounces**

```bash
grep -n -E "debounce|setTimeout" src/hooks/useGlobalLocation.ts src/components/GlobalLocationBar.tsx
```

Expected: a timer of at least 250 ms between keystrokes and the geocode call. If there is none, add one in `GlobalLocationBar.tsx` around the call that runs on input change:

```ts
const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
// in the input onChange handler, replace the direct call with:
if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
searchTimerRef.current = setTimeout(() => runSearch(value), 350)
```

where `runSearch` is whatever function currently performs the lookup.

- [ ] **Step 8: Verify**

```bash
npx tsc -b && npm test && npm run dev
```

In the browser, Network tab filtered to `geocoding`: change location by GPS, then type "Den" and pick Denver. Reload and repeat the exact same actions. Expected: the second time, zero requests to `api.mapbox.com/geocoding`. Labels shown are identical.

- [ ] **Step 9: Commit**

```bash
git add src/lib/location/geocodeCache.ts src/lib/location/__tests__/geocodeCache.test.ts src/services/weatherService.js src/components/GlobalLocationBar.tsx
git commit -m "perf: cache Mapbox geocoding 30 days, skip queries under 3 chars"
```

---

### Task 8: Measure, then set the alarm

- [ ] **Step 1: Deploy**

```bash
git push origin main
```

Vercel deploys from main. Confirm the production URL renders both maps.

- [ ] **Step 2: Compare after seven days**

Open the Mapbox Statistics page. Compare "Map Loads for Web" for the seven days after deploy with the seven days before (from Task 1 Step 5). Expected: loads per active user drop from roughly 4 to 5 per session to roughly 1.3 (everyone loads Conditions; a fraction open Radar). Static Images and Geocoding requests will appear as separate lines and should be well under their free tiers.

- [ ] **Step 3: Write the numbers into the findings log** under a `## Map cost after deploy` heading in `docs/superpowers/reviews/2026-09-22-findings.md`, and commit.

- [ ] **Step 4: Set a monthly calendar reminder** to open the Mapbox Statistics page on the 25th. The free tier is 50,000 loads per month. At about 1.3 loads per session, that covers roughly 38,000 sessions per month before the first dollar. If you get close, the next lever is lazy-mounting the Conditions map only when the radar snapshot panel scrolls into view, which is a small change to `RadarSnapshotPanel` using an `IntersectionObserver`.

---

## What this plan does not change

- Every Edge Function cache TTL (60 s for METAR, TFR, NOTAM, obstruction lists; 30 min for heatmap cells).
- The 15-minute NOTAM sync, the daily obstruction sync, the RainViewer frame set, the 1.5-second pan debounce for map queries.
- The heatmap 15-minute refresh interval while the Radar tab is visible.
- Anything the user can see, except that maps now remember where you left them when you come back to a tab, which is an improvement.
