import {
  createServiceRoleClient,
  jsonResponse,
  normalizeNotamId,
  optionsResponse,
  readJsonObjectBody,
  safeIsoString,
} from "../_shared/aviation.ts"

type IngestNotamItem = {
  id?: unknown
  notamId?: unknown
  facility?: unknown
  facilityIcao?: unknown
  facilityCode?: unknown
  type?: unknown
  category?: unknown
  subtype?: unknown
  description?: unknown
  state?: unknown
  location?: unknown
  startsAt?: unknown
  endsAt?: unknown
  issuedAt?: unknown
  rawText?: unknown
  source?: unknown
  geomType?: unknown
  centerLat?: unknown
  centerLon?: unknown
  radiusNm?: unknown
  featureLat?: unknown
  featureLon?: unknown
  geojson?: unknown
  accountId?: unknown
  affectedFir?: unknown
  selectionCode?: unknown
  traffic?: unknown
  purpose?: unknown
  scope?: unknown
  minimumFl?: unknown
  maximumFl?: unknown
  structureType?: unknown
  structureDesignator?: unknown
  structureAsr?: unknown
  structureHeightFt?: unknown
  structureElevationFt?: unknown
  lightingPresent?: unknown
  lightingStatus?: unknown
  ownerName?: unknown
  ownerSource?: unknown
  ownerLastCheckedAt?: unknown
  payload?: unknown
}

const readAuthToken = (request: Request) => {
  const authHeader = request.headers.get("authorization") ?? ""
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch) return bearerMatch[1].trim()
  return (request.headers.get("x-ingest-token") ?? "").trim()
}

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "")

const toNullableString = (value: unknown) => {
  const normalized = asString(value)
  return normalized ? normalized : null
}

