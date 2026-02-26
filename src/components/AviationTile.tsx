import type { ReactNode } from "react"

type AviationTileProps = {
  label: string
  title: string
  rightHeaderSlot?: ReactNode
  children: ReactNode
}

export function AviationTile({ label, title, rightHeaderSlot, children }: AviationTileProps) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4">
      <div className="min-w-0 space-y-2">
        <p className="whitespace-nowrap text-center text-[clamp(0.52rem,0.82vw,0.8rem)] font-semibold uppercase tracking-[0.16em] text-emerald-200">
          {label}
        </p>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h4 className="min-w-0 text-sm font-semibold leading-none tracking-tight text-white">
            {title}
          </h4>
          {rightHeaderSlot ? <div className="shrink-0">{rightHeaderSlot}</div> : null}
        </div>
      </div>

      <div className="mt-4">{children}</div>
    </section>
  )
}
