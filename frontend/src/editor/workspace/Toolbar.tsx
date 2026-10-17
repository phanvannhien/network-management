import { useStore as useFlowStore } from '@xyflow/react'
import {
  ArrowLeft,
  CircleCheck,
  Cable,
  Hand,
  MousePointer2,
  Keyboard,
  LibraryBig,
  Lightbulb,
  Magnet,
  MoveUpRight,
  SquareDashed,
  Type,
  PanelRight,
  Map as MapIcon,
  Maximize,
  Plus,
  Redo2,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { NativeSelect } from '@/components/NativeSelect'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SeverityIcon } from '../checks/SeverityIcon'
import type { Severity } from '../checks/types'
import type { SaveStatus } from '../doc/store'
import { GRID_SIZES, type GridSize } from './flow'
import { togglePanel, type EditorPrefs } from './prefs'
import { keysLabel, shortcutOf, type ShortcutId } from './shortcuts'

/** Tooltip "Name (keys)" on every toolbar button (DESIGN.md §4a). */
function Tip({
  label,
  shortcut,
  children,
}: {
  label: string
  shortcut?: ShortcutId
  children: ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="bottom">
        {label}
        {shortcut && (
          <kbd data-slot="kbd" className="ml-1 font-mono opacity-80">
            {keysLabel(shortcut)}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function ToolButton({
  label,
  shortcut,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string
  shortcut?: ShortcutId
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <Button
        variant={pressed ? 'secondary' : 'ghost'}
        size="icon"
        className="size-8"
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut ? shortcutOf(shortcut).aria : undefined}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tip>
  )
}

const Divider = () => <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />

export interface ToolbarProps {
  orgId: string
  name: string
  layer: string
  status: SaveStatus
  pending: number
  canEdit: boolean
  canUndo: boolean
  canRedo: boolean
  prefs: EditorPrefs
  onPrefs: (patch: Partial<EditorPrefs>) => void
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onFit: () => void
  onHelp: () => void
  onQuickAdd: () => void
  connecting: boolean
  onConnect: () => void
  /** Hand tool: dragging anywhere moves the view (Space + drag does it any time). */
  hand: boolean
  onHand: () => void
  /** Back to the pointer: hand tool and connect mode off. */
  onPointer: () => void
  onAddFrame: () => void
  onAddText: () => void
  onAddArrow: () => void
  /** Check results per level (P1-20). */
  problems: Record<Severity, number>
  problemsOpen: boolean
  onProblems: () => void
}

/** Floating toolbar over the canvas (P1-14). */
export function Toolbar(p: ToolbarProps) {
  const { t } = useTranslation()
  const zoom = useFlowStore((s) => s.transform[2])
  return (
    <div
      role="toolbar"
      aria-label={t('editorCanvas.toolbar')}
      className="absolute inset-x-3 top-3 z-10 mx-auto flex w-fit flex-wrap items-center gap-1 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <Tip label={t('editorCanvas.back')}>
        <Link
          to={`/o/${p.orgId}/diagrams`}
          aria-label={t('editorCanvas.back')}
          className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'size-8' })}
        >
          <ArrowLeft aria-hidden />
        </Link>
      </Tip>
      <div className="min-w-0 px-1">
        <h1 className="max-w-56 truncate text-sm leading-tight font-semibold">{p.name}</h1>
        <p className="text-[11px] leading-tight text-muted-foreground" aria-live="polite">
          {p.layer} · {t(`editorDoc.status.${p.status}`)}
          {p.pending > 0 && ` · ${t('editorDoc.pending', { count: p.pending })}`}
          {!p.canEdit && ` · ${t('editorCanvas.viewOnly')}`}
        </p>
      </div>
      <Divider />
      <ToolButton
        label={t('editorDoc.undo')}
        shortcut="undo"
        onClick={p.onUndo}
        disabled={!p.canUndo}
      >
        <Undo2 aria-hidden />
      </ToolButton>
      <ToolButton
        label={t('editorDoc.redo')}
        shortcut="redo"
        onClick={p.onRedo}
        disabled={!p.canRedo}
      >
        <Redo2 aria-hidden />
      </ToolButton>
      {/* Tools: exactly one is on — pointer (select / move), hand (move the view), or connect mode below. */}
      <ToolButton
        label={t('editorCanvas.pointer')}
        shortcut="pointer"
        onClick={p.onPointer}
        pressed={!p.hand && !p.connecting}
      >
        <MousePointer2 aria-hidden />
      </ToolButton>
      <ToolButton
        label={t('editorCanvas.hand')}
        shortcut="hand"
        onClick={p.onHand}
        pressed={p.hand}
      >
        <Hand aria-hidden />
      </ToolButton>
      {p.canEdit && (
        <>
          <ToolButton
            label={t('library.title')}
            shortcut="library"
            onClick={() => p.onPrefs(togglePanel(p.prefs, 'library'))}
            pressed={p.prefs.library && !p.prefs.libraryMin}
          >
            <LibraryBig aria-hidden />
          </ToolButton>
          <ToolButton label={t('library.quickTitle')} shortcut="quickAdd" onClick={p.onQuickAdd}>
            <Plus aria-hidden />
          </ToolButton>
          <ToolButton
            label={t('cable.connectTool')}
            shortcut="connect"
            onClick={p.onConnect}
            pressed={p.connecting}
          >
            <Cable aria-hidden />
          </ToolButton>
          <ToolButton label={t('frames.addFrame')} shortcut="group" onClick={p.onAddFrame}>
            <SquareDashed aria-hidden />
          </ToolButton>
          <ToolButton label={t('frames.addText')} onClick={p.onAddText}>
            <Type aria-hidden />
          </ToolButton>
          <ToolButton label={t('frames.addArrow')} onClick={p.onAddArrow}>
            <MoveUpRight aria-hidden />
          </ToolButton>
        </>
      )}
      <Divider />
      <ToolButton label={t('editorCanvas.zoomOut')} shortcut="zoomOut" onClick={p.onZoomOut}>
        <ZoomOut aria-hidden />
      </ToolButton>
      <Tip label={t('editorCanvas.zoomReset')} shortcut="zoomReset">
        <Button
          variant="ghost"
          className="h-8 w-14 px-1 font-mono text-xs tabular-nums"
          aria-label={`${t('editorCanvas.zoom')} ${Math.round(zoom * 100)}%`}
          aria-keyshortcuts={shortcutOf('zoomReset').aria}
          onClick={p.onZoomReset}
        >
          {Math.round(zoom * 100)}%
        </Button>
      </Tip>
      <ToolButton label={t('editorCanvas.zoomIn')} shortcut="zoomIn" onClick={p.onZoomIn}>
        <ZoomIn aria-hidden />
      </ToolButton>
      <ToolButton label={t('editorCanvas.fit')} shortcut="fit" onClick={p.onFit}>
        <Maximize aria-hidden />
      </ToolButton>
      <Divider />
      <ToolButton
        label={t('editorCanvas.snap')}
        onClick={() => p.onPrefs({ snap: !p.prefs.snap })}
        pressed={p.prefs.snap}
      >
        <Magnet aria-hidden />
      </ToolButton>
      <Tip label={t('editorCanvas.gridSize')}>
        <span className="w-20">
          <NativeSelect
            aria-label={t('editorCanvas.gridSize')}
            value={p.prefs.grid}
            onChange={(e) => p.onPrefs({ grid: Number(e.target.value) as GridSize })}
            className="h-8"
          >
            {GRID_SIZES.map((g) => (
              <option key={g} value={g}>
                {g} px
              </option>
            ))}
          </NativeSelect>
        </span>
      </Tip>
      <ToolButton
        label={t('panel.title')}
        onClick={() => p.onPrefs(togglePanel(p.prefs, 'panel'))}
        pressed={p.prefs.panel && !p.prefs.panelMin}
      >
        <PanelRight aria-hidden />
      </ToolButton>
      <ToolButton
        label={t('editorCanvas.minimap')}
        onClick={() => p.onPrefs({ minimap: !p.prefs.minimap })}
        pressed={p.prefs.minimap}
      >
        <MapIcon aria-hidden />
      </ToolButton>
      <Divider />
      <ToolButton
        label={t('editorCanvas.tips')}
        onClick={() => p.onPrefs({ tips: !p.prefs.tips })}
        pressed={p.prefs.tips}
      >
        <Lightbulb aria-hidden />
      </ToolButton>
      <Tip label={t('checks.toolbar', p.problems)}>
        <Button
          variant={p.problemsOpen ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 gap-1 px-2 tabular-nums"
          aria-label={t('checks.toolbar', p.problems)}
          aria-pressed={p.problemsOpen}
          onClick={p.onProblems}
        >
          {p.problems.error + p.problems.warning + p.problems.info === 0 ? (
            <CircleCheck aria-hidden className="text-status-up" />
          ) : (
            <SeverityIcon
              severity={p.problems.error ? 'error' : p.problems.warning ? 'warning' : 'info'}
              className="size-4"
            />
          )}
          {p.problems.error + p.problems.warning + p.problems.info}
        </Button>
      </Tip>
      <ToolButton label={t('editorCanvas.shortcuts')} shortcut="help" onClick={p.onHelp}>
        <Keyboard aria-hidden />
      </ToolButton>
      {p.canEdit && (
        <Tip label={t('editorDoc.save')} shortcut="save">
          <Button
            size="sm"
            className="ml-1 h-8"
            aria-keyshortcuts={shortcutOf('save').aria}
            onClick={p.onSave}
            disabled={p.status === 'clean' || p.status === 'saving' || p.status === 'conflict'}
          >
            <Save aria-hidden /> {t('editorDoc.save')}
          </Button>
        </Tip>
      )}
    </div>
  )
}
