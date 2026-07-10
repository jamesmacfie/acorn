import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import { readJson } from '../../../core/client/apiClient'
import type { Task } from '../../../core/client/queries'
import { taskContextRoute, type ContextItem, type TaskContext } from '../../../core/shared/api'
import { formatContextBlock } from '../../../core/shared/contextBlock'
import { agentSessionsFor } from '../../terminal/client/sessions'
import { terminalApi } from '../../terminal/client/terminalClient'
import MemoryTray from '../../memory/client/MemoryTray'
import { requestNoteOpen } from '../../notes/client/notesClient'
import { openPane } from '../../../core/client/registries/clientEvents'
import { selectionFromContext, selectionToInclude, traySummary, type TraySelection } from './model'
import './context-tray.css'

export default function ContextPane(props: { task: Task }) {
  const api = terminalApi()
  const [selection, setSelection] = createSignal<TraySelection>({})
  const [selectionTask, setSelectionTask] = createSignal('')
  const [msg, setMsg] = createSignal('')
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())

  // The tray needs the full inventory; contribution defaults only control the curated send set.
  const [ctx, { refetch }] = createResource(
    () => props.task.id,
    (id) => readJson<TaskContext>(taskContextRoute(id, 'all')),
  )

  createEffect(() => {
    const current = ctx()
    if (!current || selectionTask() === current.task.id) return
    setSelection(selectionFromContext(current))
    setSelectionTask(current.task.id)
  })

  const toggleSection = (id: string) => setSelection((current) => ({ ...current, [id]: !current[id] }))
  const isOpen = (id: string) => expanded().has(id)
  const toggleOpen = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  function followJump(item: ContextItem) {
    if (!item.jump?.itemId) return
    if (item.jump.pane === 'notes' && item.jump.noteScope) {
      requestNoteOpen(props.task.id, item.jump.itemId, item.jump.noteScope)
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

  async function assembleAndSend() {
    setMsg('')
    const include = selectionToInclude(selection())
    if (!include.length) return setMsg('Nothing selected.')
    const target = agentSessionsFor(props.task.id)[0]
    if (!target || !api) return setMsg('No running agent session.')
    const assembled = await readJson<TaskContext>(taskContextRoute(props.task.id, include))
    const res = await api.sendToAgent(target.id, formatContextBlock(assembled), 'after-ready')
    setMsg(res.ok ? (res.queued ? 'Queued — delivers when the agent is idle.' : 'Sent.') : (res.reason ?? 'Send failed.'))
  }

  return (
    <section class="pane context-pane">
      <div class="section-header context-tray-head">
        <span>context</span>
        <span class="muted">{traySummary(ctx())}</span>
        <Show when={msg()}><span class="muted context-tray-msg">{msg()}</span></Show>
      </div>
      <Show when={ctx()}>
        {(context) => (
          <div class="context-tray-body">
            <For each={context().sections}>
              {(section) => (
                <div class="context-tray-section">
                  <div class="context-tray-row">
                    <input type="checkbox" checked={selection()[section.id] ?? false} onChange={() => toggleSection(section.id)} />
                    <span class="context-tray-kind">{section.label}</span>
                    <Show when={section.omitted}><span class="muted">+{section.omitted} omitted</span></Show>
                  </div>
                  <Show when={section.absent}><div class="context-tray-detail muted">⚠ {section.absent!.detail}</div></Show>
                  <For each={section.items}>
                    {(item) => {
                      const rowId = `${section.id}:${item.id}`
                      return (
                        <div class="context-tray-item">
                          <div class="context-tray-row">
                            <span class="context-tray-kind">{item.kind}</span>
                            <button type="button" class="context-tray-expand" onClick={() => toggleOpen(rowId)}>
                              <span class="context-tray-twist">{isOpen(rowId) ? '▾' : '▸'}</span>
                              <span class="context-tray-label">{item.label}</span>
                            </button>
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
                </div>
              )}
            </For>
            <div class="context-tray-actions">
              <button type="button" class="overlay-btn" onClick={() => void refetch()}>Refresh</button>
              <button type="button" class="overlay-btn" onClick={() => void assembleAndSend()}>
                Assemble &amp; send → agent{agentSessionsFor(props.task.id)[0]?.idle ? ' ●' : ''}
              </button>
            </div>
            <MemoryTray task={props.task} onChanged={() => void refetch()} />
          </div>
        )}
      </Show>
    </section>
  )
}
