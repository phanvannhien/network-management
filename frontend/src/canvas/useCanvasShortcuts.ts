import { useEffect } from 'react'
import { buildPasteCommand, compound, deleteDevices, setNodeLocked } from '../model/commands'
import { useAppStore } from '../model/store'

const PASTE_OFFSET = 20

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Keyboard shortcuts from SRS §3: undo/redo (Ctrl+Z / Ctrl+Shift+Z),
 * select all (Ctrl+A), copy/cut/paste/duplicate (Ctrl+C/X/V/D),
 * delete (Delete/Backspace), lock selection (Ctrl+L).
 */
export function useCanvasShortcuts(pageId: string | null): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const s = useAppStore.getState()
      const { selection } = s

      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && key === 'a') {
        e.preventDefault()
        s.setSelection(Object.keys(s.data.devices))
        return
      }
      if (mod && key === 'c') {
        e.preventDefault()
        s.setClipboard(selection)
        return
      }
      if (mod && key === 'x') {
        e.preventDefault()
        s.setClipboard(selection)
        if (selection.length > 0) s.dispatch(deleteDevices(selection))
        return
      }
      if (mod && key === 'v') {
        e.preventDefault()
        if (pageId && s.clipboard.length > 0) {
          const { command, newDeviceIds } = buildPasteCommand(
            s.data,
            pageId,
            s.clipboard,
            PASTE_OFFSET,
            PASTE_OFFSET,
          )
          s.dispatch(command)
          s.setSelection(newDeviceIds)
        }
        return
      }
      if (mod && key === 'd') {
        e.preventDefault()
        if (pageId && selection.length > 0) {
          const { command, newDeviceIds } = buildPasteCommand(
            s.data,
            pageId,
            selection,
            PASTE_OFFSET,
            PASTE_OFFSET,
          )
          s.dispatch(command)
          s.setSelection(newDeviceIds)
        }
        return
      }
      if (mod && key === 'l') {
        e.preventDefault()
        if (pageId && selection.length > 0) {
          const page = s.data.pages[pageId]
          const anyUnlocked = selection.some((id) => {
            const node = page?.nodes.find((n) => n.refId === id)
            return node ? !node.locked : false
          })
          s.dispatch(compound(...selection.map((id) => setNodeLocked(pageId, id, anyUnlocked))))
        }
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length > 0) {
        e.preventDefault()
        s.dispatch(deleteDevices(selection))
        s.setSelection([])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pageId])
}
