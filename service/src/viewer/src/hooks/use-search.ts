import { createSignal, onCleanup } from "solid-js"
import type { SearchResult } from "../lib/types"

export function useSearch(shareId: string) {
  const [query, setQuery] = createSignal("")
  const [results, setResults] = createSignal<SearchResult[]>([])
  const [searching, setSearching] = createSignal(false)
  let timer: number | undefined
  let controller: AbortController | undefined

  const run = async (value: string) => {
    controller?.abort()
    const current = new AbortController()
    controller = current
    setSearching(true)
    try {
      const response = await fetch(
        `/api/public/shares/${encodeURIComponent(shareId)}/search?q=${encodeURIComponent(value)}`,
        { cache: "no-store", signal: current.signal },
      )
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as { results?: SearchResult[] }
      if (query().trim() === value) setResults(data.results ?? [])
    } catch {
      if (!current.signal.aborted) setResults([])
    } finally {
      if (controller === current) setSearching(false)
    }
  }

  const onInput = (value: string) => {
    setQuery(value)
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    controller?.abort()
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > 200) {
      setResults([])
      setSearching(false)
      return
    }
    timer = window.setTimeout(() => {
      timer = undefined
      void run(trimmed)
    }, 200)
  }

  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer)
    controller?.abort()
  })

  return { query, results, searching, onInput }
}
