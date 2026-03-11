import { useEffect, useMemo, useState } from "react"
import {
  ArrowUpDown,
  Camera,
  Download,
  Loader2,
  MapPin,
  RotateCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { unparse } from "papaparse"

import { supabase } from "../lib/supabase"
import { processImageForUpload, rotateImage90 } from "../lib/imageProcessing"
import { CsvImport } from "./CsvImport"
import { SitePhoto } from "./SitePhoto"

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
  const [rotatingPhoto, setRotatingPhoto] = useState(false)
  const [noteInput, setNoteInput] = useState("")
  const [savingNote, setSavingNote] = useState(false)
  const [siteNotes, setSiteNotes] = useState<{ id: string; content: string; created_at: string }[]>([])
  const [loadingNotes, setLoadingNotes] = useState(false)

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
    setNoteInput("")
    setSiteNotes([])
    if (!selectedSite) return
    setLoadingNotes(true)
    supabase
      .from("site_notes")
      .select("id, content, created_at")
      .eq("site_id", selectedSite.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setSiteNotes(data ?? [])
        setLoadingNotes(false)
      })
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

    setUploadingPhoto(true)
    setDetailError(null)
    setDetailStatus(null)

    let processed: File
    try {
      processed = await processImageForUpload(file)
    } catch (err) {
      setUploadingPhoto(false)
      setDetailError(err instanceof Error ? err.message : "Image processing failed.")
      return
    }

    const filePath = `${userId}/${selectedSite.id}/${Date.now()}.webp`

    const { error: uploadError } = await supabase.storage
      .from("site-photos")
      .upload(filePath, processed, { upsert: true, contentType: "image/webp" })

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

  const handlePhotoDelete = async () => {
    if (!selectedSite || !userId) return
    setDetailError(null)
    setDetailStatus(null)

    const filePath = `${userId}/${selectedSite.id}/photo.webp`
    await supabase.storage.from("site-photos").remove([filePath])

    const { data, error: updateError } = await supabase
      .from("sites")
      .update({ photo_url: null })
      .eq("id", selectedSite.id)
      .eq("user_id", userId)
      .select("*")
      .single()

    if (updateError) {
      setDetailError(updateError.message)
      return
    }

    const updated = data as SiteRecord
    setSites((prev) =>
      prev.map((site) => (site.id === updated.id ? updated : site))
    )
    setSelectedSite(updated)
    setDetailStatus("Photo removed.")
  }

  const handlePhotoRotate = async () => {
    if (!selectedSite?.photo_url || !userId) return
    setRotatingPhoto(true)
    setDetailError(null)
    setDetailStatus(null)

    try {
      const rotated = await rotateImage90(selectedSite.photo_url)
      const filePath = `${userId}/${selectedSite.id}/photo.webp`

      const { error: uploadError } = await supabase.storage
        .from("site-photos")
        .upload(filePath, rotated, { upsert: true, contentType: "image/webp" })

      if (uploadError) {
        setDetailError(uploadError.message)
        setRotatingPhoto(false)
        return
      }

      const { data: publicData } = supabase.storage
        .from("site-photos")
        .getPublicUrl(filePath)

      const photoUrl = `${publicData.publicUrl}?t=${Date.now()}`

      const { data, error: updateError } = await supabase
        .from("sites")
        .update({ photo_url: photoUrl })
        .eq("id", selectedSite.id)
        .eq("user_id", userId)
        .select("*")
        .single()

      if (updateError) {
        setDetailError(updateError.message)
        setRotatingPhoto(false)
        return
      }

      const updated = data as SiteRecord
      setSites((prev) =>
        prev.map((site) => (site.id === updated.id ? updated : site))
      )
      setSelectedSite(updated)
      setDetailStatus("Photo rotated.")
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Rotation failed.")
    } finally {
      setRotatingPhoto(false)
    }
  }

  const handleAddNote = async () => {
    if (!selectedSite || !userId || !noteInput.trim()) return
    setSavingNote(true)
    setDetailError(null)
    setDetailStatus(null)

    const { data, error: insertError } = await supabase
      .from("site_notes")
      .insert({ site_id: selectedSite.id, user_id: userId, content: noteInput.trim() })
      .select("id, content, created_at")
      .single()

    if (insertError) {
      setSavingNote(false)
      setDetailError(insertError.message)
      return
    }

    setSiteNotes((prev) => [data, ...prev])
    setNoteInput("")
    setDetailStatus("Note added.")
    setSavingNote(false)
  }

  const handleDeleteNote = async (noteId: string) => {
    const { error: deleteError } = await supabase
      .from("site_notes")
      .delete()
      .eq("id", noteId)

    if (deleteError) {
      setDetailError(deleteError.message)
      return
    }

    setSiteNotes((prev) => prev.filter((n) => n.id !== noteId))
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
                <div className="flex overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70">
                  <SitePhoto
                    src={selectedSite.photo_url}
                    alt={selectedSite.site_name ?? "Site photo"}
                    lat={selectedSite.latitude}
                    lng={selectedSite.longitude}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200">
                    <Camera className="h-4 w-4" />
                    {uploadingPhoto ? "Uploading..." : "Upload"}
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
                  {selectedSite.photo_url && (
                    <>
                      <button
                        type="button"
                        onClick={handlePhotoRotate}
                        disabled={rotatingPhoto}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                      >
                        <RotateCw className={`h-4 w-4${rotatingPhoto ? " animate-spin" : ""}`} />
                        Rotate
                      </button>
                      <button
                        type="button"
                        onClick={handlePhotoDelete}
                        className="inline-flex items-center gap-2 rounded-full border border-red-500/30 px-4 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/20"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </>
                  )}
                </div>
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
                    Notes
                  </h4>
                  <div className="mt-3 flex gap-2">
                    <textarea
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      rows={2}
                      placeholder="Add a note..."
                      className="flex-1 resize-none rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddNote}
                      disabled={savingNote || !noteInput.trim()}
                      className="self-end rounded-xl bg-emerald-400 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                    >
                      {savingNote ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                    {loadingNotes ? (
                      <p className="text-xs text-slate-500">Loading notes...</p>
                    ) : siteNotes.length ? (
                      siteNotes.map((note) => (
                        <div
                          key={note.id}
                          className="group flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm text-slate-200">
                              {note.content}
                            </p>
                            <p className="mt-1 text-[10px] text-slate-500">
                              {new Date(note.created_at).toLocaleString()}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteNote(note.id)}
                            className="shrink-0 rounded p-0.5 text-slate-600 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
                            aria-label="Delete note"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500">No notes yet.</p>
                    )}
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
