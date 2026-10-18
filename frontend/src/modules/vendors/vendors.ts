import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

// Vendors, contacts, contracts and contract files (P2-04, ADR-044).

export type Vendor = components['schemas']['Vendor']
export type VendorInput = components['schemas']['VendorInput']
export type VendorKind = components['schemas']['VendorKind']
export type VendorContact = components['schemas']['VendorContact']
export type VendorContactInput = components['schemas']['VendorContactInput']
export type Contract = components['schemas']['Contract']
export type ContractInput = components['schemas']['ContractInput']
export type ContractKind = components['schemas']['ContractKind']
export type ContractDetail = components['schemas']['ContractDetail']
export type ContractFile = components['schemas']['ContractFile']

export const VENDOR_KINDS: VendorKind[] = [
  'manufacturer',
  'supplier',
  'isp',
  'maintenance',
  'customer',
  'other',
]
export const CONTRACT_KINDS: ContractKind[] = [
  'support',
  'warranty',
  'license',
  'isp',
  'maintenance',
  'other',
]

function fail(error: unknown, status: number, fallback: string): never {
  throw new Error(errorMessage(error, status, fallback))
}

const keys = {
  all: (orgId: string) => ['orgs', orgId, 'vendors'] as const,
  vendors: (orgId: string, q: string, kind: string) =>
    ['orgs', orgId, 'vendors', 'list', q, kind] as const,
  vendor: (orgId: string, id: string) => ['orgs', orgId, 'vendors', 'one', id] as const,
  contracts: (orgId: string, p: ContractQuery) =>
    ['orgs', orgId, 'vendors', 'contracts', p] as const,
  contract: (orgId: string, id: string) => ['orgs', orgId, 'vendors', 'contract', id] as const,
}

/** Vendors, contacts and contracts share one cache prefix: a change refreshes every view of them. */
function useInvalidate(orgId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: keys.all(orgId) })
    // Bell and dashboard count contract ends; devices show their supplier.
    void qc.invalidateQueries({ queryKey: ['orgs', orgId, 'notifications'] })
  }
}

export function useVendors(orgId: string, q = '', kind = '', enabled = true) {
  return useQuery({
    queryKey: keys.vendors(orgId, q, kind),
    enabled: enabled && orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/vendors', {
        params: {
          path: { orgId },
          query: { q: q.trim() || undefined, kind: (kind || undefined) as VendorKind | undefined },
        },
      })
      if (r.data) return r.data.vendors
      fail(r.error, r.response.status, i18n.t('vendors.loadFailed'))
    },
  })
}

export function useVendor(orgId: string, vendorId: string) {
  return useQuery({
    queryKey: keys.vendor(orgId, vendorId),
    enabled: orgId !== '' && vendorId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/vendors/{vendorId}', {
        params: { path: { orgId, vendorId } },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('vendors.loadFailed'))
    },
  })
}

export function useVendorMutations(orgId: string) {
  const invalidate = useInvalidate(orgId)
  const save = useMutation({
    mutationFn: async (v: { id?: string; body: VendorInput }) => {
      const r = v.id
        ? await api.PATCH('/orgs/{orgId}/vendors/{vendorId}', {
            params: { ...csrfParam, path: { orgId, vendorId: v.id } },
            body: v.body,
          })
        : await api.POST('/orgs/{orgId}/vendors', {
            params: { ...csrfParam, path: { orgId } },
            body: v.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (vendorId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/vendors/{vendorId}', {
        params: { ...csrfParam, path: { orgId, vendorId } },
      })
      if (!r.response.ok) fail(r.error, r.response.status, i18n.t('errors.delete'))
    },
    onSettled: invalidate,
  })
  const saveContact = useMutation({
    mutationFn: async (v: { vendorId: string; id?: string; body: VendorContactInput }) => {
      const r = v.id
        ? await api.PATCH('/orgs/{orgId}/vendor-contacts/{contactId}', {
            params: { ...csrfParam, path: { orgId, contactId: v.id } },
            body: v.body,
          })
        : await api.POST('/orgs/{orgId}/vendors/{vendorId}/contacts', {
            params: { ...csrfParam, path: { orgId, vendorId: v.vendorId } },
            body: v.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
  const removeContact = useMutation({
    mutationFn: async (contactId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/vendor-contacts/{contactId}', {
        params: { ...csrfParam, path: { orgId, contactId } },
      })
      if (!r.response.ok) fail(r.error, r.response.status, i18n.t('errors.delete'))
    },
    onSettled: invalidate,
  })
  return { save, remove, saveContact, removeContact }
}

export interface ContractQuery {
  q?: string
  vendorId?: string
  deviceId?: string
  linkId?: string
  endsWithinDays?: number
}

export function useContracts(orgId: string, p: ContractQuery, enabled = true) {
  return useQuery({
    queryKey: keys.contracts(orgId, p),
    enabled: enabled && orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/contracts', {
        params: { path: { orgId }, query: { ...p, q: p.q?.trim() || undefined } },
      })
      if (r.data) return r.data.contracts
      fail(r.error, r.response.status, i18n.t('contracts.loadFailed'))
    },
  })
}

export function useContract(orgId: string, contractId: string) {
  return useQuery({
    queryKey: keys.contract(orgId, contractId),
    enabled: orgId !== '' && contractId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/contracts/{contractId}', {
        params: { path: { orgId, contractId } },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('contracts.loadFailed'))
    },
  })
}

export function useContractMutations(orgId: string) {
  const invalidate = useInvalidate(orgId)
  const save = useMutation({
    mutationFn: async (v: { id?: string; body: ContractInput }) => {
      const r = v.id
        ? await api.PATCH('/orgs/{orgId}/contracts/{contractId}', {
            params: { ...csrfParam, path: { orgId, contractId: v.id } },
            body: v.body,
          })
        : await api.POST('/orgs/{orgId}/contracts', {
            params: { ...csrfParam, path: { orgId } },
            body: v.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (contractId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/contracts/{contractId}', {
        params: { ...csrfParam, path: { orgId, contractId } },
      })
      if (!r.response.ok) fail(r.error, r.response.status, i18n.t('errors.delete'))
    },
    onSettled: invalidate,
  })
  const upload = useMutation({
    mutationFn: async (v: { contractId: string; file: File }) => {
      const r = await api.POST('/orgs/{orgId}/contracts/{contractId}/files', {
        params: { ...csrfParam, path: { orgId, contractId: v.contractId } },
        // openapi-fetch sends JSON by default: the file goes as multipart/form-data.
        body: { file: v.file as unknown as string },
        bodySerializer: () => {
          const fd = new FormData()
          fd.append('file', v.file)
          return fd
        },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('contracts.uploadFailed'))
    },
    onSettled: invalidate,
  })
  const removeFile = useMutation({
    mutationFn: async (fileId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/files/{fileId}', {
        params: { ...csrfParam, path: { orgId, fileId } },
      })
      if (!r.response.ok) fail(r.error, r.response.status, i18n.t('errors.delete'))
    },
    onSettled: invalidate,
  })
  return { save, remove, upload, removeFile }
}

export function fileUrl(orgId: string, fileId: string): string {
  return `/api/orgs/${orgId}/files/${fileId}`
}

export function useSetSupplier(orgId: string, deviceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (supplierId: string | null) => {
      const r = await api.PUT('/orgs/{orgId}/devices/{deviceId}/supplier', {
        params: { ...csrfParam, path: { orgId, deviceId } },
        body: { supplierId },
      })
      if (!r.response.ok) fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['orgs', orgId, 'devices'] }),
  })
}
