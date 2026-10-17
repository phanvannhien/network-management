import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { useStore } from 'zustand'
import { api, csrfParam, errorMessage } from '@/api/client'
import i18n from '@/i18n'
import type { DocStoreApi } from '../doc/store'
import { buildCheckInput, runChecks } from './rules'
import type { Problem, ValidationContext } from './types'

// Runs the diagram checks 300 ms after the last change (SRS §7), in a Web Worker when there is one (tests: inline).
// The server context lives under the IPAM query key, so every IPAM write from the panel refreshes it; a save does too.

/** Query key of the validation context; under `['orgs', orgId, 'ipam']` on purpose (see above). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const checksKey = (orgId: string, ids: string) => ['orgs', orgId, 'ipam', 'validation', ids]

export function useChecks(orgId: string, store: DocStoreApi) {
  const qc = useQueryClient()
  const doc = useStore(store, (s) => s.doc)
  const saved = useStore(store, (s) => s.savedDoc)
  const ids = useMemo(() => {
    if (!doc)
      return { devices: [] as string[], groups: [] as string[], ports: [] as string[], key: '' }
    const devices = new Set<string>()
    const groups = new Set<string>()
    for (const n of doc.view.nodes) {
      if (n.refKind === 'device' && !doc.devices[n.refId]?.draft) devices.add(n.refId)
      if (n.refKind === 'endpoint_group') groups.add(n.refId)
    }
    // Ports of unsaved cables, which the server would otherwise leave out when nothing else uses them.
    const ports = new Set<string>()
    for (const l of [...Object.values(doc.newLinks), ...Object.values(doc.linkEdits)])
      for (const end of [l.a, l.b])
        if (end.interfaceId && UUID.test(end.interfaceId)) ports.add(end.interfaceId)
    const d = [...devices].sort()
    const g = [...groups].sort()
    const p = [...ports].sort()
    return { devices: d, groups: g, ports: p, key: `${d.join(',')}|${g.join(',')}|${p.join(',')}` }
  }, [doc])

  const context = useQuery({
    queryKey: checksKey(orgId, ids.key),
    enabled: Boolean(orgId && doc),
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<ValidationContext> => {
      const r = await api.POST('/orgs/{orgId}/validation-context', {
        params: { ...csrfParam, path: { orgId } },
        body: { deviceIds: ids.devices, groupIds: ids.groups, interfaceIds: ids.ports },
      })
      if (r.data) return r.data
      throw new Error(errorMessage(r.error, r.response.status, i18n.t('checks.loadError')))
    },
  })

  // A save may have created devices and cables: fetch again once it lands.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    void qc.invalidateQueries({ queryKey: ['orgs', orgId, 'ipam', 'validation'] })
  }, [saved, qc, orgId])

  const worker = useRef<Worker | null | undefined>(undefined)
  const seq = useRef(0)
  const latest = useRef<ReturnType<typeof buildCheckInput> | null>(null)
  useEffect(() => {
    return () => worker.current?.terminate()
  }, [])

  useEffect(() => {
    const ctx = context.data
    if (!doc || !ctx) return
    const timer = setTimeout(() => {
      const input = buildCheckInput(doc, ctx)
      latest.current = input
      const n = ++seq.current
      if (worker.current === undefined) {
        try {
          worker.current =
            typeof Worker === 'undefined'
              ? null
              : new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
          if (worker.current) {
            // A worker that fails to load or throws: run inline from now on (never freeze on a stale list).
            worker.current.onerror = () => {
              worker.current?.terminate()
              worker.current = null
              if (latest.current) store.getState().setProblems(runChecks(latest.current))
            }
          }
          if (worker.current)
            worker.current.onmessage = (e: MessageEvent<{ seq: number; problems: Problem[] }>) => {
              // Only the newest run counts.
              if (e.data.seq === seq.current) store.getState().setProblems(e.data.problems)
            }
        } catch {
          worker.current = null
        }
      }
      if (worker.current) worker.current.postMessage({ seq: n, input })
      else store.getState().setProblems(runChecks(input))
    }, 300)
    return () => clearTimeout(timer)
  }, [doc, context.data, store])

  return { loading: context.isLoading, error: context.error }
}
