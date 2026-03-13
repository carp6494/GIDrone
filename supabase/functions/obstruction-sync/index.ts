import {
  createServiceRoleClient,
  jsonResponse,
  optionsResponse,
} from "../_shared/aviation.ts"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOF_ZIP_URL = "https://aeronav.faa.gov/Obst_Data/DAILY_DOF_CSV.ZIP"
const UPSERT_BATCH_SIZE = 500
const FETCH_TIMEOUT_MS = 120_000
const USER_AGENT = "GIDrone/0.3.0 (DOF obstruction sync)"
const MIN_AGL_HEIGHT_FT = 50
const EXCLUDED_TYPES = new Set(["SIGN", "TREE", "BLDG", "POLE"])

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const readAuthToken = (request: Request) => {
  const authHeader = request.headers.get("authorization") ?? ""
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch) return bearerMatch[1].trim()
  return (request.headers.get("x-sync-token") ?? "").trim()
}

// ---------------------------------------------------------------------------
// Streaming ZIP header parser
// ---------------------------------------------------------------------------

/**
 * Reads the ZIP local file header from a streaming response body,
 * strips the header bytes, and returns a ReadableStream of only the
 * compressed payload data — never buffering the entire ZIP.
 *
 * ZIP local file header layout (little-endian):
 *   0-3:   signature (0x04034b50)
 *   4-5:   version needed
 *   6-7:   flags
 *   8-9:   compression method (0=stored, 8=deflate)
 *   10-13: mod time/date
 *   14-17: crc32
 *   18-21: compressed size
 *   22-25: uncompressed size
 *   26-27: file name length
 *   28-29: extra field length
 *   30+:   file name + extra field
 *   then:  compressed data begins
 */
const streamZipPayload = (
  body: ReadableStream<Uint8Array>
): { stream: ReadableStream<Uint8Array>; headerParsed: Promise<{ isDeflated: boolean }> } => {
  let headerBuffer = new Uint8Array(0)
  let dataOffset = -1
  let isDeflated = false
  let headerBytesConsumed = 0
  let resolveHeader: (v: { isDeflated: boolean }) => void
  const headerParsed = new Promise<{ isDeflated: boolean }>((r) => { resolveHeader = r })

  const reader = body.getReader()

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // deno-lint-ignore no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          // Resolve header promise even if stream ends early
          if (dataOffset < 0) resolveHeader({ isDeflated: false })
          return
        }

        if (dataOffset < 0) {
          // Still accumulating header bytes
          const merged = new Uint8Array(headerBuffer.length + value.length)
          merged.set(headerBuffer)
          merged.set(value, headerBuffer.length)
          headerBuffer = merged

          // Need at least 30 bytes for the fixed header
          if (headerBuffer.length < 30) continue

          const dv = new DataView(headerBuffer.buffer, headerBuffer.byteOffset, headerBuffer.byteLength)
          const sig = dv.getUint32(0, true)
          if (sig !== 0x04034b50) {
            controller.error(new Error("Invalid ZIP — missing local file header signature."))
            return
          }

          const compressionMethod = dv.getUint16(8, true)
          isDeflated = compressionMethod === 8
          const fileNameLength = dv.getUint16(26, true)
          const extraFieldLength = dv.getUint16(28, true)
          dataOffset = 30 + fileNameLength + extraFieldLength

          // Need enough bytes to skip past the header
          if (headerBuffer.length < dataOffset) continue

          resolveHeader({ isDeflated })

          // Emit any bytes past the header from this accumulated buffer
          if (headerBuffer.length > dataOffset) {
            controller.enqueue(headerBuffer.slice(dataOffset))
          }
          headerBuffer = new Uint8Array(0) // free header buffer
          return
        }

        // Normal pass-through of compressed data
        controller.enqueue(value)
        return
      }
    },
    cancel() {
      reader.cancel()
    },
  })

  return { stream, headerParsed }
}

// ---------------------------------------------------------------------------
// CSV parsing helpers
// ---------------------------------------------------------------------------

const trimOrNull = (val: string | undefined): string | null => {
  if (!val) return null
  const trimmed = val.trim()
  return trimmed || null
}

const parseFloat = (val: string | undefined): number | null => {
  if (!val) return null
  const n = Number(val.trim())
  return Number.isFinite(n) ? n : null
}

const parseInt = (val: string | undefined): number | null => {
  if (!val) return null
  const n = Number(val.trim())
  return Number.isFinite(n) && Number.isInteger(n) ? n : null
}

type ObstructionRow = Record<string, unknown>

