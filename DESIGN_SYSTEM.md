# GI Drone — Design System

A reusable design system extracted from the GIDrone app (React + TypeScript + Vite + Tailwind CSS v3 + Mapbox GL).
Style is **dark-first**, aviation/console-inspired: deep slate surfaces, emerald accents, uppercase micro-labels with wide letter-spacing.

---

## 1. Tech Foundation

| Layer | Choice |
|---|---|
| Framework | React 18 + Vite 6 + TypeScript 5 |
| Styling | Tailwind CSS 3 (`darkMode: "class"`), no custom Tailwind theme — all values come from default palette + arbitrary values |
| Theme switching | `class="dark"` on `<html>` + `data-theme="dark|light"` attribute, persisted to `localStorage` under `gi-drone:theme` |
| Icons | `lucide-react` |
| Animation | `framer-motion` (sparingly); CSS transitions for hover/focus |
| Class composition | Plain string concatenation. `clsx` and `tailwind-merge` are installed but **not used anywhere** — class names are written inline as static strings. |

### Tailwind config (verbatim)

```js
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: { extend: {} },
  plugins: [],
}
```

```js
// postcss.config.js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

The theme is intentionally vanilla — colors and spacing are all default Tailwind values used directly (`bg-slate-950`, `text-emerald-300`, etc.), with arbitrary values for type scale and letter-spacing.

---

## 2. Color Palette

The palette is built almost entirely from Tailwind's `slate` (chrome) and `emerald` (primary accent) ramps, with `rose`/`red` for danger and `amber`/`yellow` for warning.

### 2.1 Core surfaces

| Token | Hex | RGB | Used as |
|---|---|---|---|
| `slate-950` | `#020617` | `2 6 23` | App background, deepest surface |
| `slate-900` | `#0f172a` | `15 23 42` | Card surface, modal body |
| `slate-800` | `#1e293b` | `30 41 59` | Border default |
| `slate-700` | `#334155` | `51 65 85` | Border on lighter chips |
| `slate-500` | `#64748b` | `100 116 139` | Muted text, chevrons |
| `slate-400` | `#94a3b8` | `148 163 184` | Label text |
| `slate-300` | `#cbd5e1` | `203 213 225` | Secondary body text |
| `slate-200` | `#e2e8f0` | `226 232 240` | Body text (interactive) |
| `slate-100` | `#f1f5f9` | `241 245 249` | App foreground (dark mode) |
| `slate-50` | `#f8fafc` | `248 250 252` | Light-mode surface |

### 2.2 Accent — Emerald (primary action / "active" state)

| Token | Hex | Used as |
|---|---|---|
| `emerald-200` | `#a7f3d0` | Pill text on dark accents |
| `emerald-300` | `#6ee7b7` | Hover accent text, scroll-thumb highlight |
| `emerald-400` | `#34d399` | Primary CTA fill, focus ring base |
| `emerald-500` | `#10b981` | Scroll thumb gradient start, ring tinted |
| `emerald-950` | `#022c22` | Light-mode emerald text (`rgb(6 95 70)` via `text-emerald-*` override) |

### 2.3 Status colors

| State | Token | Hex | Common use |
|---|---|---|---|
| Danger | `rose-500` | `#f43f5e` | Destructive border @ `/40` |
| Danger fill | `rose-500/10` | `rgba(244,63,94,.1)` | Danger pill background |
| Danger text | `rose-100` `rose-200` `rose-300` | — | Danger labels |
| Warning | `amber-300` `amber-500/10` `yellow-300/80` | — | Caution chips |
| Info / link | `sky-300` `#7dd3fc` | — | Focus-visible ring on white surfaces |
| Accent alt | `indigo-950/30` `cyan-500/15` `purple-500/30` | — | Atmospheric backgrounds, special map layers |

### 2.4 CSS variables (theme tokens)

From `src/index.css`:

