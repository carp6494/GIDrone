import {
  createServiceRoleClient,
  getCachedJson,
  jsonResponse,
  optionsResponse,
  readJsonObjectBody,
  setCachedJson,
  withTimeoutFetch,
} from "../_shared/aviation.ts"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL_SECONDS = 1800 // 30 minutes
const CELL_CACHE_TTL_SECONDS = 1800 // 30 minutes — cache individual cell weather
const POINT_CACHE_TTL_SECONDS = 86400 // 24 hours for NWS office/grid mappings
const NWS_USER_AGENT = "GIDrone/1.0 (drone flight safety heatmap)"
const NWS_TIMEOUT_MS = 6000
const CONCURRENCY_LIMIT = 25
const US_CONCURRENCY_LIMIT = 30

// ---------------------------------------------------------------------------
// State bounding boxes (duplicated from frontend for edge function use)
// ---------------------------------------------------------------------------

type StateBounds = { minLat: number; maxLat: number; minLon: number; maxLon: number }

const STATE_BOUNDS: Record<string, StateBounds> = {
  AL: { minLat: 30.22, maxLat: 35.01, minLon: -88.47, maxLon: -84.89 },
  AK: { minLat: 51.21, maxLat: 71.39, minLon: -179.15, maxLon: -129.98 },
  AZ: { minLat: 31.33, maxLat: 37.00, minLon: -114.81, maxLon: -109.04 },
  AR: { minLat: 33.00, maxLat: 36.50, minLon: -94.62, maxLon: -89.64 },
  CA: { minLat: 32.53, maxLat: 42.01, minLon: -124.41, maxLon: -114.13 },
  CO: { minLat: 36.99, maxLat: 41.00, minLon: -109.06, maxLon: -102.04 },
  CT: { minLat: 40.95, maxLat: 42.05, minLon: -73.73, maxLon: -71.79 },
  DE: { minLat: 38.45, maxLat: 39.84, minLon: -75.79, maxLon: -75.05 },
  FL: { minLat: 24.40, maxLat: 31.00, minLon: -87.63, maxLon: -80.03 },
  GA: { minLat: 30.36, maxLat: 35.00, minLon: -85.61, maxLon: -80.84 },
  HI: { minLat: 18.91, maxLat: 22.24, minLon: -160.24, maxLon: -154.81 },
  ID: { minLat: 41.99, maxLat: 49.00, minLon: -117.24, maxLon: -111.04 },
  IL: { minLat: 36.97, maxLat: 42.51, minLon: -91.51, maxLon: -87.02 },
  IN: { minLat: 37.77, maxLat: 41.76, minLon: -88.10, maxLon: -84.78 },
  IA: { minLat: 40.38, maxLat: 43.50, minLon: -96.64, maxLon: -90.14 },
  KS: { minLat: 36.99, maxLat: 40.00, minLon: -102.05, maxLon: -94.59 },
  KY: { minLat: 36.50, maxLat: 39.15, minLon: -89.57, maxLon: -81.96 },
  LA: { minLat: 28.93, maxLat: 33.02, minLon: -94.04, maxLon: -88.82 },
  ME: { minLat: 43.06, maxLat: 47.46, minLon: -71.08, maxLon: -66.95 },
  MD: { minLat: 37.91, maxLat: 39.72, minLon: -79.49, maxLon: -75.05 },
  MA: { minLat: 41.24, maxLat: 42.89, minLon: -73.51, maxLon: -69.93 },
  MI: { minLat: 41.70, maxLat: 48.26, minLon: -90.42, maxLon: -82.12 },
  MN: { minLat: 43.50, maxLat: 49.38, minLon: -97.24, maxLon: -89.49 },
  MS: { minLat: 30.17, maxLat: 34.99, minLon: -91.66, maxLon: -88.10 },
  MO: { minLat: 35.99, maxLat: 40.61, minLon: -95.77, maxLon: -89.10 },
  MT: { minLat: 44.36, maxLat: 49.00, minLon: -116.05, maxLon: -104.04 },
  NE: { minLat: 39.99, maxLat: 43.00, minLon: -104.05, maxLon: -95.31 },
  NV: { minLat: 35.00, maxLat: 42.00, minLon: -120.01, maxLon: -114.04 },
  NH: { minLat: 42.70, maxLat: 45.31, minLon: -72.56, maxLon: -70.70 },
  NJ: { minLat: 38.93, maxLat: 41.36, minLon: -75.56, maxLon: -73.89 },
  NM: { minLat: 31.33, maxLat: 37.00, minLon: -109.05, maxLon: -103.00 },
  NY: { minLat: 40.50, maxLat: 45.01, minLon: -79.76, maxLon: -71.86 },
  NC: { minLat: 33.84, maxLat: 36.59, minLon: -84.32, maxLon: -75.46 },
  ND: { minLat: 45.94, maxLat: 49.00, minLon: -104.05, maxLon: -96.55 },
  OH: { minLat: 38.40, maxLat: 41.98, minLon: -84.82, maxLon: -80.52 },
  OK: { minLat: 33.62, maxLat: 37.00, minLon: -103.00, maxLon: -94.43 },
  OR: { minLat: 41.99, maxLat: 46.29, minLon: -124.57, maxLon: -116.46 },
  PA: { minLat: 39.72, maxLat: 42.27, minLon: -80.52, maxLon: -74.69 },
  RI: { minLat: 41.15, maxLat: 42.02, minLon: -71.86, maxLon: -71.12 },
  SC: { minLat: 32.05, maxLat: 35.21, minLon: -83.35, maxLon: -78.54 },
  SD: { minLat: 42.48, maxLat: 45.95, minLon: -104.06, maxLon: -96.44 },
  TN: { minLat: 34.98, maxLat: 36.68, minLon: -90.31, maxLon: -81.65 },
  TX: { minLat: 25.84, maxLat: 36.50, minLon: -106.65, maxLon: -93.51 },
  UT: { minLat: 36.99, maxLat: 42.00, minLon: -114.05, maxLon: -109.04 },
  VT: { minLat: 42.73, maxLat: 45.02, minLon: -73.44, maxLon: -71.46 },
  VA: { minLat: 36.54, maxLat: 39.47, minLon: -83.68, maxLon: -75.24 },
  WA: { minLat: 45.54, maxLat: 49.00, minLon: -124.85, maxLon: -116.92 },
  WV: { minLat: 37.20, maxLat: 40.64, minLon: -82.64, maxLon: -77.72 },
  WI: { minLat: 42.49, maxLat: 47.08, minLon: -92.89, maxLon: -86.25 },
  WY: { minLat: 40.99, maxLat: 45.01, minLon: -111.06, maxLon: -104.05 },
  DC: { minLat: 38.79, maxLat: 38.99, minLon: -77.12, maxLon: -76.91 },
  // CONUS (contiguous US) — used for full US pre-compute
  US: { minLat: 24.5, maxLat: 49.5, minLon: -124.8, maxLon: -66.9 },
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NwsPointMapping = {
  office: string
  gridX: number
  gridY: number
}

type GridCell = {
  lat: number
  lon: number
  temperatureF: number | null
  windSpeedMph: number | null
  windGustMph: number | null
  windDirection: string | null
  visibilityMiles: number | null
  precipitationProbability: number | null
  humidity: number | null
  shortForecast: string | null
  cloudCover: number | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nwsFetch = (url: string) =>
  withTimeoutFetch(url, {
    headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
  }, NWS_TIMEOUT_MS)

const computeCellSize = (bounds: StateBounds, stateCode: string): number => {
  if (stateCode === "US") return 1.5 // CONUS-wide: ~660 points (fits 60s edge function limit)
  const area = (bounds.maxLat - bounds.minLat) * (bounds.maxLon - bounds.minLon)
  if (area > 50) return 0.5
  if (area > 20) return 0.35
  return 0.25
}

const generateGridPoints = (bounds: StateBounds, step: number): { lat: number; lon: number }[] => {
  const points: { lat: number; lon: number }[] = []
  for (let lat = bounds.minLat; lat <= bounds.maxLat; lat += step) {
    for (let lon = bounds.minLon; lon <= bounds.maxLon; lon += step) {
      points.push({
        lat: Math.round(lat * 10000) / 10000,
        lon: Math.round(lon * 10000) / 10000,
      })
    }
  }
  return points
}

const pointCacheKey = (lat: number, lon: number) =>
  `nws:point:${lat.toFixed(4)}:${lon.toFixed(4)}`

/** Convert NWS value string like "72 degF" or "15 km/h" to a number */
const parseNwsValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const match = value.match(/([\d.]+)/)
    if (match) {
      const num = Number(match[1])
      return Number.isFinite(num) ? num : null
    }
  }
  return null
}

