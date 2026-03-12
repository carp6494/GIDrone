import { getFunctionJson } from "./functionClient"
import type { ObstructionResponse } from "./types"

type ObstructionParams = {
  lat: number
  lon: number
  radiusMiles?: number
  sortBy?: string
  minHeight?: number
  types?: string[]
}

export const fetchObstructions = async ({
  lat,
  lon,
  radiusMiles = 25,
  sortBy = "distance",
  minHeight,
  types,
}: ObstructionParams): Promise<ObstructionResponse> =>
  getFunctionJson<ObstructionResponse>("obstruction", {
    lat,
    lon,
    radiusMiles,
    sortBy,
    ...(minHeight != null && minHeight > 0 && { minHeight }),
    ...(types?.length && { types }),
  })
