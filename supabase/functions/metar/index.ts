import type { SupabaseClient } from "npm:@supabase/supabase-js@2"

import {
  clamp,
  createServiceRoleClient,
  getCachedJson,
  haversineMiles,
  isValidLatLon,
  jsonResponse,
  optionsResponse,
  parseIntegerLike,
  parseIntegerParam,
  parseNumberLike,
  parseNumberParam,
  readJsonObjectBody,
  readGzipJson,
  setCachedJson,
  withTimeoutFetch,
} from "../_shared/aviation.ts"

const AVIATION_WEATHER_METAR_URL = "https://aviationweather.gov/api/data/metar"
const AVIATION_WEATHER_STATIONS_GZIP_URL =
  "https://aviationweather.gov/data/cache/stations.cache.json.gz"
const AVIATION_WEATHER_USER_AGENT = "GIDrone/0.2.1 (US-only METAR proxy)"
const STATIONS_STALE_MS = 7 * 24 * 60 * 60 * 1000
const METAR_TTL_SECONDS = 60
const METAR_HOURS = 2

type StationIndexRow = {
  icao_id: string
  name: string | null
  country: string | null
  state: string | null
  lat: number
  lon: number
  updated_at?: string | null
}

type UpstreamStationRow = {
  icaoId?: unknown
  site?: unknown
  country?: unknown
  state?: unknown
  lat?: unknown
  lon?: unknown
}

type CachedMetarPayload = {
  metars: unknown[]
  message?: string
}

const dedupeIds = (values: string[]) =>
  [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))]

const parseCoordinateRequest = (url: URL, body: Record<string, unknown> | null) => {
  const lat = parseNumberLike(body?.lat) ?? parseNumberParam(url.searchParams.get("lat"))
  const lon = parseNumberLike(body?.lon) ?? parseNumberParam(url.searchParams.get("lon"))
  if (lat === null || lon === null) return null
  if (!isValidLatLon(lat, lon)) return "Latitude must be -90..90 and longitude must be -180..180."

  const radiusRaw =
    parseNumberLike(body?.radiusMiles) ?? parseNumberParam(url.searchParams.get("radiusMiles"))
  const limitRaw =
    parseIntegerLike(body?.limit) ?? parseIntegerParam(url.searchParams.get("limit"))
  const radiusMiles = clamp(radiusRaw ?? 60, 5, 150)
  const limit = clamp(limitRaw ?? 5, 1, 10)

  return { lat, lon, radiusMiles, limit }
}

const fetchStationsGzip = async () => {
  const response = await withTimeoutFetch(
    AVIATION_WEATHER_STATIONS_GZIP_URL,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": AVIATION_WEATHER_USER_AGENT,
      },
    },
    20_000
  )

  return await readGzipJson<UpstreamStationRow[]>(response)
}