/** Celsius to Fahrenheit */
const cToF = (c: number) => (c * 9) / 5 + 32

/** km/h to mph */
const kmhToMph = (kmh: number) => kmh * 0.621371

/** meters to miles */
const mToMi = (m: number) => m / 1609.344

/**
 * Extract the current (first period) weather from a NWS gridpoints/forecast response.
 * Returns null if the response cannot be parsed.
 */
const extractCurrentWeather = (forecastData: unknown): Omit<GridCell, "lat" | "lon"> | null => {
  if (!forecastData || typeof forecastData !== "object") return null

  const props = (forecastData as Record<string, unknown>).properties as Record<string, unknown> | undefined
  if (!props) return null

  const periods = props.periods as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(periods) || periods.length === 0) return null

  const period = periods[0]

  // Temperature — NWS returns in F or C depending on the unit
  let temperatureF: number | null = null
  const tempVal = parseNwsValue(period.temperature)
  if (tempVal !== null) {
    const unit = period.temperatureUnit as string | undefined
    temperatureF = unit === "C" ? Math.round(cToF(tempVal)) : Math.round(tempVal)
  }

  // Wind speed — NWS returns like "15 mph" or "10 to 20 mph"
  let windSpeedMph: number | null = null
  const windStr = period.windSpeed as string | undefined
  if (windStr) {
    const parts = windStr.match(/(\d+)/g)
    if (parts?.length) {
      // Use the higher end if range is given
      windSpeedMph = Math.max(...parts.map(Number))
    }
  }

  // Wind gust — not always present in forecast periods
  const windGustMph: number | null = null

  const windDirection = (period.windDirection as string) ?? null

  // Visibility is not in the forecast endpoint — default to null
  const visibilityMiles: number | null = null

  // Precipitation probability
  let precipitationProbability: number | null = null
  const precipProb = period.probabilityOfPrecipitation as Record<string, unknown> | undefined
  if (precipProb) {
    precipitationProbability = parseNwsValue(precipProb.value)
  }

  // Humidity
  let humidity: number | null = null
  const relHum = period.relativeHumidity as Record<string, unknown> | undefined
  if (relHum) {
    humidity = parseNwsValue(relHum.value)
  }

  const shortForecast = (period.shortForecast as string) ?? null

  // Cloud cover not directly in forecast periods — infer from shortForecast
  let cloudCover: number | null = null
  if (shortForecast) {
    const lower = shortForecast.toLowerCase()
    if (lower.includes("sunny") || lower.includes("clear")) cloudCover = 5
    else if (lower.includes("mostly sunny") || lower.includes("mostly clear")) cloudCover = 25
    else if (lower.includes("partly")) cloudCover = 50
    else if (lower.includes("mostly cloudy")) cloudCover = 75
    else if (lower.includes("cloudy") || lower.includes("overcast")) cloudCover = 95
  }

  return {
    temperatureF,
    windSpeedMph,
    windGustMph,
    windDirection,
    visibilityMiles,
    precipitationProbability,
    humidity,
    shortForecast,
    cloudCover,
  }
}

