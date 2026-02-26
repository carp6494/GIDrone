import { AviationPanel } from "./AviationPanel"
import type { TfrItem } from "../lib/aviation/types"

type AviationTabProps = {
  lat: number
  lon: number
  onMapTfr?: (item: TfrItem) => void
}

export function AviationTab({ lat, lon, onMapTfr }: AviationTabProps) {
  return <AviationPanel lat={lat} lon={lon} onMapTfr={onMapTfr} />
}
