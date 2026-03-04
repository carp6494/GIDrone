import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { Layers, Loader2, MapPin, Radar, Satellite, Target } from "lucide-react"

import { useNotams } from "../hooks/useNotams"
import { useTfrs } from "../hooks/useTfrs"
import type { BoundsTuple, NotamFeatureProperties, NotamItem, TfrFeatureProperties } from "../lib/aviation/types"
import type { ThemeMode } from "../lib/theme"

type BaseStyleKey = "streets" | "satellite" | "hybrid"

type SiteLocation = {
  name: string
  lat: number
  lon: number
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
}

const BASE_STYLES: Record<BaseStyleKey, { label: string; style: string }> = {
  streets: { label: "Streets", style: "mapbox://styles/mapbox/streets-v12" },
  satellite: { label: "Satellite", style: "mapbox://styles/mapbox/satellite-v9" },
  hybrid: { label: "Hybrid", style: "mapbox://styles/mapbox/satellite-streets-v12" },
}

const DEFAULT_CENTER: [number, number] = [-95.3698, 29.7604]

const EMPTY_TFR_DATA: GeoJSON.FeatureCollection<GeoJSON.Geometry> = {
  type: "FeatureCollection",
  features: [],
}

const FLIGHT_SITES: SiteLocation[] = [
  { name: "Bayou Launch", lat: 29.745, lon: -95.38 },
  { name: "Port Mobility", lat: 29.71, lon: -95.28 },
  { name: "River Bend", lat: 29.81, lon: -95.42 },
]

const TFR_SOURCE_ID = "tfr-zones"
const TFR_FILL_LAYER_ID = "tfr-zones-fill"
const TFR_LINE_LAYER_ID = "tfr-zones-line"
const NOTAM_SOURCE_ID = "notam-zones"
const NOTAM_FILL_LAYER_ID = "notam-zones-fill"
const NOTAM_LINE_LAYER_ID = "notam-zones-line"
const NOTAM_POINT_LAYER_ID = "notam-zones-point"
const WEATHER_SOURCE_IDS = ["weather-radar-a", "weather-radar-b"] as const
const WEATHER_LAYER_IDS = ["weather-radar-layer-a", "weather-radar-layer-b"] as const
const WEATHER_LAYER_OPACITY = 0.6
const RADAR_INTERPOLATION_STEPS = 4
const RADAR_INTERPOLATION_STEP_MS = 180
const RADAR_MAX_FRAMES = 36
const RAIN_VIEWER_INDEX_URL = "https://api.rainviewer.com/public/weather-maps.json"
const RAIN_VIEWER_DEFAULT_HOST = "https://tilecache.rainviewer.com"
const THEMED_STREET_STYLES: Record<ThemeMode, string> = {
  light: "mapbox://styles/mapbox/streets-v12",
  dark: "mapbox://styles/mapbox/dark-v11",
}

const resolveBaseStyle = (baseStyle: BaseStyleKey, theme: ThemeMode) =>
  baseStyle === "streets" ? THEMED_STREET_STYLES[theme] : BASE_STYLES[baseStyle].style

type RainViewerFrame = {
  host: string
  path: string
  time: number
}

type RainViewerResponse = {
  host?: unknown
  radar?: {
    past?: Array<{
      path?: unknown
      time?: unknown
    }>
    nowcast?: Array<{
      path?: unknown
      time?: unknown
    }>
  }
}

const createMarkerElement = () => {
  const element = document.createElement("div")
  element.className =
    "h-3 w-3 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20 shadow-[0_0_12px_rgba(52,211,153,0.8)]"
  return element
}

const createFocusMarkerElement = () => {
  const element = document.createElement("div")
  element.className =
    "h-4 w-4 rounded-full bg-amber-300 ring-4 ring-amber-300/30 shadow-[0_0_16px_rgba(251,191,36,0.9)]"
  return element
}

