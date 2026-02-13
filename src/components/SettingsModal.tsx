type UnitType = "mph" | "kt"
type TimeFormat = "12h" | "24h"

type SettingsModalProps = {
  isOpen: boolean
  unit: UnitType
  onUnitChange: (unit: UnitType) => void
  timeFormat: TimeFormat
  onTimeFormatChange: (format: TimeFormat) => void
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
  useGps,
  onUseGpsChange,
  onClose,
}: SettingsModalProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-950/95 p-6 text-left text-slate-100 shadow-2xl backdrop-blur"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-emerald-300">
              Settings
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Mission Preferences
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-300 transition hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Units
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onUnitChange("mph")}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                  unit === "mph"
                    ? "bg-emerald-400 text-slate-950"
                    : "border border-slate-800 text-slate-300 hover:text-white"
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
                    : "border border-slate-800 text-slate-300 hover:text-white"
                }`}
              >
                Knots
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Time Format
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onTimeFormatChange("12h")}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                  timeFormat === "12h"
                    ? "bg-emerald-400 text-slate-950"
                    : "border border-slate-800 text-slate-300 hover:text-white"
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
                    : "border border-slate-800 text-slate-300 hover:text-white"
                }`}
              >
                24 Hour
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Location Preference
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onUseGpsChange(true)}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                  useGps
                    ? "bg-emerald-400 text-slate-950"
                    : "border border-slate-800 text-slate-300 hover:text-white"
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
                    : "border border-slate-800 text-slate-300 hover:text-white"
                }`}
              >
                Manual Search
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-400">
              GPS mode auto-detects your launch site when no search is active.
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
