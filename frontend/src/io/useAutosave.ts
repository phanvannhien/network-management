import { useEffect } from 'react'
import { replaceDocument } from '../model/commands'
import { fromNtbProjectFile } from '../model/io'
import { useAppStore } from '../model/store'
import { isDirty, loadSession, markSaved, saveSession } from './autosave'

const AUTOSAVE_DEBOUNCE_MS = 30_000 // SRS §8: autosave 30 s + khi đổi

/**
 * Autosave to IndexedDB 30 s after the last change (SRS §8), flushes and warns
 * on page leave, and restores the last session on startup when the document
 * is still empty.
 */
export function useAutosave(): void {
  const data = useAppStore((s) => s.data)

  // Restore the previous session once, only over an empty document.
  useEffect(() => {
    void (async () => {
      try {
        const session = await loadSession()
        const current = useAppStore.getState()
        const isEmpty =
          Object.keys(current.data.devices).length === 0 &&
          Object.keys(current.data.pages).length === 0
        if (session && isEmpty && (session.file.devices?.length ?? 0) > 0) {
          current.dispatch(replaceDocument(fromNtbProjectFile(session.file)))
        }
      } catch {
        // Autosave is best-effort; a broken session must not block the app.
      }
    })()
  }, [])

  // Debounced save 30 s after each change.
  useEffect(() => {
    if (!isDirty(data)) return
    const timer = setTimeout(() => {
      void saveSession(data)
      markSaved(data)
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [data])

  // Flush + warn when the tab is closed, reloaded or hidden.
  useEffect(() => {
    const flush = () => {
      if (isDirty(data)) {
        void saveSession(data)
        markSaved(data)
      }
    }
    const warn = (event: BeforeUnloadEvent) => {
      if (isDirty(data)) {
        flush()
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', warn)
    }
  }, [data])
}
