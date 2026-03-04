import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { Coordinates, GpsState, LocationSelection, LocationSource } from "../lib/location/types"
import { geocodeLocation, geocodeLocations } from "../services/weatherService"

type SearchStatus = "idle" | "loading" | "error"
type ResolvedSource = Exclude<LocationSource, "fallback">
type PermissionState = "granted" | "prompt" | "denied" | "unknown"

type UseGlobalLocationOptions = {
  useGps: boolean
  defaultCoords?: Coordinates
  onLocationResolved?: (result: { coords: Coordinates; source: ResolvedSource }) => void
}

export type UseGlobalLocationResult = {
  activeCoords: Coordinates
  activeLocationLabel: string | null
  activeGpsAccuracy: number | null
  activeSource: LocationSource
  searchQuery: string
  searchStatus: SearchStatus
  searchError: string | null
  searchPredictions: LocationSelection[]
  isPredictionLoading: boolean
  recentSearches: LocationSelection[]
  gpsState: GpsState
  gpsError: string | null
  setSearchQuery: (value: string) => void
  submitSearch: () => Promise<void>
  applyPrediction: (selection: LocationSelection) => void
  selectRecentSearch: (selection: LocationSelection) => void
  removeRecentSearch: (selection: LocationSelection) => void
  requestGpsLocation: () => Promise<void>
  clearGpsError: () => void
}

const DEFAULT_COORDS: Coordinates = { lat: 29.7604, lon: -95.3698 }
const RECENT_SEARCHES_KEY = "gi-drone.recent-searches"
const MAX_RECENT_SEARCHES = 6

const buildRecentSearchKey = (selection: LocationSelection) =>
  `${selection.lat.toFixed(3)}:${selection.lon.toFixed(3)}`

const dedupeRecentSearches = (entries: LocationSelection[]) => {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = buildRecentSearchKey(entry)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const asLocationSelection = (value: unknown): LocationSelection | null => {
  if (!value || typeof value !== "object") return null
  const candidate = value as Partial<LocationSelection>
  if (
    typeof candidate.name !== "string" ||
    typeof candidate.lat !== "number" ||
    typeof candidate.lon !== "number"
  ) {
    return null
  }
  const trimmedName = candidate.name.trim()
  if (!trimmedName) return null
  return {
    name: trimmedName,
    lat: candidate.lat,
    lon: candidate.lon,
  }
}

const isLocationSelection = (
  value: LocationSelection | null
): value is LocationSelection => value !== null

const detectBrowserFamily = () => {
  if (typeof navigator === "undefined") return "unknown"
  const ua = navigator.userAgent
  if (ua.includes("Edg/")) return "edge"
  if (ua.includes("Firefox/")) return "firefox"
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "safari"
  if (ua.includes("Chrome/")) return "chrome"
  return "unknown"
}

const buildBlockedPermissionMessage = () => {
  switch (detectBrowserFamily()) {
    case "chrome":
    case "edge":
      return "Location cannot be acquired. Click the lock icon in the address bar, allow Location for this site, and retry. If it still fails, manually search."
    case "firefox":
      return "Location cannot be acquired. Open site permissions in Firefox, allow Location, and retry. If it still fails, manually search."
    case "safari":
      return "Location cannot be acquired. Open Safari website settings, allow Location for this site, and retry. If it still fails, manually search."
    default:
      return "Location cannot be acquired because browser location permission is blocked. Enable location for this site and retry, or manually search."
  }
}

const queryGeolocationPermission = async (): Promise<PermissionState> => {
  if (typeof navigator === "undefined" || !("permissions" in navigator)) {
    return "unknown"
  }

  try {
    const status = await navigator.permissions.query({ name: "geolocation" })
    return status.state
  } catch {
    return "unknown"
  }
}

const resolveGeolocationErrorMessage = async (error: unknown) => {
  if (error && typeof error === "object" && "code" in error) {
    const geolocationError = error as GeolocationPositionError
    if (geolocationError.code === geolocationError.PERMISSION_DENIED) {
      const permissionState = await queryGeolocationPermission()
      if (permissionState === "denied") {
        return buildBlockedPermissionMessage()
      }
      return "Location access was denied. Allow location access in your browser and retry, or manually search."
    }

    if (geolocationError.code === geolocationError.POSITION_UNAVAILABLE) {
      return "Location cannot be acquired right now because your position is unavailable. Retry, or manually search."
    }

    if (geolocationError.code === geolocationError.TIMEOUT) {
      return "Location request timed out. Retry, or manually search."
    }
  }

  return "Location cannot be acquired. Retry, or manually search."
}

const requestCurrentPosition = () =>
  new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation unsupported"))
      return
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    })
  })

