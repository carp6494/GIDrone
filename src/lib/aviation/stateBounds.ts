export type StateBoundingBox = {
  name: string
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

export const STATE_BOUNDS: Record<string, StateBoundingBox> = {
  AL: { name: "Alabama", minLat: 30.22, maxLat: 35.01, minLon: -88.47, maxLon: -84.89 },
  AK: { name: "Alaska", minLat: 51.21, maxLat: 71.39, minLon: -179.15, maxLon: -129.98 },
  AZ: { name: "Arizona", minLat: 31.33, maxLat: 37.00, minLon: -114.81, maxLon: -109.04 },
  AR: { name: "Arkansas", minLat: 33.00, maxLat: 36.50, minLon: -94.62, maxLon: -89.64 },
  CA: { name: "California", minLat: 32.53, maxLat: 42.01, minLon: -124.41, maxLon: -114.13 },
  CO: { name: "Colorado", minLat: 36.99, maxLat: 41.00, minLon: -109.06, maxLon: -102.04 },
  CT: { name: "Connecticut", minLat: 40.95, maxLat: 42.05, minLon: -73.73, maxLon: -71.79 },
  DE: { name: "Delaware", minLat: 38.45, maxLat: 39.84, minLon: -75.79, maxLon: -75.05 },
  FL: { name: "Florida", minLat: 24.40, maxLat: 31.00, minLon: -87.63, maxLon: -80.03 },
  GA: { name: "Georgia", minLat: 30.36, maxLat: 35.00, minLon: -85.61, maxLon: -80.84 },
  HI: { name: "Hawaii", minLat: 18.91, maxLat: 22.24, minLon: -160.24, maxLon: -154.81 },
  ID: { name: "Idaho", minLat: 41.99, maxLat: 49.00, minLon: -117.24, maxLon: -111.04 },
  IL: { name: "Illinois", minLat: 36.97, maxLat: 42.51, minLon: -91.51, maxLon: -87.02 },
  IN: { name: "Indiana", minLat: 37.77, maxLat: 41.76, minLon: -88.10, maxLon: -84.78 },
  IA: { name: "Iowa", minLat: 40.38, maxLat: 43.50, minLon: -96.64, maxLon: -90.14 },
  KS: { name: "Kansas", minLat: 36.99, maxLat: 40.00, minLon: -102.05, maxLon: -94.59 },
  KY: { name: "Kentucky", minLat: 36.50, maxLat: 39.15, minLon: -89.57, maxLon: -81.96 },
  LA: { name: "Louisiana", minLat: 28.93, maxLat: 33.02, minLon: -94.04, maxLon: -88.82 },
  ME: { name: "Maine", minLat: 43.06, maxLat: 47.46, minLon: -71.08, maxLon: -66.95 },
  MD: { name: "Maryland", minLat: 37.91, maxLat: 39.72, minLon: -79.49, maxLon: -75.05 },
  MA: { name: "Massachusetts", minLat: 41.24, maxLat: 42.89, minLon: -73.51, maxLon: -69.93 },
  MI: { name: "Michigan", minLat: 41.70, maxLat: 48.26, minLon: -90.42, maxLon: -82.12 },
  MN: { name: "Minnesota", minLat: 43.50, maxLat: 49.38, minLon: -97.24, maxLon: -89.49 },
  MS: { name: "Mississippi", minLat: 30.17, maxLat: 34.99, minLon: -91.66, maxLon: -88.10 },
  MO: { name: "Missouri", minLat: 35.99, maxLat: 40.61, minLon: -95.77, maxLon: -89.10 },
  MT: { name: "Montana", minLat: 44.36, maxLat: 49.00, minLon: -116.05, maxLon: -104.04 },
  NE: { name: "Nebraska", minLat: 39.99, maxLat: 43.00, minLon: -104.05, maxLon: -95.31 },
  NV: { name: "Nevada", minLat: 35.00, maxLat: 42.00, minLon: -120.01, maxLon: -114.04 },
  NH: { name: "New Hampshire", minLat: 42.70, maxLat: 45.31, minLon: -72.56, maxLon: -70.70 },
  NJ: { name: "New Jersey", minLat: 38.93, maxLat: 41.36, minLon: -75.56, maxLon: -73.89 },
  NM: { name: "New Mexico", minLat: 31.33, maxLat: 37.00, minLon: -109.05, maxLon: -103.00 },
  NY: { name: "New York", minLat: 40.50, maxLat: 45.01, minLon: -79.76, maxLon: -71.86 },
  NC: { name: "North Carolina", minLat: 33.84, maxLat: 36.59, minLon: -84.32, maxLon: -75.46 },
  ND: { name: "North Dakota", minLat: 45.94, maxLat: 49.00, minLon: -104.05, maxLon: -96.55 },
  OH: { name: "Ohio", minLat: 38.40, maxLat: 41.98, minLon: -84.82, maxLon: -80.52 },
  OK: { name: "Oklahoma", minLat: 33.62, maxLat: 37.00, minLon: -103.00, maxLon: -94.43 },
  OR: { name: "Oregon", minLat: 41.99, maxLat: 46.29, minLon: -124.57, maxLon: -116.46 },
  PA: { name: "Pennsylvania", minLat: 39.72, maxLat: 42.27, minLon: -80.52, maxLon: -74.69 },
  RI: { name: "Rhode Island", minLat: 41.15, maxLat: 42.02, minLon: -71.86, maxLon: -71.12 },
  SC: { name: "South Carolina", minLat: 32.05, maxLat: 35.21, minLon: -83.35, maxLon: -78.54 },
  SD: { name: "South Dakota", minLat: 42.48, maxLat: 45.95, minLon: -104.06, maxLon: -96.44 },
  TN: { name: "Tennessee", minLat: 34.98, maxLat: 36.68, minLon: -90.31, maxLon: -81.65 },
  TX: { name: "Texas", minLat: 25.84, maxLat: 36.50, minLon: -106.65, maxLon: -93.51 },
  UT: { name: "Utah", minLat: 36.99, maxLat: 42.00, minLon: -114.05, maxLon: -109.04 },
  VT: { name: "Vermont", minLat: 42.73, maxLat: 45.02, minLon: -73.44, maxLon: -71.46 },
  VA: { name: "Virginia", minLat: 36.54, maxLat: 39.47, minLon: -83.68, maxLon: -75.24 },
  WA: { name: "Washington", minLat: 45.54, maxLat: 49.00, minLon: -124.85, maxLon: -116.92 },
  WV: { name: "West Virginia", minLat: 37.20, maxLat: 40.64, minLon: -82.64, maxLon: -77.72 },
  WI: { name: "Wisconsin", minLat: 42.49, maxLat: 47.08, minLon: -92.89, maxLon: -86.25 },
  WY: { name: "Wyoming", minLat: 40.99, maxLat: 45.01, minLon: -111.06, maxLon: -104.05 },
  DC: { name: "District of Columbia", minLat: 38.79, maxLat: 38.99, minLon: -77.12, maxLon: -76.91 },
}

export const STATE_CODES_SORTED = Object.keys(STATE_BOUNDS).sort((a, b) =>
  STATE_BOUNDS[a].name.localeCompare(STATE_BOUNDS[b].name)
)
