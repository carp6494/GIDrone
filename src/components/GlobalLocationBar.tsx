import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { ChevronDown, Loader2, LocateFixed, Trash2 } from "lucide-react"

import type { UseGlobalLocationResult } from "../hooks/useGlobalLocation"

type GlobalLocationBarProps = {
  controller: UseGlobalLocationResult
}

export function GlobalLocationBar({ controller }: GlobalLocationBarProps) {
  const {
    activeSource,
    gpsError,
    gpsState,
    isPredictionLoading,
    recentSearches,
    searchError,
    searchPredictions,
    searchQuery,
    searchStatus,
    applyPrediction,
    clearGpsError,
    removeRecentSearch,
    requestGpsLocation,
    selectRecentSearch,
    setSearchQuery,
    submitSearch,
  } = controller

  const [isPredictionOpen, setIsPredictionOpen] = useState(false)
  const locationsMenuRef = useRef<HTMLDetailsElement | null>(null)
  const searchFieldRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      const clickedInsideSearchField = searchFieldRef.current?.contains(target) ?? false
      const clickedInsideLocationsMenu = locationsMenuRef.current?.contains(target) ?? false

      if (!clickedInsideSearchField) {
        setIsPredictionOpen(false)
      }

      if (!clickedInsideLocationsMenu) {
        locationsMenuRef.current?.removeAttribute("open")
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [])

  useEffect(() => {
    if (searchPredictions.length > 0 && searchQuery.trim().length >= 2) {
      setIsPredictionOpen(true)
      return
    }
    setIsPredictionOpen(false)
  }, [searchPredictions, searchQuery])

  const predictionDropdownWidth = useMemo(() => {
    const longestLabelLength = searchPredictions.reduce(
      (max, prediction) => Math.max(max, prediction.name.length),
      0
    )
    return Math.max(220, Math.min(520, longestLabelLength * 8 + 96))
  }, [searchPredictions])

  const gpsButtonClassName = (() => {
    if (gpsState === "error") {
      return "border-rose-500/50 bg-rose-500/10 text-rose-200 hover:border-rose-400"
    }
    if (gpsState === "loading") {
      return "border-amber-400/50 bg-amber-400/10 text-amber-200 hover:border-amber-300"
    }
    if (gpsState === "ready" && activeSource === "gps") {
      return "border-emerald-400/60 bg-emerald-400/15 text-emerald-100 hover:border-emerald-300"
    }
    return "border-slate-800 bg-slate-950/70 text-slate-300 hover:text-white"
  })()

  const isSearching = searchStatus === "loading" || gpsState === "loading"
  const gpsIconTitle =
    gpsState === "ready" && activeSource === "gps"
      ? "GPS active"
      : gpsState === "error"
        ? "GPS unavailable"
        : "Use GPS location"

  return (
    <div className="mt-2 w-full space-y-2">
      <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        void submitSearch()
      }} className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="global-location-search">
          Search city or ZIP code
        </label>

        <div ref={searchFieldRef} className="relative w-full flex-1">
          <input
            id="global-location-search"
            type="search"
            autoComplete="off"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value)
            }}
            onFocus={() => {
              if (searchPredictions.length > 0) {
                setIsPredictionOpen(true)
              }
            }}
            placeholder="Search city or ZIP"
            aria-busy={isSearching}
            className="h-11 w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 pr-10 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
          />
          {(searchStatus === "loading" || isPredictionLoading) && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-emerald-200" />
          )}
          {isPredictionOpen && (
            <div
              className="absolute left-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/95 shadow-xl"
              style={{ width: `${predictionDropdownWidth}px`, maxWidth: "100%" }}
            >
              {searchPredictions.map((prediction) => (
                <button
                  key={`${prediction.name}-${prediction.lat}-${prediction.lon}`}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    applyPrediction(prediction)
                  }}
                  className="flex w-full items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3 text-left text-sm text-slate-200 transition last:border-b-0 hover:bg-slate-900/80 hover:text-white"
                >
                  <span className="truncate">{prediction.name}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Select
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={() => {
              void requestGpsLocation()
            }}
            aria-label="Use GPS location"
            title={gpsIconTitle}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition ${gpsButtonClassName}`}
          >
            {gpsState === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LocateFixed className="h-4 w-4" />
            )}
          </button>

          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-4 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100 transition hover:border-emerald-400 hover:text-white"
          >
            {searchStatus === "loading" ? "Locating..." : "Search"}
          </button>

          <details ref={locationsMenuRef} className="relative">
            <summary className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-300 transition hover:text-white list-none [&::-webkit-details-marker]:hidden">
              My Locations
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-slate-800 bg-slate-950/95 p-2 shadow-xl">
              {recentSearches.length === 0 && (
                <div className="px-3 py-2 text-sm text-slate-500">No recent locations.</div>
              )}
              {recentSearches.map((location) => (
                <div
                  key={`${location.name}-${location.lat}-${location.lon}`}
                  className="flex items-center gap-2 rounded-xl transition hover:bg-slate-900/80"
                >
                  <button
                    type="button"
                    onClick={() => {
                      selectRecentSearch(location)
                      locationsMenuRef.current?.removeAttribute("open")
                    }}
                    className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left text-sm text-slate-200"
                  >
                    <span className="block truncate">{location.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRecentSearch(location)}
                    className="mr-2 inline-flex h-6 w-6 shrink-0 items-center justify-center text-rose-400 transition hover:text-rose-200"
                    aria-label={`Remove ${location.name} from saved locations`}
                    title="Remove location"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </details>
        </div>
      </form>

      {searchStatus === "error" && searchError && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100">
          {searchError}
        </div>
      )}

      {gpsError && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100">
          <span>{gpsError}</span>
          <button
            type="button"
            onClick={clearGpsError}
            className="shrink-0 rounded-full border border-rose-400/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-100 transition hover:border-rose-300 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
