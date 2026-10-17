import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSites } from '@/modules/sites/sites'

type Preview = components['schemas']['NtbPreview']
type Action = 'reuse' | 'update' | 'create' | 'skip'

/**
 * Import a .ntb.json file as a new diagram (P1-22, ADR-037): the server checks the file and proposes where its sites
 * go; the user confirms each site and what to do with devices whose hostname is already in the target site (default:
 * use the one there). Everything is written in one go; the new diagram opens.
 */
export function NtbImportDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const sites = useSites(orgId)
  const [file, setFile] = useState<Record<string, unknown> | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [siteMap, setSiteMap] = useState<Record<string, string>>({})
  const [actions, setActions] = useState<Record<string, Action>>({})
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setBusy(true)
    try {
      const doc = JSON.parse(await f.text()) as Record<string, unknown>
      const r = await api.POST('/orgs/{orgId}/ntb-imports/preview', {
        params: { ...csrfParam, path: { orgId } },
        body: { file: doc },
      })
      if (!r.data) throw new Error(errorMessage(r.error, r.response.status, t('ntbImport.failed')))
      setFile(doc)
      setPreview(r.data)
      setName(`${r.data.diagramName} (${t('ntbImport.suffix')})`)
      setSiteMap(
        Object.fromEntries(r.data.sites.filter((s) => s.siteId).map((s) => [s.ref, s.siteId!])),
      )
      setActions({})
    } catch (err) {
      toast.error(
        err instanceof SyntaxError
          ? t('ntbImport.notJson')
          : err instanceof Error
            ? err.message
            : String(err),
      )
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    if (!file || !preview) return
    setBusy(true)
    try {
      const r = await api.POST('/orgs/{orgId}/ntb-imports', {
        params: { ...csrfParam, path: { orgId } },
        body: { file, siteMap, deviceActions: actions, diagramName: name.trim() },
      })
      if (!r.data) throw new Error(errorMessage(r.error, r.response.status, t('ntbImport.failed')))
      const c = r.data.created
      toast.success(
        t('ntbImport.done', {
          devices: c.devices,
          links: c.links,
          groups: c.endpointGroups,
          reused: r.data.reused,
        }),
      )
      for (const w of r.data.warnings.slice(0, 5)) toast.warning(w)
      void qc.invalidateQueries({ queryKey: ['orgs', orgId] })
      void navigate(`/o/${orgId}/diagrams/${r.data.diagramId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const conflicts = (preview?.devices ?? []).filter((d) => d.existingId && siteMap[d.siteRef])
  const missingSite = (preview?.sites ?? []).some((s) => !siteMap[s.ref])

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={t('ntbImport.title')} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('ntbImport.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground">{t('ntbImport.body')}</p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border-control px-4 py-3 hover:bg-accent">
          <Upload aria-hidden className="size-4" />
          <span>{preview ? preview.diagramName : t('ntbImport.pick')}</span>
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label={t('ntbImport.pick')}
            onChange={(e) => void onFile(e)}
          />
        </label>
        {preview && (
          <div className="max-h-[50vh] space-y-3 overflow-y-auto">
            <p className="text-sm">
              {t('ntbImport.counts', {
                devices: preview.counts.devices,
                links: preview.counts.links,
                groups: preview.counts.endpointGroups,
                clusters: preview.counts.clusters,
              })}
            </p>
            <section className="space-y-1.5">
              <h3 className="text-sm font-medium">{t('ntbImport.sites')}</h3>
              <p className="text-xs text-muted-foreground">{t('ntbImport.sitesGuide')}</p>
              {preview.sites.map((s) => (
                <div
                  key={s.ref}
                  className="grid grid-cols-[minmax(8rem,1fr)_minmax(12rem,1.4fr)] items-center gap-3"
                >
                  <span className="truncate text-sm">
                    <span className="font-mono">{s.code}</span> · {s.name}
                  </span>
                  <NativeSelect
                    aria-label={t('ntbImport.siteFor', { code: s.code })}
                    value={siteMap[s.ref] ?? ''}
                    onChange={(e) => setSiteMap((m) => ({ ...m, [s.ref]: e.target.value }))}
                  >
                    <option value="">{t('ntbImport.pickSite')}</option>
                    {(sites.data ?? []).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.code} · {x.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ))}
            </section>
            {conflicts.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-sm font-medium">
                  {t('ntbImport.conflicts', { count: conflicts.length })}
                </h3>
                <p className="text-xs text-muted-foreground">{t('ntbImport.conflictsGuide')}</p>
                {conflicts.map((d) => (
                  <div
                    key={d.ref}
                    className="grid grid-cols-[minmax(8rem,1fr)_minmax(12rem,1.4fr)] items-center gap-3"
                  >
                    <span className="truncate font-mono text-sm">{d.hostname}</span>
                    <NativeSelect
                      aria-label={t('ntbImport.actionFor', { host: d.hostname })}
                      value={actions[d.ref] ?? 'reuse'}
                      onChange={(e) =>
                        setActions((a) => ({ ...a, [d.ref]: e.target.value as Action }))
                      }
                    >
                      {(['reuse', 'update', 'create', 'skip'] as const).map((a) => (
                        <option key={a} value={a}>
                          {t(`ntbImport.actions.${a}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ))}
              </section>
            )}
            <FormField label={t('ntbImport.name')} required>
              {(p) => (
                <Input
                  {...p}
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </FormField>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!preview || busy || missingSite || !name.trim()}
            onClick={() => void run()}
          >
            {busy ? t('ntbImport.working') : t('ntbImport.run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
