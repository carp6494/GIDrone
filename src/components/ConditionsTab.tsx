import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react"
import {
  Activity,
  ChevronDown,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Eye,
  Gauge,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  Moon,
  Settings,
  Sun,
  Sunrise,
  Sunset,
  Wind,
} from "lucide-react"

import {
  fetchCurrentWeather,
  geocodeLocation,
  getKPIndex,
} from "../services/weatherService"
import {
  calculateFlyability,
  DEFAULT_FLYABILITY_THRESHOLDS,
  type FlyabilityStatus,
  type FlyabilityThresholds,
  type MetricThreshold,
  type RangeMetricThreshold,
  type ThresholdDirection,
} from "../utils/FlyabilityEngine"

type UnitType = "mph" | "kt"
type TimeFormat = "12h" | "24h"

type ConditionsTabProps = {
  unit: UnitType
  useGps: boolean
  timeFormat: TimeFormat
  onTabChange: (tab: "conditions" | "radar" | "sites") => void
}

type LocationSelection = {
  name: string
  lat: number
  lon: number
}

type CurrentConditions = {
  locationName: string
  locationCountry?: string | null
  description: string
  tempF: number
  windSpeedMph: number
  windGustMph: number | null
  visibilityMiles: number
  humidity: number
  pressure: number
  precipitationIn: number | null
  hasPrecipitation: boolean
  precipitationType: string | null
  cloudCover: number | null
  uvIndex: number | null
  precipitationProbability: number | null
  kpIndex: number | null
  sunrise?: number
  sunset?: number
}

type WeatherSnapshot = CurrentConditions & {
  current: CurrentConditions
  forecast: ForecastDay[]
  hourly: HourlyWeatherPoint[]
}

type ForecastDay = {
  dt: number
  sunrise: number | null
  sunset: number | null
  tempMaxF: number | null
  tempMinF: number | null
  windSpeedMph: number | null
  precipitationProbability: number | null
  weatherId: number | null
  weatherMain: string | null
  weatherDescription: string | null
}

type HourlyWeatherPoint = {
  dt: number
  tempF: number | null
  windSpeedMph: number | null
  windGustMph: number | null
  visibilityMiles: number | null
  humidity: number | null
  pressure: number | null
  precipitationIn: number | null
  precipitationProbability: number | null
  cloudCover: number | null
  uvIndex: number | null
}

type TrendMetricKey =
  | "temperature"
  | "humidity"
  | "pressure"
  | "windSpeed"
  | "windGust"
  | "visibility"
  | "precipitation"
  | "precipitationProbability"
  | "cloudCover"
  | "uvIndex"
  | "kpIndex"
  | "gpsAccuracy"
  | "twilight"

type MetarEntry = {
  name: string
  code: string
  raw: string
  translated: string
}

type NotamEntry = {
  id: string
  type: string
  validity: string
  description: string
  location: string
}

type TfrEntry = {
  id: string
  radius: string
  altitude: string
  reason: string
  timeframe: string
  location: string
}

const DEFAULT_COORDS = { lat: 29.7604, lon: -95.3698 }
const KNOTS_PER_MPH = 0.868976
const MILES_PER_METER = 0.000621371
const INCHES_PER_MM = 0.0393701
const RECENT_SEARCHES_KEY = "gi-drone.recent-searches"
const THRESHOLDS_STORAGE_KEY = "gi-drone.thresholds"
const MAX_RECENT_SEARCHES = 6

const MOCK_AVIATION_DATA: {
  metars: MetarEntry[]
  notams: NotamEntry[]
  tfrs: TfrEntry[]
} = {
  metars: [
    {
      name: "William P. Hobby",
      code: "KHOU",
      raw: "KHOU 241853Z 16009KT 10SM CLR 24/14 A3002 RMK AO2 SLP162 T02390139",
      translated:
        "Clear skies. Wind from south-southeast at 9 knots. Visibility 10 miles. Temperature 24C (75F), dewpoint 14C. Altimeter 30.02.",
    },
    {
      name: "George Bush Intercontinental",
      code: "KIAH",
      raw: "KIAH 241853Z 15012KT 10SM FEW035 25/15 A3000 RMK AO2 SLP157",
      translated:
        "Few clouds at 3,500 ft. Wind from south-southeast at 12 knots. Visibility 10 miles. Temperature 25C (77F), dewpoint 15C. Altimeter 30.00.",
    },
    {
      name: "Ellington Field",
      code: "KEFD",
      raw: "KEFD 241853Z 17011KT 10SM SCT040 24/16 A3001 RMK AO2",
      translated:
        "Scattered clouds at 4,000 ft. Wind from south at 11 knots. Visibility 10 miles. Temperature 24C (75F), dewpoint 16C. Altimeter 30.01.",
    },
    {
      name: "Sugar Land Regional",
      code: "KSGR",
      raw: "KSGR 241853Z 15008KT 10SM CLR 25/14 A3002 RMK AO2",
      translated:
        "Clear skies. Wind from south-southeast at 8 knots. Visibility 10 miles. Temperature 25C (77F), dewpoint 14C. Altimeter 30.02.",
    },
    {
      name: "Houston Executive",
      code: "KTME",
      raw: "KTME 241853Z 16007KT 10SM FEW040 24/13 A3003 RMK AO2",
      translated:
        "Few clouds at 4,000 ft. Wind from south-southeast at 7 knots. Visibility 10 miles. Temperature 24C (75F), dewpoint 13C. Altimeter 30.03.",
    },
  ],
  notams: [
    {
      id: "A1324/24",
      type: "RWY",
      validity: "241900Z-250500Z",
      description: "RWY 04/22 CLSD due to nightly surface maintenance.",
      location: "Houston, TX",
    },
    {
      id: "A1297/24",
      type: "NAV",
      validity: "240600Z-250600Z",
      description: "ILS RWY 13L GP U/S. LOC operational; use non-precision mins.",
      location: "Spring, TX",
    },
    {
      id: "A1281/24",
      type: "OBST",
      validity: "240000Z-260000Z",
      description: "Temporary crane 2.1 NM NE of field, 310 ft AGL marked/lit.",
      location: "Pasadena, TX",
    },
  ],
  tfrs: [
    {
      id: "ZHU-0421",
      radius: "3 NM",
      altitude: "SFC-2,500 ft",
      reason: "Stadium event restriction",
      timeframe: "241900Z-242300Z",
      location: "Houston, TX",
    },
    {
      id: "ZHU-0418",
      radius: "5 NM",
      altitude: "SFC-4,000 ft",
      reason: "VIP movement",
      timeframe: "250000Z-250400Z",
      location: "Humble, TX",
    },
  ],
}

const mphToKnots = (value: number) => value * KNOTS_PER_MPH

const statusColorMap: Record<FlyabilityStatus, string> = {
  Safe: "bg-emerald-500/20 text-emerald-400 border-emerald-500/50",
  Caution: "bg-yellow-400/20 text-yellow-300 border-yellow-400/50",
  Danger: "bg-red-500/30 text-red-400 border-red-500/60",
}

const forecastCardToneMap: Record<FlyabilityStatus, string> = {
  Safe: "border-emerald-400/50 bg-emerald-500/20 text-emerald-100",
  Caution: "border-yellow-400/60 bg-yellow-400/20 text-yellow-100",
  Danger: "border-red-500/60 bg-red-500/20 text-red-100",
}

const formatValue = (value: number, digits = 1) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value)

const formatForecastDate = (timestamp: number) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp * 1000))

const formatSunTime = (
  timestamp: number | null | undefined,
  timeFormat: TimeFormat
) => {
  if (typeof timestamp !== "number") return "--"
  const date = new Date(timestamp * 1000)
  const options: Intl.DateTimeFormatOptions = {
    hour: timeFormat === "12h" ? "2-digit" : "2-digit",
    minute: "2-digit",
    hour12: true,
  }
  return new Intl.DateTimeFormat("en-US", options).format(date).toLowerCase()
}

const getForecastReferenceTime = (timestamp: number | null | undefined) => {
  if (typeof timestamp !== "number") return undefined
  const date = new Date(timestamp * 1000)
  date.setHours(12, 0, 0, 0)
  return date
}

const resolveForecastTemp = (day: ForecastDay | null, fallbackTemp: number) => {
  if (!day) return fallbackTemp
  if (day.tempMaxF !== null && day.tempMinF !== null) {
    return (day.tempMaxF + day.tempMinF) / 2
  }
  return day.tempMaxF ?? day.tempMinF ?? fallbackTemp
}

const normalizePrecipitationProbability = (value: unknown) => {
  if (typeof value !== "number" || Number.isNaN(value)) return null
  if (value <= 1) return Math.round(value * 100)
  return Math.round(value)
}

const buildWeatherBriefing = ({
  tempF,
  windSpeedMph,
  cloudCover,
  precipitationProbability,
  description,
}: {
  tempF: number
  windSpeedMph: number
  cloudCover: number | null
  precipitationProbability: number | null
  description: string
}) => {
  const tempDescriptor =
    tempF <= 32
      ? "remain below freezing"
      : tempF <= 50
        ? "stay cold"
        : tempF <= 72
          ? "hold in a mild band"
          : tempF <= 85
            ? "trend warm"
            : "run hot"
  const windDescriptor =
    windSpeedMph < 5
      ? "light variable winds"
      : windSpeedMph < 15
        ? "steady surface winds"
        : windSpeedMph < 25
          ? "brisk winds"
          : "strong winds"
  const skyDescriptor = (() => {
    const lowerDescription = description.toLowerCase()
    if (lowerDescription.includes("thunder")) return "unstable visibility"
    if (lowerDescription.includes("snow") || lowerDescription.includes("rain")) {
      return "reduced visibility"
    }
    if (cloudCover === null) return "clear visibility"
    if (cloudCover < 20) return "clear visibility"
    if (cloudCover < 60) return "partial cloud cover"
    return "overcast skies"
  })()
  const precipDescriptor =
    precipitationProbability !== null
      ? precipitationProbability >= 60
        ? "elevated precipitation risk"
        : precipitationProbability >= 30
          ? "moderate precipitation risk"
          : "low precipitation risk"
      : null
  const precipClause = precipDescriptor ? `, ${precipDescriptor}` : ""
  return `Expect ${skyDescriptor} with ${windDescriptor} for current operations; temperatures ${tempDescriptor} near ${Math.round(
    tempF
  )}°F${precipClause}.`
}

const US_STATE_ABBREVIATIONS = new Map<string, string>([
  ["alabama", "AL"],
  ["alaska", "AK"],
  ["arizona", "AZ"],
  ["arkansas", "AR"],
  ["california", "CA"],
  ["colorado", "CO"],
  ["connecticut", "CT"],
  ["delaware", "DE"],
  ["florida", "FL"],
  ["georgia", "GA"],
  ["hawaii", "HI"],
  ["idaho", "ID"],
  ["illinois", "IL"],
  ["indiana", "IN"],
  ["iowa", "IA"],
  ["kansas", "KS"],
  ["kentucky", "KY"],
  ["louisiana", "LA"],
  ["maine", "ME"],
  ["maryland", "MD"],
  ["massachusetts", "MA"],
  ["michigan", "MI"],
  ["minnesota", "MN"],
  ["mississippi", "MS"],
  ["missouri", "MO"],
  ["montana", "MT"],
  ["nebraska", "NE"],
  ["nevada", "NV"],
  ["new hampshire", "NH"],
  ["new jersey", "NJ"],
  ["new mexico", "NM"],
  ["new york", "NY"],
  ["north carolina", "NC"],
  ["north dakota", "ND"],
  ["ohio", "OH"],
  ["oklahoma", "OK"],
  ["oregon", "OR"],
  ["pennsylvania", "PA"],
  ["rhode island", "RI"],
  ["south carolina", "SC"],
  ["south dakota", "SD"],
  ["tennessee", "TN"],
  ["texas", "TX"],
  ["utah", "UT"],
  ["vermont", "VT"],
  ["virginia", "VA"],
  ["washington", "WA"],
  ["west virginia", "WV"],
  ["wisconsin", "WI"],
  ["wyoming", "WY"],
  ["district of columbia", "DC"],
])

const COUNTRY_ABBREVIATIONS = new Map<string, string>([
  ["united states", "USA"],
  ["united states of america", "USA"],
  ["usa", "USA"],
  ["us", "USA"],
  ["canada", "CA"],
  ["ca", "CA"],
  ["mexico", "MX"],
  ["mx", "MX"],
  ["united kingdom", "GB"],
  ["uk", "GB"],
  ["great britain", "GB"],
  ["australia", "AU"],
  ["new zealand", "NZ"],
  ["germany", "DE"],
  ["france", "FR"],
  ["spain", "ES"],
  ["italy", "IT"],
  ["japan", "JP"],
])

const normalizeLocationToken = (value?: string | null) =>
  value?.trim().replace(/\s+/g, " ") ?? ""

const abbreviateState = (state?: string | null) => {
  const normalized = normalizeLocationToken(state)
  if (!normalized) return null
  const upper = normalized.toUpperCase()
  if (upper.length === 2) return upper
  return US_STATE_ABBREVIATIONS.get(normalized.toLowerCase()) ?? upper.slice(0, 2)
}

