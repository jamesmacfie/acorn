import { createMemo, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { activateTaskSignals, activeNodeId, nodeReady, setSelectedSource, type Task } from '@acorn/plugin-api/client'
import { Alert, Badge, Button, EmptyState, Facts, Row, Rows, SectionHeader, Stack, Text } from '@acorn/plugin-api/ui'
import type { GitPaneModel } from './paneModel'
import { HistoryRows } from './HistoryRows'
import { RevisionView } from './RevisionView'
import { StashDetail, StashList } from './StashBrowse'

type Props = { task: Task; model: GitPaneModel }

export function GitPaneList(props: Props) {
  const navigate = useNavigate()
  const entries = createMemo(() => props.model.inventory.data?.worktrees ?? [])
  const items = createMemo(() => entries().map((entry) => ({ key: entry.id, label: entry.branch ?? entry.path })))
  return <Stack gap="section">
    <Button variant={props.model.section() === 'history' ? 'solid' : 'ghost'} onPress={() => props.model.setSection('history')}>History</Button>
    <Button variant={props.model.section() === 'stashes' ? 'solid' : 'ghost'} onPress={() => props.model.setSection('stashes')}>Stashes</Button>
    <Button variant={props.model.section() === 'worktrees' ? 'solid' : 'ghost'} onPress={() => props.model.setSection('worktrees')}>Worktrees</Button>
    <Show when={props.model.section() === 'stashes'}><StashList projectId={props.task.projectId} selected={props.model.stashId()} onSelect={props.model.setStashId} /></Show>
    <Show when={props.model.section() === 'history'}>
      <Show when={props.model.missingBranch()}><Alert tone="warn">Task branch {props.task.branch} is unavailable. Showing repository history and HEAD.</Alert></Show>
      <Button variant="ghost" onPress={() => { setSelectedSource('git'); navigate(`/p/${encodeURIComponent(props.task.projectId)}/x/git/history`) }}>Open repository history</Button>
      <HistoryRows projectId={props.task.projectId} model={props.model.history} selected={props.model.commitId()}
        onSelect={props.model.setCommitId} onChanges={() => activateChanges(props.task)} onRefresh={props.model.refreshHistory} />
    </Show>
    <Show when={props.model.section() === 'worktrees'}>
    <SectionHeader count={entries().length} actions={<Button size="sm" variant="ghost" onPress={() => void props.model.inventory.refetch()}>Refresh</Button>}>Worktrees</SectionHeader>
    <Show when={!nodeReady()}><EmptyState title="Node unavailable">Reconnect to inspect this checkout.</EmptyState></Show>
    <Show when={props.model.inventory.isLoading}><EmptyState title="Loading worktrees" /></Show>
    <Show when={props.model.inventory.error}><Alert tone="warn">{String(props.model.inventory.error)}{props.model.inventory.data ? ' Showing the last available roster.' : ''}</Alert></Show>
    <Rows id={`git-task:${activeNodeId()}:${props.task.id}`} ariaLabel="Task repository worktrees" items={items()}
      selected={props.model.selected()} onSelect={props.model.setSelected} onActivate={props.model.setSelected}>
      {(item, itemProps, selected) => <Row item={itemProps} selected={selected()} onPress={() => props.model.setSelected(item.key)}>
        <Text>{item.label}</Text><Show when={entries().find((entry) => entry.id === item.key)?.owners.some((owner) => owner.id === props.task.id)}><Badge>Task checkout</Badge></Show>
      </Row>}
    </Rows>
    </Show>
  </Stack>
}

function activateChanges(task: Task) { activateTaskSignals(task, { pane: 'changes' }) }

export function GitPaneDetail(props: Props) {
  const navigate = useNavigate()
  const entries = () => props.model.inventory.data?.worktrees ?? []
  const own = () => entries().find((entry) => entry.owners.some((owner) => owner.id === props.task.id))
  const selected = () => entries().find((entry) => entry.id === props.model.selected()) ?? own()
  const selectedIsOwn = () => !selected() || selected()?.id === own()?.id
  const repoPath = () => `/p/${encodeURIComponent(props.task.projectId)}/x/git/worktrees`
  return <>
    <Show when={props.model.section() === 'history'}><RevisionView projectId={props.task.projectId} taskId={props.task.id} id={props.model.commitId()} onCommit={props.model.setCommitId} /></Show>
    <Show when={props.model.section() === 'stashes'}><StashDetail projectId={props.task.projectId} task={props.task} selected={props.model.stashId()} onSelect={props.model.setStashId} /></Show>
    <Show when={props.model.section() === 'worktrees'}>
    <Stack gap="section">
    <SectionHeader>{selectedIsOwn() ? 'Task checkout' : 'Other worktree'}</SectionHeader>
    <Show when={props.model.inventory.error}><Alert tone="warn">{String(props.model.inventory.error)}{props.model.inventory.data ? ' Showing the last available roster.' : ''}</Alert></Show>
    <Show when={selected()} fallback={<EmptyState title="Checkout not found">This task has no registered worktree yet. It may be created when work starts.</EmptyState>}>
      {(entry) => <Facts grouping="rows" items={[
        ...(selectedIsOwn() ? [{ label: 'Task branch', value: props.task.branch ?? 'No branch' }] : []),
        { label: selectedIsOwn() ? 'Checkout branch' : 'Branch', value: entry().branch ?? 'Detached HEAD' },
        { label: 'HEAD', value: entry().head ?? 'Unborn', mono: true },
        { label: 'Path', value: entry().path, mono: true },
        { label: 'State', value: entry().missing ? 'Missing' : entry().dirty ? 'Changed' : entry().dirty === false ? 'Clean' : 'Unavailable' },
      ]} />}
    </Show>
    <Button onPress={() => { setSelectedSource('git'); navigate(repoPath()) }}>Open Git worktrees</Button>
    <Button variant="ghost" onPress={() => { setSelectedSource('git'); navigate(`/p/${encodeURIComponent(props.task.projectId)}/x/git/history`) }}>Open repository history</Button>
    </Stack>
    </Show>
  </>
}
