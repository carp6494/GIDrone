export type Coordinates = {
  lat: number
  lon: number
}

export type LocationSelection = {
  name: string
  lat: number
  lon: number
}

export type LocationSource = "fallback" | "search" | "gps"

export type GpsState = "idle" | "loading" | "ready" | "error"