/**
 * Extract weather from NWS raw gridpoint observation data.
 * This is used as a richer alternative to the forecast endpoint.
 */
const extractGridpointWeather = (gridData: unknown): Omit<GridCell, "lat" | "lon"> | null => {
  if (!gridData || typeof gridData !== "object") return null

  const props = (gridData as Record<string, unknown>).properties as Record<string, unknown> | undefined
  if (!props) return null

  const getLatestValue = (prop: unknown): number | null => {
    if (!prop || typeof prop !== "object") return null
    const values = (prop as Record<string, unknown>).values as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(values) || values.length === 0) return null
    const uom = (prop as Record<string, unknown>).uom as string | undefined
    // Get the most recent value (last in array, or closest to now)
    const latest = values[values.length - 1]
    const val = parseNwsValue(latest?.value)
    return val !== null ? { val, uom } as unknown as number : null // We'll handle conversion separately
  }

  const getLatestWithUnit = (prop: unknown): { val: number; uom: string } | null => {
    if (!prop || typeof prop !== "object") return null
    const values = (prop as Record<string, unknown>).values as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(values) || values.length === 0) return null
    const uom = ((prop as Record<string, unknown>).uom as string) ?? ""
    // Find the value closest to now
    const now = Date.now()
    let best: { val: number; uom: string } | null = null
    let bestDiff = Infinity
    for (const entry of values) {
      const val = parseNwsValue(entry.value)
      if (val === null) continue
      const validTime = entry.validTime as string | undefined
      if (validTime) {
        const start = Date.parse(validTime.split("/")[0])
        const diff = Math.abs(now - start)
        if (diff < bestDiff) {
          bestDiff = diff
          best = { val, uom }
        }
      } else {
        best = { val, uom }
      }
    }
    return best
  }

  // Temperature
  let temperatureF: number | null = null
  const tempEntry = getLatestWithUnit(props.temperature)
  if (tempEntry) {
    temperatureF = tempEntry.uom.includes("degC")
      ? Math.round(cToF(tempEntry.val))
      : Math.round(tempEntry.val)
  }

  // Wind speed
  let windSpeedMph: number | null = null
  const windEntry = getLatestWithUnit(props.windSpeed)
  if (windEntry) {
    windSpeedMph = windEntry.uom.includes("km")
      ? Math.round(kmhToMph(windEntry.val))
      : Math.round(windEntry.val)
  }

  // Wind gust
  let windGustMph: number | null = null
  const gustEntry = getLatestWithUnit(props.windGust)
  if (gustEntry) {
    windGustMph = gustEntry.uom.includes("km")
      ? Math.round(kmhToMph(gustEntry.val))
      : Math.round(gustEntry.val)
  }

  // Wind direction
  let windDirection: string | null = null
  const windDirEntry = getLatestWithUnit(props.windDirection)
  if (windDirEntry) {
    const deg = windDirEntry.val
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    windDirection = dirs[Math.round(deg / 45) % 8]
  }

  // Visibility
  let visibilityMiles: number | null = null
  const visEntry = getLatestWithUnit(props.visibility)
  if (visEntry) {
    visibilityMiles = visEntry.uom.includes("m") && !visEntry.uom.includes("mi")
      ? Math.round(mToMi(visEntry.val) * 10) / 10
      : Math.round(visEntry.val * 10) / 10
  }

  // Precipitation probability
  let precipitationProbability: number | null = null
  const precipEntry = getLatestWithUnit(props.probabilityOfPrecipitation)
  if (precipEntry) {
    precipitationProbability = Math.round(precipEntry.val)
  }

  // Humidity
  let humidity: number | null = null
  const humEntry = getLatestWithUnit(props.relativeHumidity)
  if (humEntry) {
    humidity = Math.round(humEntry.val)
  }

  // Cloud cover / sky cover
  let cloudCover: number | null = null
  const skyEntry = getLatestWithUnit(props.skyCover)
  if (skyEntry) {
    cloudCover = Math.round(skyEntry.val)
  }

  // Short forecast — not available from raw gridpoint, generate from data
  let shortForecast: string | null = null
  if (cloudCover !== null) {
    if (cloudCover < 15) shortForecast = "Clear"
    else if (cloudCover < 40) shortForecast = "Mostly Sunny"
    else if (cloudCover < 60) shortForecast = "Partly Cloudy"
    else if (cloudCover < 85) shortForecast = "Mostly Cloudy"
    else shortForecast = "Cloudy"
  }
  if (precipitationProbability !== null && precipitationProbability > 50) {
    shortForecast = (shortForecast ? shortForecast + ", " : "") + "Chance of Rain"
  }

  return {
    temperatureF,
    windSpeedMph,
    windGustMph,
    windDirection,
    visibilityMiles,
    precipitationProbability,
    humidity,
    shortForecast,
    cloudCover,
  }
}

