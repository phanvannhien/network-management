import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { DocStore, DocStoreApi } from '../doc/store'

// The editor's document store, reachable from React Flow node components (which only get ids as props).

export const DocStoreContext = createContext<DocStoreApi | null>(null)

export function useDocStoreApi(): DocStoreApi {
  const store = useContext(DocStoreContext)
  if (!store) throw new Error('DocStoreContext missing')
  return store
}

export function useDoc<T>(selector: (s: DocStore) => T): T {
  return useStore(useDocStoreApi(), selector)
}