type ColumnMap = {
  oasCode: number
  verificationStatus: number
  country: number
  state: number
  city: number
  obstacleType: number
  quantity: number
  agl: number
  amsl: number
  lighting: number
  accuracy: number
  markIndicator: number
  faaStudyNumber: number
  action: number
  julianDate: number
  latDecimal: number
  lonDecimal: number
}

const detectColumns = (headerLine: string): ColumnMap | null => {
  const cols = headerLine.split(",").map((c) => c.trim().toUpperCase())

  const find = (patterns: string[]): number => {
    for (const pat of patterns) {
      const idx = cols.findIndex((c) => c.includes(pat))
      if (idx >= 0) return idx
    }
    return -1
  }
  const findExact = (patterns: string[]): number => {
    for (const pat of patterns) {
      const idx = cols.findIndex((c) => c === pat)
      if (idx >= 0) return idx
    }
    return -1
  }

  const oasCode = find(["OAS"])
  // Prefer exact LATDEC/LONDEC to avoid matching DMSLAT/DMSLON
  let latDecimal = findExact(["LATDEC", "LAT_DEC", "LAT DECIMAL"])
  let lonDecimal = findExact(["LONDEC", "LON_DEC", "LONG_DEC", "LON DECIMAL"])
  if (latDecimal < 0) latDecimal = find(["LATDEC", "LAT_DEC"])
  if (lonDecimal < 0) lonDecimal = find(["LONDEC", "LON_DEC", "LONGDEC"])
  if (latDecimal < 0) latDecimal = find(["LAT"])
  if (lonDecimal < 0) lonDecimal = find(["LON"])
  if (latDecimal < 0 || lonDecimal < 0) return null

  return {
    oasCode: oasCode >= 0 ? oasCode : 0,
    verificationStatus: find(["VERIF"]),
    country: find(["COUNTRY"]),
    state: find(["STATE"]),
    city: find(["CITY"]),
    obstacleType: find(["TYPE"]),
    quantity: find(["QUANT"]),
    agl: find(["AGL"]),
    amsl: find(["AMSL", "MSL"]),
    lighting: find(["LIGHT"]),
    accuracy: find(["ACCUR"]),
    markIndicator: find(["MARK"]),
    faaStudyNumber: find(["STUDY", "FAA STUDY"]),
    action: find(["ACTION"]),
    julianDate: find(["JDATE", "JULIAN", "DATE"]),
    latDecimal,
    lonDecimal,
  }
}

const col = (fields: string[], idx: number): string | undefined =>
  idx >= 0 && idx < fields.length ? fields[idx] : undefined

const parseRow = (
  fields: string[],
  colMap: ColumnMap,
  nowIso: string
): ObstructionRow | null => {
  // OAS column already contains the full ID like "01-001307"
  const id = trimOrNull(col(fields, colMap.oasCode))
  if (!id) return null

  const lat = parseFloat(col(fields, colMap.latDecimal))
  const lon = parseFloat(col(fields, colMap.lonDecimal))
  if (lat === null || lon === null) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null

  const aglHeight = parseFloat(col(fields, colMap.agl))
  if (aglHeight === null || aglHeight < MIN_AGL_HEIGHT_FT) return null

  const obstacleType = trimOrNull(col(fields, colMap.obstacleType))
  if (obstacleType && EXCLUDED_TYPES.has(obstacleType)) return null

  const actionCode = trimOrNull(col(fields, colMap.action))
  if (actionCode === "D") return null

  const lightingCode = trimOrNull(col(fields, colMap.lighting))
  if (!lightingCode || lightingCode === "N") return null

  return {
    id,
    oas_number: id,
    verification_status: trimOrNull(col(fields, colMap.verificationStatus)),
    country: trimOrNull(col(fields, colMap.country)),
    state: trimOrNull(col(fields, colMap.state)),
    city: trimOrNull(col(fields, colMap.city)),
    lat,
    lon,
    obstacle_type: obstacleType,
    quantity: parseInt(col(fields, colMap.quantity)),
    agl_height_ft: aglHeight,
    amsl_height_ft: parseFloat(col(fields, colMap.amsl)),
    lighting_code: lightingCode,
    horizontal_accuracy: trimOrNull(col(fields, colMap.accuracy)),
    vertical_accuracy: null,
    mark_indicator: trimOrNull(col(fields, colMap.markIndicator)),
    faa_study_number: trimOrNull(col(fields, colMap.faaStudyNumber)),
    action_code: actionCode,
    julian_date: trimOrNull(col(fields, colMap.julianDate)),
    source: "faa-dof",
    updated_at: nowIso,
    ingested_at: nowIso,
  }
}

