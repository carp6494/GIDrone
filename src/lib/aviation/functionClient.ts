import { supabase } from "../supabase"

export class AviationFunctionError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = "AviationFunctionError"
    this.status = status
    this.payload = payload
  }
}

const isDev = import.meta.env.DEV
const runtimeSupabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "")
let didLogRuntimeSupabaseUrl = false

const readPayload = async (response: Response) => {
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

const extractResponseFromInvokeError = (error: unknown): Response | null => {
  if (!error || typeof error !== "object") return null
  if (!("context" in error)) return null
  const context = (error as { context?: unknown }).context
  return context instanceof Response ? context : null
}

const toReachabilityMessage = (detail?: string) =>
  isDev && detail
    ? `Unable to reach data service (${detail}).`
    : "Unable to reach data service."

export const toAviationLoadErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof AviationFunctionError) {
    return error.message
  }

  if (error instanceof Error) {
    if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
      return toReachabilityMessage(error.message)
    }
    return error.message || fallback
  }

  return fallback
}

export const getFunctionJson = async <T>(
  functionName: string,
  body?: Record<string, unknown>
): Promise<T> => {
  if (isDev && !didLogRuntimeSupabaseUrl) {
    didLogRuntimeSupabaseUrl = true
    console.info("[aviation] runtime VITE_SUPABASE_URL", runtimeSupabaseUrl || "(empty)")
  }

  const { data, error } = await supabase.functions.invoke(functionName, {
    method: "POST",
    body: body ?? {},
  })

  if (error) {
    const response = extractResponseFromInvokeError(error)
    const status = response?.status ?? 0
    const payload = response ? await readPayload(response) : null

    if (isDev) {
      console.error("[aviation] invoke raw error object", error)
      console.error("[aviation] invoke error response context", response)
      console.debug("[aviation] invoke error", {
        functionName,
        status,
        error,
        payload,
      })
    }

    if (!response) {
      throw new Error(
        toReachabilityMessage(error instanceof Error ? error.message : "network or CORS error")
      )
    }

    const payloadMessage =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null
    const message =
      status === 404
        ? `Data service unavailable (${functionName} function not found).`
        : status === 401 || status === 403
          ? "Data service authorization failed."
          : payloadMessage ?? `Edge function request failed (${status})`

    throw new AviationFunctionError(message, status, payload)
  }

  if (isDev) {
    console.debug("[aviation] invoke ok", {
      functionName,
      status: "ok",
      error: null,
    })
  }

  return data as T
}
