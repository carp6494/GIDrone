import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  LogIn,
  LogOut,
  Mail,
  Map,
  Radar,
  RefreshCcw,
  Settings,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react"
import type { Session, User } from "@supabase/supabase-js"

import { supabase } from "./lib/supabase"
import { applyTheme, getStoredTheme, storeTheme, type ThemeMode } from "./lib/theme"
import type { TfrMapFocus } from "./lib/aviation/types"

import { AuthGuard } from "./components/AuthGuard"
import { AuthSplash } from "./components/AuthSplash"
import { ConditionsTab } from "./components/ConditionsTab"
import { SettingsModal } from "./components/SettingsModal"

const RadarTab = lazy(() =>
  import("./components/RadarTab").then((module) => ({ default: module.RadarTab }))
)
const SitesTab = lazy(() =>
  import("./components/SitesTab").then((module) => ({ default: module.SitesTab }))
)

type TabKey = "conditions" | "radar" | "sites"
type UnitType = "mph" | "kt"
type TimeFormat = "12h" | "24h"

type MapFocus =
  | {
      lat: number
      lon: number
      name?: string | null
    }
  | ({
      name?: string | null
    } & TfrMapFocus)

const tabs: Array<{ key: TabKey; label: string; icon: JSX.Element }> = [
  { key: "conditions", label: "Conditions", icon: <ShieldCheck className="h-4 w-4" /> },
  { key: "radar", label: "Radar & Layers", icon: <Radar className="h-4 w-4" /> },
  { key: "sites", label: "My Sites", icon: <Map className="h-4 w-4" /> },
]

class PanelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: "" }

  static getDerivedStateFromError(err: unknown) {
    return { hasError: true, message: err instanceof Error ? err.message : "Unknown error" }
  }

  componentDidCatch(err: unknown) {
    console.error("[panel] error boundary caught:", err)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-3xl border border-rose-800 bg-rose-950/40 p-6 text-sm text-rose-200">
          <p className="font-semibold">Mission panel failed to load.</p>
          <p className="mt-2 opacity-90">{this.state.message}</p>
          <button
            type="button"
            className="mt-4 rounded-full border border-rose-700 px-4 py-2 text-xs font-semibold"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function AppShell() {
  const getStoredValue = (key: string, fallback: string) => {
    if (typeof window === "undefined") return fallback
    return window.localStorage.getItem(key) ?? fallback
  }

  const [activeTab, setActiveTab] = useState<TabKey>("conditions")
  const [unit, setUnit] = useState<UnitType>(() =>
    getStoredValue("gi-drone:unit", "mph") === "kt" ? "kt" : "mph"
  )
  const [useGps, setUseGps] = useState<boolean>(
    () => getStoredValue("gi-drone:useGps", "true") !== "false"
  )
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(() => {
    const stored = getStoredValue("gi-drone:timeFormat", "24h")
    return stored === "12h" ? "12h" : "24h"
  })
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme())

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null)
  const profileMenuRef = useRef<HTMLDivElement | null>(null)

  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [email, setEmail] = useState("")

  const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/` : "/"

  const handleGoogleLogin = async () => {
    try {
      setAuthError(null)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: { prompt: "select_account" },
        },
      })
      if (error) throw error
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Google login failed. Please try again.")
    }
  }

  const handleMicrosoftLogin = async () => {
    try {
      setAuthError(null)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          redirectTo,
          scopes: "openid profile email User.Read",
          queryParams: { prompt: "select_account" },
        },
      })
      if (error) throw error
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Microsoft login failed. Please try again.")
    }
  }

  const handleEmailLogin = async () => {
    try {
      setAuthError(null)
      const trimmed = email.trim().toLowerCase()
      if (!trimmed) {
        setAuthError("Please enter an email address.")
        return
      }

      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: redirectTo },
      })
      if (error) throw error

      setAuthError("Magic link sent. Check your email.")
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Email login failed. Please try again.")
    }
  }

  const handleLogout = async () => {
    try {
      setAuthError(null)
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to log out.")
    }
  }

  const handleSwitchAccount = async () => {
    await handleLogout()
  }

  const closeProfileMenu = () => setIsProfileMenuOpen(false)

  const runMenuAction = (action: () => void | Promise<void>) => {
    closeProfileMenu()
    void action()
  }

  useEffect(() => {
    const ac = new AbortController()

    const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string) => {
      let timeoutId: number | undefined
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      })
      try {
        return await Promise.race([promise, timeout])
      } finally {
        if (timeoutId) window.clearTimeout(timeoutId)
      }
    }

    const stripAuthNoiseFromUrl = () => {
      if (typeof window === "undefined") return

      const url = new URL(window.location.href)

      url.searchParams.delete("error")
      url.searchParams.delete("error_code")
      url.searchParams.delete("error_description")
      url.searchParams.delete("code")
      url.searchParams.delete("state")

      if (
        url.hash.includes("access_token=") ||
        url.hash.includes("refresh_token=") ||
        url.hash.includes("id_token=")
      ) {
        url.hash = ""
      }

      window.history.replaceState({}, document.title, url.toString())
    }

    const loadSession = async () => {
      const failsafeId = window.setTimeout(() => {
        if (ac.signal.aborted) return
        console.warn("[auth] failsafe fired, forcing loading false")
        setAuthError("Auth is taking too long. Please refresh.")
        setLoading(false)
      }, 12000)

      try {
        console.log("[auth] loadSession start")

        if (typeof window !== "undefined") {
          const url = new URL(window.location.href)
          const hasError = url.searchParams.has("error") || url.searchParams.has("error_code")
          const hasDesc = url.searchParams.has("error_description")

          if (hasError || hasDesc) {
            const errDesc = url.searchParams.get("error_description")
            const err = url.searchParams.get("error")
            const message = errDesc
              ? decodeURIComponent(errDesc.replace(/\+/g, " "))
              : err ?? "OAuth error"
            if (!ac.signal.aborted) setAuthError(message)
            stripAuthNoiseFromUrl()
          }
        }

        console.log("[auth] before getSession", Date.now())
        const sessionResult = await withTimeout(supabase.auth.getSession(), 8000, "getSession")
        console.log("[auth] after getSession", Date.now(), sessionResult)

        if (ac.signal.aborted) return

        const { data, error } = sessionResult as {
          data: { session: Session | null }
          error: Error | null
        }

        if (error) throw error

        const session: Session | null = data.session ?? null
        console.log("[auth] session present:", !!session, session?.user?.email ?? null)

        setUser(session?.user ?? null)
        if (session) setAuthError(null)

        stripAuthNoiseFromUrl()
      } catch (error) {
        console.error("[auth] loadSession failed:", error)
        if (ac.signal.aborted) return
        setUser(null)
        setAuthError(error instanceof Error ? error.message : "Unable to read authentication session.")
      } finally {
        window.clearTimeout(failsafeId)
        if (!ac.signal.aborted) {
          console.log("[auth] loadSession done, clearing loading")
          setLoading(false)
        }
      }
    }

    loadSession()

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (ac.signal.aborted) return
      console.log("[auth] event:", event, "hasSession:", !!session, session?.user?.email ?? null)
      setUser(session?.user ?? null)
      if (session) setAuthError(null)
      setLoading(false)
      stripAuthNoiseFromUrl()
    })

    return () => {
      ac.abort()
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isProfileMenuOpen) return

    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (profileMenuRef.current?.contains(event.target)) return
      setIsProfileMenuOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsProfileMenuOpen(false)
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)

    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [isProfileMenuOpen])

  useEffect(() => {
    if (typeof window === "undefined") return

    applyTheme(theme)
    storeTheme(theme)

    if (theme !== "system") return

    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const legacyMq = mq as MediaQueryList & {
      addListener?: (listener: () => void) => void
      removeListener?: (listener: () => void) => void
    }
    const onChange = () => applyTheme("system")

    if ("addEventListener" in mq) mq.addEventListener("change", onChange)
    else legacyMq.addListener?.(onChange)

    return () => {
      if ("removeEventListener" in mq) mq.removeEventListener("change", onChange)
      else legacyMq.removeListener?.(onChange)
    }
  }, [theme])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("gi-drone:unit", unit)
  }, [unit])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("gi-drone:useGps", String(useGps))
  }, [useGps])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("gi-drone:timeFormat", timeFormat)
  }, [timeFormat])

  const effectiveUserId = user?.id ?? null

  const panel = useMemo(() => {
    if (activeTab === "conditions") {
      return (
        <ConditionsTab
          unit={unit}
          useGps={useGps}
          timeFormat={timeFormat}
          onTabChange={setActiveTab}
          onRadarFocus={(focus) => {
            setMapFocus({
              bounds: focus.bounds,
              notamId: focus.notamId,
              name: `TFR ${focus.notamId}`,
            })
          }}
        />
      )
    }
    if (activeTab === "radar") {
      return <RadarTab focusLocation={mapFocus ?? undefined} />
    }

    return (
      <AuthGuard
        user={user}
        loading={loading}
        fallback={
          <div className="w-full rounded-3xl border border-slate-800 bg-slate-900/70 p-8 text-slate-100 shadow-xl">
            <div className="flex flex-col gap-3 text-center">
              <p className="text-xs uppercase tracking-[0.45em] text-emerald-300">
                Mission Slate Access
              </p>
              <h2 className="text-3xl font-semibold text-white">Sign in to manage sites</h2>
              <p className="text-sm text-slate-300">
                Authenticate to upload, edit, and export site data.
              </p>
            </div>

            <div className="mt-6 flex flex-col items-center gap-3">
              <div className="flex w-full max-w-sm flex-col gap-2">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  className="rounded-full bg-emerald-400 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-950 transition hover:bg-emerald-300"
                >
                  Continue with Google
                </button>

                <button
                  type="button"
                  onClick={handleMicrosoftLogin}
                  className="rounded-full border border-slate-700 bg-slate-900/40 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-100 transition hover:border-emerald-400 hover:text-emerald-200"
                >
                  Continue with Microsoft
                </button>

                <div className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <label className="mb-2 block text-[11px] uppercase tracking-[0.2em] text-slate-400">
                    Email magic link
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-full border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400"
                    />
                    <button
                      type="button"
                      onClick={handleEmailLogin}
                      className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200"
                    >
                      Send link
                    </button>
                  </div>
                </div>

                {authError && <p className="mt-2 text-center text-xs text-rose-300">{authError}</p>}
              </div>
            </div>
          </div>
        }
      >
        <SitesTab
          userId={effectiveUserId}
          onShowOnMap={(focus) => {
            setMapFocus(focus)
            setActiveTab("radar")
          }}
        />
      </AuthGuard>
    )
  }, [activeTab, unit, useGps, timeFormat, user, effectiveUserId, mapFocus, loading, authError, email])

  if (loading) {
    return (
      <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="flex min-h-screen items-center justify-center">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-6 py-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
            Loading authentication session...
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <AuthSplash
        onSignInGoogle={handleGoogleLogin}
        onSignInMicrosoft={handleMicrosoftLogin}
        onSendMagicLink={handleEmailLogin}
        email={email}
        onEmailChange={setEmail}
        authError={authError}
      />
    )
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="relative min-h-screen overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(226,232,240,0.85),_transparent_65%)] dark:hidden" />
        <div className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.9),_transparent_60%)] dark:block" />
        <div className="pointer-events-none absolute -left-32 top-20 h-80 w-80 rounded-full bg-emerald-500/10 blur-[140px] dark:bg-emerald-500/15" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-cyan-500/10 blur-[160px] dark:bg-cyan-500/15" />

        <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-12">
          <div ref={profileMenuRef} className="absolute right-6 top-6 z-30">
            <button
              type="button"
              onClick={() => setIsProfileMenuOpen((open) => !open)}
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-3 py-2 text-sm text-slate-700 shadow-sm backdrop-blur transition hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/85 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-900"
              aria-haspopup="menu"
              aria-expanded={isProfileMenuOpen}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <UserIcon className="h-4 w-4" />
              </span>
              <span className="hidden max-w-[10rem] truncate text-xs font-medium sm:block">
                {user?.email ?? "Profile"}
              </span>
              <ChevronDown
                className={`h-4 w-4 transition ${isProfileMenuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {isProfileMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white/95 p-2 text-left shadow-xl shadow-slate-900/10 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 dark:shadow-slate-950/40"
              >
                <div className="rounded-xl px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                  <p className="font-medium text-slate-700 dark:text-slate-200">
                    {user?.email ?? "Not signed in"}
                  </p>
                </div>

                <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />

                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(true)
                    closeProfileMenu()
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/80"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </button>

                {user ? (
                  <>
                    <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />

                    <div className="px-3 pb-1 pt-1 text-[11px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Account
                    </div>

                    <button
                      type="button"
                      onClick={() => runMenuAction(handleSwitchAccount)}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/80"
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Switch account
                    </button>
                    <button
                      type="button"
                      onClick={() => runMenuAction(handleLogout)}
                      className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </button>
                  </>
                ) : (
                  <>
                    <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />

                    <button
                      type="button"
                      onClick={() =>
                        runMenuAction(async () => {
                          setActiveTab("sites")
                          await handleGoogleLogin()
                        })
                      }
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/80"
                    >
                      <LogIn className="h-4 w-4" />
                      Sign in with Google
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runMenuAction(async () => {
                          setActiveTab("sites")
                          await handleMicrosoftLogin()
                        })
                      }
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/80"
                    >
                      <LogIn className="h-4 w-4" />
                      Sign in with Microsoft
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runMenuAction(async () => {
                          setActiveTab("sites")
                          await handleEmailLogin()
                        })
                      }
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/80"
                    >
                      <Mail className="h-4 w-4" />
                      Send magic link
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>

          <header className="flex flex-col items-center gap-6 pt-14 text-center sm:pt-4">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.6em] text-emerald-300">GI Drone</p>
              <h1 className="text-4xl font-semibold text-slate-900 dark:text-white md:text-5xl">
                Aviation Safety Analytics
              </h1>
              <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300 md:text-base">
                Professional-grade aviation weather, customizable safety thresholds, and integrated GIS
                layers for precision drone mission planning.
              </p>
            </div>

            <div className="flex w-full flex-col items-center">
              <div className="mx-auto grid w-full max-w-xl grid-cols-3 gap-2 rounded-full border border-slate-200 bg-slate-50/90 p-1 text-xs uppercase tracking-[0.2em] text-slate-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex w-full items-center justify-center gap-2 rounded-full px-3 py-2 transition ${
                      activeTab === tab.key
                        ? "bg-emerald-400 text-slate-950"
                        : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {authError ? (
              <div className="w-full max-w-xl rounded-2xl border border-rose-200 bg-rose-50/80 p-3 text-left text-sm text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-300">
                {authError}
              </div>
            ) : null}
          </header>

          <PanelErrorBoundary>
            <Suspense
              fallback={
                <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                  Loading mission panel...
                </div>
              }
            >
              {panel}
            </Suspense>
          </PanelErrorBoundary>

          <SettingsModal
            isOpen={isSettingsOpen}
            unit={unit}
            onUnitChange={setUnit}
            timeFormat={timeFormat}
            onTimeFormatChange={setTimeFormat}
            theme={theme}
            onThemeChange={setTheme}
            useGps={useGps}
            onUseGpsChange={setUseGps}
            onClose={() => setIsSettingsOpen(false)}
          />
        </main>
      </div>
    </div>
  )
}

function App() {
  return <AppShell />
}

export default App
