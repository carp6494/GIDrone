import type { SupabaseClient } from "npm:@supabase/supabase-js@2"

import {
  clamp,
  createServiceRoleClient,
  getCachedJson,
  haversineMiles,
  isValidLatLon,
  jsonResponse,
  normalizeNotamId,
  optionsResponse,
  parseNumberLike,
  parseNumberParam,
  readJsonObjectBody,
  safeIsoString,
  setCachedJson,
} from "../_shared/aviation.ts"

const NOTAM_CACHE_TTL_SECONDS = 60
const NOTAM_RADIUS_MIN = 5
const NOTAM_RADIUS_MAX = 250
const NOTAM_NEARBY_AIRPORT_LIMIT = 250
const NOTAM_LOOKBACK_HOURS = 6
const NOTAM_LOOKAHEAD_HOURS = 72
const NOTAM_QUERY_LIMIT = 500
const NM_TO_MILES = 1.15078

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

type NotamFeedRow = {
  id: string
  notam_id: string
  facility_icao: string | null
  facility_code: string | null
  type: string | null
  category: string | null
  subtype: string | null
  description: string | null
  state: string | null
  location: string | null
  starts_at: string | null
  ends_at: string | null
  issued_at: string | null
  raw_text: string | null
  geom_type: string | null
  center_lat: number | null
  center_lon: number | null
  radius_nm: number | null
  feature_lat: number | null
  feature_lon: number | null
  geojson: Record<string, unknown> | null
  account_id: string | null
  affected_fir: string | null
  selection_code: string | null
  traffic: string | null
  purpose: string | null
  scope: string | null
  minimum_fl: string | null
  maximum_fl: string | null
  structure_type: string | null
  structure_designator: string | null
  structure_asr: string | null
  structure_height_ft: number | null
  structure_elevation_ft: number | null
  lighting_present: boolean | null
  lighting_status: string | null
  owner_name: string | null
  owner_source: string | null
  owner_last_checked_at: string | null
  source: string | null
  updated_at: string
}

type NotamItem = {
  id: string
  notamId: string
  type: string | null
  category: string | null
  subtype: string | null
  description: string | null
  facility: string | null
  facilityCode: string | null
  state: string | null
  location: string | null
  startsAt: string | null
  endsAt: string | null
  issuedAt: string | null
  rawText: string | null
  geomType: string | null
  centerLat: number | null
  centerLon: number | null
  radiusNm: number | null
  featureLat: number | null
  featureLon: number | null
  mapLat: number | null
  mapLon: number | null
  geojson: Record<string, unknown> | null
  accountId: string | null
  affectedFir: string | null
  selectionCode: string | null
  traffic: string | null
  purpose: string | null
  scope: string | null
  minimumFl: string | null
  maximumFl: string | null
  structureType: string | null
  structureDesignator: string | null
  structureAsr: string | null
  structureHeightFt: number | null
  structureElevationFt: number | null
  lightingPresent: boolean | null
  lightingStatus: string | null
  ownerName: string | null
  ownerSource: string | null
  ownerLastCheckedAt: string | null
}

type NotamResponse = {
  items?: NotamItem[]
  fetchedAt?: string
  source?: string
  message?: string
  error?: string
  nextSteps?: string[]
}

const buildNotConfiguredResponse = (): NotamResponse => ({
  error: "SWIFT NOTAM ingest not configured",
  nextSteps: [
    "Apply the `notam_feed` migration to create NOTAM storage in Supabase.",
    "Set the `NOTAM_INGEST_TOKEN` secret for the `notam-ingest` Edge Function.",
    "Deploy the `notam` and `notam-ingest` Edge Functions.",
    "Create an approved SWIFT Portal / SCDS subscription for the NOTAM feed and collect the queue connection details.",
    "Run an external SWIFT/SCDS consumer that reads the subscription queue and posts normalized NOTAM batches into `notam-ingest`.",
  ],
})

