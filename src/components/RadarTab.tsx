import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { Layers, Loader2, MapPin, Pause, Play, Radar, Satellite, Settings, Target } from "lucide-react"

import { useNotams } from "../hooks/useNotams"
import { useTfrs } from "../hooks/useTfrs"
import type { BoundsTuple, NotamFeatureProperties, NotamItem, TfrFeatureProperties } from "../lib/aviation/types"
import type { ThemeMode } from "../lib/theme"

type BaseStyleKey = "streets" | "satellite" | "hybrid"

type SiteLocation = {
  name: string
  lat: number
  lon: number
  siteNumber?: string | null
  city?: string | null
  county?: string | null
  state?: string | null
  structureType?: string | null
  notes?: string | null
  photoUrl?: string | null
  customFields?: Record<string, string> | null
}

type RadarFocusPoint = {
  lat: number
  lon: number
  name?: string | null
}

type RadarFocusBounds = {
  bounds: BoundsTuple
  notamId: string
  name?: string | null
}

type RadarFocusLocation = RadarFocusPoint | RadarFocusBounds

type RadarTabProps = {
  theme: ThemeMode
  focusLocation?: RadarFocusLocation
  defaultCenter?: {
    lat: number
    lon: number
  }
  sites?: SiteLocation[]
}

type RainViewerFrame = { time: number; path: string; host: string; isNowcast: boolean }

const BASE_STYLES: Record<BaseStyleKey, { label: string; style: string }> = {
  streets: { label: "Streets", style: "mapbox://styles/mapbox/streets-v12" },
  satellite: { label: "Satellite", style: "mapbox://styles/mapbox/satellite-v9" },
  hybrid: { label: "Hybrid", style: "mapbox://styles/mapbox/satellite-streets-v12" },
}

const HOUSTON: [number, number] = [-95.3698, 29.7604]
const RADAR_CENTER_KEY = "gi-drone:radar:lastCenter"

const getStoredCenter = (): [number, number] => {
  try {
    const raw = localStorage.getItem(RADAR_CENTER_KEY)
    if (!raw) return HOUSTON
    const [lon, lat] = JSON.parse(raw)
    if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat]
  } catch {}
  return HOUSTON
}

const DEFAULT_CENTER = getStoredCenter()

const EMPTY_TFR_DATA: GeoJSON.FeatureCollection<GeoJSON.Geometry> = {
  type: "FeatureCollection",
  features: [],
}


const TFR_SOURCE_ID = "tfr-zones"
const TFR_FILL_LAYER_ID = "tfr-zones-fill"
const TFR_LINE_LAYER_ID = "tfr-zones-line"
const NOTAM_SOURCE_ID = "notam-zones"
const NOTAM_FILL_LAYER_ID = "notam-zones-fill"
const NOTAM_LINE_LAYER_ID = "notam-zones-line"

const THEMED_STREET_STYLES: Record<ThemeMode, string> = {
  light: "mapbox://styles/mapbox/streets-v12",
  dark: "mapbox://styles/mapbox/dark-v11",
}

const RV_COLOR_SCHEME = 6
const RV_OPTIONS = "1_1"
const RV_DEFAULT_OPACITY = 0.85
const FRAME_INTERVAL_MS = 700
const MORPH_DURATION_MS = 550
const LOOP_PAUSE_MS = 1500

const resolveBaseStyle = (baseStyle: BaseStyleKey, theme: ThemeMode) =>
  baseStyle === "streets" ? THEMED_STREET_STYLES[theme] : BASE_STYLES[baseStyle].style

const buildRvTileUrl = (host: string, path: string) =>
  `${host}${path}/256/{z}/{x}/{y}/${RV_COLOR_SCHEME}/${RV_OPTIONS}.png`

const rvSourceId = (idx: number) => `rv-frame-${idx}`
const rvLayerId = (idx: number) => `rv-layer-${idx}`

const addFrameLayers = (map: mapboxgl.Map, frames: RainViewerFrame[], beforeId?: string) => {
  frames.forEach((frame, idx) => {
    map.addSource(rvSourceId(idx), {
      type: "raster",
      tiles: [buildRvTileUrl(frame.host, frame.path)],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 6,
    })
    map.addLayer(
      {
        id: rvLayerId(idx),
        type: "raster",
        source: rvSourceId(idx),
        paint: { "raster-opacity": 0 },
        layout: { visibility: "visible" },
      },
      beforeId
    )
  })
}

const removeFrameLayers = (map: mapboxgl.Map, count: number) => {
  for (let i = 0; i < count; i++) {
    if (map.getLayer(rvLayerId(i))) map.removeLayer(rvLayerId(i))
    if (map.getSource(rvSourceId(i))) map.removeSource(rvSourceId(i))
  }
}

const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

const morphToFrame = (
  map: mapboxgl.Map,
  fromIdx: number,
  toIdx: number,
  rafRef: MutableRefObject<number | null>,
  opacityRef: MutableRefObject<number>
) => {
  if (rafRef.current !== null) {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }
  const start = performance.now()
  const tick = (now: number) => {
    const opacity = opacityRef.current
    const t = easeInOut(Math.min((now - start) / MORPH_DURATION_MS, 1))
    if (fromIdx !== toIdx && map.getLayer(rvLayerId(fromIdx))) {
      map.setPaintProperty(rvLayerId(fromIdx), "raster-opacity", opacity * (1 - t))
    }
    if (map.getLayer(rvLayerId(toIdx))) {
      map.setPaintProperty(rvLayerId(toIdx), "raster-opacity", opacity * t)
    }
    rafRef.current = t < 1 ? requestAnimationFrame(tick) : null
  }
  rafRef.current = requestAnimationFrame(tick)
}

const getFrameLabel = (frame: RainViewerFrame): string =>
  new Date(frame.time * 1000).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })

const createMarkerElement = () => {
  const element = document.createElement("div")
  element.className =
    "h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-emerald-400/20 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
  return element
}

const makeRing = (
  size: number,
  color: string,
  width: number,
  gapSides: string, // e.g. "borderTopColor" or "borderTopColor,borderRightColor"
  anim: string
): HTMLDivElement => {
  const r = document.createElement("div")
  const offset = -size / 2
  r.style.cssText = [
    `position:absolute`,
    `width:${size}px`,
    `height:${size}px`,
    `top:50%`,
    `left:50%`,
    `margin-top:${offset}px`,
    `margin-left:${offset}px`,
    `border-radius:50%`,
    `border:${width}px solid ${color}`,
    `animation:${anim}`,
    `pointer-events:none`,
  ].join(";")
  gapSides.split(",").forEach((side) => {
    ;(r.style as unknown as Record<string, string>)[side.trim()] = "transparent"
  })
  return r
}

