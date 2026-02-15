export type WeatherServiceOptions = {
  lat: number
  lon: number
  units?: "standard" | "metric" | "imperial"
  apiKey?: string
}

export type LocationSearchResult = {
  name: string
  lat: number
  lon: number
}

export function fetchCurrentWeather(options: WeatherServiceOptions): Promise<any>
export function geocodeLocation(options: {
  query: string
  apiKey?: string
  limit?: number
  country?: string
}): Promise<LocationSearchResult | null>
export function fetchLocationByQuery(options: {
  query: string
  apiKey?: string
  limit?: number
  country?: string
}): Promise<LocationSearchResult | null>
export function getKPIndex(): Promise<number>
export function runHealthCheck(): Promise<any>
export function getLastWeatherFetchTimestamp(): number | null
