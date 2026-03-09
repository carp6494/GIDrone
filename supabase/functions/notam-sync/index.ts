import {
  createServiceRoleClient,
  jsonResponse,
  normalizeNotamId,
  optionsResponse,
  safeIsoString,
  withTimeoutFetch,
} from "../_shared/aviation.ts"

// ---------------------------------------------------------------------------
// FAA External API v2 types
// ---------------------------------------------------------------------------

type FaaNotamCore = {
  id?: string
  number?: string
  type?: string
  issued?: string
  selectionCode?: string
  traffic?: string
  purpose?: string
  scope?: string
  minimumFL?: string
  maximumFL?: string
  location?: string
  locationIdentifier?: string
  effectiveStart?: string
  effectiveEnd?: string
  text?: string
  classification?: string
  accountId?: string
  traditionalMessage?: string
  traditionalMessageFrom4thWord?: string
}

type FaaGeometry = {
  type?: string
  coordinates?: unknown
}

type FaaNotamItem = {
  properties?: {
    coreNOTAMData?: {
      notam?: FaaNotamCore
      notamTranslation?: Array<{ type?: string; simpleText?: string }>
      geometry?: FaaGeometry
    }
  }
}

type FaaPage = {
  pageNum?: number
  pageSize?: number
  totalCount?: number
  totalPages?: number
  items?: FaaNotamItem[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FAA_BASE_URL = "https://external-api.faa.gov/notamapi/v2/notams"
const PAGE_SIZE = 1000
const MAX_PAGES = 60            // safety cap: 60,000 NOTAMs max per sync
const UPSERT_BATCH_SIZE = 500   // rows per upsert call
const FAA_TIMEOUT_MS = 30_000

// Obstruction lighting subject codes we care about
const SUBJECT_CODES = ["OB", "LGT"] as const

// Map FAA selectionCode → human-readable structure_type
const SUBJECT_CODE_LABEL: Record<string, string> = {
  OB: "Obstacle",
  LGT: "Obstruction Lighting",
}

// ---------------------------------------------------------------------------
// Auth token check
// ---------------------------------------------------------------------------

const readAuthToken = (request: Request) => {
  const authHeader = request.headers.get("authorization") ?? ""
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch) return bearerMatch[1].trim()
  return (request.headers.get("x-sync-token") ?? "").trim()
}

// ---------------------------------------------------------------------------
// FAA API helpers
// ---------------------------------------------------------------------------

const buildFaaUrl = (
  clientId: string,
  clientSecret: string,
  subjectCode: string,
  pageNum: number
): string => {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    subjectCode,
    pageSize: String(PAGE_SIZE),
    pageNum: String(pageNum),
    // Fetch only active NOTAMs for US domestic airspace
    classification: "GENERAL,DOMESTIC,FDC",
    sortBy: "effectiveStartDate",
    sortOrder: "Asc",
  })
  return `${FAA_BASE_URL}?${params.toString()}`
}

const asString = (v: unknown): string | null => {
  if (typeof v === "string") {
    const trimmed = v.trim()
    return trimmed || null
  }
  return null
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const parsed = Number(v.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

// Extract lat/lon from a GeoJSON geometry if it's a Point
const extractPointCoords = (
  geom: FaaGeometry | undefined
): { featureLat: number | null; featureLon: number | null; geojson: Record<string, unknown> | null } => {
  if (!geom || geom.type !== "Point" || !Array.isArray(geom.coordinates)) {
    return { featureLat: null, featureLon: null, geojson: geom ? (geom as Record<string, unknown>) : null }
  }
  const [lon, lat] = geom.coordinates as number[]
  return {
    featureLat: typeof lat === "number" && Number.isFinite(lat) ? lat : null,
    featureLon: typeof lon === "number" && Number.isFinite(lon) ? lon : null,
    geojson: geom as Record<string, unknown>,
  }
}

// Normalize one FAA NOTAM item into a notam_feed row
const normalizeItem = (item: FaaNotamItem, nowIso: string): Record<string, unknown> | null => {
  const core = item.properties?.coreNOTAMData?.notam
  if (!core) return null

  const rawId = asString(core.id) ?? asString(core.number)
  if (!rawId) return null

  const notamId = normalizeNotamId(rawId)
  const selectionCode = asString(core.selectionCode)
  const { featureLat, featureLon, geojson } = extractPointCoords(
    item.properties?.coreNOTAMData?.geometry
  )

  // Build description: prefer translated text, fall back to raw text
  const translation = item.properties?.coreNOTAMData?.notamTranslation?.find(
    (t) => t.type === "ICAO"
  )?.simpleText ?? item.properties?.coreNOTAMData?.notamTranslation?.[0]?.simpleText
  const description = asString(translation) ?? asString(core.text) ?? asString(core.traditionalMessageFrom4thWord)

  return {
    id: notamId,
    notam_id: notamId,
    facility_icao: (asString(core.locationIdentifier) ?? asString(core.location))?.toUpperCase() ?? null,
    facility_code: (asString(core.locationIdentifier) ?? asString(core.location))?.toUpperCase() ?? null,
    type: asString(core.type),
    category: "OBSTRUCTION",
    subtype: selectionCode,
    description,
    state: null,
    location: asString(core.location),
    starts_at: safeIsoString(asString(core.effectiveStart)),
    ends_at: safeIsoString(asString(core.effectiveEnd)),
    issued_at: safeIsoString(asString(core.issued)),
    raw_text: asString(core.text) ?? asString(core.traditionalMessage),
    source: "faa-external-api",
    geom_type: featureLat !== null ? "point" : null,
    feature_lat: featureLat,
    feature_lon: featureLon,
    geojson,
    center_lat: null,
    center_lon: null,
    radius_nm: null,
    account_id: asString(core.accountId),
    affected_fir: null,
    selection_code: selectionCode,
    traffic: asString(core.traffic),
    purpose: asString(core.purpose),
    scope: asString(core.scope),
    minimum_fl: asString(core.minimumFL),
    maximum_fl: asString(core.maximumFL),
    structure_type: selectionCode ? (SUBJECT_CODE_LABEL[selectionCode] ?? null) : null,
    structure_designator: null,
    structure_asr: null,
    structure_height_ft: null,
    structure_elevation_ft: null,
    lighting_present: selectionCode === "LGT" ? true : null,
    lighting_status: selectionCode === "LGT" ? (description ?? null) : null,
    owner_name: null,
    owner_source: null,
    owner_last_checked_at: null,
    payload: { faa: core },
    updated_at: nowIso,
    ingested_at: nowIso,
  }
}

// Fetch one page from the FAA API
const fetchPage = async (
  clientId: string,
  clientSecret: string,
  subjectCode: string,
  pageNum: number
): Promise<FaaPage> => {
  const url = buildFaaUrl(clientId, clientSecret, subjectCode, pageNum)
  const res = await withTimeoutFetch(url, {
    headers: { Accept: "application/json" },
  }, FAA_TIMEOUT_MS)

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`FAA API ${res.status} for subjectCode=${subjectCode} page=${pageNum}: ${body.slice(0, 300)}`)
  }

  return await res.json() as FaaPage
}

