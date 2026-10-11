import { createEffect, createMemo, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { activeNodeId, featureUsable, nodeReady, setSelectedSource, type Task } from '@acorn/plugin-api/client'
import { Alert, Badge, Button, EmptyState, Facts, Row, Rows, SectionHeader, Stack, Tabs, Text } from '@acorn/plugin-api/ui'
import type { GitTaskPaneModel } from './paneContribution'
import { GIT_PANE, GIT_SECTIONS, isGitSection } from './gitPane'
import { ChangesDiff, ChangesFooter, ChangesHeader, ChangesList } from './changes/ChangesPane'
import { HistoryRows } from './HistoryRows'
import { RevisionView } from './RevisionView'
import { StashDetail, StashList } from './StashBrowse'
import { OperationBanner } from './OperationBanner'
import { ConflictResolver } from './ConflictResolver'

type Props = { task: Task; model: GitTaskPaneModel }

/** The tab strip, then the Changes tab's own header under it. */
export function GitPaneHeader(props: Props) {
  return <>
    <Tabs level="pane" idPrefix={`git-task-sections-${activeNodeId()}-${props.task.id}`} ariaLabel="Git sections"
      tabs={GIT_SECTIONS} active={props.model.section()} onChange={(id) => { if (isGitSection(id)) props.model.setSection(id) }} />
    <Show when={props.model.section() === 'changes'}><ChangesHeader task={props.task} model={props.model.changes} /></Show>
  </>
}

/** Only the Changes tab has a footer: the branch bar and the commit editor. */
export function GitPaneFooter(props: Props) {
  return <Show when={props.model.section() === 'changes'}><ChangesFooter task={props.task} model={props.model.changes} /></Show>
}

export function GitPaneList(props: Props) {
  const navigate = useNavigate()
  const entries = createMemo(() => props.model.inventory.data?.worktrees ?? [])
  const items = createMemo(() => entries().map((entry) => ({ key: entry.id, label: entry.branch ?? entry.path })))
  // The pane reports when it's usable. The Changes list does that for its own tab; these tabs draw
  // straight from their queries (docs/telemetry/renderer.md § Feature openings).
  createEffect(() => { if (props.model.section() !== 'changes') featureUsable(GIT_PANE) })
  return <Show when={props.model.section() !== 'changes'} fallback={<ChangesList task={props.task} model={props.model.changes} />}><Stack gap="section">
    <Show when={props.model.section() === 'stashes'}><StashList projectId={props.task.projectId} selected={props.model.stashId()} onSelect={props.model.setStashId} /></Show>
    <Show when={props.model.section() === 'history'}>
      <Show when={props.model.missingBranch()}><Alert tone="warn">Task branch {props.task.branch} is unavailable. Showing repository history and HEAD.</Alert></Show>
      <Button variant="ghost" onPress={() => { setSelectedSource('git'); navigate(`/p/${encodeURIComponent(props.task.projectId)}/x/git/history`) }}>Open repository history</Button>
      <HistoryRows projectId={props.task.projectId} model={props.model.history} selected={props.model.commitId()}
        onSelect={props.model.setCommitId} onChanges={() => props.model.setSection('changes')} onRefresh={props.model.refreshHistory} task={props.task} />
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
  </Stack></Show>
}

export function GitPaneDetail(props: Props) {
  const navigate = useNavigate()
  const entries = () => props.model.inventory.data?.worktrees ?? []
  const own = () => entries().find((entry) => entry.owners.some((owner) => owner.id === props.task.id))
  const selected = () => entries().find((entry) => entry.id === props.model.selected()) ?? own()
  const selectedIsOwn = () => !selected() || selected()?.id === own()?.id
  const repoPath = () => `/p/${encodeURIComponent(props.task.projectId)}/x/git/worktrees`
  return <>
    {/* The resolver replaces the banner: continuing stays a separate step, taken after Back. */}
    <Show when={props.model.conflict()} keyed>{(target) =>
      <ConflictResolver task={props.task} path={target.path} checkout={target.checkout} onClose={() => props.model.setConflict(null)} />}</Show>
    <Show when={!props.model.conflict() && props.model.section() === 'changes'}><ChangesDiff task={props.task} model={props.model.changes} /></Show>
    <Show when={!props.model.conflict() && props.model.section() !== 'changes'}>
    <OperationBanner task={props.task} onResolve={(path, checkout) => props.model.setConflict({ path, checkout })} />
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
    </Show>
  </>
}
