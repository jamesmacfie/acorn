import { createEffect, createMemo, For } from 'solid-js'
import type { TopbarProps } from '@acorn/protocol/chrome.ts'
import { RailTab } from '../tabs/RailTab'
import { createCollection } from '../../kit/keys/collection'
import { WorkspaceIdentity } from './WorkspaceIcon'

const keyOf = (entry: { id: string; nodeId: string }) => JSON.stringify([entry.nodeId, entry.id])

/** The shell supplies the same roster and selection verb it supplies to the top bar. */
export function WorkspaceRail(props: { value: TopbarProps }) {
  const roster = createMemo(() => props.value.workspaces)
  const selected = () => props.value.workspace && props.value.node ? keyOf({ id: props.value.workspace.id, nodeId: props.value.node.id }) : null
  const activate = (key: string) => {
    const entry = roster().find((candidate) => keyOf(candidate) === key)
    if (entry) props.value.pickWorkspace(entry.id, entry.nodeId)
  }
  const collection = createCollection({
    id: () => 'workspace-rail', role: 'group', orientation: 'vertical',
    items: () => roster().map((entry) => ({ key: keyOf(entry), label: entry.label })),
    selected, onActivate: activate,
  })
  const groups = createMemo(() => [...new Set(roster().map((entry) => entry.nodeId))])
  const rosterKeys = createMemo(() => JSON.stringify(roster().map(keyOf)))
  createEffect(() => {
    const key = selected()
    rosterKeys()
    if (key) queueMicrotask(() => collection.reveal(key))
  })
  return (
    <nav {...collection.containerProps} class="workspace-rail" aria-label={props.value.workspacesMode === 'off' ? 'Projects' : 'Workspaces'} role="navigation">
      <For each={groups()}>{(nodeId) => (
        <div class="workspace-rail-group" role="group" aria-label={props.value.nodes.find((node) => node.id === nodeId)?.label}>
          <For each={roster().filter((entry) => entry.nodeId === nodeId).map(keyOf)}>{(key) => {
            const entry = () => roster().find((candidate) => keyOf(candidate) === key)!
            return (
              <RailTab {...collection.itemProps(key)}
                label={`${entry().label}${props.value.nodes.length > 1 ? ` · ${entry().nodeLabel}` : ''}`}
                active={selected() === keyOf(entry())} aria-current={selected() === keyOf(entry()) ? 'true' : undefined}
                onClick={() => activate(keyOf(entry()))}>
                <WorkspaceIdentity name={entry().label} appearance={entry().appearance} nodeId={entry().nodeId} size="rail" />
              </RailTab>
            )}}</For>
        </div>
      )}</For>
    </nav>
  )
}
