import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { Layers, MapPin, Radar, Satellite, Target } from "lucide-react"

type BaseStyleKey = "streets" | "satellite" | "hybrid"

type SiteLocation = {
  name: string
  lat: number
  lon: number
}

type RadarTabProps = {
  focusLocation?: { lat: number; lon: number; name?: string | null }
}

const BASE_STYLES: Record<BaseStyleKey, { label: string; style: string }> = {
  streets: { label: "Streets", style: "mapbox://styles/mapbox/streets-v12" },
  satellite: { label: "Satellite", style: "mapbox://styles/mapbox/satellite-v9" },
  hybrid: { label: "Hybrid", style: "mapbox://styles/mapbox/satellite-streets-v12" },
}

const DEFAULT_CENTER: [number, number] = [-95.3698, 29.7604]

const MOCK_TFR_DATA: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        name: "TFR: Event perimeter",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-95.45, 29.8],
            [-95.31, 29.8],
            [-95.31, 29.71],
            [-95.45, 29.71],
            [-95.45, 29.8],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        name: "NOTAM: Stadium buffer",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-95.52, 29.78],
            [-95.47, 29.78],
            [-95.47, 29.73],
            [-95.52, 29.73],
            [-95.52, 29.78],
          ],
        ],
      },
    },
  ],
}

const FLIGHT_SITES: SiteLocation[] = [
  { name: "Bayou Launch", lat: 29.745, lon: -95.38 },
  { name: "Port Mobility", lat: 29.71, lon: -95.28 },
  { name: "River Bend", lat: 29.81, lon: -95.42 },
]

const WEATHER_SOURCE_ID = "weather-radar"
const WEATHER_LAYER_ID = "weather-radar-layer"
const TFR_SOURCE_ID = "tfr-notam"
const TFR_FILL_LAYER_ID = "tfr-notam-fill"
const TFR_LINE_LAYER_ID = "tfr-notam-line"
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

const ensureTfrLayer = (map: mapboxgl.Map) => {
  if (!map.getSource(TFR_SOURCE_ID)) {
    map.addSource(TFR_SOURCE_ID, {
      type: "geojson",
      data: MOCK_TFR_DATA,
    })
  }
  if (!map.getLayer(TFR_FILL_LAYER_ID)) {
    map.addLayer({
      id: TFR_FILL_LAYER_ID,
      type: "fill",
      source: TFR_SOURCE_ID,
      paint: {
        "fill-color": "#f43f5e",
        "fill-opacity": 0.2,
      },
    })
  }
  if (!map.getLayer(TFR_LINE_LAYER_ID)) {
    map.addLayer({
      id: TFR_LINE_LAYER_ID,
      type: "line",
      source: TFR_SOURCE_ID,
      paint: {
        "line-color": "#fb7185",
        "line-width": 2,
      },
    })
  }
}

const applyFocusLocation = (
  map: mapboxgl.Map,
  focusLocation: { lat: number; lon: number; name?: string | null } | undefined,
  focusMarkerRef: MutableRefObject<mapboxgl.Marker | null>
) => {
  if (!focusLocation) return
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
  const [baseStyle, setBaseStyle] = useState<BaseStyleKey>("streets")
  const [showWeather, setShowWeather] = useState(true)
  const [showTfr, setShowTfr] = useState(true)
  const [showSites, setShowSites] = useState(true)

  const mapboxToken = (
    import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined
  )?.trim()
  const weatherApiKey = import.meta.env.VITE_OPENWEATHER_API_KEY as string | undefined
  const missingToken = !mapboxToken

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
    if (!map || !map.getLayer(layerId)) return
    map.setLayoutProperty(layerId, "visibility", isVisible ? "visible" : "none")
  }

  const syncOverlays = () => {
    const map = mapRef.current
    if (!map) return
    ensureWeatherLayer(map, weatherApiKey)
    ensureTfrLayer(map)
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

    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right"
    )
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
      map.remove()
      mapRef.current = null
      focusMarkerRef.current = null
    }
  }, [missingToken, mapboxToken])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.once("style.load", () => {
      syncOverlays()
      syncMarkers()
    })
    map.setStyle(BASE_STYLES[baseStyle].style)
  }, [baseStyle])

  useEffect(() => {
    syncOverlays()
  }, [showWeather, showTfr, weatherApiKey])

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
      <header className="flex flex-col gap-4 rounded-3xl border border-slate-800/70 bg-slate-900/60 p-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.4em] text-emerald-300">
            Radar & Layers
          </p>
          <h2 className="text-3xl font-semibold text-white md:text-4xl">
            Mission Airspace Overview
          </h2>
          <p className="text-sm text-slate-300">
            Blend live precipitation sweeps, restricted zones, and your launch
            sites in one operational view.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 p-2 text-xs uppercase tracking-[0.2em] text-slate-400">
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
          className="h-[60vh] w-full sm:h-[65vh] lg:h-[70vh]"
        />

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />

        <div className="absolute inset-x-4 bottom-4 rounded-3xl border border-slate-800/70 bg-slate-950/80 p-4 backdrop-blur">
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
                  ? "border-rose-400/70 bg-rose-500/15 text-rose-200"
                  : "border-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              <Target className="mr-2 inline h-3 w-3" />
              TFR / NOTAM
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

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-300">
            <div className="flex items-center gap-2 rounded-full border border-slate-800/70 bg-slate-900/60 px-3 py-1">
              <Satellite className="h-4 w-4 text-slate-400" />
              <span>Geolocate + Zoom controls active</span>
            </div>
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
