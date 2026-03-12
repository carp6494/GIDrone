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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL_SECONDS = 60
const RADIUS_MIN = 5
const RADIUS_MAX = 250
const QUERY_LIMIT = 2000   // fetch up to 2000, post-filter to 1000
const RESULT_LIMIT = 1000

const SELECT_COLUMNS =
  "id, oas_number, verification_status, country, state, city, lat, lon, obstacle_type, quantity, agl_height_ft, amsl_height_ft, lighting_code, horizontal_accuracy, vertical_accuracy, mark_indicator, faa_study_number, action_code, julian_date, asrn, owner_name, owner_source, source, updated_at"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ObstructionDbRow = {
  id: string
  oas_number: string
  verification_status: string | null
  country: string | null
  state: string | null
  city: string | null
  lat: number
  lon: number
  obstacle_type: string | null
  quantity: number | null
  agl_height_ft: number | null
  amsl_height_ft: number | null
  lighting_code: string | null
  horizontal_accuracy: string | null
  vertical_accuracy: string | null
  mark_indicator: string | null
  faa_study_number: string | null
  action_code: string | null
  julian_date: string | null
  asrn: string | null
  owner_name: string | null
  owner_source: string | null
  source: string | null
  updated_at: string
}

type ObstructionItem = {
  id: string
  oasNumber: string
  verificationStatus: string | null
  state: string | null
  city: string | null
  lat: number
  lon: number
  obstacleType: string | null
  quantity: number | null
  aglHeightFt: number | null
  amslHeightFt: number | null
  lightingCode: string | null
  horizontalAccuracy: string | null
  verticalAccuracy: string | null
  markIndicator: string | null
  faaStudyNumber: string | null
  actionCode: string | null
  asrn: string | null
  ownerName: string | null
  distanceMiles: number
}

type ObstructionResponse = {
  items: ObstructionItem[]
  featureCollection: GeoJSON.FeatureCollection
  fetchedAt: string
  source: string
  count: number
  message?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildCacheKey = (
  lat: number, lon: number, radiusMiles: number, sortBy: string,
  minHeight: number, types: string[]
) =>
  `obstruction:nearby:v2:${lat.toFixed(4)}:${lon.toFixed(4)}:${radiusMiles.toFixed(1)}:${sortBy}:${minHeight}:${types.sort().join(",")}`

const mapRowToItem = (row: ObstructionDbRow, distanceMiles: number): ObstructionItem => ({
  id: row.id,
  oasNumber: row.oas_number,
  verificationStatus: row.verification_status,
  state: row.state,
  city: row.city,
  lat: row.lat,
  lon: row.lon,
  obstacleType: row.obstacle_type,
  quantity: row.quantity,
  aglHeightFt: row.agl_height_ft,
  amslHeightFt: row.amsl_height_ft,
  lightingCode: row.lighting_code,
  horizontalAccuracy: row.horizontal_accuracy,
  verticalAccuracy: row.vertical_accuracy,
  markIndicator: row.mark_indicator,
  faaStudyNumber: row.faa_study_number,
  actionCode: row.action_code,
  asrn: row.asrn,
  ownerName: row.owner_name,
  distanceMiles: Math.round(distanceMiles * 100) / 100,
})

const buildFeatureCollection = (items: ObstructionItem[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: items.map((item) => ({
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [item.lon, item.lat],
    },
    properties: {
      id: item.id,
      oasNumber: item.oasNumber,
      obstacleType: item.obstacleType,
      aglHeightFt: item.aglHeightFt,
      amslHeightFt: item.amslHeightFt,
      lightingCode: item.lightingCode,
      markIndicator: item.markIndicator,
      city: item.city,
      state: item.state,
      asrn: item.asrn,
      ownerName: item.ownerName,
      distanceMiles: item.distanceMiles,
    },
  })),
})

type SortFn = (a: ObstructionItem, b: ObstructionItem) => number

