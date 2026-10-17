// Editor keyboard shortcuts (SRS §6.4). The list feeds the "?" sheet and the tooltips, so a shortcut is documented
// where it is handled. Later tasks (library, wiring, copy / paste) add their entries here.

export type ShortcutId =
  | 'undo'
  | 'redo'
  | 'save'
  | 'fit'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'remove'
  | 'deleteInventory'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'lock'
  | 'selectAll'
  | 'deselect'
  | 'pan'
  | 'multiSelect'
  | 'search'
  | 'quickAdd'
  | 'library'
  | 'help'

export interface Shortcut {
  id: ShortcutId
  /** Keys as shown to the user; Ctrl means Cmd on macOS. */
  keys: string[]
  /** aria-keyshortcuts value for the button doing the same thing. */
  aria?: string
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'undo', keys: ['Ctrl', 'Z'], aria: 'Control+Z' },
  { id: 'redo', keys: ['Ctrl', 'Shift', 'Z'], aria: 'Control+Shift+Z' },
  { id: 'save', keys: ['Ctrl', 'S'], aria: 'Control+S' },
  { id: 'fit', keys: ['Shift', '1'], aria: 'Shift+1' },
  { id: 'zoomIn', keys: ['+'], aria: '+' },
  { id: 'zoomOut', keys: ['-'], aria: '-' },
  { id: 'zoomReset', keys: ['Shift', '0'], aria: 'Shift+0' },
  { id: 'remove', keys: ['Delete'], aria: 'Delete' },
  { id: 'deleteInventory', keys: ['Shift', 'Delete'], aria: 'Shift+Delete' },
  { id: 'copy', keys: ['Ctrl', 'C'], aria: 'Control+C' },
  { id: 'paste', keys: ['Ctrl', 'V'], aria: 'Control+V' },
  { id: 'duplicate', keys: ['Ctrl', 'D'], aria: 'Control+D' },
  { id: 'lock', keys: ['Ctrl', 'Shift', 'L'], aria: 'Control+Shift+L' },
  { id: 'selectAll', keys: ['Ctrl', 'A'], aria: 'Control+A' },
  { id: 'deselect', keys: ['Esc'] },
  { id: 'pan', keys: ['Space'] },
  { id: 'multiSelect', keys: ['Shift'] },
  { id: 'quickAdd', keys: ['/'], aria: '/' },
  { id: 'library', keys: ['B'], aria: 'B' },
  { id: 'search', keys: ['Ctrl', 'K'] },
  { id: 'help', keys: ['?'], aria: '?' },
]

export function shortcutOf(id: ShortcutId): Shortcut {
  return SHORTCUTS.find((s) => s.id === id)!
}

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** Keys as printed on this keyboard: Ctrl is ⌘ on macOS. */
export function displayKeys(id: ShortcutId, mac = IS_MAC): string[] {
  return shortcutOf(id).keys.map((k) => (mac && k === 'Ctrl' ? '⌘' : k))
}

/** "Ctrl+Shift+Z" (or "⌘+Shift+Z") for tooltips. */
export function keysLabel(id: ShortcutId, mac = IS_MAC): string {
  return displayKeys(id, mac).join('+')
}

/** Actions that change or select what is on the canvas: only when the canvas (or nothing) has the focus. */
export const CANVAS_ONLY: ReadonlySet<ShortcutId> = new Set([
  'remove',
  'deleteInventory',
  'selectAll',
  'deselect',
  'copy',
  'paste',
  'duplicate',
  'lock',
])

/** Keys typed into a field belong to the field, not the canvas. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('[role="dialog"]') !== null
  )
}

/** Which editor action a key press means, if any. */
export function actionFor(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): ShortcutId | null {
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  if (e.altKey) return null
  if (mod) {
    if (k === 's') return 'save'
    if (k === 'z') return e.shiftKey ? 'redo' : 'undo'
    if (k === 'y') return 'redo'
    if (k === 'a') return 'selectAll'
    if (k === 'c' && !e.shiftKey) return 'copy'
    if (k === 'v' && !e.shiftKey) return 'paste'
    if (k === 'd' && !e.shiftKey) return 'duplicate'
    // Ctrl+L alone focuses the browser's address bar.
    if (k === 'l' && e.shiftKey) return 'lock'
    return null
  }
  // Shift+digit gives "!" / ")" on most layouts: match on the physical key.
  if (e.shiftKey && (e.code === 'Digit1' || e.key === '1' || e.key === '!')) return 'fit'
  if (e.shiftKey && (e.code === 'Digit0' || e.key === '0' || e.key === ')')) return 'zoomReset'
  if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) return 'help'
  if (e.key === '/') return 'quickAdd'
  if (e.key.toLowerCase() === 'b' && !e.shiftKey) return 'library'
  if (e.key === '+' || e.key === '=') return 'zoomIn'
  if (e.key === '-' || e.key === '_') return 'zoomOut'
  // Shift+Delete deletes from the inventory, always after a confirmation (ADR-033).
  if (e.key === 'Delete' || e.key === 'Backspace') return e.shiftKey ? 'deleteInventory' : 'remove'
  if (e.key === 'Escape') return 'deselect'
  return null
}
