import { supabase } from "../lib/supabase"

const NOAA_KP_INDEX_URL =
  "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"

const extractUvAndPop = (payload) => {
  if (!payload || typeof payload !== "object") {
    return { uvi: null, pop: null }
  }
  const current = payload.current ?? payload
  const uvi =
    typeof current?.uvi === "number"
      ? current.uvi
      : typeof current?.uv_index === "number"
        ? current.uv_index
        : null

  let pop = null
  if (Array.isArray(payload.hourly) && payload.hourly.length > 0) {
    pop = payload.hourly[0]?.pop
  } else if (Array.isArray(payload.daily) && payload.daily.length > 0) {
    pop = payload.daily[0]?.pop
  } else if (Array.isArray(payload.list) && payload.list.length > 0) {
    pop = payload.list[0]?.pop
  } else if (typeof payload.pop === "number") {
    pop = payload.pop
  }
  if (typeof pop !== "number" || Number.isNaN(pop)) {
    pop = null
  }
  return { uvi, pop }
}

const extractPrecipitation = (payload) => {
  if (!payload || typeof payload !== "object") {
    return { precipitation: null, precipitationType: null }
  }

  const toRate = (value, hours = 1) => {
    if (typeof value !== "number" || Number.isNaN(value)) return null
    return hours > 1 ? value / hours : value
  }

  let total = 0
  let hasValue = false
  const types = []

  const rain1h = toRate(payload?.rain?.["1h"], 1)
  const rain3h = toRate(payload?.rain?.["3h"], 3)
  const snow1h = toRate(payload?.snow?.["1h"], 1)
  const snow3h = toRate(payload?.snow?.["3h"], 3)

  const addValue = (value, typeLabel) => {
    if (typeof value !== "number" || Number.isNaN(value)) return
    total += value
    hasValue = true
    if (!types.includes(typeLabel)) types.push(typeLabel)
  }

  addValue(rain1h ?? rain3h, "Rain")
  addValue(snow1h ?? snow3h, "Snow")

  if (!hasValue) {
    return { precipitation: null, precipitationType: null }
  }

  const precipitationType =
    types.length === 1 ? types[0] : types.length > 1 ? "Mixed" : null

  return { precipitation: total, precipitationType }
}

const buildWeatherDescription = ({ weather, clouds, wind, visibility, units }) => {
  const description = weather?.description ?? weather?.main ?? "Clear conditions"
  const cloudCover =
    typeof clouds?.all === "number" ? `${Math.round(clouds.all)}% cloud cover` : null
  const windSpeed =
    typeof wind?.speed === "number"
      ? `${Math.round(wind.speed)} ${
          units === "metric" || units === "standard" ? "m/s" : "mph"
        } winds`
      : null

  const visibilityLabel = (() => {
    if (typeof visibility !== "number") return null
    const visibilityMiles = visibility * 0.000621371
    const visibilityKm = visibility / 1000
    return units === "imperial"
      ? `${visibilityMiles.toFixed(1)} mi visibility`
      : `${visibilityKm.toFixed(1)} km visibility`
  })()

  const details = [cloudCover, visibilityLabel, windSpeed].filter(Boolean)
  if (details.length === 0) return description
  return `${description}; ${details.join(", ")}.`
}

const invokeAviationProxy = async (body) => {
  const { data, error } = await supabase.functions.invoke("aviation-proxy", { body })
  if (error) {
    throw new Error(error.message || "Edge function call failed.")
  }
  return data
}

export const fetchCurrentWeather = async ({
  lat,
  lon,
  units = "imperial",
} = {}) => {
  if (lat === undefined || lon === undefined) {
    throw new Error("Latitude and longitude are required.")
  }

  // Current conditions
  const weatherData = await invokeAviationProxy({
    provider: "openweather",
    mode: "current",
    lat,
    lon,
    units,
  })

  // One Call 2.5 (8-day forecast + hourly + uvi)
  const oneCallData = await invokeAviationProxy({
    provider: "openweather",
    mode: "onecall",
    lat,
    lon,
    units,
  })

  const { uvi, pop } = extractUvAndPop(oneCallData ?? weatherData)

  const precipitationPrimary = extractPrecipitation(oneCallData?.current ?? oneCallData)
  const precipitationFallback = extractPrecipitation(weatherData)
  const precipitation =
    precipitationPrimary.precipitation ?? precipitationFallback.precipitation
  const precipitationType =
    precipitationPrimary.precipitationType ?? precipitationFallback.precipitationType

  const detailedDescription = buildWeatherDescription({
    weather: weatherData?.weather?.[0],
    clouds: weatherData?.clouds,
    wind: weatherData?.wind,
    visibility: weatherData?.visibility,
    units,
  })

  const forecast = Array.isArray(oneCallData?.daily) ? oneCallData.daily : []

  return {
    ...weatherData,
    uvi,
    pop,
    precipitation,
    precipitationType,
    weatherDescription: detailedDescription,
    hourly: oneCallData?.hourly ?? null,
    forecast,
  }
}

export const geocodeLocation = async ({
  query,
  limit = 1,
  country = "US",
} = {}) => {
  if (!query) {
    throw new Error("Location query is required.")
  }

  const data = await invokeAviationProxy({
    provider: "geocode",
    query,
    limit,
    country,
  })

  if (!Array.isArray(data) || data.length === 0) {
    return null
  }

  const match = data[0]
  const nameParts = [match.name, match.state, match.country].filter(Boolean)

  return {
    name: nameParts.join(", "),
    lat: match.lat,
    lon: match.lon,
  }
}

export const fetchLocationByQuery = async (options = {}) => geocodeLocation(options)

export const getKPIndex = async () => {
  const response = await fetch(NOAA_KP_INDEX_URL)
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || "Unable to fetch KP index data.")
  }

  const payload = await response.json()
  if (!Array.isArray(payload) || payload.length < 2) {
    throw new Error("Unexpected KP index response format.")
  }

  for (let index = payload.length - 1; index > 0; index -= 1) {
    const row = payload[index]
    const kpValue = Number(row?.[1])
    if (Number.isFinite(kpValue)) {
      return kpValue
    }
  }

  throw new Error("Unable to parse KP index data.")
}