// ---------------------------------------------------------------------------
// Simple CSV line splitter (handles quoted fields with commas)
// ---------------------------------------------------------------------------

const splitCsvLine = (line: string): string[] => {
  const fields: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === "," && !inQuotes) {
      fields.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

// ---------------------------------------------------------------------------
// Main sync logic — fully streaming, never holds full ZIP or CSV in memory
// ---------------------------------------------------------------------------

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request)
  }
  if (request.method !== "POST" && request.method !== "GET") {
    return jsonResponse(request, { error: "Method not allowed." }, 405)
  }

  // Auth check
  const expectedToken = (Deno.env.get("OBSTRUCTION_SYNC_TOKEN") ?? "").trim()
  if (expectedToken) {
    const providedToken = readAuthToken(request)
    if (!providedToken || providedToken !== expectedToken) {
      return jsonResponse(request, { error: "Unauthorized." }, 401)
    }
  }

  const startedAt = Date.now()
  const nowIso = new Date().toISOString()

  try {
    // 1. Start streaming the ZIP download (do NOT buffer the full response)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    let zipRes: Response
    try {
      zipRes = await fetch(DOF_ZIP_URL, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!zipRes.ok) {
      throw new Error(`FAA DOF download failed: ${zipRes.status} ${zipRes.statusText}`)
    }

    if (!zipRes.body) {
      throw new Error("FAA DOF response has no body stream.")
    }

    // 2. Stream through ZIP header parser → get compressed data stream
    const { stream: compressedStream, headerParsed } = streamZipPayload(zipRes.body)

    // Wait for header to be parsed so we know the compression method
    const { isDeflated } = await headerParsed

    // 3. Pipe compressed stream through decompression if needed
    let csvStream: ReadableStream<Uint8Array>
    if (isDeflated) {
      csvStream = compressedStream.pipeThrough(new DecompressionStream("deflate-raw"))
    } else {
      csvStream = compressedStream
    }

    // 4. Process decompressed CSV line by line
    const decoder = new TextDecoder("utf-8")
    const streamReader = csvStream.getReader()
    const db = createServiceRoleClient()

    let totalSynced = 0
    let totalSkipped = 0
    let batch: ObstructionRow[] = []
    let colMap: ColumnMap | null = null
    let leftover = ""
    let isFirstLine = true

    // deno-lint-ignore no-constant-condition
    while (true) {
      const { done, value } = await streamReader.read()
      if (done) break

      const text = leftover + decoder.decode(value, { stream: true })
      const lines = text.split("\n")
      leftover = lines.pop() ?? ""

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "").trim()
        if (!line) continue

        if (isFirstLine) {
          colMap = detectColumns(line)
          if (!colMap) {
            throw new Error(`Could not detect DOF CSV column layout from header: ${line.slice(0, 200)}`)
          }
          isFirstLine = false
          continue
        }

        const fields = splitCsvLine(line)
        const row = parseRow(fields, colMap!, nowIso)
        if (!row) {
          totalSkipped++
          continue
        }

        batch.push(row)

        if (batch.length >= UPSERT_BATCH_SIZE) {
          const { error } = await db
            .from("obstructions")
            .upsert(batch, { onConflict: "id" })
          if (error) {
            throw new Error(`Upsert failed at row ~${totalSynced}: ${error.message}`)
          }
          totalSynced += batch.length
          batch = []
        }
      }
    }

    // Process any remaining leftover text
    if (leftover.trim() && colMap) {
      const fields = splitCsvLine(leftover.trim())
      const row = parseRow(fields, colMap, nowIso)
      if (row) batch.push(row)
      else totalSkipped++
    }

    // Flush remaining batch
    if (batch.length > 0) {
      const { error } = await db
        .from("obstructions")
        .upsert(batch, { onConflict: "id" })
      if (error) {
        throw new Error(`Upsert failed at final batch: ${error.message}`)
      }
      totalSynced += batch.length
    }

    // 5. Delete stale rows (removed from DOF since last sync)
    let pruned = 0
    try {
      const { count } = await db
        .from("obstructions")
        .delete({ count: "exact" })
        .lt("updated_at", nowIso)
      pruned = count ?? 0
    } catch {
      // Non-fatal — will clean up on next cycle
    }

    return jsonResponse(request, {
      synced: totalSynced,
      skipped: totalSkipped,
      pruned,
      minAglHeightFt: MIN_AGL_HEIGHT_FT,
      fetchedAt: nowIso,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error."
    return jsonResponse(request, { error: message, durationMs: Date.now() - startedAt }, 502)
  }
})
