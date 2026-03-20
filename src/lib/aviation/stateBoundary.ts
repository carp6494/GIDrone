// ---------------------------------------------------------------------------
// State boundary fetcher + point-in-polygon test
// Used to clip heatmap grid cells to the selected state's actual shape.
// ---------------------------------------------------------------------------

type BoundaryFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>

// Census TIGERweb: States layer (id 80) — public, no auth, returns GeoJSON
const TIGER_STATES_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/80/query"

// Simplified geometry (~100-300 pts per state) is plenty for clipping
const MAX_OFFSET = "0.01"

const cache = new Map<string, BoundaryFeature>()

/**
 * Fetch a simplified state boundary polygon from the US Census TIGERweb API.
 * Results are cached in-memory so repeated calls for the same state are instant.
 */
export async function fetchStateBoundary(
  stateCode: string,
): Promise<BoundaryFeature | null> {
  const code = stateCode.toUpperCase()
  const cached = cache.get(code)
  if (cached) return cached

  try {
    const params = new URLSearchParams({
      where: `STUSAB = '${code}'`,
      outFields: "STUSAB",
      f: "geojson",
      outSR: "4326",
      maxAllowableOffset: MAX_OFFSET,
    })
    const res = await fetch(`${TIGER_STATES_URL}?${params}`)
    if (!res.ok) return null

    const json = await res.json()
    const feature = json.features?.[0] as BoundaryFeature | undefined
    if (!feature?.geometry) return null

    cache.set(code, feature)
    return feature
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Ray-casting point-in-polygon
// ---------------------------------------------------------------------------

function isPointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside
    }
  }
  return inside
}

function isInsidePolygon(
  lon: number,
  lat: number,
  rings: number[][][],
): boolean {
  // Must be inside outer ring
  if (!isPointInRing(lon, lat, rings[0])) return false
  // Must NOT be inside any hole
  for (let i = 1; i < rings.length; i++) {
    if (isPointInRing(lon, lat, rings[i])) return false
  }
  return true
}

/** Test whether a lat/lon point falls inside the state boundary polygon. */
export function isPointInBoundary(
  lat: number,
  lon: number,
  boundary: BoundaryFeature,
): boolean {
  const geom = boundary.geometry
  if (geom.type === "Polygon") {
    return isInsidePolygon(lon, lat, geom.coordinates)
  }
  if (geom.type === "MultiPolygon") {
    return geom.coordinates.some((poly) => isInsidePolygon(lon, lat, poly))
  }
  return false
}
