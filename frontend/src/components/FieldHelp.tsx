import { CircleHelp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { GLOSSARY_BY_ID } from '@/help/glossary'

/**
 * (?) next to a field label: what the term means, a real example, and a link to the glossary page (DESIGN.md §4a).
 * `term` is a glossary id (src/help/glossary.ts).
 */
export function FieldHelp({ term }: { term: string }) {
  const { t, i18n } = useTranslation()
  const { orgId } = useParams()
  const entry = GLOSSARY_BY_ID.get(term)
  if (!entry) return null
  const lang = i18n.language.startsWith('en') ? 'en' : 'vi'
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className="ml-1 inline-grid size-4 place-items-center rounded-full align-[-2px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={t('help.about', { term: entry.term[lang] })}
      >
        <CircleHelp aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-form">
        <p className="font-medium">{entry.term[lang]}</p>
        <p>{entry.what[lang]}</p>
        {entry.example && (
          <p className="text-muted-foreground">
            {t('help.example')}: {entry.example[lang]}
          </p>
        )}
        {orgId && (
          <Link
            to={`/o/${orgId}/glossary#${entry.id}`}
            className="inline-block text-primary hover:underline"
          >
            {t('help.openGlossary')}
          </Link>
        )}
      </PopoverContent>
    </Popover>
  )
}
