import { useEffect, useRef, useState } from "react"
import { X, Maximize2, Plus, Minus } from "lucide-react"
import mapboxgl from "mapbox-gl"
import { CONFIG } from "../config"

type SitePhotoProps = {
  src?: string | null
  alt: string
  lat?: number | null
  lng?: number | null
}

const BASE_ZOOM = 14

function MiniMap({ lat, lng }: { lat: number; lng: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [zoom, setZoom] = useState(BASE_ZOOM)

  useEffect(() => {
    if (!containerRef.current) return
    mapboxgl.accessToken = CONFIG.mapboxToken

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [lng, lat],
      zoom: BASE_ZOOM,
      minZoom: BASE_ZOOM,
      interactive: false,
      attributionControl: false,
    })

    // Marker matching RadarTab createMarkerElement()
    const el = document.createElement("div")
    el.className =
      "h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-emerald-400/20 shadow-[0_0_6px_rgba(52,211,153,0.8)]"

    new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)

    map.on("zoomend", () => setZoom(map.getZoom()))

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [lat, lng])

  const handleZoom = (dir: 1 | -1) => {
    const map = mapRef.current
    if (!map) return
    const next = map.getZoom() + dir
    if (next < BASE_ZOOM) return
    map.easeTo({ zoom: next, duration: 300 })
  }

  return (
    <div className="relative w-full aspect-video overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />
      {/* Zoom controls */}
      <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => handleZoom(1)}
          className="rounded-md bg-black/60 p-1 text-white transition hover:bg-black/80"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handleZoom(-1)}
          disabled={zoom <= BASE_ZOOM}
          className="rounded-md bg-black/60 p-1 text-white transition hover:bg-black/80 disabled:opacity-30"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

export function SitePhoto({ src, alt, lat, lng }: SitePhotoProps) {
  const [open, setOpen] = useState(false)

  // Fall back to an interactive hybrid map when no photo is available
  if (!src && lat != null && lng != null) {
    return <MiniMap lat={lat} lng={lng} />
  }

  if (!src) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative w-full cursor-pointer overflow-hidden rounded-2xl"
      >
        <img
          src={src}
          alt={alt}
          className="block w-full"
        />
        {/* Enlarge hint on hover */}
        <span className="absolute bottom-2 right-2 z-20 rounded-lg bg-black/60 p-1.5 text-white opacity-0 transition group-hover:opacity-100">
          <Maximize2 className="h-3.5 w-3.5" />
        </span>
      </button>

      {/* Lightbox */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 z-50 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={src}
            alt={alt}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
