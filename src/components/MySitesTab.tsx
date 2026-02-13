import { useEffect, useMemo, useState } from "react"
import Papa from "papaparse"
import {
  Camera,
  Download,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react"

import { supabase } from "../services/supabaseClient"

type Site = {
  id: string
  name: string
  lat: number
  lng: number
  notes: string
  photoUrl?: string
  customFields: Record<string, string>
}

type SiteForm = {
  id?: string
  name: string
  lat: string
  lng: string
  notes: string
  photoUrl?: string
  customFields: Array<{ key: string; value: string }>
}

const STORAGE_KEY = "gi-drone-sites"
const SUPABASE_BUCKET = "site-photos"

const EMPTY_FORM: SiteForm = {
  name: "",
  lat: "",
  lng: "",
  notes: "",
  photoUrl: "",
  customFields: [],
}

const hasSupabaseEnv =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `site-${Date.now()}-${Math.random().toString(16).slice(2)}`

const formatCoord = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value)

const toForm = (site: Site): SiteForm => ({
  id: site.id,
  name: site.name,
  lat: String(site.lat),
  lng: String(site.lng),
  notes: site.notes,
  photoUrl: site.photoUrl ?? "",
  customFields: Object.entries(site.customFields).map(([key, value]) => ({
    key,
    value,
  })),
})

const toSite = (form: SiteForm, fallbackId?: string): Site => {
  const customFields: Record<string, string> = {}
  form.customFields.forEach((field) => {
    const trimmedKey = field.key.trim()
    if (!trimmedKey) return
    customFields[trimmedKey] = field.value.trim()
  })

  return {
    id: form.id ?? fallbackId ?? createId(),
    name: form.name.trim() || "Untitled Site",
    lat: Number(form.lat),
    lng: Number(form.lng),
    notes: form.notes.trim(),
    photoUrl: form.photoUrl?.trim(),
    customFields,
  }
}

const readStoredSites = (): Site[] => {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => ({
      id: String(item.id ?? createId()),
      name: String(item.name ?? "Untitled Site"),
      lat: Number(item.lat ?? 0),
      lng: Number(item.lng ?? 0),
      notes: String(item.notes ?? ""),
      photoUrl: item.photoUrl ? String(item.photoUrl) : "",
      customFields: item.customFields ?? {},
    }))
  } catch (error) {
    console.error("Unable to read stored sites", error)
    return []
  }
}

const STANDARD_KEYS = new Set([
  "site_name",
  "name",
  "site",
  "lat",
  "latitude",
  "lng",
  "lon",
  "longitude",
  "notes",
  "note",
  "description",
  "photo_url",
])

const normalizeKey = (value: string) =>
  value.toLowerCase().trim().replace(/\s+/g, "_")

const parseCsvRow = (row: Record<string, string>): Site | null => {
  const normalized: Record<string, string> = {}
  Object.entries(row).forEach(([key, value]) => {
    normalized[normalizeKey(key)] = String(value ?? "").trim()
  })

  const name =
    normalized.site_name || normalized.name || normalized.site || "Untitled Site"
  const latValue = normalized.lat || normalized.latitude
  const lngValue = normalized.lng || normalized.lon || normalized.longitude
  const notes = normalized.notes || normalized.note || normalized.description || ""

  const lat = Number(latValue)
  const lng = Number(lngValue)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const customFields: Record<string, string> = {}
  Object.entries(row).forEach(([key, value]) => {
    const trimmedKey = key.trim()
    if (!trimmedKey) return
    if (STANDARD_KEYS.has(normalizeKey(trimmedKey))) return
    const trimmedValue = String(value ?? "").trim()
    if (!trimmedValue) return
    customFields[trimmedKey] = trimmedValue
  })

  return {
    id: createId(),
    name,
    lat,
    lng,
    notes,
    photoUrl: normalized.photo_url ?? "",
    customFields,
  }
}

