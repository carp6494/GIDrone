const DEFAULT_DEV_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
])

const parseAllowedOrigins = () => {
  const configured =
    Deno.env.get("ALLOWED_ORIGINS") ?? Deno.env.get("CORS_ALLOWED_ORIGINS") ?? ""
  if (!configured.trim()) return null
  return new Set(
    configured
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

const isOriginAllowed = (origin: string | null) => {
  if (!origin) return true
  const allowed = parseAllowedOrigins()
  if (allowed) return allowed.has(origin)
  return DEFAULT_DEV_ORIGINS.has(origin)
}

const corsHeaders = (request: Request) => {
  const origin = request.headers.get("origin")
  const requestedHeaders =
    request.headers.get("access-control-request-headers") ??
    "authorization, x-client-info, x-supabase-client-platform, apikey, content-type"
  const allowOrigin =
    origin && isOriginAllowed(origin)
      ? origin
      : origin
        ? "null"
        : "*"
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": requestedHeaders,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Access-Control-Request-Headers, Access-Control-Request-Method",
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

const isValidLatLon = (lat: number, lon: number) =>
  lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180

const isValidUnits = (units: string) =>
  units === "standard" || units === "metric" || units === "imperial"

const normalizeUsZipQuery = (value: string) => {
  const compact = value.replace(/\s+/g, "")
  const match = compact.match(/^(\d{5})(?:-\d{4})?$/)
  return match ? match[1] : null
}

const redactUrl = (url: URL) => {
  const safeUrl = new URL(url.toString())
  if (safeUrl.searchParams.has("appid")) {
    safeUrl.searchParams.set("appid", "[redacted]")
  }
  return safeUrl.toString()
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
  const requestOrigin = request.headers.get("origin")

  if (!isOriginAllowed(requestOrigin)) {
    return jsonResponse(request, { error: "Origin not allowed." }, 403)
  }

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
      if (query.length > 160) {
        return jsonResponse(request, { error: "Query is too long." }, 400)
      }

      const limitRaw = toNumber(payload?.limit)
      const limit =
        limitRaw === null ? 1 : Number.isInteger(limitRaw) ? limitRaw : null
      if (limit === null || limit < 1 || limit > 5) {
        return jsonResponse(request, { error: "limit must be an integer between 1 and 5." }, 400)
      }
      const country = typeof payload?.country === "string" ? payload.country : ""
      const normalizedCountry = country.trim().toUpperCase() || "US"
      const zipQuery = normalizeUsZipQuery(query)

      if (zipQuery) {
        const geoUrl = new URL(`${openWeatherGeoBaseUrl}/zip`)
        geoUrl.searchParams.set("zip", `${zipQuery},${normalizedCountry}`)
        geoUrl.searchParams.set("appid", apiKey)

        const response = await withTimeout(geoUrl)
        if (!response.ok) {
          const message = await response.text()
          return textResponse(request, message || "Upstream error.", response.status)
        }

        const data = await response.json()
        return jsonResponse(
          request,
          data && typeof data === "object" ? [data] : [],
          200
        )
      }

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
    if (!/^(current|onecall|forecast)$/.test(mode)) {
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
    if (!isValidLatLon(lat, lon)) {
      return jsonResponse(
        request,
        { error: "Latitude must be -90..90 and longitude must be -180..180." },
        400
      )
    }

    const units =
      typeof payload?.units === "string" ? payload.units.toLowerCase() : "imperial"
    if (!isValidUnits(units)) {
      return jsonResponse(
        request,
        { error: "units must be one of: standard, metric, imperial." },
        400
      )
    }

    const weatherUrl =
      mode === "onecall"
        ? new URL("https://api.openweathermap.org/data/3.0/onecall")
        : mode === "forecast"
          ? new URL(`${openWeatherBaseUrl}/forecast`)
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
          endpoint: redactUrl(weatherUrl),
          ...(mode === "onecall" && (response.status === 401 || response.status === 403)
            ? { hint: "One Call not available for this API key" }
            : {}),
          details: upstreamData,
        },
        response.status
      )
    }

    const data = await response.json()
    if (
      mode === "onecall" &&
      (!data || typeof data !== "object" || !Array.isArray((data as { daily?: unknown }).daily))
    ) {
      const keys =
        data && typeof data === "object" ? Object.keys(data as Record<string, unknown>) : []
      return jsonResponse(
        request,
        {
          ...(data && typeof data === "object" ? (data as Record<string, unknown>) : {}),
          onecallDebug: `onecall ok but daily missing: keys=[${keys.join(",")}]`,
        },
        200
      )
    }

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
