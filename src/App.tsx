import { Suspense, lazy, useEffect, useMemo, useState } from "react"
import { Map, Radar, Settings, ShieldCheck } from "lucide-react"

import { AuthGuard } from "./components/AuthGuard"
import { ConditionsTab } from "./components/ConditionsTab"
import { SettingsModal } from "./components/SettingsModal"

const RadarTab = lazy(() =>
  import("./components/RadarTab").then((module) => ({
    default: module.RadarTab,
  }))
)
const SitesTab = lazy(() =>
  import("./components/SitesTab").then((module) => ({
    default: module.SitesTab,
  }))
)

type TabKey = "conditions" | "radar" | "sites"
type UnitType = "mph" | "kt"
type TimeFormat = "12h" | "24h"

type MapFocus = {
  lat: number
  lon: number
  name?: string | null
}

type AppUser = {
  id: string
  email?: string | null
}

const tabs: Array<{ key: TabKey; label: string; icon: JSX.Element }> = [
  { key: "conditions", label: "Conditions", icon: <ShieldCheck className="h-4 w-4" /> },
  { key: "radar", label: "Radar & Layers", icon: <Radar className="h-4 w-4" /> },
  { key: "sites", label: "My Sites", icon: <Map className="h-4 w-4" /> },
]

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null)
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(false )
  const [authError, setAuthError] = useState<string | null>(null)
  
 const handleLogin = async () => {
  setAuthError("Auth is being migrated to Supabase. Signing in is temporarily disabled.")
}

  const handleLogout = async () => {
  setUser(null)
  setAuthError(null)
}

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
              <h2 className="text-3xl font-semibold text-white">
                Sign in to manage sites
              </h2>
              <p className="text-sm text-slate-300">
                Authenticate to upload, edit, and export site data.
              </p>
            </div>
            <div className="mt-6 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={handleLogin}
                className="rounded-full bg-emerald-400 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-950 transition hover:bg-emerald-300"
              >
                Sign in
              </button>
              {authError && (
                <p className="text-xs text-rose-300">{authError}</p>
              )}
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
  }, [
    activeTab,
    unit,
    useGps,
    timeFormat,
    user,
    effectiveUserId,
    mapFocus,
    loading,
  ])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="flex min-h-screen items-center justify-center">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-6 py-4 text-sm text-slate-300">
            Loading authentication session...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="relative min-h-screen overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.9),_transparent_60%)]" />
        <div className="pointer-events-none absolute -left-32 top-20 h-80 w-80 rounded-full bg-emerald-500/15 blur-[140px]" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-cyan-500/15 blur-[160px]" />

        <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-12">
          <header className="flex flex-col items-center gap-6 text-center">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.6em] text-emerald-300">
                GI Drone
              </p>
              <h1 className="text-4xl font-semibold text-white md:text-5xl">
                Aviation Safety Analytics
              </h1>
              <p className="max-w-2xl text-sm text-slate-300 md:text-base">
                Professional-grade aviation weather, customizable safety
                thresholds, and integrated GIS layers for precision drone
                mission planning.
              </p>
            </div>
            <div className="flex w-full flex-col items-center">
              <div className="mx-auto grid w-full max-w-xl grid-cols-4 gap-2 rounded-full border border-slate-800 bg-slate-900/70 p-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex w-full items-center justify-center gap-2 rounded-full px-3 py-2 transition ${
                      activeTab === tab.key
                        ? "bg-emerald-400 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className={`flex w-full items-center justify-center gap-2 rounded-full px-3 py-2 transition ${
                    isSettingsOpen
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </button>
              </div>
            </div>
            <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left text-xs text-slate-300">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-slate-200">
                    {user ? "Signed in" : "Not signed in"}
                  </p>
                  <p className="text-xs text-slate-400">
                    {user?.email ?? "Authentication ready."}
                  </p>
                </div>
                {user ? (
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200"
                  >
                    Log out
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("sites")
                      handleLogin()
                    }}
                    className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200"
                  >
                    Sign in
                  </button>
                )}
              </div>
              {authError && (
                <p className="mt-2 text-rose-300">{authError}</p>
              )}
            </div>
          </header>

          <Suspense
            fallback={
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-300">
                Loading mission panel...
              </div>
            }
          >
            {panel}
          </Suspense>

          <SettingsModal
            isOpen={isSettingsOpen}
            unit={unit}
            onUnitChange={setUnit}
            timeFormat={timeFormat}
            onTimeFormatChange={setTimeFormat}
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
  return (
    <AppShell />
  )
}

export default App