const refreshStationsIndex = async (db: SupabaseClient) => {
  const upstreamRows = await fetchStationsGzip()
  const nowIso = new Date().toISOString()

  const stations = upstreamRows
    .map((row) => {
      const icaoId = typeof row.icaoId === "string" ? row.icaoId.trim().toUpperCase() : ""
      const lat = typeof row.lat === "number" ? row.lat : Number(row.lat)
      const lon = typeof row.lon === "number" ? row.lon : Number(row.lon)
      const country =
        typeof row.country === "string" && row.country.trim()
          ? row.country.trim().toUpperCase()
          : null

      if (!icaoId || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
      if (country !== "US") return null

      return {
        icao_id: icaoId,
        name: typeof row.site === "string" && row.site.trim() ? row.site.trim() : null,
        country,
        state:
          typeof row.state === "string" && row.state.trim() ? row.state.trim().toUpperCase() : null,
        lat,
        lon,
        created_at: nowIso,
        updated_at: nowIso,
      }
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)

  const batchSize = 500
  for (let index = 0; index < stations.length; index += batchSize) {
    const batch = stations.slice(index, index + batchSize)
    const { error } = await db.from("stations_index").upsert(batch, { onConflict: "icao_id" })
    if (error) {
      throw new Error(`Failed to refresh stations_index: ${error.message}`)
    }
  }
}

const ensureStationsIndexFresh = async (db: SupabaseClient) => {
  const { data, error } = await db
    .from("stations_index")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)

  if (error) {
    throw new Error(`Failed reading stations_index timestamp: ${error.message}`)
  }

  const latestUpdatedAt = data?.[0]?.updated_at ? Date.parse(String(data[0].updated_at)) : NaN
  const isStale =
    !Number.isFinite(latestUpdatedAt) || Date.now() - latestUpdatedAt > STATIONS_STALE_MS

  if (isStale) {
    await refreshStationsIndex(db)
  }
}

const lookupStationsByIds = async (db: SupabaseClient, ids: string[]) => {
  if (ids.length === 0) return []
  const { data, error } = await db
    .from("stations_index")
    .select("icao_id, name, country, state, lat, lon")
    .in("icao_id", ids)

  if (error) {
    throw new Error(`Failed to query stations_index by ids: ${error.message}`)
  }

  const byId = new Map<string, StationIndexRow>()
  for (const row of (data ?? []) as StationIndexRow[]) {
    byId.set(row.icao_id.toUpperCase(), row)
  }

  return ids.map((id) => {
    const row = byId.get(id)
    if (row) {
      return {
        id: row.icao_id,
        name: row.name,
        lat: row.lat,
        lon: row.lon,
        country: row.country,
        state: row.state,
      }
    }

    return {
      id,
      name: null,
      lat: 0,
      lon: 0,
      country: "US",
      state: null,
    }
  })
}

const findNearbyStations = async (
  db: SupabaseClient,
  lat: number,
  lon: number,
  requestedRadiusMiles: number,
  limit: number
) => {
  const fallbackRadiusMiles = Math.max(150, requestedRadiusMiles)
  const latDelta = fallbackRadiusMiles / 69
  const lonDelta =
    fallbackRadiusMiles / Math.max(69 * Math.cos((lat * Math.PI) / 180), 0.01)

  const { data, error } = await db
    .from("stations_index")
    .select("icao_id, name, country, state, lat, lon")
    .eq("country", "US")
    .gte("lat", lat - latDelta)
    .lte("lat", lat + latDelta)
    .gte("lon", lon - lonDelta)
    .lte("lon", lon + lonDelta)

  if (error) {
    throw new Error(`Failed querying nearby stations_index rows: ${error.message}`)
  }

  const candidates = ((data ?? []) as StationIndexRow[])
    .map((row) => ({
      id: row.icao_id,
      name: row.name,
      lat: row.lat,
      lon: row.lon,
      country: row.country,
      state: row.state,
      distanceMiles: haversineMiles(lat, lon, row.lat, row.lon),
    }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles)

  const inRequested = candidates.filter((station) => station.distanceMiles <= requestedRadiusMiles)
  if (inRequested.length >= limit) return inRequested.slice(0, limit)

  const inFallback = candidates.filter((station) => station.distanceMiles <= fallbackRadiusMiles)
  const selected = [...inRequested]
  const selectedIds = new Set(selected.map((station) => station.id))

  for (const station of inFallback) {
    if (selectedIds.has(station.id)) continue
    selected.push(station)
    selectedIds.add(station.id)
    if (selected.length >= limit) break
  }

  return selected.slice(0, limit)
}

const fetchMetarsForIds = async (db: SupabaseClient, ids: string[]) => {
  const normalizedIds = dedupeIds(ids)
  if (normalizedIds.length === 0) {
    return { metars: [], message: "No station IDs requested." } satisfies CachedMetarPayload
  }

  const cacheKey = `metar:ids:${normalizedIds.join(",")}:hours:${METAR_HOURS}`
  const cached = await getCachedJson<CachedMetarPayload>(db, cacheKey)
  if (cached) return cached

  const upstreamUrl = new URL(AVIATION_WEATHER_METAR_URL)
  upstreamUrl.searchParams.set("ids", normalizedIds.join(","))
  upstreamUrl.searchParams.set("format", "json")
  upstreamUrl.searchParams.set("hours", String(METAR_HOURS))

  const response = await withTimeoutFetch(
    upstreamUrl,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": AVIATION_WEATHER_USER_AGENT,
      },
    },
    10_000
  )

  let payload: CachedMetarPayload
  if (response.status === 204) {
    payload = {
      metars: [],
      message: `No METAR reports returned in the last ${METAR_HOURS} hours for selected stations.`,
    }
  } else if (!response.ok) {
    const message = await response.text()
    throw new Error(
      `AviationWeather METAR request failed (${response.status}): ${
        message.slice(0, 280) || response.statusText
      }`
    )
  } else {
    const json = await response.json()
    payload = {
      metars: Array.isArray(json) ? json : [],
    }
  }

  await setCachedJson(db, cacheKey, payload, METAR_TTL_SECONDS)
  return payload
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request)
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed. Use GET or POST." }, 405)
  }

  try {
    const body = await readJsonObjectBody(request)
    const db = createServiceRoleClient()
    await ensureStationsIndexFresh(db)

    const url = new URL(request.url)
    const idsParam =
      typeof body?.ids === "string"
        ? body.ids
        : Array.isArray(body?.ids)
          ? body.ids.map((value) => String(value)).join(",")
          : url.searchParams.get("ids")

    let stations: Array<{
      id: string
      name: string | null
      lat: number
      lon: number
      country: string | null
      state: string | null
      distanceMiles?: number
    }> = []
    let metarPayload: CachedMetarPayload

    if (idsParam && idsParam.trim()) {
      const ids = dedupeIds(idsParam.split(","))
      if (ids.length === 0) {
        return jsonResponse(request, { error: "Provide at least one ICAO id in ids=." }, 400)
      }
      stations = await lookupStationsByIds(db, ids)
      metarPayload = await fetchMetarsForIds(db, ids)
    } else {
      const coordinateRequest = parseCoordinateRequest(url, body)
      if (coordinateRequest === null) {
        return jsonResponse(
          request,
          { error: "Provide either ids=KXYZ,KABC or lat/lon query parameters." },
          400
        )
      }
      if (typeof coordinateRequest === "string") {
        return jsonResponse(request, { error: coordinateRequest }, 400)
      }

      stations = await findNearbyStations(
        db,
        coordinateRequest.lat,
        coordinateRequest.lon,
        coordinateRequest.radiusMiles,
        coordinateRequest.limit
      )

      const stationIds = stations.map((station) => station.id)
      metarPayload = await fetchMetarsForIds(db, stationIds)

      if (stationIds.length === 0 && !metarPayload.message) {
        metarPayload = {
          ...metarPayload,
          message: "No US METAR stations found within the search radius (including fallback to 150 miles).",
        }
      }
    }

    return jsonResponse(request, {
      stations,
      metars: metarPayload.metars,
      fetchedAt: new Date().toISOString(),
      source: "aviationweather",
      ...(metarPayload.message ? { message: metarPayload.message } : {}),
    })
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Upstream request timed out."
        : error instanceof Error
          ? error.message
          : "Unexpected error."
    return jsonResponse(request, { error: message }, 502)
  }
})
