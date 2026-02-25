import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

export const isOriginAllowed = (_origin: string | null) => true

export const corsHeaders = (request: Request) => {
  const requestedHeaders =
    request.headers.get("access-control-request-headers") ??
    "authorization, x-client-info, apikey, content-type"
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": requestedHeaders,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Headers, Access-Control-Request-Method",
  }
}

export const jsonResponse = (request: Request, data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
    },
  })

export const optionsResponse = (request: Request) =>
  new Response(null, { status: 204, headers: corsHeaders(request) })

export const parseNumberParam = (value: string | null) => {
  if (value === null || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const parseIntegerParam = (value: string | null) => {
  const parsed = parseNumberParam(value)
  if (parsed === null || !Number.isInteger(parsed)) return null
  return parsed
}

export const parseNumberLike = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") return parseNumberParam(value)
  return null
}

export const parseIntegerLike = (value: unknown) => {
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value === "string") return parseIntegerParam(value)
  return null
}

export const readJsonObjectBody = async (request: Request): Promise<Record<string, unknown> | null> => {
  if (request.method !== "POST") return null

  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("application/json")) {
    const raw = await request.text()
    if (!raw.trim()) return {}
    throw new Error("Expected JSON request body.")
  }

  const raw = await request.text()
  if (!raw.trim()) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("Invalid JSON payload.")
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON body must be an object.")
  }

  return parsed as Record<string, unknown>
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export const isValidLatLon = (lat: number, lon: number) =>
  lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180

export const createServiceRoleClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

type ApiCacheRow = {
  cache_key: string
  payload: unknown
  status_code: number | null
  expires_at: string
}

export const getCachedJson = async <T>(db: SupabaseClient, cacheKey: string) => {
  const { data, error } = await db
    .from("api_cache")
    .select("cache_key, payload, status_code, expires_at")
    .eq("cache_key", cacheKey)
    .maybeSingle<ApiCacheRow>()

  if (error) {
    throw new Error(`Failed to read api_cache (${cacheKey}): ${error.message}`)
  }
  if (!data) return null
  if (Date.parse(data.expires_at) <= Date.now()) return null

  return data.payload as T
}

export const setCachedJson = async (
  db: SupabaseClient,
  cacheKey: string,
  payload: unknown,
  ttlSeconds: number,
  statusCode = 200
) => {
  const nowIso = new Date().toISOString()
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  const { error } = await db.from("api_cache").upsert(
    {
      cache_key: cacheKey,
      payload,
      status_code: statusCode,
      expires_at: expiresAt,
      created_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "cache_key" }
  )

  if (error) {
    throw new Error(`Failed to write api_cache (${cacheKey}): ${error.message}`)
  }
}

export const withTimeoutFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10_000
) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

export const readResponsePayload = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? ""

  if (contentType.includes("application/json")) {
    try {
      return await response.json()
    } catch {
      return null
    }
  }

  try {
    return await response.text()
  } catch {
    return null
  }
}

export const expectJsonResponse = async <T>(response: Response) => {
  if (!response.ok) {
    const payload = await readResponsePayload(response)
    throw new Error(
      `Upstream ${response.status} ${response.statusText}: ${
        typeof payload === "string" ? payload.slice(0, 280) : JSON.stringify(payload ?? null)
      }`
    )
  }
  return (await response.json()) as T
}

export const readGzipJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = await readResponsePayload(response)
    throw new Error(
      `Upstream ${response.status} ${response.statusText}: ${
        typeof payload === "string" ? payload.slice(0, 280) : JSON.stringify(payload ?? null)
      }`
    )
  }
  if (!response.body) {
    throw new Error("Stations gzip response body is empty.")
  }

  const stream = response.body.pipeThrough(new DecompressionStream("gzip"))
  return (await new Response(stream).json()) as T
}

export const haversineMiles = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const earthRadiusMiles = 3958.7613
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusMiles * c
}

export const normalizeNotamId = (value: string) => value.trim().replace(/\s+/g, "")

export const safeIsoString = (value: string | null | undefined) => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toISOString()
}