export const useGlobalLocation = ({
  useGps,
  defaultCoords = DEFAULT_COORDS,
  onLocationResolved,
}: UseGlobalLocationOptions): UseGlobalLocationResult => {
  const [gpsCoords, setGpsCoords] = useState<Coordinates | null>(null)
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null)
  const [gpsState, setGpsState] = useState<GpsState>("idle")
  const [gpsError, setGpsError] = useState<string | null>(null)

  const [searchQuery, setSearchQueryState] = useState("")
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle")
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchPredictions, setSearchPredictions] = useState<LocationSelection[]>([])
  const [isPredictionLoading, setIsPredictionLoading] = useState(false)
  const [searchSelection, setSearchSelection] = useState<LocationSelection | null>(null)
  const [recentSearches, setRecentSearches] = useState<LocationSelection[]>([])
  const predictionRequestRef = useRef(0)
  const autoGpsRequestedRef = useRef(false)

  const activeSource: LocationSource = useMemo(() => {
    if (searchSelection) return "search"
    if (useGps && gpsCoords) return "gps"
    return "fallback"
  }, [gpsCoords, searchSelection, useGps])

  const activeCoords = useMemo<Coordinates>(() => {
    if (searchSelection) {
      return { lat: searchSelection.lat, lon: searchSelection.lon }
    }
    if (useGps && gpsCoords) return gpsCoords
    return defaultCoords
  }, [defaultCoords, gpsCoords, searchSelection, useGps])

  const activeGpsAccuracy = activeSource === "gps" ? gpsAccuracy : null
  const activeLocationLabel = searchSelection?.name ?? null

  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const stored = window.localStorage.getItem(RECENT_SEARCHES_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored)
      if (!Array.isArray(parsed)) return
      const sanitized = dedupeRecentSearches(
        parsed.map(asLocationSelection).filter(isLocationSelection)
      ).slice(0, MAX_RECENT_SEARCHES)
      setRecentSearches(sanitized)
      window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(sanitized))
    } catch {
      setRecentSearches([])
    }
  }, [])

  useEffect(() => {
    if (!searchSelection) return
    setRecentSearches((previous) => {
      const next = dedupeRecentSearches([searchSelection, ...previous]).slice(0, MAX_RECENT_SEARCHES)
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next))
      }
      return next
    })
  }, [searchSelection])

  const applySearchSelection = useCallback(
    (selection: LocationSelection) => {
      setSearchQueryState(selection.name)
      setSearchSelection(selection)
      setSearchStatus("idle")
      setSearchError(null)
      setGpsError(null)
      setSearchPredictions([])
      onLocationResolved?.({
        coords: { lat: selection.lat, lon: selection.lon },
        source: "search",
      })
    },
    [onLocationResolved]
  )

  useEffect(() => {
    const trimmedQuery = searchQuery.trim()

    if (!trimmedQuery || trimmedQuery.length < 2) {
      setSearchPredictions([])
      setIsPredictionLoading(false)
      return
    }

    if (searchSelection && trimmedQuery === searchSelection.name.trim()) {
      setSearchPredictions([])
      setIsPredictionLoading(false)
      return
    }

    const requestId = predictionRequestRef.current + 1
    predictionRequestRef.current = requestId

    const timeoutId = window.setTimeout(async () => {
      try {
        setIsPredictionLoading(true)
        const matches = await geocodeLocations({
          query: trimmedQuery,
          limit: 5,
        })

        if (predictionRequestRef.current !== requestId) return

        const selections = dedupeRecentSearches(matches).slice(0, 5)
        setSearchPredictions(selections)
      } catch {
        if (predictionRequestRef.current !== requestId) return
        setSearchPredictions([])
      } finally {
        if (predictionRequestRef.current === requestId) {
          setIsPredictionLoading(false)
        }
      }
    }, 220)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [searchQuery, searchSelection])

  const submitSearch = useCallback(async () => {
    const trimmedQuery = searchQuery.trim()
    if (!trimmedQuery) {
      setSearchSelection(null)
      setSearchStatus("idle")
      setSearchError(null)
      setSearchPredictions([])
      return
    }

    const exactPrediction = searchPredictions.find(
      (prediction) => prediction.name.toLowerCase() === trimmedQuery.toLowerCase()
    )
    if (exactPrediction) {
      applySearchSelection(exactPrediction)
      return
    }

    try {
      setSearchStatus("loading")
      setSearchError(null)
      const result = await geocodeLocation({
        query: trimmedQuery,
      })

      if (!result) {
        throw new Error("City or ZIP not found. Check spelling and try again.")
      }

      applySearchSelection(result)
    } catch (error) {
      setSearchStatus("error")
      setSearchError(error instanceof Error ? error.message : "Unable to resolve location.")
    }
  }, [applySearchSelection, searchPredictions, searchQuery])

  const requestGpsLocation = useCallback(async () => {
    setGpsState("loading")
    setGpsError(null)
    setSearchSelection(null)
    setSearchStatus("idle")
    setSearchError(null)
    setSearchPredictions([])

    try {
      const position = await requestCurrentPosition()
      const nextCoords: Coordinates = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      }

      setSearchQueryState("")
      setGpsCoords(nextCoords)
      setGpsAccuracy(position.coords.accuracy ?? null)
      setGpsState("ready")
      onLocationResolved?.({ coords: nextCoords, source: "gps" })
    } catch (error) {
      setGpsState("error")
      setGpsError(await resolveGeolocationErrorMessage(error))
    }
  }, [onLocationResolved])

  useEffect(() => {
    if (!useGps || autoGpsRequestedRef.current) return
    autoGpsRequestedRef.current = true
    void requestGpsLocation()
  }, [requestGpsLocation, useGps])

  const setSearchQuery = useCallback((value: string) => {
    setSearchQueryState(value)
    setSearchSelection(null)
    setSearchError(null)
  }, [])

  const selectRecentSearch = useCallback(
    (selection: LocationSelection) => {
      applySearchSelection(selection)
    },
    [applySearchSelection]
  )

  const removeRecentSearch = useCallback((selection: LocationSelection) => {
    setRecentSearches((previous) => {
      const selectionKey = buildRecentSearchKey(selection)
      const next = previous.filter((item) => buildRecentSearchKey(item) !== selectionKey)
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next))
      }
      return next
    })
  }, [])

  const clearGpsError = useCallback(() => {
    setGpsError(null)
    if (gpsState === "error") {
      setGpsState("idle")
    }
  }, [gpsState])

  return {
    activeCoords,
    activeLocationLabel,
    activeGpsAccuracy,
    activeSource,
    searchQuery,
    searchStatus,
    searchError,
    searchPredictions,
    isPredictionLoading,
    recentSearches,
    gpsState,
    gpsError,
    setSearchQuery,
    submitSearch,
    applyPrediction: applySearchSelection,
    selectRecentSearch,
    removeRecentSearch,
    requestGpsLocation,
    clearGpsError,
  }
}
