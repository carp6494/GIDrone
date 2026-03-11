import type { SupabaseClient } from "npm:@supabase/supabase-js@2"
import { DOMParser as XmlDomParser } from "npm:@xmldom/xmldom@0.8.10"

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
  readResponsePayload,
  safeIsoString,
  setCachedJson,
  withTimeoutFetch,
} from "../_shared/aviation.ts"

const FAA_TFR_LIST_URL = "https://tfr.faa.gov/tfrapi/exportTfrList"
const FAA_TFR_DOWNLOAD_BASE_URL = "https://tfr.faa.gov/download"
const FAA_TFR_WEBTEXT_URL = "https://tfr.faa.gov/tfrapi/getWebText"
const FAA_USER_AGENT = "GIDrone/0.2.1 (US-only TFR proxy)"
const LIST_CACHE_TTL_SECONDS = 60
const DETAIL_CACHE_TTL_SECONDS = 300
const FINAL_CACHE_TTL_SECONDS = 60
const CIRCLE_SEGMENTS = 64

type BoundsTuple = [number, number, number, number]

type TfrSourceUrls = {
  detailPageUrl: string
  xmlUrl: string
  webTextUrl: string
}

type TfrItem = {
  notamId: string
  type: string | null
  description: string | null
  startsAt: string | null
  endsAt: string | null
  facility: string | null
  state: string | null
  hasGeometry: boolean
  bbox: BoundsTuple | null
  featureCount: number
  sourceUrls: TfrSourceUrls
}

type TfrFeatureProperties = {
  notamId: string
  type?: string | null
  description?: string | null
  startsAt?: string | null
  endsAt?: string | null
  facility?: string | null
  state?: string | null
  detailPageUrl?: string
  xmlUrl?: string
}

type TfrResponse = {
  featureCollection: GeoJSON.FeatureCollection<GeoJSON.Geometry>
  items: TfrItem[]
  fetchedAt: string
  source: "faa-tfr"
  message?: string
}

type TfrFailureKind = "timeout" | "fetch" | "parse" | "other"

type FaaTfrListRow = {
  notam_id?: unknown
  type?: unknown
  facility?: unknown
  state?: unknown
  description?: unknown
  creation_date?: unknown
}

type ParsedTfrDetail = {
  item: TfrItem
  features: Array<GeoJSON.Feature<GeoJSON.Geometry>>
}

type XmlNode = Document | Element

const toNumber = (value: string | null | undefined) => {
  if (!value) return null
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

const toGeoCoordinate = (
  value: string | null | undefined,
  axis: "lat" | "lon"
) => {
  if (!value) return null
  const trimmed = value.trim().toUpperCase()
  const direct = Number(trimmed)
  if (Number.isFinite(direct)) return direct

  const decimalHemisphereMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?)([NSEW])$/)
  if (decimalHemisphereMatch) {
    const magnitude = Number(decimalHemisphereMatch[1])
    if (!Number.isFinite(magnitude)) return null
    const hemisphere = decimalHemisphereMatch[2]
    const signed =
      hemisphere === "S" || hemisphere === "W" ? -Math.abs(magnitude) : Math.abs(magnitude)
    if (axis === "lat" && signed >= -90 && signed <= 90) return signed
    if (axis === "lon" && signed >= -180 && signed <= 180) return signed
    return null
  }

  // FAA sometimes encodes coords as DDMMSS[N|S] / DDDMMSS[E|W].
  const dmsMatch = trimmed.match(/^(\d{6,7})(?:\.(\d+))?([NSEW])$/)
  if (!dmsMatch) return null

  const digits = dmsMatch[1]
  const fractional = dmsMatch[2] ? Number(`0.${dmsMatch[2]}`) : 0
  const hemisphere = dmsMatch[3]

  const degreeDigits = axis === "lat" ? 2 : 3
  if (digits.length < degreeDigits + 4) return null

  const degrees = Number(digits.slice(0, degreeDigits))
  const minutes = Number(digits.slice(degreeDigits, degreeDigits + 2))
  const seconds = Number(digits.slice(degreeDigits + 2)) + fractional
  if (
    !Number.isFinite(degrees) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    minutes < 0 ||
    minutes >= 60 ||
    seconds < 0 ||
    seconds >= 60
  ) {
    return null
  }

  const magnitude = degrees + minutes / 60 + seconds / 3600
  const signed =
    hemisphere === "S" || hemisphere === "W" ? -Math.abs(magnitude) : Math.abs(magnitude)
  if (axis === "lat" && signed >= -90 && signed <= 90) return signed
  if (axis === "lon" && signed >= -180 && signed <= 180) return signed
  return null
}