const abbreviateCountry = (country?: string | null) => {
  const normalized = normalizeLocationToken(country)
  if (!normalized) return null
  const upper = normalized.toUpperCase()
  if (/^[A-Z]{2,3}$/.test(upper)) return upper === "US" ? "USA" : upper
  const mapped = COUNTRY_ABBREVIATIONS.get(normalized.toLowerCase())
  if (mapped) return mapped === "US" ? "USA" : mapped
  return upper.slice(0, 2)
}

const isLikelyCountryToken = (token?: string | null) => {
  const normalized = normalizeLocationToken(token)
  if (!normalized) return false
  const upper = normalized.toUpperCase()
  if (COUNTRY_ABBREVIATIONS.has(normalized.toLowerCase())) return true
  if (/^[A-Z]{2,3}$/.test(upper)) {
    return !US_STATE_ABBREVIATIONS.has(normalized.toLowerCase())
  }
  return false
}

const parseLocationLabel = (label?: string | null) => {
  const normalized = normalizeLocationToken(label)
  if (!normalized) {
    return { city: "Mission Perimeter", state: null, country: null }
  }
  const parts = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return { city: normalized, state: null, country: null }
  }

  if (parts.length === 1) {
    return { city: parts[0], state: null, country: null }
  }

  if (parts.length === 2) {
    const [city, token] = parts
    if (isLikelyCountryToken(token)) {
      return { city, state: null, country: token }
    }
    return { city, state: token, country: null }
  }

  return {
    city: parts[0],
    state: parts[parts.length - 2] ?? null,
    country: parts[parts.length - 1] ?? null,
  }
}

const abbreviateLocation = (
  city?: string | null,
  state?: string | null,
  country?: string | null
) => {
  const normalizedCity = normalizeLocationToken(city)
  if (!normalizedCity) return "Mission Perimeter"
  const stateAbbr = abbreviateState(state)
  const countryAbbr = abbreviateCountry(country)
  const segments = [normalizedCity, stateAbbr, countryAbbr].filter(Boolean)
  return segments.join(", ")
}

const ForecastIcon = ({
  weatherId,
  weatherMain,
  className = "h-6 w-6",
}: {
  weatherId: number | null
  weatherMain: string | null
  className?: string
}) => {
  const id = weatherId ?? 0
  if (id >= 200 && id < 300) {
    return <CloudLightning className={`${className} text-amber-400`} />
  }
  if (id >= 300 && id < 400) {
    return <CloudDrizzle className={`${className} text-sky-400`} />
  }
  if (id >= 500 && id < 600) {
    return <CloudRain className={`${className} text-blue-400`} />
  }
  if (id >= 600 && id < 700) {
    return <CloudSnow className={`${className} text-cyan-200`} />
  }
  if (id >= 700 && id < 800) {
    return <CloudFog className={`${className} text-slate-300`} />
  }
  if (id === 800) {
    return <Sun className={`${className} text-yellow-300`} />
  }
  if (id > 800 && id < 900) {
    return <CloudSun className={`${className} text-amber-200`} />
  }
  const main = weatherMain?.toLowerCase() ?? ""
  if (main.includes("rain")) return <CloudRain className={`${className} text-blue-400`} />
  if (main.includes("snow")) return <CloudSnow className={`${className} text-cyan-200`} />
  if (main.includes("cloud")) return <Cloud className={`${className} text-slate-200`} />
  return <Cloud className={`${className} text-slate-200`} />
}

