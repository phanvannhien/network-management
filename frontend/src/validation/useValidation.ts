import { useEffect } from 'react'
import type { NtbData } from '../model/types'
import { useAppStore } from '../model/store'
import { runValidation } from './engine'
import type { Problem } from './rules'

let worker: Worker | null = null

function getWorker(): Worker | null {
  if (worker !== null) return worker
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<Problem[]>) => {
      useAppStore.getState().setProblems(event.data)
    }
    return worker
  } catch {
    return null // e.g. test environment without Worker support
  }
}

/**
 * Runs validation 300 ms after the last model change (SRS §6), inside a Web
 * Worker when available, with a synchronous fallback. Results go to the store.
 */
export function useValidation(): void {
  const data = useAppStore((s) => s.data)

  useEffect(() => {
    const timer = setTimeout(() => {
      const w = getWorker()
      if (w) {
        w.postMessage(data as NtbData)
      } else {
        useAppStore.getState().setProblems(runValidation(data))
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [data])
}
