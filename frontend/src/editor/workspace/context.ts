import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { DocStore, DocStoreApi } from '../doc/store'
import type { Connector } from '../doc/offpage'

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

/** What an off-page connector does when used (P2-08): open where its cables go, or place the far end here. */
export interface ConnectorActions {
  open(c: Connector): void
  place(c: Connector): void
  canEdit: boolean
}

export const ConnectorContext = createContext<ConnectorActions | null>(null)