const isBoundsFocus = (focusLocation?: RadarFocusLocation): focusLocation is RadarFocusBounds =>
  Boolean(focusLocation && "bounds" in focusLocation)

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

const buildTfrPopupHtml = (properties: Partial<TfrFeatureProperties>) => {
  const title = properties.notamId ? escapeHtml(String(properties.notamId)) : "TFR"
  const subtitle = [properties.type, properties.facility, properties.state]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" | ")
  const description = properties.description ? escapeHtml(String(properties.description)) : ""
  const effectiveWindow = `${formatPopupTime(properties.startsAt)} to ${formatPopupTime(
    properties.endsAt
  )}`
  const fAAUrl =
    typeof properties.detailPageUrl === "string" && properties.detailPageUrl.trim()
      ? properties.detailPageUrl
      : typeof properties.xmlUrl === "string" && properties.xmlUrl.trim()
        ? properties.xmlUrl
        : ""

  return `
    <div style="font-size:12px;color:#0f172a;max-width:300px;line-height:1.4;">
      <div style="font-weight:700;font-size:13px;">${title}</div>
      ${subtitle ? `<div style="margin-top:2px;color:#334155;">${subtitle}</div>` : ""}
      <div style="margin-top:6px;"><strong>Effective:</strong> ${escapeHtml(effectiveWindow)}</div>
      ${description ? `<div style="margin-top:6px;">${description}</div>` : ""}
      ${
        fAAUrl
          ? `<div style="margin-top:8px;"><a href="${escapeHtml(
              fAAUrl
            )}" target="_blank" rel="noopener noreferrer">FAA detail</a></div>`
          : ""
      }
    </div>
  `
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

const buildNotamPopupHtml = (properties: Partial<NotamFeatureProperties>) => {
  const title = properties.notamId ? escapeHtml(String(properties.notamId)) : "NOTAM"
  const locationLabel = [properties.location, properties.facility, properties.state]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" | ")
  const effectiveWindow = `${formatPopupTime(properties.startsAt)} to ${formatPopupTime(
    properties.endsAt
  )}`
  const description = properties.description ? escapeHtml(String(properties.description)) : ""
  const structureHeightFt = asFiniteNumber(properties.structureHeightFt)
  const structureBits = [
    properties.structureType ? `Type: ${properties.structureType}` : null,
    structureHeightFt !== null ? `Height: ${Math.round(structureHeightFt)} ft` : null,
    properties.structureAsr ? `ASR ${properties.structureAsr}` : null,
  ]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" | ")
  const lighting = formatNotamLighting(properties)
  const owner = properties.ownerName ? escapeHtml(String(properties.ownerName)) : ""

  return `
    <div style="font-size:12px;color:#0f172a;max-width:320px;line-height:1.4;">
      <div style="font-weight:700;font-size:13px;">${title}</div>
      ${
        locationLabel
          ? `<div style="margin-top:2px;color:#334155;">${locationLabel}</div>`
          : ""
      }
      <div style="margin-top:6px;"><strong>Effective:</strong> ${escapeHtml(effectiveWindow)}</div>
      ${description ? `<div style="margin-top:6px;">${description}</div>` : ""}
      ${
        structureBits
          ? `<div style="margin-top:6px;"><strong>Structure:</strong> ${structureBits}</div>`
          : ""
      }
      ${
        lighting
          ? `<div style="margin-top:6px;"><strong>Lighting:</strong> ${escapeHtml(lighting)}</div>`
          : ""
      }
      ${
        owner
          ? `<div style="margin-top:6px;"><strong>Owner:</strong> ${owner}</div>`
          : ""
      }
    </div>
  `
}

const buildRadarTileTemplate = (frame: RainViewerFrame) =>
  `${frame.host}${frame.path}/256/{z}/{x}/{y}/6/1_1.png`

const removeWeatherSlot = (map: mapboxgl.Map, slot: 0 | 1) => {
  const layerId = WEATHER_LAYER_IDS[slot]
  const sourceId = WEATHER_SOURCE_IDS[slot]
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId)
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId)
  }
}

const mountWeatherSlot = (
  map: mapboxgl.Map,
  slot: 0 | 1,
  frame: RainViewerFrame,
  opacity: number,
  isVisible: boolean
) => {
  const layerId = WEATHER_LAYER_IDS[slot]
  const sourceId = WEATHER_SOURCE_IDS[slot]
  removeWeatherSlot(map, slot)

  map.addSource(sourceId, {
    type: "raster",
    tiles: [buildRadarTileTemplate(frame)],
    tileSize: 256,
  })
  map.addLayer({
    id: layerId,
    type: "raster",
    source: sourceId,
    layout: {
      visibility: isVisible ? "visible" : "none",
    },
    paint: {
      "raster-opacity": opacity,
      "raster-opacity-transition": { duration: 0, delay: 0 },
    },
  })
}

const setWeatherLayerOpacity = (map: mapboxgl.Map, slot: 0 | 1, opacity: number) => {
  const layerId = WEATHER_LAYER_IDS[slot]
  if (!map.getLayer(layerId)) return
  map.setPaintProperty(
    layerId,
    "raster-opacity",
    Math.max(0, Math.min(opacity, WEATHER_LAYER_OPACITY))
  )
}

const setWeatherLayerVisibility = (map: mapboxgl.Map, isVisible: boolean) => {
  WEATHER_LAYER_IDS.forEach((layerId) => {
    if (!map.getLayer(layerId)) return
    map.setLayoutProperty(layerId, "visibility", isVisible ? "visible" : "none")
  })
}

const ensureTfrLayer = (
  map: mapboxgl.Map,
  data: GeoJSON.FeatureCollection<GeoJSON.Geometry>
) => {
  const existingSource = map.getSource(TFR_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
  if (!existingSource) {
    map.addSource(TFR_SOURCE_ID, {
      type: "geojson",
      data,
    })
  } else {
    existingSource.setData(data)
  }

  if (!map.getLayer(TFR_FILL_LAYER_ID)) {
    map.addLayer({
      id: TFR_FILL_LAYER_ID,
      type: "fill",
      source: TFR_SOURCE_ID,
      paint: {
        "fill-color": "#f59e0b",
        "fill-opacity": 0.14,
      },
    })
  }
  if (!map.getLayer(TFR_LINE_LAYER_ID)) {
    map.addLayer({
      id: TFR_LINE_LAYER_ID,
      type: "line",
      source: TFR_SOURCE_ID,
      paint: {
        "line-color": "#fbbf24",
        "line-width": 2,
        "line-opacity": 0.95,
      },
    })
  }
}

const ensureNotamLayer = (
  map: mapboxgl.Map,
  data: GeoJSON.FeatureCollection<GeoJSON.Geometry, NotamFeatureProperties>
) => {
  const existingSource = map.getSource(NOTAM_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
  if (!existingSource) {
    map.addSource(NOTAM_SOURCE_ID, {
      type: "geojson",
      data,
    })
  } else {
    existingSource.setData(data)
  }

  if (!map.getLayer(NOTAM_FILL_LAYER_ID)) {
    map.addLayer({
      id: NOTAM_FILL_LAYER_ID,
      type: "fill",
      source: NOTAM_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": "#22d3ee",
        "fill-opacity": 0.14,
      },
    })
  }
  if (!map.getLayer(NOTAM_LINE_LAYER_ID)) {
    map.addLayer({
      id: NOTAM_LINE_LAYER_ID,
      type: "line",
      source: NOTAM_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": "#67e8f9",
        "line-width": 2,
        "line-opacity": 0.95,
      },
    })
  }
  if (!map.getLayer(NOTAM_POINT_LAYER_ID)) {
    map.addLayer({
      id: NOTAM_POINT_LAYER_ID,
      type: "circle",
      source: NOTAM_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 6,
        "circle-color": "#22d3ee",
        "circle-stroke-color": "#cffafe",
        "circle-stroke-width": 1.5,
        "circle-opacity": 0.92,
      },
    })
  }
}

const bindTfrInteractions = (
  map: mapboxgl.Map,
  popupRef: MutableRefObject<mapboxgl.Popup | null>,
  boundRef: MutableRefObject<boolean>
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
    const html = buildTfrPopupHtml(properties)

    popupRef.current?.remove()
    popupRef.current = new mapboxgl.Popup({ offset: 14, closeButton: true })
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
  boundRef: MutableRefObject<boolean>
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
    const html = buildNotamPopupHtml(properties)

    popupRef.current?.remove()
    popupRef.current = new mapboxgl.Popup({ offset: 14, closeButton: true })
      .setLngLat(event.lngLat)
      .setHTML(html)
      .addTo(map)
  }

  map.on("mouseenter", NOTAM_FILL_LAYER_ID, handleMouseEnter)
  map.on("mouseleave", NOTAM_FILL_LAYER_ID, handleMouseLeave)
  map.on("mouseenter", NOTAM_LINE_LAYER_ID, handleMouseEnter)
  map.on("mouseleave", NOTAM_LINE_LAYER_ID, handleMouseLeave)
  map.on("mouseenter", NOTAM_POINT_LAYER_ID, handleMouseEnter)
  map.on("mouseleave", NOTAM_POINT_LAYER_ID, handleMouseLeave)
  map.on("click", NOTAM_FILL_LAYER_ID, handleClick)
  map.on("click", NOTAM_LINE_LAYER_ID, handleClick)
  map.on("click", NOTAM_POINT_LAYER_ID, handleClick)

  boundRef.current = true
}

const applyFocusLocation = (
  map: mapboxgl.Map,
  focusLocation: RadarFocusLocation | undefined,
  focusMarkerRef: MutableRefObject<mapboxgl.Marker | null>
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
  const popupHtml = `<div style="font-size:12px;color:#0f172a;"><strong>${
    name ?? "Site"
  }</strong><br/>Focused site</div>`
  if (!focusMarkerRef.current) {
    focusMarkerRef.current = new mapboxgl.Marker({
      element: createFocusMarkerElement(),
    })
      .setLngLat([lon, lat])
      .setPopup(new mapboxgl.Popup({ offset: 16 }).setHTML(popupHtml))
      .addTo(map)
  } else {
    focusMarkerRef.current
      .setLngLat([lon, lat])
      .setPopup(new mapboxgl.Popup({ offset: 16 }).setHTML(popupHtml))
  }
}

export function RadarTab({ theme, focusLocation, defaultCenter }: RadarTabProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const focusMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const lastDefaultCenterRef = useRef<{ lat: number; lon: number } | null>(null)
  const tfrPopupRef = useRef<mapboxgl.Popup | null>(null)
  const notamPopupRef = useRef<mapboxgl.Popup | null>(null)
  const weatherAnimationIntervalRef = useRef<number | null>(null)
  const weatherActiveSlotRef = useRef<0 | 1>(0)
  const weatherCurrentFrameIndexRef = useRef(0)
  const weatherInterpolationStepRef = useRef(0)
  const weatherFramesSignatureRef = useRef("")
  const didRunInitialStyleEffectRef = useRef(false)
  const tfrInteractionsBoundRef = useRef(false)
  const notamInteractionsBoundRef = useRef(false)
  const [baseStyle, setBaseStyle] = useState<BaseStyleKey>("streets")
  const [showWeather, setShowWeather] = useState(true)
  const [showTfr, setShowTfr] = useState(true)
  const [showNotam, setShowNotam] = useState(true)
  const [showSites, setShowSites] = useState(true)
  const [radarFrames, setRadarFrames] = useState<RainViewerFrame[]>([])
  const [radarStatus, setRadarStatus] = useState<"loading" | "ready" | "error">("loading")

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

  const tfrs = useTfrs({
    lat: tfrQueryCenter.lat,
    lon: tfrQueryCenter.lon,
    radiusMiles: 250,
  })
  const notams = useNotams({
    lat: tfrQueryCenter.lat,
    lon: tfrQueryCenter.lon,
    radiusMiles: 250,
  })
  const tfrGeoJson = tfrs.data?.featureCollection ?? EMPTY_TFR_DATA
  const notamItems = Array.isArray(notams.data?.items) ? notams.data.items : []
  const notamGeoJson = useMemo(() => buildNotamFeatureCollection(notamItems), [notamItems])
  const hasTfrFeatures = tfrGeoJson.features.length > 0
  const nearbyTfrCount = tfrs.data?.items.length ?? 0
  const mappableNotamCount = notamGeoJson.features.length
  const nearbyNotamCount = notamItems.length
  const smoothFrameCount =
    radarFrames.length > 1 ? radarFrames.length * (RADAR_INTERPOLATION_STEPS + 1) : radarFrames.length
  const radarLoopSeconds =
    radarFrames.length > 1
      ? Math.max(
          1,
          Math.round(
            (radarFrames.length * (RADAR_INTERPOLATION_STEPS + 1) * RADAR_INTERPOLATION_STEP_MS) /
              1000
          )
        )
      : 0

  const baseStyleOptions = useMemo(
    () =>
      (Object.keys(BASE_STYLES) as BaseStyleKey[]).map((key) => ({
        key,
        label: BASE_STYLES[key].label,
      })),
    []
  )
  const resolvedBaseStyle = useMemo(() => resolveBaseStyle(baseStyle, theme), [baseStyle, theme])

  useEffect(() => {
    let cancelled = false

    const loadRadarFrames = async () => {
      try {
        const response = await fetch(RAIN_VIEWER_INDEX_URL)
        if (!response.ok) {
          throw new Error("Radar feed unavailable")
        }
        const payload = (await response.json()) as RainViewerResponse
        const host =
          typeof payload.host === "string" && payload.host.trim().length > 0
            ? payload.host.replace(/\/+$/, "")
            : RAIN_VIEWER_DEFAULT_HOST
        const pastFrames = Array.isArray(payload.radar?.past) ? payload.radar.past : []
        const nowcastFrames = Array.isArray(payload.radar?.nowcast) ? payload.radar.nowcast : []
        const mergedFrames = [...pastFrames, ...nowcastFrames]
          .map((item) => ({
            host,
            path: typeof item.path === "string" ? item.path : "",
            time: typeof item.time === "number" ? item.time : Number.NaN,
          }))
          .filter((item) => item.path.length > 0 && Number.isFinite(item.time))
          .sort((a, b) => a.time - b.time)

        const dedupedFrames: RainViewerFrame[] = []
        const seen = new Set<string>()
        for (const frame of mergedFrames) {
          const key = `${frame.time}:${frame.path}`
          if (seen.has(key)) continue
          seen.add(key)
          dedupedFrames.push(frame)
        }

        const nextFrames = dedupedFrames.slice(-RADAR_MAX_FRAMES)
        if (!nextFrames.length) {
          throw new Error("No radar frames")
        }

        if (cancelled) return
        setRadarFrames(nextFrames)
        setRadarStatus("ready")
      } catch {
        if (cancelled) return
        setRadarStatus("error")
      }
    }

    void loadRadarFrames()
    const refreshInterval = window.setInterval(() => {
      void loadRadarFrames()
    }, 5 * 60 * 1000)

    return () => {
      cancelled = true
      window.clearInterval(refreshInterval)
    }
  }, [])

  const setLayerVisibility = (layerId: string, isVisible: boolean) => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded() || !map.getLayer(layerId)) return
    map.setLayoutProperty(layerId, "visibility", isVisible ? "visible" : "none")
  }

  const stopWeatherAnimation = () => {
    if (weatherAnimationIntervalRef.current !== null) {
      window.clearInterval(weatherAnimationIntervalRef.current)
      weatherAnimationIntervalRef.current = null
    }
  }

  const syncWeatherOverlay = () => {
    const map = mapRef.current
    if (!map) return
    if (!map.isStyleLoaded()) {
      map.once("style.load", () => {
        syncWeatherOverlay()
      })
      return
    }

    const frames = radarFrames
    if (!frames.length) {
      stopWeatherAnimation()
      removeWeatherSlot(map, 0)
      removeWeatherSlot(map, 1)
      return
    }

    const signature = `${frames.length}:${frames[0]?.path ?? ""}:${frames[frames.length - 1]?.path ?? ""}`
    const shouldResetSlots =
      weatherFramesSignatureRef.current !== signature ||
      !map.getLayer(WEATHER_LAYER_IDS[0]) ||
      !map.getLayer(WEATHER_LAYER_IDS[1])

    if (shouldResetSlots) {
      weatherFramesSignatureRef.current = signature
      stopWeatherAnimation()
      weatherInterpolationStepRef.current = 0
      weatherActiveSlotRef.current = 0
      weatherCurrentFrameIndexRef.current = Math.max(0, frames.length - 2)
      const currentIndex = weatherCurrentFrameIndexRef.current
      const nextIndex = (currentIndex + 1) % frames.length
      mountWeatherSlot(map, 0, frames[currentIndex], WEATHER_LAYER_OPACITY, showWeather)
      mountWeatherSlot(map, 1, frames[nextIndex], 0, showWeather)
    } else {
      setWeatherLayerVisibility(map, showWeather)
    }

    if (!showWeather || frames.length < 2) {
      stopWeatherAnimation()
      return
    }

    if (weatherAnimationIntervalRef.current !== null) return

    weatherAnimationIntervalRef.current = window.setInterval(() => {
      const liveMap = mapRef.current
      if (!liveMap || !liveMap.isStyleLoaded()) return
      if (!liveMap.getLayer(WEATHER_LAYER_IDS[0]) || !liveMap.getLayer(WEATHER_LAYER_IDS[1])) return
      if (!showWeather) return

      const totalSteps = RADAR_INTERPOLATION_STEPS + 1
      const activeSlot = weatherActiveSlotRef.current
      const passiveSlot: 0 | 1 = activeSlot === 0 ? 1 : 0
      const nextStep = weatherInterpolationStepRef.current + 1
      const progress = nextStep / totalSteps

      setWeatherLayerOpacity(liveMap, activeSlot, WEATHER_LAYER_OPACITY * (1 - progress))
      setWeatherLayerOpacity(liveMap, passiveSlot, WEATHER_LAYER_OPACITY * progress)

      if (nextStep >= totalSteps) {
        const nextCurrentIndex = (weatherCurrentFrameIndexRef.current + 1) % frames.length
        weatherCurrentFrameIndexRef.current = nextCurrentIndex
        weatherInterpolationStepRef.current = 0
        weatherActiveSlotRef.current = passiveSlot

        const preloadSlot: 0 | 1 = passiveSlot === 0 ? 1 : 0
        const upcomingIndex = (nextCurrentIndex + 1) % frames.length
        mountWeatherSlot(liveMap, preloadSlot, frames[upcomingIndex], 0, showWeather)
        setWeatherLayerOpacity(liveMap, passiveSlot, WEATHER_LAYER_OPACITY)
        setWeatherLayerOpacity(liveMap, preloadSlot, 0)
        return
      }

      weatherInterpolationStepRef.current = nextStep
    }, RADAR_INTERPOLATION_STEP_MS)
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
    ensureTfrLayer(map, tfrGeoJson)
    bindTfrInteractions(map, tfrPopupRef, tfrInteractionsBoundRef)
    ensureNotamLayer(map, notamGeoJson)
    bindNotamInteractions(map, notamPopupRef, notamInteractionsBoundRef)
    syncWeatherOverlay()
    setLayerVisibility(TFR_FILL_LAYER_ID, showTfr)
    setLayerVisibility(TFR_LINE_LAYER_ID, showTfr)
    setLayerVisibility(NOTAM_FILL_LAYER_ID, showNotam)
    setLayerVisibility(NOTAM_LINE_LAYER_ID, showNotam)
    setLayerVisibility(NOTAM_POINT_LAYER_ID, showNotam)
  }

  const syncMarkers = () => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []
    if (!showSites) return
    FLIGHT_SITES.forEach((site) => {
      const marker = new mapboxgl.Marker({ element: createMarkerElement() })
        .setLngLat([site.lon, site.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 16 }).setHTML(
            `<div style="font-size:12px;color:#0f172a;"><strong>${site.name}</strong><br/>Flight Site</div>`
          )
        )
        .addTo(map)
      markersRef.current.push(marker)
    })
  }

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

    map.on("load", () => {
      syncOverlays()
      syncMarkers()
      applyFocusLocation(map, focusLocation, focusMarkerRef)
    })

    return () => {
      stopWeatherAnimation()
      tfrPopupRef.current?.remove()
      notamPopupRef.current?.remove()
      map.remove()
      mapRef.current = null
      focusMarkerRef.current = null
      didRunInitialStyleEffectRef.current = false
      tfrInteractionsBoundRef.current = false
      notamInteractionsBoundRef.current = false
      weatherFramesSignatureRef.current = ""
    }
  }, [missingToken, mapboxToken, resolvedBaseStyle])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!didRunInitialStyleEffectRef.current) {
      didRunInitialStyleEffectRef.current = true
      return
    }
    stopWeatherAnimation()
    tfrPopupRef.current?.remove()
    notamPopupRef.current?.remove()
    tfrInteractionsBoundRef.current = false
    notamInteractionsBoundRef.current = false
    map.once("style.load", () => {
      syncOverlays()
      syncMarkers()
    })
    map.setStyle(resolvedBaseStyle)
  }, [resolvedBaseStyle])

  useEffect(() => {
    syncOverlays()
  }, [showWeather, showTfr, showNotam, radarFrames, tfrGeoJson, notamGeoJson])

  useEffect(() => {
    syncMarkers()
  }, [showSites])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focusLocation) return
    applyFocusLocation(map, focusLocation, focusMarkerRef)
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
        <div className="mb-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-2">
          <p className="mb-2 text-center text-[10px] uppercase tracking-[0.3em] text-slate-500">
            Map Style
          </p>
          <div className="grid w-full grid-cols-3 items-center gap-2 text-slate-400">
            {baseStyleOptions.map((style) => (
              <button
                key={style.key}
                type="button"
                onClick={() => setBaseStyle(style.key)}
                className={`mx-auto w-3/4 whitespace-nowrap rounded-full px-1.5 py-2 text-center text-[10px] uppercase tracking-[0.04em] transition ${
                  baseStyle === style.key
                    ? "bg-emerald-400 text-slate-950"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {style.label}
              </button>
            ))}
          </div>
        </div>

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
                ? "border-sky-400/70 bg-sky-500/15 text-sky-200"
                : "border-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            <MapPin className="mr-2 inline h-3 w-3" />
            My Sites
          </button>
        </div>

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
          {radarStatus === "loading" && (
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-400/10 px-3 py-1 text-emerald-100">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading radar frames...
            </span>
          )}
          {radarStatus === "ready" && radarFrames.length > 0 && (
            <span className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-3 py-1 text-emerald-100">
              {radarFrames.length} source frame{radarFrames.length === 1 ? "" : "s"} +{" "}
              {smoothFrameCount} smooth steps {radarLoopSeconds > 0 ? `(${radarLoopSeconds}s loop)` : ""}
            </span>
          )}
          {radarStatus === "error" && (
            <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-rose-200">
              Radar animation feed unavailable.
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