// ---------------------------------------------------------------------------
// Main sync logic
// ---------------------------------------------------------------------------

const syncSubjectCode = async (
  db: ReturnType<typeof createServiceRoleClient>,
  clientId: string,
  clientSecret: string,
  subjectCode: string,
  nowIso: string
): Promise<number> => {
  let totalSynced = 0
  let pageNum = 1

  while (pageNum <= MAX_PAGES) {
    const page = await fetchPage(clientId, clientSecret, subjectCode, pageNum)
    const items = page.items ?? []

    if (items.length === 0) break

    // Normalize
    const rows = items
      .map((item) => normalizeItem(item, nowIso))
      .filter((row): row is Record<string, unknown> => row !== null)

    // Upsert in batches
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + UPSERT_BATCH_SIZE)
      const { error } = await db.from("notam_feed").upsert(batch, { onConflict: "id" })
      if (error) {
        throw new Error(`Failed upserting notam_feed batch (subjectCode=${subjectCode}, page=${pageNum}): ${error.message}`)
      }
    }

    totalSynced += rows.length

    // Check if there are more pages
    const totalPages = page.totalPages ?? 1
    if (pageNum >= totalPages) break
    pageNum++
  }

  return totalSynced
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

  // Optional bearer token check — enforced only if NOTAM_SYNC_TOKEN is configured
  const expectedToken = (Deno.env.get("NOTAM_SYNC_TOKEN") ?? "").trim()
  if (expectedToken) {
    const providedToken = readAuthToken(request)
    if (!providedToken || providedToken !== expectedToken) {
      return jsonResponse(request, { error: "Unauthorized." }, 401)
    }
  }

  const clientId = (Deno.env.get("FAA_NOTAM_CLIENT_ID") ?? "").trim()
  const clientSecret = (Deno.env.get("FAA_NOTAM_CLIENT_SECRET") ?? "").trim()

  if (!clientId || !clientSecret) {
    return jsonResponse(
      request,
      {
        error: "FAA API credentials are not configured.",
        nextSteps: [
          "Register for a free API key at https://api.faa.gov/",
          "Add FAA_NOTAM_CLIENT_ID and FAA_NOTAM_CLIENT_SECRET as Supabase Edge Function secrets.",
          "Redeploy the notam-sync function after adding the secrets.",
        ],
      },
      501
    )
  }

  const startedAt = Date.now()
  const nowIso = new Date().toISOString()

  try {
    const db = createServiceRoleClient()
    let totalSynced = 0

    // Fetch obstruction + lighting NOTAMs in sequence
    for (const code of SUBJECT_CODES) {
      totalSynced += await syncSubjectCode(db, clientId, clientSecret, code, nowIso)
    }

    // Prune expired / stale records
    let pruned = 0
    try {
      const { data: pruneResult } = await db.rpc("prune_notam_feed")
      pruned = typeof pruneResult === "number" ? pruneResult : 0
    } catch {
      // Non-fatal — prune will run on next cycle
    }

    return jsonResponse(request, {
      synced: totalSynced,
      pruned,
      subjectCodes: SUBJECT_CODES,
      fetchedAt: nowIso,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error."
    return jsonResponse(request, { error: message, durationMs: Date.now() - startedAt }, 502)
  }
})
