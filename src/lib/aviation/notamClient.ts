import { getFunctionJson } from "./functionClient"
import type { NotamResponse } from "./types"

type NotamParams = {
  lat: number
  lon: number
  radiusMiles?: number
}

export const fetchNotams = async ({
  lat,
  lon,
  radiusMiles = 50,
}: NotamParams): Promise<NotamResponse> =>
  getFunctionJson<NotamResponse>("notam", {
    lat,
    lon,
    radiusMiles,
  })
