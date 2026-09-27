import { useNavigate } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { createEffect, createMemo, Show } from 'solid-js'
import { activateTaskSignals, activeNodeId, pathForTask, tasksOptions } from '@acorn/plugin-api/client'
import { Icon, Inline, Row, Rows, Text } from '@acorn/plugin-api/ui'
import { managedAgentStore } from './managedStore'
import { openManagedSession } from './managedSelection'
import { liveDelegatedChildren } from './sessionRoster'
import RuntimeStateIcon from './RuntimeStateIcon'
import { attentionMark } from './stateTone'

/** Node roster lineage is the authority for which children belong above this composer. */
export default function ManagedChildRows(props: { parentSessionId: string; parentTaskId: string }) {
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  const taskById = createMemo(() => new Map((tasks.data ?? []).map((task) => [task.id, task])))
  const children = createMemo(() => liveDelegatedChildren(
    props.parentSessionId, managedAgentStore.sessions(), managedAgentStore.delegations(),
  ))

  // The roster carries attention, while a held snapshot gives its exact pending request kind.
  // Read only children that need input; the agent socket updates both projections after that.
  const requestedSnapshots = new Set<string>()
  createEffect(() => {
    const nodeId = activeNodeId() ?? ''
    const waiting = new Set<string>()
    for (const child of children()) {
      if (!['permission', 'question'].includes(child.attention)) continue
      const key = `${nodeId}:${child.id}`
      waiting.add(key)
      if (managedAgentStore.snapshots()[child.id] || requestedSnapshots.has(key)) continue
      // The store retains only three idle snapshots. Remember this read while the request is
      // pending, or 12 waiting children would evict one another and trigger an endless read loop.
      requestedSnapshots.add(key)
      void managedAgentStore.loadSnapshot(child.id).catch(() => undefined)
    }
    for (const id of requestedSnapshots) if (!waiting.has(id)) requestedSnapshots.delete(id)
  })

  const requestKind = (sessionId: string) => managedAgentStore.snapshots()[sessionId]?.requests
    .find((request) => request.status === 'pending' || request.status === 'resolving')?.kind
  const open = (sessionId: string) => {
    const child = children().find((candidate) => candidate.id === sessionId)
    const task = child && taskById().get(child.taskId)
    if (!child || !task) return
    activateTaskSignals(task, { pane: 'agents' })
    openManagedSession(task.id, child.id)
    navigate(pathForTask(task))
  }

  return (
    <Show when={children().length}>
      <Rows
        id={`agents:children:${activeNodeId() ?? ''}:${props.parentSessionId}`}
        ariaLabel="Delegated children"
        items={children().map((child) => ({ key: child.id, label: child.title }))}
        onActivate={open}
      >
        {(item, itemProps) => {
          const child = () => children().find((candidate) => candidate.id === item.key)
          const attention = () => {
            const state = child()?.attention
            return state && (['permission', 'question'].includes(state) ? requestKind(item.key) ?? state : state)
          }
          return (
            <Show when={child()}>
              {(current) => (
                <Row
                  item={itemProps}
                  variant="stacked"
                  density="compact"
                  title={current().title}
                  leading={<RuntimeStateIcon state={current().runtimeState} queued={current().queuedTurns} />}
                  trailing={<Show when={!['none', 'unread'].includes(attention() ?? 'none') ? attention() : undefined}>
                    {(reason) => <Icon {...attentionMark(reason())} />}
                  </Show>}
                  onPress={() => open(item.key)}
                >
                  <Text emphasis="strong">{current().title}</Text>
                  <Inline gap="inline">
                    <Text emphasis="muted">{current().runtimeState}</Text>
                    <Show when={!['none', 'unread'].includes(attention() ?? 'none') ? attention() : undefined}>
                      {(reason) => <Text emphasis="muted">{attentionMark(reason()).title}</Text>}
                    </Show>
                    <Show when={current().taskId !== props.parentTaskId}>
                      <Text emphasis="muted">{taskById().get(current().taskId)?.title ?? current().taskId}</Text>
                    </Show>
                  </Inline>
                </Row>
              )}
            </Show>
          )
        }}
      </Rows>
    </Show>
  )
}
