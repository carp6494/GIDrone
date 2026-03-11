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

export type TfrWebTextResponse = {
  notamId: string
  html: string
}

export const fetchTfrWebText = async (notamId: string): Promise<TfrWebTextResponse> => {
  const res = await getFunctionJson<TfrWebTextResponse>("tfr", {
    action: "webtext",
    notamId,
  })
  console.debug("[tfrClient] webtext response", {
    notamId,
    htmlLength: res?.html?.length,
    preview: res?.html?.slice(0, 200),
  })
  return res
}
