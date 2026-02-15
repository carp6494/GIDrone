export type TimeFormat = "12h" | "24h"

const TIME_FORMAT_KEY = "gi-drone:timeFormat"

export const resolveTimeFormat = (value: string | null | undefined): TimeFormat =>
  value === "12h" ? "12h" : "24h"

export const getStoredTimeFormat = (fallback: TimeFormat = "24h"): TimeFormat => {
  if (typeof window === "undefined") return fallback
  return resolveTimeFormat(window.localStorage.getItem(TIME_FORMAT_KEY))
}

export const setStoredTimeFormat = (format: TimeFormat) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(TIME_FORMAT_KEY, format)
}

const toMillis = (timestamp: number) =>
  timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp

export const formatLocalTime = (
  timestamp: number,
  timeFormat: TimeFormat,
  options: Intl.DateTimeFormatOptions = {}
) => {
  const date = new Date(toMillis(timestamp))
  return date.toLocaleTimeString(undefined, {
    hour: timeFormat === "12h" ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12: timeFormat === "12h",
    ...options,
  })
}

export const formatLocalHour = (
  timestamp: number,
  timeFormat: TimeFormat,
  options: Intl.DateTimeFormatOptions = {}
) => {
  const date = new Date(toMillis(timestamp))
  return date.toLocaleTimeString(undefined, {
    hour: timeFormat === "12h" ? "numeric" : "2-digit",
    hour12: timeFormat === "12h",
    ...options,
  })
}
