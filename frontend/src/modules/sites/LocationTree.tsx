import { Building2, DoorOpen, Layers, Pencil, Plus, Trash2, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { childKinds, useLocationMutations, type Location, type LocationKind } from './sites'

export const KIND_ICON: Record<LocationKind, LucideIcon> = {
  building: Building2,
  floor: Layers,
  room: DoorOpen,
}

interface Node extends Location {
  children: Node[]
}

function buildTree(list: Location[]): Node[] {
  const nodes = new Map<string, Node>(list.map((l) => [l.id, { ...l, children: [] }]))
  const roots: Node[] = []
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined
    if (parent) parent.children.push(n)
    else roots.push(n)
  }
  return roots
}

/** Inline name input used for adding and renaming; Enter saves, Escape cancels. */
function NameInput({
  label,
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  label: string
  initial: string
  pending: boolean
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) onSubmit(name.trim())
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <Input
        autoFocus
        aria-label={label}
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        className="h-7 w-56"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {t('common.save')}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </form>
  )
}

type Editing =
  { mode: 'add'; parent: Node | null; kind: LocationKind } | { mode: 'rename'; node: Node } | null

/**
 * Site location tree (SRS §3): building → floor → room; only valid child kinds are offered, names are
 * unique among siblings (the API returns 409 otherwise). Locations with children or racks cannot be deleted.
 */
export function LocationTree({
  orgId,
  siteId,
  locations,
  canEdit,
}: {
  orgId: string
  siteId: string
  locations: Location[]
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const { create, rename, remove } = useLocationMutations(orgId, siteId)
  const tree = useMemo(() => buildTree(locations), [locations])
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<Node | null>(null)
  const kindLabel = (k: LocationKind) => t(`sites.kinds.${k}`)
  const error = create.error ?? rename.error ?? remove.error

  const add = (parent: Node | null, kind: LocationKind, name: string) =>
    create.mutate(
      { kind, name, parentId: parent?.id ?? null },
      { onSuccess: () => setEditing(null) },
    )

  const renderNode = (n: Node) => {
    const Icon = KIND_ICON[n.kind]
    const isRenaming = editing?.mode === 'rename' && editing.node.id === n.id
    const addingHere = editing?.mode === 'add' && editing.parent?.id === n.id ? editing : null
    return (
      <li key={n.id}>
        <div className="group/node flex h-8 items-center gap-2 rounded-md px-2 hover:bg-muted">
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {isRenaming ? (
            <NameInput
              label={t('sites.renameOf', { name: n.name })}
              initial={n.name}
              pending={rename.isPending}
              onSubmit={(name) =>
                rename.mutate({ location: n, name }, { onSuccess: () => setEditing(null) })
              }
              onCancel={() => setEditing(null)}
            />
          ) : (
            <>
              <span className="font-medium">{n.name}</span>
              <span className="text-label text-muted-foreground">{kindLabel(n.kind)}</span>
            </>
          )}
          {canEdit && !isRenaming && (
            <span className="ml-auto flex items-center gap-0.5 opacity-0 group-focus-within/node:opacity-100 group-hover/node:opacity-100">
              {childKinds(n.kind).map((k) => (
                <Button
                  key={k}
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditing({ mode: 'add', parent: n, kind: k })}
                  aria-label={t('sites.addChild', {
                    kind: kindLabel(k).toLowerCase(),
                    name: n.name,
                  })}
                >
                  <Plus aria-hidden /> {kindLabel(k)}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setEditing({ mode: 'rename', node: n })}
                aria-label={t('sites.renameOf', { name: n.name })}
                title={t('sites.rename')}
              >
                <Pencil aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setDeleting(n)}
                aria-label={`${t('sites.deleteLocation')} ${n.name}`}
                title={t('sites.deleteLocation')}
              >
                <Trash2 aria-hidden />
              </Button>
            </span>
          )}
        </div>
        {(n.children.length > 0 || addingHere) && (
          <ul aria-label={n.name} className="ml-4 border-l border-border pl-2">
            {n.children.map(renderNode)}
            {addingHere && (
              <li className="flex h-9 items-center gap-2 px-2">
                {(() => {
                  const ChildIcon = KIND_ICON[addingHere.kind]
                  return <ChildIcon aria-hidden className="size-4 text-muted-foreground" />
                })()}
                <NameInput
                  label={t('sites.locationName', { kind: kindLabel(addingHere.kind) })}
                  initial=""
                  pending={create.isPending}
                  onSubmit={(name) => add(n, addingHere.kind, name)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            )}
          </ul>
        )}
      </li>
    )
  }

  const addingRoot = editing?.mode === 'add' && editing.parent === null ? editing : null

  return (
    <div className="space-y-2">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {childKinds(null).map((k) => {
            const Icon = KIND_ICON[k]
            return (
              <Button
                key={k}
                variant="outline"
                size="sm"
                onClick={() => setEditing({ mode: 'add', parent: null, kind: k })}
              >
                <Icon aria-hidden /> {t('sites.addKind', { kind: kindLabel(k).toLowerCase() })}
              </Button>
            )
          })}
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error.message}
        </p>
      )}
      <div className="rounded-lg border border-border bg-card p-2">
        {tree.length === 0 && !addingRoot ? (
          <EmptyState icon={<Building2 />} title={t('sites.treeEmpty')} />
        ) : (
          // Nested lists (not role=tree: no arrow-key navigation is implemented).
          <ul aria-label={t('sites.tree')}>
            {tree.map(renderNode)}
            {addingRoot && (
              <li className="flex h-9 items-center gap-2 px-2">
                {(() => {
                  const Icon = KIND_ICON[addingRoot.kind]
                  return <Icon aria-hidden className="size-4 text-muted-foreground" />
                })()}
                <NameInput
                  label={t('sites.locationName', { kind: kindLabel(addingRoot.kind) })}
                  initial=""
                  pending={create.isPending}
                  onSubmit={(name) => add(null, addingRoot.kind, name)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            )}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('sites.deleteLocationTitle', { name: deleting?.name ?? '' })}
        description={t('sites.deleteLocationBody')}
        confirmLabel={t('sites.deleteLocation')}
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting)
            remove.mutate(deleting.id, { onSuccess: () => toast.success(t('sites.saved')) })
          setDeleting(null)
        }}
      />
    </div>
  )
}
