import { getFunctionJson } from "./functionClient"
import type { HeatmapWeatherResponse } from "./types"

type HeatmapParams = {
  stateCode: string
}

export const fetchHeatmapWeather = async ({
  stateCode,
}: HeatmapParams): Promise<HeatmapWeatherResponse> =>
  getFunctionJson<HeatmapWeatherResponse>("heatmap-weather", { stateCode })
