import {
  createServiceRoleClient,
  getCachedJson,
  jsonResponse,
  normalizeNotamId,
  optionsResponse,
  setCachedJson,
  withTimeoutFetch,
} from "../_shared/aviation.ts"

// ---------------------------------------------------------------------------
// NMS-API GeoJSON types
// ---------------------------------------------------------------------------

type NmsNotamCore = {
  id?: string
  number?: string
  series?: string
  year?: string
  type?: string
  issued?: string
  affectedFir?: string
  selectionCode?: string
  traffic?: string
  purpose?: string
  scope?: string
  minimumFl?: string
  maximumFl?: string
  location?: string
  icaoLocation?: string
  effectiveStart?: string
  effectiveEnd?: string
  text?: string
  classification?: string
  accountId?: string
  lastUpdated?: string
  coordinates?: string
  radius?: string
  lowerLimit?: string
  upperLimit?: string
  schedule?: string
  cancelationDate?: string
  estimated?: string
}

type NmsTranslation = {
  type?: string
  domestic_message?: string
  icao_message?: string
}

type NmsGeometry = {
  type: string
  coordinates?: unknown
  geometries?: NmsGeometry[]
}

type NmsFeature = {
  type: "Feature"
  properties?: {
    coreNOTAMData?: {
      notam?: NmsNotamCore
      notamTranslation?: NmsTranslation[]
      notamEvent?: { encoding?: string; scenario?: string }
    }
  }
  geometry?: NmsGeometry
}

type NmsSearchResponse = {
  status: string
  errors?: Array<{ message?: string }>
  data?: {
    geojson?: NmsFeature[]
    url?: string
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NMS_AUTH_URL =
  "https://api-staging.cgifederal-aim.com/v1/auth/token" // NO /nmsapi prefix for auth
const NMS_API_URL =
  "https://api-staging.cgifederal-aim.com/nmsapi/v1" // /nmsapi prefix for data

const TOKEN_CACHE_KEY = "nms-api:oauth-token"
const TOKEN_CACHE_TTL = 1500 // 25 min (token expires in 1799s ≈ 30 min)
const NMS_TIMEOUT_MS = 25_000
const UPSERT_BATCH_SIZE = 500
const DELTA_WINDOW_MINUTES = 30

// Drone-relevant NOTAM feature codes
const DRONE_FEATURES = ["OBST", "AIRSPACE", "SECURITY", "SPECIAL", "RWY"] as const
const CLASSIFICATIONS = ["DOMESTIC", "FDC"] as const

// ---------------------------------------------------------------------------
// Auth token check (same as before — pg_cron / manual trigger auth)
// ---------------------------------------------------------------------------

const readAuthToken = (request: Request) => {
  const authHeader = request.headers.get("authorization") ?? ""
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch) return bearerMatch[1].trim()
  return (request.headers.get("x-sync-token") ?? "").trim()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const asString = (v: unknown): string | null => {
  if (typeof v === "string") {
    const trimmed = v.trim()
    return trimmed || null
  }
  return null
}

// Like safeIsoString but returns null (not the raw string) for unparseable values
// Handles NOTAM-specific values like "PERM" that aren't valid timestamps
const safeTimestamp = (v: string | null): string | null => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// ---------------------------------------------------------------------------
// OAuth2 token helper
// ---------------------------------------------------------------------------

type DbClient = ReturnType<typeof createServiceRoleClient>

const getAccessToken = async (
  db: DbClient,
  clientId: string,
  clientSecret: string,
): Promise<string> => {
  // Check cache first
  const cached = await getCachedJson<string>(db, TOKEN_CACHE_KEY)
  if (cached) return cached

  // Request new token via client credentials grant
  const credentials = btoa(`${clientId}:${clientSecret}`)
  const res = await withTimeoutFetch(
    NMS_AUTH_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    },
    NMS_TIMEOUT_MS,
  )

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `NMS-API auth failed (${res.status}): ${body.slice(0, 300)}`,
    )
  }

  const json = await res.json()
  const token = json.access_token
  if (typeof token !== "string" || !token) {
    throw new Error("NMS-API auth response missing access_token")
  }

  // Cache the token (25 min, safely under 30 min expiry)
  await setCachedJson(db, TOKEN_CACHE_KEY, token, TOKEN_CACHE_TTL)
  return token
}

