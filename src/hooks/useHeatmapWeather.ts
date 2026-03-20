import { useEffect, useState } from "react"

import { fetchHeatmapWeather } from "../lib/aviation/heatmapClient"
import { toAviationLoadErrorMessage } from "../lib/aviation/functionClient"
import type { HeatmapWeatherResponse } from "../lib/aviation/types"

type UseHeatmapWeatherOptions = {
  stateCode: string | null
  enabled?: boolean
}

type UseHeatmapWeatherResult = {
  data: HeatmapWeatherResponse | null
  error: string | null
  isLoading: boolean
  isRefreshing: boolean
  refresh: () => void
}

export function useHeatmapWeather({
  stateCode,
  enabled = true,
}: UseHeatmapWeatherOptions): UseHeatmapWeatherResult {
  const [data, setData] = useState<HeatmapWeatherResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!enabled || !stateCode) return
    let cancelled = false

    const load = async () => {
      const hasData = data !== null
      if (hasData) setIsRefreshing(true)
      else setIsLoading(true)
      setError(null)

      try {
        const response = await fetchHeatmapWeather({ stateCode })
        if (!cancelled) setData(response)
      } catch (fetchError) {
        if (!cancelled) {
          setError(toAviationLoadErrorMessage(fetchError, "Unable to load flyability heatmap."))
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
  }, [enabled, stateCode, revision])

  return {
    data,
    error,
    isLoading,
    isRefreshing,
    refresh: () => setRevision((value) => value + 1),
  }
}
