import { getFunctionJson } from "./functionClient"
import type { TfrResponse } from "./types"

type TfrParams = {
  lat: number
  lon: number
  radiusMiles?: number
}

export const fetchTfrs = async ({
  lat,
  lon,
  radiusMiles = 100,
}: TfrParams): Promise<TfrResponse> =>
  getFunctionJson<TfrResponse>("tfr", {
    lat,
    lon,
    radiusMiles,
  })