const ForecastSection = ({
  forecastDays,
  unit,
  liveSnapshot,
  selectedDayIndex,
  onSelectDay,
  userThresholds,
  activeCoords,
}: {
  forecastDays: ForecastDay[]
  unit: UnitType
  liveSnapshot: CurrentConditions
  selectedDayIndex: number | null
  onSelectDay: (index: number | null) => void
  userThresholds: FlyabilityThresholds
  activeCoords: { lat: number; lon: number }
}) => {
  if (forecastDays.length === 0) return null
  return (
    <section className="rounded-3xl border border-slate-800/70 bg-slate-950/60 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
            Forecast Outlook
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">
            {forecastDays.length}-Day Outlook
          </h3>
        </div>
      </div>
      <div className="mt-5 overflow-x-auto">
        <div className="flex min-w-max gap-4 pb-2">
          {forecastDays.map((day, index) => {
            const windSpeed =
              day.windSpeedMph !== null
                ? unit === "kt"
                  ? mphToKnots(day.windSpeedMph)
                  : day.windSpeedMph
                : null
            const forecastTemp = resolveForecastTemp(day, liveSnapshot.tempF)
            const forecastPrecipProbability =
              day.precipitationProbability ?? liveSnapshot.precipitationProbability
            const forecastWeatherMain = day.weatherMain?.toLowerCase() ?? ""
            const hasForecastPrecipitation =
              forecastWeatherMain.includes("rain") ||
              forecastWeatherMain.includes("snow") ||
              forecastWeatherMain.includes("drizzle") ||
              forecastWeatherMain.includes("thunder") ||
              (forecastPrecipProbability !== null && forecastPrecipProbability >= 50)
            const { status: dayStatus, score: dayScore } = calculateFlyability(
              {
                windSpeedMph: day.windSpeedMph ?? liveSnapshot.windSpeedMph,
                visibilityMiles: liveSnapshot.visibilityMiles,
                hasPrecipitation: hasForecastPrecipitation,
                precipitationAmount: null,
                temperatureF: forecastTemp,
                humidity: liveSnapshot.humidity,
                pressure: liveSnapshot.pressure,
                cloudCover: liveSnapshot.cloudCover,
                kpIndex: liveSnapshot.kpIndex,
                uvIndex: liveSnapshot.uvIndex,
                precipitationProbability: forecastPrecipProbability,
                gpsAccuracyMeters: null,
                lat: activeCoords.lat,
                lon: activeCoords.lon,
                sunrise: day.sunrise,
                sunset: day.sunset,
                referenceTime: getForecastReferenceTime(day.dt),
              },
              userThresholds
            )
            const isActive = selectedDayIndex === index
            return (
              <button
                type="button"
                onClick={() =>
                  onSelectDay(selectedDayIndex === index ? null : index)
                }
                key={day.dt}
                className={`relative min-w-[180px] rounded-2xl border p-4 text-left transition ${
                  forecastCardToneMap[dayStatus]
                } ${
                  isActive
                    ? "border-2 border-white/90 ring-2 ring-white/30 shadow-lg"
                    : "hover:-translate-y-0.5"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.3em] text-slate-500">
                      {formatForecastDate(day.dt)}
                    </div>
                    {index === 0 ? (
                      <div className="mt-1 text-[0.6rem] font-bold uppercase tracking-[0.3em] text-emerald-300">
                        LIVE
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <ForecastIcon
                    weatherId={day.weatherId}
                    weatherMain={day.weatherMain}
                    className="h-7 w-7"
                  />
                  <div className="text-sm font-semibold text-white">
                    {day.weatherMain ?? "Clear"}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-300">
                  <div>
                    <p className="text-[0.6rem] uppercase tracking-[0.25em] text-slate-500">
                      High / Low
                    </p>
                    <p className="mt-1 text-sm text-white">
                      {day.tempMaxF !== null
                        ? `${formatValue(day.tempMaxF, 0)}°`
                        : "--"}
                      {" / "}
                      {day.tempMinF !== null
                        ? `${formatValue(day.tempMinF, 0)}°`
                        : "--"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.6rem] uppercase tracking-[0.25em] text-slate-500">
                      Wind
                    </p>
                    <p className="mt-1 text-sm text-white">
                      {windSpeed !== null ? formatValue(windSpeed, 0) : "--"}{" "}
                      {unit}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[0.6rem] uppercase tracking-[0.25em] text-slate-500">
                      Precip
                    </p>
                    <p className="mt-1 text-sm text-white">
                      {day.precipitationProbability !== null
                        ? `${formatValue(day.precipitationProbability, 0)}%`
                        : "--"}
                    </p>
                  </div>
                </div>
                <div className="absolute bottom-3 right-3 text-right">
                  <p className="text-[0.55rem] uppercase tracking-[0.3em] text-slate-400">
                    Score
                  </p>
                  <p className="text-lg font-bold text-white">
                    {formatValue(dayScore, 0)}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

type ThresholdKey = keyof FlyabilityThresholds

type ThresholdDefinition = {
  key: ThresholdKey
  label: string
  unit: string
  direction: ThresholdDirection
  description: string
  mode?: "directional" | "range"
}

const THRESHOLD_DEFINITIONS: Record<ThresholdKey, ThresholdDefinition> = {
  wind: {
    key: "wind",
    label: "Wind Speed",
    unit: "mph",
    direction: "above",
    description: "Higher wind speeds increase flight risk.",
  },
  visibility: {
    key: "visibility",
    label: "Visibility",
    unit: "mi",
    direction: "below",
    description: "Lower visibility reduces safe operating range.",
  },
  precipitation: {
    key: "precipitation",
    label: "Precipitation",
    unit: "in",
    direction: "above",
    description: "Active precipitation reduces visibility and control.",
  },
  humidity: {
    key: "humidity",
    label: "Humidity",
    unit: "%",
    direction: "above",
    description: "High humidity can impact airframe performance.",
  },
  pressure: {
    key: "pressure",
    label: "Pressure",
    unit: "hPa",
    direction: "below",
    description: "Low pressure often signals unstable conditions.",
  },
  temperature: {
    key: "temperature",
    label: "Temperature",
    unit: "°F",
    direction: "above",
    description: "Extreme temperatures can reduce battery efficiency.",
    mode: "range",
  },
  twilight: {
    key: "twilight",
    label: "Twilight Phase",
    unit: "",
    direction: "above",
    description: "Use 0 = Daylight, 1 = Twilight, 2 = Night.",
  },
  kpIndex: {
    key: "kpIndex",
    label: "KP Index",
    unit: "",
    direction: "above",
    description: "Geomagnetic activity affects GPS stability.",
  },
  uvIndex: {
    key: "uvIndex",
    label: "UV Index",
    unit: "",
    direction: "above",
    description: "Higher UV can affect visibility and sensor performance.",
  },
  precipitationProbability: {
    key: "precipitationProbability",
    label: "Precipitation Probability",
    unit: "%",
    direction: "above",
    description: "Higher odds of precipitation reduce mission confidence.",
  },
  gpsAccuracy: {
    key: "gpsAccuracy",
    label: "GPS Accuracy",
    unit: "m",
    direction: "above",
    description: "Higher error radius indicates weaker position lock.",
  },
  cloudCover: {
    key: "cloudCover",
    label: "Cloud Cover",
    unit: "%",
    direction: "above",
    description: "Dense cloud cover can reduce visibility and light.",
  },
}

type TileProps = {
  icon: ReactNode
  label: string
  value: ReactNode
  description: ReactNode
  status: FlyabilityStatus
  labelClassName?: string
  valueClassName?: string
  onClick?: () => void
  onSettingsClick?: () => void
}

const LABEL_ABBREVIATIONS: Record<string, string> = {
  "PRECIPITATION PROBABILITY": "PRECIP PROB",
  "BAROMETRIC PRESSURE": "PRESSURE",
  "GPS ACCURACY": "GPS ACC",
  "ULTRAVIOLET INDEX": "UV Index",
}

const abbreviateLabel = (label: string) =>
  LABEL_ABBREVIATIONS[label.toUpperCase()] ?? label

const Tile = ({
  icon,
  label,
  value,
  description,
  status,
  labelClassName,
  valueClassName,
  onClick,
  onSettingsClick,
}: TileProps) => {
  const statusClasses = statusColorMap[status] ?? statusColorMap.Safe
  const displayLabel = abbreviateLabel(label)
  const resolvedValueClassName =
    valueClassName ?? "text-[clamp(1.1rem,2.5vw,1.8rem)]"
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative min-h-[160px] rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-200/40 cursor-pointer hover:bg-slate-800/40 transition-colors ${statusClasses}`}
    >
      <div className="grid h-full grid-cols-[minmax(0,1fr)_3rem]">
        <div className="flex h-full min-w-0 flex-1 flex-col justify-between">
          <div
            className={`text-[clamp(0.7rem,1.5vw,0.9rem)] font-semibold uppercase tracking-[0.25em] text-slate-100/80 whitespace-normal leading-snug ${
              labelClassName ?? ""
            }`}
          >
            {displayLabel}
          </div>
          <div className={`${resolvedValueClassName} font-semibold text-white`}>
            {value}
          </div>
          <p className="text-[10px] text-slate-200/80">{description}</p>
        </div>
        <div className="w-12 h-full flex-shrink-0 flex flex-col items-center justify-between border-l border-slate-800/30 py-2 text-slate-100/90">
          <div className="flex-shrink-0">{icon}</div>
          {onSettingsClick ? (
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-100/40 transition hover:bg-white/10 hover:text-slate-100/70"
              onClick={(event) => {
                event.stopPropagation()
                onSettingsClick()
              }}
            >
              <Settings className="h-6 w-6" />
            </span>
          ) : null}
        </div>
      </div>
    </button>
  )
}

type ThresholdModalProps = {
  metricKey: ThresholdKey
  definition: ThresholdDefinition
  current?: MetricThreshold
  unitLabel: string
  onSave: (metricKey: ThresholdKey, next: MetricThreshold) => void
  onReset: (metricKey: ThresholdKey) => void
  onClose: () => void
}

const parseThresholdValue = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

const isRangeThreshold = (
  value: MetricThreshold | undefined
): value is RangeMetricThreshold =>
  !!value &&
  ("minSafe" in value ||
    "maxSafe" in value ||
    "minCaution" in value ||
    "maxCaution" in value)

const ThresholdModal = ({
  metricKey,
  definition,
  current,
  unitLabel,
  onSave,
  onReset,
  onClose,
}: ThresholdModalProps) => {
  const isRange = definition.mode === "range"
  const resolveDirection = (value?: MetricThreshold) =>
    value && "direction" in value ? value.direction : definition.direction
  const resolveDirectionalValue = (
    value: MetricThreshold | undefined,
    key: "caution" | "danger"
  ) => {
    if (!value || isRangeThreshold(value)) return ""
    const stored = value[key]
    return stored !== undefined && stored !== null ? String(stored) : ""
  }
  const [direction, setDirection] = useState<ThresholdDirection>(
    resolveDirection(current)
  )
  const [caution, setCaution] = useState(
    resolveDirectionalValue(current, "caution")
  )
  const [danger, setDanger] = useState(
    resolveDirectionalValue(current, "danger")
  )
  const [minSafe, setMinSafe] = useState(
    isRangeThreshold(current) &&
      current.minSafe !== undefined &&
      current.minSafe !== null
      ? String(current.minSafe)
      : ""
  )
  const [maxSafe, setMaxSafe] = useState(
    isRangeThreshold(current) &&
      current.maxSafe !== undefined &&
      current.maxSafe !== null
      ? String(current.maxSafe)
      : ""
  )
  const [minCaution, setMinCaution] = useState(
    isRangeThreshold(current) &&
      current.minCaution !== undefined &&
      current.minCaution !== null
      ? String(current.minCaution)
      : ""
  )
  const [maxCaution, setMaxCaution] = useState(
    isRangeThreshold(current) &&
      current.maxCaution !== undefined &&
      current.maxCaution !== null
      ? String(current.maxCaution)
      : ""
  )

  useEffect(() => {
    setDirection(resolveDirection(current))
    setCaution(resolveDirectionalValue(current, "caution"))
    setDanger(resolveDirectionalValue(current, "danger"))
    setMinSafe(
      isRangeThreshold(current) &&
        current.minSafe !== undefined &&
        current.minSafe !== null
        ? String(current.minSafe)
        : ""
    )
    setMaxSafe(
      isRangeThreshold(current) &&
        current.maxSafe !== undefined &&
        current.maxSafe !== null
        ? String(current.maxSafe)
        : ""
    )
    setMinCaution(
      isRangeThreshold(current) &&
        current.minCaution !== undefined &&
        current.minCaution !== null
        ? String(current.minCaution)
        : ""
    )
    setMaxCaution(
      isRangeThreshold(current) &&
        current.maxCaution !== undefined &&
        current.maxCaution !== null
        ? String(current.maxCaution)
        : ""
    )
  }, [current, definition.direction, metricKey])

  const cautionValue = parseThresholdValue(caution)
  const dangerValue = parseThresholdValue(danger)
  const minSafeValue = parseThresholdValue(minSafe)
  const maxSafeValue = parseThresholdValue(maxSafe)
  const minCautionValue = parseThresholdValue(minCaution)
  const maxCautionValue = parseThresholdValue(maxCaution)

  const summaryParts = isRange
    ? [
        `Safe ${minSafeValue ?? "..."}–${maxSafeValue ?? "..."}${
          unitLabel ? ` ${unitLabel}` : ""
        }`,
        `Caution ${minCautionValue ?? "..."}–${minSafeValue ?? "..."} & ${
          maxSafeValue ?? "..."
        }–${maxCautionValue ?? "..."}${unitLabel ? ` ${unitLabel}` : ""}`,
        `Danger < ${minCautionValue ?? "..."} or > ${
          maxCautionValue ?? "..."
        }${unitLabel ? ` ${unitLabel}` : ""}`,
      ]
    : [
        direction === "above"
          ? `Safe <= ${cautionValue ?? "..."}${
              unitLabel ? ` ${unitLabel}` : ""
            }`
          : `Safe >= ${cautionValue ?? "..."}${
              unitLabel ? ` ${unitLabel}` : ""
            }`,
        `Caution ${cautionValue ?? "..."}–${dangerValue ?? "..."}${
          unitLabel ? ` ${unitLabel}` : ""
        }`,
        direction === "above"
          ? `Danger >= ${dangerValue ?? "..."}${
              unitLabel ? ` ${unitLabel}` : ""
            }`
          : `Danger <= ${dangerValue ?? "..."}${
              unitLabel ? ` ${unitLabel}` : ""
            }`,
      ]

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="w-full max-w-xl rounded-3xl border border-slate-700/70 bg-slate-950 p-6 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-emerald-300">
              Threshold Editor
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">
              {definition.label}
            </h3>
            <p className="mt-2 text-sm text-slate-400">{definition.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300 transition hover:border-slate-200 hover:text-white"
          >
            Close
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (isRange) {
              onSave(metricKey, {
                minSafe: minSafeValue,
                maxSafe: maxSafeValue,
                minCaution: minCautionValue,
                maxCaution: maxCautionValue,
              })
            } else {
              onSave(metricKey, {
                direction,
                caution: cautionValue,
                danger: dangerValue,
              })
            }
          }}
          className="mt-6 space-y-4"
        >
          {isRange ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-slate-200">
                <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  Min Safe {unitLabel ? `(${unitLabel})` : ""}
                </span>
                <input
                  type="number"
                  value={minSafe}
                  onChange={(event) => setMinSafe(event.target.value)}
                  placeholder={
                    isRangeThreshold(current) &&
                    current.minSafe !== undefined &&
                    current.minSafe !== null
                      ? String(current.minSafe)
                      : ""
                  }
                  className="h-11 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                />
              </label>
              <label className="space-y-2 text-sm text-slate-200">
                <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  Max Safe {unitLabel ? `(${unitLabel})` : ""}
                </span>
                <input
                  type="number"
                  value={maxSafe}
                  onChange={(event) => setMaxSafe(event.target.value)}
                  placeholder={
                    isRangeThreshold(current) &&
                    current.maxSafe !== undefined &&
                    current.maxSafe !== null
                      ? String(current.maxSafe)
                      : ""
                  }
                  className="h-11 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                />
              </label>
              <label className="space-y-2 text-sm text-slate-200">
                <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  Min Caution {unitLabel ? `(${unitLabel})` : ""}
                </span>
                <input
                  type="number"
                  value={minCaution}
                  onChange={(event) => setMinCaution(event.target.value)}
                  placeholder={
                    isRangeThreshold(current) &&
                    current.minCaution !== undefined &&
                    current.minCaution !== null
                      ? String(current.minCaution)
                      : ""
                  }
                  className="h-11 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                />
              </label>
              <label className="space-y-2 text-sm text-slate-200">
                <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  Max Caution {unitLabel ? `(${unitLabel})` : ""}
                </span>
                <input
                  type="number"
                  value={maxCaution}
                  onChange={(event) => setMaxCaution(event.target.value)}
                  placeholder={
                    isRangeThreshold(current) &&
                    current.maxCaution !== undefined &&
                    current.maxCaution !== null
                      ? String(current.maxCaution)
                      : ""
                  }
                  className="h-11 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                />
              </label>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Caution Threshold {unitLabel ? `(${unitLabel})` : ""}
                  </span>
                    <input
                      type="number"
                      value={caution}
                      onChange={(event) => setCaution(event.target.value)}
                      placeholder={resolveDirectionalValue(current, "caution")}
                      className="h-11 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                    />
                  </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Danger Threshold {unitLabel ? `(${unitLabel})` : ""}
                  </span>
                    <input
                      type="number"
                      value={danger}
                      onChange={(event) => setDanger(event.target.value)}
                      placeholder={resolveDirectionalValue(current, "danger")}
                      className="h-11 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                    />
                  </label>
              </div>

              <label className="space-y-2 text-sm text-slate-200">
                <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  Direction
                </span>
                <select
                  value={direction}
                  onChange={(event) =>
                    setDirection(event.target.value as ThresholdDirection)
                  }
                  className="h-11 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                >
                  <option value="above">Higher values are worse</option>
                  <option value="below">Lower values are worse</option>
                </select>
              </label>
            </>
          )}

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-xs uppercase tracking-[0.3em] text-slate-400">
            <p className="text-slate-300">Range preview</p>
            <p className="mt-2 text-[11px] text-slate-400">{summaryParts[0]}</p>
            <p className="mt-1 text-[11px] text-slate-400">{summaryParts[1]}</p>
            <p className="mt-1 text-[11px] text-slate-400">{summaryParts[2]}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => onReset(metricKey)}
              className="rounded-2xl border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300 transition hover:border-slate-200 hover:text-white"
            >
              Reset to defaults
            </button>
            <button
              type="submit"
              className="rounded-2xl border border-emerald-400/50 bg-emerald-400/10 px-6 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100 transition hover:border-emerald-300 hover:text-white"
            >
              Save thresholds
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

type TrendModalProps = {
  title: string
  unitLabel: string
  values: { dt: number; value: number | null }[]
  timeFormat: TimeFormat
  onClose: () => void
  metricKey: TrendMetricKey
  sunrise?: number | null
  sunset?: number | null
}

const formatHourLabel = (timestamp: number, timeFormat: TimeFormat) => {
  const date = new Date(timestamp * 1000)
  const options: Intl.DateTimeFormatOptions = {
    hour: timeFormat === "12h" ? "numeric" : "2-digit",
    hour12: timeFormat === "12h",
  }
  if (timeFormat !== "12h") {
    options.minute = "2-digit"
  }
  return new Intl.DateTimeFormat("en-US", options).format(date)
}

const buildLinePath = (
  points: Array<{ x: number; y: number } | null>
) => {
  let path = ""
  for (const point of points) {
    if (!point) continue
    if (!path) {
      path = `M ${point.x} ${point.y}`
    } else {
      path += ` L ${point.x} ${point.y}`
    }
  }
  return path
}

const buildHourlySeries = (
  values: { dt: number; value: number | null }[],
  hours: number
) => {
  const sorted = values
    .filter((entry) => typeof entry.dt === "number")
    .sort((a, b) => a.dt - b.dt)
  if (sorted.length === 0) return []
  const numericEntries = sorted.filter(
    (entry) => typeof entry.value === "number" && Number.isFinite(entry.value)
  ) as Array<{ dt: number; value: number }>
  const start = sorted[0].dt
  let numericIndex = 0
  const series: { dt: number; value: number | null }[] = []

  for (let hourIndex = 0; hourIndex < hours; hourIndex += 1) {
    const targetDt = start + hourIndex * 3600
    while (
      numericIndex < numericEntries.length &&
      numericEntries[numericIndex].dt < targetDt
    ) {
      numericIndex += 1
    }
    const next = numericEntries[numericIndex] ?? null
    const prev = numericIndex > 0 ? numericEntries[numericIndex - 1] : null
    if (prev && prev.dt === targetDt) {
      series.push({ dt: targetDt, value: prev.value })
      continue
    }
    if (next && next.dt === targetDt) {
      series.push({ dt: targetDt, value: next.value })
      continue
    }
    if (!prev || !next) {
      series.push({ dt: targetDt, value: null })
      continue
    }
    const span = next.dt - prev.dt
    if (span <= 0) {
      series.push({ dt: targetDt, value: prev.value })
      continue
    }
    const ratio = (targetDt - prev.dt) / span
    const interpolated = prev.value + (next.value - prev.value) * ratio
    series.push({ dt: targetDt, value: interpolated })
  }
  return series
}

type SolarArchGraphProps = {
  sunrise: number | null | undefined
  sunset: number | null | undefined
  timeFormat: TimeFormat
}

const SolarArchGraph = ({ sunrise, sunset, timeFormat }: SolarArchGraphProps) => {
  if (typeof sunrise !== "number" || typeof sunset !== "number") {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center text-sm text-slate-400">
        <div className="rounded-full border border-slate-700/70 bg-slate-900/60 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-300">
          No solar timing
        </div>
        <p>Sunrise and sunset data are unavailable for this day.</p>
      </div>
    )
  }

  const width = 560
  const height = 240
  const padding = { left: 48, right: 24, top: 24, bottom: 36 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const baselineY = padding.top + plotHeight
  const peakY = padding.top + 18
  const twilightOffset = 30 * 60
  const solarNoon = (sunrise + sunset) / 2
  const viewStart = solarNoon - 8 * 3600
  const viewEnd = solarNoon + 8 * 3600
  const viewRangeSeconds = viewEnd - viewStart
  const clampSeconds = (timestamp: number) =>
    Math.min(Math.max(timestamp, viewStart), viewEnd)
  const toX = (timestamp: number) =>
    padding.left +
    ((clampSeconds(timestamp) - viewStart) / viewRangeSeconds) * plotWidth
  const getX = toX

  const twilightStart = sunrise - twilightOffset
  const twilightEnd = sunset + twilightOffset
  const sunriseX = toX(sunrise)
  const sunsetX = toX(sunset)
  const twilightStartX = toX(twilightStart)
  const twilightEndX = toX(twilightEnd)
  const solarNoonX = toX(solarNoon)
  const archPath = `M ${sunriseX} ${baselineY} Q ${solarNoonX} ${peakY} ${sunsetX} ${baselineY}`

  const labels = [
    {
      label: "Start Twi.",
      time: formatSunTime(twilightStart, timeFormat),
      actualX: twilightStartX,
    },
    {
      label: "Sunrise",
      time: formatSunTime(sunrise, timeFormat),
      actualX: sunriseX,
    },
    {
      label: "Sunset",
      time: formatSunTime(sunset, timeFormat),
      actualX: sunsetX,
    },
    {
      label: "End Twi.",
      time: formatSunTime(twilightEnd, timeFormat),
      actualX: twilightEndX,
    },
  ]
  const labelSlots: Array<
    typeof labels[number] & { labelX: number; textAnchor: "start" | "middle" | "end" }
  > = labels.map((entry, index) => ({
    ...entry,
    labelX:
      entry.label === "Start Twi."
        ? entry.actualX
        : entry.label === "Sunrise"
          ? getX(sunrise)
          : entry.label === "Sunset"
            ? getX(sunset)
            : entry.label === "End Twi."
              ? getX(twilightEnd)
              : padding.left + plotWidth * ((index * 2 + 1) / 8),
    textAnchor:
      entry.label === "Start Twi."
        ? "end"
        : entry.label === "Sunrise"
          ? "start"
          : entry.label === "Sunset"
            ? "end"
            : entry.label === "End Twi."
              ? "end"
              : "middle",
  }))
  const labelOffset = 12
  const labelBaseY = height - 30 + labelOffset
  const timeBaseY = height - 16 + labelOffset
  const viewBoxHeight = height + labelOffset

  return (
    <svg
      viewBox={`0 0 ${width} ${viewBoxHeight}`}
      className="h-auto w-full"
      role="img"
      aria-label="Twilight solar arch"
    >
      <defs>
        <linearGradient id="nightGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0f172a" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#4c1d24" stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id="twilightGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.18" />
        </linearGradient>
        <linearGradient id="dayGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id="archGlow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.7" />
          <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0.75" />
        </linearGradient>
        <filter
          id="archSoftGlow"
          x="-20%"
          y="-40%"
          width="140%"
          height="180%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect
        x={padding.left}
        y={padding.top}
        width={plotWidth}
        height={plotHeight}
        rx="12"
        fill="#0f172a"
        stroke="#1f2937"
        strokeDasharray="6 6"
      />

      <rect
        x={padding.left}
        y={padding.top}
        width={Math.max(0, twilightStartX - padding.left)}
        height={plotHeight}
        fill="url(#nightGradient)"
        opacity="0.75"
      />
      <rect
        x={twilightStartX}
        y={padding.top}
        width={Math.max(0, sunriseX - twilightStartX)}
        height={plotHeight}
        fill="url(#twilightGradient)"
      />
      <rect
        x={sunriseX}
        y={padding.top}
        width={Math.max(0, sunsetX - sunriseX)}
        height={plotHeight}
        fill="url(#dayGradient)"
      />
      <rect
        x={sunsetX}
        y={padding.top}
        width={Math.max(0, twilightEndX - sunsetX)}
        height={plotHeight}
        fill="url(#twilightGradient)"
      />
      <rect
        x={twilightEndX}
        y={padding.top}
        width={Math.max(0, padding.left + plotWidth - twilightEndX)}
        height={plotHeight}
        fill="url(#nightGradient)"
        opacity="0.75"
      />

      <line
        x1={padding.left}
        x2={padding.left + plotWidth}
        y1={baselineY}
        y2={baselineY}
        stroke="#1e293b"
        strokeWidth="1.5"
      />

      <path
        d={archPath}
        fill="none"
        stroke="url(#archGlow)"
        strokeWidth="8"
        strokeOpacity="0.35"
        filter="url(#archSoftGlow)"
      />
      <path
        d={archPath}
        fill="none"
        stroke="url(#archGlow)"
        strokeWidth="4.5"
      />

      {labelSlots.map((entry) => (
        <line
          key={`${entry.label}-tick`}
          x1={entry.actualX}
          x2={entry.actualX}
          y1={baselineY}
          y2={baselineY - 6}
          stroke="#64748b"
          strokeOpacity="0.35"
          strokeWidth="1"
        />
      ))}

      {labelSlots.map((entry) => {
        const labelY = labelBaseY
        const timeY = timeBaseY
        return (
          <g key={entry.label}>
            <text
              x={entry.labelX}
              textAnchor={entry.textAnchor}
              className="fill-slate-300 text-[10px] font-semibold"
            >
              <tspan x={entry.labelX} y={labelY}>
                {entry.label}
              </tspan>
              <tspan
                x={entry.labelX}
                y={timeY}
                className="fill-slate-400 text-[9px] font-medium"
              >
                {entry.time}
              </tspan>
            </text>
          </g>
        )
      })}
    </svg>
  )
}

const TrendModal = ({
  title,
  unitLabel,
  values,
  timeFormat,
  onClose,
  metricKey,
  sunrise,
  sunset,
}: TrendModalProps) => {
  const isTwilightMetric = metricKey === "twilight"
  const chartValues = buildHourlySeries(values, 24)
  const numericValues = chartValues
    .map((entry) => entry.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  const hasData = numericValues.length >= 2
  const minValue = hasData ? Math.min(...numericValues) : 0
  const maxValue = hasData ? Math.max(...numericValues) : 1
  const range = Math.max(0.1, maxValue - minValue)
  let paddedMin = minValue - range * 0.25
  let paddedMax = maxValue + range * 0.25

  if (
    metricKey === "humidity" ||
    metricKey === "precipitationProbability" ||
    metricKey === "cloudCover"
  ) {
    paddedMin = Math.max(0, paddedMin)
    paddedMax = Math.min(100, paddedMax)
  }

  const paddedRange = Math.max(0.1, paddedMax - paddedMin)

  const width = 560
  const height = 240
  const padding = { left: 56, right: 24, top: 24, bottom: 36 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const xStep = chartValues.length > 1 ? plotWidth / (chartValues.length - 1) : 0
  const points = chartValues.map((entry, index) => {
    if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) return null
    const x = padding.left + index * xStep
    const normalized = (entry.value - paddedMin) / paddedRange
    const y = padding.top + (1 - normalized) * plotHeight
    return { x, y }
  })
  const linePath = buildLinePath(points)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const yTicks = [paddedMax, (paddedMin + paddedMax) / 2, paddedMin]
  const xTickIndexes = [0, 6, 12, 18, chartValues.length - 1].filter(
    (index, position, self) =>
      index >= 0 && index < chartValues.length && self.indexOf(index) === position
  )

  const formatAxisValue = (value: number) => {
    if (!Number.isFinite(value)) return "--"
    const digits = Math.abs(value) >= 100 ? 0 : 1
    return formatValue(value, digits)
  }

  const handleMouseMove = (event: ReactMouseEvent<SVGRectElement>) => {
    const svg = svgRef.current
    if (!svg || chartValues.length === 0 || xStep === 0) return
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0) return
    const clientX = event.clientX - rect.left
    const scaledX = (clientX / rect.width) * width
    const clampedX = Math.min(
      Math.max(scaledX, padding.left),
      padding.left + plotWidth
    )
    const nextIndex = Math.min(
      Math.max(Math.round((clampedX - padding.left) / xStep), 0),
      chartValues.length - 1
    )
    setHoverIndex(nextIndex)
  }

  const hoverEntry = hoverIndex !== null ? chartValues[hoverIndex] : null
  const hoverX = hoverIndex !== null ? padding.left + hoverIndex * xStep : null
  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null
  const hoverY =
    hoverPoint?.y ?? padding.top + plotHeight / 2
  const tooltipWidth = 132
  const tooltipHeight = 46
  const tooltipX =
    hoverX !== null
      ? Math.min(
          Math.max(hoverX - tooltipWidth / 2, padding.left),
          padding.left + plotWidth - tooltipWidth
        )
      : padding.left
  const preferredTooltipY =
    hoverY - tooltipHeight - 10 < padding.top
      ? hoverY + 12
      : hoverY - tooltipHeight - 10
  const tooltipY = Math.min(
    Math.max(preferredTooltipY, padding.top),
    padding.top + plotHeight - tooltipHeight
  )
  const tooltipValue =
    hoverEntry && typeof hoverEntry.value === "number" && Number.isFinite(hoverEntry.value)
      ? `${formatAxisValue(hoverEntry.value)}${unitLabel ? ` ${unitLabel}` : ""}`
      : "--"
  const tooltipTime = hoverEntry?.dt
    ? formatHourLabel(hoverEntry.dt, timeFormat)
    : "--"

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="w-full max-w-3xl rounded-3xl border border-slate-700/70 bg-slate-950 p-6 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-emerald-300">
              Trend Monitor
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{title}</h3>
            <p className="mt-2 text-sm text-slate-400">
              24-hour telemetry sweep {unitLabel ? `(${unitLabel})` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300 transition hover:border-slate-200 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-6 rounded-3xl border border-slate-800/70 bg-gradient-to-br from-slate-950 via-slate-900/80 to-slate-950/90 p-4">
          {isTwilightMetric ? (
            <SolarArchGraph
              sunrise={sunrise ?? null}
              sunset={sunset ?? null}
              timeFormat={timeFormat}
            />
          ) : hasData ? (
            <svg
              viewBox={`0 0 ${width} ${height}`}
              ref={svgRef}
              className="h-auto w-full"
              role="img"
              aria-label={`${title} hourly trend`}
            >
              <defs>
                <linearGradient id="trendLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
                  <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.45" />
                </linearGradient>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
                </linearGradient>
              </defs>

              <rect
                x={padding.left}
                y={padding.top}
                width={plotWidth}
                height={plotHeight}
                fill="none"
                stroke="#1f2937"
                strokeDasharray="6 6"
                rx="12"
              />

              {yTicks.map((tick) => {
                const normalized = (tick - paddedMin) / paddedRange
                const y = padding.top + (1 - normalized) * plotHeight
                return (
                  <g key={tick}>
                    <line
                      x1={padding.left}
                      x2={padding.left + plotWidth}
                      y1={y}
                      y2={y}
                      stroke="#1e293b"
                      strokeDasharray="4 6"
                    />
                    <text
                      x={padding.left - 12}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-slate-400 text-[11px]"
                    >
                      {formatAxisValue(tick)}
                    </text>
                  </g>
                )
              })}

              <path
                d={`${linePath} L ${padding.left + plotWidth} ${
                  padding.top + plotHeight
                } L ${padding.left} ${padding.top + plotHeight} Z`}
                fill="url(#trendFill)"
                opacity="0.8"
              />
              <path
                d={linePath}
                fill="none"
                stroke="url(#trendLine)"
                strokeWidth="3"
              />

              {points.map((point, index) =>
                point ? (
                  <circle
                    key={`${point.x}-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r="3.5"
                    fill="#f8fafc"
                    stroke="#0f172a"
                    strokeWidth="1.5"
                  />
                ) : null
              )}

              {hoverIndex !== null && hoverX !== null && (
                <g pointerEvents="none">
                  <line
                    x1={hoverX}
                    x2={hoverX}
                    y1={padding.top}
                    y2={padding.top + plotHeight}
                    stroke="#38bdf8"
                    strokeWidth="1.5"
                    strokeDasharray="4 6"
                  />
                  <g transform={`translate(${tooltipX} ${tooltipY})`}>
                    <rect
                      width={tooltipWidth}
                      height={tooltipHeight}
                      rx="10"
                      fill="#0f172a"
                      stroke="#1f2937"
                      strokeWidth="1"
                    />
                    <text
                      x={tooltipWidth / 2}
                      y={18}
                      textAnchor="middle"
                      className="fill-slate-100 text-[12px] font-semibold"
                    >
                      {tooltipValue}
                    </text>
                    <text
                      x={tooltipWidth / 2}
                      y={34}
                      textAnchor="middle"
                      className="fill-slate-400 text-[11px]"
                    >
                      {tooltipTime}
                    </text>
                  </g>
                </g>
              )}

              {xTickIndexes.map((index) => {
                const entry = chartValues[index]
                const x = padding.left + index * xStep
                return (
                  <text
                    key={index}
                    x={x}
                    y={height - 8}
                    textAnchor="middle"
                    className="fill-slate-400 text-[11px]"
                  >
                    {entry?.dt ? formatHourLabel(entry.dt, timeFormat) : "--"}
                  </text>
                )
              })}

              <rect
                x={padding.left}
                y={padding.top}
                width={plotWidth}
                height={plotHeight}
                fill="transparent"
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHoverIndex(null)}
              />
            </svg>
          ) : (
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center text-sm text-slate-400">
              <div className="rounded-full border border-slate-700/70 bg-slate-900/60 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-300">
                No hourly telemetry
              </div>
              <p>Hourly data is unavailable for this metric.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type MetarModalProps = {
  locationLabel: string
  metars: MetarEntry[]
  onClose: () => void
}

const MetarModal = ({ locationLabel, metars, onClose }: MetarModalProps) => {
  const [translatedView, setTranslatedView] = useState<Record<string, boolean>>({})

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="w-full max-w-3xl rounded-3xl border border-slate-800/80 bg-slate-950/95 p-6 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200">
              METAR
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              {locationLabel} Area
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Multi-airport surface observations
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300 transition hover:border-slate-200 hover:text-white"
          >
            Close
          </button>
        </div>
        <div className="mt-5 max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {metars.map((entry) => {
            const isTranslated = Boolean(translatedView[entry.code])
            return (
              <div
                key={entry.code}
                className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{entry.name}</p>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                      {entry.code}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setTranslatedView((prev) => ({
                        ...prev,
                        [entry.code]: !prev[entry.code],
                      }))
                    }
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] transition ${
                      isTranslated
                        ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
                        : "border-slate-700 text-slate-300 hover:border-slate-400 hover:text-white"
                    }`}
                  >
                    {isTranslated ? "Translated" : "Translate"}
                  </button>
                </div>
                <div
                  className={`mt-3 rounded-xl border border-slate-800/80 px-4 py-3 text-xs ${
                    isTranslated
                      ? "bg-slate-900/60 text-slate-200"
                      : "bg-slate-950/70 font-mono text-slate-200"
                  }`}
                >
                  {isTranslated ? entry.translated : entry.raw}
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-4 text-xs text-slate-500">Mock data for layout validation.</p>
      </div>
    </div>
  )
}

type NotamModalProps = {
  locationLabel: string
  notams: NotamEntry[]
  onClose: () => void
  onViewOnMap: (notam: NotamEntry) => void
}

const NotamModal = ({
  locationLabel,
  notams,
  onClose,
  onViewOnMap,
}: NotamModalProps) => (
  <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4">
    <div className="w-full max-w-3xl rounded-3xl border border-slate-800/80 bg-slate-950/95 p-6 shadow-2xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200">
            NOTAM
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            {locationLabel} Advisory Log
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            Active notices to air missions
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300 transition hover:border-slate-200 hover:text-white"
        >
          Close
        </button>
      </div>
      <div className="mt-5 max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-800/80">
        <table className="w-full text-left text-xs text-slate-200">
          <thead className="bg-slate-900/80 text-[11px] uppercase tracking-[0.25em] text-slate-400">
            <tr>
              <th className="px-4 py-3 font-semibold">ID</th>
              <th className="px-4 py-3 font-semibold">Location</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Validity</th>
              <th className="px-4 py-3 font-semibold">Description</th>
              <th className="px-4 py-3 text-right font-semibold">Map</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 bg-slate-950/60">
            {notams.map((notam) => (
              <tr key={notam.id}>
                <td className="px-4 py-3 font-semibold text-white">{notam.id}</td>
                <td className="px-4 py-3 text-slate-200">{notam.location}</td>
                <td className="px-4 py-3 text-emerald-200">{notam.type}</td>
                <td className="px-4 py-3 text-slate-300">{notam.validity}</td>
                <td className="px-4 py-3 text-slate-200">{notam.description}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onViewOnMap(notam)}
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-400/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-200 hover:text-white"
                  >
                    <MapIcon className="h-3 w-3" />
                    Map
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-slate-500">Mock data for layout validation.</p>
    </div>
  </div>
)

type TfrModalProps = {
  locationLabel: string
  tfrs: TfrEntry[]
  onClose: () => void
  onViewOnMap: (tfr: TfrEntry) => void
}

const TfrModal = ({
  locationLabel,
  tfrs,
  onClose,
  onViewOnMap,
}: TfrModalProps) => (
  <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4">
    <div className="w-full max-w-3xl rounded-3xl border border-slate-800/80 bg-slate-950/95 p-6 shadow-2xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-200">
            TFR
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            {locationLabel} Airspace Locks
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            Temporary flight restrictions
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300 transition hover:border-slate-200 hover:text-white"
        >
          Close
        </button>
      </div>
      <div className="mt-5 max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-800/80">
        <table className="w-full text-left text-xs text-slate-200">
          <thead className="bg-slate-900/80 text-[11px] uppercase tracking-[0.25em] text-slate-400">
            <tr>
              <th className="px-4 py-3 font-semibold">ID</th>
              <th className="px-4 py-3 font-semibold">Location</th>
              <th className="px-4 py-3 font-semibold">Radius</th>
              <th className="px-4 py-3 font-semibold">Altitude</th>
              <th className="px-4 py-3 font-semibold">Reason</th>
              <th className="px-4 py-3 font-semibold">Timeframe</th>
              <th className="px-4 py-3 text-right font-semibold">Map</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 bg-slate-950/60">
            {tfrs.map((tfr) => (
              <tr key={tfr.id}>
                <td className="px-4 py-3 font-semibold text-white">{tfr.id}</td>
                <td className="px-4 py-3 text-slate-200">{tfr.location}</td>
                <td className="px-4 py-3 text-amber-200">{tfr.radius}</td>
                <td className="px-4 py-3 text-slate-300">{tfr.altitude}</td>
                <td className="px-4 py-3 text-slate-200">{tfr.reason}</td>
                <td className="px-4 py-3 text-slate-300">{tfr.timeframe}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onViewOnMap(tfr)}
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-400/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-200 hover:text-white"
                  >
                    <MapIcon className="h-3 w-3" />
                    Map
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-slate-500">Mock data for layout validation.</p>
    </div>
  </div>
)

export function ConditionsTab({
  unit,
  useGps,
  timeFormat,
  onTabChange,
}: ConditionsTabProps) {
  const [coords, setCoords] = useState(DEFAULT_COORDS)
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null)
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "error">(
    "idle"
  )
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchSelection, setSearchSelection] = useState<LocationSelection | null>(
    null
  )
  const [locateStatus, setLocateStatus] = useState<"idle" | "loading" | "error">(
    "idle"
  )
  const [locateError, setLocateError] = useState<string | null>(null)
  const [locationRevision, setLocationRevision] = useState(0)
  const [recentSearches, setRecentSearches] = useState<LocationSelection[]>([])
  const [thresholdOverrides, setThresholdOverrides] = useState<FlyabilityThresholds>(
    {}
  )
  const [activeThresholdKey, setActiveThresholdKey] =
    useState<ThresholdKey | null>(null)
  const [showTrendModal, setShowTrendModal] = useState(false)
  const [selectedTrendMetric, setSelectedTrendMetric] =
    useState<TrendMetricKey | null>(null)
  const [showMetar, setShowMetar] = useState(false)
  const [showNotams, setShowNotams] = useState(false)
  const [showTfrs, setShowTfrs] = useState(false)
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null)
  const locationsMenuRef = useRef<HTMLDetailsElement | null>(null)

  const activeCoords = searchSelection
    ? { lat: searchSelection.lat, lon: searchSelection.lon }
    : useGps
      ? coords
      : DEFAULT_COORDS
  const activeGpsAccuracy = searchSelection || !useGps ? null : gpsAccuracy

  const requestGpsLocation = () =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported on this device."))
        return
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      })
    })

  useEffect(() => {
    if (!useGps) return
    handleLocateMe()
  }, [useGps])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const stored = window.localStorage.getItem(RECENT_SEARCHES_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        setRecentSearches(
          parsed.filter(
            (item) =>
              item &&
              typeof item.name === "string" &&
              typeof item.lat === "number" &&
              typeof item.lon === "number"
          )
        )
      }
    } catch {
      setRecentSearches([])
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const stored = window.localStorage.getItem(THRESHOLDS_STORAGE_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored)
      if (parsed && typeof parsed === "object") {
        setThresholdOverrides(parsed as FlyabilityThresholds)
      }
    } catch {
      setThresholdOverrides({})
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(
      THRESHOLDS_STORAGE_KEY,
      JSON.stringify(thresholdOverrides)
    )
  }, [thresholdOverrides])

  useEffect(() => {
    if (!searchSelection) return
    setRecentSearches((prev) => {
      const next = [
        searchSelection,
        ...prev.filter(
          (item) =>
            item.name !== searchSelection.name ||
            item.lat !== searchSelection.lat ||
            item.lon !== searchSelection.lon
        ),
      ].slice(0, MAX_RECENT_SEARCHES)
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next))
      }
      return next
    })
  }, [searchSelection])

  useEffect(() => {
    if (!weather) return
    setSelectedDayIndex(null)
  }, [weather?.locationName, weather?.forecast?.length])

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = searchQuery.trim()
    if (!trimmed) {
      setSearchSelection(null)
      setSearchError(null)
      setSearchStatus("idle")
      setLocateError(null)
      return
    }

    try {
      setSearchStatus("loading")
      setSearchError(null)
      setLocateError(null)
      const result = await geocodeLocation({
        query: trimmed,
      })
      if (!result) {
        throw new Error("City or ZIP not found. Check spelling and try again.")
      }
      setSearchQuery(result.name)
      setSearchSelection(result)
      setSearchStatus("idle")
      setLocationRevision((value) => value + 1)
    } catch (error) {
      setSearchStatus("error")
      setSearchError(
        error instanceof Error ? error.message : "Unable to resolve location."
      )
    }
  }

  const handleLocateMe = async () => {
    setSearchQuery("")
    setSearchSelection(null)
    setSearchError(null)
    setSearchStatus("idle")
    setLocateStatus("loading")
    setLocateError(null)

    try {
      const position = await requestGpsLocation()
      setCoords({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      })
      setGpsAccuracy(position.coords.accuracy ?? null)
      setLocateStatus("idle")
      setLocationRevision((value) => value + 1)
    } catch (error) {
      setGpsAccuracy(null)
      setLocateStatus("error")
      if (error && typeof error === "object" && "code" in error) {
        const geoError = error as GeolocationPositionError
        if (geoError.code === geoError.PERMISSION_DENIED) {
          setLocateError(
            "Location access was denied. Enable GPS permission to use GPS enabled features."
          )
          return
        }
        if (geoError.code === geoError.POSITION_UNAVAILABLE) {
          setLocateError("Unable to determine your location. Try again soon.")
          return
        }
        if (geoError.code === geoError.TIMEOUT) {
          setLocateError("Location request timed out. Please retry.")
          return
        }
      }
      setLocateError("Unable to retrieve GPS location. Please try again.")
    }
  }

  const handleRecentSearchSelect = (selection: LocationSelection) => {
    setSearchQuery(selection.name)
    setSearchSelection(selection)
    setSearchError(null)
    setSearchStatus("idle")
    setLocateError(null)
    setLocationRevision((value) => value + 1)
    locationsMenuRef.current?.removeAttribute("open")
  }

  useEffect(() => {
    const loadWeather = async () => {
      try {
        setStatus("loading")
        setErrorMessage(null)
        const kpIndexPromise = getKPIndex().catch(() => null)
        const response = await fetchCurrentWeather({
          lat: activeCoords.lat,
          lon: activeCoords.lon,
        })
        const kpIndex = await kpIndexPromise

        const precipitationMm =
          typeof response?.precipitation === "number" ? response.precipitation : null
        const precipitationIn =
          precipitationMm !== null ? precipitationMm * INCHES_PER_MM : null
        const description =
          response?.weatherDescription ?? response?.weather?.[0]?.description ?? "Clear"
        const weatherMain = String(response?.weather?.[0]?.main ?? "").toLowerCase()
        const precipitationTypeRaw =
          response?.precipitationType ?? response?.weather?.[0]?.main ?? null
        const precipitationType = precipitationTypeRaw
          ? String(precipitationTypeRaw)
          : null
        const forecast = Array.isArray(response?.forecast)
          ? response.forecast
              .map((entry: any) => ({
                dt: Number(entry?.dt),
                tempMaxF:
                  typeof entry?.tempMax === "number"
                    ? entry.tempMax
                    : typeof entry?.temp?.max === "number"
                      ? entry.temp.max
                      : typeof entry?.temp === "number"
                        ? entry.temp
                        : null,
                tempMinF:
                  typeof entry?.tempMin === "number"
                    ? entry.tempMin
                    : typeof entry?.temp?.min === "number"
                      ? entry.temp.min
                      : typeof entry?.temp === "number"
                        ? entry.temp
                        : null,
                windSpeedMph:
                  typeof entry?.windSpeed === "number"
                    ? entry.windSpeed
                    : typeof entry?.wind?.speed === "number"
                      ? entry.wind.speed
                      : null,
                precipitationProbability: normalizePrecipitationProbability(entry?.pop),
                weatherId: typeof entry?.weather?.id === "number" ? entry.weather.id : null,
                weatherMain: entry?.weather?.main ?? null,
                weatherDescription: entry?.weather?.description ?? null,
              }))
              .filter((entry: ForecastDay) => Number.isFinite(entry.dt))
          : []
        const hourly = Array.isArray(response?.hourly)
          ? response.hourly
              .map((entry: any) => {
                if (!entry?.dt) return null
                const precipitationMm =
                  typeof entry?.rain?.["1h"] === "number"
                    ? entry.rain["1h"]
                    : typeof entry?.snow?.["1h"] === "number"
                      ? entry.snow["1h"]
                      : typeof entry?.precipitation === "number"
                        ? entry.precipitation
                        : null
                return {
                  dt: Number(entry.dt),
                  tempF: typeof entry?.temp === "number" ? entry.temp : null,
                  windSpeedMph:
                    typeof entry?.wind_speed === "number" ? entry.wind_speed : null,
                  windGustMph:
                    typeof entry?.wind_gust === "number" ? entry.wind_gust : null,
                  visibilityMiles:
                    typeof entry?.visibility === "number"
                      ? entry.visibility * MILES_PER_METER
                      : null,
                  humidity: typeof entry?.humidity === "number" ? entry.humidity : null,
                  pressure: typeof entry?.pressure === "number" ? entry.pressure : null,
                  precipitationIn:
                    typeof precipitationMm === "number"
                      ? precipitationMm * INCHES_PER_MM
                      : null,
                  precipitationProbability: normalizePrecipitationProbability(entry?.pop),
                  cloudCover: typeof entry?.clouds === "number" ? entry.clouds : null,
                  uvIndex: typeof entry?.uvi === "number" ? entry.uvi : null,
                }
              })
              .filter(
                (entry: HourlyWeatherPoint | null): entry is HourlyWeatherPoint =>
                  !!entry && Number.isFinite(entry.dt)
              )
          : []
        const visibilityMiles = response?.visibility
          ? response.visibility * MILES_PER_METER
          : 0
        const hasPrecipitation =
          typeof response?.hasPrecipitation === "boolean"
            ? response.hasPrecipitation
            : precipitationMm !== null ||
              ["rain", "snow", "drizzle", "thunderstorm"].includes(weatherMain)

        const currentSnapshot: CurrentConditions = {
          locationName: response?.name ?? "Unknown Site",
          locationCountry: response?.sys?.country ?? null,
          description,
          tempF: Number(response?.main?.temp ?? 0),
          windSpeedMph: Number(response?.wind?.speed ?? 0),
          windGustMph:
            response?.wind?.gust !== undefined ? Number(response.wind.gust) : null,
          visibilityMiles,
          humidity: Number(response?.main?.humidity ?? 0),
          pressure: Number(response?.main?.pressure ?? 0),
          precipitationIn,
          hasPrecipitation,
          precipitationType,
          cloudCover:
            typeof response?.clouds?.all === "number" ? response.clouds.all : null,
          uvIndex: typeof response?.uvi === "number" ? response.uvi : null,
          precipitationProbability: normalizePrecipitationProbability(response?.pop),
          kpIndex,
          sunrise:
            typeof response?.sys?.sunrise === "number"
              ? response.sys.sunrise
              : null,
          sunset:
            typeof response?.sys?.sunset === "number" ? response.sys.sunset : null,
        }

        setWeather({
          ...currentSnapshot,
          current: currentSnapshot,
          forecast,
          hourly,
        })
        setStatus("idle")
      } catch (error) {
        setStatus("error")
        setErrorMessage(error instanceof Error ? error.message : "Unable to load data.")
      }
    }

    loadWeather()
  }, [activeCoords.lat, activeCoords.lon, locationRevision])

  const selectedForecast = useMemo(() => {
    if (!weather || selectedDayIndex === null) return null
    return weather.forecast[selectedDayIndex] ?? null
  }, [weather, selectedDayIndex])

  const activeData = useMemo(() => {
    if (!weather) return null
    const currentSnapshot = weather.current
    const forecastTemp = resolveForecastTemp(selectedForecast, currentSnapshot.tempF)
    const forecastPrecipProbability =
      selectedForecast?.precipitationProbability ??
      currentSnapshot.precipitationProbability
    const forecastWeatherMain = selectedForecast?.weatherMain?.toLowerCase() ?? ""
    const hasForecastPrecipitation =
      forecastWeatherMain.includes("rain") ||
      forecastWeatherMain.includes("snow") ||
      forecastWeatherMain.includes("drizzle") ||
      forecastWeatherMain.includes("thunder") ||
      (forecastPrecipProbability !== null && forecastPrecipProbability >= 50)

    return {
      isForecast: selectedForecast !== null,
      tempF: forecastTemp,
      humidity: currentSnapshot.humidity,
      pressure: currentSnapshot.pressure,
      visibilityMiles: currentSnapshot.visibilityMiles,
      windSpeedMph:
        selectedForecast?.windSpeedMph ?? currentSnapshot.windSpeedMph,
      windGustMph: selectedForecast ? null : currentSnapshot.windGustMph,
      cloudCover: currentSnapshot.cloudCover,
      uvIndex: currentSnapshot.uvIndex,
      kpIndex: currentSnapshot.kpIndex,
      precipitationProbability: forecastPrecipProbability,
      precipitationIn: selectedForecast ? null : currentSnapshot.precipitationIn,
      precipitationType: selectedForecast
        ? selectedForecast.weatherMain ?? null
        : currentSnapshot.precipitationType,
      hasPrecipitation: selectedForecast
        ? hasForecastPrecipitation
        : currentSnapshot.hasPrecipitation,
      sunrise: selectedForecast ? selectedForecast.sunrise : currentSnapshot.sunrise,
      sunset: selectedForecast ? selectedForecast.sunset : currentSnapshot.sunset,
      description: selectedForecast
        ? selectedForecast.weatherDescription ??
          selectedForecast.weatherMain ??
          currentSnapshot.description
        : currentSnapshot.description,
    }
  }, [weather, selectedForecast])

  const flyability = useMemo(() => {
    if (!weather || !activeData) return null
    const referenceTime = activeData.isForecast
      ? getForecastReferenceTime(selectedForecast?.dt)
      : undefined
    return calculateFlyability(
      {
        windSpeedMph: activeData.windSpeedMph,
        visibilityMiles: activeData.visibilityMiles,
        hasPrecipitation: activeData.hasPrecipitation,
        precipitationAmount: activeData.isForecast ? null : activeData.precipitationIn,
        temperatureF: activeData.tempF,
        humidity: activeData.humidity,
        pressure: activeData.pressure,
        cloudCover: activeData.cloudCover,
        kpIndex: activeData.kpIndex,
        uvIndex: activeData.uvIndex,
        precipitationProbability: activeData.precipitationProbability,
        gpsAccuracyMeters: activeData.isForecast ? null : activeGpsAccuracy,
        lat: activeCoords.lat,
        lon: activeCoords.lon,
        sunrise: activeData.sunrise,
        sunset: activeData.sunset,
        referenceTime,
      },
      thresholdOverrides
    )
  }, [
    weather,
    activeGpsAccuracy,
    activeCoords.lat,
    activeCoords.lon,
    thresholdOverrides,
    selectedForecast,
    activeData,
    selectedDayIndex,
  ])

  const flyabilityTone = useMemo(() => {
    switch (flyability?.status) {
      case "Danger":
        return {
          card: "border-rose-500/40 bg-gradient-to-br from-rose-950/80 via-slate-900 to-slate-950",
          badge: "border-rose-400/50 bg-rose-500/20 text-rose-100",
          dot: "bg-rose-300",
        }
      case "Safe":
        return {
          card: "border-emerald-500/40 bg-gradient-to-br from-emerald-950/70 via-slate-900 to-slate-950",
          badge: "border-emerald-400/40 bg-emerald-400/15 text-emerald-100",
          dot: "bg-emerald-300",
        }
      default:
        return {
          card: "border-amber-500/40 bg-gradient-to-br from-amber-950/60 via-slate-900 to-slate-950",
          badge: "border-amber-400/40 bg-amber-400/15 text-amber-100",
          dot: "bg-amber-300",
        }
    }
  }, [flyability?.status])

  const effectiveWindSpeedMph = activeData?.windSpeedMph ?? weather?.current.windSpeedMph ?? 0
  const windSpeed =
    unit === "kt" ? mphToKnots(effectiveWindSpeedMph) : effectiveWindSpeedMph
  const windGust =
    activeData?.windGustMph !== null && activeData?.windGustMph !== undefined
      ? unit === "kt"
        ? mphToKnots(activeData.windGustMph)
        : activeData.windGustMph
      : null
  const windUnitLabel = unit === "kt" ? "kt" : "mph"
  const locationLabel =
    searchSelection?.name?.trim() ??
    weather?.current.locationName?.trim() ??
    "Mission Perimeter"
  const parsedLocation = parseLocationLabel(locationLabel)
  const locationSummary = abbreviateLocation(
    parsedLocation.city,
    parsedLocation.state,
    parsedLocation.country ?? weather?.current.locationCountry ?? null
  )
  const weatherBriefing =
    weather && activeData
      ? buildWeatherBriefing({
          tempF: activeData.tempF,
          windSpeedMph: effectiveWindSpeedMph,
          cloudCover: activeData.cloudCover,
          precipitationProbability: activeData.precipitationProbability,
          description: activeData.description,
        })
      : "Awaiting telemetry."
  const { metars, notams, tfrs } = MOCK_AVIATION_DATA
  const tfrCount = tfrs.length
  const notamCount = notams.length
  const forecastDays = weather?.forecast ?? []
  const hourlySnapshot = weather?.hourly ?? []
  const twilightWindowSeconds = 30 * 60
  const twilightSunrise = activeData?.sunrise ?? null
  const twilightSunset = activeData?.sunset ?? null
  const twilightStart =
    typeof twilightSunrise === "number"
      ? twilightSunrise - twilightWindowSeconds
      : null
  const twilightEnd =
    typeof twilightSunset === "number" ? twilightSunset + twilightWindowSeconds : null
  const sunriseTime = formatSunTime(twilightSunrise, timeFormat)
  const sunsetTime = formatSunTime(twilightSunset, timeFormat)
  const twilightStartTime = formatSunTime(twilightStart, timeFormat)
  const twilightEndTime = formatSunTime(twilightEnd, timeFormat)
  const twilightReferenceTime = activeData?.isForecast
    ? getForecastReferenceTime(selectedForecast?.dt)
    : new Date()
  const twilightReferenceMs = twilightReferenceTime?.getTime() ?? null
  const twilightSunriseMs =
    typeof twilightSunrise === "number" ? twilightSunrise * 1000 : null
  const twilightSunsetMs =
    typeof twilightSunset === "number" ? twilightSunset * 1000 : null
  const isMorningTwilight =
    twilightReferenceMs !== null &&
    twilightSunriseMs !== null &&
    twilightReferenceMs >= twilightSunriseMs - twilightWindowSeconds * 1000 &&
    twilightReferenceMs < twilightSunriseMs
  const isEveningTwilight =
    twilightReferenceMs !== null &&
    twilightSunsetMs !== null &&
    twilightReferenceMs > twilightSunsetMs &&
    twilightReferenceMs <= twilightSunsetMs + twilightWindowSeconds * 1000
  const twilightStatus = flyability?.metrics.twilight ?? "Safe"
  const twilightIcon =
    twilightStatus === "Safe" ? (
      <Sun size={32} />
    ) : twilightStatus === "Danger" ? (
      <Moon size={32} />
    ) : isMorningTwilight ? (
      <Sunrise size={32} />
    ) : isEveningTwilight ? (
      <Sunset size={32} />
    ) : (
      <Sunrise size={32} />
    )
  const twilightValue = (
    <div className="flex flex-col gap-1">
      <div className="whitespace-nowrap">
        {twilightStartTime} - {sunriseTime}
      </div>
      <div className="whitespace-nowrap">
        {sunsetTime} - {twilightEndTime}
      </div>
    </div>
  )

  const convertThresholdValueToDisplay = (
    metricKey: ThresholdKey,
    value: number | null | undefined
  ) => {
    if (value === null || value === undefined) return value
    if (metricKey === "wind" && unit === "kt") {
      return mphToKnots(value)
    }
    return value
  }

  const convertThresholdValueFromDisplay = (
    metricKey: ThresholdKey,
    value: number | null | undefined
  ) => {
    if (value === null || value === undefined) return value
    if (metricKey === "wind" && unit === "kt") {
      return value / KNOTS_PER_MPH
    }
    return value
  }

  const activeThresholdDefinition = activeThresholdKey
    ? THRESHOLD_DEFINITIONS[activeThresholdKey]
    : null
  const activeThresholdUnitLabel = activeThresholdDefinition
    ? activeThresholdKey === "wind"
      ? windUnitLabel
      : activeThresholdDefinition.unit
    : ""
  const resolvedThreshold = activeThresholdKey
    ? thresholdOverrides[activeThresholdKey] ??
      DEFAULT_FLYABILITY_THRESHOLDS[activeThresholdKey]
    : undefined
  const displayThreshold = activeThresholdKey && resolvedThreshold
    ? isRangeThreshold(resolvedThreshold)
      ? {
          ...resolvedThreshold,
          minSafe: convertThresholdValueToDisplay(
            activeThresholdKey,
            resolvedThreshold.minSafe
          ),
          maxSafe: convertThresholdValueToDisplay(
            activeThresholdKey,
            resolvedThreshold.maxSafe
          ),
          minCaution: convertThresholdValueToDisplay(
            activeThresholdKey,
            resolvedThreshold.minCaution
          ),
          maxCaution: convertThresholdValueToDisplay(
            activeThresholdKey,
            resolvedThreshold.maxCaution
          ),
        }
      : {
          ...resolvedThreshold,
          caution: convertThresholdValueToDisplay(
            activeThresholdKey,
            resolvedThreshold.caution
          ),
          danger: convertThresholdValueToDisplay(
            activeThresholdKey,
            resolvedThreshold.danger
          ),
        }
    : undefined

  const isMissingApiKey =
    errorMessage?.toLowerCase().includes("missing openweathermap api key") ?? false
  const isSearching = searchStatus === "loading" || locateStatus === "loading"
  const cautionReasons = flyability?.cautionReasons ?? []
  const dangerReasons = flyability?.dangerReasons ?? []
  const alertMetricByReason: Record<
    string,
    { metricKey: keyof FlyabilityThresholds | "twilight"; label: string; suffix: string }
  > = {
    "Light precipitation": {
      metricKey: "precipitation",
      label: "Precipitation",
      suffix: "Light precipitation",
    },
    "Active precipitation": {
      metricKey: "precipitation",
      label: "Precipitation",
      suffix: "Active precipitation",
    },
    "Reduced visibility": {
      metricKey: "visibility",
      label: "Visibility",
      suffix: "Reduced visibility",
    },
    "Low visibility": {
      metricKey: "visibility",
      label: "Visibility",
      suffix: "Low visibility",
    },
    "Moderate winds": {
      metricKey: "wind",
      label: "Wind",
      suffix: "Moderate winds",
    },
    "High winds": {
      metricKey: "wind",
      label: "Wind",
      suffix: "High winds",
    },
    "Elevated geomagnetic activity": {
      metricKey: "kpIndex",
      label: "KP Index",
      suffix: "Elevated geomagnetic activity",
    },
    "Severe geomagnetic activity": {
      metricKey: "kpIndex",
      label: "KP Index",
      suffix: "Severe geomagnetic activity",
    },
    "High UV exposure": {
      metricKey: "uvIndex",
      label: "UV Index",
      suffix: "High UV exposure",
    },
    "Extreme UV exposure": {
      metricKey: "uvIndex",
      label: "UV Index",
      suffix: "Extreme UV exposure",
    },
    "Moderate precipitation probability": {
      metricKey: "precipitationProbability",
      label: "Precipitation Probability",
      suffix: "Moderate precipitation probability",
    },
    "High precipitation probability": {
      metricKey: "precipitationProbability",
      label: "Precipitation Probability",
      suffix: "High precipitation probability",
    },
    "GPS accuracy reduced": {
      metricKey: "gpsAccuracy",
      label: "GPS Accuracy",
      suffix: "GPS accuracy reduced",
    },
    "GPS accuracy degraded": {
      metricKey: "gpsAccuracy",
      label: "GPS Accuracy",
      suffix: "GPS accuracy degraded",
    },
    "Temperature in caution range": {
      metricKey: "temperature",
      label: "Temperature",
      suffix: "Caution range",
    },
    "Temperature in danger range": {
      metricKey: "temperature",
      label: "Temperature",
      suffix: "Danger range",
    },
    "Temperature caution threshold": {
      metricKey: "temperature",
      label: "Temperature",
      suffix: "Caution threshold",
    },
    "Temperature danger threshold": {
      metricKey: "temperature",
      label: "Temperature",
      suffix: "Danger threshold",
    },
    "Humidity caution threshold": {
      metricKey: "humidity",
      label: "Humidity",
      suffix: "Caution threshold",
    },
    "Humidity danger threshold": {
      metricKey: "humidity",
      label: "Humidity",
      suffix: "Danger threshold",
    },
    "Pressure caution threshold": {
      metricKey: "pressure",
      label: "Pressure",
      suffix: "Caution threshold",
    },
    "Pressure danger threshold": {
      metricKey: "pressure",
      label: "Pressure",
      suffix: "Danger threshold",
    },
    "Cloud cover caution threshold": {
      metricKey: "cloudCover",
      label: "Cloud Cover",
      suffix: "Caution threshold",
    },
    "Cloud cover danger threshold": {
      metricKey: "cloudCover",
      label: "Cloud Cover",
      suffix: "Danger threshold",
    },
    "Twilight caution threshold": {
      metricKey: "twilight",
      label: "Twilight Phase",
      suffix: "Caution threshold",
    },
    "Twilight danger threshold": {
      metricKey: "twilight",
      label: "Twilight Phase",
      suffix: "Danger threshold",
    },
    "Twilight operations": {
      metricKey: "twilight",
      label: "Twilight Phase",
      suffix: "Twilight operations",
    },
  }

  const formatAlertValue = (metricKey: keyof FlyabilityThresholds | "twilight") => {
    if (!weather || !activeData) return null
    switch (metricKey) {
      case "temperature":
        return `${formatValue(activeData.tempF, 0)}°F`
      case "wind":
        return `${formatValue(windSpeed)} ${windUnitLabel}`
      case "visibility":
        return `${formatValue(activeData.visibilityMiles)} mi`
      case "precipitation":
        if (!activeData.isForecast && typeof activeData.precipitationIn === "number") {
          return `${formatValue(activeData.precipitationIn, 2)} in`
        }
        if (activeData.precipitationType) {
          return activeData.precipitationType
        }
        return activeData.hasPrecipitation ? "Detected" : null
      case "humidity":
        return `${formatValue(activeData.humidity, 0)}%`
      case "pressure":
        return `${formatValue(activeData.pressure, 0)} hPa`
      case "cloudCover":
        return activeData.cloudCover !== null
          ? `${formatValue(activeData.cloudCover, 0)}%`
          : null
      case "uvIndex":
        return activeData.uvIndex !== null
          ? formatValue(activeData.uvIndex, 1)
          : null
      case "kpIndex":
        return activeData.kpIndex !== null
          ? formatValue(activeData.kpIndex, 1)
          : null
      case "precipitationProbability":
        return activeData.precipitationProbability !== null
          ? `${formatValue(activeData.precipitationProbability, 0)}%`
          : null
      case "gpsAccuracy":
        return !activeData.isForecast && activeGpsAccuracy !== null
          ? `${formatValue(activeGpsAccuracy, 0)} m`
          : null
      case "twilight":
        return flyability?.twilightPhase ?? null
      default:
        return null
    }
  }

  const formatAlertReason = (reason: string) => {
    const alertMeta = alertMetricByReason[reason]
    if (!alertMeta) return reason
    const value = formatAlertValue(alertMeta.metricKey)
    if (!value) return reason
    return `${alertMeta.label}: ${value}`
  }

  const handleThresholdSave = (
    metricKey: ThresholdKey,
    next: MetricThreshold
  ) => {
    const normalized: MetricThreshold = isRangeThreshold(next)
      ? {
          minSafe: convertThresholdValueFromDisplay(metricKey, next.minSafe),
          maxSafe: convertThresholdValueFromDisplay(metricKey, next.maxSafe),
          minCaution: convertThresholdValueFromDisplay(metricKey, next.minCaution),
          maxCaution: convertThresholdValueFromDisplay(metricKey, next.maxCaution),
        }
      : {
          direction: next.direction,
          caution: convertThresholdValueFromDisplay(metricKey, next.caution),
          danger: convertThresholdValueFromDisplay(metricKey, next.danger),
        }
    setThresholdOverrides((prev) => ({
      ...prev,
      [metricKey]: normalized,
    }))
    setActiveThresholdKey(null)
  }

  const handleThresholdReset = (metricKey: ThresholdKey) => {
    setThresholdOverrides((prev) => {
      const next = { ...prev }
      delete next[metricKey]
      return next
    })
    setActiveThresholdKey(null)
  }

  const handleTrendOpen = (metricKey: TrendMetricKey) => {
    setSelectedTrendMetric(metricKey)
    setShowTrendModal(true)
  }

  const trendConfigs: Record<
    TrendMetricKey,
    {
      label: string
      unit: string
      accessor: (entry: HourlyWeatherPoint) => number | null
    }
  > = {
    temperature: {
      label: "Temperature",
      unit: "°F",
      accessor: (entry) => entry.tempF,
    },
    humidity: {
      label: "Humidity",
      unit: "%",
      accessor: (entry) => entry.humidity,
    },
    pressure: {
      label: "Pressure",
      unit: "hPa",
      accessor: (entry) => entry.pressure,
    },
    windSpeed: {
      label: "Wind Speed",
      unit: windUnitLabel,
      accessor: (entry) =>
        entry.windSpeedMph !== null && unit === "kt"
          ? mphToKnots(entry.windSpeedMph)
          : entry.windSpeedMph,
    },
    windGust: {
      label: "Wind Gusts",
      unit: windUnitLabel,
      accessor: (entry) =>
        entry.windGustMph !== null && unit === "kt"
          ? mphToKnots(entry.windGustMph)
          : entry.windGustMph,
    },
    visibility: {
      label: "Visibility",
      unit: "mi",
      accessor: (entry) => entry.visibilityMiles,
    },
    precipitation: {
      label: "Precipitation",
      unit: "in",
      accessor: (entry) => entry.precipitationIn ?? 0,
    },
    precipitationProbability: {
      label: "Precipitation Probability",
      unit: "%",
      accessor: (entry) => entry.precipitationProbability,
    },
    cloudCover: {
      label: "Cloud Cover",
      unit: "%",
      accessor: (entry) => entry.cloudCover,
    },
    uvIndex: {
      label: "Ultraviolet Index",
      unit: "",
      accessor: (entry) => entry.uvIndex,
    },
    kpIndex: {
      label: "KP Index",
      unit: "",
      accessor: () => null,
    },
    gpsAccuracy: {
      label: "GPS Accuracy",
      unit: "m",
      accessor: () => null,
    },
    twilight: {
      label: "Civil Twilight Hours",
      unit: "",
      accessor: () => null,
    },
  }

  const selectedTrendConfig = selectedTrendMetric
    ? trendConfigs[selectedTrendMetric]
    : null
  const selectedTrendValues =
    selectedTrendConfig && hourlySnapshot.length > 0
      ? hourlySnapshot.map((entry) => ({
          dt: entry.dt,
          value: selectedTrendConfig.accessor(entry),
        }))
      : []

  return (
    <section className="space-y-6">
      <form
        onSubmit={handleSearch}
        className="flex flex-col gap-3 rounded-3xl border border-slate-800/70 bg-slate-900/60 p-4 sm:flex-row sm:items-center"
      >
        <label className="sr-only" htmlFor="location-search">
          Search city or ZIP code
        </label>
        <div className="relative w-full flex-1">
          <input
            id="location-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search city or ZIP"
            aria-busy={isSearching}
            className="h-11 w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 pr-10 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-emerald-200" />
          )}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-4 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100 transition hover:border-emerald-400 hover:text-white"
          >
            {searchStatus === "loading" ? "Locating..." : "Search"}
          </button>
          <details ref={locationsMenuRef} className="relative">
            <summary className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-300 transition hover:text-white list-none [&::-webkit-details-marker]:hidden">
              My Locations
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-slate-800 bg-slate-950/95 p-2 shadow-xl">
              {useGps && (
                <button
                  type="button"
                  onClick={() => {
                    handleLocateMe()
                    locationsMenuRef.current?.removeAttribute("open")
                  }}
                  className="w-full rounded-xl px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200 transition hover:bg-slate-900/80"
                >
                  Use GPS Location
                </button>
              )}
              {recentSearches.length === 0 && (
                <div className="px-3 py-2 text-sm text-slate-500">
                  No recent locations.
                </div>
              )}
              {recentSearches.map((location) => (
                <button
                  key={`${location.name}-${location.lat}-${location.lon}`}
                  type="button"
                  onClick={() => handleRecentSearchSelect(location)}
                  className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-900/80"
                >
                  {location.name}
                </button>
              ))}
            </div>
          </details>
        </div>
      </form>

      <div className="space-y-6 rounded-3xl border border-slate-800/70 bg-gradient-to-br from-indigo-950/30 via-slate-900/50 to-slate-950/70 p-6">
        {searchStatus === "error" && searchError && (
          <div className="mx-auto w-fit max-w-full rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-center text-sm text-rose-100">
            {searchError}
          </div>
        )}
        {locateStatus === "error" && locateError && (
          <div className="flex w-full justify-center px-2">
            <div className="mx-auto inline-block max-w-full whitespace-nowrap max-[420px]:whitespace-normal rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-center text-sm text-rose-100">
              {locateError}
            </div>
          </div>
        )}

        <header className="rounded-3xl border border-slate-800/70 bg-gradient-to-br from-slate-950/70 via-slate-900/60 to-slate-950/80 p-6 md:py-7">
          <div className="flex flex-col gap-6 md:flex-row md:items-stretch md:gap-8">
            <div className="flex flex-col gap-4 md:flex-1">
              <div className="flex flex-col gap-2">
                <div className="w-fit rounded-full border border-slate-800/80 bg-slate-950/80 px-4 py-2 text-xs text-slate-200 shadow-[0_0_0_1px_rgba(15,23,42,0.4)]">
                  <span className="font-semibold uppercase tracking-[0.3em] text-emerald-200">
                    Current Conditions
                  </span>
                </div>
                <div className="text-2xl font-semibold leading-tight text-white md:text-3xl">
                  {locationSummary}
                </div>
              </div>
              <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
                {weatherBriefing}
              </p>
            </div>
            <div className="grid w-full gap-3 sm:grid-cols-2 sm:auto-rows-fr md:flex-1 md:max-w-none md:items-stretch md:gap-4">
              <button
                type="button"
                onClick={() => setShowTfrs(true)}
                className="inline-flex h-full w-full items-center justify-between gap-3 rounded-full border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xl font-semibold tracking-[0.25em] text-amber-200 transition hover:border-amber-200/70 hover:text-amber-50"
              >
                TFRs
                <span className="ml-2 text-xl text-amber-100">{tfrCount}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowNotams(true)}
                className="inline-flex h-full w-full items-center justify-between gap-3 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-xl font-semibold tracking-[0.25em] text-emerald-200 transition hover:border-emerald-200/70 hover:text-emerald-50"
              >
                NOTAMs
                <span className="text-xl text-emerald-100">{notamCount}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowMetar(true)}
                className="inline-flex h-full w-full items-center justify-center rounded-full border border-slate-700/80 bg-slate-950/80 px-4 py-3 text-xl font-semibold tracking-[0.3em] text-slate-200 transition hover:border-emerald-300/60 hover:text-white sm:col-span-2"
              >
                View Local METARs
              </button>
            </div>
          </div>
        </header>

        {weather && (
          <ForecastSection
            forecastDays={forecastDays}
            unit={unit}
            liveSnapshot={weather.current}
            selectedDayIndex={selectedDayIndex}
            onSelectDay={(index) => setSelectedDayIndex(index)}
            userThresholds={thresholdOverrides}
            activeCoords={activeCoords}
          />
        )}

        {status === "loading" && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-300">
            Syncing weather feed...
          </div>
        )}
        {status === "error" && isMissingApiKey && (
          <div className="mx-auto w-fit max-w-full rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-center text-sm text-amber-100">
            <p className="text-base font-semibold text-white">
              Weather data unavailable
            </p>
            <p className="mt-2 text-sm text-amber-100/90">
              Configure VITE_OPENWEATHER_API_KEY to restore live telemetry.
            </p>
          </div>
        )}
        {status === "error" && !isMissingApiKey && (
          <div className="mx-auto w-fit max-w-full rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-center text-sm text-rose-100">
            {errorMessage ?? "Unable to load conditions."}
          </div>
        )}

        {weather && flyability && (
          <div className="grid items-start gap-4 lg:grid-cols-[1.1fr_1.9fr]">
            <div
              className={`rounded-3xl border p-6 ${
                flyabilityTone?.card ??
                "border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
              }`}
            >
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
                    Flyability
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    {flyability.status}
                  </h2>
                </div>
                <div className="text-left sm:text-right">
                  <div className="text-6xl font-semibold text-white">
                    {flyability.score}
                  </div>
                  <div
                    className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${
                      flyabilityTone?.badge ??
                      "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                    }`}
                  >
                    Score
                  </div>
                </div>
              </div>
              <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-200">
                  Cautious Conditions
                </p>
                <div className="mt-3 space-y-2 text-sm text-amber-100">
                  {cautionReasons.length > 0 ? (
                    cautionReasons.map((reason, index) => (
                      <div
                        key={`${reason}-${index}`}
                        className="flex items-center justify-between rounded-2xl border border-amber-500/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-100"
                      >
                        <span className="font-semibold text-white">
                          {formatAlertReason(reason)}
                        </span>
                        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-200">
                          Caution
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-2 text-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      <span>None detected</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-rose-200">
                  Dangerous Conditions
                </p>
                <div className="mt-3 space-y-2 text-sm text-rose-100">
                  {dangerReasons.length > 0 ? (
                    dangerReasons.map((reason, index) => (
                      <div
                        key={`${reason}-${index}`}
                        className="flex items-center justify-between rounded-2xl border border-rose-500/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-100"
                      >
                        <span className="font-semibold text-white">
                          {formatAlertReason(reason)}
                        </span>
                        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-rose-200">
                          Danger
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-2 text-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      <span>None detected</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="min-h-[520px]">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <Tile
                  icon={<CloudSun size={32} />}
                  label="Temperature"
                  value={`${formatValue(activeData?.tempF ?? weather.current.tempF, 0)}°F`}
                  description="Ambient reading"
                  status={flyability.metrics.temperature}
                  onClick={() => handleTrendOpen("temperature")}
                  onSettingsClick={() => setActiveThresholdKey("temperature")}
                />
                <Tile
                  icon={<Droplets size={32} />}
                  label="Humidity"
                  value={`${formatValue(
                    activeData?.humidity ?? weather.current.humidity,
                    0
                  )}%`}
                  description="Moisture density"
                  status={flyability.metrics.humidity}
                  onClick={() => handleTrendOpen("humidity")}
                  onSettingsClick={() => setActiveThresholdKey("humidity")}
                />
                <Tile
                  icon={<Gauge size={32} />}
                  label="Pressure"
                  value={`${formatValue(
                    activeData?.pressure ?? weather.current.pressure,
                    0
                  )} hPa`}
                  description="Sea level"
                  status={flyability.metrics.pressure}
                  onClick={() => handleTrendOpen("pressure")}
                  onSettingsClick={() => setActiveThresholdKey("pressure")}
                />
                <Tile
                  icon={<Wind size={32} />}
                  label="Wind Speed"
                  value={`${formatValue(windSpeed)} ${windUnitLabel}`}
                  description="Sustained flow"
                  status={flyability.metrics.wind}
                  onClick={() => handleTrendOpen("windSpeed")}
                  onSettingsClick={() => setActiveThresholdKey("wind")}
                />
                <Tile
                  icon={<Wind size={32} />}
                  label="Wind Gusts"
                  value={
                    windGust ? `${formatValue(windGust)} ${windUnitLabel}` : "--"
                  }
                  description="Peak pulses"
                  status={flyability.metrics.wind}
                  onClick={() => handleTrendOpen("windGust")}
                  onSettingsClick={() => setActiveThresholdKey("wind")}
                />
                <Tile
                  icon={<Eye size={32} />}
                  label="Visibility"
                  value={`${formatValue(
                    activeData?.visibilityMiles ?? weather.current.visibilityMiles
                  )} mi`}
                  description="Targeted visual range"
                  status={flyability.metrics.visibility}
                  onClick={() => handleTrendOpen("visibility")}
                  onSettingsClick={() => setActiveThresholdKey("visibility")}
                />
                <Tile
                  icon={<CloudDrizzle size={32} />}
                  label="Precipitation"
                  labelClassName="text-[clamp(0.6rem,1.2vw,0.85rem)]"
                  value={
                    activeData?.isForecast
                      ? activeData.precipitationType ??
                        (activeData.precipitationProbability !== null &&
                        activeData.precipitationProbability >= 50
                          ? "Active"
                          : "None")
                      : activeData?.hasPrecipitation
                        ? activeData.precipitationIn !== null
                          ? `${formatValue(activeData.precipitationIn, 2)} in${
                              activeData.precipitationType
                                ? ` ${activeData.precipitationType}`
                                : ""
                            }`
                          : activeData?.precipitationType ?? "Active"
                        : "None"
                  }
                  description={
                    activeData?.isForecast
                      ? activeData.description ?? "Forecast precipitation"
                      : activeData?.hasPrecipitation
                        ? activeData.precipitationType
                          ? `${activeData.precipitationType} detected`
                          : "Active precipitation"
                        : "No precipitation detected"
                  }
                  status={flyability.metrics.precipitation}
                  onClick={() => handleTrendOpen("precipitation")}
                  onSettingsClick={() => setActiveThresholdKey("precipitation")}
                />
                <Tile
                  icon={<CloudDrizzle size={32} />}
                  label="Precipitation Probability"
                  value={
                    activeData?.precipitationProbability !== null &&
                    activeData?.precipitationProbability !== undefined
                      ? `${formatValue(activeData.precipitationProbability, 0)}%`
                      : "--"
                  }
                  description="Precipitation odds"
                  status={flyability.metrics.precipitationProbability}
                  onClick={() => handleTrendOpen("precipitationProbability")}
                  onSettingsClick={() =>
                    setActiveThresholdKey("precipitationProbability")
                  }
                />
                <Tile
                  icon={<Cloud size={32} />}
                  label="Cloud Cover"
                  value={
                    activeData?.cloudCover !== null &&
                    activeData?.cloudCover !== undefined
                      ? `${formatValue(activeData.cloudCover, 0)}%`
                      : "--"
                  }
                  description="Sky occlusion"
                  status={flyability.metrics.cloudCover}
                  onClick={() => handleTrendOpen("cloudCover")}
                  onSettingsClick={() => setActiveThresholdKey("cloudCover")}
                />
                <Tile
                  icon={<Sun size={32} />}
                  label="Ultraviolet Index"
                  value={
                    activeData?.uvIndex !== null && activeData?.uvIndex !== undefined
                      ? formatValue(activeData.uvIndex, 1)
                      : "--"
                  }
                  description="Radiation level"
                  status={flyability.metrics.uvIndex}
                  onClick={() => handleTrendOpen("uvIndex")}
                  onSettingsClick={() => setActiveThresholdKey("uvIndex")}
                />
                <Tile
                  icon={<Activity size={32} />}
                  label="KP Index"
                  value={
                    activeData?.kpIndex !== null && activeData?.kpIndex !== undefined
                      ? formatValue(activeData.kpIndex, 1)
                      : "--"
                  }
                  description="Geomagnetic field"
                  status={flyability.metrics.kpIndex}
                  onClick={() => handleTrendOpen("kpIndex")}
                  onSettingsClick={() => setActiveThresholdKey("kpIndex")}
                />
                <Tile
                  icon={<LocateFixed size={32} />}
                  label="GPS Accuracy"
                  value={
                    !activeData?.isForecast && activeGpsAccuracy !== null
                      ? `${formatValue(activeGpsAccuracy, 1)} m`
                      : "--"
                  }
                  description="Location fix"
                  status={flyability.metrics.gpsAccuracy}
                  onClick={() => handleTrendOpen("gpsAccuracy")}
                  onSettingsClick={() => setActiveThresholdKey("gpsAccuracy")}
                />
                <Tile
                  icon={twilightIcon}
                  label="Civil Twilight Hours"
                  value={twilightValue}
                  valueClassName="text-sm leading-snug"
                  description="Solar window"
                  status={flyability.metrics.twilight}
                  onClick={() => handleTrendOpen("twilight")}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      {activeThresholdDefinition && activeThresholdKey && (
        <ThresholdModal
          metricKey={activeThresholdKey}
          definition={activeThresholdDefinition}
          current={displayThreshold}
          unitLabel={activeThresholdUnitLabel}
          onSave={handleThresholdSave}
          onReset={handleThresholdReset}
          onClose={() => setActiveThresholdKey(null)}
        />
      )}
      {showTrendModal && selectedTrendConfig && (
        <TrendModal
          title={selectedTrendConfig.label}
          unitLabel={selectedTrendConfig.unit}
          values={selectedTrendValues}
          timeFormat={timeFormat}
          metricKey={selectedTrendMetric ?? "temperature"}
          sunrise={twilightSunrise}
          sunset={twilightSunset}
          onClose={() => {
            setShowTrendModal(false)
            setSelectedTrendMetric(null)
          }}
        />
      )}
      {showMetar && (
        <MetarModal
          locationLabel={locationSummary}
          metars={metars}
          onClose={() => setShowMetar(false)}
        />
      )}
      {showNotams && (
        <NotamModal
          locationLabel={locationSummary}
          notams={notams}
          onClose={() => setShowNotams(false)}
          onViewOnMap={() => {
            onTabChange("radar")
            setShowNotams(false)
          }}
        />
      )}
      {showTfrs && (
        <TfrModal
          locationLabel={locationSummary}
          tfrs={tfrs}
          onClose={() => setShowTfrs(false)}
          onViewOnMap={() => {
            onTabChange("radar")
            setShowTfrs(false)
          }}
        />
      )}
    </section>
  )
}
