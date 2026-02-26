import { useMemo, useState } from "react"
import type { ChangeEvent } from "react"
import Papa from "papaparse"
import { AlertCircle, CheckCircle2, Upload, X } from "lucide-react"

import { supabase } from "../lib/supabase"

type SchemaKey =
  | "site_number"
  | "site_name"
  | "city"
  | "county"
  | "state"
  | "latitude"
  | "longitude"
  | "structure_type"

type CsvRow = Record<string, unknown>

type CsvImportProps = {
  isOpen: boolean
  onClose: () => void
  onUploadComplete?: () => void
  userId: string | null
}

const SCHEMA_FIELDS: Array<{
  key: SchemaKey
  label: string
  required?: boolean
}> = [
  { key: "site_number", label: "Site Number" },
  { key: "site_name", label: "Site Name" },
  { key: "city", label: "City" },
  { key: "county", label: "County" },
  { key: "state", label: "State" },
  { key: "latitude", label: "Latitude", required: true },
  { key: "longitude", label: "Longitude", required: true },
  { key: "structure_type", label: "Structure Type" },
]

const FIELD_ALIASES: Record<SchemaKey, string[]> = {
  site_number: [
    "site_number",
    "site_no",
    "site_id",
    "number",
    "id",
  ],
  site_name: ["site_name", "site", "name", "site_name_full"],
  city: ["city", "town"],
  county: ["county", "parish"],
  state: ["state", "st", "province", "region"],
  latitude: ["latitude", "lat", "y", "y_coord", "y_coordinate"],
  longitude: ["longitude", "lng", "lon", "x", "x_coord", "x_coordinate"],
  structure_type: ["structure_type", "structure", "tower_type", "type"],
}

const BATCH_SIZE = 500

const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

const toStringValue = (value: unknown) => String(value ?? "").trim()

const isRowEmpty = (row: CsvRow) =>
  Object.values(row).every((value) => toStringValue(value) === "")

const getMappedValue = (row: CsvRow, header: string) =>
  header ? toStringValue(row[header]) : ""

const buildAutoMapping = (headers: string[]) => {
  const normalizedHeaders = headers.map((header) => ({
    header,
    normalized: normalizeHeader(header),
  }))
  const mapping: Record<SchemaKey, string> = {
    site_number: "",
    site_name: "",
    city: "",
    county: "",
    state: "",
    latitude: "",
    longitude: "",
    structure_type: "",
  }

  SCHEMA_FIELDS.forEach((field) => {
    const aliases = FIELD_ALIASES[field.key]
    const match = normalizedHeaders.find((candidate) =>
      aliases.some((alias) => normalizeHeader(alias) === candidate.normalized)
    )
    if (match) {
      mapping[field.key] = match.header
    }
  })

  return mapping
}

const mapRowToSite = (
  row: CsvRow,
  mapping: Record<SchemaKey, string>
) => {
  const latitudeValue = getMappedValue(row, mapping.latitude)
  const longitudeValue = getMappedValue(row, mapping.longitude)
  const latitude = Number(latitudeValue)
  const longitude = Number(longitudeValue)

  const siteName =
    getMappedValue(row, mapping.site_name) ||
    getMappedValue(row, mapping.site_number) ||
    "Untitled Site"

  return {
    site_number: getMappedValue(row, mapping.site_number) || null,
    site_name: siteName,
    city: getMappedValue(row, mapping.city) || null,
    county: getMappedValue(row, mapping.county) || null,
    state: getMappedValue(row, mapping.state) || null,
    latitude,
    longitude,
    structure_type: getMappedValue(row, mapping.structure_type) || null,
  }
}

type MappedSite = ReturnType<typeof mapRowToSite>

