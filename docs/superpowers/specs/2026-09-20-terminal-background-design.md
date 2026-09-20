# Terminal background for the GIDrone Windows Terminal profile

Date: 2026-09-20

## Goal

Replace the missing `%USERPROFILE%\Pictures\terminal\gidrone.png` with a branded
background whose visual weight sits in the right third, so terminal text on the
left is readable.

## Inputs

- `src/assets/GIDrone-Splash.jpg` (1200x896): the holographic world-map splash
  used by the live app at gi-drone.vercel.app.
- `src/assets/GIDrone4.PNG` (1301x407, RGBA): chrome G.I.DRONE wordmark with
  red/white/blue stripes.
- Palette from `DESIGN_SYSTEM.md`: slate-950 `#020617` base, slate-200
  `#e2e8f0` text, emerald-400 `#34d399` accent. Cyan glow `#38bdf8` matches the
  splash.
- Font: Space Grotesk is the app font; it is not installed locally, so the
  tagline uses the app's declared fallback, Segoe UI (Semibold).

## Composition (2560x1440)

1. Solid slate-950 base.
2. Splash with its top 175px cropped (removes the small centered logo baked into
   it), scaled to 1440px tall, pinned to the right edge.
3. Horizontal alpha mask: fully transparent for x < 500, linear to opaque at
   x = 1500. Left ~40% is flat slate-950.
4. Wordmark scaled to 900px wide, centered at (2000, 640), over a soft cyan glow
   and a darkened halo for contrast.
5. Emerald rule 3px, x 1700..2300, below the wordmark.
6. Tagline `MISSION SAFETY`, letter-spaced, slate-200, centered under the rule.

## Terminal profile changes

Profile `GIDrone` (`{c1a70001-...}`) in Windows Terminal settings:

- `backgroundImageAlignment`: `right`
- `backgroundImageOpacity`: 0.22 -> 0.35
- `backgroundImageStretchMode` stays `uniformToFill`.

## Build

One Pillow script, run once, output written directly to the Pictures path. The
script is not part of the app and lives outside the repo.

## Acceptance

- File exists at the profile path, 2560x1440 PNG.
- Left 1000px of the image is uniform slate-950 (sampled).
- Opening the GIDrone profile shows the map and wordmark on the right only.
