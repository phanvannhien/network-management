import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

export type DeviceImport = components['schemas']['DeviceImport']
export type ImportRowResult = components['schemas']['DeviceImportRowResult']

/** One chunk of the import (≤ 500 rows); dryRun for the preview. */
export async function postImport(orgId: string, body: DeviceImport): Promise<ImportRowResult[]> {
  const r = await api.POST('/orgs/{orgId}/device-imports', {
    params: { ...csrfParam, path: { orgId } },
    body,
  })
  if (r.data) return r.data.results
  throw new Error(errorMessage(r.error, r.response.status, i18n.t('deviceImport.failed')))
}
