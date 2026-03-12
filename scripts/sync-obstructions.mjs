#!/usr/bin/env node
/**
 * Local sync script for FAA Digital Obstacle File (DOF).
 * Runs on your machine (no memory limits), downloads the daily DOF ZIP,
 * parses CSV, and upserts to Supabase in batches.
 *
 * Usage:
 *   node scripts/sync-obstructions.mjs
 *
 * Requires env vars (set in .env.local or export):
 *   SUPABASE_URL          - e.g. https://xxx.supabase.co
 *   SUPABASE_SERVICE_KEY  - service_role key (not anon)
 */

import { createClient } from "@supabase/supabase-js"
import { createInflateRaw } from "node:zlib"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DOF_ZIP_URL = "https://aeronav.faa.gov/Obst_Data/DAILY_DOF_CSV.ZIP"
const UPSERT_BATCH_SIZE = 500
const MIN_AGL_HEIGHT_FT = 50
const EXCLUDED_TYPES = new Set(["SIGN", "TREE", "BLDG", "POLE"])
const USER_AGENT = "GIDrone/0.3.0 (DOF obstruction local sync)"

// ---------------------------------------------------------------------------
// Load env from .env.local if present
// ---------------------------------------------------------------------------

function loadEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIdx = trimmed.indexOf("=")
      if (eqIdx < 0) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    // file not found — fine
  }
}

const projectRoot = resolve(import.meta.dirname, "..")
loadEnvFile(resolve(projectRoot, ".env.local"))
loadEnvFile(resolve(projectRoot, ".env"))

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ""

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY.\n" +
      "Set them in .env.local or export them:\n" +
      "  export SUPABASE_URL=https://xxx.supabase.co\n" +
      "  export SUPABASE_SERVICE_KEY=eyJ..."
  )
  process.exit(1)
}

if (!SUPABASE_KEY.includes('"role":"service_role"') && !SUPABASE_KEY.includes("service_role")) {
  // Decode JWT payload to check role
  try {
    const payload = JSON.parse(
      Buffer.from(SUPABASE_KEY.split(".")[1], "base64").toString()
    )
    if (payload.role !== "service_role") {
      console.error(
        "WARNING: The provided key has role '" +
          payload.role +
          "'. You need the service_role key for inserts.\n" +
          "Find it in Supabase Dashboard → Settings → API → service_role key."
      )
      process.exit(1)
    }
  } catch {
    // Can't decode — proceed and let Supabase reject if wrong
  }
}

console.log(`Supabase URL: ${SUPABASE_URL}`)
console.log(`Key role: service_role ✓`)

// ---------------------------------------------------------------------------
// ZIP helpers
// ---------------------------------------------------------------------------

function parseZipLocalHeader(buffer) {
  if (buffer.length < 30) throw new Error("Buffer too small for ZIP header")
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const sig = dv.getUint32(0, true)
  if (sig !== 0x04034b50) throw new Error("Invalid ZIP — bad signature")

  const compressionMethod = dv.getUint16(8, true)
  const fileNameLength = dv.getUint16(26, true)
  const extraFieldLength = dv.getUint16(28, true)
  const dataOffset = 30 + fileNameLength + extraFieldLength

  return { dataOffset, isDeflated: compressionMethod === 8 }
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

const trimOrNull = (val) => {
  if (!val) return null
  const t = val.trim()
  return t || null
}

const pFloat = (val) => {
  if (!val) return null
  const n = Number(val.trim())
  return Number.isFinite(n) ? n : null
}

const pInt = (val) => {
  if (!val) return null
  const n = Number(val.trim())
  return Number.isFinite(n) && Number.isInteger(n) ? n : null
}

function detectColumns(headerLine) {
  const cols = headerLine.split(",").map((c) => c.trim().toUpperCase())
  const find = (patterns) => {
    for (const pat of patterns) {
      const idx = cols.findIndex((c) => c.includes(pat))
      if (idx >= 0) return idx
    }
    return -1
  }
  // Exact match helper (avoids LATDEC matching DMSLAT)
  const findExact = (patterns) => {
    for (const pat of patterns) {
      const idx = cols.findIndex((c) => c === pat)
      if (idx >= 0) return idx
    }
    return -1
  }

  const oasCode = find(["OAS"])
  // Try exact decimal lat/lon first, then fall back to partial match
  let latDecimal = findExact(["LATDEC", "LAT_DEC", "LAT DECIMAL"])
  let lonDecimal = findExact(["LONDEC", "LON_DEC", "LONG_DEC", "LON DECIMAL"])
  if (latDecimal < 0) latDecimal = find(["LATDEC", "LAT_DEC"])
  if (lonDecimal < 0) lonDecimal = find(["LONDEC", "LON_DEC", "LONGDEC"])
  // Last resort: generic LAT/LON (but prefer numeric-looking columns)
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

function splitCsvLine(line) {
  const fields = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === "," && !inQuotes) {
      fields.push(current)
      current = ""
    } else current += ch
  }
  fields.push(current)
  return fields
}

const col = (fields, idx) =>
  idx >= 0 && idx < fields.length ? fields[idx] : undefined

