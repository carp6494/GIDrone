import { useEffect, useState } from "react"

import { fetchMetarsByCoords } from "../lib/aviation/metarClient"
import { toAviationLoadErrorMessage } from "../lib/aviation/functionClient"
import type { MetarResponse } from "../lib/aviation/types"

type UseMetarsOptions = {
  lat: number
  lon: number
  radiusMiles?: number
  limit?: number
  enabled?: boolean
}

type UseMetarsResult = {
  data: MetarResponse | null
  error: string | null
  isLoading: boolean
  isRefreshing: boolean
  refresh: () => void
}

export function useMetars({
  lat,
  lon,
  radiusMiles = 60,
  limit = 5,
  enabled = true,
}: UseMetarsOptions): UseMetarsResult {
  const [data, setData] = useState<MetarResponse | null>(null)
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
        const response = await fetchMetarsByCoords({ lat, lon, radiusMiles, limit })
        if (!cancelled) setData(response)
      } catch (fetchError) {
        if (!cancelled) {
          setError(toAviationLoadErrorMessage(fetchError, "Unable to load METARs."))
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
  }, [enabled, lat, lon, radiusMiles, limit, revision])

  return {
    data,
    error,
    isLoading,
    isRefreshing,
    refresh: () => setRevision((value) => value + 1),
  }
}
