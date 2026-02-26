import { useEffect, useRef, useState, type ReactNode } from "react"
import { SlidersHorizontal } from "lucide-react"

export type TabBarAlignment = "center" | "left"
export type TabBarSpacing = "even" | "compact"
export type TabBarSize = "normal" | "large"
export type TabBarIcons = "off" | "on"

type TabBarSettingsProps = {
  alignment: TabBarAlignment
  onAlignmentChange: (value: TabBarAlignment) => void
  spacing: TabBarSpacing
  onSpacingChange: (value: TabBarSpacing) => void
  size: TabBarSize
  onSizeChange: (value: TabBarSize) => void
  icons: TabBarIcons
  onIconsChange: (value: TabBarIcons) => void
}

type OptionButtonProps = {
  active: boolean
  children: ReactNode
  onClick: () => void
}

function OptionButton({ active, children, onClick }: OptionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
        active
          ? "border-emerald-400/70 bg-emerald-400/15 text-emerald-200"
          : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
      }`}
    >
      {children}
    </button>
  )
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

export function TabBarSettings({
  alignment,
  onAlignmentChange,
  spacing,
  onSpacingChange,
  size,
  onSizeChange,
  icons,
  onIconsChange,
}: TabBarSettingsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      setIsOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false)
    }

    window.addEventListener("mousedown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("mousedown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/85 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-sm backdrop-blur transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Tab Bar
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label="Tab bar settings"
          className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl shadow-slate-900/10 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 dark:shadow-slate-950/40"
        >
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              Top Tab Bar
            </p>

            <SettingRow label="Alignment">
              <OptionButton active={alignment === "center"} onClick={() => onAlignmentChange("center")}>
                Center
              </OptionButton>
              <OptionButton active={alignment === "left"} onClick={() => onAlignmentChange("left")}>
                Left
              </OptionButton>
            </SettingRow>

            <SettingRow label="Spacing">
              <OptionButton active={spacing === "even"} onClick={() => onSpacingChange("even")}>
                Even
              </OptionButton>
              <OptionButton active={spacing === "compact"} onClick={() => onSpacingChange("compact")}>
                Compact
              </OptionButton>
            </SettingRow>

            <SettingRow label="Size">
              <OptionButton active={size === "normal"} onClick={() => onSizeChange("normal")}>
                Normal
              </OptionButton>
              <OptionButton active={size === "large"} onClick={() => onSizeChange("large")}>
                Large
              </OptionButton>
            </SettingRow>

            <SettingRow label="Show Icons">
              <OptionButton active={icons === "off"} onClick={() => onIconsChange("off")}>
                Off
              </OptionButton>
              <OptionButton active={icons === "on"} onClick={() => onIconsChange("on")}>
                On
              </OptionButton>
            </SettingRow>
          </div>
        </div>
      ) : null}
    </div>
  )
}
