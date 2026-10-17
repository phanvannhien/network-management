import { useRef, useState } from 'react'
import type { components } from '@/api/client'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { fetchDevice, fetchHostnames, fetchLinkCards, fetchLinks, fetchTemplates } from '../doc/api'
import {
  addNode,
  compound,
  deleteDevice,
  deleteLink,
  removeAnnotations,
  removeNodes,
  setLocked,
  type DocCommand,
} from '../doc/commands'
import type { DocStoreApi } from '../doc/store'
import type { DeviceCard } from '../doc/types'
import { HOSTNAME_PREFIX } from '../library/hostname'
import { clipboard, copySelection, mustClone, planPaste, type Clip } from './clipboard'
import { ANN, isAnnotationId } from './flow'
import type { DeleteTarget } from './DeleteFromInventoryDialog'

type Link = Awaited<ReturnType<typeof fetchLinks>>[number]

/**
 * Selection & editing actions of the editor (P1-16): copy / paste / duplicate, lock, remove from the diagram, delete
 * from the inventory (confirmed), placing an inventory device with its existing cables. Shared by keys, menu and
 * toolbar so they behave the same.
 */
export function useEditActions({
  orgId,
  store,
  canEdit,
  grid,
}: {
  orgId: string
  store: DocStoreApi
  canEdit: boolean
  grid: number
}) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null)
  const pastes = useRef(0)
  const busy = useRef(false)

  const selectedNodes = () => {
    const s = store.getState()
    const ids = new Set(s.selection)
    return (s.doc?.view.nodes ?? []).filter((n) => ids.has(n.id))
  }

  /** An inventory device on this diagram, with its cables to what is already drawn (ADR-015). */
  const placeDevice = async (device: DeviceCard, x: number, y: number) => {
    let links: Awaited<ReturnType<typeof fetchLinkCards>> = []
    try {
      links = await fetchLinkCards(orgId, device.id)
    } catch {
      // drawn without its cables; they appear after the next save / reload
    }
    store.getState().dispatch(addNode('device', device.id, x, y, { device, links }))
  }

  const copy = () => {
    const s = store.getState()
    if (!s.doc) return
    const c = copySelection(s.doc, s.selection, orgId)
    if (!c) return
    clipboard.set(c)
    pastes.current = 0
    toast.success(t('editorEdit.copied', { count: c.nodes.length }))
  }

  /** Edits wait while a save is on its way (the store ignores them): say so instead of pretending. */
  const saving = () => {
    if (store.getState().status !== 'saving') return false
    toast.info(t('editorEdit.waitSave'))
    return true
  }

  const pasteClip = async (c: Clip, duplicate: boolean) => {
    const s = store.getState()
    if (!canEdit || !s.doc || busy.current || saving()) return
    if (c.orgId !== orgId) {
      toast.error(t('editorEdit.otherOrg'))
      return
    }
    busy.current = true
    try {
      const clone = mustClone(s.doc, c, duplicate)
      const saved = c.nodes.filter((n) => n.refKind === 'device' && !n.pending)
      const links: Link[] = []
      const seen = new Set<string>()
      for (const n of c.nodes.filter((x) => !x.pending))
        for (const l of await fetchLinks(orgId, n.refId))
          if (!seen.has(l.id)) {
            seen.add(l.id)
            links.push(l)
          }
      const sources: Parameters<typeof planPaste>[3]['sources'] = {}
      const templates: Record<string, components['schemas']['PortGroup'][]> = {}
      const taken = new Set(Object.values(s.doc.devices).map((d) => d.hostname))
      if (clone) {
        for (const n of saved) sources[n.refId] = await fetchDevice(orgId, n.refId)
        // Clones get their template's ports right away, so they can be cabled before saving.
        const usesTemplate = [...Object.values(sources), ...c.nodes.map((n) => n.pending)].some(
          (d) => d?.templateId,
        )
        if (usesTemplate) for (const tp of await fetchTemplates(orgId)) templates[tp.id] = tp.ports
        // Names in the inventory that a renamed clone could hit.
        const stems = new Set<string>()
        for (const n of c.nodes)
          if (n.card) stems.add(n.card.hostname.replace(/\d+$/, '') || HOSTNAME_PREFIX.other)
        for (const stem of stems) for (const h of await fetchHostnames(orgId, stem)) taken.add(h)
      }
      // A clone lands next to its source, a little further at each paste; placed objects keep their layout.
      const step = clone ? ++pastes.current * Math.max(2 * grid, 40) : 0
      if (saving()) return
      const plan = planPaste(
        store.getState().doc!,
        c,
        { x: c.x + step, y: c.y + step },
        { clone, sources, links, taken, templates },
      )
      store.getState().dispatch(plan.command)
      store.getState().setSelection(plan.nodeIds)
      if (clone && plan.cloned > 0) toast.success(t('editorEdit.cloned', { count: plan.cloned }))
      if (plan.skippedGroups > 0)
        toast.info(t('editorEdit.groupsSkipped', { count: plan.skippedGroups }))
      if (!clone && plan.nodeIds.length === 0) toast.info(t('editorEdit.alreadyThere'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('errors.actionFailed'))
    } finally {
      busy.current = false
    }
  }

  const paste = () => {
    const c = clipboard.get()
    if (c) void pasteClip(c, false)
  }

  /** Ctrl+D: clones the selection without touching the clipboard. */
  const duplicate = () => {
    const s = store.getState()
    if (!s.doc) return
    const c = copySelection(s.doc, s.selection, orgId)
    if (c) {
      pastes.current = 0
      void pasteClip(c, true)
    }
  }

  const toggleLock = () => {
    const nodes = selectedNodes()
    if (!canEdit || nodes.length === 0 || saving()) return
    const lock = nodes.some((n) => !n.locked)
    store.getState().dispatch(
      setLocked(
        nodes.map((n) => n.id),
        lock,
      ),
    )
  }

  const remove = () => {
    const nodes = selectedNodes()
    if (!canEdit || saving()) return
    // Annotations (frames, text, arrows) selected go away; a frame's devices stay.
    const anns = store
      .getState()
      .selection.filter(isAnnotationId)
      .map((id) => id.slice(ANN.length))
    if (nodes.length === 0) {
      if (anns.length > 0) {
        store.getState().dispatch(removeAnnotations(anns))
        return
      }
      // Cables cannot leave the view while both ends are drawn (ADR-015): Delete on them deletes from the inventory.
      if (store.getState().edgeSelection.length > 0) requestDelete()
      return
    }
    const locked = nodes.filter((n) => n.locked).length
    const removal = removeNodes(nodes.map((n) => n.id))
    store
      .getState()
      .dispatch(
        anns.length > 0 ? compound(removal.label, [removeAnnotations(anns), removal]) : removal,
      )
    if (locked > 0) toast.info(t('editorEdit.lockedSkipped', { count: locked }))
  }

  const requestDelete = () => {
    const s = store.getState()
    if (!canEdit || !s.doc) return
    const nodes = selectedNodes().filter((n) => n.refKind === 'device')
    // Nodes win: cables count only when no node is selected (a stale cable pick never rides along).
    const edges = new Set(selectedNodes().length > 0 ? [] : s.edgeSelection)
    const linkIds = s.doc.view.edges.filter((e) => edges.has(e.id)).map((e) => e.linkId)
    const deviceIds = nodes.filter((n) => !n.locked).map((n) => n.refId)
    const skippedLocked = nodes.length - deviceIds.length
    if (deviceIds.length === 0 && linkIds.length === 0) {
      if (skippedLocked > 0) toast.info(t('editorEdit.lockedSkipped', { count: skippedLocked }))
      return
    }
    setDeleting({ deviceIds, linkIds, skippedLocked })
  }

  const confirmDelete = () => {
    if (!deleting || saving()) return
    const doc = store.getState().doc
    const devs = new Set(deleting.deviceIds)
    const commands: DocCommand[] = deleting.deviceIds.map((id) => deleteDevice(id))
    for (const id of deleting.linkIds) {
      const l = doc?.links[id]
      // A cable of a deleted device goes with it.
      if (l && !devs.has(l.aId) && !devs.has(l.bId)) commands.push(deleteLink(id))
    }
    store.getState().dispatch(compound('deleteFromInventory', commands))
    store.getState().setSelection([])
    store.getState().setEdgeSelection([])
    setDeleting(null)
    toast.success(t('editorEdit.deleted'))
  }

  return {
    placeDevice,
    copy,
    paste,
    duplicate,
    toggleLock,
    remove,
    requestDelete,
    deleting,
    confirmDelete,
    cancelDelete: () => setDeleting(null),
    hasClip: () => clipboard.get() !== null,
  }
}