// ---------------------------------------------------------------------------
// NMS fetch helper
// ---------------------------------------------------------------------------

const fetchNmsNotams = async (
  token: string,
  params: Record<string, string>,
): Promise<NmsFeature[]> => {
  const qs = new URLSearchParams(params).toString()
  const url = `${NMS_API_URL}/notams?${qs}`

  const res = await withTimeoutFetch(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        nmsResponseFormat: "GEOJSON",
      },
    },
    NMS_TIMEOUT_MS,
  )

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `NMS-API ${res.status} for ${qs}: ${body.slice(0, 300)}`,
    )
  }

  const json = (await res.json()) as NmsSearchResponse

  if (json.status !== "Success") {
    const errMsg = json.errors?.map((e) => e.message).join("; ") ?? "unknown"
    throw new Error(`NMS-API error: ${errMsg}`)
  }

  return json.data?.geojson ?? []
}

// ---------------------------------------------------------------------------
// ICAO coordinate parser — "404358N0735849W" → { lat, lon }
// ---------------------------------------------------------------------------

const parseIcaoCoordinates = (
  coord: string | null | undefined,
): { lat: number; lon: number } | null => {
  if (!coord) return null
  // Format: DDMMSS[.ss][N/S]DDDMMSS[.ss][E/W]  or  DDMM[N/S]DDDMM[E/W]
  const m = coord.match(
    /^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)?([NS])(\d{3})(\d{2})(\d{2}(?:\.\d+)?)?([EW])$/,
  )
  if (!m) return null

  const latDeg = parseInt(m[1], 10)
  const latMin = parseInt(m[2], 10)
  const latSec = m[3] ? parseFloat(m[3]) : 0
  const latSign = m[4] === "N" ? 1 : -1

  const lonDeg = parseInt(m[5], 10)
  const lonMin = parseInt(m[6], 10)
  const lonSec = m[7] ? parseFloat(m[7]) : 0
  const lonSign = m[8] === "E" ? 1 : -1

  const lat = latSign * (latDeg + latMin / 60 + latSec / 3600)
  const lon = lonSign * (lonDeg + lonMin / 60 + lonSec / 3600)

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 }
}

// ---------------------------------------------------------------------------
// Geometry extractor — pull lat/lon from GeometryCollection
// ---------------------------------------------------------------------------

type ExtractedGeometry = {
  featureLat: number | null
  featureLon: number | null
  centerLat: number | null
  centerLon: number | null
  geojson: Record<string, unknown> | null
  geomType: string | null
}