```css
:root {
  --app-bg: rgb(2 6 23);            /* slate-950 */
  --app-fg: rgb(241 245 249);       /* slate-100 */
  --control-surface: rgba(15, 23, 42, 0.9);   /* slate-900/90 */
  --control-border: rgba(51, 65, 85, 0.95);   /* slate-700/95 */
  --control-text: rgb(241 245 249);
  --control-placeholder: rgb(148 163 184);    /* slate-400 */
  --control-chevron: rgb(148 163 184);
  --scroll-track: rgba(15, 23, 42, 0.92);
  --scroll-thumb: rgba(16, 185, 129, 0.88);   /* emerald-500/88 */
  color-scheme: dark;
}

html[data-theme="light"] {
  --app-bg: rgb(241 245 249);                 /* slate-100 */
  --app-fg: rgb(15 23 42);                    /* slate-900 */
  --control-surface: rgba(255, 255, 255, 0.96);
  --control-border: rgba(148, 163, 184, 0.6);
  --control-text: rgb(15 23 42);
  --control-placeholder: rgb(100 116 139);
  --control-chevron: rgb(71 85 105);
  --scroll-track: rgba(226, 232, 240, 0.95);
  --scroll-thumb: rgba(16, 185, 129, 0.82);
  color-scheme: light;
}
```

### 2.5 Light-mode override strategy

Rather than adding `dark:` variants to every class, the app uses **bulk CSS overrides** keyed off `html[data-theme="light"]`. This lets the codebase be written dark-first with no `dark:` prefixes, and the override sheet remaps `bg-slate-950`, `text-white`, `text-emerald-*`, and gradient containers to light equivalents.

```css
html[data-theme="light"] .bg-slate-950,
html[data-theme="light"] .bg-slate-900/95 /* ...and all opacity variants */ {
  background-color: rgba(248, 250, 252, 0.94);
}
html[data-theme="light"] .text-white,
html[data-theme="light"] .text-slate-100,
html[data-theme="light"] .text-slate-200 { color: rgb(15 23 42); }
html[data-theme="light"] .text-emerald-200,
html[data-theme="light"] .text-emerald-300,
html[data-theme="light"] .text-emerald-400 { color: rgb(6 95 70); }  /* emerald-800 */
html[data-theme="light"] .text-rose-200,
html[data-theme="light"] .text-rose-300 { color: rgb(159 18 57); }    /* rose-800 */
html[data-theme="light"] .text-amber-200,
html[data-theme="light"] .text-amber-300 { color: rgb(146 64 14); }   /* amber-800 */
```

(Full override list in `src/index.css` lines 248–377.)

---

## 3. Typography

### 3.1 Font family

```css
:root {
  font-family: "Space Grotesk", "Segoe UI", sans-serif;
  font-size: clamp(15px, 0.18vw + 14.4px, 16px);
}
```

Loaded via Google Fonts at the top of `index.css`:

```css
@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap");
```

Body uses `-webkit-font-smoothing: antialiased` and `text-rendering: optimizeLegibility`.

Headings: `text-wrap: balance; overflow-wrap: anywhere;`

### 3.2 Type scale (frequency-ranked)

| Class | Size | Usage frequency | Role |
|---|---|---|---|
| `text-xs` | `0.75rem / 12px` | 164× | Default body, chips, labels |
| `text-sm` | `0.875rem / 14px` | 105× | Primary body, inputs |
| `text-[11px]` | 11px | 28× | Tag micro-labels |
| `text-[10px]` | 10px | 29× | Smallest pill labels |
| `text-[9px]` | 9px | 7× | Tiny section captions |
| `text-2xl` | `1.5rem` | 6× | Page metric numbers |
| `text-3xl` / `text-4xl` | 1.875 / 2.25rem | small | Page heroes |

**Responsive headings** use `clamp()` arbitrary values:

```jsx
className="text-[clamp(1.65rem,4vw,1.875rem)] font-semibold text-white"
className="text-[clamp(1.2rem,2vw,1.25rem)] font-semibold text-white"
className="text-[clamp(2rem,4vw,3rem)] font-semibold text-slate-900 dark:text-white"
```

### 3.3 Weight + tracking conventions

- Body weight: regular (default).
- Emphasis weight: **`font-semibold`** (used 137× — the only emphasis weight). `font-medium` appears 6×, `font-bold` is absent.
- **Section labels** are almost always `uppercase` + wide tracking. The signature pattern:

```jsx
className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400"
```

Tracking values (frequency-ranked):
- `tracking-[0.3em]` — 42× (default for uppercase labels)
- `tracking-[0.2em]` — 19× (compact buttons)
- `tracking-[0.18em]` — 13×
- `tracking-[0.4em]` — 8× (decorative emerald subtitles)
- `tracking-[0.35em]` — 7×