const NOTAM_SELECT_COLUMNS =
  "id, notam_id, facility_icao, facility_code, type, category, subtype, description, state, location, starts_at, ends_at, issued_at, raw_text, geom_type, center_lat, center_lon, radius_nm, feature_lat, feature_lon, geojson, account_id, affected_fir, selection_code, traffic, purpose, scope, minimum_fl, maximum_fl, structure_type, structure_designator, structure_asr, structure_height_ft, structure_elevation_ft, lighting_present, lighting_status, owner_name, owner_source, owner_last_checked_at, source, updated_at"

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
}: {
  lat: number
  lon: number
  radiusMiles: number
}) => `notam:swift:${lat.toFixed(4)}:${lon.toFixed(4)}:${radiusMiles.toFixed(1)}`

const buildLatLonBounds = (lat: number, lon: number, radiusMiles: number) => {
  const latDelta = radiusMiles / 69
  const lonDelta = radiusMiles / Math.max(69 * Math.cos((lat * Math.PI) / 180), 0.01)

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  }
}

const parseDateMs = (value: string | null | undefined) => {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

const overlapsWindow = (
  row: Pick<NotamFeedRow, "starts_at" | "ends_at" | "updated_at">,
  windowStartMs: number,
  windowEndMs: number
) => {
  const startsAtMs = parseDateMs(row.starts_at)
  const endsAtMs = parseDateMs(row.ends_at)
  const updatedAtMs = parseDateMs(row.updated_at) ?? Date.now()

  if (startsAtMs === null && endsAtMs === null) {
    return updatedAtMs >= windowStartMs
  }
  if (startsAtMs !== null && startsAtMs > windowEndMs) {
    return false
  }
  if (endsAtMs !== null && endsAtMs < windowStartMs) {
    return false
  }
  return true
}

const EARTH_RADIUS_NM = 3440.065

const asObject = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const buildPointGeometry = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon)
    ? ({ type: "Point", coordinates: [lon, lat] } as Record<string, unknown>)
    : null

const buildCircleGeometry = (centerLat: number, centerLon: number, radiusNm: number) => {
  if (
    !Number.isFinite(centerLat) ||
    !Number.isFinite(centerLon) ||
    !Number.isFinite(radiusNm) ||
    radiusNm <= 0
  ) {
    return null
  }

  const angularDistance = radiusNm / EARTH_RADIUS_NM
  const lat1 = (centerLat * Math.PI) / 180
  const lon1 = (centerLon * Math.PI) / 180
  const coordinates: number[][] = []

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

    coordinates.push([
      ((((lon2 * 180) / Math.PI) + 540) % 360) - 180,
      (lat2 * 180) / Math.PI,
    ])
  }

  return {
    type: "Polygon",
    coordinates: [coordinates],
  } as Record<string, unknown>
}

const resolveGeomType = (row: NotamFeedRow) => {
  const explicit = row.geom_type?.trim().toLowerCase()
  if (explicit) return explicit
  if (
    typeof row.center_lat === "number" &&
    typeof row.center_lon === "number" &&
    typeof row.radius_nm === "number"
  ) {
    return "circle"
  }
  if (typeof row.feature_lat === "number" && typeof row.feature_lon === "number") {
    return "point"
  }
  return null
}

const resolveGeojson = (row: NotamFeedRow) => {
  const stored = asObject(row.geojson)
  if (stored) return stored

  if (
    typeof row.center_lat === "number" &&
    typeof row.center_lon === "number" &&
    typeof row.radius_nm === "number"
  ) {
    return buildCircleGeometry(row.center_lat, row.center_lon, row.radius_nm)
  }
  if (typeof row.feature_lat === "number" && typeof row.feature_lon === "number") {
    return buildPointGeometry(row.feature_lat, row.feature_lon)
  }

  return null
}

const resolveMapPoint = (
  row: NotamFeedRow,
  nearbyStationsByIcao: Map<string, NearbyStation>
) => {
  if (typeof row.feature_lat === "number" && typeof row.feature_lon === "number") {
    return { mapLat: row.feature_lat, mapLon: row.feature_lon }
  }
  if (typeof row.center_lat === "number" && typeof row.center_lon === "number") {
    return { mapLat: row.center_lat, mapLon: row.center_lon }
  }

  const facility = row.facility_icao?.toUpperCase() ?? ""
  const station = facility ? nearbyStationsByIcao.get(facility) : null
  if (!station) {
    return { mapLat: null, mapLon: null }
  }

  return {
    mapLat: station.lat,
    mapLon: station.lon,
  }
}