const extractGeometry = (feature: NmsFeature): ExtractedGeometry => {
  const result: ExtractedGeometry = {
    featureLat: null,
    featureLon: null,
    centerLat: null,
    centerLon: null,
    geojson: null,
    geomType: null,
  }

  const geom = feature.geometry
  if (!geom) {
    // Fallback: parse ICAO coordinates string from notam data
    const coords = parseIcaoCoordinates(
      feature.properties?.coreNOTAMData?.notam?.coordinates,
    )
    if (coords) {
      result.featureLat = coords.lat
      result.featureLon = coords.lon
      result.geomType = "point"
    }
    return result
  }

  result.geojson = geom as unknown as Record<string, unknown>

  if (geom.type === "GeometryCollection" && Array.isArray(geom.geometries)) {
    for (const sub of geom.geometries) {
      if (
        sub.type === "Point" &&
        Array.isArray(sub.coordinates) &&
        sub.coordinates.length >= 2
      ) {
        const [lon, lat] = sub.coordinates as number[]
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          result.featureLat = lat
          result.featureLon = lon
          result.geomType = "point"
        }
      } else if (
        sub.type === "Polygon" &&
        Array.isArray(sub.coordinates)
      ) {
        // Compute centroid from first ring
        const ring = (sub.coordinates as number[][][])[0]
        if (Array.isArray(ring) && ring.length > 0) {
          let sumLat = 0
          let sumLon = 0
          for (const [lon, lat] of ring) {
            sumLat += lat
            sumLon += lon
          }
          result.centerLat = Math.round((sumLat / ring.length) * 1e6) / 1e6
          result.centerLon = Math.round((sumLon / ring.length) * 1e6) / 1e6
          if (!result.geomType) result.geomType = "polygon"
        }
      }
    }
  } else if (
    geom.type === "Point" &&
    Array.isArray(geom.coordinates) &&
    geom.coordinates.length >= 2
  ) {
    const [lon, lat] = geom.coordinates as number[]
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      result.featureLat = lat
      result.featureLon = lon
      result.geomType = "point"
    }
  }

  // If we got a polygon centroid but no point, use centroid as feature coords
  if (result.featureLat === null && result.centerLat !== null) {
    result.featureLat = result.centerLat
    result.featureLon = result.centerLon
  }

  // If we still have no coords, try ICAO coordinate string
  if (result.featureLat === null) {
    const coords = parseIcaoCoordinates(
      feature.properties?.coreNOTAMData?.notam?.coordinates,
    )
    if (coords) {
      result.featureLat = coords.lat
      result.featureLon = coords.lon
      if (!result.geomType) result.geomType = "point"
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Field mapper — NMS Feature → notam_feed row
// ---------------------------------------------------------------------------

const normalizeNmsItem = (
  feature: NmsFeature,
  nowIso: string,
): Record<string, unknown> | null => {
  const core = feature.properties?.coreNOTAMData?.notam
  if (!core) return null

  const rawId = asString(core.id) ?? asString(core.number)
  if (!rawId) return null

  const notamId = normalizeNotamId(rawId)
  const selectionCode = asString(core.selectionCode)
  const geo = extractGeometry(feature)

  // Build description: prefer domestic_message, then icao_message, then raw text
  const translations = feature.properties?.coreNOTAMData?.notamTranslation
  const domesticMsg = translations?.find(
    (t) => t.type === "LOCAL_FORMAT",
  )?.domestic_message
  const icaoMsg = translations?.find((t) => t.type === "ICAO")?.icao_message
  const description =
    asString(domesticMsg) ?? asString(icaoMsg) ?? asString(core.text)

  return {
    id: notamId,
    notam_id: notamId,
    facility_icao:
      (asString(core.icaoLocation) ?? asString(core.location))?.toUpperCase() ??
      null,
    facility_code:
      (asString(core.icaoLocation) ?? asString(core.location))?.toUpperCase() ??
      null,
    type: asString(core.type),
    category: asString(core.classification),
    subtype: selectionCode,
    description,
    state: null,
    location: asString(core.location),
    starts_at: safeTimestamp(asString(core.effectiveStart)),
    ends_at: safeTimestamp(asString(core.effectiveEnd)),
    issued_at: safeTimestamp(asString(core.issued)),
    raw_text: asString(core.text),
    source: "nms-api",
    geom_type: geo.geomType,
    feature_lat: geo.featureLat,
    feature_lon: geo.featureLon,
    center_lat: geo.centerLat,
    center_lon: geo.centerLon,
    geojson: geo.geojson,
    radius_nm: asString(core.radius) ? Number(core.radius) || null : null,
    account_id: asString(core.accountId),
    affected_fir: asString(core.affectedFir),
    selection_code: selectionCode,
    traffic: asString(core.traffic),
    purpose: asString(core.purpose),
    scope: asString(core.scope),
    minimum_fl: asString(core.minimumFl),
    maximum_fl: asString(core.maximumFl),
    payload: { nms: feature.properties?.coreNOTAMData },
    updated_at: nowIso,
    ingested_at: nowIso,
  }
}

// ---------------------------------------------------------------------------
// Batch upsert helper
// ---------------------------------------------------------------------------

const upsertRows = async (
  db: DbClient,
  rows: Record<string, unknown>[],
  label: string,
): Promise<number> => {
  let synced = 0
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE)
    const { error } = await db
      .from("notam_feed")
      .upsert(batch, { onConflict: "id" })
    if (error) {
      throw new Error(`Upsert failed (${label}, batch ${i}): ${error.message}`)
    }
    synced += batch.length
  }
  return synced
}

// ---------------------------------------------------------------------------
// Sync strategies
// ---------------------------------------------------------------------------

const syncDelta = async (
  db: DbClient,
  token: string,
  nowIso: string,
): Promise<number> => {
  const deltaDate = new Date(
    Date.now() - DELTA_WINDOW_MINUTES * 60 * 1000,
  ).toISOString()

  let total = 0

  for (const classification of CLASSIFICATIONS) {
    for (const feature of DRONE_FEATURES) {
      const features = await fetchNmsNotams(token, {
        classification,
        feature,
        lastUpdatedDate: deltaDate,
      })

      if (features.length === 0) continue

      const rows = features
        .map((f) => normalizeNmsItem(f, nowIso))
        .filter((r): r is Record<string, unknown> => r !== null)

      if (rows.length > 0) {
        total += await upsertRows(
          db,
          rows,
          `delta/${classification}/${feature}`,
        )
      }
    }
  }

  return total
}

