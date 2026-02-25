import { useEffect, useState } from "react"

import { fetchTfrs } from "../lib/aviation/tfrClient"
import { toAviationLoadErrorMessage } from "../lib/aviation/functionClient"
import type { TfrResponse } from "../lib/aviation/types"

type UseTfrsOptions = {
  lat: number
  lon: number
  radiusMiles?: number
  enabled?: boolean
}

type UseTfrsResult = {
  data: TfrResponse | null
  error: string | null
  isLoading: boolean
  isRefreshing: boolean
  refresh: () => void
}

export function useTfrs({
  lat,
  lon,
  radiusMiles = 100,
  enabled = true,
}: UseTfrsOptions): UseTfrsResult {
  const [data, setData] = useState<TfrResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async () => {
      const hasData = data !== null
      if (hasData) setIsRefreshing(true)
      else setIsLoading(true)
      setError(null)

      try {
        const response = await fetchTfrs({ lat, lon, radiusMiles })
        if (!cancelled) setData(response)
      } catch (fetchError) {
        if (!cancelled) {
          setError(toAviationLoadErrorMessage(fetchError, "Unable to load nearby TFRs."))
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
  }, [enabled, lat, lon, radiusMiles, revision])

  return {
    data,
    error,
    isLoading,
    isRefreshing,
    refresh: () => setRevision((value) => value + 1),
  }
}