> **Rule of thumb:** every uppercase label gets a tracking arbitrary value between `0.15em` and `0.45em`. Tighter tracking = more compact button; looser = decorative caption.

---

## 4. Spacing & Sizing

### 4.1 Padding scale (frequency-ranked)

| Class | Value | Frequency |
|---|---|---|
| `px-4` | `1rem` | 93× |
| `py-2` | `0.5rem` | 67× |
| `px-3` | `0.75rem` | 74× |
| `py-3` | `0.75rem` | 48× |
| `p-4` | `1rem` | 43× |
| `py-1` | `0.25rem` | 35× |
| `p-3` | `0.75rem` | 20× |
| `p-6` | `1.5rem` | 15× |

Standard pairings:
- **Pill / chip:** `px-3 py-1` or `px-4 py-2`
- **Input:** `px-4 py-3` (rounded-2xl) or `px-3 py-2` (rounded-xl)
- **Card body:** `p-4` (compact) or `p-6` (spacious)
- **CTA button:** `px-5 py-3` or `px-6 py-3`

### 4.2 Gap scale

| Class | Frequency | When |
|---|---|---|
| `gap-2` | 86× | Default inline spacing (icon + label) |
| `gap-3` | 41× | Card header rows |
| `gap-4` | 21× | Section-level separation |
| `gap-6` | 7× | Major layout |
| `gap-1.5` / `gap-1` | 8× / 5× | Tight icon pairs |

### 4.3 Border radius

| Class | Value | Frequency | Role |
|---|---|---|---|
| `rounded-full` | 9999px | 83× | Pills, chips, primary CTAs, icon buttons |
| `rounded-2xl` | 1rem | 80× | **Default card / input** |
| `rounded-xl` | 0.75rem | 39× | Inner cards, compact inputs |
| `rounded-3xl` | 1.5rem | 24× | Hero panels, page-level containers |
| `rounded-lg` | 0.5rem | 8× | Rare, mostly icon tiles |

> **Convention:** outer container = `rounded-3xl`, mid-level card = `rounded-2xl`, inner tile = `rounded-xl`, chip/button = `rounded-full`.

### 4.4 Borders

Almost every surface has a 1px border. The default is `border border-slate-800` (88×). Lighter chips use `border-slate-700` (34×). Subtle opacity variants like `border-slate-800/80` appear on layered surfaces.

### 4.5 Shadows

Used sparingly — surface elevation comes from border + background opacity, not box-shadow.

- `shadow-2xl` — 11× (top-level panels, modals)
- `shadow-xl` — 6× (auth card)

---

## 5. Reusable Component Patterns

### 5.1 Card (default surface)

```jsx
<div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
  {/* content */}
</div>
```

Section variant with header label:

```jsx
<section className="min-w-0 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4">
  <div className="min-w-0 space-y-2">
    <p className="whitespace-nowrap text-center text-[clamp(0.52rem,0.82vw,0.8rem)] font-semibold uppercase tracking-[0.16em] text-emerald-200">
      Section Label
    </p>
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h4 className="min-w-0 text-sm font-semibold leading-none tracking-tight text-white">
        Card Title
      </h4>
    </div>
  </div>
  <div className="mt-4">{/* body */}</div>
</section>
```

### 5.2 Hero panel (gradient container)

```jsx
<div className="rounded-3xl border border-slate-800/70 bg-gradient-to-br from-slate-950/70 via-slate-900/60 to-slate-950/80 p-6 md:py-7">
  {/* hero content */}
</div>
```

Variant accents (status-tinted gradients):

```jsx
// info
className="bg-gradient-to-br from-indigo-950/30 via-slate-900/50 to-slate-950/70"
// success
className="bg-gradient-to-br from-emerald-950/70 via-slate-900 to-slate-950"
// warning
className="bg-gradient-to-br from-amber-950/60 via-slate-900 to-slate-950"
// danger
className="bg-gradient-to-br from-rose-950/80 via-slate-900 to-slate-950"
```

Each has a `light` mode mapping in `index.css`.

### 5.3 Buttons

#### Primary CTA (emerald fill, dark text)

```jsx
<button className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-400 px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
  Submit
</button>
```

