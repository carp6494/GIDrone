import * as SunCalc from "suncalc"

export type FlyabilityStatus = "Safe" | "Caution" | "Danger"
export type TwilightPhase = "Daylight" | "Twilight" | "Night" | "Unknown"
export type ThresholdDirection = "above" | "below"
export type DirectionalMetricThreshold = {
  direction: ThresholdDirection
  caution?: number | null
  danger?: number | null
}
export type RangeMetricThreshold = {
  minSafe?: number | null
  maxSafe?: number | null
  minCaution?: number | null
  maxCaution?: number | null
}
export type MetricThreshold = DirectionalMetricThreshold | RangeMetricThreshold
export type FlyabilityThresholds = Partial<{
  wind: MetricThreshold
  visibility: MetricThreshold
  precipitation: MetricThreshold
  humidity: MetricThreshold
  pressure: MetricThreshold
  temperature: MetricThreshold
  twilight: MetricThreshold
  kpIndex: MetricThreshold
  uvIndex: MetricThreshold
  precipitationProbability: MetricThreshold
  gpsAccuracy: MetricThreshold
  cloudCover: MetricThreshold
}>

type FlyabilityInput = {
  windSpeedMph: number
  visibilityMiles: number
  hasPrecipitation: boolean
  precipitationAmount?: number | null
  temperatureF?: number | null
  humidity?: number | null
  pressure?: number | null
  cloudCover?: number | null
  kpIndex?: number | null
  uvIndex?: number | null
  precipitationProbability?: number | null
  gpsAccuracyMeters?: number | null
  lat?: number
  lon?: number
  sunrise?: number | null
  sunset?: number | null
  referenceTime?: Date
}

type FlyabilityResult = {
  status: FlyabilityStatus
  score: number
  reasons: string[]
  cautionReasons: string[]
  dangerReasons: string[]
  twilightPhase: TwilightPhase
  metrics: {
    wind: FlyabilityStatus
    visibility: FlyabilityStatus
    precipitation: FlyabilityStatus
    humidity: FlyabilityStatus
    pressure: FlyabilityStatus
    temperature: FlyabilityStatus
    cloudCover: FlyabilityStatus
    kpIndex: FlyabilityStatus
    twilight: FlyabilityStatus
    uvIndex: FlyabilityStatus
    precipitationProbability: FlyabilityStatus
    gpsAccuracy: FlyabilityStatus
  }
}

const getTwilightPhase = ({
  currentTime,
  lat,
  lon,
  sunrise,
  sunset,
}: {
  currentTime: Date
  lat?: number
  lon?: number
  sunrise?: number | null
  sunset?: number | null
}): TwilightPhase => {
  const sunriseMs = typeof sunrise === "number" ? sunrise * 1000 : null
  const sunsetMs = typeof sunset === "number" ? sunset * 1000 : null
  if (sunriseMs !== null && sunsetMs !== null) {
    const twilightWindowMs = 30 * 60 * 1000
    const currentTimeMs = currentTime.getTime()
    if (currentTimeMs >= sunriseMs && currentTimeMs <= sunsetMs) {
      return "Daylight"
    }
    if (
      (currentTimeMs >= sunriseMs - twilightWindowMs &&
        currentTimeMs < sunriseMs) ||
      (currentTimeMs > sunsetMs && currentTimeMs <= sunsetMs + twilightWindowMs)
    ) {
      return "Twilight"
    }
    return "Night"
  }
  if (typeof lat !== "number" || typeof lon !== "number") {
    return "Unknown"
  }
  const times = SunCalc.getTimes(currentTime, lat, lon)
  if (!times?.sunrise || !times?.sunset || !times?.dawn || !times?.dusk) {
    return "Unknown"
  }
  const currentTimeMs = currentTime.getTime()
  const sunriseTimeMs = times.sunrise.getTime()
  const sunsetTimeMs = times.sunset.getTime()
  if (currentTimeMs >= sunriseTimeMs && currentTimeMs <= sunsetTimeMs) {
    return "Daylight"
  }
  if (
    (currentTimeMs >= sunriseTimeMs - 30 * 60 * 1000 &&
      currentTimeMs < sunriseTimeMs) ||
    (currentTimeMs > sunsetTimeMs &&
      currentTimeMs <= sunsetTimeMs + 30 * 60 * 1000)
  ) {
    return "Twilight"
  }
  return "Night"
}

export const DEFAULT_FLYABILITY_THRESHOLDS: FlyabilityThresholds = {
  wind: { direction: "above", caution: 15, danger: 25 },
  visibility: { direction: "below", danger: 3 },
  temperature: {
    minSafe: 33,
    maxSafe: 96,
    minCaution: -14,
    maxCaution: 104,
  },
  kpIndex: { direction: "above", caution: 4, danger: 6 },
  uvIndex: { direction: "above", caution: 8, danger: 10 },
  precipitationProbability: { direction: "above", caution: 30, danger: 60 },
  gpsAccuracy: { direction: "above", caution: 10, danger: 30 },
}

