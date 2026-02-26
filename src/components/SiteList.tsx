import type { UIEvent } from "react"
import { Loader2, MapPin } from "lucide-react"

type SiteListItem = {
  id: string
  site_number?: string | null
  site_name?: string | null
  city?: string | null
  state?: string | null
  structure_type?: string | null
  region?: string | null
} & Record<string, unknown>

type SiteListProps = {
  sites: SiteListItem[]
  loading: boolean
  error: string | null
  hasMore: boolean
  loadingMore: boolean
  onSelect: (site: SiteListItem) => void
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  onLoadMore: () => void
}

const getRegionValue = (site: SiteListItem) =>
  (site.state ??
    (typeof site.region === "string" ? site.region : null) ??
    "") as string

export function SiteList({
  sites,
  loading,
  error,
  hasMore,
  loadingMore,
  onSelect,
  onScroll,
  onLoadMore,
}: SiteListProps) {
  return (
    <>
      <div
        className="mt-6 max-h-[420px] overflow-auto rounded-2xl border border-slate-800 bg-slate-950/70"
        onScroll={onScroll}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading sites...
          </div>
        ) : error ? (
          <div className="px-4 py-6 text-center text-xs text-rose-300">
            {error}
          </div>
        ) : sites.length ? (
          <div className="divide-y divide-slate-800">
            {sites.map((site) => (
                <div
                  key={site.id}
                  className="group grid gap-4 px-4 py-4 text-xs text-slate-300 transition hover:bg-slate-900/40 xl:grid-cols-[1.2fr_0.8fr_auto] xl:items-center"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(site)}
                    className="flex min-w-0 flex-col gap-2 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="min-w-0 break-words text-sm font-semibold text-slate-100">
                        {site.site_name ?? "Untitled"}
                      </span>
                    <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-400">
                      {site.site_number ?? "No ID"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-slate-400">
                    <span>{site.city ?? "Unknown city"}</span>
                    <span>{getRegionValue(site) || "Unknown region"}</span>
                    <span>{site.structure_type ?? "Unknown structure"}</span>
                  </div>
                </button>
                  <div className="flex min-w-0 flex-wrap gap-2 text-[11px] text-slate-400">
                  <span className="rounded-full border border-slate-800 px-2 py-1">
                    {site.structure_type ?? "Unclassified"}
                  </span>
                  <span className="rounded-full border border-slate-800 px-2 py-1">
                    {getRegionValue(site) || "No region"}
                  </span>
                </div>
                  <button
                    type="button"
                    onClick={() => onSelect(site)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200 xl:w-auto"
                  >
                  <MapPin className="h-3.5 w-3.5" />
                  View details
                </button>
              </div>
            ))}
            {hasMore && (
              <div className="px-4 py-4 text-center text-xs text-slate-500">
                {loadingMore ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading more sites...
                  </span>
                ) : (
                  "Scroll to load more sites."
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-xs text-slate-500">
            No sites match the current filters.
          </div>
        )}
      </div>
      {hasMore && !loadingMore && !loading ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200"
          >
            Load more
          </button>
        </div>
      ) : null}
    </>
  )
}
