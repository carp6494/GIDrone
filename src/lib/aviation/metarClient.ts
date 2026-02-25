import { getFunctionJson } from "./functionClient"
import type { MetarResponse } from "./types"

type MetarByCoordsParams = {
  lat: number
  lon: number
  radiusMiles?: number
  limit?: number
}

export const fetchMetarsByCoords = async ({
  lat,
  lon,
  radiusMiles = 60,
  limit = 5,
}: MetarByCoordsParams): Promise<MetarResponse> =>
  getFunctionJson<MetarResponse>("metar", {
    lat,
    lon,
    radiusMiles,
    limit,
  })

export const fetchMetarsByIds = async (ids: string[]): Promise<MetarResponse> =>
  getFunctionJson<MetarResponse>("metar", {
    ids: ids.join(","),
  })
