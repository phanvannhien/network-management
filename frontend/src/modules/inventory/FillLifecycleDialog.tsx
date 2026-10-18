import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatDate } from '@/lib/format'
import { useFillLifecycle } from './devices'

/**
 * Fill empty end-of-sale / end-of-support dates from the model library (P2-22): the server lists what it would write
 * (only empty dates, only devices the user may edit), the user confirms.
 */
export function FillLifecycleDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const preview = useFillLifecycle(orgId)
  const apply = useFillLifecycle(orgId)
  const { mutate } = preview
  useEffect(() => mutate(false), [mutate])
  const rows = preview.data?.devices ?? []
  const date = (d?: string | null) => (d ? formatDate(d) : '—')

  const run = () =>
    apply.mutate(true, {
      onSuccess: (r) => {
        toast.success(t('lifecycleFill.done', { count: r?.devices.length ?? 0 }))
        onClose()
      },
      onError: (e) => toast.error(e.message),
    })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('lifecycleFill.title')}</DialogTitle>
          <DialogDescription>{t('lifecycleFill.intro')}</DialogDescription>
        </DialogHeader>
        {preview.isPending ? (
          <p className="text-sm text-muted-foreground">{t('lifecycleFill.loading')}</p>
        ) : preview.isError ? (
          <p className="text-sm text-status-down">{preview.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('lifecycleFill.none')}</p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-medium">{t('devices.hostname')}</th>
                  <th className="px-2 py-1 font-medium">{t('devices.model')}</th>
                  <th className="px-2 py-1 font-medium">{t('devices.eolDate')}</th>
                  <th className="px-2 py-1 font-medium">{t('devices.eosDate')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-2 py-1 font-mono">{r.hostname}</td>
                    <td className="px-2 py-1">{r.model}</td>
                    <td data-numeric className="px-2 py-1">
                      {date(r.eolDate)}
                    </td>
                    <td data-numeric className="px-2 py-1">
                      {date(r.eosDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t('lifecycleFill.note')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={rows.length === 0 || apply.isPending} onClick={run}>
            {t('lifecycleFill.apply', { count: rows.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
