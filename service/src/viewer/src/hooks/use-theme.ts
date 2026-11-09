import { createSignal, onCleanup, onMount } from "solid-js"
import { MoonIcon, MonitorIcon, SunIcon } from "../components/icons"
import { applyTheme, loadThemeMode, storeThemeMode, type ThemeMode } from "../theme"

const themeOptions = [
  { mode: "light" as const, label: "Light", icon: SunIcon },
  { mode: "dark" as const, label: "Dark", icon: MoonIcon },
  { mode: "system" as const, label: "System", icon: MonitorIcon },
]

export function useTheme() {
  const [mode, setMode] = createSignal<ThemeMode>(loadThemeMode())

  const choose = (next: ThemeMode) => {
    setMode(next)
    storeThemeMode(next)
    applyTheme(next)
  }

  const currentOption = () =>
    themeOptions.find((option) => option.mode === mode()) ?? themeOptions[2]

  const nextOption = () => {
    const index = themeOptions.findIndex((option) => option.mode === mode())
    return themeOptions[(index + 1) % themeOptions.length]
  }

  const cycle = () => choose(nextOption().mode)

  onMount(() => {
    applyTheme(mode())
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      if (mode() === "system") applyTheme("system")
    }
    media.addEventListener("change", onChange)
    onCleanup(() => media.removeEventListener("change", onChange))
  })

  return { mode, choose, cycle, currentOption, nextOption }
}
