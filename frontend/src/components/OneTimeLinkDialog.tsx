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
import { CopyButton } from './CopyButton'

/** Shows a freshly issued one-time link (invite / password reset) once, with copy. */
export function OneTimeLinkDialog({
  link,
  title,
  description,
  onClose,
}: {
  link: string | null
  title: string
  description: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={link !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1.5">
          <code className="flex-1 font-mono text-tech break-all">{link}</code>
          {link && <CopyButton value={link} label={title} />}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
