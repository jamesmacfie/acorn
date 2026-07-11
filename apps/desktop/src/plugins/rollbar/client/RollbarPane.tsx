import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { clientEvents, consumePaneIntent } from '../../../core/client/registries/clientEvents'
import type { Task } from '../../../core/shared/api'
import RollbarItemPanel, { type RollbarTarget } from './RollbarItemPanel'

// The Rollbar task pane (docs/panes.md): a thin selection wrapper over the shared RollbarItemPanel —
// the same detail component the Source browse mounts. A chip strip switches between several linked
// items; pane-intent lands selection on the requested (connection, counter), mirroring the Linear pane.
export default function RollbarPane(props: { task: Task }) {
  const links = createMemo(() => props.task.links.filter((l) => l.providerId === 'rollbar'))
  const targets = (): RollbarTarget[] => links().map((l) => ({ connectionId: l.connectionId, identifier: l.identifier }))
  const targetKey = (t: RollbarTarget) => `${t.connectionId}:${t.identifier}`
  const [picked, setPicked] = createSignal<string | null>(null)
  const applyIntent = (intent: ReturnType<typeof consumePaneIntent>) => {
    if (intent?.kind === 'integration:show-ref' && intent.ref.providerId === 'rollbar') {
      setPicked(targetKey({ connectionId: intent.ref.connectionId, identifier: intent.ref.displayId }))
    }
  }
  onMount(() => {
    applyIntent(consumePaneIntent(props.task.id, 'rollbar'))
    const dispose = clientEvents.on('presentation:pane-intent', ({ taskId, paneId, intent }) => {
      if (taskId === props.task.id && paneId === 'rollbar') applyIntent(intent)
    })
    onCleanup(dispose)
  })
  const selected = () => targets().find((t) => targetKey(t) === picked()) ?? targets()[0]

  return (
    <Show when={selected()} fallback={<section class="pane rollbar-panel"><div class="section-header">Rollbar</div><p class="placeholder">No Rollbar errors linked to this task.</p></section>}>
      {(target) => (
        <RollbarItemPanel
          variant="pane"
          target={target()}
          targets={targets()}
          onSelectTarget={(t) => setPicked(targetKey(t))}
        />
      )}
    </Show>
  )
}
