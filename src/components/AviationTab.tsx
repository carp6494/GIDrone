import { AviationPanel } from "./AviationPanel"
import type { NotamItem, ObstructionItem, TfrItem } from "../lib/aviation/types"

type AviationTabProps = {
  lat: number
  lon: number
  onMapTfr?: (item: TfrItem) => void
  onMapNotam?: (item: NotamItem) => void
  onMapObstruction?: (item: ObstructionItem) => void
}

export function AviationTab({ lat, lon, onMapTfr, onMapNotam, onMapObstruction }: AviationTabProps) {
  return <AviationPanel lat={lat} lon={lon} onMapTfr={onMapTfr} onMapNotam={onMapNotam} onMapObstruction={onMapObstruction} />
}