const createOrbitMarker = (
  dotColor: string,
  dotGlow: string,
  rings: { size: number; color: string; width: number; gap: string; anim: string }[]
): HTMLDivElement => {
  const wrap = document.createElement("div")
  wrap.style.cssText = "position:relative;width:1px;height:1px;pointer-events:none;"
  rings.forEach(({ size, color, width, gap, anim }) => {
    wrap.appendChild(makeRing(size, color, width, gap, anim))
  })
  const dot = document.createElement("div")
  dot.style.cssText = [
    `position:absolute`,
    `width:9px`,
    `height:9px`,
    `top:50%`,
    `left:50%`,
    `margin-top:-4.5px`,
    `margin-left:-4.5px`,
    `border-radius:50%`,
    `background:${dotColor}`,
    `box-shadow:0 0 8px ${dotGlow}`,
    `pointer-events:auto`,
  ].join(";")
  wrap.appendChild(dot)
  return wrap
}

const createNotamMarkerElement = () =>
  createOrbitMarker("#38bdf8", "rgba(56,189,248,0.9)", [
    { size: 36, color: "#0ea5e9", width: 1.5, gap: "borderTopColor,borderRightColor", anim: "gi-cw 7s linear infinite" },
    { size: 24, color: "#7dd3fc", width: 1,   gap: "borderBottomColor,borderLeftColor",  anim: "gi-ccw 4.5s linear infinite" },
    { size: 14, color: "#bae6fd", width: 1,   gap: "borderTopColor",                     anim: "gi-cw 2.8s linear infinite" },
  ])

const createTfrMarkerElement = () =>
  createOrbitMarker("#fbbf24", "rgba(251,191,36,0.9)", [
    { size: 38, color: "#f59e0b", width: 1.5, gap: "borderTopColor,borderLeftColor",     anim: "gi-ccw 8s linear infinite" },
    { size: 26, color: "#fde68a", width: 1,   gap: "borderRightColor,borderBottomColor", anim: "gi-cw 5s linear infinite" },
    { size: 15, color: "#fef3c7", width: 1,   gap: "borderBottomColor",                  anim: "gi-ccw 3s linear infinite" },
  ])

const createFocusMarkerElement = () => {
  const element = document.createElement("div")
  element.className =
    "h-5 w-5 rounded-full bg-transparent border-2 border-amber-300 ring-2 ring-amber-300/30 shadow-[0_0_14px_rgba(251,191,36,0.7)] pointer-events-none"
  return element
}

const buildSitePopupHtml = (site: SiteLocation, theme: ThemeMode): string => {
  const isDark = theme === "dark"
  const bg = isDark ? "#0f172a" : "#ffffff"
  const textPrimary = isDark ? "#f1f5f9" : "#0f172a"
  const textSecondary = isDark ? "#94a3b8" : "#64748b"
  const borderColor = isDark ? "#1e293b" : "#e2e8f0"

  const locationParts = [site.city, site.county, site.state].filter(Boolean)
  const location = locationParts.map((v) => escapeHtml(String(v))).join(", ")
  const customEntries = site.customFields
    ? Object.entries(site.customFields).filter(([k, v]) => k.trim() && v.trim())
    : []

  return `
    <div style="font-size:12px;color:${textPrimary};background:${bg};max-width:280px;border-radius:10px;overflow:hidden;line-height:1.5;">
      ${site.photoUrl ? `<img src="${escapeHtml(site.photoUrl)}" alt="Site photo" style="width:100%;height:140px;object-fit:cover;display:block;" />` : ""}
      <div style="padding:12px;">
        <div style="font-weight:700;font-size:13px;">${escapeHtml(site.name)}</div>
        ${site.siteNumber ? `<div style="font-size:11px;color:${textSecondary};margin-top:2px;">#${escapeHtml(site.siteNumber)}</div>` : ""}
        ${location ? `<div style="margin-top:5px;color:${textSecondary};">${location}</div>` : ""}
        ${site.structureType ? `<div style="margin-top:3px;color:${textSecondary};">Type: ${escapeHtml(site.structureType)}</div>` : ""}
        <div style="margin-top:4px;color:${textSecondary};font-size:11px;">${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}</div>
        ${site.notes ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid ${borderColor};font-size:11px;">${escapeHtml(site.notes)}</div>` : ""}
        ${
          customEntries.length
            ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid ${borderColor};">
                ${customEntries
                  .map(
                    ([k, v]) =>
                      `<div style="display:flex;justify-content:space-between;gap:8px;margin-top:3px;font-size:11px;"><span style="color:${textSecondary};">${escapeHtml(k)}</span><span style="text-align:right;">${escapeHtml(v)}</span></div>`
                  )
                  .join("")}
               </div>`
            : ""
        }
      </div>
    </div>
  `
}

const isBoundsFocus = (focusLocation?: RadarFocusLocation): focusLocation is RadarFocusBounds =>
  Boolean(focusLocation && "bounds" in focusLocation)

const featureCentroid = (geometry: GeoJSON.Geometry): [number, number] | null => {
  const ring: number[][] =
    geometry.type === "Polygon" ? geometry.coordinates[0] :
    geometry.type === "MultiPolygon" ? geometry.coordinates[0][0] :
    geometry.type === "Point" ? [geometry.coordinates] :
    []
  if (!ring.length) return null
  const sum = ring.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0])
  return [sum[0] / ring.length, sum[1] / ring.length] as [number, number]
}

