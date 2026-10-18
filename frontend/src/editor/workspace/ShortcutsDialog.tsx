import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { displayKeys, SHORTCUTS } from './shortcuts'

/** The "?" sheet: every editor shortcut with what it does (SRS §6.4). */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={t('editorCanvas.shortcuts')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editorCanvas.shortcuts')}</DialogTitle>
        </DialogHeader>
        <ShortcutsList />
      </DialogContent>
    </Dialog>
  )
}

/** Every editor shortcut with what it does (also in Help → Keyboard shortcuts). */
export function ShortcutsList() {
  const { t } = useTranslation()
  return (
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
      {SHORTCUTS.map((s) => (
        <div key={s.id} className="contents">
          <dt className="flex gap-1">
            {displayKeys(s.id).map((k) => (
              <kbd
                key={k}
                className="rounded-sm border border-border bg-muted px-1.5 font-mono text-[11px]"
              >
                {k}
              </kbd>
            ))}
          </dt>
          <dd>{t(`editorCanvas.keys.${s.id}`)}</dd>
        </div>
      ))}
    </dl>
  )
}
