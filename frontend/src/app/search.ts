import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

export type SearchResult = components['schemas']['SearchResult']

/** Text shorter than this is matched in the browser only (pages, sites…); the server search starts here. */
export const SEARCH_MIN = 2

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/** Global search (P1-23): devices, addresses, MACs and endpoint groups of the organization matching `q`. */
export function useGlobalSearch(orgId: string, q: string) {
  const text = q.trim()
  return useQuery({
    queryKey: ['orgs', orgId, 'search', text],
    enabled: orgId !== '' && text.length >= SEARCH_MIN,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/search', {
        params: { path: { orgId }, query: { q: text } },
      })
      if (r.data) return r.data
      throw new Error(errorMessage(r.error, r.response.status, i18n.t('errors.searchFailed')))
    },
  })
}
