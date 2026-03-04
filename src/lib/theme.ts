export type ThemeMode = "light" | "dark"

const STORAGE_KEY = "gi-drone:theme"

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark"
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === "light" || v === "dark" ? v : "dark"
}

export function storeTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, mode)
}

export function applyTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return

  const root = document.documentElement
  const isDark = mode === "dark"

  root.classList.toggle("dark", isDark)
  root.dataset.theme = isDark ? "dark" : "light"
  root.style.colorScheme = isDark ? "dark" : "light"
}
