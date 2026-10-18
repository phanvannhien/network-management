import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

// Shared networks (P2-08, ADR-047): MPLS, Metro, shared LANs — written straight to the inventory from the editor.

export type Segment = components['schemas']['Segment']
export type SegmentInput = components['schemas']['SegmentInput']
export type SegmentKind = components['schemas']['SegmentKind']

export const SEGMENT_KINDS: SegmentKind[] = ['mpls_l3vpn', 'metro_l2', 'shared_lan', 'other']

const key = (orgId: string) => ['orgs', orgId, 'segments'] as const

function fail(error: unknown, status: number, fallback: string): never {
  throw new Error(errorMessage(error, status, fallback))
}

export function useSegments(orgId: string, enabled = true) {
  return useQuery({
    queryKey: key(orgId),
    enabled: enabled && orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/segments', { params: { path: { orgId } } })
      if (r.data) return r.data.segments
      fail(r.error, r.response.status, i18n.t('segments.loadFailed'))
    },
  })
}

export function useSegmentWrites(orgId: string) {
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: key(orgId) })
  return {
    create: async (body: SegmentInput): Promise<Segment> => {
      const r = await api.POST('/orgs/{orgId}/segments', {
        params: { path: { orgId }, ...csrfParam },
        body,
      })
      if (r.data) {
        done()
        return r.data
      }
      return fail(r.error, r.response.status, i18n.t('segments.saveFailed'))
    },
    update: async (id: string, body: SegmentInput & { version: number }): Promise<Segment> => {
      const r = await api.PATCH('/orgs/{orgId}/segments/{segmentId}', {
        params: { path: { orgId, segmentId: id }, ...csrfParam },
        body,
      })
      if (r.data) {
        done()
        return r.data
      }
      return fail(r.error, r.response.status, i18n.t('segments.saveFailed'))
    },
    remove: async (id: string): Promise<void> => {
      const r = await api.DELETE('/orgs/{orgId}/segments/{segmentId}', {
        params: { path: { orgId, segmentId: id }, ...csrfParam },
      })
      if (r.response.ok) return done()
      return fail(r.error, r.response.status, i18n.t('segments.deleteFailed'))
    },
  }
}

/** Form state of a shared network (dialog and panel). */
export interface SegmentDraft {
  name: string
  kind: SegmentKind
  vendorId: string
  serviceId: string
  notes: string
}

export const draftOf = (s?: Segment): SegmentDraft => ({
  name: s?.name ?? '',
  kind: s?.kind ?? 'mpls_l3vpn',
  // A carrier deleted since (no name back) is not kept: saving would be refused.
  vendorId: s?.vendorName ? (s.vendorId ?? '') : '',
  serviceId: s?.serviceId ?? '',
  notes: s?.notes ?? '',
})

export const inputOf = (d: SegmentDraft) => ({
  name: d.name.trim(),
  kind: d.kind,
  vendorId: d.vendorId || null,
  serviceId: d.serviceId.trim(),
  notes: d.notes,
})
