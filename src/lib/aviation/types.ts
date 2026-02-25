export type BoundsTuple = [number, number, number, number]

export type AviationStation = {
  id: string
  name: string | null
  lat: number
  lon: number
  country: string | null
  state: string | null
  distanceMiles?: number | null
}

export type AviationMetar = {
  icaoId?: string
  rawOb?: string
  reportTime?: string
  fltCat?: string
  wdir?: number
  wspd?: number
  wgst?: number
  visib?: string | number
  temp?: number
  dewp?: number
  [key: string]: unknown
}

export type MetarResponse = {
  stations: AviationStation[]
  metars: AviationMetar[]
  fetchedAt: string
  source: "aviationweather"
  message?: string
}

export type TfrSourceUrls = {
  detailPageUrl: string
  xmlUrl: string
  webTextUrl: string
}

export type TfrItem = {
  notamId: string
  type: string | null
  description: string | null
  startsAt: string | null
  endsAt: string | null
  facility: string | null
  state: string | null
  hasGeometry: boolean
  bbox: BoundsTuple | null
  featureCount: number
  sourceUrls: TfrSourceUrls
}

export type TfrFeatureProperties = {
  notamId: string
  type?: string | null
  description?: string | null
  startsAt?: string | null
  endsAt?: string | null
  facility?: string | null
  state?: string | null
  detailPageUrl?: string
  xmlUrl?: string
}

export type TfrResponse = {
  featureCollection: GeoJSON.FeatureCollection<GeoJSON.Geometry>
  items: TfrItem[]
  fetchedAt: string
  source: "faa-tfr"
  message?: string
}

export type NotamItem = {
  id?: string
  notamId?: string
  type?: string | null
  category?: string | null
  subtype?: string | null
  description?: string | null
  facility?: string | null
  state?: string | null
  location?: string | null
  startsAt?: string | null
  endsAt?: string | null
  effectiveStart?: string | null
  effectiveEnd?: string | null
  [key: string]: unknown
}

export type NotamResponse = {
  items?: NotamItem[]
  fetchedAt?: string
  source?: string
  message?: string
  error?: string
  nextSteps?: string[]
}

export type TfrMapFocus = {
  bounds: BoundsTuple
  notamId: string
}
