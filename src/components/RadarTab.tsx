import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { Layers, Loader2, MapPin, Radar, Satellite, Target } from "lucide-react"

import { useTfrs } from "../hooks/useTfrs"
import type { BoundsTuple, TfrFeatureProperties } from "../lib/aviation/types"

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
  focusLocation?: RadarFocusLocation
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

const WEATHER_SOURCE_ID = "weather-radar"
const WEATHER_LAYER_ID = "weather-radar-layer"
const TFR_SOURCE_ID = "tfr-zones"
const TFR_FILL_LAYER_ID = "tfr-zones-fill"
const TFR_LINE_LAYER_ID = "tfr-zones-line"
const OPEN_WEATHER_TILE_LAYER = "precipitation_new"

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

const ensureWeatherLayer = (map: mapboxgl.Map, apiKey?: string) => {
  if (!apiKey) return
  if (!map.getSource(WEATHER_SOURCE_ID)) {
    map.addSource(WEATHER_SOURCE_ID, {
      type: "raster",
      tiles: [
        `https://tile.openweathermap.org/map/${OPEN_WEATHER_TILE_LAYER}/{z}/{x}/{y}.png?appid=${apiKey}`,
      ],
      tileSize: 256,
    })
  }
  if (!map.getLayer(WEATHER_LAYER_ID)) {
    map.addLayer({
      id: WEATHER_LAYER_ID,
      type: "raster",
      source: WEATHER_SOURCE_ID,
      paint: {
        "raster-opacity": 0.6,
      },
    })
  }
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

export function RadarTab({ focusLocation }: RadarTabProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const focusMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const tfrPopupRef = useRef<mapboxgl.Popup | null>(null)
  const didRunInitialStyleEffectRef = useRef(false)
  const tfrInteractionsBoundRef = useRef(false)
  const [baseStyle, setBaseStyle] = useState<BaseStyleKey>("streets")
  const [showWeather, setShowWeather] = useState(true)
  const [showTfr, setShowTfr] = useState(true)
  const [showSites, setShowSites] = useState(true)

  const mapboxToken = (
    (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ??
      import.meta.env.VITE_MAPBOX_TOKEN) as string | undefined
  )?.trim()
  const weatherApiKey = (
    (import.meta.env.VITE_OPENWEATHER_API_KEY ??
      import.meta.env.VITE_OPENWEATHER_KEY) as string | undefined
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

    return { lat: DEFAULT_CENTER[1], lon: DEFAULT_CENTER[0] }
  }, [focusLocation])

  const tfrs = useTfrs({
    lat: tfrQueryCenter.lat,
    lon: tfrQueryCenter.lon,
    radiusMiles: 150,
  })
  const tfrGeoJson = tfrs.data?.featureCollection ?? EMPTY_TFR_DATA
  const hasTfrFeatures = tfrGeoJson.features.length > 0
  const nearbyTfrCount = tfrs.data?.items.length ?? 0

  const baseStyleOptions = useMemo(
    () =>
      (Object.keys(BASE_STYLES) as BaseStyleKey[]).map((key) => ({
        key,
        label: BASE_STYLES[key].label,
      })),
    []
  )

  const setLayerVisibility = (layerId: string, isVisible: boolean) => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded() || !map.getLayer(layerId)) return
    map.setLayoutProperty(layerId, "visibility", isVisible ? "visible" : "none")
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
    ensureWeatherLayer(map, weatherApiKey)
    ensureTfrLayer(map, tfrGeoJson)
    bindTfrInteractions(map, tfrPopupRef, tfrInteractionsBoundRef)
    setLayerVisibility(WEATHER_LAYER_ID, showWeather && !!weatherApiKey)
    setLayerVisibility(TFR_FILL_LAYER_ID, showTfr)
    setLayerVisibility(TFR_LINE_LAYER_ID, showTfr)
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
      style: BASE_STYLES[baseStyle].style,
      center: DEFAULT_CENTER,
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
      tfrPopupRef.current?.remove()
      map.remove()
      mapRef.current = null
      focusMarkerRef.current = null
      didRunInitialStyleEffectRef.current = false
      tfrInteractionsBoundRef.current = false
    }
  }, [missingToken, mapboxToken])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!didRunInitialStyleEffectRef.current) {
      didRunInitialStyleEffectRef.current = true
      return
    }
    tfrPopupRef.current?.remove()
    tfrInteractionsBoundRef.current = false
    map.once("style.load", () => {
      syncOverlays()
      syncMarkers()
    })
    map.setStyle(BASE_STYLES[baseStyle].style)
  }, [baseStyle])

  useEffect(() => {
    syncOverlays()
  }, [showWeather, showTfr, weatherApiKey, tfrGeoJson])

  useEffect(() => {
    syncMarkers()
  }, [showSites])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focusLocation) return
    applyFocusLocation(map, focusLocation, focusMarkerRef)
  }, [focusLocation])

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 rounded-3xl border border-slate-800/70 bg-slate-900/60 p-4 sm:p-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-xs uppercase tracking-[0.4em] text-emerald-300">Radar & Layers</p>
          <h2 className="text-[clamp(1.6rem,4vw,2.25rem)] font-semibold text-white">
            Mission Airspace Overview
          </h2>
          <p className="break-words text-sm text-slate-300">
            Blend live precipitation sweeps, active TFR polygons, and your launch sites in one
            operational view.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 p-2 text-xs uppercase tracking-[0.2em] text-slate-400 md:w-auto">
          {baseStyleOptions.map((style) => (
            <button
              key={style.key}
              type="button"
              onClick={() => setBaseStyle(style.key)}
              className={`rounded-full px-4 py-2 transition ${
                baseStyle === style.key
                  ? "bg-emerald-400 text-slate-950"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {style.label}
            </button>
          ))}
        </div>
      </header>

      <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/40">
        <div
          ref={mapContainerRef}
          className="h-[52svh] min-h-[320px] w-full sm:h-[60svh] lg:h-[70svh]"
        />

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />

        <div className="absolute inset-x-2 bottom-2 max-h-[45svh] overflow-y-auto rounded-2xl border border-slate-800/70 bg-slate-950/80 p-3 backdrop-blur sm:inset-x-4 sm:bottom-4 sm:max-h-[40svh] sm:rounded-3xl sm:p-4">
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
            {tfrs.error ? (
              <span className="max-w-full break-words rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-rose-200">
                {tfrs.error}
              </span>
            ) : null}
            {missingToken && (
              <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-amber-200">
                Add VITE_MAPBOX_ACCESS_TOKEN to view the map.
              </span>
            )}
            {!weatherApiKey && (
              <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-amber-200">
                Add VITE_OPENWEATHER_API_KEY for radar tiles.
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
