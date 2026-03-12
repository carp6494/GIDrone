import { useEffect, useMemo, useState } from "react"
import { Languages, Loader2, Map as MapIcon, RefreshCcw } from "lucide-react"

import { useMetars } from "../hooks/useMetars"
import { useNotams } from "../hooks/useNotams"
import { useObstructions } from "../hooks/useObstructions"
import { useTfrs } from "../hooks/useTfrs"
import type { AviationMetar, AviationStation, NotamItem, ObstructionItem, TfrItem } from "../lib/aviation/types"
import { AviationTile } from "./AviationTile"

type AviationPanelProps = {
  lat: number
  lon: number
  onMapTfr?: (item: TfrItem) => void
  onMapNotam?: (item: NotamItem) => void
  onMapObstruction?: (item: ObstructionItem) => void
}

const OBSTRUCTION_SORT_OPTIONS = [
  { value: "distance", label: "Distance" },
  { value: "height", label: "Height" },
  { value: "type", label: "Type" },
  { value: "lighting", label: "Lighting" },
  { value: "marking", label: "Marking" },
  { value: "asrn", label: "ASR" },
] as const

type ObstructionSortBy = (typeof OBSTRUCTION_SORT_OPTIONS)[number]["value"]

type MetarListRow = {
  station: AviationStation
  metar: AviationMetar | null
}

const AVIATION_RADIUS_OPTIONS = [25, 50, 100, 250] as const
type AviationRadiusMiles = (typeof AVIATION_RADIUS_OPTIONS)[number]
const AVIATION_RADIUS_STORAGE_KEY = "aviationRadiusMiles"

const readStoredRadiusMiles = (): AviationRadiusMiles => {
  if (typeof window === "undefined") return 50

  const rawValue = window.localStorage.getItem(AVIATION_RADIUS_STORAGE_KEY)
  const parsedValue = Number(rawValue)

  return AVIATION_RADIUS_OPTIONS.includes(parsedValue as AviationRadiusMiles)
    ? (parsedValue as AviationRadiusMiles)
    : 50
}

const formatTimeLabel = (value: string | null | undefined) => {
  if (!value) return "--"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date)
}

const formatTimeWindow = (startsAt: string | null, endsAt: string | null) => {
  const start = formatTimeLabel(startsAt)
  const end = formatTimeLabel(endsAt)
  if (start === "--" && end === "--") return "Time window unavailable"
  return `${start} to ${end}`
}

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const resolveNotamId = (item: NotamItem, index: number) =>
  asNonEmptyString(item.notamId) ??
  asNonEmptyString(item.id) ??
  asNonEmptyString(item["number"]) ??
  `NOTAM ${index + 1}`

const resolveNotamType = (item: NotamItem) =>
  asNonEmptyString(item.type) ??
  asNonEmptyString(item.category) ??
  asNonEmptyString(item.subtype)

const resolveNotamLocation = (item: NotamItem) => {
  const directLocation = asNonEmptyString(item.location)
  if (directLocation) return directLocation

  const facilityLabel = [asNonEmptyString(item.facility), asNonEmptyString(item.state)]
    .filter(Boolean)
    .join(" | ")

  return facilityLabel ? facilityLabel : null
}

const resolveNotamDescription = (item: NotamItem) =>
  asNonEmptyString(item.description) ??
  asNonEmptyString(item["text"]) ??
  asNonEmptyString(item["rawText"])

const resolveNotamStartsAt = (item: NotamItem) =>
  asNonEmptyString(item.startsAt) ?? asNonEmptyString(item.effectiveStart)

const resolveNotamEndsAt = (item: NotamItem) =>
  asNonEmptyString(item.endsAt) ?? asNonEmptyString(item.effectiveEnd)

