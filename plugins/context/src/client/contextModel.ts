import { createMemo, createResource, createSignal } from 'solid-js'
import { agentSessionsFor, bytesOf, openPane, readJson, revealCollectionItem, toast, taskBridge, type Task } from '@acorn/plugin-api/client'
import { slotFills } from '@acorn/plugin-api/ui/host'
import { CONTEXT_SECTION_POINT } from './sectionPoint'
import { taskContextRoute, type ContextItem, type TaskContext } from '@acorn/protocol/api.ts'
import type { TerminalSession } from '@acorn/protocol/terminal.ts'
import { recordSync, rememberTarget, syncStatus, targetSessionFor, type SyncStatus } from './syncState'
import { selectionFor, setSectionSelection } from './selectionState'
import { assembleBlockFrom, sectionCap, selectionFromContext, traySummary, type TraySelection } from './model'
import { bumpContextRevision } from './contextRevision'

// Everything the Context pane knows, held once per task and read by all three of its regions.
//
// The pane is a `header-body-footer` layout, so the summary line, the sections and the sync bar are
// three components the host mounts rather than one component with everything in scope. They share the
// inventory, the selection, the expanded rows and the sync state, and the host holds that: `model` on
// the pane contribution builds this once per task inside its own reactive root, for the same reason
// notes' does — a region the host unmounts must not take the fetch with it (client-core
// registries/paneModels.ts).

/** The id the section's `Rows` is registered under, so `reveal` and the pane agree on one name. */
export const collectionId = (sectionId: string): string => `context.${sectionId}`

export type ContextModel = ReturnType<typeof createContextModel>

const agoText = (at: number): string => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  return minutes < 1 ? 'now' : `${minutes}m`
}

export const sessionLabel = (session: TerminalSession | undefined): string =>
  session ? `${session.title}${session.idle ? ' ●' : ''}` : 'agent session'

export const pillText = (status: SyncStatus): string =>
  status.kind === 'never'
    ? 'not synced'
    : status.kind === 'synced'
      ? `synced · ${agoText(status.at)}`
      : `stale · ${status.changes} change${status.changes === 1 ? '' : 's'}`

