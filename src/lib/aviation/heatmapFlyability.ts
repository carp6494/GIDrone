import {
  calculateFlyability,
  type FlyabilityThresholds,
  type FlyabilityStatus,
  DEFAULT_FLYABILITY_THRESHOLDS,
} from "../../utils/FlyabilityEngine"
import type { HeatmapGridCell } from "./types"

export type HeatmapRenderMode = "fill" | "heatmap"

export type HeatmapFeatureProperties = {
  score: number
  status: FlyabilityStatus
  cautionReasons: string[]
  dangerReasons: string[]
  lat: number
  lon: number
  shortForecast: string | null
  windSpeedMph: number | null
  windGustMph: number | null
  temperatureF: number | null
  visibilityMiles: number | null
  precipitationProbability: number | null
  humidity: number | null
  cloudCover: number | null
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] }

export function computeHeatmapGeoJson(
  grid: HeatmapGridCell[],
  cellSizeDeg: number,
  thresholds?: FlyabilityThresholds,
): {
  fillCollection: GeoJSON.FeatureCollection
  pointCollection: GeoJSON.FeatureCollection
} {
  if (!grid.length) return { fillCollection: EMPTY_FC, pointCollection: EMPTY_FC }

  const resolved = thresholds ?? DEFAULT_FLYABILITY_THRESHOLDS
  const halfCell = cellSizeDeg / 2

  const fillFeatures: GeoJSON.Feature[] = []
  const pointFeatures: GeoJSON.Feature[] = []

  for (const cell of grid) {
    const hasPrecipitation =
      cell.shortForecast != null &&
      /rain|snow|storm|shower|drizzle|sleet|hail|thunderstorm/i.test(cell.shortForecast)

    const result = calculateFlyability(
      {
        windSpeedMph: cell.windSpeedMph ?? 0,
        visibilityMiles: cell.visibilityMiles ?? 10,
        hasPrecipitation,
        temperatureF: cell.temperatureF,
        humidity: cell.humidity,
        cloudCover: cell.cloudCover,
        precipitationProbability: cell.precipitationProbability,
        lat: cell.lat,
        lon: cell.lon,
      },
      resolved,
    )

    const properties: HeatmapFeatureProperties = {
      score: result.score,
      status: result.status,
      cautionReasons: result.cautionReasons,
      dangerReasons: result.dangerReasons,
      lat: cell.lat,
      lon: cell.lon,
      shortForecast: cell.shortForecast,
      windSpeedMph: cell.windSpeedMph,
      windGustMph: cell.windGustMph,
      temperatureF: cell.temperatureF,
      visibilityMiles: cell.visibilityMiles,
      precipitationProbability: cell.precipitationProbability,
      humidity: cell.humidity,
      cloudCover: cell.cloudCover,
    }

    // Square polygon for fill mode
    fillFeatures.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [cell.lon - halfCell, cell.lat - halfCell],
          [cell.lon + halfCell, cell.lat - halfCell],
          [cell.lon + halfCell, cell.lat + halfCell],
          [cell.lon - halfCell, cell.lat + halfCell],
          [cell.lon - halfCell, cell.lat - halfCell],
        ]],
      },
      properties,
    })

    // Point for heatmap mode — weight is inverted score (higher = worse conditions)
    pointFeatures.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [cell.lon, cell.lat],
      },
      properties: {
        ...properties,
        weight: (100 - result.score) / 100,
      },
    })
  }

  return {
    fillCollection: { type: "FeatureCollection", features: fillFeatures },
    pointCollection: { type: "FeatureCollection", features: pointFeatures },
  }
}