const formatPopupTime = (value?: string | null) => {
  if (!value) return "--"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(parsed)
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")

const buildPopupCard = (
  theme: ThemeMode,
  title: string,
  rows: string[],
): string => {
  const isDark = theme === "dark"
  const bg = isDark ? "#0f172a" : "#ffffff"
  const text = isDark ? "#f1f5f9" : "#0f172a"
  const muted = isDark ? "#94a3b8" : "#64748b"
  const border = isDark ? "#1e293b" : "#e2e8f0"
  const closeBg = isDark ? "rgba(30,41,59,0.8)" : "rgba(226,232,240,0.8)"
  const closeHover = isDark ? "#f1f5f9" : "#0f172a"
  return `
    <div style="font-size:12px;color:${text};background:${bg};max-width:300px;border-radius:10px;overflow:hidden;line-height:1.5;font-family:inherit;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 10px 6px 12px;border-bottom:1px solid ${border};">
        <div style="font-weight:700;font-size:13px;padding-right:8px;">${title}</div>
        <button
          onclick="this.closest('.mapboxgl-popup').remove()"
          style="flex-shrink:0;width:20px;height:20px;border-radius:4px;border:none;background:${closeBg};color:${muted};font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;"
          onmouseover="this.style.color='${closeHover}'"
          onmouseout="this.style.color='${muted}'"
        >×</button>
      </div>
      <div style="padding:10px 12px 12px;display:flex;flex-direction:column;gap:4px;">
        ${rows.filter(Boolean).map((r) => `<div style="color:${muted};">${r}</div>`).join("")}
      </div>
    </div>
  `
}

const buildTfrPopupHtml = (properties: Partial<TfrFeatureProperties>, theme: ThemeMode = "dark") => {
  const title = properties.notamId ? escapeHtml(String(properties.notamId)) : "TFR"
  const isDark = theme === "dark"
  const text = isDark ? "#f1f5f9" : "#0f172a"
  const subtitle = [properties.type, properties.facility, properties.state]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" · ")
  const effectiveWindow = `${formatPopupTime(properties.startsAt)} – ${formatPopupTime(properties.endsAt)}`
  const description = properties.description ? escapeHtml(String(properties.description)) : ""
  const fAAUrl =
    typeof properties.detailPageUrl === "string" && properties.detailPageUrl.trim()
      ? properties.detailPageUrl
      : typeof properties.xmlUrl === "string" && properties.xmlUrl.trim()
        ? properties.xmlUrl
        : ""

  const rows = [
    subtitle ? `<span style="color:${text};">${subtitle}</span>` : "",
    `<span><strong style="color:${text};">Effective:</strong> ${escapeHtml(effectiveWindow)}</span>`,
    description,
    fAAUrl ? `<a href="${escapeHtml(fAAUrl)}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;">FAA detail ↗</a>` : "",
  ]
  return buildPopupCard(theme, title, rows)
}

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const asFiniteNumber = (value: unknown) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== "string") return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const asBoolean = (value: unknown) => {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return null

  const normalized = value.trim().toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
  return null
}

const buildCircleGeometry = (
  centerLat: number,
  centerLon: number,
  radiusNm: number
): GeoJSON.Polygon | null => {
  if (
    !Number.isFinite(centerLat) ||
    !Number.isFinite(centerLon) ||
    !Number.isFinite(radiusNm) ||
    radiusNm <= 0
  ) {
    return null
  }

  const earthRadiusNm = 3440.065
  const angularDistance = radiusNm / earthRadiusNm
  const lat1 = (centerLat * Math.PI) / 180
  const lon1 = (centerLon * Math.PI) / 180
  const ring: number[][] = []

  for (let step = 0; step <= 48; step += 1) {
    const bearing = (step / 48) * 2 * Math.PI
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) +
        Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    )
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
      )

    ring.push([
      ((((lon2 * 180) / Math.PI) + 540) % 360) - 180,
      (lat2 * 180) / Math.PI,
    ])
  }

  return {
    type: "Polygon",
    coordinates: [ring],
  }
}

const isGeoJsonGeometry = (value: unknown): value is GeoJSON.Geometry => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const type = (value as { type?: unknown }).type
  return typeof type === "string" && type.length > 0
}

const resolveNotamGeometry = (item: NotamItem): GeoJSON.Geometry | null => {
  if (isGeoJsonGeometry(item.geojson)) {
    return item.geojson
  }

  const featureLat = asFiniteNumber(item.featureLat)
  const featureLon = asFiniteNumber(item.featureLon)
  const centerLat = asFiniteNumber(item.centerLat)
  const centerLon = asFiniteNumber(item.centerLon)
  const radiusNm = asFiniteNumber(item.radiusNm)
  const mapLat = asFiniteNumber(item.mapLat)
  const mapLon = asFiniteNumber(item.mapLon)

  if (
    (item.geomType === "circle" || radiusNm !== null) &&
    centerLat !== null &&
    centerLon !== null &&
    radiusNm !== null
  ) {
    return buildCircleGeometry(centerLat, centerLon, radiusNm)
  }

  if (featureLat !== null && featureLon !== null) {
    return {
      type: "Point",
      coordinates: [featureLon, featureLat],
    }
  }

  if (mapLat !== null && mapLon !== null) {
    return {
      type: "Point",
      coordinates: [mapLon, mapLat],
    }
  }

  return null
}

const buildNotamFeatureCollection = (
  items: NotamItem[]
): GeoJSON.FeatureCollection<GeoJSON.Geometry, NotamFeatureProperties> => ({
  type: "FeatureCollection",
  features: items.flatMap((item, index) => {
    const geometry = resolveNotamGeometry(item)
    if (!geometry) return []

    const notamId =
      asNonEmptyString(item.notamId) ??
      asNonEmptyString(item.id) ??
      `NOTAM ${index + 1}`

    const feature: GeoJSON.Feature<GeoJSON.Geometry, NotamFeatureProperties> = {
      type: "Feature",
      geometry,
      properties: {
        id: asNonEmptyString(item.id) ?? undefined,
        notamId,
        type:
          asNonEmptyString(item.type) ??
          asNonEmptyString(item.category) ??
          asNonEmptyString(item.subtype),
        category: asNonEmptyString(item.category),
        subtype: asNonEmptyString(item.subtype),
        description:
          asNonEmptyString(item.description) ?? asNonEmptyString(item.rawText),
        facility: asNonEmptyString(item.facility),
        facilityCode: asNonEmptyString(item.facilityCode),
        state: asNonEmptyString(item.state),
        location: asNonEmptyString(item.location),
        startsAt: asNonEmptyString(item.startsAt) ?? asNonEmptyString(item.effectiveStart),
        endsAt: asNonEmptyString(item.endsAt) ?? asNonEmptyString(item.effectiveEnd),
        issuedAt: asNonEmptyString(item.issuedAt),
        rawText: asNonEmptyString(item.rawText),
        mapLat: asFiniteNumber(item.mapLat),
        mapLon: asFiniteNumber(item.mapLon),
        structureType: asNonEmptyString(item.structureType),
        structureDesignator: asNonEmptyString(item.structureDesignator),
        structureAsr: asNonEmptyString(item.structureAsr),
        structureHeightFt: asFiniteNumber(item.structureHeightFt),
        structureElevationFt: asFiniteNumber(item.structureElevationFt),
        lightingStatus: asNonEmptyString(item.lightingStatus),
        lightingPresent: asBoolean(item.lightingPresent),
        ownerName: asNonEmptyString(item.ownerName),
      },
    }

    return [feature]
  }),
})

const formatNotamLighting = (properties: Partial<NotamFeatureProperties>) => {
  if (properties.lightingStatus) return String(properties.lightingStatus)
  if (asBoolean(properties.lightingPresent) === true) return "Lighted"
  if (asBoolean(properties.lightingPresent) === false) return "Unlit"
  return ""
}