const uniqueBy = <T,>(items: T[], getKey: (item: T) => string) => {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const key = getKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

const escapeBareXmlAmpersands = (xmlText: string) =>
  xmlText.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")

const stripInvalidXmlControlChars = (xmlText: string) =>
  xmlText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")

const stripVerboseDescriptionFields = (xmlText: string) =>
  xmlText.replace(
    /<(txtDescrModern|txtDescrTraditional|txtDescrUSNS)>[\s\S]*?<\/\1>/g,
    "<$1></$1>"
  )

const getSourceUrls = (notamId: string): TfrSourceUrls => {
  const normalized = normalizeNotamId(notamId)
  const xmlFileId = normalized.replace(/\//g, "_")
  const webTextUrl = `${FAA_TFR_WEBTEXT_URL}?notamId=${encodeURIComponent(normalized)}`
  const xmlUrl = `${FAA_TFR_DOWNLOAD_BASE_URL}/detail_${xmlFileId}.xml`
  return {
    detailPageUrl: webTextUrl,
    xmlUrl,
    webTextUrl,
  }
}

const elementNameMatches = (element: Element, localName: string) => {
  const target = localName.toLowerCase()
  const elementLocal = (element.localName ?? "").toLowerCase()
  const elementNode = (element.nodeName ?? "").toLowerCase()
  return elementLocal === target || elementNode === target
}

const elementsByLocalName = (root: XmlNode, localName: string): Element[] => {
  const baseElement =
    "documentElement" in root ? (root.documentElement as Element | null) : (root as Element)
  if (!baseElement) return []

  const matches: Element[] = []
  if (elementNameMatches(baseElement, localName)) {
    matches.push(baseElement)
  }

  const all = baseElement.getElementsByTagName("*")
  for (let index = 0; index < all.length; index += 1) {
    const element = all.item(index)
    if (!element) continue
    if (elementNameMatches(element, localName)) matches.push(element)
  }
  return matches
}

const firstLocalText = (root: XmlNode, localName: string) => {
  const match = elementsByLocalName(root, localName)[0]
  const text = match?.textContent?.trim()
  return text ? text : null
}

const parseXml = (xmlText: string) => {
  const parseOrThrow = (
    input: string,
    mimeType: "text/xml" | "application/xml" | "text/html"
  ) => {
    const document = new XmlDomParser().parseFromString(input, mimeType) as unknown as Document
    if (!document) throw new Error("Failed to parse FAA TFR XML.")
    if (mimeType !== "text/html") {
      const parserErrors = elementsByLocalName(document, "parsererror")
      if (parserErrors.length > 0) {
        throw new Error(`FAA TFR XML parsererror (${mimeType})`)
      }
    }
    if (
      elementsByLocalName(document, "TFRAreaGroup").length === 0 &&
      elementsByLocalName(document, "TfrNot").length === 0
    ) {
      throw new Error(`FAA TFR XML parse missing expected nodes (${mimeType})`)
    }
    return document
  }

  const candidates = uniqueBy(
    [
      xmlText,
      stripInvalidXmlControlChars(xmlText),
      escapeBareXmlAmpersands(stripInvalidXmlControlChars(xmlText)),
      stripVerboseDescriptionFields(
        escapeBareXmlAmpersands(stripInvalidXmlControlChars(xmlText))
      ),
    ].filter((value) => value.trim().length > 0),
    (value) => value
  )

  const mimeTypes: Array<"text/xml" | "application/xml" | "text/html"> = [
    "text/xml",
    "application/xml",
    "text/html",
  ]
  let lastError: unknown = null

  for (const candidate of candidates) {
    for (const mimeType of mimeTypes) {
      try {
        return parseOrThrow(candidate, mimeType)
      } catch (error) {
        lastError = error
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to parse FAA TFR XML.")
}

const closeRing = (ring: number[][]) => {
  if (ring.length < 3) return null
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (!first || !last) return null
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring = [...ring, [first[0], first[1]]]
  }
  if (ring.length < 4) return null
  return ring
}

const radiusToMiles = (radiusValue: number, radiusUnit: string | null) => {
  const unit = radiusUnit?.trim().toUpperCase() ?? "NM"
  if (unit === "NM" || unit === "NMI") return radiusValue * 1.150779448
  if (unit === "SM" || unit === "MI") return radiusValue
  if (unit === "KM") return radiusValue * 0.621371
  if (unit === "M") return radiusValue * 0.000621371
  if (unit === "FT") return radiusValue / 5280
  return radiusValue
}

const destinationPoint = (
  lat: number,
  lon: number,
  bearingDegrees: number,
  distanceMiles: number
) => {
  const earthRadiusMiles = 3958.7613
  const toRadians = (value: number) => (value * Math.PI) / 180
  const toDegrees = (value: number) => (value * 180) / Math.PI
  const bearing = toRadians(bearingDegrees)
  const angularDistance = distanceMiles / earthRadiusMiles
  const lat1 = toRadians(lat)
  const lon1 = toRadians(lon)

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

  let lonDeg = toDegrees(lon2)
  while (lonDeg > 180) lonDeg -= 360
  while (lonDeg < -180) lonDeg += 360

  return [lonDeg, toDegrees(lat2)] as [number, number]
}

const approximateCircleRing = (lat: number, lon: number, radiusMiles: number) => {
  const points: number[][] = []
  for (let index = 0; index < CIRCLE_SEGMENTS; index += 1) {
    const bearing = (index / CIRCLE_SEGMENTS) * 360
    const [pointLon, pointLat] = destinationPoint(lat, lon, bearing, radiusMiles)
    points.push([pointLon, pointLat])
  }
  return closeRing(points)
}

const geometryBbox = (geometry: GeoJSON.Geometry): BoundsTuple | null => {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  let found = false

  const consume = (coords: unknown): void => {
    if (!Array.isArray(coords)) return
    if (
      coords.length >= 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number" &&
      Number.isFinite(coords[0]) &&
      Number.isFinite(coords[1])
    ) {
      const [lon, lat] = coords as [number, number]
      minLon = Math.min(minLon, lon)
      minLat = Math.min(minLat, lat)
      maxLon = Math.max(maxLon, lon)
      maxLat = Math.max(maxLat, lat)
      found = true
      return
    }
    for (const child of coords) {
      consume(child)
    }
  }

  consume(geometry.coordinates)
  return found ? [minLon, minLat, maxLon, maxLat] : null
}

const mergeBboxes = (boxes: Array<BoundsTuple | null>): BoundsTuple | null => {
  const valid = boxes.filter((box): box is BoundsTuple => Array.isArray(box))
  if (valid.length === 0) return null
  let [minLon, minLat, maxLon, maxLat] = valid[0]
  for (const box of valid.slice(1)) {
    minLon = Math.min(minLon, box[0])
    minLat = Math.min(minLat, box[1])
    maxLon = Math.max(maxLon, box[2])
    maxLat = Math.max(maxLat, box[3])
  }
  return [minLon, minLat, maxLon, maxLat]
}

const bboxContainsPoint = (bbox: BoundsTuple, lat: number, lon: number) =>
  lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]

const minDistanceToBboxMiles = (bbox: BoundsTuple, lat: number, lon: number) => {
  const clampedLon = Math.min(Math.max(lon, bbox[0]), bbox[2])
  const clampedLat = Math.min(Math.max(lat, bbox[1]), bbox[3])
  return haversineMiles(lat, lon, clampedLat, clampedLon)
}

const minVertexDistanceMiles = (
  geometry: GeoJSON.Geometry,
  lat: number,
  lon: number
) => {
  let minDistance = Infinity

  const consume = (coords: unknown): void => {
    if (!Array.isArray(coords)) return
    if (
      coords.length >= 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number" &&
      Number.isFinite(coords[0]) &&
      Number.isFinite(coords[1])
    ) {
      const [pointLon, pointLat] = coords as [number, number]
      minDistance = Math.min(minDistance, haversineMiles(lat, lon, pointLat, pointLon))
      return
    }
    for (const child of coords) {
      consume(child)
    }
  }

  consume(geometry.coordinates)
  return minDistance
}

const itemIntersectsRadius = (
  detail: ParsedTfrDetail,
  lat: number,
  lon: number,
  radiusMiles: number
) => {
  if (!detail.item.bbox || detail.features.length === 0) return false
  if (bboxContainsPoint(detail.item.bbox, lat, lon)) return true
  if (minDistanceToBboxMiles(detail.item.bbox, lat, lon) <= radiusMiles) return true

  let minDistance = Infinity
  for (const feature of detail.features) {
    if (!feature.geometry) continue
    minDistance = Math.min(minDistance, minVertexDistanceMiles(feature.geometry, lat, lon))
    if (minDistance <= radiusMiles) return true
  }
  return minDistance <= radiusMiles
}

const buildFeatureProperties = (item: TfrItem): TfrFeatureProperties => ({
  notamId: item.notamId,
  type: item.type,
  description: item.description,
  startsAt: item.startsAt,
  endsAt: item.endsAt,
  facility: item.facility,
  state: item.state,
  detailPageUrl: item.sourceUrls.detailPageUrl,
  xmlUrl: item.sourceUrls.xmlUrl,
})

const parsePolygonFeatures = (
  areaGroup: Element,
  properties: TfrFeatureProperties
): Array<GeoJSON.Feature<GeoJSON.Polygon>> => {
  const features: Array<GeoJSON.Feature<GeoJSON.Polygon>> = []
  const mergedAreas = elementsByLocalName(areaGroup, "abdMergedArea")
  const polygonContainers =
    mergedAreas.length > 0 ? mergedAreas : elementsByLocalName(areaGroup, "Abd")

  for (const polygonContainer of polygonContainers) {
    const ring = elementsByLocalName(polygonContainer, "Avx")
      .map((vertex) => {
        const codeType = firstLocalText(vertex, "codeType")
        if (codeType && codeType !== "GRC") return null
        const lat = toGeoCoordinate(firstLocalText(vertex, "geoLat"), "lat")
        const lon = toGeoCoordinate(firstLocalText(vertex, "geoLong"), "lon")
        if (lat === null || lon === null) return null
        return [lon, lat] as [number, number]
      })
      .filter((value): value is [number, number] => value !== null)

    const closed = closeRing(ring.map(([lon, lat]) => [lon, lat]))
    if (!closed) continue

    features.push({
      type: "Feature",
      properties,
      geometry: {
        type: "Polygon",
        coordinates: [closed],
      },
    })
  }

  return features
}

const parseCircleFeatures = (
  areaGroup: Element,
  properties: TfrFeatureProperties
): Array<GeoJSON.Feature<GeoJSON.Polygon>> => {
  const features: Array<GeoJSON.Feature<GeoJSON.Polygon>> = []
  const circleVertices = elementsByLocalName(areaGroup, "Avx").filter((vertex) => {
    const codeType = firstLocalText(vertex, "codeType")
    return codeType === "CIR"
  })

  for (const circle of circleVertices) {
    const lat = toGeoCoordinate(firstLocalText(circle, "geoLat"), "lat")
    const lon = toGeoCoordinate(firstLocalText(circle, "geoLong"), "lon")
    const radiusValue = toNumber(firstLocalText(circle, "valRadiusArc"))
    const radiusUnit = firstLocalText(circle, "uomRadiusArc")

    if (lat === null || lon === null || radiusValue === null) continue

    const ring = approximateCircleRing(lat, lon, radiusToMiles(radiusValue, radiusUnit))
    if (!ring) continue

    features.push({
      type: "Feature",
      properties,
      geometry: {
        type: "Polygon",
        coordinates: [ring],
      },
    })
  }

  return features
}

const normalizeListRow = (row: FaaTfrListRow) => {
  const notamIdRaw = typeof row.notam_id === "string" ? row.notam_id : ""
  const notamId = normalizeNotamId(notamIdRaw)
  if (!notamId) return null

  return {
    notamId,
    type: typeof row.type === "string" && row.type.trim() ? row.type.trim() : null,
    facility:
      typeof row.facility === "string" && row.facility.trim() ? row.facility.trim() : null,
    state: typeof row.state === "string" && row.state.trim() ? row.state.trim() : null,
    description:
      typeof row.description === "string" && row.description.trim() ? row.description.trim() : null,
    creationDate:
      typeof row.creation_date === "string" && row.creation_date.trim() ? row.creation_date.trim() : null,
  }
}

const fetchTfrList = async (db: SupabaseClient) => {
  const cacheKey = "tfr:list:v1:export"
  const cached = await getCachedJson<FaaTfrListRow[]>(db, cacheKey)
  if (cached) return cached

  const response = await withTimeoutFetch(
    FAA_TFR_LIST_URL,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": FAA_USER_AGENT,
      },
    },
    10_000
  )

  if (!response.ok) {
    const payload = await readResponsePayload(response)
    throw new Error(
      `FAA TFR list request failed (${response.status}): ${
        typeof payload === "string" ? payload.slice(0, 280) : JSON.stringify(payload ?? null)
      }`
    )
  }

  const json = await response.json()
  const list = Array.isArray(json) ? (json as FaaTfrListRow[]) : []
  await setCachedJson(db, cacheKey, list, LIST_CACHE_TTL_SECONDS)
  return list
}

const parseTfrDetailXml = (normalizedListRow: ReturnType<typeof normalizeListRow>, xmlText: string) => {
  if (!normalizedListRow) return null

  const sourceUrls = getSourceUrls(normalizedListRow.notamId)
  const document = parseXml(xmlText)
  const areaGroups = elementsByLocalName(document, "TFRAreaGroup")

  const baseItem: TfrItem = {
    notamId: normalizedListRow.notamId,
    type: normalizedListRow.type ?? firstLocalText(document, "txtDescrPurpose"),
    description:
      normalizedListRow.description ??
      firstLocalText(document, "txtLocalName") ??
      firstLocalText(document, "txtDescrPurpose"),
    startsAt: safeIsoString(firstLocalText(document, "dateEffective")),
    endsAt: safeIsoString(firstLocalText(document, "dateExpire")),
    facility: normalizedListRow.facility ?? firstLocalText(document, "codeFacility"),
    state: normalizedListRow.state ?? firstLocalText(document, "txtNameUSState"),
    hasGeometry: false,
    bbox: null,
    featureCount: 0,
    sourceUrls,
  }

  const properties = buildFeatureProperties(baseItem)
  const features: Array<GeoJSON.Feature<GeoJSON.Geometry>> = []

  for (const areaGroup of areaGroups) {
    features.push(...parsePolygonFeatures(areaGroup, properties))
    features.push(...parseCircleFeatures(areaGroup, properties))
  }

  const uniqueFeatures = uniqueBy(features, (feature) => JSON.stringify(feature.geometry))
  const bbox = mergeBboxes(uniqueFeatures.map((feature) => geometryBbox(feature.geometry)))

  const item: TfrItem = {
    ...baseItem,
    hasGeometry: uniqueFeatures.length > 0 && bbox !== null,
    bbox,
    featureCount: uniqueFeatures.length,
  }

  const hydratedFeatures = uniqueFeatures.map((feature) => ({
    ...feature,
    properties: buildFeatureProperties(item),
  }))

  return {
    item,
    features: hydratedFeatures,
  } satisfies ParsedTfrDetail
}

const fetchAndParseTfrDetail = async (
  db: SupabaseClient,
  listRow: NonNullable<ReturnType<typeof normalizeListRow>>
) => {
  const cacheKey = `tfr:detail:v8:${listRow.notamId}`
  const cached = await getCachedJson<ParsedTfrDetail>(db, cacheKey)
  if (cached) return cached

  const sourceUrls = getSourceUrls(listRow.notamId)
  const response = await withTimeoutFetch(
    sourceUrls.xmlUrl,
    {
      headers: {
        Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
        "User-Agent": FAA_USER_AGENT,
      },
    },
    10_000
  )

  if (!response.ok) {
    const payload = await readResponsePayload(response)
    throw new Error(
      `FAA TFR XML request failed (${response.status}) for ${listRow.notamId}: ${
        typeof payload === "string" ? payload.slice(0, 280) : JSON.stringify(payload ?? null)
      }`
    )
  }

  const xmlText = await response.text()
  const parsed = parseTfrDetailXml(listRow, xmlText)
  if (!parsed) {
    throw new Error(`Unable to parse FAA TFR XML for ${listRow.notamId}.`)
  }

  await setCachedJson(db, cacheKey, parsed, DETAIL_CACHE_TTL_SECONDS)
  return parsed
}

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) => {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= items.length) return
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, () =>
    worker()
  )
  await Promise.all(workers)
  return results
}

