import * as XLSX from 'xlsx'
import type { Device } from './devices'

// Device list to Excel (P1-22): the columns the importer reads (P1-21), so a file goes out and comes back in. The
// customer's convention stays: "Site" is the company (our category), "Location" the place (our site, by code).
// No credential column, ever.

export const EXPORT_HEADERS = [
  'Site',
  'Location',
  'Category',
  'Hostname',
  'Ip Address mgmt',
  'Mgmt interface',
  'PartNumber',
  'Model',
  'Vendor',
  'S/N',
  'Person in charge',
  'Notes',
  // Not read back by the importer, useful to read.
  'Site name',
  'Lifecycle',
  'Firmware',
  'Cluster',
] as const

/** The company a site belongs to: the last level of its category path ("CJ Group › CJ Foodville" → "CJ Foodville"). */
const company = (path: string) => path.split('›').pop()?.trim() ?? ''

/** Rows of the sheet (header first); the management IP without its mask, as people write it. */
export function deviceRows(devices: Device[]): string[][] {
  return [
    [...EXPORT_HEADERS],
    ...devices.map((d) => [
      company(d.categoryPath ?? ''),
      d.siteCode,
      d.type,
      d.hostname,
      (d.mgmtIp ?? '').split('/')[0] ?? '',
      d.mgmtInterfaceName ?? '',
      d.partNumber,
      d.model,
      d.vendor,
      d.serialNumber,
      d.ownerName,
      d.notes,
      d.siteName,
      d.lifecycle,
      d.firmware,
      d.clusterName ?? '',
    ]),
  ]
}

export function downloadDevicesXlsx(devices: Device[], filename: string) {
  const ws = XLSX.utils.aoa_to_sheet(deviceRows(devices))
  ws['!cols'] = EXPORT_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Devices')
  XLSX.writeFile(wb, filename)
}