const isStructurePriorityRow = (row: NotamFeedRow) =>
  Boolean(
    row.structure_type ||
      row.structure_asr ||
      row.lighting_status ||
      typeof row.lighting_present === "boolean"
  )

const isGeometryRow = (row: NotamFeedRow) =>
  Boolean(
    (typeof row.feature_lat === "number" && typeof row.feature_lon === "number") ||
      (typeof row.center_lat === "number" && typeof row.center_lon === "number")
  )

const compareRows = (a: NotamFeedRow, b: NotamFeedRow) => {
  const aPriority = isStructurePriorityRow(a) ? 0 : isGeometryRow(a) ? 1 : 2
  const bPriority = isStructurePriorityRow(b) ? 0 : isGeometryRow(b) ? 1 : 2

  if (aPriority !== bPriority) {
    return aPriority - bPriority
  }

  const aStartsAt = parseDateMs(a.starts_at) ?? Number.MAX_SAFE_INTEGER
  const bStartsAt = parseDateMs(b.starts_at) ?? Number.MAX_SAFE_INTEGER
  if (aStartsAt !== bStartsAt) {
    return aStartsAt - bStartsAt
  }

  const aUpdatedAt = parseDateMs(a.updated_at) ?? 0
  const bUpdatedAt = parseDateMs(b.updated_at) ?? 0
  return bUpdatedAt - aUpdatedAt
}

const isWithinGeometryRange = (
  row: NotamFeedRow,
  lat: number,
  lon: number,
  radiusMiles: number
) => {
  if (typeof row.feature_lat === "number" && typeof row.feature_lon === "number") {
    return haversineMiles(lat, lon, row.feature_lat, row.feature_lon) <= radiusMiles
  }

  if (typeof row.center_lat === "number" && typeof row.center_lon === "number") {
    const centerDistance = haversineMiles(lat, lon, row.center_lat, row.center_lon)
    const rowRadiusMiles =
      typeof row.radius_nm === "number" && row.radius_nm > 0 ? row.radius_nm * NM_TO_MILES : 0

    return centerDistance <= radiusMiles + rowRadiusMiles
  }

  return false
}

const mergeRows = (...batches: NotamFeedRow[][]) => {
  const seen = new Set<string>()
  const rows: NotamFeedRow[] = []

  for (const batch of batches) {
    for (const row of batch) {
      const id = row.id || row.notam_id
      if (!id || seen.has(id)) continue
      seen.add(id)
      rows.push(row)
    }
  }

  return rows
}

const fetchGeometryRows = async (
  db: SupabaseClient,
  lat: number,
  lon: number,
  radiusMiles: number
) => {
  const { minLat, maxLat, minLon, maxLon } = buildLatLonBounds(lat, lon, radiusMiles)

  const [featureResult, centerResult] = await Promise.all([
    db
      .from("notam_feed")
      .select(NOTAM_SELECT_COLUMNS)
      .gte("feature_lat", minLat)
      .lte("feature_lat", maxLat)
      .gte("feature_lon", minLon)
      .lte("feature_lon", maxLon)
      .limit(NOTAM_QUERY_LIMIT),
    db
      .from("notam_feed")
      .select(NOTAM_SELECT_COLUMNS)
      .gte("center_lat", minLat)
      .lte("center_lat", maxLat)
      .gte("center_lon", minLon)
      .lte("center_lon", maxLon)
      .limit(NOTAM_QUERY_LIMIT),
  ])

  if (featureResult.error) {
    throw new Error(`Failed querying geometry-backed NOTAM rows: ${featureResult.error.message}`)
  }
  if (centerResult.error) {
    throw new Error(`Failed querying centered NOTAM rows: ${centerResult.error.message}`)
  }

  return mergeRows(
    (featureResult.data ?? []) as NotamFeedRow[],
    (centerResult.data ?? []) as NotamFeedRow[]
  ).filter((row) => isWithinGeometryRange(row, lat, lon, radiusMiles))
}

