import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { readJson } from '@acorn/client-core/apiClient.ts'
import type { Task } from '@acorn/client-core/queries.ts'
import { taskContextRoute, type ContextItem, type TaskContext } from '@acorn/protocol/api.ts'
import { agentSessionsFor } from '@acorn/client-core/tasks/agentSessions.ts'
import { taskBridge } from '@acorn/client-core/tasks/taskBridge.ts'
import { contextSectionContributions } from '@acorn/client-core/registries/contextSections.ts'
import { clientEvents, consumePaneIntent, openPane, type PaneIntent } from '@acorn/client-core/registries/clientEvents.ts'
import Picker from '@acorn/client-core/ui/Picker.tsx'
import type { TerminalSession } from '@acorn/protocol/terminal.ts'
import { recordSync, rememberTarget, syncStatus, targetSessionFor, type SyncStatus } from './syncState'
import { selectionFor, setSectionSelection } from './selectionState'
import { assembleBlockFrom, sectionCap, selectionFromContext, traySummary, type TraySelection } from './model'
import { bytesOf, formatSize } from '@acorn/client-core/lib/formatSize.ts'
import { bumpContextRevision } from './contextRevision'
import './context-tray.css'

const originBadge = (author?: 'user' | 'agent' | 'workflow'): string => (author === 'agent' ? '🤖' : author === 'workflow' ? 'seed' : '')
const scopePill = (scope?: string): string => (scope === 'task' ? '◆ task' : scope === 'workspace' ? 'ws' : scope === 'global' ? '🌐' : '')

