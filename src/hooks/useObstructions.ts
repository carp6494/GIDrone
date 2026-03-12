import { useEffect, useState } from "react"

import { fetchObstructions } from "../lib/aviation/obstructionClient"
import { toAviationLoadErrorMessage } from "../lib/aviation/functionClient"
import type { ObstructionResponse } from "../lib/aviation/types"

type UseObstructionsOptions = {
  lat: number
  lon: number
  radiusMiles?: number
  sortBy?: string
  minHeight?: number
  types?: string[]
  enabled?: boolean
}

type UseObstructionsResult = {
  data: ObstructionResponse | null
  error: string | null
  isLoading: boolean
  isRefreshing: boolean
  refresh: () => void
}

export function useObstructions({
  lat,
  lon,
  radiusMiles = 25,
  sortBy = "distance",
  minHeight,
  types,
  enabled = true,
}: UseObstructionsOptions): UseObstructionsResult {
  const [data, setData] = useState<ObstructionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [revision, setRevision] = useState(0)

  // Stable serialization for types array dependency
  const typesKey = types?.length ? types.slice().sort().join(",") : ""

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async () => {
      const hasData = data !== null
      if (hasData) setIsRefreshing(true)
      else setIsLoading(true)
      setError(null)

      try {
        const response = await fetchObstructions({ lat, lon, radiusMiles, sortBy, minHeight, types })
        if (!cancelled) setData(response)
      } catch (fetchError) {
        if (!cancelled) {
          setError(toAviationLoadErrorMessage(fetchError, "Unable to load nearby obstructions."))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [enabled, lat, lon, radiusMiles, sortBy, minHeight, typesKey, revision])

  return {
    data,
    error,
    isLoading,
    isRefreshing,
    refresh: () => setRevision((value) => value + 1),
  }
}
