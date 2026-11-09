import { createContext, createSignal, useContext, type JSX } from "solid-js"

type DisclosureStore = {
  get: (key: string) => boolean | undefined
  set: (key: string, value: boolean) => void
}

const DisclosureContext = createContext<DisclosureStore>()

/** Keep disclosure state scoped to one viewer instance instead of a module global. */
export function DisclosureProvider(props: { children: JSX.Element }) {
  // Each component mirrors its own key in a local signal, so the store itself
  // does not need to be reactive.
  const state = new Map<string, boolean>()

  const store: DisclosureStore = {
    get: (key) => state.get(key),
    set: (key, value) => {
      state.set(key, value)
      // This is only a UI nicety, but an unbounded map would grow for the
      // lifetime of the tab as the reader opens tool cards.
      while (state.size > 500) {
        const oldest = state.keys().next().value
        if (oldest === undefined) break
        state.delete(oldest)
      }
    },
  }

  return <DisclosureContext.Provider value={store}>{props.children}</DisclosureContext.Provider>
}

export function useDisclosure(key: string, initial = false) {
  const store = useContext(DisclosureContext)
  if (!store) throw new Error("useDisclosure must be used inside <DisclosureProvider>")

  const [open, setOpen] = createSignal(store.get(key) ?? initial)

  const set = (next: boolean) => {
    store.set(key, next)
    setOpen(next)
  }

  const toggle = () => set(!open())

  const onToggle = (event: Event) => {
    const next = (event.currentTarget as HTMLDetailsElement).open
    store.set(key, next)
    setOpen(next)
  }

  return {
    open,
    set,
    toggle,
    onToggle,
    hasStoredValue: () => store.get(key) !== undefined,
  }
}