#### Secondary (outline)

```jsx
<button className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300 transition hover:border-slate-200 hover:text-white">
  Cancel
</button>
```

#### Accent secondary (emerald outline)

```jsx
<button className="rounded-2xl border border-emerald-400/50 bg-emerald-400/10 px-6 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100 transition hover:border-emerald-300 hover:text-white">
  Connect
</button>
```

#### Destructive

```jsx
<button className="flex items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-100 transition hover:bg-rose-500/20">
  Delete
</button>
```

#### Icon button (round)

```jsx
<button className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 text-slate-200 transition hover:border-emerald-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
  <Icon className="h-3.5 w-3.5" />
</button>
```

#### Tab / pill toggle

```jsx
<button className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-emerald-300/60 hover:text-white">
  Filter
</button>
```

### 5.4 Inputs

Default text input:

```jsx
<label className="block text-left text-xs text-slate-400">
  Email
  <input
    type="email"
    className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-200"
  />
</label>
```

Input with focus ring (preferred for forms):

```jsx
<input className="h-11 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30" />
```

Compact input (`rounded-xl`):

```jsx
<input className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200" />
```

Select chevron is custom-drawn via CSS (`html select:not([multiple]):not([size])` in `index.css`) using two linear-gradient triangles — no SVG needed.

### 5.5 Pills / chips / tags

```jsx
{/* Border-only pill */}
<span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-400">
  Status
</span>

{/* Danger pill */}
<span className="max-w-full break-words rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-rose-200">
  Alert
</span>

{/* Accent pill */}
<span className="rounded-full border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.35em] text-emerald-100">
  Live
</span>
```

### 5.6 Modal / overlay

Standard z-stack: `z-40` for primary modal, `z-50` for elevated, `z-[60]` for nested.

```jsx
{/* Overlay */}
<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 sm:items-center sm:py-8">
  {/* Modal body */}
  <div className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl">
    {/* content */}
  </div>
</div>
```

With backdrop blur:

```jsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
```

Bottom-sheet on mobile, side-panel on desktop:

```jsx
<div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 px-4 py-4 md:items-stretch md:justify-end md:px-0 md:py-0">
```

A small-screen affordance in `index.css` lets fullscreen modals scroll naturally on mobile:

```css
@media (max-width: 640px) {
  .fixed.inset-0.z-40,
  .fixed.inset-0.z-50,
  .fixed.inset-0.z-\[60\] {
    align-items: flex-start;
    overflow-y: auto;
    padding-block: 1rem;
  }
}
```

### 5.7 Atmospheric backgrounds

The auth screen uses radial gradients + blurred color blobs for an ambient feel:

```jsx
<div className="min-h-screen bg-slate-950 text-slate-100">
  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.9),_transparent_60%)]" />
  <div className="pointer-events-none absolute -left-32 top-20 h-80 w-80 rounded-full bg-emerald-500/15 blur-[140px]" />
  <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-cyan-500/15 blur-[160px]" />
  <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
    {/* content */}
  </main>
</div>
```

Grid background pattern overlay:

```jsx
<div className="fixed inset-0 opacity-10 [background-image:linear-gradient(rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.14)_1px,transparent_1px)] [background-size:42px_42px]" />
```

### 5.8 List rows (dividers, no borders)

```jsx
<div className="divide-y divide-slate-800">
  <div className="group grid gap-4 px-4 py-4 text-xs text-slate-300 transition hover:bg-slate-900/40">
    {/* row */}
  </div>
</div>
```

---

## 6. Theme System

### 6.1 Theme hook (drop-in)

```ts
// src/lib/theme.ts
export type ThemeMode = "light" | "dark"

const STORAGE_KEY = "gi-drone:theme"

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark"
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === "light" || v === "dark" ? v : "dark"
}

export function storeTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, mode)
}

export function applyTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return
  const root = document.documentElement
  const isDark = mode === "dark"
  root.classList.toggle("dark", isDark)
  root.dataset.theme = isDark ? "dark" : "light"
  root.style.colorScheme = isDark ? "dark" : "light"
}
```

Usage:

```tsx
const [theme, setTheme] = useState<ThemeMode>(getStoredTheme)
useEffect(() => { applyTheme(theme); storeTheme(theme) }, [theme])
```