const formatFeetLabel = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} ft` : null

const resolveLightingLabel = (item: NotamItem) => {
  const status = asNonEmptyString(item.lightingStatus)
  if (status) return status
  if (item.lightingPresent === true) return "Lighted"
  if (item.lightingPresent === false) return "Unlit"
  return null
}

const asFiniteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const LIGHTING_CODE_LABELS: Record<string, string> = {
  R: "Red",
  D: "Dual (red/white)",
  C: "Catenary",
  F: "Flood",
  H: "High intensity",
  M: "Medium intensity",
  S: "Strobe",
  N: "None",
}

const formatLightingCode = (code: string | null) => {
  if (!code) return null
  return LIGHTING_CODE_LABELS[code.toUpperCase()] ?? code
}

const MARK_INDICATOR_LABELS: Record<string, string> = {
  P: "Painted",
  F: "Flag",
  W: "White paint",
  M: "Marked",
  N: "None",
}

const formatMarkIndicator = (indicator: string | null) => {
  if (!indicator) return null
  return MARK_INDICATOR_LABELS[indicator.toUpperCase()] ?? indicator
}

const isNotamMappable = (item: NotamItem) =>
  asFiniteNumber(item.mapLat) !== null &&
  asFiniteNumber(item.mapLon) !== null

const getFlightCategoryLabel = (value: unknown) => {
  if (typeof value !== "string") return null
  const normalized = value.trim().toUpperCase()
  if (!normalized) return null

  const labels: Record<string, string> = {
    VFR: "Visual flight rules",
    MVFR: "Marginal visual flight rules",
    IFR: "Instrument flight rules",
    LIFR: "Low instrument flight rules",
  }

  return labels[normalized] ? `${normalized} (${labels[normalized]})` : normalized
}

const translateMetarToPlainEnglish = (metar: AviationMetar | null) => {
  if (!metar) return null

  const flightCategory = getFlightCategoryLabel(metar.fltCat)
  const windDirText = typeof metar.wdir === "number" ? `${Math.round(metar.wdir)} degrees` : null
  const windSpeed = typeof metar.wspd === "number" ? `${Math.round(metar.wspd)} knots` : null
  const gust = typeof metar.wgst === "number" ? `${Math.round(metar.wgst)} knots` : null
  const visibility =
    typeof metar.visib === "string" || typeof metar.visib === "number"
      ? `${metar.visib} statute mile${String(metar.visib) === "1" ? "" : "s"}`
      : null
  const temp = typeof metar.temp === "number" ? `${Math.round(metar.temp)}C` : null
  const dewpoint = typeof metar.dewp === "number" ? `${Math.round(metar.dewp)}C` : null

  const parts = [
    flightCategory ? `Flight category is ${flightCategory}` : null,
    windSpeed
      ? `Wind is ${windDirText ? `from ${windDirText} ` : "variable at "}${windSpeed}${
          gust ? `, gusting ${gust}` : ""
        }`
      : null,
    visibility ? `Visibility is ${visibility}` : null,
    temp && dewpoint
      ? `Temperature is ${temp} with a dew point of ${dewpoint}`
      : temp
        ? `Temperature is ${temp}`
        : dewpoint
          ? `Dew point is ${dewpoint}`
          : null,
  ].filter(Boolean)

  return parts.length ? `${parts.join(". ")}.` : null
}

const buildMetarRows = (stations: AviationStation[], metars: AviationMetar[]): MetarListRow[] => {
  const latestByIcao = new Map<string, AviationMetar>()

  for (const metar of metars) {
    const id = typeof metar.icaoId === "string" ? metar.icaoId.toUpperCase() : ""
    if (!id) continue
    const existing = latestByIcao.get(id)
    const nextObs = typeof metar.obsTime === "number" ? metar.obsTime : -1
    const currentObs = existing && typeof existing.obsTime === "number" ? existing.obsTime : -1
    if (!existing || nextObs >= currentObs) {
      latestByIcao.set(id, metar)
    }
  }

  return stations.map((station) => ({
    station,
    metar: latestByIcao.get(station.id.toUpperCase()) ?? null,
  }))
}

function TileRefreshButton({
  onClick,
  loading,
  ariaLabel,
}: {
  onClick: () => void
  loading: boolean
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-emerald-300/60 hover:text-white"
      aria-label={ariaLabel}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
      Refresh
    </button>
  )
}

function TileErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
      {message}
    </div>
  )
}

export function AviationPanel({ lat, lon, onMapTfr, onMapNotam, onMapObstruction }: AviationPanelProps) {
  const isDev = import.meta.env.DEV
  const [radiusMiles, setRadiusMiles] = useState<AviationRadiusMiles>(() => readStoredRadiusMiles())
  const [translatedMetars, setTranslatedMetars] = useState<Record<string, boolean>>({})
  const [obstructionSortBy, setObstructionSortBy] = useState<ObstructionSortBy>("distance")

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(AVIATION_RADIUS_STORAGE_KEY, String(radiusMiles))
  }, [radiusMiles])

  const metars = useMetars({ lat, lon, radiusMiles, limit: 5 })
  const tfrs = useTfrs({ lat, lon, radiusMiles })
  const notams = useNotams({ lat, lon, radiusMiles })
  const obstructionsResult = useObstructions({ lat, lon, radiusMiles, sortBy: obstructionSortBy })

  const metarRows = useMemo(
    () => buildMetarRows(metars.data?.stations ?? [], metars.data?.metars ?? []),
    [metars.data]
  )
  const notamProviderError =
    typeof notams.data?.error === "string" && notams.data.error.trim()
      ? notams.data.error.trim()
      : null
  const notamItems = Array.isArray(notams.data?.items) ? notams.data.items : []

  return (
    <section className="rounded-3xl border border-slate-800/70 bg-slate-950/60 p-6">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Aviation</p>
        <div className="mt-2 flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <h3 className="min-w-0 text-[clamp(1.2rem,2vw,1.25rem)] font-semibold text-white">
            Airspace + Surface Observations
          </h3>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {AVIATION_RADIUS_OPTIONS.map((radius) => (
              <button
                key={radius}
                type="button"
                onClick={() => setRadiusMiles(radius)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                  radiusMiles === radius
                    ? "border-emerald-300/70 bg-emerald-400/15 text-emerald-100"
                    : "border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white"
                }`}
                aria-pressed={radiusMiles === radius}
              >
                {radius} mi
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AviationTile
          label="Meteorological Aerodrome Reports"
          title="METARs near you"
          rightHeaderSlot={
            <TileRefreshButton
              onClick={metars.refresh}
              loading={metars.isLoading || metars.isRefreshing}
              ariaLabel="Refresh METARs"
            />
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Within {radiusMiles} mi</p>

            {metars.isLoading && metarRows.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading nearest METARs...
              </div>
            ) : metars.error ? (
              <TileErrorState message={metars.error} />
            ) : metarRows.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-400">
                No nearby METAR stations found.
              </div>
            ) : (
              metarRows.map(({ station, metar }) => {
                const translatedSummary = translateMetarToPlainEnglish(metar)
                const rawMetar =
                  metar && typeof metar.rawOb === "string" && metar.rawOb.trim()
                    ? metar.rawOb
                    : "No recent METAR in the last 2 hours."
                const hasRecentMetar = rawMetar !== "No recent METAR in the last 2 hours."
                const translateKey = `${station.id}:${rawMetar}`
                const isTranslated = Boolean(translatedMetars[translateKey])

                return (
                  <div
                    key={station.id}
                    className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{station.id}</p>
                        <p className="break-words text-xs text-slate-400">
                          {station.name ?? "Unknown station"}
                          {typeof station.distanceMiles === "number"
                            ? ` | ${station.distanceMiles.toFixed(1)} mi`
                            : ""}
                        </p>
                      </div>
                      {hasRecentMetar ? (
                        <button
                          type="button"
                          onClick={() =>
                            setTranslatedMetars((current) => ({
                              ...current,
                              [translateKey]: !current[translateKey],
                            }))
                          }
                          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200 transition hover:border-emerald-300/70 hover:bg-emerald-400/15 hover:text-white"
                          aria-pressed={isTranslated}
                          aria-label={`${isTranslated ? "Hide" : "Translate"} METAR for ${station.id}`}
                        >
                          <Languages className="h-3 w-3" />
                          {isTranslated ? "Hide" : "Translate"}
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 font-mono text-[11px] leading-relaxed text-slate-200">
                      {rawMetar}
                    </p>
                    {isTranslated ? (
                      <div className="mt-2 rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-2 text-xs leading-relaxed text-emerald-100 break-words">
                        {translatedSummary ?? "Plain-English translation is not available for this METAR yet."}
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
            {metars.data?.message ? <p className="text-xs text-slate-400">{metars.data.message}</p> : null}
          </div>
        </AviationTile>

        <AviationTile
          label="Temporary Flight Restrictions"
          title="TFRs near you"
          rightHeaderSlot={
            <TileRefreshButton
              onClick={tfrs.refresh}
              loading={tfrs.isLoading || tfrs.isRefreshing}
              ariaLabel="Refresh TFRs"
            />
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Within {radiusMiles} mi</p>

            {tfrs.isLoading && !tfrs.data ? (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading nearby TFRs...
              </div>
            ) : tfrs.error ? (
              <TileErrorState message={tfrs.error} />
            ) : (tfrs.data?.items.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-400">
                No TFRs found in the selected radius.
              </div>
            ) : (
              (tfrs.data?.items ?? []).map((item) => (
                <div
                  key={item.notamId}
                  className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{item.notamId}</p>
                      <p className="break-words text-xs text-slate-400">
                        {[item.type, item.facility, item.state].filter(Boolean).join(" | ") || "TFR"}
                      </p>
                    </div>
                    {item.hasGeometry && item.bbox ? (
                      <button
                        type="button"
                        onClick={() => onMapTfr?.(item)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-200 transition hover:border-emerald-200 hover:text-white"
                      >
                        <MapIcon className="h-3 w-3" />
                        Map
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-slate-300">
                    {formatTimeWindow(item.startsAt, item.endsAt)}
                  </p>
                  {item.description ? (
                    <p className="mt-2 break-words text-xs leading-relaxed text-slate-200">
                      {item.description}
                    </p>
                  ) : null}
                </div>
              ))
            )}
            {isDev && tfrs.data?.message ? (
              <p className="break-words text-[11px] leading-relaxed text-slate-500">
                Debug: {tfrs.data.message}
              </p>
            ) : null}
          </div>
        </AviationTile>

        <AviationTile
          label="Notice to Air Missions"
          title="NOTAMs near you"
          rightHeaderSlot={
            <TileRefreshButton
              onClick={notams.refresh}
              loading={notams.isLoading || notams.isRefreshing}
              ariaLabel="Refresh NOTAMs"
            />
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Within {radiusMiles} mi</p>

            {notams.error ? (
              <TileErrorState message={notams.error} />
            ) : notams.isLoading && !notams.notConfigured && !notams.data ? (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading nearby NOTAMs...
              </div>
            ) : notamItems.length > 0 ? (
              <div className="space-y-3">
                {notamItems.map((item, index) => {
                  const notamId = resolveNotamId(item, index)
                  const type = resolveNotamType(item)
                  const location = resolveNotamLocation(item)
                  const description = resolveNotamDescription(item)
                  const startsAt = resolveNotamStartsAt(item)
                  const endsAt = resolveNotamEndsAt(item)
                  const hasTimeWindow = Boolean(startsAt || endsAt)
                  const structureType = asNonEmptyString(item.structureType)
                  const lightingLabel = resolveLightingLabel(item)
                  const structureHeight = formatFeetLabel(item.structureHeightFt)
                  const ownerName = asNonEmptyString(item.ownerName)
                  const structureAsr = asNonEmptyString(item.structureAsr)
                  const canMap = isNotamMappable(item)
                  const detailBadges = [
                    structureType ? `Structure: ${structureType}` : null,
                    lightingLabel ? `Lighting: ${lightingLabel}` : null,
                    structureHeight ? `Height: ${structureHeight}` : null,
                    ownerName ? `Owner: ${ownerName}` : null,
                    structureAsr ? `ASR ${structureAsr}` : null,
                  ].filter((value): value is string => Boolean(value))

                  return (
                    <div
                      key={`${notamId}-${index}`}
                      className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white">{notamId}</p>
                          <p className="break-words text-xs text-slate-400">
                            {[type, location].filter(Boolean).join(" | ") || "NOTAM"}
                          </p>
                        </div>
                        {canMap ? (
                          <button
                            type="button"
                            onClick={() => onMapNotam?.(item)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100 transition hover:border-cyan-200 hover:text-white"
                          >
                            <MapIcon className="h-3 w-3" />
                            Map
                          </button>
                        ) : null}
                      </div>
                      {hasTimeWindow ? (
                        <p className="mt-2 text-xs text-slate-300">
                          {formatTimeWindow(startsAt, endsAt)}
                        </p>
                      ) : null}
                      {description ? (
                        <p className="mt-2 break-words text-xs leading-relaxed text-slate-200">
                          {description}
                        </p>
                      ) : null}
                      {detailBadges.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {detailBadges.map((detail) => (
                            <span
                              key={detail}
                              className="rounded-full border border-slate-700/80 bg-slate-900/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-300"
                            >
                              {detail}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {notams.data?.message ? <p className="text-xs text-slate-400">{notams.data.message}</p> : null}
              </div>
            ) : !notams.notConfigured ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-400">
                <p>No NOTAMs found in the selected radius.</p>
                {notams.data?.message ? (
                  <p className="mt-2 text-xs text-slate-500">{notams.data.message}</p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <p className="text-sm font-semibold text-white">NOTAM feed not configured yet</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  Nearby NOTAM data is not enabled in this environment yet.
                </p>
                {notamProviderError ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Feed response: {notamProviderError}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-slate-500">
                  Connect a SWIFT / SCDS NOTAM ingest pipeline to enable nearby NOTAM results in this panel.
                </p>
                {isDev && notams.notConfigured && notams.nextSteps.length > 0 ? (
                  <details className="mt-3 rounded-lg border border-slate-800/70 bg-slate-950/40 p-3">
                    <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      SWIFT setup notes
                    </summary>
                    <ul className="mt-2 space-y-1 text-xs text-slate-300">
                      {notams.nextSteps.map((step) => (
                        <li key={step}>- {step}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            )}
          </div>
        </AviationTile>

        <AviationTile
          label="FAA Digital Obstacle File"
          title="Obstructions near you"
          rightHeaderSlot={
            <TileRefreshButton
              onClick={obstructionsResult.refresh}
              loading={obstructionsResult.isLoading || obstructionsResult.isRefreshing}
              ariaLabel="Refresh obstructions"
            />
          }
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-slate-400">Within {radiusMiles} mi</p>
              <select
                value={obstructionSortBy}
                onChange={(e) => setObstructionSortBy(e.target.value as ObstructionSortBy)}
                className="ml-auto rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300 outline-none transition hover:border-slate-500"
              >
                {OBSTRUCTION_SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    Sort: {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {obstructionsResult.isLoading && !obstructionsResult.data ? (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading nearby obstructions...
              </div>
            ) : obstructionsResult.error ? (
              <TileErrorState message={obstructionsResult.error} />
            ) : (obstructionsResult.data?.items.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-400">
                No obstructions found in the selected radius.
              </div>
            ) : (
              (obstructionsResult.data?.items ?? []).map((item) => {
                const locationParts = [item.city, item.state].filter(Boolean).join(", ")
                const detailBadges = [
                  item.obstacleType ? `Type: ${item.obstacleType}` : null,
                  item.aglHeightFt != null ? `AGL: ${Math.round(item.aglHeightFt)} ft` : null,
                  formatLightingCode(item.lightingCode) ? `Lighting: ${formatLightingCode(item.lightingCode)}` : null,
                  formatMarkIndicator(item.markIndicator) ? `Marking: ${formatMarkIndicator(item.markIndicator)}` : null,
                  item.asrn ? `ASR ${item.asrn}` : null,
                ].filter((v): v is string => Boolean(v))

                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{item.oasNumber}</p>
                        <p className="break-words text-xs text-slate-400">
                          {locationParts || "Unknown location"}
                          {" | "}
                          {item.distanceMiles.toFixed(1)} mi
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onMapObstruction?.(item)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-purple-400/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-purple-200 transition hover:border-purple-300 hover:text-white"
                      >
                        <MapIcon className="h-3 w-3" />
                        Map
                      </button>
                    </div>
                    {detailBadges.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {detailBadges.map((detail) => (
                          <span
                            key={detail}
                            className="rounded-full border border-slate-700/80 bg-slate-900/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-300"
                          >
                            {detail}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
            {obstructionsResult.data?.message ? (
              <p className="text-xs text-slate-400">{obstructionsResult.data.message}</p>
            ) : null}
          </div>
        </AviationTile>
      </div>
    </section>
  )
}
