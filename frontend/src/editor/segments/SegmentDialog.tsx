import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useVendors } from '@/modules/vendors/vendors'
import {
  draftOf,
  inputOf,
  SEGMENT_KINDS,
  useSegments,
  useSegmentWrites,
  type Segment,
  type SegmentDraft,
  type SegmentKind,
} from './segments'

/** The editable fields of a shared network (dialog and panel). */
export function SegmentFields({
  orgId,
  value,
  onChange,
}: {
  orgId: string
  value: SegmentDraft
  onChange: (v: SegmentDraft) => void
}) {
  const { t } = useTranslation()
  const vendors = useVendors(orgId)
  return (
    <>
      <FormField label={t('segments.name')} guide={t('segments.nameHint')} required>
        {(p) => (
          <Input
            {...p}
            value={value.name}
            maxLength={100}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        )}
      </FormField>
      <FormField label={t('segments.kind')} guide={t('segments.kindHint')} help="segment" required>
        {(p) => (
          <NativeSelect
            {...p}
            value={value.kind}
            onChange={(e) => onChange({ ...value, kind: e.target.value as SegmentKind })}
          >
            {SEGMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`segments.kinds.${k}`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField label={t('segments.vendor')}>
        {(p) => (
          <NativeSelect
            {...p}
            value={value.vendorId}
            onChange={(e) => onChange({ ...value, vendorId: e.target.value })}
          >
            <option value="">{t('segments.vendorNone')}</option>
            {(vendors.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField label={t('segments.serviceId')} guide={t('segments.serviceHint')}>
        {(p) => (
          <Input
            {...p}
            value={value.serviceId}
            maxLength={100}
            onChange={(e) => onChange({ ...value, serviceId: e.target.value })}
          />
        )}
      </FormField>
      <FormField label={t('segments.notes')}>
        {(p) => (
          <Textarea
            {...p}
            value={value.notes}
            maxLength={2000}
            rows={2}
            onChange={(e) => onChange({ ...value, notes: e.target.value })}
          />
        )}
      </FormField>
    </>
  )
}

/**
 * Place a shared network (P2-08): one already in the inventory, or a new one (created at once — it is not drafted with
 * the diagram, like IPAM writes from the panel, ADR-034).
 */
export function SegmentDialog({
  orgId,
  onPlace,
  onClose,
}: {
  orgId: string
  onPlace: (s: Segment) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const list = useSegments(orgId)
  const writes = useSegmentWrites(orgId)
  const [picked, setPicked] = useState('')
  const [draft, setDraft] = useState<SegmentDraft>(draftOf())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const existing = list.data?.find((s) => s.id === picked)
    if (existing) return onPlace(existing)
    setBusy(true)
    setError('')
    try {
      const created = await writes.create(inputOf(draft))
      toast.success(t('segments.saved'))
      onPlace(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => void submit(e)}
          className="space-y-4"
          aria-label={t('segments.dialogTitle')}
        >
          <DialogHeader>
            <DialogTitle>{t('segments.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('segments.libraryHint')}</DialogDescription>
          </DialogHeader>
          {(list.data?.length ?? 0) > 0 && (
            <FormField label={t('segments.pick')}>
              {(p) => (
                <NativeSelect {...p} value={picked} onChange={(e) => setPicked(e.target.value)}>
                  <option value="">{t('segments.pickNone')}</option>
                  {list.data!.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {t(`segments.kinds.${s.kind}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          )}
          {!picked && <SegmentFields orgId={orgId} value={draft} onChange={setDraft} />}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || (!picked && draft.name.trim() === '')}>
              {t('segments.place')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