const classifyDetailFailure = (message: string): TfrFailureKind => {
  const lower = message.toLowerCase()
  if (lower.includes("aborterror") || lower.includes("timed out")) return "timeout"
  if (lower.includes("request failed") || lower.includes("http") || lower.includes("status")) {
    return "fetch"
  }
  if (lower.includes("parse") || lower.includes("xml") || lower.includes("domparser")) {
    return "parse"
  }
  return "other"
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

    // --- action=webtext: proxy FAA getWebText and return parsed HTML ---
    const action = (body?.action as string | undefined) ?? url.searchParams.get("action") ?? ""
    if (action === "webtext") {
      const notamId =
        (body?.notamId as string | undefined) ?? url.searchParams.get("notamId") ?? ""
      if (!notamId.trim()) {
        return jsonResponse(request, { error: "notamId is required for webtext action." }, 400)
      }
      const webTextUrl = `${FAA_TFR_WEBTEXT_URL}?notamId=${encodeURIComponent(
        normalizeNotamId(notamId)
      )}`
      const faaRes = await withTimeoutFetch(webTextUrl, {
        headers: { "User-Agent": FAA_USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      })
      const raw = await readResponsePayload(faaRes)
      console.log("[tfr:webtext] FAA response", {
        status: faaRes.status,
        contentType: faaRes.headers.get("content-type"),
        rawType: typeof raw,
        preview: typeof raw === "string" ? raw.slice(0, 500) : JSON.stringify(raw)?.slice(0, 500),
      })
      if (!faaRes.ok) {
        return jsonResponse(
          request,
          { error: `FAA returned ${faaRes.status}`, raw: typeof raw === "string" ? raw.slice(0, 500) : null },
          502
        )
      }

      // FAA returns JSON array: [ { notam_id, text: "<html string>" } ]
      let htmlContent = ""
      const unwrap = (obj: unknown): string => {
        if (!obj || typeof obj !== "object") return ""
        // Unwrap array: take first element
        if (Array.isArray(obj)) return unwrap(obj[0])
        if ("text" in obj) return String((obj as { text: unknown }).text)
        return ""
      }

      if (typeof raw === "string") {
        try {
          htmlContent = unwrap(JSON.parse(raw)) || raw
        } catch {
          htmlContent = raw
        }
      } else {
        htmlContent = unwrap(raw)
      }

      console.log("[tfr:webtext] extracted", { htmlLength: htmlContent.length, preview: htmlContent.slice(0, 200) })
      return jsonResponse(request, { notamId: notamId.trim(), html: htmlContent })
    }

    const lat = parseNumberLike(body?.lat) ?? parseNumberParam(url.searchParams.get("lat"))
    const lon = parseNumberLike(body?.lon) ?? parseNumberParam(url.searchParams.get("lon"))
    const radiusRaw =
      parseNumberLike(body?.radiusMiles) ?? parseNumberParam(url.searchParams.get("radiusMiles"))
    const radiusMiles = clamp(radiusRaw ?? 100, 1, 250)

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
    const finalCacheKey = `tfr:nearby:v8:${lat.toFixed(4)}:${lon.toFixed(4)}:${radiusMiles.toFixed(1)}`
    const cached = await getCachedJson<TfrResponse>(db, finalCacheKey)
    if (cached) {
      return jsonResponse(request, cached)
    }

    const rawList = await fetchTfrList(db)
    const listRows = rawList
      .map(normalizeListRow)
      .filter((row): row is NonNullable<ReturnType<typeof normalizeListRow>> => row !== null)

    let detailFailures = 0
    const detailFailureKinds: Record<TfrFailureKind, number> = {
      timeout: 0,
      fetch: 0,
      parse: 0,
      other: 0,
    }
    const detailFailureSamples: string[] = []
    const parsedDetails = (
      await mapWithConcurrency(listRows, 8, async (listRow) => {
        try {
          return await fetchAndParseTfrDetail(db, listRow)
        } catch (error) {
          detailFailures += 1
          const errorMessage = error instanceof Error ? error.message : String(error)
          const failureKind = classifyDetailFailure(errorMessage)
          detailFailureKinds[failureKind] += 1
          if (detailFailureSamples.length < 3) {
            detailFailureSamples.push(`${failureKind}:${listRow.notamId}: ${errorMessage}`)
          }
          console.warn(
            `[tfr] skipping ${listRow.notamId}:`,
            errorMessage
          )
          return null
        }
      })
    ).filter((detail): detail is ParsedTfrDetail => detail !== null)

    const nearbyDetails = parsedDetails.filter(
      (detail) => detail.item.hasGeometry && itemIntersectsRadius(detail, lat, lon, radiusMiles)
    )

    nearbyDetails.sort((a, b) => {
      const aStart = a.item.startsAt ? Date.parse(a.item.startsAt) : Number.POSITIVE_INFINITY
      const bStart = b.item.startsAt ? Date.parse(b.item.startsAt) : Number.POSITIVE_INFINITY
      if (aStart !== bStart) return aStart - bStart
      return a.item.notamId.localeCompare(b.item.notamId)
    })

    const failureKindsSummary = Object.entries(detailFailureKinds)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${kind}=${count}`)
      .join(", ")

    const responsePayload: TfrResponse & {
      debug?: {
        detailFailures: number
        detailFailureKinds: Record<TfrFailureKind, number>
        detailFailureSamples: string[]
      }
    } = {
      featureCollection: {
        type: "FeatureCollection",
        features: nearbyDetails.flatMap((detail) => detail.features),
      },
      items: nearbyDetails.map((detail) => detail.item),
      fetchedAt: new Date().toISOString(),
      source: "faa-tfr",
      ...(detailFailures > 0
        ? {
            message: `Skipped ${detailFailures} TFR detail record${
              detailFailures === 1 ? "" : "s"
            } due to FAA XML fetch/parse errors${
              failureKindsSummary ? ` (${failureKindsSummary})` : ""
            }.`,
          }
        : {}),
      ...(detailFailures > 0 && nearbyDetails.length === 0
        ? {
            debug: {
              detailFailures,
              detailFailureKinds: detailFailureKinds,
              detailFailureSamples,
            },
          }
        : {}),
    }

    await setCachedJson(db, finalCacheKey, responsePayload, FINAL_CACHE_TTL_SECONDS)
    return jsonResponse(request, responsePayload)
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
