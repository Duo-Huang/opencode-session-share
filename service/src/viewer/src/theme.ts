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

const transitionTimers = new WeakMap<HTMLElement, number>()

export function applyTheme(mode: ThemeMode, root: HTMLElement = document.documentElement) {
  const win = root.ownerDocument?.defaultView
  const prefersDark = win?.matchMedia("(prefers-color-scheme: dark)").matches ?? false
  const resolved = resolveTheme(mode, prefersDark)

  // Suppress transitions for the swap itself. Otherwise elements with
  // color/background transitions (toggle pills, directory ticks, controls)
  // visibly lag behind the rest of the page.
  root.classList.add("theme-switching")
  const previous = transitionTimers.get(root)
  if (previous !== undefined) win?.clearTimeout(previous)
  transitionTimers.delete(root)

  root.classList.toggle("dark", resolved === "dark")
  root.style.colorScheme = resolved

  if (!win) {
    root.classList.remove("theme-switching")
    return
  }

  const timer = win.setTimeout(() => {
    transitionTimers.delete(root)
    root.classList.remove("theme-switching")
  }, 120)
  transitionTimers.set(root, timer)
}