function parseRow(fields, colMap, nowIso) {
  // OAS column already contains the full ID like "01-001307"
  const id = trimOrNull(col(fields, colMap.oasCode))
  if (!id) return null

  const lat = pFloat(col(fields, colMap.latDecimal))
  const lon = pFloat(col(fields, colMap.lonDecimal))
  if (lat === null || lon === null) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null

  const aglHeight = pFloat(col(fields, colMap.agl))
  if (aglHeight === null || aglHeight < MIN_AGL_HEIGHT_FT) return null

  const obstacleType = trimOrNull(col(fields, colMap.obstacleType))
  if (obstacleType && EXCLUDED_TYPES.has(obstacleType)) return null

  const actionCode = trimOrNull(col(fields, colMap.action))
  if (actionCode === "D") return null

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
    quantity: pInt(col(fields, colMap.quantity)),
    agl_height_ft: aglHeight,
    amsl_height_ft: pFloat(col(fields, colMap.amsl)),
    lighting_code: trimOrNull(col(fields, colMap.lighting)),
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = Date.now()
  const nowIso = new Date().toISOString()

  const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1. Download ZIP
  console.log(`\nDownloading DOF ZIP from FAA...`)
  const res = await fetch(DOF_ZIP_URL, {
    headers: { "User-Agent": USER_AGENT },
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)

  const zipBuffer = Buffer.from(await res.arrayBuffer())
  const zipSizeMB = (zipBuffer.length / (1024 * 1024)).toFixed(1)
  console.log(`Downloaded ${zipSizeMB} MB`)

  // 2. Parse ZIP header + decompress
  const { dataOffset, isDeflated } = parseZipLocalHeader(zipBuffer)
  const compressedData = zipBuffer.subarray(dataOffset)
  console.log(
    `ZIP entry: ${isDeflated ? "deflate" : "stored"}, compressed ${(compressedData.length / (1024 * 1024)).toFixed(1)} MB`
  )

  let csvText
  if (isDeflated) {
    csvText = await new Promise((resolve, reject) => {
      const chunks = []
      const inflater = createInflateRaw()
      inflater.on("data", (chunk) => chunks.push(chunk))
      inflater.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
      inflater.on("error", reject)
      inflater.end(compressedData)
    })
  } else {
    csvText = compressedData.toString("utf-8")
  }

  const csvSizeMB = (Buffer.byteLength(csvText, "utf-8") / (1024 * 1024)).toFixed(1)
  console.log(`Decompressed CSV: ${csvSizeMB} MB`)

  // 3. Parse CSV line by line
  const lines = csvText.split("\n")
  csvText = null // free memory

  let colMap = null
  let totalSynced = 0
  let totalSkipped = 0
  let batch = []
  let lineNum = 0

  console.log(`\nParsing ${lines.length.toLocaleString()} lines...`)

  for (const rawLine of lines) {
    lineNum++
    const line = rawLine.replace(/\r$/, "").trim()
    if (!line) continue

    if (!colMap) {
      colMap = detectColumns(line)
      if (!colMap) throw new Error(`Bad header: ${line.slice(0, 200)}`)
      console.log(`Detected columns from header`)
      continue
    }

    const fields = splitCsvLine(line)
    const row = parseRow(fields, colMap, nowIso)
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

      if (totalSynced % 5000 === 0) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
        const rate = Math.round(totalSynced / (elapsed || 1))
        process.stdout.write(
          `\r  Synced: ${totalSynced.toLocaleString()} rows | Skipped: ${totalSkipped.toLocaleString()} | ${elapsed}s | ${rate}/s`
        )
      }
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    const { error } = await db
      .from("obstructions")
      .upsert(batch, { onConflict: "id" })
    if (error) throw new Error(`Upsert failed at final batch: ${error.message}`)
    totalSynced += batch.length
  }

  console.log(
    `\n\nSync complete: ${totalSynced.toLocaleString()} rows synced, ${totalSkipped.toLocaleString()} skipped`
  )

  // 4. Prune stale rows
  console.log(`Pruning stale rows (updated_at < ${nowIso})...`)
  try {
    const { count } = await db
      .from("obstructions")
      .delete({ count: "exact" })
      .lt("updated_at", nowIso)
    console.log(`Pruned ${(count ?? 0).toLocaleString()} stale rows`)
  } catch (e) {
    console.log(`Prune skipped (non-fatal): ${e.message}`)
  }

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`\nDone in ${durationSec}s`)
  console.log(`  ZIP: ${zipSizeMB} MB`)
  console.log(`  CSV: ${csvSizeMB} MB`)
  console.log(`  Synced: ${totalSynced.toLocaleString()}`)
  console.log(`  Skipped: ${totalSkipped.toLocaleString()}`)
  console.log(`  Min AGL: ${MIN_AGL_HEIGHT_FT} ft`)
  console.log(`  Excluded types: ${[...EXCLUDED_TYPES].join(", ")}`)
  console.log(`  Excluded action codes: D (dismantled)`)
}

main().catch((err) => {
  console.error("\nFATAL:", err.message)
  process.exit(1)
})
