import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { Connector } from '../doc/offpage'
import { pageLabel } from '../doc/pages'
import { ConnectorContext, useDoc } from './context'
import { portLabel } from './wiring'

export interface OffPageData extends Record<string, unknown> {
  connector: Connector
}

export type OffPageFlowNode = Node<OffPageData>

/**
 * An off-page connector (P2-08): the arrow-tag symbol of Visio's off-page reference. It says where the cables go —
 * another page, another diagram, or nowhere yet — and leads there on click; one with nowhere to go offers to place
 * the far device on this page.
 */
function OffPageNodeImpl({ data }: NodeProps<OffPageFlowNode>) {
  const { t } = useTranslation()
  const actions = useContext(ConnectorContext)
  const c = data.connector
  const portStyle = useDoc((s) => s.doc?.view.portStyle) ?? 'compact'
  const pageName = useDoc((s) => {
    if (c.target.kind !== 'page' || !s.doc?.view.pages) return ''
    const i = s.doc.view.pages.findIndex((p) => p.id === (c.target as { pageId: string }).pageId)
    return i >= 0 ? pageLabel(s.doc.view.pages[i]!, i, t) : ''
  })
  const where =
    c.target.kind === 'page'
      ? `→ ${pageName}`
      : c.target.kind === 'diagram'
        ? `→ ${t('offPage.diagram', { name: c.target.name })}`
        : t('offPage.nowhere')
  const single = c.far.length === 1 ? c.far[0]! : null
  const what = single
    ? `${single.name}${single.port && c.links.length === 1 ? ` ${portLabel(single.port, portStyle)}` : ''}`
    : c.far.map((f) => f.name).join(', ')
  const count = c.links.length > 1 ? ` (${t('l2.cables', { count: c.links.length })})` : ''
  const canOpen = c.target.kind !== 'none'
  // A device or endpoint group can be placed from here; a shared network is placed from the library.
  const canPlace =
    c.target.kind === 'none' && actions?.canEdit && single !== null && single.kind !== 'segment'
  const label = `${where} · ${what}${count}`
  return (
    <div className="group relative flex items-center">
      <Handle type="target" position={Position.Left} isConnectable={false} className="ntb-handle" />
      <button
        type="button"
        title={canOpen ? t('offPage.open') : t('offPage.nowhereHint')}
        aria-label={label}
        disabled={!canOpen}
        onClick={() => canOpen && actions?.open(c)}
        className={cn(
          'nodrag flex max-w-56 flex-col items-start border bg-card py-0.5 pr-5 pl-2 text-left text-[10px] leading-tight shadow-sm',
          canOpen
            ? 'cursor-pointer border-border-control hover:border-primary'
            : 'cursor-default border-dashed border-border',
        )}
        // Arrow tag: the pointed right side says "continues there".
        style={{
          clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)',
        }}
      >
        <span className="font-semibold">{where}</span>
        <span className="max-w-full truncate font-mono text-muted-foreground">
          {what}
          {count}
        </span>
      </button>
      {canPlace && (
        <button
          type="button"
          className="ntb-no-export nodrag ml-1 rounded-sm border border-border bg-background px-1 text-[10px] whitespace-nowrap hover:border-primary"
          onClick={() => actions?.place(c)}
        >
          {t('offPage.place')}
        </button>
      )}
    </div>
  )
}

export const OffPageNode = memo(OffPageNodeImpl)