// ---------------------------------------------------------------------------
// Concurrency-limited batch processor
// ---------------------------------------------------------------------------

async function batchProcess<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0

  const worker = async () => {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i])
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request)
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed. Use GET or POST." }, 405)
  }

  try {
    const body = await readJsonObjectBody(request)
    const url = new URL(request.url)
    const stateCode = (
      (typeof body?.stateCode === "string" ? body.stateCode : null) ??
      url.searchParams.get("stateCode") ??
      ""
    ).toUpperCase().trim()

    if (!stateCode || !STATE_BOUNDS[stateCode]) {
      return jsonResponse(
        request,
        { error: `Invalid stateCode. Provide a 2-letter US state code (e.g., "TX", "OH").` },
        400,
      )
    }

    const db = createServiceRoleClient()

    // Check weather grid cache
    const bounds = STATE_BOUNDS[stateCode]
    const cellSizeDeg = computeCellSize(bounds, stateCode)
    const cacheKey = `heatmap:weather:v1:${stateCode}`
    const concurrency = stateCode === "US" ? US_CONCURRENCY_LIMIT : CONCURRENCY_LIMIT

    const cached = await getCachedJson<unknown>(db, cacheKey)
    if (cached) {
      return jsonResponse(request, cached)
    }

    // Generate grid
    const gridPoints = generateGridPoints(bounds, cellSizeDeg)
    let failedPoints = 0

    // Process each grid point: resolve NWS office mapping, then fetch weather
    const cellCacheKey = (lat: number, lon: number) =>
      `nws:cell:${lat.toFixed(4)}:${lon.toFixed(4)}`

    const gridCells = await batchProcess(gridPoints, concurrency, async (pt) => {
      try {
        // Check per-cell weather cache first (avoids NWS calls entirely)
        const cKey = cellCacheKey(pt.lat, pt.lon)
        const cachedCell = await getCachedJson<GridCell>(db, cKey)
        if (cachedCell) return cachedCell

        // Step 1: Resolve NWS office/grid mapping (cached 24h)
        const ptKey = pointCacheKey(pt.lat, pt.lon)
        let mapping = await getCachedJson<NwsPointMapping>(db, ptKey)

        if (!mapping) {
          const pointResp = await nwsFetch(
            `https://api.weather.gov/points/${pt.lat},${pt.lon}`,
          )
          if (!pointResp.ok) {
            failedPoints++
            return null
          }
          const pointData = await pointResp.json()
          const pointProps = pointData?.properties
          if (!pointProps?.gridId || pointProps?.gridX == null || pointProps?.gridY == null) {
            failedPoints++
            return null
          }
          mapping = {
            office: pointProps.gridId as string,
            gridX: pointProps.gridX as number,
            gridY: pointProps.gridY as number,
          }
          // Cache office mapping for 24 hours
          await setCachedJson(db, ptKey, mapping, POINT_CACHE_TTL_SECONDS).catch(() => {})
        }

        // Step 2: Fetch raw gridpoint data (richer than forecast)
        const gridResp = await nwsFetch(
          `https://api.weather.gov/gridpoints/${mapping.office}/${mapping.gridX},${mapping.gridY}`,
        )

        if (gridResp.ok) {
          const gridData = await gridResp.json()
          const weather = extractGridpointWeather(gridData)
          if (weather) {
            const cell = { lat: pt.lat, lon: pt.lon, ...weather } as GridCell
            // Cache individual cell weather for 15 min
            await setCachedJson(db, cKey, cell, CELL_CACHE_TTL_SECONDS).catch(() => {})
            return cell
          }
        }

        // Fallback: try forecast endpoint (only if gridpoint failed entirely)
        const forecastResp = await nwsFetch(
          `https://api.weather.gov/gridpoints/${mapping.office}/${mapping.gridX},${mapping.gridY}/forecast`,
        )
        if (!forecastResp.ok) {
          failedPoints++
          return null
        }
        const forecastData = await forecastResp.json()
        const weather = extractCurrentWeather(forecastData)
        if (!weather) {
          failedPoints++
          return null
        }
        const cell = { lat: pt.lat, lon: pt.lon, ...weather } as GridCell
        await setCachedJson(db, cKey, cell, CELL_CACHE_TTL_SECONDS).catch(() => {})
        return cell
      } catch {
        failedPoints++
        return null
      }
    })

    const validCells = gridCells.filter((c): c is GridCell => c !== null)

    const responsePayload = {
      stateCode,
      grid: validCells,
      cellSizeDeg,
      fetchedAt: new Date().toISOString(),
      source: "nws" as const,
      pointCount: validCells.length,
      failedPoints,
      ...(validCells.length === 0
        ? {
            message:
              "No weather data could be retrieved for this state. The NWS API may be temporarily unavailable.",
          }
        : {}),
    }

    await setCachedJson(db, cacheKey, responsePayload, CACHE_TTL_SECONDS).catch(() => {})
    return jsonResponse(request, responsePayload)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error."
    return jsonResponse(request, { error: message }, 502)
  }
})