const buildNotamPopupHtml = (properties: Partial<NotamFeatureProperties>, theme: ThemeMode = "dark") => {
  const title = properties.notamId ? escapeHtml(String(properties.notamId)) : "NOTAM"
  const isDark = theme === "dark"
  const text = isDark ? "#f1f5f9" : "#0f172a"
  const locationLabel = [properties.location, properties.facility, properties.state]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" · ")
  const effectiveWindow = `${formatPopupTime(properties.startsAt)} – ${formatPopupTime(properties.endsAt)}`
  const description = properties.description ? escapeHtml(String(properties.description)) : ""
  const structureHeightFt = asFiniteNumber(properties.structureHeightFt)
  const structureBits = [
    properties.structureType ? `Type: ${properties.structureType}` : null,
    structureHeightFt !== null ? `Height: ${Math.round(structureHeightFt)} ft` : null,
    properties.structureAsr ? `ASR ${properties.structureAsr}` : null,
  ]
    .filter(Boolean)
    .map((v) => escapeHtml(String(v)))
    .join(" · ")
  const lighting = formatNotamLighting(properties)
  const owner = properties.ownerName ? escapeHtml(String(properties.ownerName)) : ""

  const rows = [
    locationLabel ? `<span style="color:${text};">${locationLabel}</span>` : "",
    `<span><strong style="color:${text};">Effective:</strong> ${escapeHtml(effectiveWindow)}</span>`,
    description,
    structureBits ? `<strong style="color:${text};">Structure:</strong> ${structureBits}` : "",
    lighting ? `<strong style="color:${text};">Lighting:</strong> ${escapeHtml(lighting)}` : "",
    owner ? `<strong style="color:${text};">Owner:</strong> ${owner}` : "",
  ]
  return buildPopupCard(theme, title, rows)
}

