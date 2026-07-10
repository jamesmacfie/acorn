import { createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { Task } from '../../core/client/queries'
import type { PaneContribution } from '../../core/client/registries/panes'
import LinearIssuePanel, { type LinearIssueTarget } from '../../plugins/linear/client/LinearIssuePanel'
import RollbarPane from '../../plugins/rollbar/client/RollbarPane'
import { clientEvents, consumePaneIntent } from '../../core/client/registries/clientEvents'

function LinearTaskPane(props: { task: Task }) {
  const links = createMemo(() => props.task.links.filter((link) => link.providerId === 'linear'))
  const targets = (): LinearIssueTarget[] => links().map((link) => ({ identifier: link.identifier, connectionId: link.connectionId }))
  const targetKey = (target: LinearIssueTarget) => `${target.connectionId ?? 'unscoped'}:${target.identifier}`
  const [picked, setPicked] = createSignal<string | null>(null)
  const applyIntent = (intent: ReturnType<typeof consumePaneIntent>) => {
    if (intent?.kind === 'integration:show-ref' && intent.ref.providerId === 'linear') {
      setPicked(targetKey({ identifier: intent.ref.displayId, connectionId: intent.ref.connectionId }))
    }
  }
  onMount(() => {
    applyIntent(consumePaneIntent(props.task.id, 'linear'))
    const dispose = clientEvents.on('presentation:pane-intent', ({ taskId, paneId, intent }) => {
      if (taskId === props.task.id && paneId === 'linear') applyIntent(intent)
    })
    onCleanup(dispose)
  })
  const selected = () => targets().find((target) => targetKey(target) === picked()) ?? targets()[0]
  return (
    <LinearIssuePanel
      variant="pane"
      target={selected()}
      targets={targets()}
      onSelectTarget={(target) => setPicked(targetKey(target))}
      onClose={() => {}}
      onContentClick={() => {}}
    />
  )
}

export const linearPaneContribution: PaneContribution = {
  id: 'linear', providerId: 'linear', label: 'Linear', glyph: '◷', description: 'Linked Linear issues', order: 90,
  defaultChord: 'meta+shift+l',
  when: (task) => task.links.some((link) => link.providerId === 'linear'),
  component: LinearTaskPane,
}

export const rollbarPaneContribution: PaneContribution = {
  id: 'rollbar', providerId: 'rollbar', label: 'Rollbar', glyph: '◍', description: 'Linked Rollbar items', order: 100,
  defaultChord: 'meta+shift+o',
  when: (task) => task.links.some((link) => link.providerId === 'rollbar'),
  component: RollbarPane,
}
