import { useEffect, useState } from "react"

import { fetchNotams } from "../lib/aviation/notamClient"
import { AviationFunctionError, toAviationLoadErrorMessage } from "../lib/aviation/functionClient"
import type { NotamResponse } from "../lib/aviation/types"

type UseNotamsOptions = {
  lat: number
  lon: number
  radiusMiles?: number
  enabled?: boolean
}

type UseNotamsResult = {
  data: NotamResponse | null
  error: string | null
  isLoading: boolean
  isRefreshing: boolean
  notConfigured: boolean
  nextSteps: string[]
  refresh: () => void
}

export function useNotams({
  lat,
  lon,
  radiusMiles = 50,
  enabled = true,
}: UseNotamsOptions): UseNotamsResult {
  const [data, setData] = useState<NotamResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [notConfigured, setNotConfigured] = useState(false)
  const [nextSteps, setNextSteps] = useState<string[]>([])
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async () => {
      const hasData = data !== null || notConfigured
      if (hasData) setIsRefreshing(true)
      else setIsLoading(true)
      setError(null)

      try {
        const response = await fetchNotams({ lat, lon, radiusMiles })
        if (cancelled) return
        setData(response)
        setNotConfigured(false)
        setNextSteps(Array.isArray(response.nextSteps) ? response.nextSteps.map(String) : [])
      } catch (fetchError) {
        if (cancelled) return

        if (fetchError instanceof AviationFunctionError && fetchError.status === 501) {
          const payload = fetchError.payload
          const payloadError =
            payload && typeof payload === "object" && "error" in payload
              ? String((payload as { error: unknown }).error)
              : "SWIFT NOTAM ingest not configured"
          const payloadNextSteps =
            payload && typeof payload === "object" && "nextSteps" in payload
              ? (payload as { nextSteps?: unknown }).nextSteps
              : []

          setData(
            payload && typeof payload === "object"
              ? (payload as NotamResponse)
              : { error: payloadError }
          )
          setNotConfigured(true)
          setNextSteps(
            Array.isArray(payloadNextSteps) ? payloadNextSteps.map((value) => String(value)) : []
          )
          setError(null)
          return
        }

        setNotConfigured(false)
        setNextSteps([])
        setError(toAviationLoadErrorMessage(fetchError, "Unable to load NOTAMs."))
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
    notConfigured,
    nextSteps,
    refresh: () => setRevision((value) => value + 1),
  }
}
