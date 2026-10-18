import { Camera } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { CatalogModel } from './devices'
import { catalogImageUrl, usePhotoModel, usePhotoViewer, type PhotoSubject } from './photos'

// Product photo dialog and buttons (P2-12, ADR-041).

/** Front / rear photo of a model in a dialog. */
function PhotoDialog({
  orgId,
  model,
  title,
  onClose,
}: {
  orgId: string
  model: CatalogModel
  /** What is shown (the device's hostname); the model is named under it. */
  title?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const sides = (['front', 'rear'] as const).filter((s) => model.images[s])
  const [side, setSide] = useState(sides[0] ?? 'front')
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const file = model.images[side]
  const name = `${model.vendor} ${model.model}`
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title ? `${title} — ${name}` : name}</DialogTitle>
        </DialogHeader>
        {sides.length > 1 && (
          <div role="group" aria-label={t('photos.side')} className="flex gap-1">
            {sides.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === side ? 'default' : 'outline'}
                aria-pressed={s === side}
                onClick={() => setSide(s)}
              >
                {t(`photos.${s}`)}
              </Button>
            ))}
          </div>
        )}
        <div className="flex min-h-24 items-center justify-center overflow-auto rounded-md border border-border bg-muted/40 p-2">
          {failed[file] ? (
            <p className="text-sm text-muted-foreground">{t('photos.failed')}</p>
          ) : (
            <img
              key={file}
              src={catalogImageUrl(orgId, file)}
              alt={t('photos.alt', { name, side: t(`photos.${side}`) })}
              className="max-h-[60vh] w-full object-contain"
              onError={() => setFailed((f) => ({ ...f, [file]: true }))}
            />
          )}
        </div>
        {model.images.similarTo && (
          // No photo of this exact model: a sibling on the same chassis (other uplinks / PoE) stands in, said plainly.
          <p role="note" className="text-sm text-status-warning">
            {t('photos.similar', { model: model.images.similarTo })}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {model.partNumbers[0] && <span className="font-mono">{model.partNumbers[0]} · </span>}
          {t('photos.credit')}{' '}
          <a
            href={model.images.source}
            target="_blank"
            rel="noreferrer noopener"
            className="underline"
          >
            {t('photos.creditLink')}
          </a>
        </p>
      </DialogContent>
    </Dialog>
  )
}

/** "View photo" button; nothing when the model has no photo. */
export function PhotoButton({
  orgId,
  subject,
  title,
  variant = 'button',
  className,
  onOpen,
}: {
  orgId: string
  subject: PhotoSubject | undefined
  title?: string
  /** `icon`: a small round button (on a diagram node). */
  variant?: 'button' | 'icon'
  className?: string
  onOpen?: () => void
}) {
  const { t } = useTranslation()
  const model = usePhotoModel(orgId, subject)
  const show = usePhotoViewer((s) => s.show)
  if (!model) return null
  const label = title ? t('photos.viewFor', { name: title }) : t('photos.view')
  const open = () => {
    onOpen?.()
    show(model, title)
  }
  return variant === 'icon' ? (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'nodrag nopan flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation()
        open()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Camera aria-hidden className="size-3.5" />
    </button>
  ) : (
    <Button size="sm" variant="outline" className={className} onClick={open}>
      <Camera aria-hidden />
      {t('photos.view')}
    </Button>
  )
}

/** The page's photo viewer (see usePhotoViewer). */
export function PhotoViewer({ orgId }: { orgId: string }) {
  const shown = usePhotoViewer((s) => s.shown)
  const close = usePhotoViewer((s) => s.close)
  if (!shown) return null
  return (
    <PhotoDialog
      key={shown.model.id}
      orgId={orgId}
      model={shown.model}
      title={shown.title}
      onClose={close}
    />
  )
}