> **Note:** the codebase sets BOTH `class="dark"` and `data-theme="dark"`. Tailwind keys off the class; the bulk CSS overrides key off the attribute. Keep both in sync.

### 6.2 Bulk light-mode override sheet

When porting to another project, copy the override blocks in `src/index.css` lines 248–377. They mean you can write components as if they're dark-only (`bg-slate-950`, `text-white`) and the sheet remaps them on `html[data-theme="light"]`.

---

## 7. Custom Scrollbar

Branded scrollbar across all elements:

```css
html {
  scrollbar-width: thin;
  scrollbar-color: var(--scroll-thumb) var(--scroll-track);
}

*::-webkit-scrollbar { width: 10px; height: 10px; }

*::-webkit-scrollbar-track {
  border-radius: 9999px;
  background: var(--scroll-track);
  border: 1px solid rgba(30, 41, 59, 0.9);
}

*::-webkit-scrollbar-thumb {
  border-radius: 9999px;
  border: 2px solid var(--scroll-track);
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.72), rgba(52, 211, 153, 0.96));
}

*::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(90deg, rgba(52, 211, 153, 0.84), rgba(110, 231, 183, 0.98));
}
```

---

## 8. Custom Components

### 8.1 `AviationTile` — labeled inner section

Tile with an uppercase emerald caption above a white title and slot for a right-aligned control.

```tsx
// src/components/AviationTile.tsx (verbatim shape)
interface Props {
  label: string
  title: string
  rightHeaderSlot?: React.ReactNode
  children: React.ReactNode
}

function AviationTile({ label, title, rightHeaderSlot, children }: Props) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4">
      <div className="min-w-0 space-y-2">
        <p className="whitespace-nowrap text-center text-[clamp(0.52rem,0.82vw,0.8rem)] font-semibold uppercase tracking-[0.16em] text-emerald-200">
          {label}
        </p>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h4 className="min-w-0 text-sm font-semibold leading-none tracking-tight text-white">
            {title}
          </h4>
          {rightHeaderSlot ? <div className="shrink-0">{rightHeaderSlot}</div> : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}
```

### 8.2 Radar timeline slider (themed range input)

A custom-drawn `<input type="range">` with a drone-shaped SVG thumb. The full CSS lives in `src/index.css` under `.radar-timeline-slider`. Key bits:

```css
.radar-timeline-slider {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
}

.radar-timeline-slider::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 9999px;
  border: 1px solid rgba(148, 163, 184, 0.55);
  background: rgba(148, 163, 184, 0.38);
}

.radar-timeline-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 30px;
  height: 30px;
  background-image: url("data:image/svg+xml,...drone svg...");
  /* See index.css line 213 for the full inline SVG */
}

.radar-timeline-slider::-moz-range-progress {
  height: 6px;
  border-radius: 9999px;
  background: linear-gradient(90deg, rgba(52,211,153,.95), rgba(16,185,129,.95));
}
```

### 8.3 Mapbox popup themes

Two custom popup classes that strip Mapbox's default white card so an inner div can be the styled surface:

```css
.site-popup .mapboxgl-popup-content {
  padding: 0;
  background: transparent;
  box-shadow: none;
  border-radius: 10px;
  overflow: hidden;
}
.site-popup .mapboxgl-popup-tip { display: none; }

.tfr-detail-popup .mapboxgl-popup-content {
  padding: 0;
  background: transparent;
  box-shadow: none;
  border-radius: 10px;
  overflow: visible;
}
.tfr-detail-popup .mapboxgl-popup-tip { border-bottom-color: #0f172a; }
html[data-theme="light"] .tfr-detail-popup .mapboxgl-popup-tip {
  border-bottom-color: #ffffff;
}
```

### 8.4 Radar marker ring animations

```css
@keyframes gi-cw  { to { transform: rotate(360deg);  } }
@keyframes gi-ccw { to { transform: rotate(-360deg); } }
```

Apply with inline style: `animation: gi-cw 6s linear infinite`.

---

## 9. Accessibility & Polish

