import { Lightbulb, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** First-run hints on the canvas (DESIGN.md §4a); hidden for good with the button, back from the toolbar. */
export function Tips({ onHide }: { onHide: () => void }) {
  const { t } = useTranslation()
  const items = ['add', 'select', 'pan', 'remove', 'keys'] as const
  return (
    <section
      aria-labelledby="editor-tips"
      className="absolute bottom-3 left-3 z-10 w-80 space-y-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md"
    >
      <div className="flex items-center gap-2">
        <Lightbulb aria-hidden className="size-4 text-primary" />
        <h2 id="editor-tips" className="flex-1 font-semibold">
          {t('editorCanvas.tipsTitle')}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('editorCanvas.hideTips')}
          onClick={onHide}
        >
          <X aria-hidden />
        </Button>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {items.map((k) => (
          <li key={k}>{t(`editorCanvas.tip.${k}`)}</li>
        ))}
      </ul>
      <Button size="sm" variant="outline" onClick={onHide}>
        {t('editorCanvas.gotIt')}
      </Button>
    </section>
  )
}
