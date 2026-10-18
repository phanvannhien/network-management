import { useEffect, useSyncExternalStore } from 'react'

// The help article about the page on screen (P2-24): pages declare it, the "?" button in the top bar opens it.

let topic: string | null = null
const listeners = new Set<() => void>()

function set(next: string | null) {
  topic = next
  for (const l of listeners) l()
}

/** Declares the help article of the current page (slug in docs/help/). */
export function useHelpTopic(slug: string) {
  useEffect(() => {
    set(slug)
    return () => set(null)
  }, [slug])
}

/** The article declared by the page on screen, if any. */
export function useCurrentHelpTopic(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => topic,
  )
}