export function createContextModel(task: Task) {
  const api = taskBridge()
  const [msg, setMsg] = createSignal('')
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  // Which section folds the reader has shut. Closed-set rather than open-set, because a section is
  // open until somebody says otherwise, and a new section from the node should arrive open.
  const [shut, setShut] = createSignal<Set<string>>(new Set())
  // Pending-item counts reported up by section contributions, keyed by section id. Keyed, because a
  // single signal lets a second contributor overwrite the first's count in the header.
  const [pending, setPending] = createSignal<Record<string, number>>({})

  // The pane needs the full inventory; contribution defaults only seed the initial selection.
  const [ctx, { refetch }] = createResource(
    () => task.id,
    (id) => readJson<TaskContext>(taskContextRoute(id, 'all')),
  )

  // Effective selection: the persisted per-task set, or the contribution defaults for an untouched
  // task. A toggle writes the full effective map so a later defaultIncluded change can't flip it.
  const effective = (): TraySelection => selectionFor(task.id) ?? (ctx() ? selectionFromContext(ctx()!) : {})

  const refreshContext = async (): Promise<void> => {
    await refetch()
    bumpContextRevision(task.id)
  }

  // The exact block a send would deliver, assembled locally from the include=* inventory.
  const assembled = createMemo(() => (ctx() ? assembleBlockFrom(ctx()!, effective()) : null))

  // A section with nothing in it and nobody offering to fill its slot is not worth a fold. `slotFills`
  // rather than a registry read, so the pane never learns whether the contributor is compiled or
  // loaded — which is the whole point of the two render paths meeting at the slot.
  const visibleSections = createMemo(() => (ctx()?.sections ?? []).filter((section) =>
    section.items.length > 0 || !!section.absent || slotFills(CONTEXT_SECTION_POINT, section.id)))

  const target = createMemo(() => targetSessionFor(task.id))
  const status = createMemo(() => {
    const session = target()
    return session ? syncStatus(session.id, assembled()?.sections ?? {}) : null
  })

  function followJump(item: ContextItem) {
    if (!item.jump?.itemId) return
    // The same call notes' own `requestNoteOpen` makes. Inlined rather than imported: `openPane` and
    // the `notes:open` PaneIntent variant are both client-core's, so borrowing notes' wrapper would
    // be the only context-to-notes coupling in the file.
    if (item.jump.pane === 'notes' && item.jump.noteScope) {
      openPane(task.id, 'notes', { kind: 'notes:open', slug: item.jump.itemId, scope: item.jump.noteScope })
      return
    }
    if (item.jump.ref) {
      openPane(task.id, item.jump.pane, { kind: 'integration:show-ref', ref: item.jump.ref })
      return
    }
    const link = task.links.find((candidate) => candidate.providerId === item.jump!.pane && candidate.identifier === item.jump!.itemId)
    if (!link) return
    openPane(task.id, item.jump.pane, {
      kind: 'integration:show-ref',
      ref: link.ref ?? { providerId: link.providerId, connectionId: link.connectionId, displayId: link.identifier },
    })
  }

  async function syncContext() {
    setMsg('')
    const session = targetSessionFor(task.id)
    if (!session) return setMsg('No running agent session.')
    await refreshContext() // fresh inventory, one fetch
    const current = ctx()
    if (!current) return
    const { block, sections } = assembleBlockFrom(current, effective())
    if (!block.trim()) return setMsg('Nothing selected.')
    const res = await api.sendToAgent(session.id, block, 'after-ready')
    if (res.ok) recordSync(session.id, task.id, sections)
    // Success is transient feedback; a failure needs to stay next to the button that failed.
    if (res.ok) return toast(res.queued ? 'Queued — delivers when the agent is idle.' : 'Sent.', { tone: 'success' })
    setMsg(res.reason ?? 'Send failed.')
  }

  return {
    task,
    ctx,
    msg,
    setMsg,
    effective,
    toggleSection: (id: string) => setSectionSelection(task.id, { ...effective(), [id]: !effective()[id] }),
    isOpen: (id: string) => expanded().has(id),
    toggleOpen: (id: string) => setExpanded((current) => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    }),
    sectionOpen: (id: string) => !shut().has(id),
    setSectionOpen: (id: string, open: boolean) => setShut((current) => {
      const next = new Set(current)
      open ? next.delete(id) : next.add(id)
      return next
    }),
    // The fold has to be open before there is a row to scroll to, so opening and revealing are two
    // ticks rather than one.
    reveal: (sectionId: string, itemId?: string) => {
      setShut((current) => {
        const next = new Set(current)
        next.delete(sectionId)
        return next
      })
      if (!itemId) return
      setExpanded((current) => new Set(current).add(`${sectionId}:${itemId}`))
      queueMicrotask(() => revealCollectionItem(collectionId(sectionId), itemId))
    },
    pendingFor: (sectionId: string) => pending()[sectionId] ?? 0,
    reportPending: (sectionId: string, count: number) => setPending((prev) => ({ ...prev, [sectionId]: count })),
    assembled,
    visibleSections,
    summary: () => traySummary(ctx() ? { ...ctx()!, sections: visibleSections() } : undefined),
    sectionRatio: (compact: string, budget: Parameters<typeof sectionCap>[0]) => {
      const cap = sectionCap(budget)
      return cap ? Math.min(1, bytesOf(compact) / cap) : null
    },
    target,
    status,
    sessions: (query: string) =>
      agentSessionsFor(task.id).filter((session) => session.title.toLowerCase().includes(query.toLowerCase())),
    pickTarget: (session: TerminalSession) => rememberTarget(task.id, session.id),
    followJump,
    refreshContext,
    syncContext,
  }
}
