import { useEffect, useMemo, useState } from "react"
import {
  Camera,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react"
import { unparse } from "papaparse"

import { supabase } from "../lib/supabase"

type SiteRecord = {
  id: string
  site_number: string | null
  site_name: string | null
  city: string | null
  county: string | null
  state: string | null
  latitude: number | null
  longitude: number | null
  structure_type: string | null
  notes?: string | null
  photo_url?: string | null
  custom_fields?: Record<string, string> | null
} & Record<string, unknown>

export type SiteDetailProps = {
  site: SiteRecord
  userId: string
  onClose: () => void
  onSiteUpdated: (site: SiteRecord) => void
  onShowOnMap: (focus: { lat: number; lon: number; name?: string | null }) => void
}

type SiteForm = {
  site_number: string
  site_name: string
  city: string
  county: string
  state: string
  latitude: string
  longitude: string
  structure_type: string
  notes: string
}

type CustomField = { key: string; value: string }

const toForm = (site: SiteRecord): SiteForm => ({
  site_number: site.site_number ?? "",
  site_name: site.site_name ?? "",
  city: site.city ?? "",
  county: site.county ?? "",
  state: site.state ?? "",
  latitude: site.latitude != null ? String(site.latitude) : "",
  longitude: site.longitude != null ? String(site.longitude) : "",
  structure_type: site.structure_type ?? "",
  notes: site.notes ?? "",
})

const toCustomFields = (fields?: Record<string, string> | null): CustomField[] =>
  fields
    ? Object.entries(fields).map(([key, value]) => ({ key, value }))
    : []

const fromCustomFields = (fields: CustomField[]) => {
  const customFields: Record<string, string> = {}
  fields.forEach((field) => {
    const trimmedKey = field.key.trim()
    if (!trimmedKey) return
    customFields[trimmedKey] = field.value.trim()
  })
  return customFields
}

export function SiteDetail({
  site,
  userId,
  onClose,
  onSiteUpdated,
  onShowOnMap,
}: SiteDetailProps) {
  const [currentSite, setCurrentSite] = useState<SiteRecord>(site)
  const [form, setForm] = useState<SiteForm>(() => toForm(site))
  const [customFields, setCustomFields] = useState<CustomField[]>(() =>
    toCustomFields(site.custom_fields ?? null)
  )
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const hasCoords =
    currentSite.latitude != null && currentSite.longitude != null

  useEffect(() => {
    setCurrentSite(site)
    setForm(toForm(site))
    setCustomFields(toCustomFields(site.custom_fields ?? null))
    setError(null)
    setStatus(null)
  }, [site])

  const metadataEntries = useMemo(
    () =>
      Object.entries(currentSite).filter(
        ([key]) => !["custom_fields"].includes(key)
      ),
    [currentSite]
  )

  const updateFormValue = (key: keyof SiteForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleAddCustomField = () => {
    setCustomFields((prev) => [...prev, { key: "", value: "" }])
  }

  const handleUpdateCustomField = (
    index: number,
    key: keyof CustomField,
    value: string
  ) => {
    setCustomFields((prev) =>
      prev.map((field, idx) =>
        idx === index ? { ...field, [key]: value } : field
      )
    )
  }

  const handleRemoveCustomField = (index: number) => {
    setCustomFields((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleSave = async () => {
    if (!userId) {
      setError("Sign in to update site metadata.")
      return
    }
    const latValue = form.latitude.trim()
    const lonValue = form.longitude.trim()
    const parsedLat = latValue ? Number(latValue) : null
    const parsedLon = lonValue ? Number(lonValue) : null
    const isLatInvalid =
      parsedLat !== null &&
      (Number.isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90)
    const isLonInvalid =
      parsedLon !== null &&
      (Number.isNaN(parsedLon) || parsedLon < -180 || parsedLon > 180)
    if (isLatInvalid || isLonInvalid) {
      setError("Latitude must be -90 to 90 and longitude must be -180 to 180.")
      return
    }
    setSaving(true)
    setError(null)
    setStatus(null)
    const payload = {
      site_number: form.site_number.trim() || null,
      site_name: form.site_name.trim() || null,
      city: form.city.trim() || null,
      county: form.county.trim() || null,
      state: form.state.trim() || null,
      latitude: parsedLat,
      longitude: parsedLon,
      structure_type: form.structure_type.trim() || null,
      notes: form.notes.trim() || null,
      custom_fields: fromCustomFields(customFields),
    }

    const { data, error: updateError } = await supabase
      .from("sites")
      .update(payload)
      .eq("id", currentSite.id)
      .eq("user_id", userId)
      .select("*")
      .single()

    if (updateError) {
      setSaving(false)
      setError(updateError.message)
      return
    }

    const updatedSite = data as SiteRecord
    setCurrentSite(updatedSite)
    setForm(toForm(updatedSite))
    setCustomFields(toCustomFields(updatedSite.custom_fields ?? null))
    setSaving(false)
    setStatus("Site updated.")
    onSiteUpdated(updatedSite)
  }

  const handlePhotoUpload = async (file: File) => {
    if (!userId) {
      setError("Sign in to upload site photos.")
      return
    }
    if (!file.type.startsWith("image/")) {
      setError("Please upload a valid image file.")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image files must be 5MB or smaller.")
      return
    }
    setUploading(true)
    setError(null)
    setStatus(null)
    const filePath = `${userId}/${currentSite.id}/photo.jpg`
    const { error: uploadError } = await supabase.storage
      .from("site-photos")
      .upload(filePath, file, { upsert: true, contentType: file.type })

    if (uploadError) {
      setUploading(false)
      setError(uploadError.message)
      return
    }

    const { data: publicData } = supabase.storage
      .from("site-photos")
      .getPublicUrl(filePath)

    const photoUrl = publicData.publicUrl

    const { data, error: updateError } = await supabase
      .from("sites")
      .update({ photo_url: photoUrl })
      .eq("id", currentSite.id)
      .eq("user_id", userId)
      .select("*")
      .single()

    if (updateError) {
      setUploading(false)
      setError(updateError.message)
      return
    }

    const updatedSite = data as SiteRecord
    setCurrentSite(updatedSite)
    setStatus("Site photo updated.")
    setUploading(false)
    onSiteUpdated(updatedSite)
  }

  const handleExport = () => {
    if (exporting) return
    setExporting(true)
    try {
      const latitudeValue =
        form.latitude.trim() !== ""
          ? form.latitude.trim()
          : currentSite.latitude ?? ""
      const longitudeValue =
        form.longitude.trim() !== ""
          ? form.longitude.trim()
          : currentSite.longitude ?? ""
      const payload = {
        id: currentSite.id,
        site_number: form.site_number.trim() || currentSite.site_number || "",
        site_name: form.site_name.trim() || currentSite.site_name || "",
        city: form.city.trim() || currentSite.city || "",
        county: form.county.trim() || currentSite.county || "",
        state: form.state.trim() || currentSite.state || "",
        latitude: latitudeValue,
        longitude: longitudeValue,
        structure_type:
          form.structure_type.trim() || currentSite.structure_type || "",
        notes: form.notes.trim() || currentSite.notes || "",
        photo_url: currentSite.photo_url ?? "",
        custom_fields: JSON.stringify(fromCustomFields(customFields)),
      }
      const csv = unparse([payload])
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `site-${currentSite.site_number ?? currentSite.id}.csv`
      link.click()
      window.URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 px-4 py-6 md:items-stretch md:justify-end md:px-0">
      <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl md:h-full md:max-h-none md:max-w-3xl md:rounded-none md:rounded-l-3xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/60 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-emerald-300">
              Site Detail
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">
              {currentSite.site_name ?? "Untitled Site"}
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              {currentSite.site_number ? `#${currentSite.site_number}` : "No ID"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!hasCoords) return
                onShowOnMap({
                  lat: currentSite.latitude as number,
                  lon: currentSite.longitude as number,
                  name: currentSite.site_name ?? currentSite.site_number ?? "Site",
                })
                onClose()
              }}
              disabled={!hasCoords}
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
            >
              <ExternalLink className="h-4 w-4" />
              {hasCoords ? "Show on Map" : "No Coordinates"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-700 p-2 text-slate-300 transition hover:border-slate-500 hover:text-white"
              aria-label="Close site detail"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="space-y-6">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-200">
                    Core Metadata
                  </h4>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-400 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save changes
                  </button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="text-xs text-slate-400">
                    Site Number
                    <input
                      value={form.site_number}
                      onChange={(event) =>
                        updateFormValue("site_number", event.target.value)
                      }
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    Site Name
                    <input
                      value={form.site_name}
                      onChange={(event) =>
                        updateFormValue("site_name", event.target.value)
                      }
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    City
                    <input
                      value={form.city}
                      onChange={(event) =>
                        updateFormValue("city", event.target.value)
                      }
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    County
                    <input
                      value={form.county}
                      onChange={(event) =>
                        updateFormValue("county", event.target.value)
                      }
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    State / Region
                    <input
                      value={form.state}
                      onChange={(event) =>
                        updateFormValue("state", event.target.value)
                      }
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    Structure Type
                    <input
                      value={form.structure_type}
                      onChange={(event) =>
                        updateFormValue("structure_type", event.target.value)
                      }
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                    />
                  </label>
                  <label className="text-xs text-slate-400 md:col-span-2">
                    Notes
                    <textarea
                      value={form.notes}
                      onChange={(event) =>
                        updateFormValue("notes", event.target.value)
                      }
                      rows={3}
                      className="mt-1 w-full resize-none rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    Latitude
                    <input
                      value={form.latitude}
                      onChange={(event) =>
                        updateFormValue("latitude", event.target.value)
                      }
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    Longitude
                    <input
                      value={form.longitude}
                      onChange={(event) =>
                        updateFormValue("longitude", event.target.value)
                      }
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-200">
                    Custom Fields
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddCustomField}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200"
                  >
                    <Plus className="h-4 w-4" />
                    Add field
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  {customFields.length ? (
                    customFields.map((field, index) => (
                      <div
                        key={`${field.key}-${index}`}
                        className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
                      >
                        <input
                          value={field.key}
                          onChange={(event) =>
                            handleUpdateCustomField(
                              index,
                              "key",
                              event.target.value
                            )
                          }
                          placeholder="Field name"
                          className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                        />
                        <input
                          value={field.value}
                          onChange={(event) =>
                            handleUpdateCustomField(
                              index,
                              "value",
                              event.target.value
                            )
                          }
                          placeholder="Value"
                          className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomField(index)}
                          className="inline-flex items-center justify-center rounded-full border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:border-rose-400 hover:text-rose-200"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500">
                      No custom fields yet. Add one to track vendor or asset data.
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-6">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <h4 className="text-sm font-semibold text-slate-200">
                  Winner Photo
                </h4>
                <div className="mt-3 flex flex-col gap-3">
                  {currentSite.photo_url ? (
                    <img
                      src={currentSite.photo_url}
                      alt="Winner photo"
                      className="h-48 w-full rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-slate-700 text-xs text-slate-500">
                      No winner photo uploaded.
                    </div>
                  )}
                  <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-dashed border-slate-700 px-4 py-3 text-xs text-slate-300 transition hover:border-emerald-400">
                    <span className="inline-flex items-center gap-2">
                      <Camera className="h-4 w-4 text-emerald-300" />
                      {uploading ? "Uploading..." : "Upload winner photo"}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) {
                          handlePhotoUpload(file)
                          event.target.value = ""
                        }
                      }}
                      disabled={uploading}
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <h4 className="text-sm font-semibold text-slate-200">
                  Full Metadata
                </h4>
                <div className="mt-3 space-y-2 text-xs text-slate-300">
                  {metadataEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-start justify-between gap-4"
                    >
                      <span className="text-slate-500">{key}</span>
                      <span className="text-slate-200">
                        {value == null || value === "" ? "-" : String(value)}
                      </span>
                    </div>
                  ))}
                  <div className="mt-4">
                    <p className="text-slate-500">custom_fields</p>
                    <pre className="mt-2 max-h-40 overflow-auto rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[11px] text-slate-300">
                      {JSON.stringify(fromCustomFields(customFields), null, 2)}
                    </pre>
                  </div>
                </div>
              </div>

              {(error || status) && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-xs">
                  {error && <p className="text-rose-300">{error}</p>}
                  {status && <p className="text-emerald-300">{status}</p>}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
