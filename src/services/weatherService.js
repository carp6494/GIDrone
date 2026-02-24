import { supabase } from "../lib/supabase"

const NOAA_KP_INDEX_URL =
  "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "")
const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "")
const AVIATION_PROXY_URL = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/aviation-proxy`
  : ""

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

const readResponsePayload = async (response) => {
  try {
    return await response.clone().json()
  } catch (_error) {
    try {
      return await response.text()
    } catch (_error2) {
      return null
    }
  }
}

const invokeAviationProxyWithPublishableKey = async (body) => {
  if (!AVIATION_PROXY_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase function endpoint is not configured.")
  }

  const response = await fetch(AVIATION_PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  })

  const payload = await readResponsePayload(response)
  if (!response.ok) {
    const details =
      payload && typeof payload === "object" && "details" in payload ? payload.details : null
    const message =
      typeof payload === "object" && payload !== null && "message" in payload
        ? payload.message
        : typeof payload === "object" && payload !== null && "error" in payload
          ? payload.error
          : typeof details === "object" && details !== null && "message" in details
            ? details.message
            : `Edge function request failed (${response.status})`
    const error = new Error(String(message))
    error.status = response.status
    throw error
  }

  return payload
}

const invokeAviationProxy = async (body) => {
  const { data, error } = await supabase.functions.invoke("aviation-proxy", { body })
  if (error) {
    const context = error && typeof error === "object" && "context" in error ? error.context : null
    let parsedPayload = null
    let status = null

    if (context && typeof context === "object") {
      if ("status" in context && typeof context.status === "number") {
        status = context.status
      }
      if ("clone" in context && typeof context.clone === "function") {
        try {
          const cloned = context.clone()
          if ("json" in cloned && typeof cloned.json === "function") {
            parsedPayload = await cloned.json()
          }
        } catch (_error) {
          try {
            const cloned = context.clone()
            if ("text" in cloned && typeof cloned.text === "function") {
              parsedPayload = await cloned.text()
            }
          } catch (_error2) {
            parsedPayload = null
          }
        }
      }
    }

    const hint =
      parsedPayload && typeof parsedPayload === "object" ? parsedPayload.hint : null
    const details =
      parsedPayload && typeof parsedPayload === "object" ? parsedPayload.details : null
    const gatewayMessage =
      parsedPayload && typeof parsedPayload === "object" && "message" in parsedPayload
        ? parsedPayload.message
        : null
    const upstreamMessage =
      typeof details === "object" && details !== null && "message" in details
        ? details.message
        : typeof parsedPayload === "object" && parsedPayload !== null && "error" in parsedPayload
          ? parsedPayload.error
          : null

    if (
      status === 401 &&
      (gatewayMessage === "Invalid JWT" || gatewayMessage === "Missing authorization header")
    ) {
      return invokeAviationProxyWithPublishableKey(body)
    }

    if (
      body?.provider === "openweather" &&
      body?.mode === "onecall" &&
      (status === 401 || status === 403)
    ) {
      throw new Error(
        typeof hint === "string"
          ? hint
          : typeof upstreamMessage === "string"
            ? `One Call not available for this API key (${upstreamMessage})`
            : "One Call not available for this API key"
      )
    }

    throw new Error(
      (typeof gatewayMessage === "string" && gatewayMessage) ||
      (typeof upstreamMessage === "string" && upstreamMessage) ||
        (typeof hint === "string" && hint) ||
        error.message ||
        "Edge function call failed."
    )
  }
  return data
}

const aggregateThreeHourForecastToDaily = (payload) => {
  const list = Array.isArray(payload?.list) ? payload.list : []
  if (list.length === 0) return []

  const groups = new Map()

  for (const item of list) {
    const dt = typeof item?.dt === "number" ? item.dt : null
    if (!dt) continue
    const dateKey = new Date(dt * 1000).toISOString().slice(0, 10)
    const existing = groups.get(dateKey) ?? []
    existing.push(item)
    groups.set(dateKey, existing)
  }

  const daily = Array.from(groups.values())
    .sort((a, b) => {
      const aDt = typeof a?.[0]?.dt === "number" ? a[0].dt : 0
      const bDt = typeof b?.[0]?.dt === "number" ? b[0].dt : 0
      return aDt - bDt
    })
    .slice(0, 8)
    .map((entries) => {
      const sorted = [...entries].sort((a, b) => Number(a.dt) - Number(b.dt))
      const temps = sorted
        .map((entry) => entry?.main?.temp)
        .filter((value) => typeof value === "number" && Number.isFinite(value))
      const tempMins = sorted
        .map((entry) => entry?.main?.temp_min)
        .filter((value) => typeof value === "number" && Number.isFinite(value))
      const tempMaxs = sorted
        .map((entry) => entry?.main?.temp_max)
        .filter((value) => typeof value === "number" && Number.isFinite(value))
      const pops = sorted
        .map((entry) => entry?.pop)
        .filter((value) => typeof value === "number" && Number.isFinite(value))
      const windSpeeds = sorted
        .map((entry) => entry?.wind?.speed)
        .filter((value) => typeof value === "number" && Number.isFinite(value))

      const targetHour = 12
      const representative =
        sorted.reduce((best, entry) => {
          const currentHour = new Date(Number(entry.dt) * 1000).getUTCHours()
          const currentDelta = Math.abs(currentHour - targetHour)
          if (!best) return { entry, delta: currentDelta }
          return currentDelta < best.delta ? { entry, delta: currentDelta } : best
        }, null)?.entry ?? sorted[Math.floor(sorted.length / 2)] ?? sorted[0]

      return {
        dt: representative?.dt ?? sorted[0]?.dt ?? null,
        sunrise: null,
        sunset: null,
        temp: {
          min:
            tempMins.length > 0
              ? Math.min(...tempMins)
              : temps.length > 0
                ? Math.min(...temps)
                : null,
          max:
            tempMaxs.length > 0
              ? Math.max(...tempMaxs)
              : temps.length > 0
                ? Math.max(...temps)
                : null,
        },
        wind_speed: windSpeeds.length > 0 ? Math.max(...windSpeeds) : null,
        pop: pops.length > 0 ? Math.max(...pops) : null,
        weather: Array.isArray(representative?.weather)
          ? representative.weather
          : representative?.weather
            ? [representative.weather]
            : [],
      }
    })
    .filter((entry) => typeof entry?.dt === "number" && Number.isFinite(entry.dt))

  return daily
}

let lastWeatherFetch = null

export const getLastWeatherFetchTimestamp = () => lastWeatherFetch

export const runHealthCheck = async () =>
  invokeAviationProxy({ health: true })

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
  let oneCallData = null
  let oneCallErrorMessage = null
  try {
    oneCallData = await invokeAviationProxy({
      provider: "openweather",
      mode: "onecall",
      lat,
      lon,
      units,
    })
  } catch (error) {
    oneCallErrorMessage =
      error instanceof Error ? error.message : "Unable to load 8-day forecast."
    console.warn("One Call forecast request failed.", error)
  }

  const oneCallDebug =
    oneCallData && typeof oneCallData === "object" && typeof oneCallData.onecallDebug === "string"
      ? oneCallData.onecallDebug
      : null

  let fallbackForecastData = null
  let fallbackForecastError = null
  const oneCallDaily = Array.isArray(oneCallData?.daily) ? oneCallData.daily : []

  if (!oneCallDaily.length) {
    try {
      fallbackForecastData = await invokeAviationProxy({
        provider: "openweather",
        mode: "forecast",
        lat,
        lon,
        units,
      })
    } catch (error) {
      fallbackForecastError =
        error instanceof Error ? error.message : "Unable to load fallback forecast."
      console.warn("5-day forecast fallback request failed.", error)
    }
  }

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

  const fallbackForecast = aggregateThreeHourForecastToDaily(fallbackForecastData)
  const forecast = oneCallDaily.length > 0 ? oneCallDaily : fallbackForecast
  const forecastError =
    forecast.length === 0
      ? oneCallErrorMessage ??
        oneCallDebug ??
        (fallbackForecastError
          ? `8-day outlook unavailable. Fallback forecast failed: ${fallbackForecastError}`
          : oneCallData
            ? "8-day outlook data was not included in the forecast response."
            : "8-day outlook is unavailable. Verify OpenWeather One Call 3.0 access for this API key.")
      : null

  lastWeatherFetch = Date.now()

  return {
    ...weatherData,
    uvi,
    pop,
    precipitation,
    precipitationType,
    weatherDescription: detailedDescription,
    hourly: oneCallData?.hourly ?? null,
    forecast,
    forecastError,
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