const syncBootstrap = async (
  db: DbClient,
  token: string,
  nowIso: string,
): Promise<number> => {
  let total = 0

  // For bootstrap, fetch all active NOTAMs per classification + feature
  // (using feature as second param ensures inline data, not a redirect URL)
  for (const classification of CLASSIFICATIONS) {
    for (const feature of DRONE_FEATURES) {
      const features = await fetchNmsNotams(token, {
        classification,
        feature,
      })

      if (features.length === 0) continue

      const rows = features
        .map((f) => normalizeNmsItem(f, nowIso))
        .filter((r): r is Record<string, unknown> => r !== null)

      if (rows.length > 0) {
        total += await upsertRows(
          db,
          rows,
          `bootstrap/${classification}/${feature}`,
        )
      }
    }
  }

  return total
}

const runSync = async (
  db: DbClient,
  token: string,
  nowIso: string,
  forceBootstrap = false,
): Promise<{ synced: number; mode: string }> => {
  if (forceBootstrap) {
    const synced = await syncBootstrap(db, token, nowIso)
    return { synced, mode: "bootstrap (forced)" }
  }

  // Check if we have any NMS-sourced rows already
  const { count } = await db
    .from("notam_feed")
    .select("id", { count: "exact", head: true })
    .eq("source", "nms-api")

  const hasData = (count ?? 0) > 0
  const mode = hasData ? "delta" : "bootstrap"

  const synced = hasData
    ? await syncDelta(db, token, nowIso)
    : await syncBootstrap(db, token, nowIso)

  return { synced, mode }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request)
  }
  if (request.method !== "POST" && request.method !== "GET") {
    return jsonResponse(request, { error: "Method not allowed. Use POST or GET." }, 405)
  }

  // Optional bearer token check — enforced only if NOTAM_SYNC_TOKEN is set
  const expectedToken = (Deno.env.get("NOTAM_SYNC_TOKEN") ?? "").trim()
  if (expectedToken) {
    const providedToken = readAuthToken(request)
    if (!providedToken || providedToken !== expectedToken) {
      return jsonResponse(request, { error: "Unauthorized." }, 401)
    }
  }

  // NMS-API OAuth2 credentials
  const clientId = (Deno.env.get("NMS_API_CLIENT_ID") ?? "").trim()
  const clientSecret = (Deno.env.get("NMS_API_CLIENT_SECRET") ?? "").trim()

  if (!clientId || !clientSecret) {
    return jsonResponse(
      request,
      {
        error: "NMS-API credentials are not configured.",
        nextSteps: [
          "Set NMS_API_CLIENT_ID and NMS_API_CLIENT_SECRET as Supabase Edge Function secrets.",
          "These come from the NMS-API onboarding spreadsheet (KEY = client_id, SECRET = client_secret).",
        ],
      },
      501,
    )
  }

  const startedAt = Date.now()
  const nowIso = new Date().toISOString()

  try {
    const db = createServiceRoleClient()

    // Get OAuth2 access token (cached 25 min)
    const token = await getAccessToken(db, clientId, clientSecret)

    // Check for ?force=bootstrap query param
    const url = new URL(request.url)
    const forceBootstrap = url.searchParams.get("force") === "bootstrap"

    // Run sync (bootstrap on first run or if forced, delta thereafter)
    const { synced, mode } = await runSync(db, token, nowIso, forceBootstrap)

    // Prune expired / stale records
    let pruned = 0
    try {
      const { data: pruneResult } = await db.rpc("prune_notam_feed")
      pruned = typeof pruneResult === "number" ? pruneResult : 0
    } catch {
      // Non-fatal — prune will run on next cycle
    }

    return jsonResponse(request, {
      synced,
      pruned,
      mode,
      source: "nms-api",
      features: DRONE_FEATURES,
      classifications: CLASSIFICATIONS,
      fetchedAt: nowIso,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error."
    return jsonResponse(request, { error: message, durationMs: Date.now() - startedAt }, 502)
  }
})
