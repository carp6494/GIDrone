import { AviationPanel } from "./AviationPanel"
import type { NotamItem, TfrItem } from "../lib/aviation/types"

type AviationTabProps = {
  lat: number
  lon: number
  onMapTfr?: (item: TfrItem) => void
  onMapNotam?: (item: NotamItem) => void
}

export function AviationTab({ lat, lon, onMapTfr, onMapNotam }: AviationTabProps) {
  return <AviationPanel lat={lat} lon={lon} onMapTfr={onMapTfr} onMapNotam={onMapNotam} />
}
