import { useEffect } from 'react'
import { create } from 'zustand'

export interface Crumb {
  label: string
  to?: string
}

export const useCrumbStore = create<{ crumbs: Crumb[]; set: (c: Crumb[]) => void }>((set) => ({
  crumbs: [],
  set: (crumbs) => set({ crumbs }),
}))

/** Pages declare their breadcrumb trail; the AppShell topbar renders it. */
export function useBreadcrumbs(crumbs: Crumb[]): void {
  const set = useCrumbStore((s) => s.set)
  const key = JSON.stringify(crumbs)
  useEffect(() => {
    set(JSON.parse(key) as Crumb[])
    return () => set([])
  }, [key, set])
}
