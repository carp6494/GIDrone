import type { ThemeMode } from "../lib/theme"

type UnitType = "mph" | "kt"
type TimeFormat = "12h" | "24h"

type SettingsModalProps = {
  isOpen: boolean
  unit: UnitType
  onUnitChange: (unit: UnitType) => void
  timeFormat: TimeFormat
  onTimeFormatChange: (format: TimeFormat) => void
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
  useGps: boolean
  onUseGpsChange: (useGps: boolean) => void
  onClose: () => void
}

export function SettingsModal({
  isOpen,
  unit,
  onUnitChange,
  timeFormat,
  onTimeFormatChange,
  theme,
  onThemeChange,
  useGps,
  onUseGpsChange,
  onClose,
}: SettingsModalProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 p-4 sm:items-center sm:p-6 dark:bg-slate-950/75"
      onClick={onClose}
    >
      <div
        className="my-auto w-full max-w-xl overflow-y-auto rounded-3xl border border-slate-200 bg-white/95 p-4 text-left text-slate-900 shadow-2xl shadow-slate-900/10 backdrop-blur sm:max-h-[calc(100svh-3rem)] sm:p-6 dark:border-slate-800 dark:bg-slate-950/95 dark:text-slate-100 dark:shadow-slate-950/40"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.4em] text-emerald-300">
              Settings
            </p>
            <h2 className="mt-2 text-[clamp(1.35rem,3.2vw,1.5rem)] font-semibold text-slate-900 dark:text-white">
              Mission Preferences
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-600 transition hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/60">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
              Theme
            </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {(["dark", "light"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onThemeChange(mode)}
                    className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                      theme === mode
                        ? "bg-emerald-400 text-slate-950"
                        : "border border-slate-300 text-slate-700 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/60">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
              Units
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onUnitChange("mph")}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                  unit === "mph"
                    ? "bg-emerald-400 text-slate-950"
                    : "border border-slate-300 text-slate-700 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                MPH
              </button>
              <button
                type="button"
                onClick={() => onUnitChange("kt")}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                  unit === "kt"
                    ? "bg-emerald-400 text-slate-950"
                    : "border border-slate-300 text-slate-700 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                Knots
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/60">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
              Time Format
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onTimeFormatChange("12h")}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                  timeFormat === "12h"
                    ? "bg-emerald-400 text-slate-950"
                    : "border border-slate-300 text-slate-700 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                12 Hour
              </button>
              <button
                type="button"
                onClick={() => onTimeFormatChange("24h")}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                  timeFormat === "24h"
                    ? "bg-emerald-400 text-slate-950"
                    : "border border-slate-300 text-slate-700 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                24 Hour
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/60">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
              Location Preference
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onUseGpsChange(true)}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                  useGps
                    ? "bg-emerald-400 text-slate-950"
                    : "border border-slate-300 text-slate-700 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                Use GPS
              </button>
              <button
                type="button"
                onClick={() => onUseGpsChange(false)}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                  !useGps
                    ? "bg-emerald-400 text-slate-950"
                    : "border border-slate-300 text-slate-700 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                Manual Search
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              GPS mode auto-detects your launch site when no search is active.
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
