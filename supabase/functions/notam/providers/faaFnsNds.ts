import { withTimeoutFetch } from "../../_shared/aviation.ts"
import type { NotamProvider, NotamProviderResult } from "./provider.ts"

type FaaNotamAuthMode = "basic" | "wsse"

type FaaFnsNdsProviderConfig = {
  endpoint: string
  username: string
  password: string
  authMode: FaaNotamAuthMode
}

type EndpointProbeResult = {
  url: string
  status: number
  contentType: string | null
  bodySnippet: string | null
}

const FAA_NOTAM_USER_AGENT = "GIDrone/0.2.3 (FAA NOTAM adapter scaffold)"

const base64Encode = (value: string) => btoa(value)

const randomNonceBase64 = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

const sha1Base64 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value))
  const bytes = new Uint8Array(digest)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

// Isolated helper so we can replace the WSSE details once the FAA WSDD/WSS policy is confirmed.
const buildWsseUsernameTokenHeaderXml = async ({
  username,
  password,
}: {
  username: string
  password: string
}) => {
  const created = new Date().toISOString()
  const nonceBase64 = randomNonceBase64()
  const nonceBinary = atob(nonceBase64)
  const passwordDigestBase64 = await sha1Base64(`${nonceBinary}${created}${password}`)

  return [
    `<wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/07/secext" xmlns:wsu="http://schemas.xmlsoap.org/ws/2002/07/utility">`,
    "<wsse:UsernameToken>",
    `<wsse:Username>${username}</wsse:Username>`,
    `<wsse:Password Type="http://schemas.xmlsoap.org/ws/2002/07/secext#PasswordDigest">${passwordDigestBase64}</wsse:Password>`,
    `<wsse:Nonce>${nonceBase64}</wsse:Nonce>`,
    `<wsu:Created>${created}</wsu:Created>`,
    "</wsse:UsernameToken>",
    "</wsse:Security>",
  ].join("")
}

const redactProbeBody = (value: string | null) => {
  if (!value) return null
  return value.replace(/\s+/g, " ").slice(0, 240)
}

export class FaaFnsNdsProvider implements NotamProvider {
  readonly config: FaaFnsNdsProviderConfig

  constructor(config: FaaFnsNdsProviderConfig) {
    this.config = config
  }

  static normalizeAuthMode(value: string | null | undefined): FaaNotamAuthMode {
    return value?.trim().toLowerCase() === "wsse" ? "wsse" : "basic"
  }

  static getMissingSecrets(config: {
    endpoint?: string | null
    username?: string | null
    password?: string | null
    authMode?: string | null
  }) {
    const missing: string[] = []
    const authMode = FaaFnsNdsProvider.normalizeAuthMode(config.authMode)

    if (!(config.endpoint ?? "").trim()) missing.push("FAA_NOTAM_ENDPOINT")
    if (!(config.username ?? "").trim()) missing.push("FAA_NOTAM_USERNAME")
    if (!(config.password ?? "").trim()) missing.push("FAA_NOTAM_PASSWORD")
    if (config.authMode && !["basic", "wsse"].includes(config.authMode.trim().toLowerCase())) {
      missing.push("FAA_NOTAM_AUTH_MODE (must be basic or wsse)")
    }

    return {
      missing,
      authMode,
    }
  }

  private buildBasicAuthHeaders() {
    const token = base64Encode(`${this.config.username}:${this.config.password}`)
    return {
      Authorization: `Basic ${token}`,
    }
  }

  private async buildAuthHeadersForSoap() {
    if (this.config.authMode === "basic") {
      return this.buildBasicAuthHeaders()
    }

    // Some FAA SOAP services use WS-Security UsernameToken inside the SOAP header.
    // We surface the generated XML in an HTTP header placeholder so the envelope builder
    // can inject it later without changing the rest of the adapter pipeline.
    return {
      "X-GIDRONE-WSSE-HEADER-XML": await buildWsseUsernameTokenHeaderXml({
        username: this.config.username,
        password: this.config.password,
      }),
    }
  }

  private async probeEndpointCapabilities(): Promise<EndpointProbeResult> {
    const endpointUrl = new URL(this.config.endpoint)
    const probeCandidates = [
      endpointUrl.toString(),
      (() => {
        const wsdlUrl = new URL(endpointUrl.toString())
        if (!wsdlUrl.searchParams.has("wsdl")) wsdlUrl.searchParams.set("wsdl", "")
        return wsdlUrl.toString().replace(/=$/, "")
      })(),
    ]

    let lastError: unknown = null

    for (const probeUrl of probeCandidates) {
      try {
        const response = await withTimeoutFetch(
          probeUrl,
          {
            method: "GET",
            headers: {
              Accept: "application/xml,text/xml,text/html;q=0.9,*/*;q=0.8",
              "User-Agent": FAA_NOTAM_USER_AGENT,
              ...(this.config.authMode === "basic" ? this.buildBasicAuthHeaders() : {}),
            },
          },
          10_000
        )

        const contentType = response.headers.get("content-type")
        let bodySnippet: string | null = null
        try {
          bodySnippet = redactProbeBody(await response.text())
        } catch {
          bodySnippet = null
        }

        return {
          url: probeUrl,
          status: response.status,
          contentType,
          bodySnippet,
        }
      } catch (error) {
        lastError = error
      }
    }

    throw new Error(
      lastError instanceof Error
        ? `FAA NOTAM endpoint probe failed: ${lastError.message}`
        : "FAA NOTAM endpoint probe failed."
    )
  }

  // Placeholder for the FAA FNS NDS SOAP envelope. Populate from the FAA WSDD contract
  // once the exact operation name, namespaces, and request schema are available.
  private async buildSoapRequestEnvelope(params: {
    icaos: string[]
    startsAtIso: string
    endsAtIso: string
  }) {
    void params
    const authHeaders = await this.buildAuthHeadersForSoap()
    return {
      authHeaders,
      soapAction: null as string | null,
      envelopeXml: null as string | null,
    }
  }

  async fetchNotams(params: {
    icaos: string[]
    startsAtIso: string
    endsAtIso: string
  }): Promise<NotamProviderResult> {
    if (params.icaos.length === 0) {
      return {
        items: [],
        message: "No ICAO identifiers provided for FAA NOTAM lookup.",
        source: "faa-fns-nds",
      }
    }

    const probe = await this.probeEndpointCapabilities()

    // Validate auth helper generation early so future WSDD integration failures are isolated.
    await this.buildSoapRequestEnvelope(params)

    const probeSummary = `${probe.status}${probe.contentType ? ` ${probe.contentType}` : ""}`
    const reachableHint =
      probe.status === 401 || probe.status === 403 || probe.status === 405 || probe.status === 200
        ? "reachable"
        : "responded"

    throw new Error(
      [
        `FAA NOTAM endpoint is configured and ${reachableHint} (${probeSummary}) but the SOAP request contract is not configured yet.`,
        `Insert the FAA FNS NDS request envelope/action mapping from the FAA Agreement Portal WSDD in supabase/functions/notam/providers/faaFnsNds.ts.`,
        `Probe URL: ${probe.url}`,
      ].join(" ")
    )
  }
}
