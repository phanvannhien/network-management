import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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

/**
 * Destructive confirmation, two levels (DESIGN.md §8b):
 * - normal: title, description, red confirm button naming the action; Cancel has initial focus;
 * - heavy (`confirmText` set): lists consequences and enables the button only once the user types
 *   `confirmText` exactly (organization name, "Xóa 12 thiết bị", …).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  consequences,
  confirmLabel,
  confirmText,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  consequences?: string[]
  confirmLabel: string
  confirmText?: string
  pending?: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const [typed, setTyped] = useState('')
  const armed = !confirmText || typed === confirmText

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md" role="alertdialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {consequences && consequences.length > 0 && (
          <div className="space-y-1">
            <p className="text-label font-medium text-muted-foreground">
              {t('confirm.consequences')}
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              {consequences.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {confirmText && (
          <label className="block space-y-1">
            <span className="block">{t('confirm.typeToConfirm', { text: confirmText })}</span>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" autoFocus={!confirmText} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={!armed || pending}
            onClick={() => {
              onConfirm()
              setTyped('')
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
