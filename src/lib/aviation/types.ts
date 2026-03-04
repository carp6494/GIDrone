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
  facilityCode?: string | null
  state?: string | null
  location?: string | null
  startsAt?: string | null
  endsAt?: string | null
  issuedAt?: string | null
  effectiveStart?: string | null
  effectiveEnd?: string | null
  rawText?: string | null
  geomType?: "point" | "circle" | string | null
  centerLat?: number | null
  centerLon?: number | null
  radiusNm?: number | null
  featureLat?: number | null
  featureLon?: number | null
  mapLat?: number | null
  mapLon?: number | null
  geojson?: GeoJSON.Geometry | null
  accountId?: string | null
  affectedFir?: string | null
  selectionCode?: string | null
  traffic?: string | null
  purpose?: string | null
  scope?: string | null
  minimumFl?: string | null
  maximumFl?: string | null
  structureType?: string | null
  structureDesignator?: string | null
  structureAsr?: string | null
  structureHeightFt?: number | null
  structureElevationFt?: number | null
  lightingPresent?: boolean | null
  lightingStatus?: string | null
  ownerName?: string | null
  ownerSource?: string | null
  ownerLastCheckedAt?: string | null
  [key: string]: unknown
}

export type NotamFeatureProperties = {
  id?: string
  notamId?: string
  type?: string | null
  category?: string | null
  subtype?: string | null
  description?: string | null
  facility?: string | null
  facilityCode?: string | null
  state?: string | null
  location?: string | null
  startsAt?: string | null
  endsAt?: string | null
  issuedAt?: string | null
  rawText?: string | null
  mapLat?: number | null
  mapLon?: number | null
  structureType?: string | null
  structureDesignator?: string | null
  structureAsr?: string | null
  structureHeightFt?: number | null
  structureElevationFt?: number | null
  lightingStatus?: string | null
  lightingPresent?: boolean | null
  ownerName?: string | null
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
