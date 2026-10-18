import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { api, csrfParam, errorMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { readWorkbook } from '@/modules/inventory/import/parse'
import { detectColumns, ipamRows, type IpamImportResult, type ParsedRow } from './ipamImport'

const TEMPLATE: string[][] = [
  [
    'Site',
    'VLAN',
    'Tên VLAN',
    'Subnet',
    'Gateway',
    'VRF',
    'Mô tả',
    'IP đầu',
    'IP cuối',
    'Loại dải',
    'Mục đích',
  ],
  [
    'HCM01',
    '10',
    'Văn phòng',
    '10.1.10.0/24',
    '10.1.10.1',
    '',
    'Máy văn phòng',
    '10.1.10.100',
    '10.1.10.200',
    'DHCP',
    'Máy trạm',
  ],
  [
    'HCM01',
    '10',
    'Văn phòng',
    '10.1.10.0/24',
    '',
    '',
    '',
    '10.1.10.10',
    '10.1.10.49',
    'Tĩnh',
    'Máy in, server',
  ],
  [
    'HCM01',
    '20',
    'Camera',
    '10.1.20.0/24',
    '10.1.20.1',
    '',
    'Camera IP',
    '10.1.20.10',
    '10.1.20.250',
    'Tĩnh',
    'Camera',
  ],
  ['', '99', 'Quản trị', '', '', '', '', '', '', '', ''],
]

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet(TEMPLATE)
  ws['!cols'] = TEMPLATE[0]!.map((h) => ({ wch: Math.max(12, h.length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'IP plan')
  XLSX.writeFile(wb, 'ntb-ip-plan-mau.xlsx')
}

type Result = IpamImportResult['rows'][number]

/**
 * IPAM import (P2-09): pick an IP plan spreadsheet, see what each row would do (nothing written yet), then import.
 * Bad rows are listed with the reason and skipped; the others go in.
 */
export function IpamImportDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [file, setFile] = useState('')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [preview, setPreview] = useState<IpamImportResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async (list: ParsedRow[], dryRun: boolean) => {
    const r = await api.POST('/orgs/{orgId}/ipam-imports', {
      params: { path: { orgId }, ...csrfParam },
      body: { dryRun, rows: list.map((x) => x.row) },
    })
    if (r.data) return r.data
    throw new Error(errorMessage(r.error, r.response.status, t('ipamImport.failed')))
  }

  const pick = async (f: File) => {
    setError('')
    setPreview(null)
    setFile(f.name)
    try {
      const sheets = readWorkbook(await f.arrayBuffer())
      const sheet = sheets.find((s) => detectColumns(s)) ?? null
      const found = sheet && detectColumns(sheet)
      if (!sheet || !found) return setError(t('ipamImport.noColumns'))
      const list = ipamRows(sheet, found.header, found.columns)
      if (list.length === 0) return setError(t('ipamImport.empty'))
      setRows(list)
      setBusy(true)
      setPreview(await send(list, true))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    setBusy(true)
    try {
      const done = await send(rows, false)
      await qc.invalidateQueries({ queryKey: ['orgs', orgId, 'ipam'] })
      const c = done.created
      toast.success(
        t('ipamImport.done', {
          vlans: c.vlans,
          subnets: c.subnets,
          ranges: c.ranges,
          errors: done.errors,
        }),
      )
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const willWrite = (preview?.rows ?? []).filter(
    (r) => r.status === 'created' || r.status === 'updated',
  ).length
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('ipamImport.title')}</DialogTitle>
          <DialogDescription>{t('ipamImport.hint')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download aria-hidden /> {t('ipamImport.template')}
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-control px-3 py-1.5 text-sm hover:bg-muted">
            <Upload aria-hidden className="size-4" />
            {file || t('ipamImport.pick')}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void pick(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {preview && (
          <>
            <p className="text-sm">
              {t('ipamImport.summary', {
                vlans: preview.created.vlans,
                subnets: preview.created.subnets,
                ranges: preview.created.ranges,
                updated: preview.updated.subnets,
                errors: preview.errors,
              })}
            </p>
            <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="px-2 py-1">{t('ipamImport.line')}</th>
                    <th className="px-2 py-1">Site</th>
                    <th className="px-2 py-1">VLAN</th>
                    <th className="px-2 py-1">Subnet</th>
                    <th className="px-2 py-1">{t('ipamImport.range')}</th>
                    <th className="px-2 py-1">{t('ipamImport.result')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r: Result) => {
                    const src = rows[r.row]!
                    return (
                      <tr key={r.row} className="border-t border-border align-top">
                        <td className="px-2 py-1 tabular-nums">{src.line}</td>
                        <td className="px-2 py-1">{src.row.site}</td>
                        <td className="px-2 py-1">{src.row.vlan ?? ''}</td>
                        <td className="px-2 py-1 font-mono">{src.row.cidr}</td>
                        <td className="px-2 py-1 font-mono">
                          {src.row.rangeStart &&
                            `${src.row.rangeStart}–${src.row.rangeEnd} ${src.row.rangeKind}`}
                        </td>
                        <td
                          className={cn(
                            'px-2 py-1',
                            r.status === 'error' && 'text-destructive',
                            r.status === 'unchanged' && 'text-muted-foreground',
                          )}
                        >
                          <span className="font-medium">{t(`ipamImport.status.${r.status}`)}</span>
                          {r.status === 'error'
                            ? `: ${r.message}`
                            : r.actions.length > 0 && `: ${r.actions.join('; ')}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !preview || willWrite === 0} onClick={() => void commit()}>
            {t('ipamImport.commit', { count: willWrite })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