const SORT_FUNCTIONS: Record<string, SortFn> = {
  distance: (a, b) => a.distanceMiles - b.distanceMiles,
  height: (a, b) => (b.aglHeightFt ?? 0) - (a.aglHeightFt ?? 0),
  type: (a, b) => (a.obstacleType ?? "").localeCompare(b.obstacleType ?? ""),
  lighting: (a, b) => (a.lightingCode ?? "").localeCompare(b.lightingCode ?? ""),
  marking: (a, b) => (a.markIndicator ?? "").localeCompare(b.markIndicator ?? ""),
  study: (a, b) => (a.faaStudyNumber ?? "").localeCompare(b.faaStudyNumber ?? ""),
  asrn: (a, b) => (a.asrn ?? "").localeCompare(b.asrn ?? ""),
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
    const lat = parseNumberLike(body?.lat) ?? parseNumberParam(url.searchParams.get("lat"))
    const lon = parseNumberLike(body?.lon) ?? parseNumberParam(url.searchParams.get("lon"))
    const radiusRaw =
      parseNumberLike(body?.radiusMiles) ?? parseNumberParam(url.searchParams.get("radiusMiles"))
    const radiusMiles = clamp(radiusRaw ?? 25, RADIUS_MIN, RADIUS_MAX)
    const sortBy =
      (typeof body?.sortBy === "string" ? body.sortBy : url.searchParams.get("sortBy")) ?? "distance"
    const sortKey = SORT_FUNCTIONS[sortBy] ? sortBy : "distance"
    const minHeight = parseNumberLike(body?.minHeight) ?? parseNumberParam(url.searchParams.get("minHeight")) ?? 0
    const typesRaw = body?.types
    const types: string[] = Array.isArray(typesRaw)
      ? typesRaw.filter((t: unknown): t is string => typeof t === "string" && t.length > 0)
      : []

    if (lat === null || lon === null) {
      return jsonResponse(request, { error: "lat and lon parameters are required." }, 400)
    }
    if (!isValidLatLon(lat, lon)) {
      return jsonResponse(
        request,
        { error: "Latitude must be -90..90 and longitude must be -180..180." },
        400
      )
    }

    const db = createServiceRoleClient()

    // Check cache
    const cacheKey = buildCacheKey(lat, lon, radiusMiles, sortKey, minHeight, types)
    const cached = await getCachedJson<ObstructionResponse>(db, cacheKey)
    if (cached) {
      return jsonResponse(request, cached)
    }

    // Bounding-box query
    const latDelta = radiusMiles / 69
    const lonDelta = radiusMiles / Math.max(69 * Math.cos((lat * Math.PI) / 180), 0.01)

    let query = db
      .from("obstructions")
      .select(SELECT_COLUMNS)
      .gte("lat", lat - latDelta)
      .lte("lat", lat + latDelta)
      .gte("lon", lon - lonDelta)
      .lte("lon", lon + lonDelta)

    if (minHeight > 0) {
      query = query.gte("agl_height_ft", minHeight)
    }
    if (types.length > 0) {
      query = query.in("obstacle_type", types)
    }

    const { data, error } = await query.limit(QUERY_LIMIT)

    if (error) {
      throw new Error(`Failed querying obstructions: ${error.message}`)
    }

    // Post-filter by exact haversine distance, map to items, sort
    const items = ((data ?? []) as ObstructionDbRow[])
      .map((row) => {
        const dist = haversineMiles(lat, lon, row.lat, row.lon)
        return dist <= radiusMiles ? mapRowToItem(row, dist) : null
      })
      .filter((item): item is ObstructionItem => item !== null)
      .sort(SORT_FUNCTIONS[sortKey])
      .slice(0, RESULT_LIMIT)

    const featureCollection = buildFeatureCollection(items)

    const responsePayload: ObstructionResponse = {
      items,
      featureCollection,
      fetchedAt: new Date().toISOString(),
      source: "faa-dof",
      count: items.length,
      ...(items.length === 0
        ? {
            message:
              "No obstructions found in the selected radius. The obstruction database may not be synced yet.",
          }
        : {}),
    }

    await setCachedJson(db, cacheKey, responsePayload, CACHE_TTL_SECONDS)
    return jsonResponse(request, responsePayload)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error."
    return jsonResponse(request, { error: message }, 502)
  }
})