const ensureTfrLayer = (
  map: mapboxgl.Map,
  data: GeoJSON.FeatureCollection<GeoJSON.Geometry>,
  visible: boolean
) => {
  const existingSource = map.getSource(TFR_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
  if (!existingSource) {
    map.addSource(TFR_SOURCE_ID, { type: "geojson", data })
  } else {
    existingSource.setData(data)
  }

  if (!map.getLayer(TFR_FILL_LAYER_ID)) {
    map.addLayer({
      id: TFR_FILL_LAYER_ID,
      type: "fill",
      source: TFR_SOURCE_ID,
      paint: { "fill-color": "#f59e0b", "fill-opacity": 0.14 },
      layout: { visibility: visible ? "visible" : "none" },
    })
  }
  if (!map.getLayer(TFR_LINE_LAYER_ID)) {
    map.addLayer({
      id: TFR_LINE_LAYER_ID,
      type: "line",
      source: TFR_SOURCE_ID,
      paint: { "line-color": "#fbbf24", "line-width": 2, "line-opacity": 0.95 },
      layout: { visibility: visible ? "visible" : "none" },
    })
  }
}

const ensureNotamLayer = (
  map: mapboxgl.Map,
  data: GeoJSON.FeatureCollection<GeoJSON.Geometry, NotamFeatureProperties>,
  visible: boolean
) => {
  const existingSource = map.getSource(NOTAM_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
  if (!existingSource) {
    map.addSource(NOTAM_SOURCE_ID, { type: "geojson", data })
  } else {
    existingSource.setData(data)
  }

  if (!map.getLayer(NOTAM_FILL_LAYER_ID)) {
    map.addLayer({
      id: NOTAM_FILL_LAYER_ID,
      type: "fill",
      source: NOTAM_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#22d3ee", "fill-opacity": 0.14 },
      layout: { visibility: visible ? "visible" : "none" },
    })
  }
  if (!map.getLayer(NOTAM_LINE_LAYER_ID)) {
    map.addLayer({
      id: NOTAM_LINE_LAYER_ID,
      type: "line",
      source: NOTAM_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "line-color": "#67e8f9", "line-width": 2, "line-opacity": 0.95 },
      layout: { visibility: visible ? "visible" : "none" },
    })
  }
}

const bindTfrInteractions = (
  map: mapboxgl.Map,
  popupRef: MutableRefObject<mapboxgl.Popup | null>,
  boundRef: MutableRefObject<boolean>,
  themeRef: MutableRefObject<ThemeMode>
) => {
  if (boundRef.current) return

  const handleMouseEnter = () => {
    map.getCanvas().style.cursor = "pointer"
  }

  const handleMouseLeave = () => {
    map.getCanvas().style.cursor = ""
  }

  const handleClick = (event: mapboxgl.MapLayerMouseEvent) => {
    const clicked = event.features?.[0]
    if (!clicked || !clicked.properties) return
    const properties = clicked.properties as Partial<TfrFeatureProperties>
    const html = buildTfrPopupHtml(properties, themeRef.current)

    popupRef.current?.remove()
    popupRef.current = new mapboxgl.Popup({ offset: 14, closeButton: false, className: "site-popup" })
      .setLngLat(event.lngLat)
      .setHTML(html)
      .addTo(map)
  }

  map.on("mouseenter", TFR_FILL_LAYER_ID, handleMouseEnter)
  map.on("mouseleave", TFR_FILL_LAYER_ID, handleMouseLeave)
  map.on("mouseenter", TFR_LINE_LAYER_ID, handleMouseEnter)
  map.on("mouseleave", TFR_LINE_LAYER_ID, handleMouseLeave)
  map.on("click", TFR_FILL_LAYER_ID, handleClick)
  map.on("click", TFR_LINE_LAYER_ID, handleClick)

  boundRef.current = true
}

const bindNotamInteractions = (
  map: mapboxgl.Map,
  popupRef: MutableRefObject<mapboxgl.Popup | null>,
  boundRef: MutableRefObject<boolean>,
  themeRef: MutableRefObject<ThemeMode>
) => {
  if (boundRef.current) return

  const handleMouseEnter = () => {
    map.getCanvas().style.cursor = "pointer"
  }

  const handleMouseLeave = () => {
    map.getCanvas().style.cursor = ""
  }

  const handleClick = (event: mapboxgl.MapLayerMouseEvent) => {
    const clicked = event.features?.[0]
    if (!clicked || !clicked.properties) return
    const properties = clicked.properties as Partial<NotamFeatureProperties>
    const html = buildNotamPopupHtml(properties, themeRef.current)

    popupRef.current?.remove()
    popupRef.current = new mapboxgl.Popup({ offset: 14, closeButton: false, className: "site-popup" })
      .setLngLat(event.lngLat)
      .setHTML(html)
      .addTo(map)
  }

  map.on("mouseenter", NOTAM_FILL_LAYER_ID, handleMouseEnter)
  map.on("mouseleave", NOTAM_FILL_LAYER_ID, handleMouseLeave)
  map.on("mouseenter", NOTAM_LINE_LAYER_ID, handleMouseEnter)
  map.on("mouseleave", NOTAM_LINE_LAYER_ID, handleMouseLeave)
  map.on("click", NOTAM_FILL_LAYER_ID, handleClick)
  map.on("click", NOTAM_LINE_LAYER_ID, handleClick)

  boundRef.current = true
}

const applyFocusLocation = (
  map: mapboxgl.Map,
  focusLocation: RadarFocusLocation | undefined,
  focusMarkerRef: MutableRefObject<mapboxgl.Marker | null>,
  theme: ThemeMode = "dark"
) => {
  if (!focusLocation) return

  if (isBoundsFocus(focusLocation)) {
    const [minLon, minLat, maxLon, maxLat] = focusLocation.bounds
    const bounds = new mapboxgl.LngLatBounds([minLon, minLat], [maxLon, maxLat])
    map.fitBounds(bounds, {
      padding: 60,
      maxZoom: 11.5,
      duration: 900,
    })
    if (focusMarkerRef.current) {
      focusMarkerRef.current.remove()
      focusMarkerRef.current = null
    }
    return
  }

  const { lat, lon, name } = focusLocation
  map.flyTo({
    center: [lon, lat],
    zoom: 12.5,
    speed: 1.2,
  })
  const popupHtml = buildPopupCard(theme, escapeHtml(name ?? "Site"), ["Focused site"])
  if (!focusMarkerRef.current) {
    focusMarkerRef.current = new mapboxgl.Marker({
      element: createFocusMarkerElement(),
    })
      .setLngLat([lon, lat])
      .setPopup(new mapboxgl.Popup({ offset: 16, closeButton: false, className: "site-popup" }).setHTML(popupHtml))
      .addTo(map)
  } else {
    focusMarkerRef.current
      .setLngLat([lon, lat])
      .setPopup(new mapboxgl.Popup({ offset: 16, closeButton: false, className: "site-popup" }).setHTML(popupHtml))
  }
}

export function RadarTab({ theme, focusLocation, defaultCenter, sites = [] }: RadarTabProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const notamMarkersRef = useRef<mapboxgl.Marker[]>([])
  const tfrMarkersRef = useRef<mapboxgl.Marker[]>([])
  const focusMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const themeRef = useRef<ThemeMode>(theme)
  const lastDefaultCenterRef = useRef<{ lat: number; lon: number } | null>(null)
  const tfrPopupRef = useRef<mapboxgl.Popup | null>(null)
  const notamPopupRef = useRef<mapboxgl.Popup | null>(null)
  const didRunInitialStyleEffectRef = useRef(false)
  const tfrInteractionsBoundRef = useRef(false)
  const notamInteractionsBoundRef = useRef(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const moveQueryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const radarOpacityRef = useRef(RV_DEFAULT_OPACITY)
  const layersAddedRef = useRef(false)
  const prevFrameIdxRef = useRef(0)
  const frameCountRef = useRef(0)
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null)
  const settingsPopupRef = useRef<HTMLDivElement | null>(null)

  const [baseStyle, setBaseStyle] = useState<BaseStyleKey>(() => {
    const v = localStorage.getItem("gi-drone:radar:baseStyle")
    return (v === "streets" || v === "satellite" || v === "hybrid" ? v : "streets") as BaseStyleKey
  })
  const [showWeather, setShowWeather] = useState(() => localStorage.getItem("gi-drone:radar:showWeather") !== "false")
  const [showTfr, setShowTfr] = useState(() => localStorage.getItem("gi-drone:radar:showTfr") !== "false")
  const [showNotam, setShowNotam] = useState(() => localStorage.getItem("gi-drone:radar:showNotam") !== "false")
  const [showSites, setShowSites] = useState(() => localStorage.getItem("gi-drone:radar:showSites") !== "false")
  const [mapLoaded, setMapLoaded] = useState(false)
  const [rvFrames, setRvFrames] = useState<RainViewerFrame[]>([])
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [radarStatus, setRadarStatus] = useState<"loading" | "ready" | "error">("loading")
  const [radarOpacity, setRadarOpacity] = useState(() => {
    const v = parseFloat(localStorage.getItem("gi-drone:radar:opacity") ?? "")
    return isNaN(v) ? RV_DEFAULT_OPACITY : Math.min(1, Math.max(0, v))
  })
  const [showSettings, setShowSettings] = useState(false)

  const mapboxToken = (
    (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ??
      import.meta.env.VITE_MAPBOX_TOKEN) as string | undefined
  )?.trim()
  const missingToken = !mapboxToken

  const tfrQueryCenter = useMemo(() => {
    if (focusLocation) {
      if (isBoundsFocus(focusLocation)) {
        const [minLon, minLat, maxLon, maxLat] = focusLocation.bounds
        return {
          lat: (minLat + maxLat) / 2,
          lon: (minLon + maxLon) / 2,
        }
      }
      return { lat: focusLocation.lat, lon: focusLocation.lon }
    }

    if (
      defaultCenter &&
      Number.isFinite(defaultCenter.lat) &&
      Number.isFinite(defaultCenter.lon)
    ) {
      return defaultCenter
    }

    return { lat: DEFAULT_CENTER[1], lon: DEFAULT_CENTER[0] }
  }, [defaultCenter, focusLocation])

  // Tracks the map's current center for TFR/NOTAM queries; updates after pan/zoom settles
  const [mapQueryCenter, setMapQueryCenter] = useState(() => ({
    lat: DEFAULT_CENTER[1],
    lon: DEFAULT_CENTER[0],
  }))

  // When focusLocation or defaultCenter changes, snap the query center to match
  useEffect(() => {
    setMapQueryCenter(tfrQueryCenter)
  }, [tfrQueryCenter])

  const tfrs = useTfrs({
    lat: mapQueryCenter.lat,
    lon: mapQueryCenter.lon,
    radiusMiles: 250,
  })
  const notams = useNotams({
    lat: mapQueryCenter.lat,
    lon: mapQueryCenter.lon,
    radiusMiles: 250,
  })
  const tfrGeoJson = tfrs.data?.featureCollection ?? EMPTY_TFR_DATA
  const notamItems = Array.isArray(notams.data?.items) ? notams.data.items : []
  const notamGeoJson = useMemo(() => buildNotamFeatureCollection(notamItems), [notamItems])
  const hasTfrFeatures = tfrGeoJson.features.length > 0
  const nearbyTfrCount = tfrs.data?.items.length ?? 0
  const mappableNotamCount = notamGeoJson.features.length
  const nearbyNotamCount = notamItems.length
  const baseStyleOptions = useMemo(
    () =>
      (Object.keys(BASE_STYLES) as BaseStyleKey[]).map((key) => ({
        key,
        label: BASE_STYLES[key].label,
      })),
    []
  )
  const resolvedBaseStyle = useMemo(() => resolveBaseStyle(baseStyle, theme), [baseStyle, theme])

  const setLayerVisibility = (layerId: string, isVisible: boolean) => {
    const map = mapRef.current
    if (!map || !map.getLayer(layerId)) return
    map.setLayoutProperty(layerId, "visibility", isVisible ? "visible" : "none")
  }

  const syncWeatherOverlay = () => {
    const map = mapRef.current
    if (!map) return
    if (!map.isStyleLoaded()) {
      map.once("style.load", () => { syncWeatherOverlay() })
      return
    }
    if (!layersAddedRef.current) return
    const visibility = showWeather ? "visible" : "none"
    for (let i = 0; i < frameCountRef.current; i++) {
      if (map.getLayer(rvLayerId(i))) {
        map.setLayoutProperty(rvLayerId(i), "visibility", visibility)
      }
    }
  }

  const syncOverlays = () => {
    const map = mapRef.current
    if (!map) return
    if (!map.isStyleLoaded()) {
      map.once("style.load", () => {
        syncOverlays()
      })
      return
    }
    ensureTfrLayer(map, tfrGeoJson, showTfr)
    bindTfrInteractions(map, tfrPopupRef, tfrInteractionsBoundRef, themeRef)
    ensureNotamLayer(map, notamGeoJson, showNotam)
    bindNotamInteractions(map, notamPopupRef, notamInteractionsBoundRef, themeRef)
    syncWeatherOverlay()
    setLayerVisibility(TFR_FILL_LAYER_ID, showTfr)
    setLayerVisibility(TFR_LINE_LAYER_ID, showTfr)
    setLayerVisibility(NOTAM_FILL_LAYER_ID, showNotam)
    setLayerVisibility(NOTAM_LINE_LAYER_ID, showNotam)
    syncNotamMarkers()
    syncTfrMarkers()
  }

  const syncNotamMarkers = () => {
    const map = mapRef.current
    if (!map) return
    notamMarkersRef.current.forEach((m) => m.remove())
    notamMarkersRef.current = []
    if (!showNotam) return
    notamGeoJson.features.forEach((feature) => {
      if (feature.geometry.type !== "Point") return
      const [lon, lat] = (feature.geometry as GeoJSON.Point).coordinates
      const marker = new mapboxgl.Marker({ element: createNotamMarkerElement() })
        .setLngLat([lon, lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 16, closeButton: false, className: "site-popup" }).setHTML(
            buildNotamPopupHtml(feature.properties, theme)
          )
        )
        .addTo(map)
      notamMarkersRef.current.push(marker)
    })
  }

  const syncTfrMarkers = () => {
    const map = mapRef.current
    if (!map) return
    tfrMarkersRef.current.forEach((m) => m.remove())
    tfrMarkersRef.current = []
    if (!showTfr) return
    tfrGeoJson.features.forEach((feature) => {
      const centroid = featureCentroid(feature.geometry)
      if (!centroid) return
      const [lon, lat] = centroid
      const marker = new mapboxgl.Marker({ element: createTfrMarkerElement() })
        .setLngLat([lon, lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 20, closeButton: false, className: "site-popup" }).setHTML(
            buildTfrPopupHtml(feature.properties as Partial<TfrFeatureProperties>, theme)
          )
        )
        .addTo(map)
      tfrMarkersRef.current.push(marker)
    })
  }

  const syncMarkers = () => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []
    if (!showSites) return
    sites.forEach((site) => {
      const el = createMarkerElement()
      el.addEventListener("click", () => {
        applyFocusLocation(map, { lat: site.lat, lon: site.lon, name: site.name }, focusMarkerRef, theme)
      })
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([site.lon, site.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 16, maxWidth: "300px", className: "site-popup" }).setHTML(
            buildSitePopupHtml(site, theme)
          )
        )
        .addTo(map)
      markersRef.current.push(marker)
    })
  }

  // Map initialization
  useEffect(() => {
    if (!mapContainerRef.current || missingToken) return
    mapboxgl.accessToken = mapboxToken
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: resolvedBaseStyle,
      center: [tfrQueryCenter.lon, tfrQueryCenter.lat],
      zoom: 9.2,
      pitch: 30,
      attributionControl: false,
    })

    mapRef.current = map

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right")
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true,
      }),
      "top-right"
    )

    map.on("moveend", () => {
      const c = map.getCenter()
      localStorage.setItem(RADAR_CENTER_KEY, JSON.stringify([c.lng, c.lat]))
      if (moveQueryTimerRef.current) clearTimeout(moveQueryTimerRef.current)
      moveQueryTimerRef.current = setTimeout(() => {
        setMapQueryCenter({ lat: c.lat, lon: c.lng })
      }, 1500)
    })

    map.on("load", () => {
      setMapLoaded(true)
      syncOverlays()
      syncMarkers()
      applyFocusLocation(map, focusLocation, focusMarkerRef, theme)
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      removeFrameLayers(map, frameCountRef.current)
      tfrPopupRef.current?.remove()
      notamPopupRef.current?.remove()
      notamMarkersRef.current.forEach((m) => m.remove())
      notamMarkersRef.current = []
      tfrMarkersRef.current.forEach((m) => m.remove())
      tfrMarkersRef.current = []
      map.remove()
      mapRef.current = null
      focusMarkerRef.current = null
      layersAddedRef.current = false
      setMapLoaded(false)
      didRunInitialStyleEffectRef.current = false
      tfrInteractionsBoundRef.current = false
      notamInteractionsBoundRef.current = false
    }
  }, [missingToken, mapboxToken, resolvedBaseStyle])

  // Style switching
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!didRunInitialStyleEffectRef.current) {
      didRunInitialStyleEffectRef.current = true
      return
    }
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    intervalRef.current = null
    rafRef.current = null
    tfrPopupRef.current?.remove()
    notamPopupRef.current?.remove()
    tfrInteractionsBoundRef.current = false
    notamInteractionsBoundRef.current = false
    layersAddedRef.current = false
    setMapLoaded(false)
    map.once("style.load", () => {
      setMapLoaded(true)
      syncOverlays()
      syncMarkers()
    })
    map.setStyle(resolvedBaseStyle)
  }, [resolvedBaseStyle])

  // Ensure layers exist and data is current
  useEffect(() => {
    syncOverlays()
  }, [tfrGeoJson, notamGeoJson])

  // Dedicated visibility toggles
  useEffect(() => {
    setLayerVisibility(TFR_FILL_LAYER_ID, showTfr)
    setLayerVisibility(TFR_LINE_LAYER_ID, showTfr)
    syncTfrMarkers()
  }, [showTfr, mapLoaded])

  useEffect(() => {
    setLayerVisibility(NOTAM_FILL_LAYER_ID, showNotam)
    setLayerVisibility(NOTAM_LINE_LAYER_ID, showNotam)
    syncNotamMarkers()
  }, [showNotam, mapLoaded])

  useEffect(() => {
    syncWeatherOverlay()
  }, [showWeather, mapLoaded])

  useEffect(() => {
    if (!mapLoaded) return
    syncMarkers()
  }, [showSites, sites, theme, mapLoaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focusLocation) return
    applyFocusLocation(map, focusLocation, focusMarkerRef, theme)
  }, [focusLocation])

  useEffect(() => {
    const map = mapRef.current
    if (!map || focusLocation) return
    if (
      !defaultCenter ||
      !Number.isFinite(defaultCenter.lat) ||
      !Number.isFinite(defaultCenter.lon)
    ) {
      return
    }

    const previousCenter = lastDefaultCenterRef.current
    const hasChanged =
      !previousCenter ||
      Math.abs(previousCenter.lat - defaultCenter.lat) > 1e-7 ||
      Math.abs(previousCenter.lon - defaultCenter.lon) > 1e-7

    if (!hasChanged) return

    lastDefaultCenterRef.current = { lat: defaultCenter.lat, lon: defaultCenter.lon }
    map.easeTo({
      center: [defaultCenter.lon, defaultCenter.lat],
      duration: 900,
      essential: true,
    })
  }, [defaultCenter, focusLocation])

  // Keep themeRef current
  useEffect(() => { themeRef.current = theme }, [theme])

  // Persist radar settings
  useEffect(() => { localStorage.setItem("gi-drone:radar:baseStyle", baseStyle) }, [baseStyle])
  useEffect(() => { localStorage.setItem("gi-drone:radar:showWeather", String(showWeather)) }, [showWeather])
  useEffect(() => { localStorage.setItem("gi-drone:radar:showTfr", String(showTfr)) }, [showTfr])
  useEffect(() => { localStorage.setItem("gi-drone:radar:showNotam", String(showNotam)) }, [showNotam])
  useEffect(() => { localStorage.setItem("gi-drone:radar:showSites", String(showSites)) }, [showSites])
  useEffect(() => { localStorage.setItem("gi-drone:radar:opacity", String(radarOpacity)) }, [radarOpacity])

  // Fetch RainViewer frames on mount
  useEffect(() => {
    let cancelled = false
    const fetchFrames = async () => {
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json")
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: {
          host: string
          radar?: {
            past?: Array<{ time: number; path: string }>
            nowcast?: Array<{ time: number; path: string }>
          }
        } = await res.json()
        if (cancelled) return
        const host = data.host
        const past = (data.radar?.past ?? []).map((f) => ({ ...f, host, isNowcast: false }))
        const nowcast = (data.radar?.nowcast ?? []).map((f) => ({ ...f, host, isNowcast: true }))
        setRvFrames([...past, ...nowcast])
      } catch {
        if (!cancelled) setRadarStatus("error")
      }
    }
    void fetchFrames()
    return () => { cancelled = true }
  }, [])

  // Add frame layers when map + frames ready
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || rvFrames.length === 0 || layersAddedRef.current) return
    frameCountRef.current = rvFrames.length
    addFrameLayers(mapRef.current, rvFrames, TFR_FILL_LAYER_ID)
    if (mapRef.current.getLayer(rvLayerId(0))) {
      mapRef.current.setPaintProperty(rvLayerId(0), "raster-opacity", radarOpacityRef.current)
    }
    layersAddedRef.current = true
    syncWeatherOverlay()
    setRadarStatus("ready")
    setCurrentFrameIdx(0)
    prevFrameIdxRef.current = 0
    setIsPlaying(true)
  }, [mapLoaded, rvFrames])

  // Animation interval
  useEffect(() => {
    if (!isPlaying || rvFrames.length === 0) return
    const advance = () => {
      setCurrentFrameIdx((prev) => {
        const next = prev + 1
        if (next >= rvFrames.length) {
          setIsPlaying(false)
          setTimeout(() => {
            setCurrentFrameIdx(0)
            setIsPlaying(true)
          }, LOOP_PAUSE_MS)
          return prev
        }
        return next
      })
    }
    intervalRef.current = setInterval(advance, FRAME_INTERVAL_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isPlaying, rvFrames.length])

  // Sync frame to map via morphToFrame
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !layersAddedRef.current || rvFrames.length === 0) return
    morphToFrame(mapRef.current, prevFrameIdxRef.current, currentFrameIdx, rafRef, radarOpacityRef)
    prevFrameIdxRef.current = currentFrameIdx
  }, [currentFrameIdx, mapLoaded, rvFrames])

  // Sync opacity on active frame when slider changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !layersAddedRef.current) return
    if (map.getLayer(rvLayerId(currentFrameIdx))) {
      map.setPaintProperty(rvLayerId(currentFrameIdx), "raster-opacity", radarOpacity)
    }
  }, [radarOpacity, currentFrameIdx])

  // Click-outside to close settings popup
  useEffect(() => {
    if (!showSettings) return
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        settingsPopupRef.current?.contains(target) ||
        settingsButtonRef.current?.contains(target)
      ) return
      setShowSettings(false)
    }
    document.addEventListener("mousedown", handleOutsideClick)
    return () => { document.removeEventListener("mousedown", handleOutsideClick) }
  }, [showSettings])

  const currentFrame = rvFrames[currentFrameIdx]

  return (
    <section className="space-y-6">
      <header className="mx-auto flex w-[90%] flex-col gap-2 rounded-3xl border border-slate-800/70 bg-slate-900/60 p-2.5 sm:p-4">
        <div className="min-w-0 space-y-1 text-center">
          <p className="text-[15px] uppercase tracking-[0.35em] text-emerald-300">Radar & Layers</p>
          <h2 className="text-center text-[clamp(1.2rem,3vw,1.7rem)] font-semibold text-white">
            Mission Airspace Overview
          </h2>
          <p className="mx-auto max-w-3xl break-words text-center text-sm text-slate-300">
            Blend live precipitation, active TFRs, mapped NOTAM hazards, and your
            sites in one operational view.
          </p>
        </div>
      </header>

      <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/40">
        <div
          ref={mapContainerRef}
          className="h-[52svh] min-h-[320px] w-full sm:h-[60svh] lg:h-[70svh]"
        />

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />
      </div>

      <div className="mt-3 rounded-2xl border border-slate-800/70 bg-slate-950/80 p-3 backdrop-blur sm:rounded-3xl sm:p-4">

        {/* Overlays row + Settings button */}
        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
          <span className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Overlays
          </span>
          <button
            type="button"
            onClick={() => setShowWeather((prev) => !prev)}
            className={`pointer-events-auto rounded-full border px-3 py-1 transition ${
              showWeather
                ? "border-emerald-400/70 bg-emerald-400/15 text-emerald-200"
                : "border-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            <Radar className="mr-2 inline h-3 w-3" />
            Weather Radar
          </button>
          <button
            type="button"
            onClick={() => setShowTfr((prev) => !prev)}
            className={`pointer-events-auto rounded-full border px-3 py-1 transition ${
              showTfr
                ? "border-amber-300/70 bg-amber-400/15 text-amber-100"
                : "border-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            <Target className="mr-2 inline h-3 w-3" />
            TFR
          </button>
          <button
            type="button"
            onClick={() => setShowNotam((prev) => !prev)}
            className={`pointer-events-auto rounded-full border px-3 py-1 transition ${
              showNotam
                ? "border-cyan-300/70 bg-cyan-400/15 text-cyan-100"
                : "border-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            <Layers className="mr-2 inline h-3 w-3" />
            NOTAM
          </button>
          <button
            type="button"
            onClick={() => setShowSites((prev) => !prev)}
            className={`pointer-events-auto rounded-full border px-3 py-1 transition ${
              showSites
                ? "border-emerald-400/70 bg-emerald-400/15 text-emerald-200"
                : "border-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            <MapPin className="mr-2 inline h-3 w-3" />
            My Sites
          </button>

          {/* Radar animation controls — inline between My Sites and Settings on wide, own row on narrow */}
          <div className="order-last flex w-full shrink-0 items-center gap-2 sm:order-none sm:w-auto">
            <button
              type="button"
              onClick={() => setIsPlaying((prev) => !prev)}
              disabled={radarStatus !== "ready"}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 text-slate-200 transition hover:border-emerald-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={isPlaying ? "Pause radar" : "Play radar"}
            >
              {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
            <div className="flex w-40 shrink-0 items-center gap-[2px] overflow-hidden">
              {rvFrames.map((frame, idx) => (
                <button
                  key={frame.time}
                  type="button"
                  onClick={() => {
                    prevFrameIdxRef.current = currentFrameIdx
                    setCurrentFrameIdx(idx)
                  }}
                  aria-label={`Jump to ${getFrameLabel(frame)}`}
                  className={[
                    "h-1.5 shrink-0 rounded-full transition-all duration-200",
                    frame.isNowcast
                      ? idx === currentFrameIdx
                        ? "w-2 bg-sky-400"
                        : "w-1 bg-sky-500/40 hover:bg-sky-400/60"
                      : idx === currentFrameIdx
                        ? "w-2 bg-emerald-400"
                        : "w-1 bg-slate-600 hover:bg-slate-400",
                  ].join(" ")}
                />
              ))}
              <span className="ml-1.5 shrink-0 text-[10px] tabular-nums tracking-tight text-slate-400">
                {currentFrame ? getFrameLabel(currentFrame) : "--"}
              </span>
            </div>

            {/* Opacity slider */}
            <div className="flex w-40 shrink-0 items-center gap-1">
              <span className="shrink-0 text-[9px] uppercase tracking-[0.15em] text-slate-500">Opacity</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={radarOpacity}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  radarOpacityRef.current = v
                  setRadarOpacity(v)
                }}
                className="flex-1 min-w-0 accent-emerald-400"
                aria-label="Radar opacity"
              />
              <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
                {Math.round(radarOpacity * 100)}%
              </span>
            </div>
          </div>

          {/* Settings button — always anchored top-right of overlays row */}
          <div className="relative ml-auto shrink-0">
            <button
              ref={settingsButtonRef}
              type="button"
              onClick={() => setShowSettings((p) => !p)}
              className={`inline-flex items-center justify-center rounded-full border p-1.5 transition ${
                showSettings
                  ? "border-slate-500 bg-slate-800 text-white"
                  : "border-slate-700 bg-slate-900/70 text-slate-400 hover:text-white"
              }`}
              aria-label="Map settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>

            {showSettings && (
              <div
                ref={settingsPopupRef}
                className="absolute right-0 bottom-full mb-2 z-50 w-64 rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-xl"
              >
                <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                  Map Style
                </p>
                <div className="mb-4 grid grid-cols-3 gap-1.5">
                  {baseStyleOptions.map((style) => (
                    <button
                      key={style.key}
                      type="button"
                      onClick={() => setBaseStyle(style.key)}
                      className={`rounded-full py-1 text-[9px] uppercase tracking-[0.08em] transition ${
                        baseStyle === style.key
                          ? "bg-emerald-400 font-semibold text-slate-950"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Status info row */}
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-3 text-xs text-slate-300">
          <div className="flex items-center gap-2 rounded-full border border-slate-800/70 bg-slate-900/60 px-3 py-1">
            <Satellite className="h-4 w-4 text-slate-400" />
            <span>Geolocate + Zoom controls active</span>
          </div>
          {tfrs.isLoading || tfrs.isRefreshing ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-400/10 px-3 py-1 text-amber-100">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading nearby TFRs...
            </span>
          ) : (
            <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-amber-100">
              {nearbyTfrCount} nearby TFR{nearbyTfrCount === 1 ? "" : "s"}
              {!hasTfrFeatures ? " (no geometry in range)" : ""}
            </span>
          )}
          {notams.isLoading || notams.isRefreshing ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3 py-1 text-cyan-100">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading nearby NOTAMs...
            </span>
          ) : notams.notConfigured ? (
            <span className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-cyan-100">
              NOTAM feed not configured
            </span>
          ) : (
            <span className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-cyan-100">
              {nearbyNotamCount} nearby NOTAM{nearbyNotamCount === 1 ? "" : "s"}
              {nearbyNotamCount > 0 ? ` (${mappableNotamCount} mapped)` : ""}
            </span>
          )}
          {tfrs.error ? (
            <span className="max-w-full break-words rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-rose-200">
              {tfrs.error}
            </span>
          ) : null}
          {notams.error ? (
            <span className="max-w-full break-words rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-rose-200">
              {notams.error}
            </span>
          ) : null}
          {missingToken && (
            <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-amber-200">
              Add VITE_MAPBOX_ACCESS_TOKEN to view the map.
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
