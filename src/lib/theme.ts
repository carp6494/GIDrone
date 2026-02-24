export type ThemeMode = "system" | "light" | "dark"

const STORAGE_KEY = "gi-drone:theme"

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system"
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === "light" || v === "dark" || v === "system" ? v : "system"
}

export function storeTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, mode)
}

export function applyTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return

  const root = document.documentElement
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false
  const isDark = mode === "dark" || (mode === "system" && prefersDark)

  root.classList.toggle("dark", isDark)
}