export function MySitesTab() {
  const [initialSites] = useState<Site[]>(() => readStoredSites())
  const [sites, setSites] = useState<Site[]>(initialSites)
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSites[0]?.id ?? null
  )
  const [form, setForm] = useState<SiteForm>(
    initialSites[0] ? toForm(initialSites[0]) : EMPTY_FORM
  )
  const [isEditing, setIsEditing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sites))
  }, [sites])

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedId) ?? null,
    [selectedId, sites]
  )

  const resetToSelected = () => {
    if (selectedSite) {
      setForm(toForm(selectedSite))
    } else {
      setForm(EMPTY_FORM)
    }
    setError(null)
    setStatus(null)
  }

  useEffect(() => {
    resetToSelected()
    setIsEditing(false)
  }, [selectedId])

  const handleSelect = (siteId: string) => {
    setSelectedId(siteId)
  }

  const handleNew = () => {
    setSelectedId(null)
    setForm(EMPTY_FORM)
    setIsEditing(true)
    setError(null)
    setStatus(null)
  }

  const handleEditToggle = () => {
    setIsEditing(true)
    setStatus(null)
    setError(null)
  }

  const handleCancel = () => {
    setIsEditing(false)
    resetToSelected()
  }

  const handleDelete = () => {
    if (!selectedSite) return
    const confirmed = window.confirm(
      `Delete ${selectedSite.name}? This cannot be undone.`
    )
    if (!confirmed) return
    setSites((prev) => prev.filter((site) => site.id !== selectedSite.id))
    setSelectedId((prev) => {
      if (prev !== selectedSite.id) return prev
      const remaining = sites.filter((site) => site.id !== selectedSite.id)
      return remaining[0]?.id ?? null
    })
    setStatus("Site removed.")
  }

  const handleSave = () => {
    setError(null)
    const lat = Number(form.lat)
    const lng = Number(form.lng)
    if (!form.name.trim()) {
      setError("Site name is required.")
      return
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError("Latitude and longitude must be valid numbers.")
      return
    }

    const payload = toSite(form, selectedSite?.id)
    setSites((prev) => {
      const existingIndex = prev.findIndex((site) => site.id === payload.id)
      if (existingIndex >= 0) {
        const copy = [...prev]
        copy[existingIndex] = payload
        return copy
      }
      return [payload, ...prev]
    })
    setSelectedId(payload.id)
    setIsEditing(false)
    setStatus("Site saved.")
  }

  const handleCustomFieldChange = (
    index: number,
    field: "key" | "value",
    value: string
  ) => {
    setForm((prev) => {
      const copy = [...prev.customFields]
      copy[index] = { ...copy[index], [field]: value }
      return { ...prev, customFields: copy }
    })
  }

  const handleCustomFieldAdd = () => {
    setForm((prev) => ({
      ...prev,
      customFields: [...prev.customFields, { key: "", value: "" }],
    }))
  }

  const handleCustomFieldRemove = (index: number) => {
    setForm((prev) => {
      const copy = [...prev.customFields]
      copy.splice(index, 1)
      return { ...prev, customFields: copy }
    })
  }

  const handleCsvImport = (file: File) => {
    setError(null)
    setStatus(null)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: (results) => {
        const imported: Site[] = []
        let skipped = 0
        results.data.forEach((row) => {
          const parsed = parseCsvRow(row)
          if (parsed) imported.push(parsed)
          else skipped += 1
        })
        if (!imported.length) {
          setError("No valid rows found. Check lat/lng values and headers.")
          return
        }
        setSites((prev) => [...imported, ...prev])
        setSelectedId(imported[0].id)
        setIsEditing(false)
        setStatus(
          `Imported ${imported.length} site${imported.length === 1 ? "" : "s"}.${
            skipped ? ` Skipped ${skipped} row${skipped === 1 ? "" : "s"}.` : ""
          }`
        )
      },
      error: (parseError) => {
        setError(parseError.message)
      },
    })
  }

  const handleCsvExport = () => {
    if (!sites.length) {
      setError("No sites to export yet.")
      return
    }
    const customKeys = Array.from(
      new Set(sites.flatMap((site) => Object.keys(site.customFields)))
    ).sort()
    const rows = sites.map((site) => {
      const row: Record<string, string | number> = {
        site_name: site.name,
        lat: site.lat,
        lng: site.lng,
        notes: site.notes,
        photo_url: site.photoUrl ?? "",
      }
      customKeys.forEach((key) => {
        row[key] = site.customFields[key] ?? ""
      })
      return row
    })
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "gi-drone-sites.csv"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setStatus("CSV export generated.")
  }

  const handlePhotoUpload = async (file: File) => {
    if (!hasSupabaseEnv) {
      setError("Supabase env vars are missing. Configure VITE_SUPABASE_URL and KEY.")
      return
    }
    setUploading(true)
    setError(null)
    try {
      const fileName = file.name.replace(/\s+/g, "_")
      const path = `${selectedSite?.id ?? "new"}/${Date.now()}_${fileName}`
      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(path, file, { upsert: true })
      if (uploadError) {
        throw uploadError
      }
      const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path)
      const publicUrl = data.publicUrl
      setForm((prev) => ({ ...prev, photoUrl: publicUrl }))
      setIsEditing(true)
      setStatus("Photo uploaded. Save to attach to site.")
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed."
      )
    } finally {
      setUploading(false)
    }
  }

  const listEmpty = !sites.length

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 rounded-3xl border border-slate-800/70 bg-slate-900/60 p-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.4em] text-emerald-300">
            My Sites
          </p>
          <h2 className="text-3xl font-semibold text-white md:text-4xl">
            Launch &amp; Recovery Library
          </h2>
          <p className="max-w-2xl text-sm text-slate-300">
            Maintain every launch point, import or export CSV flight plans, and
            attach a visual reference for each pad.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-slate-400">
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-slate-800 bg-slate-950/70 px-4 py-2 text-slate-300 transition hover:text-white">
            <Upload className="h-4 w-4" />
            Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) handleCsvImport(file)
                event.currentTarget.value = ""
              }}
            />
          </label>
          <button
            type="button"
            onClick={handleCsvExport}
            className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/70 px-4 py-2 text-slate-300 transition hover:text-white"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleNew}
            className="flex items-center gap-2 rounded-full bg-emerald-400 px-4 py-2 text-slate-950 transition hover:bg-emerald-300"
          >
            <Plus className="h-4 w-4" />
            New Site
          </button>
        </div>
      </header>

      {(status || error) && (
        <div
          className={`rounded-2xl border p-4 text-sm ${
            error
              ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
          }`}
        >
          {error ?? status}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1.9fr]">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
                Site Roster
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                {listEmpty ? "No sites yet" : `${sites.length} saved sites`}
              </h3>
            </div>
            <button
              type="button"
              onClick={handleNew}
              className="flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs uppercase tracking-[0.2em] text-emerald-200 transition hover:bg-emerald-400/20"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>

          <div className="mt-6 space-y-3">
            {listEmpty && (
              <div className="rounded-2xl border border-dashed border-slate-700/70 bg-slate-950/60 p-4 text-sm text-slate-400">
                Import a CSV or add a new flight site to start tracking.
              </div>
            )}
            {sites.map((site) => (
              <button
                key={site.id}
                type="button"
                onClick={() => handleSelect(site.id)}
                className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${
                  selectedId === site.id
                    ? "border-emerald-400/60 bg-emerald-400/10"
                    : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                }`}
              >
                <div className="h-12 w-12 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
                  {site.photoUrl ? (
                    <img
                      src={site.photoUrl}
                      alt={site.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                      No Photo
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between text-sm font-semibold text-white">
                    <span>{site.name}</span>
                    <span className="text-xs text-slate-400">
                      {formatCoord(site.lat)}, {formatCoord(site.lng)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {site.notes || "No notes yet."}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
                Site Detail
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                {selectedSite?.name ?? "New Site Draft"}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
              {!isEditing && selectedSite && (
                <button
                  type="button"
                  onClick={handleEditToggle}
                  className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/70 px-3 py-2 text-slate-300 transition hover:text-white"
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </button>
              )}
              {isEditing && (
                <>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="flex items-center gap-2 rounded-full bg-emerald-400 px-3 py-2 text-slate-950 transition hover:bg-emerald-300"
                  >
                    <Save className="h-4 w-4" />
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/70 px-3 py-2 text-slate-300 transition hover:text-white"
                  >
                    <X className="h-4 w-4" />
                    Cancel
                  </button>
                </>
              )}
              {selectedSite && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-100 transition hover:bg-rose-500/20"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1.6fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    Photo
                  </p>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-full border border-slate-800 px-3 py-2 text-xs uppercase tracking-[0.2em] text-slate-300 transition ${
                      uploading ? "opacity-60" : "hover:text-white"
                    }`}
                  >
                    <Camera className="h-4 w-4" />
                    {uploading ? "Uploading" : "Upload"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) handlePhotoUpload(file)
                        event.currentTarget.value = ""
                      }}
                    />
                  </label>
                </div>
                <div className="mt-4 h-40 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
                  {form.photoUrl ? (
                    <img
                      src={form.photoUrl}
                      alt={form.name || "Site photo"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
                      No photo uploaded yet.
                    </div>
                  )}
                </div>
                {!hasSupabaseEnv && (
                  <p className="mt-3 text-xs text-slate-400">
                    Configure Supabase env vars to enable photo uploads.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-400">
                <p className="uppercase tracking-[0.3em] text-slate-500">
                  CSV Fields
                </p>
                <p className="mt-2">
                  Required headers: <span className="text-slate-200">site_name</span>,
                  <span className="text-slate-200"> lat</span>,{" "}
                  <span className="text-slate-200">lng</span>. Optional: notes and
                  any custom columns.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                  Site Name
                  <input
                    type="text"
                    value={form.name}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    disabled={!isEditing}
                    className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60 disabled:opacity-70"
                  />
                </label>
                <label className="space-y-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                  Latitude
                  <input
                    type="number"
                    value={form.lat}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, lat: event.target.value }))
                    }
                    disabled={!isEditing}
                    className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60 disabled:opacity-70"
                  />
                </label>
                <label className="space-y-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                  Longitude
                  <input
                    type="number"
                    value={form.lng}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, lng: event.target.value }))
                    }
                    disabled={!isEditing}
                    className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60 disabled:opacity-70"
                  />
                </label>
                <label className="space-y-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                  Notes
                  <textarea
                    value={form.notes}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, notes: event.target.value }))
                    }
                    disabled={!isEditing}
                    rows={3}
                    className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60 disabled:opacity-70"
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    Custom Fields
                  </p>
                  <button
                    type="button"
                    onClick={handleCustomFieldAdd}
                    disabled={!isEditing}
                    className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs uppercase tracking-[0.2em] text-slate-300 transition hover:text-white disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  {form.customFields.length === 0 && (
                    <p className="text-sm text-slate-500">
                      Add any mission-specific metadata (runway code, hazards,
                      crew chief, etc.).
                    </p>
                  )}
                  {form.customFields.map((field, index) => (
                    <div key={`${field.key}-${index}`} className="flex gap-3">
                      <input
                        type="text"
                        value={field.key}
                        onChange={(event) =>
                          handleCustomFieldChange(index, "key", event.target.value)
                        }
                        disabled={!isEditing}
                        placeholder="Field"
                        className="w-1/3 rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60 disabled:opacity-70"
                      />
                      <input
                        type="text"
                        value={field.value}
                        onChange={(event) =>
                          handleCustomFieldChange(index, "value", event.target.value)
                        }
                        disabled={!isEditing}
                        placeholder="Value"
                        className="flex-1 rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60 disabled:opacity-70"
                      />
                      <button
                        type="button"
                        onClick={() => handleCustomFieldRemove(index)}
                        disabled={!isEditing}
                        className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-100 transition hover:bg-rose-500/20 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
