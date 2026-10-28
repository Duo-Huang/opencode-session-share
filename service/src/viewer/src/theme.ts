export type ThemeMode = "light" | "dark" | "system"

const STORAGE_KEY = "oc-share-theme"

export function normalizeThemeMode(value: string | null | undefined): ThemeMode {
  if (value === "light" || value === "dark" || value === "system") return value
  return "system"
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): "light" | "dark" {
  if (mode === "system") return prefersDark ? "dark" : "light"
  return mode
}

export function loadThemeMode(): ThemeMode {
  try {
    return normalizeThemeMode(localStorage.getItem(STORAGE_KEY))
  } catch {
    return "system"
  }
}

export function storeThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Storage can be unavailable in private or restricted contexts.
  }
}

export function applyTheme(mode: ThemeMode, root: HTMLElement = document.documentElement) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
  const resolved = resolveTheme(mode, prefersDark)
  root.classList.toggle("dark", resolved === "dark")
  root.style.colorScheme = resolved
}
