import { createMemo, createSignal } from 'solid-js'
import type { Task } from '../../queries'
import type { PaneContribution } from '../../registries/panes'
import LinearIssuePanel from './LinearIssuePanel'
import RollbarPane from './RollbarPane'

function LinearTaskPane(props: { task: Task }) {
  const links = createMemo(() => props.task.links.filter((link) => link.provider === 'linear'))
  const ids = () => links().map((link) => link.identifier)
  const [picked, setPicked] = createSignal<string | null>(null)
  const selected = () => (picked() && ids().includes(picked()!) ? picked()! : ids()[0])
  return (
    <LinearIssuePanel
      variant="pane"
      identifier={selected()}
      identifiers={ids()}
      onSelectIdentifier={setPicked}
      onClose={() => {}}
      onContentClick={() => {}}
    />
  )
}

export const linearPaneContribution: PaneContribution = {
  id: 'linear', label: 'Linear', glyph: '◷', description: 'Linked Linear issues', order: 90,
  defaultChord: 'meta+shift+l',
  when: (task) => task.links.some((link) => link.provider === 'linear'),
  component: LinearTaskPane,
}

export const rollbarPaneContribution: PaneContribution = {
  id: 'rollbar', label: 'Rollbar', glyph: '◍', description: 'Linked Rollbar items', order: 100,
  defaultChord: 'meta+shift+o',
  when: (task) => task.links.some((link) => link.provider === 'rollbar'),
  component: RollbarPane,
}
