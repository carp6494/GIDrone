const corsHeaders = (request: Request) => {
  const origin = request.headers.get("origin") ?? "*"
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Vary": "Origin",
  }
}

const jsonResponse = (request: Request, data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
    },
  })

const textResponse = (request: Request, text: string, status = 200) =>
  new Response(text, {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "text/plain",
    },
  })

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const withTimeout = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) })
  }

  const url = new URL(request.url)
  const wantsHealth =
    url.pathname.endsWith("/health") || url.searchParams.get("health") === "1"

  if (request.method === "GET" && wantsHealth) {
    return jsonResponse(request, {
      ok: true,
      timestamp: new Date().toISOString(),
    })
  }

  if (request.method !== "POST") {
    return jsonResponse(
      request,
      { error: "Method not allowed. Use POST." },
      405
    )
  }

  let payload: Record<string, unknown>
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch (_error) {
    return jsonResponse(request, { error: "Invalid JSON payload." }, 400)
  }

  if (payload?.health === true || payload?.mode === "health") {
    return jsonResponse(request, {
      ok: true,
      timestamp: new Date().toISOString(),
    })
  }

  const provider = typeof payload?.provider === "string" ? payload.provider : ""
  const allowedProviders = new Set(["openweather", "geocode"])
  if (!allowedProviders.has(provider)) {
    return jsonResponse(
      request,
      { error: "Unsupported provider." },
      400
    )
  }

  const apiKey =
    Deno.env.get("OPENWEATHER_API_KEY") ??
    Deno.env.get("VITE_OPENWEATHER_API_KEY") ??
    ""
  if (!apiKey) {
    return jsonResponse(
      request,
      { error: "Missing OpenWeather API key." },
      500
    )
  }

  const openWeatherBaseUrl =
    Deno.env.get("OPENWEATHER_BASE_URL") ??
    "https://api.openweathermap.org/data/2.5"
  const openWeatherGeoBaseUrl =
    Deno.env.get("OPENWEATHER_GEO_BASE_URL") ??
    "https://api.openweathermap.org/geo/1.0"

  try {
    if (provider === "geocode") {
      const query = typeof payload?.query === "string" ? payload.query.trim() : ""
      if (!query) {
        return jsonResponse(request, { error: "Missing query parameter." }, 400)
      }

      const limit = toNumber(payload?.limit) ?? 1
      const country = typeof payload?.country === "string" ? payload.country : ""

      const geoUrl = new URL(`${openWeatherGeoBaseUrl}/direct`)
      geoUrl.searchParams.set("q", country ? `${query},${country}` : query)
      geoUrl.searchParams.set("limit", String(limit))
      geoUrl.searchParams.set("appid", apiKey)

      const response = await withTimeout(geoUrl)
      if (!response.ok) {
        const message = await response.text()
        return textResponse(request, message || "Upstream error.", response.status)
      }

      const data = await response.json()
      return jsonResponse(request, data, 200)
    }

    const mode =
      (typeof payload?.mode === "string" ? payload.mode : undefined) ??
      url.searchParams.get("mode") ??
      "current"
    if (!/^(current|onecall)$/.test(mode)) {
      return jsonResponse(request, { error: "Unsupported mode." }, 400)
    }

    const lat = toNumber(payload?.lat)
    const lon = toNumber(payload?.lon)
    if (lat === null || lon === null) {
      return jsonResponse(
        request,
        { error: "Latitude and longitude are required." },
        400
      )
    }

    const units =
      typeof payload?.units === "string" ? payload.units : "imperial"

    const weatherUrl =
      mode === "onecall"
        ? new URL("https://api.openweathermap.org/data/3.0/onecall")
        : new URL(`${openWeatherBaseUrl}/weather`)
    weatherUrl.searchParams.set("lat", String(lat))
    weatherUrl.searchParams.set("lon", String(lon))
    weatherUrl.searchParams.set("units", units)
    weatherUrl.searchParams.set("appid", apiKey)
    if (mode === "onecall") {
      weatherUrl.searchParams.set("exclude", "minutely,alerts")
    }

    const response = await withTimeout(weatherUrl)
    if (!response.ok) {
      let upstreamData: unknown = null
      try {
        upstreamData = await response.clone().json()
      } catch (_error) {
        try {
          upstreamData = await response.text()
        } catch (_error2) {
          upstreamData = null
        }
      }
      return jsonResponse(
        request,
        {
          error: "OpenWeather upstream error",
          endpoint: weatherUrl.toString(),
          details: upstreamData,
        },
        response.status
      )
    }

    const data = await response.json()
    return jsonResponse(request, data, 200)
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Upstream request timed out."
        : error instanceof Error
          ? error.message
          : "Unexpected error."
    return jsonResponse(request, { error: message }, 502)
  }
})