- Form elements inherit fonts globally: `button, input, textarea, select { font: inherit; }`
- Buttons reset native appearance: `button { appearance: none; -webkit-appearance: none; background-image: none; }`
- Autofill is themed to match dark surfaces via `:-webkit-autofill` rules (lines 158–167 of `index.css`).
- Global `accent-color: rgb(52 211 153)` (emerald-400) themes checkboxes, radios, and native range tracks.
- `meta name="theme-color" content="#020617"` (`slate-950`) — matches app background on iOS/Android URL bars.
- All headings get `text-wrap: balance` + `overflow-wrap: anywhere`.

---

## 10. Quick-copy starter

Drop the snippets below into a new Vite + React + Tailwind project to bootstrap the look.

### `tailwind.config.js`

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

### `src/index.css` (minimal seed)

```css
@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap");
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: "Space Grotesk", "Segoe UI", sans-serif;
  font-size: clamp(15px, 0.18vw + 14.4px, 16px);
  --app-bg: rgb(2 6 23);
  --app-fg: rgb(241 245 249);
  --scroll-track: rgba(15, 23, 42, 0.92);
  --scroll-thumb: rgba(16, 185, 129, 0.88);
  color-scheme: dark;
}

html { background-color: var(--app-bg); color: var(--app-fg); accent-color: rgb(52 211 153); }
body { background-color: var(--app-bg); color: var(--app-fg); -webkit-font-smoothing: antialiased; }

button, input, textarea, select { font: inherit; }
button { appearance: none; -webkit-appearance: none; background-image: none; }

*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-track { border-radius: 9999px; background: var(--scroll-track); }
*::-webkit-scrollbar-thumb {
  border-radius: 9999px;
  background: linear-gradient(90deg, rgba(16,185,129,.72), rgba(52,211,153,.96));
}
```

### Reusable className constants

```ts
// src/lib/styles.ts — drop-in class constants
export const surface = {
  card:    "rounded-2xl border border-slate-800 bg-slate-950/70 p-4",
  inner:   "rounded-xl border border-slate-800 bg-slate-950/50 p-3",
  hero:    "rounded-3xl border border-slate-800/70 bg-gradient-to-br from-slate-950/70 via-slate-900/60 to-slate-950/80 p-6",
  section: "rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4",
}

export const text = {
  label:    "text-xs font-semibold uppercase tracking-[0.3em] text-slate-400",
  caption:  "text-[11px] uppercase tracking-[0.2em] text-slate-500",
  accent:   "text-xs uppercase tracking-[0.4em] text-emerald-300",
  body:     "text-sm text-slate-300",
  bodyDim:  "text-xs text-slate-400",
  heading:  "text-[clamp(1.65rem,4vw,1.875rem)] font-semibold text-white",
}

export const button = {
  primary:   "flex items-center justify-center gap-2 rounded-full bg-emerald-400 px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400",
  secondary: "rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300 transition hover:border-slate-200 hover:text-white",
  accent:    "rounded-2xl border border-emerald-400/50 bg-emerald-400/10 px-6 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100 transition hover:border-emerald-300 hover:text-white",
  danger:    "flex items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-100 transition hover:bg-rose-500/20",
  icon:      "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 text-slate-200 transition hover:border-emerald-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40",
}

export const input = {
  default: "w-full rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-200",
  ring:    "h-11 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30",
  compact: "w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200",
}

export const pill = {
  outline: "rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-400",
  accent:  "rounded-full border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.35em] text-emerald-100",
  danger:  "rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-rose-200",
}

export const modal = {
  overlay: "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 sm:items-center sm:py-8",
  body:    "w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl",
}
```

---

## 11. Design DNA — one-paragraph summary

Dark cockpit aesthetic: **`slate-950` background → `slate-900/60-70` cards → `slate-800` 1px borders**. Single accent color (**emerald-400** for primary, **emerald-300** for hover, **emerald-200/100** for text on accent fills). Status colors are rose (danger) and amber (warning), always at 10% fill + 40% border tint. Type is **Space Grotesk**, body is `text-xs`/`text-sm`, headings use `clamp()` arbitrary values, and every micro-label is `uppercase font-semibold tracking-[0.2em–0.4em]`. Radius hierarchy: outer = `rounded-3xl`, card = `rounded-2xl`, inner = `rounded-xl`, chip = `rounded-full`. Transitions are CSS-only on `hover:border-*` + `hover:text-*`. Light mode is a bulk CSS override sheet keyed on `html[data-theme="light"]` — components never need `dark:` prefixes.
