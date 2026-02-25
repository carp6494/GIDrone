import type { SupabaseClient } from "npm:@supabase/supabase-js@2"

import {
  clamp,
  createServiceRoleClient,
  getCachedJson,
  haversineMiles,
  isValidLatLon,
  jsonResponse,
  optionsResponse,
  parseNumberLike,
  parseNumberParam,
  readJsonObjectBody,
  setCachedJson,
} from "../_shared/aviation.ts"
import { FaaFnsNdsProvider } from "./providers/faaFnsNds.ts"
import type { NotamItem } from "./providers/provider.ts"

const NOTAM_CACHE_TTL_SECONDS = 60
const NOTAM_RADIUS_MIN = 5
const NOTAM_RADIUS_MAX = 250
const NOTAM_NEAREST_AIRPORT_LIMIT = 5
const NOTAM_LOOKBACK_HOURS = 6
const NOTAM_LOOKAHEAD_HOURS = 72
const IS_LOCAL_DEV = !Deno.env.get("DENO_DEPLOYMENT_ID")

type StationIndexRow = {
  icao_id: string
  name: string | null
  state: string | null
  lat: number
  lon: number
}

type NearbyStation = {
  icaoId: string
  name: string | null
  state: string | null
  lat: number
  lon: number
  distanceMiles: number
}

type NotamResponse = {
  items?: NotamItem[]
  fetchedAt?: string
  source?: string
  message?: string
  error?: string
  nextSteps?: string[]
}

const logDev = (...args: unknown[]) => {
  if (!IS_LOCAL_DEV) return
  console.log(...args)
}

const buildProviderConfig = () => {
  const endpoint = (Deno.env.get("FAA_NOTAM_ENDPOINT") ?? "").trim()
  const username = (Deno.env.get("FAA_NOTAM_USERNAME") ?? "").trim()
  const password = (Deno.env.get("FAA_NOTAM_PASSWORD") ?? "").trim()
  const authModeRaw = (Deno.env.get("FAA_NOTAM_AUTH_MODE") ?? "basic").trim()
  const { missing, authMode } = FaaFnsNdsProvider.getMissingSecrets({
    endpoint,
    username,
    password,
    authMode: authModeRaw,
  })

  return {
    endpoint,
    username,
    password,
    authMode,
    missing,
  }
}

const buildNotConfiguredResponse = (missingSecrets: string[]): NotamResponse => ({
  error: "NOTAM provider not configured",
  nextSteps: [
    `Set Supabase Edge Function secrets: ${missingSecrets.join(", ")}.`,
    "Use credentials and endpoint details from the FAA Agreement Portal NOTAM web service documentation (FNS NDS / NMS as provisioned).",
    "Redeploy the notam function after secrets are configured.",
  ],
})

const findNearbyStations = async (
  db: SupabaseClient,
  lat: number,
  lon: number,
  radiusMiles: number,
  limit: number
) => {
  const latDelta = radiusMiles / 69
  const lonDelta = radiusMiles / Math.max(69 * Math.cos((lat * Math.PI) / 180), 0.01)

  const { data, error } = await db
    .from("stations_index")
    .select("icao_id, name, state, lat, lon")
    .eq("country", "US")
    .gte("lat", lat - latDelta)
    .lte("lat", lat + latDelta)
    .gte("lon", lon - lonDelta)
    .lte("lon", lon + lonDelta)

  if (error) {
    throw new Error(`Failed querying stations_index for NOTAM lookup: ${error.message}`)
  }

  return ((data ?? []) as StationIndexRow[])
    .map((row) => ({
      icaoId: row.icao_id.toUpperCase(),
      name: row.name,
      state: row.state,
      lat: row.lat,
      lon: row.lon,
      distanceMiles: haversineMiles(lat, lon, row.lat, row.lon),
    }))
    .filter((row) => row.distanceMiles <= radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, limit)
}

const buildFinalCacheKey = ({
  lat,
  lon,
  radiusMiles,
  icaos,
}: {
  lat: number
  lon: number
  radiusMiles: number
  icaos: string[]
}) => `notam:faa:${lat.toFixed(4)}:${lon.toFixed(4)}:${radiusMiles.toFixed(1)}:icaos:${icaos.join(",") || "none"}`

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
    const lat = parseNumberLike(body?.lat) ?? parseNumberParam(url.searchParams.get("lat"))
    const lon = parseNumberLike(body?.lon) ?? parseNumberParam(url.searchParams.get("lon"))
    const radiusRaw =
      parseNumberLike(body?.radiusMiles) ?? parseNumberParam(url.searchParams.get("radiusMiles"))
    const radiusMiles = clamp(radiusRaw ?? 50, NOTAM_RADIUS_MIN, NOTAM_RADIUS_MAX)

    if (lat === null || lon === null) {
      return jsonResponse(request, { error: "lat and lon query parameters are required." }, 400)
    }
    if (!isValidLatLon(lat, lon)) {
      return jsonResponse(
        request,
        { error: "Latitude must be -90..90 and longitude must be -180..180." },
        400
      )
    }

    const providerConfig = buildProviderConfig()
    if (providerConfig.missing.length > 0) {
      logDev("[notam] missing FAA NOTAM secrets/config", providerConfig.missing)
      return jsonResponse(request, buildNotConfiguredResponse(providerConfig.missing), 501)
    }

    const db = createServiceRoleClient()
    const nearbyStations = await findNearbyStations(
      db,
      lat,
      lon,
      radiusMiles,
      NOTAM_NEAREST_AIRPORT_LIMIT
    )
    const selectedIcaos = nearbyStations.map((station) => station.icaoId)
    logDev("[notam] selected ICAOs", selectedIcaos)

    const cacheKey = buildFinalCacheKey({
      lat,
      lon,
      radiusMiles,
      icaos: selectedIcaos,
    })
    const cached = await getCachedJson<NotamResponse>(db, cacheKey)
    if (cached) {
      return jsonResponse(request, cached)
    }

    if (selectedIcaos.length === 0) {
      const emptyResponse: NotamResponse = {
        items: [],
        fetchedAt: new Date().toISOString(),
        source: "faa-fns-nds",
        message: "No nearby US airports found in the selected radius for FAA NOTAM lookup.",
      }
      await setCachedJson(db, cacheKey, emptyResponse, NOTAM_CACHE_TTL_SECONDS)
      return jsonResponse(request, emptyResponse)
    }

    const now = Date.now()
    const startsAtIso = new Date(now - NOTAM_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString()
    const endsAtIso = new Date(now + NOTAM_LOOKAHEAD_HOURS * 60 * 60 * 1000).toISOString()

    const provider = new FaaFnsNdsProvider({
      endpoint: providerConfig.endpoint,
      username: providerConfig.username,
      password: providerConfig.password,
      authMode: providerConfig.authMode,
    })
    const providerResult = await provider.fetchNotams({
      icaos: selectedIcaos,
      startsAtIso,
      endsAtIso,
    })

    const responsePayload: NotamResponse = {
      items: providerResult.items,
      fetchedAt: new Date().toISOString(),
      source: providerResult.source,
      ...(providerResult.message ? { message: providerResult.message } : {}),
    }

    await setCachedJson(db, cacheKey, responsePayload, NOTAM_CACHE_TTL_SECONDS)
    return jsonResponse(request, responsePayload)
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "FAA NOTAM provider request timed out."
        : error instanceof Error
          ? error.message
          : "Unexpected error."
    return jsonResponse(request, { error: message }, 502)
  }
})
