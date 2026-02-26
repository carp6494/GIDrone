import { useEffect, useMemo, useState } from "react"
import {
  ArrowUpDown,
  Camera,
  Download,
  MapPin,
  Search,
  Upload,
  X,
} from "lucide-react"
import { unparse } from "papaparse"

import { supabase } from "../lib/supabase"
import { CsvImport } from "./CsvImport"

type SitesTabProps = {
  userId: string | null
  onShowOnMap: (focus: { lat: number; lon: number; name?: string | null }) => void
}

type SiteRecord = {
  id: string
  user_id?: string | null
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

type SortDirection = "asc" | "desc"

const formatCoordinate = (value: number | null, digits = 4) =>
  value == null ? "-" : value.toFixed(digits)

const getDisplayName = (site: SiteRecord) =>
  site.site_name ?? site.site_number ?? "Untitled Site"

export function SitesTab({ userId, onShowOnMap }: SitesTabProps) {
  const [sites, setSites] = useState<SiteRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [exporting, setExporting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [selectedSite, setSelectedSite] = useState<SiteRecord | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailStatus, setDetailStatus] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  const refreshSites = async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from("sites")
      .select("*")
      .eq("user_id", userId)

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    const nextSites = (data ?? []) as SiteRecord[]
    setSites(nextSites)
    setSelectedSite((current) =>
      current ? nextSites.find((site) => site.id === current.id) ?? current : null
    )
    setLoading(false)
  }

  useEffect(() => {
    if (!userId) {
      setSites([])
      setSelectedSite(null)
      setLoading(false)
      setError(null)
      return
    }
    refreshSites().catch((fetchError) => {
      setError(
        fetchError instanceof Error ? fetchError.message : "Unable to load sites."
      )
    })
  }, [userId])

  useEffect(() => {
    setDetailError(null)
    setDetailStatus(null)
  }, [selectedSite])

  const filteredSites = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const filtered = sites.filter((site) => {
      if (!query) return true
      return (
        (site.site_number ?? "").toLowerCase().includes(query) ||
        (site.site_name ?? "").toLowerCase().includes(query)
      )
    })

    const sorted = [...filtered].sort((a, b) => {
      const aValue = (a.site_name ?? a.site_number ?? "").trim()
      const bValue = (b.site_name ?? b.site_number ?? "").trim()
      return aValue.localeCompare(bValue, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    })

    if (sortDirection === "desc") {
      sorted.reverse()
    }

    return sorted
  }, [sites, searchQuery, sortDirection])

  const handleExport = () => {
    if (exporting) return
    setExporting(true)
    setError(null)
    setStatus(null)

    try {
      if (!filteredSites.length) {
        setError("No matching sites to export.")
        return
      }

      const rows = filteredSites.map((site) => ({
        id: site.id,
        user_id: site.user_id ?? userId ?? "",
        site_number: site.site_number ?? "",
        site_name: site.site_name ?? "",
        city: site.city ?? "",
        county: site.county ?? "",
        state: site.state ?? "",
        latitude: site.latitude ?? "",
        longitude: site.longitude ?? "",
        structure_type: site.structure_type ?? "",
        notes: site.notes ?? "",
        photo_url: site.photo_url ?? "",
        custom_fields: site.custom_fields
          ? JSON.stringify(site.custom_fields)
          : "",
      }))

      const csv = unparse(rows)
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "sites-export.csv"
      link.click()
      window.URL.revokeObjectURL(url)
      setStatus(`Exported ${rows.length} site(s).`)
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Unable to export sites."
      )
    } finally {
      setExporting(false)
    }
  }

  const handlePhotoUpload = async (file: File) => {
    if (!selectedSite) return
    if (!userId) {
      setDetailError("Sign in to upload site photos.")
      return
    }
    if (!file.type.startsWith("image/")) {
      setDetailError("Please upload a valid image file.")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setDetailError("Image files must be 5MB or smaller.")
      return
    }

    setUploadingPhoto(true)
    setDetailError(null)
    setDetailStatus(null)

    const extension = file.name.split(".").pop() || "jpg"
    const filePath = `${userId}/${selectedSite.id}/${Date.now()}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from("site-photos")
      .upload(filePath, file, { upsert: true, contentType: file.type })

    if (uploadError) {
      setUploadingPhoto(false)
      setDetailError(uploadError.message)
      return
    }

    const { data: publicData } = supabase.storage
      .from("site-photos")
      .getPublicUrl(filePath)

    const photoUrl = publicData.publicUrl

    const { data, error: updateError } = await supabase
      .from("sites")
      .update({ photo_url: photoUrl })
      .eq("id", selectedSite.id)
      .eq("user_id", userId)
      .select("*")
      .single()

    if (updateError) {
      setUploadingPhoto(false)
      setDetailError(updateError.message)
      return
    }

    const updated = data as SiteRecord
    setSites((prev) =>
      prev.map((site) => (site.id === updated.id ? updated : site))
    )
    setSelectedSite(updated)
    setDetailStatus("Site photo updated.")
    setUploadingPhoto(false)
  }

  const detailFields = selectedSite
    ? [
        { label: "Site Number", value: selectedSite.site_number ?? "-" },
        { label: "Site Name", value: selectedSite.site_name ?? "-" },
        { label: "City", value: selectedSite.city ?? "-" },
        { label: "County", value: selectedSite.county ?? "-" },
        { label: "State", value: selectedSite.state ?? "-" },
        { label: "Structure Type", value: selectedSite.structure_type ?? "-" },
        { label: "Latitude", value: formatCoordinate(selectedSite.latitude) },
        { label: "Longitude", value: formatCoordinate(selectedSite.longitude) },
        { label: "Notes", value: selectedSite.notes ?? "-" },
      ]
    : []

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 text-slate-100">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.35em] text-emerald-300">
            Dashboard
          </p>
          <h2 className="text-2xl font-semibold text-white">Site Dashboard</h2>
          <p className="text-sm text-slate-300">
            Search your site inventory, upload photos, and export filtered
            datasets to CSV.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-400/60 bg-emerald-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-200 transition hover:border-emerald-300 hover:bg-emerald-300/20"
          >
            <Upload className="h-4 w-4" />
            Import Sites
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!filteredSites.length || exporting}
            className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
          >
            <Download className="h-4 w-4" />
            {exporting ? "Exporting..." : "Export to CSV"}
          </button>
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by site number or site name"
            aria-label="Search by site number or site name"
            className="w-full rounded-2xl border border-slate-800 bg-slate-950/60 py-2 pl-10 pr-3 text-sm text-slate-200"
          />
        </label>
        <button
          type="button"
          onClick={() =>
            setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
          }
          className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200"
        >
          <ArrowUpDown className="h-4 w-4" />
          {sortDirection === "asc" ? "Sort A-Z" : "Sort Z-A"}
        </button>
      </div>

      {(error || status) && (
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
          {error && <p className="text-rose-300">{error}</p>}
          {status && <p className="text-emerald-300">{status}</p>}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3 text-xs text-slate-400">
          <span>
            {filteredSites.length
              ? `Showing ${filteredSites.length} site(s)`
              : "No sites to display"}
          </span>
          {loading && <span>Refreshing list...</span>}
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="min-w-[760px] w-full text-left text-xs text-slate-300">
            <thead className="sticky top-0 bg-slate-950/90 text-[11px] uppercase tracking-[0.2em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Structure</th>
                <th className="px-4 py-3">Coordinates</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Loading sites...
                  </td>
                </tr>
              ) : filteredSites.length ? (
                filteredSites.map((site) => {
                  const hasCoords =
                    site.latitude != null && site.longitude != null
                  return (
                    <tr
                      key={site.id}
                      className="border-b border-slate-800/70 transition hover:bg-slate-900/70"
                    >
                      <td className="px-4 py-4">
                        <div className="break-words text-sm font-semibold text-white">
                          {getDisplayName(site)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {site.site_number ? `#${site.site_number}` : "No ID"}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-[11px] text-slate-400">
                        {[site.city, site.state].filter(Boolean).join(", ") ||
                          "-"}
                      </td>
                      <td className="px-4 py-4 text-[11px] text-slate-400">
                        {site.structure_type ?? "-"}
                      </td>
                      <td className="px-4 py-4 text-[11px] text-slate-400">
                        {formatCoordinate(site.latitude)}, {formatCoordinate(site.longitude)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedSite(site)}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200"
                          >
                            View Detail
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!hasCoords) return
                              onShowOnMap({
                                lat: site.latitude as number,
                                lon: site.longitude as number,
                                name: site.site_name ?? site.site_number ?? "Site",
                              })
                            }}
                            disabled={!hasCoords}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            Show on Map
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No sites match the current search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CsvImport
        isOpen={importOpen}
        onClose={() => {
          setImportOpen(false)
          refreshSites()
        }}
        onUploadComplete={() => {
          refreshSites()
        }}
        userId={userId}
      />

      {selectedSite ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 sm:items-center sm:py-8">
          <div className="my-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl sm:max-h-[calc(100svh-3rem)] sm:overflow-y-auto">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/60 px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-emerald-300">
                  Site Detail
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  {getDisplayName(selectedSite)}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  {selectedSite.site_number
                    ? `#${selectedSite.site_number}`
                    : "No ID"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      selectedSite.latitude == null ||
                      selectedSite.longitude == null
                    ) {
                      return
                    }
                    onShowOnMap({
                      lat: selectedSite.latitude,
                      lon: selectedSite.longitude,
                      name:
                        selectedSite.site_name ??
                        selectedSite.site_number ??
                        "Site",
                    })
                    setSelectedSite(null)
                  }}
                  disabled={
                    selectedSite.latitude == null || selectedSite.longitude == null
                  }
                  className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                >
                  <MapPin className="h-4 w-4" />
                  Show on Map
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSite(null)}
                  className="rounded-full border border-slate-700 p-2 text-slate-300 transition hover:border-slate-500 hover:text-white"
                  aria-label="Close site detail"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="grid gap-6 px-4 py-4 sm:px-6 sm:py-6 xl:grid-cols-[1fr_1.1fr]">
              <div className="min-w-0 space-y-4">
                <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70">
                  {selectedSite.photo_url ? (
                    <img
                      src={selectedSite.photo_url}
                      alt={selectedSite.site_name ?? "Site photo"}
                      className="h-56 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-56 items-center justify-center text-xs text-slate-500">
                      No photo uploaded
                    </div>
                  )}
                </div>
                <label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-700 bg-slate-950/70 px-4 py-3 text-xs text-slate-300 transition hover:border-emerald-400">
                  <span className="flex items-center gap-2">
                    <Camera className="h-4 w-4 text-emerald-300" />
                    {uploadingPhoto ? "Uploading..." : "Upload site photo"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) {
                        handlePhotoUpload(file)
                      }
                      event.currentTarget.value = ""
                    }}
                    disabled={uploadingPhoto}
                    className="hidden"
                  />
                </label>
                {detailError && (
                  <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {detailError}
                  </p>
                )}
                {detailStatus && (
                  <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    {detailStatus}
                  </p>
                )}
              </div>

              <div className="min-w-0 space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <h4 className="text-sm font-semibold text-slate-200">
                    Site Metadata
                  </h4>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {detailFields.map((field) => (
                      <div key={field.label} className="text-xs text-slate-400">
                        <p className="uppercase tracking-[0.2em] text-[10px] text-slate-500">
                          {field.label}
                        </p>
                          <p className="mt-1 break-words text-sm text-slate-200">
                            {field.value}
                          </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <h4 className="text-sm font-semibold text-slate-200">
                    Custom Fields
                  </h4>
                  <div className="mt-4 space-y-2 text-xs text-slate-400">
                    {selectedSite.custom_fields &&
                    Object.keys(selectedSite.custom_fields).length ? (
                      Object.entries(selectedSite.custom_fields).map(
                        ([key, value]) => (
                          <div
                            key={key}
                            className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2"
                          >
                            <span className="min-w-0 break-words text-slate-200">{key}</span>
                            <span className="min-w-0 break-words text-right text-slate-400">
                              {value}
                            </span>
                          </div>
                        )
                      )
                    ) : (
                      <p className="text-slate-500">No custom fields found.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