const resolveThresholds = (
  thresholds?: FlyabilityThresholds
): FlyabilityThresholds => {
  const resolved: FlyabilityThresholds = { ...DEFAULT_FLYABILITY_THRESHOLDS }
  if (!thresholds) return resolved
  for (const key of Object.keys(thresholds) as (keyof FlyabilityThresholds)[]) {
    const override = thresholds[key]
    if (!override) continue
    const base = DEFAULT_FLYABILITY_THRESHOLDS[key]
    resolved[key] = base ? { ...base, ...override } : { ...override }
  }
  return resolved
}

const isDirectionalThreshold = (
  threshold: MetricThreshold
): threshold is DirectionalMetricThreshold => "direction" in threshold

const hasRangeThreshold = (
  threshold: MetricThreshold
): threshold is RangeMetricThreshold =>
  "minSafe" in threshold ||
  "maxSafe" in threshold ||
  "minCaution" in threshold ||
  "maxCaution" in threshold

export const calculateFlyability = ({
  windSpeedMph,
  visibilityMiles,
  hasPrecipitation,
  precipitationAmount,
  temperatureF,
  humidity,
  pressure,
  cloudCover,
  kpIndex,
  uvIndex,
  precipitationProbability,
  gpsAccuracyMeters,
  lat,
  lon,
  sunrise,
  sunset,
  referenceTime,
}: FlyabilityInput,
  userThresholds?: FlyabilityThresholds
): FlyabilityResult => {
  const reasons: string[] = []
  const cautionReasons: string[] = []
  const dangerReasons: string[] = []
  let status: FlyabilityStatus = "Safe"
  let score = 100
  const metrics: FlyabilityResult["metrics"] = {
    wind: "Safe",
    visibility: "Safe",
    precipitation: "Safe",
    humidity: "Safe",
    pressure: "Safe",
    temperature: "Safe",
    cloudCover: "Safe",
    kpIndex: "Safe",
    twilight: "Safe",
    uvIndex: "Safe",
    precipitationProbability: "Safe",
    gpsAccuracy: "Safe",
  }
  const statusRank: Record<FlyabilityStatus, number> = {
    Safe: 0,
    Caution: 1,
    Danger: 2,
  }
  const applyCondition = (
    nextStatus: FlyabilityStatus,
    nextScore: number,
  ) => {
    if (statusRank[nextStatus] > statusRank[status]) {
      status = nextStatus
    }
    score = Math.min(score, nextScore)
  }
  const applyReason = (
    target: "Caution" | "Danger",
    reason: string
  ) => {
    if (target === "Caution") {
      cautionReasons.push(reason)
    } else {
      dangerReasons.push(reason)
    }
    reasons.push(reason)
  }

  const resolvedThresholds = resolveThresholds(userThresholds)
  const applyDirectionalThreshold = (
    metric: keyof FlyabilityResult["metrics"],
    value: number | null | undefined,
    threshold: MetricThreshold | undefined,
    cautionScore: number,
    dangerScore: number,
    cautionReason: string,
    dangerReason: string
  ) => {
    if (!threshold || typeof value !== "number" || Number.isNaN(value)) return
    if (!isDirectionalThreshold(threshold)) return
    const isDanger =
      typeof threshold.danger === "number" &&
      (threshold.direction === "above"
        ? value >= threshold.danger
        : value <= threshold.danger)
    const isCaution =
      typeof threshold.caution === "number" &&
      (threshold.direction === "above"
        ? value >= threshold.caution
        : value <= threshold.caution)
    if (isDanger) {
      metrics[metric] = "Danger"
      applyReason("Danger", dangerReason)
      applyCondition("Danger", dangerScore)
      return
    }
    if (isCaution) {
      metrics[metric] = "Caution"
      applyReason("Caution", cautionReason)
      applyCondition("Caution", cautionScore)
    }
  }
  const applyRangeThreshold = (
    metric: keyof FlyabilityResult["metrics"],
    value: number | null | undefined,
    threshold: MetricThreshold | undefined,
    cautionScore: number,
    dangerScore: number,
    cautionReason: string,
    dangerReason: string
  ) => {
    if (!threshold || typeof value !== "number" || Number.isNaN(value)) return
    if (!hasRangeThreshold(threshold)) return
    const minSafe = threshold.minSafe
    const maxSafe = threshold.maxSafe
    const minCaution = threshold.minCaution
    const maxCaution = threshold.maxCaution
    const isDanger =
      (typeof minCaution === "number" && value < minCaution) ||
      (typeof maxCaution === "number" && value > maxCaution)
    const isCaution =
      (typeof minCaution === "number" &&
        typeof minSafe === "number" &&
        value >= minCaution &&
        value < minSafe) ||
      (typeof maxSafe === "number" &&
        typeof maxCaution === "number" &&
        value > maxSafe &&
        value <= maxCaution)
    if (isDanger) {
      metrics[metric] = "Danger"
      applyReason("Danger", dangerReason)
      applyCondition("Danger", dangerScore)
      return
    }
    if (isCaution) {
      metrics[metric] = "Caution"
      applyReason("Caution", cautionReason)
      applyCondition("Caution", cautionScore)
    }
  }

  const precipitationThreshold = resolvedThresholds.precipitation
  if (
    precipitationThreshold &&
    typeof precipitationAmount === "number" &&
    !Number.isNaN(precipitationAmount)
  ) {
    applyDirectionalThreshold(
      "precipitation",
      precipitationAmount,
      precipitationThreshold,
      65,
      10,
      "Light precipitation",
      "Active precipitation"
    )
  } else if (hasPrecipitation) {
    metrics.precipitation = "Danger"
    applyReason("Danger", "Active precipitation")
    applyCondition("Danger", 10)
  }

  applyDirectionalThreshold(
    "visibility",
    visibilityMiles,
    resolvedThresholds.visibility,
    70,
    15,
    "Reduced visibility",
    "Low visibility"
  )

  applyDirectionalThreshold(
    "wind",
    windSpeedMph,
    resolvedThresholds.wind,
    55,
    20,
    "Moderate winds",
    "High winds"
  )

  applyDirectionalThreshold(
    "kpIndex",
    kpIndex,
    resolvedThresholds.kpIndex,
    60,
    25,
    "Elevated geomagnetic activity",
    "Severe geomagnetic activity"
  )

  applyDirectionalThreshold(
    "uvIndex",
    uvIndex,
    resolvedThresholds.uvIndex,
    70,
    30,
    "High UV exposure",
    "Extreme UV exposure"
  )

  applyDirectionalThreshold(
    "precipitationProbability",
    precipitationProbability,
    resolvedThresholds.precipitationProbability,
    65,
    25,
    "Moderate precipitation probability",
    "High precipitation probability"
  )

  applyDirectionalThreshold(
    "gpsAccuracy",
    gpsAccuracyMeters,
    resolvedThresholds.gpsAccuracy,
    70,
    25,
    "GPS accuracy reduced",
    "GPS accuracy degraded"
  )

  if (resolvedThresholds.temperature) {
    const temperatureThreshold = resolvedThresholds.temperature
    if (hasRangeThreshold(temperatureThreshold)) {
      applyRangeThreshold(
        "temperature",
        temperatureF,
        temperatureThreshold,
        70,
        35,
        "Temperature in caution range",
        "Temperature in danger range"
      )
    } else {
      applyDirectionalThreshold(
        "temperature",
        temperatureF,
        temperatureThreshold,
        70,
        35,
        "Temperature caution threshold",
        "Temperature danger threshold"
      )
    }
  }

  applyDirectionalThreshold(
    "humidity",
    humidity,
    resolvedThresholds.humidity,
    70,
    35,
    "Humidity caution threshold",
    "Humidity danger threshold"
  )

  applyDirectionalThreshold(
    "pressure",
    pressure,
    resolvedThresholds.pressure,
    70,
    35,
    "Pressure caution threshold",
    "Pressure danger threshold"
  )

  applyDirectionalThreshold(
    "cloudCover",
    cloudCover,
    resolvedThresholds.cloudCover,
    70,
    35,
    "Cloud cover caution threshold",
    "Cloud cover danger threshold"
  )

  const twilightPhase = getTwilightPhase({
    currentTime: referenceTime ?? new Date(),
    lat,
    lon,
    sunrise,
    sunset,
  })
  const twilightThreshold = resolvedThresholds.twilight
  const twilightValue =
    twilightPhase === "Daylight"
      ? 0
      : twilightPhase === "Twilight"
        ? 1
        : twilightPhase === "Night"
          ? 2
          : null
  if (twilightThreshold && twilightValue !== null) {
    applyDirectionalThreshold(
      "twilight",
      twilightValue,
      twilightThreshold,
      70,
      35,
      "Twilight caution threshold",
      "Twilight danger threshold"
    )
  } else {
    if (twilightPhase === "Twilight") {
      metrics.twilight = "Caution"
      applyReason("Caution", "Twilight operations")
      applyCondition("Caution", 70)
    } else if (twilightPhase === "Night") {
      metrics.twilight = "Danger"
      applyReason("Danger", "Outside daylight hours")
      applyCondition("Danger", 35)
    }
  }

  if (reasons.length === 0) {
    reasons.push("Within recommended limits")
  }

  return {
    status,
    score,
    reasons,
    cautionReasons,
    dangerReasons,
    twilightPhase,
    metrics,
  }
}