const fetchAirportRows = async (db: SupabaseClient, icaos: string[]) => {
  if (icaos.length === 0) return []

  const { data, error } = await db
    .from("notam_feed")
    .select(NOTAM_SELECT_COLUMNS)
    .in("facility_icao", icaos)
    .limit(NOTAM_QUERY_LIMIT)

  if (error) {
    throw new Error(`Failed querying airport-linked NOTAM rows: ${error.message}`)
  }

  return (data ?? []) as NotamFeedRow[]
}

const mapRowToNotamItem = (
  row: NotamFeedRow,
  nearbyStationsByIcao: Map<string, NearbyStation>
): NotamItem => {
  const geomType = resolveGeomType(row)
  const { mapLat, mapLon } = resolveMapPoint(row, nearbyStationsByIcao)

  return {
    id: normalizeNotamId(row.id),
    notamId: normalizeNotamId(row.notam_id),
    type: row.type,
    category: row.category,
    subtype: row.subtype,
    description: row.description,
    facility: row.facility_icao,
    facilityCode: row.facility_code,
    state: row.state,
    location: row.location,
    startsAt: safeIsoString(row.starts_at),
    endsAt: safeIsoString(row.ends_at),
    issuedAt: safeIsoString(row.issued_at),
    rawText: row.raw_text,
    geomType,
    centerLat: row.center_lat,
    centerLon: row.center_lon,
    radiusNm: row.radius_nm,
    featureLat: row.feature_lat,
    featureLon: row.feature_lon,
    mapLat,
    mapLon,
    geojson: resolveGeojson(row),
    accountId: row.account_id,
    affectedFir: row.affected_fir,
    selectionCode: row.selection_code,
    traffic: row.traffic,
    purpose: row.purpose,
    scope: row.scope,
    minimumFl: row.minimum_fl,
    maximumFl: row.maximum_fl,
    structureType: row.structure_type,
    structureDesignator: row.structure_designator,
    structureAsr: row.structure_asr,
    structureHeightFt: row.structure_height_ft,
    structureElevationFt: row.structure_elevation_ft,
    lightingPresent: row.lighting_present,
    lightingStatus: row.lighting_status,
    ownerName: row.owner_name,
    ownerSource: row.owner_source,
    ownerLastCheckedAt: safeIsoString(row.owner_last_checked_at),
  }
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

    const db = createServiceRoleClient()
    const nearbyStations = await findNearbyStations(
      db,
      lat,
      lon,
      radiusMiles,
      NOTAM_NEARBY_AIRPORT_LIMIT
    )
    const selectedIcaos = nearbyStations.map((station) => station.icaoId)
    const nearbyStationsByIcao = new Map(nearbyStations.map((station) => [station.icaoId, station]))

    const cacheKey = buildFinalCacheKey({
      lat,
      lon,
      radiusMiles,
    })
    const cached = await getCachedJson<NotamResponse>(db, cacheKey)
    if (cached) {
      return jsonResponse(request, cached)
    }

    const airportRows = await fetchAirportRows(db, selectedIcaos)
    const geometryRows = await fetchGeometryRows(db, lat, lon, radiusMiles)

    const now = Date.now()
    const windowStartMs = now - NOTAM_LOOKBACK_HOURS * 60 * 60 * 1000
    const windowEndMs = now + NOTAM_LOOKAHEAD_HOURS * 60 * 60 * 1000
    const rows = mergeRows(geometryRows, airportRows)
      .filter((row) => overlapsWindow(row, windowStartMs, windowEndMs))
      .sort(compareRows)
      .slice(0, 250)

    const responsePayload: NotamResponse = {
      items: rows.map((row) => mapRowToNotamItem(row, nearbyStationsByIcao)),
      fetchedAt: new Date().toISOString(),
      source: rows[0]?.source ?? "swift-scds",
      ...(rows.length === 0
        ? {
            message:
              selectedIcaos.length === 0
                ? "No nearby US airports or geometry-backed NOTAMs were found in the selected radius."
                : "No normalized NOTAM records are available yet for the selected radius. The SWIFT ingest pipeline may still be pending configuration or the feed has not delivered matching NOTAMs yet.",
          }
        : {}),
    }

    await setCachedJson(db, cacheKey, responsePayload, NOTAM_CACHE_TTL_SECONDS)
    return jsonResponse(request, responsePayload)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error."
    return jsonResponse(request, { error: message }, 502)
  }
})