const toNullableNumber = (value: unknown) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== "string") return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const toNullableBoolean = (value: unknown) => {
  if (typeof value === "boolean") return value
  if (typeof value === "number") {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  if (typeof value !== "string") return null

  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (["true", "1", "yes", "y"].includes(normalized)) return true
  if (["false", "0", "no", "n"].includes(normalized)) return false
  return null
}

const toNullableObject = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null

const hasOwn = (item: IngestNotamItem, key: keyof IngestNotamItem) =>
  Object.prototype.hasOwnProperty.call(item, key)

const includeColumn = (enabled: boolean, column: string, value: unknown) =>
  enabled && value !== null ? { [column]: value } : {}

const normalizeRow = (item: IngestNotamItem, nowIso: string) => {
  const notamId = normalizeNotamId(
    asString(item.notamId) || asString(item.id) || `${Date.now()}-${crypto.randomUUID()}`
  )
  const facilityIcao = (asString(item.facilityIcao) || asString(item.facility)).toUpperCase() || null
  const facilityCode =
    toNullableString(item.facilityCode) ?? toNullableString(item.facilityIcao) ?? facilityIcao

  return {
    id: notamId,
    notam_id: notamId,
    facility_icao: facilityIcao,
    facility_code: facilityCode,
    type: toNullableString(item.type),
    category: toNullableString(item.category),
    subtype: toNullableString(item.subtype),
    description: toNullableString(item.description),
    state: toNullableString(item.state),
    location: toNullableString(item.location),
    starts_at: safeIsoString(toNullableString(item.startsAt)),
    ends_at: safeIsoString(toNullableString(item.endsAt)),
    raw_text: toNullableString(item.rawText),
    source: toNullableString(item.source) ?? "swift-scds",
    ...includeColumn(
      hasOwn(item, "issuedAt"),
      "issued_at",
      safeIsoString(toNullableString(item.issuedAt))
    ),
    ...includeColumn(hasOwn(item, "geomType"), "geom_type", toNullableString(item.geomType)),
    ...includeColumn(hasOwn(item, "centerLat"), "center_lat", toNullableNumber(item.centerLat)),
    ...includeColumn(hasOwn(item, "centerLon"), "center_lon", toNullableNumber(item.centerLon)),
    ...includeColumn(hasOwn(item, "radiusNm"), "radius_nm", toNullableNumber(item.radiusNm)),
    ...includeColumn(
      hasOwn(item, "featureLat"),
      "feature_lat",
      toNullableNumber(item.featureLat)
    ),
    ...includeColumn(
      hasOwn(item, "featureLon"),
      "feature_lon",
      toNullableNumber(item.featureLon)
    ),
    ...includeColumn(hasOwn(item, "geojson"), "geojson", toNullableObject(item.geojson)),
    ...includeColumn(hasOwn(item, "accountId"), "account_id", toNullableString(item.accountId)),
    ...includeColumn(
      hasOwn(item, "affectedFir"),
      "affected_fir",
      toNullableString(item.affectedFir)
    ),
    ...includeColumn(
      hasOwn(item, "selectionCode"),
      "selection_code",
      toNullableString(item.selectionCode)
    ),
    ...includeColumn(hasOwn(item, "traffic"), "traffic", toNullableString(item.traffic)),
    ...includeColumn(hasOwn(item, "purpose"), "purpose", toNullableString(item.purpose)),
    ...includeColumn(hasOwn(item, "scope"), "scope", toNullableString(item.scope)),
    ...includeColumn(hasOwn(item, "minimumFl"), "minimum_fl", toNullableString(item.minimumFl)),
    ...includeColumn(hasOwn(item, "maximumFl"), "maximum_fl", toNullableString(item.maximumFl)),
    ...includeColumn(
      hasOwn(item, "structureType"),
      "structure_type",
      toNullableString(item.structureType)
    ),
    ...includeColumn(
      hasOwn(item, "structureDesignator"),
      "structure_designator",
      toNullableString(item.structureDesignator)
    ),
    ...includeColumn(
      hasOwn(item, "structureAsr"),
      "structure_asr",
      toNullableString(item.structureAsr)
    ),
    ...includeColumn(
      hasOwn(item, "structureHeightFt"),
      "structure_height_ft",
      toNullableNumber(item.structureHeightFt)
    ),
    ...includeColumn(
      hasOwn(item, "structureElevationFt"),
      "structure_elevation_ft",
      toNullableNumber(item.structureElevationFt)
    ),
    ...includeColumn(
      hasOwn(item, "lightingPresent"),
      "lighting_present",
      toNullableBoolean(item.lightingPresent)
    ),
    ...includeColumn(
      hasOwn(item, "lightingStatus"),
      "lighting_status",
      toNullableString(item.lightingStatus)
    ),
    ...includeColumn(hasOwn(item, "ownerName"), "owner_name", toNullableString(item.ownerName)),
    ...includeColumn(
      hasOwn(item, "ownerSource"),
      "owner_source",
      toNullableString(item.ownerSource)
    ),
    ...includeColumn(
      hasOwn(item, "ownerLastCheckedAt"),
      "owner_last_checked_at",
      safeIsoString(toNullableString(item.ownerLastCheckedAt))
    ),
    payload:
      item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
        ? item.payload
        : {},
    updated_at: nowIso,
    ingested_at: nowIso,
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request)
  }
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed. Use POST." }, 405)
  }

  try {
    const expectedToken = (Deno.env.get("NOTAM_INGEST_TOKEN") ?? "").trim()
    if (!expectedToken) {
      return jsonResponse(
        request,
        {
          error: "NOTAM ingest token is not configured.",
          nextSteps: [
            "Set the `NOTAM_INGEST_TOKEN` secret in Supabase.",
            "Redeploy the `notam-ingest` function after the secret is configured.",
          ],
        },
        501
      )
    }

    const providedToken = readAuthToken(request)
    if (!providedToken || providedToken !== expectedToken) {
      return jsonResponse(request, { error: "Unauthorized." }, 401)
    }

    const body = await readJsonObjectBody(request)
    const itemsRaw =
      body && Array.isArray(body.items)
        ? body.items
        : body && Array.isArray(body.notams)
          ? body.notams
          : null

    if (!itemsRaw) {
      return jsonResponse(
        request,
        { error: "JSON body must include an `items` or `notams` array." },
        400
      )
    }

    const nowIso = new Date().toISOString()
    const rows = itemsRaw
      .filter((value): value is IngestNotamItem => !!value && typeof value === "object")
      .map((item) => normalizeRow(item, nowIso))

    if (rows.length === 0) {
      return jsonResponse(request, { error: "No valid NOTAM items provided." }, 400)
    }

    const db = createServiceRoleClient()
    const { error } = await db.from("notam_feed").upsert(rows, { onConflict: "id" })
    if (error) {
      throw new Error(`Failed writing notam_feed: ${error.message}`)
    }

    return jsonResponse(request, {
      ingested: rows.length,
      source: "swift-scds",
      receivedAt: nowIso,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error."
    return jsonResponse(request, { error: message }, 502)
  }
})
