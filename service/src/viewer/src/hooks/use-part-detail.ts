import { createSignal, onCleanup } from "solid-js"
import type { ShareAssistantPart } from "../../../../../shared/types"

type PartDetailInput = {
  shareId: string
  messageIndex: number
  partIndex: number
}

export function usePartDetail(props: PartDetailInput) {
  const [detail, setDetail] = createSignal<ShareAssistantPart | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  let requested = false
  let controller: AbortController | undefined

  const load = () => {
    if (requested) return
    requested = true
    setFailed(false)
    setLoading(true)

    controller?.abort()
    const current = new AbortController()
    controller = current

    void fetch(
      `/api/public/shares/${encodeURIComponent(props.shareId)}/parts/${props.messageIndex}/${props.partIndex}`,
      { signal: current.signal },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { part?: ShareAssistantPart } | null) => {
        if (current.signal.aborted) return
        if (data?.part) {
          setDetail(data.part)
        } else {
          requested = false
          setFailed(true)
        }
      })
      .catch((cause: unknown) => {
        if (current.signal.aborted) return
        if (cause instanceof DOMException && cause.name === "AbortError") return
        requested = false
        setFailed(true)
      })
      .finally(() => {
        if (current.signal.aborted) return
        setLoading(false)
        if (controller === current) controller = undefined
      })
  }

  onCleanup(() => {
    controller?.abort()
    controller = undefined
  })

  return { detail, loading, failed, load }
}