export function CsvImport({
  isOpen,
  onClose,
  onUploadComplete,
  userId,
}: CsvImportProps) {
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<CsvRow[]>([])
  const [mapping, setMapping] = useState<Record<SchemaKey, string>>({
    site_number: "",
    site_name: "",
    city: "",
    county: "",
    state: "",
    latitude: "",
    longitude: "",
    structure_type: "",
  })
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  const mappedPreview = useMemo(() => {
    if (!rows.length) return []
    return rows.slice(0, 3).map((row) => mapRowToSite(row, mapping))
  }, [rows, mapping])

  const canUpload = Boolean(
    userId && rows.length && mapping.latitude && mapping.longitude && !uploading
  )

  const resetState = () => {
    setHeaders([])
    setRows([])
    setMapping({
      site_number: "",
      site_name: "",
      city: "",
      county: "",
      state: "",
      latitude: "",
      longitude: "",
      structure_type: "",
    })
    setFileName(null)
    setError(null)
    setStatus(null)
    setUploading(false)
    setSuccess(null)
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    setStatus(null)
    setSuccess(null)
    setFileName(file.name)

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length) {
          setError(results.errors[0]?.message ?? "Unable to parse CSV file.")
          return
        }

        const parsedRows = results.data.filter((row) => !isRowEmpty(row))
        const parsedHeaders =
          results.meta.fields?.filter(Boolean) ??
          Array.from(
            new Set(parsedRows.flatMap((row) => Object.keys(row)))
          )

        if (!parsedHeaders.length) {
          setError("No headers found in CSV file.")
          return
        }

        if (!parsedRows.length) {
          setError("CSV file contains no data rows.")
          return
        }

        setHeaders(parsedHeaders)
        setRows(parsedRows)
        setMapping(buildAutoMapping(parsedHeaders))
        setStatus(`Parsed ${parsedRows.length} rows.`)
      },
      error: (parseError) => {
        setError(parseError.message || "Unable to parse CSV file.")
      },
    })
  }

  const handleMappingChange = (key: SchemaKey, value: string) => {
    setMapping((prev) => ({ ...prev, [key]: value }))
  }

  const handleUpload = async () => {
    if (!rows.length) return
    if (!userId) {
      setError("Sign in to upload CSV data.")
      return
    }
    if (!mapping.latitude || !mapping.longitude) {
      setError("Latitude and longitude columns are required.")
      return
    }

    setError(null)
    setStatus(null)
    setUploading(true)
    setSuccess(null)

    const mappedRows: MappedSite[] = rows.map((row) =>
      mapRowToSite(row, mapping)
    )
    const invalidRows = mappedRows.filter(
      (row) => !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)
    )

    if (invalidRows.length) {
      setUploading(false)
      setError(
        `Missing or invalid coordinates for ${invalidRows.length} row(s).`
      )
      return
    }

    try {
      for (let i = 0; i < mappedRows.length; i += BATCH_SIZE) {
        const batch = mappedRows.slice(i, i + BATCH_SIZE)
        const batchPayload = batch.map((row) => ({
          ...row,
          user_id: userId,
        }))
        setStatus(
          `Uploading rows ${i + 1}-${Math.min(
            i + BATCH_SIZE,
            mappedRows.length
          )} of ${mappedRows.length}...`
        )
        const { error: upsertError } = await supabase
          .from("sites")
          .upsert(batchPayload, { onConflict: "site_number,user_id" })

        if (upsertError) {
          throw upsertError
        }
      }

      setSuccess(`Uploaded ${mappedRows.length} site(s) to Supabase.`)
      setStatus(null)
      onUploadComplete?.()
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload CSV data."
      )
    } finally {
      setUploading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 sm:items-center sm:py-8">
      <div className="my-auto w-full max-w-4xl rounded-3xl border border-slate-800 bg-slate-900 p-4 text-slate-100 shadow-2xl sm:max-h-[calc(100svh-3rem)] sm:overflow-y-auto sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.35em] text-emerald-300">
              CSV Import
            </p>
            <h3 className="mt-2 text-[clamp(1.25rem,3vw,1.5rem)] font-semibold text-white">
              Map columns and import sites
            </h3>
            <p className="mt-2 break-words text-sm text-slate-300">
              Upload a CSV file, match columns to your schema, and review the
              first three rows before uploading.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="shrink-0 rounded-full border border-slate-700 p-2 text-slate-300 transition hover:border-slate-500 hover:text-white"
            aria-label="Close CSV import"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <label className="flex cursor-pointer flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-300 transition hover:border-emerald-400">
              <div className="flex min-w-0 items-center gap-3">
                <Upload className="h-4 w-4 text-emerald-300" />
                <span className="break-words">{fileName ?? "Choose a CSV file"}</span>
              </div>
              <span className="text-xs text-slate-400">.csv</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>

            <div className="mt-4 space-y-3 text-xs text-slate-400">
              <p>
                Rows detected:{" "}
                <span className="text-slate-200">{rows.length || 0}</span>
              </p>
              <p>
                Headers detected:{" "}
                <span className="text-slate-200">
                  {headers.length || 0}
                </span>
              </p>
              <p>Required fields: Latitude, Longitude</p>
            </div>

            {(error || status || success) && (
              <div className="mt-4 space-y-2">
                {error && (
                  <p className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                  </p>
                )}
                {status && (
                  <p className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
                    {status}
                  </p>
                )}
                {success && (
                  <p className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    <CheckCircle2 className="h-4 w-4" />
                    {success}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-sm font-semibold text-slate-200">Column mapping</p>
            <div className="mt-4 space-y-3">
              {SCHEMA_FIELDS.map((field) => (
                <label
                  key={field.key}
                  className="flex flex-col items-stretch gap-2 text-xs text-slate-300 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <span className="min-w-0 break-words text-slate-200">
                    {field.label}
                    {field.required ? " *" : ""}
                  </span>
                  <select
                    value={mapping[field.key]}
                    onChange={(event) =>
                      handleMappingChange(field.key, event.target.value)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 sm:w-44"
                  >
                    <option value="">Not mapped</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-sm font-semibold text-slate-200">
            Preview (first 3 rows)
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-xs text-slate-300">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  {SCHEMA_FIELDS.map((field) => (
                    <th key={field.key} className="px-3 py-2 font-medium">
                      {field.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mappedPreview.length ? (
                  mappedPreview.map((row, index) => (
                    <tr key={`${row.site_number ?? "row"}-${index}`}>
                      {SCHEMA_FIELDS.map((field) => (
                        <td key={field.key} className="px-3 py-2 text-slate-200">
                          {(() => {
                            const value = row[field.key]
                            if (
                              typeof value === "number" &&
                              !Number.isFinite(value)
                            ) {
                              return "-"
                            }
                            return String(value ?? "-")
                          })()}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={SCHEMA_FIELDS.length}
                      className="px-3 py-6 text-center text-slate-500"
                    >
                      Upload a CSV to preview mapped data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400">
            Large imports are uploaded in batches of {BATCH_SIZE}.
          </p>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!canUpload}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-400 px-5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading..." : "Upload to Supabase"}
          </button>
        </div>
      </div>
    </div>
  )
}
