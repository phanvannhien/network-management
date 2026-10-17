import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { LinkInput } from '@/modules/inventory/links'
import { fetchLinks } from '../doc/api'
import { createLink, newId, updateLink, type PortNames } from '../doc/commands'
import type { DocStoreApi } from '../doc/store'
import type { CableEnd, CableValue } from './CableDialog'

interface Open {
  a: CableEnd
  b: CableEnd
  edit?: { linkId: string; initial: CableValue; base: LinkInput; version?: number }
}

/**
 * Drawing cables (P1-17): drag from a connection point, or connect mode (L / toolbar / menu) where two clicks pick the
 * ends; either way the cable dialog picks kind and ports. Double click on a cable edits it (kind, ports — "assign the
 * port later", ADR-013). Every change is a command (undo / redo), saved with the diagram.
 */
export function useWiring({
  orgId,
  store,
  canEdit,
}: {
  orgId: string
  store: DocStoreApi
  canEdit: boolean
}) {
  const { t } = useTranslation()
  /** Connect mode; `from` is the first node picked. */
  const [mode, setMode] = useState<{ from: string | null } | null>(null)
  const [open, setOpen] = useState<Open | null>(null)

  const endOf = (nodeId: string): CableEnd | null => {
    const doc = store.getState().doc
    const n = doc?.view.nodes.find((x) => x.id === nodeId)
    if (!doc || !n) return null
    if (n.refKind === 'device') {
      const d = doc.devices[n.refId]
      if (!d) return null
      return {
        kind: 'device',
        id: d.id,
        name: d.hostname,
        type: d.type,
        draft: d.draft === true,
        clusterId: d.clusterId,
      }
    }
    if (n.refKind === 'endpoint_group') {
      const g = doc.groups[n.refId]
      if (!g) return null
      return { kind: 'endpoint_group', id: g.id, name: g.name, type: '', draft: false }
    }
    return null
  }

  const wire = (from: string, to: string) => {
    setMode(null)
    if (!canEdit || from === to) return
    const a = endOf(from)
    const b = endOf(to)
    if (!a || !b) return
    if (a.kind === 'endpoint_group' && b.kind === 'endpoint_group') {
      toast.error(t('cable.groupToGroup'))
      return
    }
    setOpen({ a, b })
  }

  const pick = (nodeId: string) => {
    if (!mode) return
    if (!mode.from) setMode({ from: nodeId })
    else wire(mode.from, nodeId)
  }

  const editCable = async (edgeId: string) => {
    const doc = store.getState().doc
    const e = doc?.view.edges.find((x) => x.id === edgeId)
    const card = e && doc?.links[e.linkId]
    if (!doc || !card || !canEdit) return
    const nodeOf = (refId: string) => doc.view.nodes.find((n) => n.refId === refId)?.id ?? ''
    const a = endOf(nodeOf(card.aId))
    const b = endOf(nodeOf(card.bId))
    if (!a || !b) return
    // The current record: a pending create / edit here, else the saved cable.
    let base: LinkInput | undefined = doc.newLinks[card.id] ?? doc.linkEdits[card.id]
    let version = doc.linkEdits[card.id]?.version
    if (!base) {
      try {
        const saved = (await fetchLinks(orgId, card.aId)).find((l) => l.id === card.id)
        if (saved) {
          base = {
            a: { kind: saved.a.kind, id: saved.a.id, interfaceId: saved.a.interfaceId },
            b: { kind: saved.b.kind, id: saved.b.id, interfaceId: saved.b.interfaceId },
            kind: saved.kind,
            medium: saved.medium,
            speed: saved.speed,
            lengthM: saved.lengthM,
            cableId: saved.cableId,
            status: saved.status,
            fiberMode: saved.fiberMode,
            connector: saved.connector,
            service: saved.service,
            provider: saved.provider,
            circuitId: saved.circuitId,
            bandwidth: saved.bandwidth,
            notes: saved.notes,
          }
          version = saved.version
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('errors.linksLoad'))
        return
      }
    }
    if (!base) return
    setOpen({
      a,
      b,
      edit: {
        linkId: card.id,
        base,
        version,
        initial: {
          kind: base.kind,
          aPort: base.a.interfaceId ?? '',
          bPort: base.b.interfaceId ?? '',
          medium: base.medium ?? '',
          status: base.status ?? 'up',
        },
      },
    })
  }

  const save = (input: LinkInput, ports: PortNames) => {
    const o = open
    if (!o) return
    const s = store.getState()
    if (!o.edit) {
      s.dispatch(createLink(input, newId(), ports))
    } else {
      const merged: LinkInput = {
        ...o.edit.base,
        ...input,
        // Fibre fields only describe fibre.
        ...(input.kind === 'fiber' ? {} : { fiberMode: '', connector: '' }),
      }
      s.dispatch(updateLink(o.edit.linkId, { ...merged, version: o.edit.version ?? 0 }, ports))
    }
    setOpen(null)
  }

  return {
    /** Connect mode on/off; `from` starts it from a node (menu "connect from here"). */
    toggle: (from: string | null = null) =>
      setMode((m) => (m && from === null ? null : canEdit ? { from } : null)),
    cancel: () => setMode(null),
    mode,
    pick,
    wire,
    editCable: (edgeId: string) => void editCable(edgeId),
    open,
    save,
    close: () => setOpen(null),
  }
}