export default function ContextPane(props: { task: Task }) {
  const api = taskBridge()
  const [msg, setMsg] = createSignal('')
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  // Pending-item counts reported UP by section contributions, keyed by section id. Was a single
  // `pendingMemory` signal, which named the one plugin that happens to have any — so a second contributor
  // would have silently overwritten the first's count in the header.
  const [pending, setPending] = createSignal<Record<string, number>>({})
  const pendingFor = (sectionId: string) => pending()[sectionId] ?? 0
  const [previewOpen, setPreviewOpen] = createSignal(false)

  // The pane needs the full inventory; contribution defaults only seed the initial selection.
  const [ctx, { refetch }] = createResource(
    () => props.task.id,
    (id) => readJson<TaskContext>(taskContextRoute(id, 'all')),
  )

  // Effective selection: the persisted per-task set, or the contribution defaults for an untouched
  // task. A toggle writes the full effective map so a later defaultIncluded change can't flip it.
  const effective = (): TraySelection => selectionFor(props.task.id) ?? (ctx() ? selectionFromContext(ctx()!) : {})
  const toggleSection = (id: string) => setSectionSelection(props.task.id, { ...effective(), [id]: !effective()[id] })
  const refreshContext = async (): Promise<void> => {
    await refetch()
    bumpContextRevision(props.task.id)
  }

  // The exact block a send would deliver — assembled locally from the include=* inventory.
  const assembled = createMemo(() => (ctx() ? assembleBlockFrom(ctx()!, effective()) : null))

  // An empty section (no items, no ⚠ absent) is noise — hide it, so "Linked issues" vanishes when
  // there are none and a PR section appears only when the task has a PR. A section with a registered
  // CONTRIBUTION always shows, because the contribution is interactive and hiding it would hide the only
  // way to add the thing that would make the section non-empty. That rule used to read
  // `s.id === 'memory'`, with a comment explaining that memory hosts the add form — true, and exactly the
  // hardcoding the registry removes: it is now "has something to render", not "is memory".
  const visibleSections = createMemo(() =>
    (ctx()?.sections ?? []).filter((s) => contextSectionContributions(s.id).length > 0 || s.items.length > 0 || !!s.absent),
  )

  const isOpen = (id: string) => expanded().has(id)
  const toggleOpen = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Pane intents: context:reveal scrolls to (and expands) a section/item row.
  function applyIntent(intent: PaneIntent | undefined) {
    if (intent?.kind === 'context:reveal') revealRow(intent.sectionId, intent.itemId)
  }
  function revealRow(sectionId: string, itemId?: string) {
    const rowKey = itemId ? `${sectionId}:${itemId}` : sectionId
    if (itemId) setExpanded((current) => new Set(current).add(rowKey))
    queueMicrotask(() => {
      const target = document.querySelector(`[data-context-row="${CSS.escape(rowKey)}"]`) ?? document.querySelector(`[data-context-row="${CSS.escape(sectionId)}"]`)
      target?.scrollIntoView({ block: 'nearest' })
    })
  }
  onMount(() => {
    const off = clientEvents.on('presentation:pane-intent', ({ taskId, paneId, intent }) => {
      if (taskId === props.task.id && paneId === 'context') applyIntent(intent)
    })
    onCleanup(off)
  })
  createEffect(() => applyIntent(consumePaneIntent(props.task.id, 'context')))

  function followJump(item: ContextItem) {
    if (!item.jump?.itemId) return
    // The same call notes' own `requestNoteOpen` makes. Inlined rather than imported: `openPane` and the
    // `notes:open` PaneIntent variant are both client-core's, so borrowing notes' one-line wrapper was
    // the entire context → notes coupling edge — a plugin dependency for a function that reaches nothing
    // of that plugin's. Every other jump below already goes straight through openPane.
    if (item.jump.pane === 'notes' && item.jump.noteScope) {
      openPane(props.task.id, 'notes', { kind: 'notes:open', slug: item.jump.itemId, scope: item.jump.noteScope })
      return
    }
    if (item.jump.ref) {
      openPane(props.task.id, item.jump.pane, { kind: 'integration:show-ref', ref: item.jump.ref })
      return
    }
    const link = props.task.links.find((candidate) => candidate.providerId === item.jump!.pane && candidate.identifier === item.jump!.itemId)
    if (!link) return
    openPane(props.task.id, item.jump.pane, {
      kind: 'integration:show-ref',
      ref: link.ref ?? { providerId: link.providerId, connectionId: link.connectionId, displayId: link.identifier },
    })
  }

  const target = createMemo(() => targetSessionFor(props.task.id))
  const status = createMemo(() => {
    const t = target()
    return t ? syncStatus(t.id, assembled()?.sections ?? {}) : null
  })
  const sessionLabel = (session: TerminalSession | undefined): string =>
    session ? `${session.title}${session.idle ? ' ●' : ''}` : 'agent session'
  const agoText = (at: number): string => {
    const minutes = Math.round((Date.now() - at) / 60_000)
    return minutes < 1 ? 'now' : `${minutes}m`
  }
  const pillText = (s: SyncStatus): string =>
    s.kind === 'never' ? 'not synced' : s.kind === 'synced' ? `synced · ${agoText(s.at)}` : `stale · ${s.changes} change${s.changes === 1 ? '' : 's'}`

  async function syncContext() {
    setMsg('')
    const t = targetSessionFor(props.task.id)
    if (!t || !api) return setMsg('No running agent session.')
    await refreshContext() // fresh inventory, one fetch
    const current = ctx()
    if (!current) return
    const { block, sections } = assembleBlockFrom(current, effective())
    if (!block.trim()) return setMsg('Nothing selected.')
    const res = await api.sendToAgent(t.id, block, 'after-ready')
    if (res.ok) recordSync(t.id, props.task.id, sections)
    setMsg(res.ok ? (res.queued ? 'Queued — delivers when the agent is idle.' : 'Sent.') : (res.reason ?? 'Send failed.'))
  }

  return (
    <section class="pane context-pane">
      <div class="section-header context-tray-head">
        <span>context</span>
        <span class="muted">{traySummary(ctx() ? { ...ctx()!, sections: visibleSections() } : undefined)}</span>
        <Show when={msg()}><span class="muted context-tray-msg">{msg()}</span></Show>
      </div>
      <Show when={ctx()}>
        <div class="context-tray-body">
            <For each={visibleSections()}>
              {(section) => {
                const size = () => bytesOf(section.compact)
                const cap = () => sectionCap(section.budget)
                const ratio = () => {
                  const c = cap()
                  return c ? Math.min(1, size() / c) : 0
                }
                return (
                  <div class="context-tray-section" data-context-row={section.id}>
                    <div class="context-tray-row">
                      <input type="checkbox" checked={effective()[section.id] ?? false} onChange={() => toggleSection(section.id)} />
                      <span class="context-tray-kind">{section.label}</span>
                      <Show when={pendingFor(section.id)}><span class="muted">· {pendingFor(section.id)} pending</span></Show>
                      <Show when={section.omitted}><span class="muted">+{section.omitted} omitted</span></Show>
                      <span class="context-size">{formatSize(size())}</span>
                    </div>
                    <Show when={cap()}>
                      <div class="context-bar"><div class="context-bar-fill" classList={{ warn: ratio() >= 0.8 }} style={{ width: `${ratio() * 100}%` }} /></div>
                    </Show>
                    <Show when={section.absent}><div class="context-tray-detail muted">⚠ {section.absent!.detail}</div></Show>
                    <For each={section.items}>
                      {(item) => {
                        const rowId = `${section.id}:${item.id}`
                        return (
                          <div class="context-tray-item" data-context-row={rowId}>
                            <div class="context-tray-row">
                              <span class="context-tray-kind">{item.kind}</span>
                              <button type="button" class="context-tray-expand" onClick={() => toggleOpen(rowId)}>
                                <span class="context-tray-twist">{isOpen(rowId) ? '▾' : '▸'}</span>
                                <span class="context-tray-label">{item.label}</span>
                              </button>
                              <Show when={originBadge(item.origin?.author)}><span class="context-origin-badge">{originBadge(item.origin?.author)}</span></Show>
                              <Show when={scopePill(item.jump?.noteScope)}><span class="context-origin-badge muted">{scopePill(item.jump?.noteScope)}</span></Show>
                              <Show when={item.jump?.pane === 'notes'}>
                                <button type="button" class="context-tray-edit" title="Edit in Notes" aria-label="Edit in Notes" onClick={() => followJump(item)}>✎</button>
                              </Show>
                            </div>
                            <Show when={isOpen(rowId)}>
                              <div class="context-tray-detail">
                                <Show when={item.body}><div class="context-tray-detail-body">{item.body}</div></Show>
                                <Show when={item.details?.length}>
                                  <ul class="context-tray-files"><For each={item.details}>{(detail) => <li>{detail}</li>}</For></ul>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        )
                      }}
                    </For>
                    {/* Extra controls a plugin renders under its own section — memory's add form and
                        proposal queue today. Was a hardcoded `section.id === 'memory'` branch importing
                        plugins/memory directly; the pane now asks the registry and does not know which
                        plugins answer. */}
                    <For each={contextSectionContributions(section.id)}>
                      {(contribution) => (
                        <Dynamic
                          component={contribution.component}
                          task={props.task}
                          onChanged={() => void refreshContext()}
                          onPendingChange={(count: number) => setPending((prev) => ({ ...prev, [section.id]: count }))}
                        />
                      )}
                    </For>
                  </div>
                )
              }}
            </For>

            <div class="context-preview">
              <button type="button" class="context-preview-toggle" onClick={() => setPreviewOpen(!previewOpen())}>
                <span class="context-tray-twist">{previewOpen() ? '▾' : '▸'}</span>
                <span>preview</span>
                <span class="muted context-size">{formatSize(bytesOf(assembled()?.block ?? ''))}</span>
              </button>
              <Show when={previewOpen()}>
                <pre class="context-preview-block">{assembled()?.block}</pre>
              </Show>
            </div>

            <div class="context-sync-row">
              <Picker<TerminalSession>
                label={sessionLabel(target())}
                placeholder="Filter sessions…"
                emptyText="No running agent session."
                results={(query) => agentSessionsFor(props.task.id).filter((s) => s.title.toLowerCase().includes(query.toLowerCase()))}
                rowLabel={(s) => sessionLabel(s)}
                isActive={(s) => s.id === target()?.id}
                onSelect={(s) => rememberTarget(props.task.id, s.id)}
              />
              <Show when={status()}>
                <span class="context-stale-pill" classList={{ warn: status()!.kind === 'stale', muted: status()!.kind !== 'stale' }} title="since last sync from this pane">
                  {pillText(status()!)}
                </span>
              </Show>
              <button type="button" class="ui-btn context-sync-btn" onClick={() => void syncContext()}>Sync context</button>
              <button type="button" class="section-refresh" style={{ 'margin-left': 'auto' }} title="Refresh" aria-label="Refresh" onClick={() => void refreshContext()}>↻</button>
            </div>
          </div>
      </Show>
    </section>
  )
}
