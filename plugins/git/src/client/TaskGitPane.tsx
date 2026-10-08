import { createMemo, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { activeNodeId, nodeReady, setSelectedSource, type Task } from '@acorn/plugin-api/client'
import { Alert, Button, EmptyState, Facts, Row, Rows, SectionHeader, Stack, Text } from '@acorn/plugin-api/ui'
import type { GitPaneModel } from './paneModel'

type Props = { task: Task; model: GitPaneModel }

export function GitPaneList(props: Props) {
  const entries = createMemo(() => props.model.inventory.data?.worktrees ?? [])
  const items = createMemo(() => entries().map((entry) => ({ key: entry.observation, label: entry.branch ?? entry.path })))
  return <Stack gap="section">
    <SectionHeader count={entries().length} actions={<Button size="sm" variant="ghost" onPress={() => void props.model.inventory.refetch()}>Refresh</Button>}>Worktrees</SectionHeader>
    <Show when={!nodeReady()}><EmptyState title="Node unavailable">Reconnect to inspect this checkout.</EmptyState></Show>
    <Show when={props.model.inventory.error}><Alert>{String(props.model.inventory.error)}</Alert></Show>
    <Show when={props.model.inventory.data?.error}><Alert>{props.model.inventory.data?.error}</Alert></Show>
    <Rows id={`git-task:${activeNodeId()}:${props.task.id}`} ariaLabel="Task repository worktrees" items={items()}
      selected={props.model.selected()} onSelect={props.model.setSelected} onActivate={props.model.setSelected}>
      {(item, itemProps, selected) => <Row item={itemProps} selected={selected()} onPress={() => props.model.setSelected(item.key)}>
        <Text>{item.label}</Text>
      </Row>}
    </Rows>
  </Stack>
}

export function GitPaneDetail(props: Props) {
  const navigate = useNavigate()
  const entries = () => props.model.inventory.data?.worktrees ?? []
  const own = () => entries().find((entry) => entry.owners.some((owner) => owner.id === props.task.id))
  const selected = () => entries().find((entry) => entry.observation === props.model.selected()) ?? own()
  const repoPath = () => `/p/${encodeURIComponent(props.task.projectId)}/x/git/worktrees`
  return <Stack gap="section">
    <SectionHeader>Task checkout</SectionHeader>
    <Show when={selected()} fallback={<EmptyState title="Checkout not found">This task has no registered worktree yet. It may be created when work starts.</EmptyState>}>
      {(entry) => <Facts grouping="rows" items={[
        { label: 'Task branch', value: props.task.branch ?? 'No branch' },
        { label: 'Checkout branch', value: entry().branch ?? 'Detached HEAD' },
        { label: 'HEAD', value: entry().head ?? 'Unborn', mono: true },
        { label: 'Path', value: entry().path, mono: true },
        { label: 'State', value: entry().missing ? 'Missing' : entry().dirty ? 'Changed' : entry().dirty === false ? 'Clean' : 'Unavailable' },
      ]} />}
    </Show>
    <Button onPress={() => { setSelectedSource('git'); navigate(repoPath()) }}>Open Git worktrees</Button>
  </Stack>
}
