import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activateTaskSignals, activeNodeId, clientEvents, nodeReady, pathForTask, projectsOptions, tasksOptions, wsOnNodeEvent, wsOnReconnect } from '@acorn/plugin-api/client'
import { Alert, Badge, Button, ConfirmButton, EmptyState, Facts, IconButton, Menu, Row, RowActions, Rows, SectionHeader, Stack, Text } from '@acorn/plugin-api/ui'
import type { Worktree } from '../shared/api'
import { removeWorktree, worktreesKey, worktreesOptions } from './worktreeClient'

const basePath = (projectId: string) => `/p/${encodeURIComponent(projectId)}/x/git/worktrees`
const worktreePath = (projectId: string, observation: string) => `${basePath(projectId)}/${observation}`

function useWorktrees() {
  const params = useParams<{ projectId?: string; observation?: string }>()
  const queryClient = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const projectId = () => params.projectId ?? ''
  const project = () => projects.data?.find((item) => item.id === projectId())
  const inventory = createQuery(() => worktreesOptions(projectId()))
  const refresh = () => void queryClient.invalidateQueries({ queryKey: worktreesKey(projectId()) })
  const offWorktree = wsOnNodeEvent('worktree:status-changed', refresh)
  const offTasks = clientEvents.on('tasks:changed', refresh)
  const offReconnect = wsOnReconnect(refresh)
  onCleanup(() => { offWorktree(); offTasks(); offReconnect() })
  return { params, projectId, project, inventory, refresh }
}

export function WorktreeList() {
  const scope = useWorktrees()
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  const entries = createMemo(() => scope.inventory.data?.worktrees ?? [])
  const items = createMemo(() => entries().map((entry) => ({ key: entry.observation, label: `${entry.branch ?? 'Detached HEAD'} ${entry.path}` })))
  return <Stack gap="section">
    <SectionHeader count={entries().length} actions={<IconButton icon="refresh-cw" label="Refresh worktrees" onPress={scope.refresh} />}>
      Worktrees
    </SectionHeader>
    <Show when={scope.project()?.vcs === 'git'} fallback={<EmptyState title="Choose a Git project" />}>
      <Show when={!nodeReady()}><EmptyState title="Node unavailable">Reconnect to inspect worktrees.</EmptyState></Show>
      <Show when={scope.inventory.error}><Alert>{String(scope.inventory.error)}</Alert></Show>
      <Show when={scope.inventory.data?.error}><Alert>{scope.inventory.data?.error}</Alert></Show>
      <Show when={scope.inventory.isFetching && scope.inventory.data}><Alert tone="muted">Refreshing worktrees…</Alert></Show>
      <Show when={nodeReady() && !scope.inventory.isLoading && !entries().length && !scope.inventory.error && !scope.inventory.data?.error}><EmptyState title="No worktrees" /></Show>
      <Rows id={`git-worktrees:${activeNodeId()}:${scope.projectId()}`} ariaLabel="Git worktrees" items={items()}
        selected={scope.params.observation ?? null} onSelect={(key) => navigate(worktreePath(scope.projectId(), key))}
        onActivate={(key) => navigate(worktreePath(scope.projectId(), key))}>
        {(item, itemProps, selected) => {
          const entry = () => entries().find((row) => row.observation === item.key)
          return <Show when={entry()}>{(row) =>
            <Row item={itemProps} selected={selected()} href={worktreePath(scope.projectId(), item.key)}
              onPress={() => navigate(worktreePath(scope.projectId(), item.key))}
              leading={<Show when={row().main || row().missing || row().locked || !row().branch || row().dirty}>
                <Badge tone={row().missing || row().locked ? 'warn' : row().dirty ? 'danger' : 'neutral'}>
                  {row().main ? 'Main' : row().missing ? 'Missing' : row().locked ? 'Locked' : !row().branch ? 'Detached' : 'Changed'}
                </Badge>
              </Show>}
              trailing={<RowActions ariaLabel={`Actions for ${row().path}`}>
                {(menu) => <>
                  <Show when={row().owners[0]}>{(owner) => <Menu.Item context={menu} onSelect={() => {
                    const task = tasks.data?.find((item) => item.id === owner().id)
                    if (task) { activateTaskSignals(task, { pane: 'git' }); navigate(pathForTask(task)) }
                  }}>Open task</Menu.Item>}</Show>
                  <Menu.Item context={menu} onSelect={() => navigate(worktreePath(scope.projectId(), item.key))}>View worktree</Menu.Item>
                </>}
              </RowActions>}>
              <Text>{row().branch ?? 'Detached HEAD'}</Text>
            </Row>}
          </Show>
        }}
      </Rows>
    </Show>
  </Stack>
}

export function WorktreeDetail() {
  const scope = useWorktrees()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tasks = createQuery(() => tasksOptions(true))
  const [failure, setFailure] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const scopeKey = createMemo(() => `${activeNodeId() ?? ''}:${scope.projectId()}`)
  createEffect(on(scopeKey, () => {
    setFailure('')
    if (scope.params.observation) navigate(basePath(scope.projectId()))
  }, { defer: true }))
  const entry = () => scope.inventory.data?.worktrees.find((item) => item.observation === scope.params.observation)
  const task = (ownerId: string) => tasks.data?.find((candidate) => candidate.id === ownerId)
  const openTask = (ownerId: string) => {
    const target = task(ownerId)
    if (!target) return
    activateTaskSignals(target, { pane: 'git' })
    navigate(pathForTask(target))
  }
  const remove = async (target: Worktree) => {
    const projectId = scope.projectId()
    const nodeId = activeNodeId()
    setBusy(true); setFailure('')
    try {
      const result = await removeWorktree(projectId, target.observation)
      if (activeNodeId() !== nodeId || scope.projectId() !== projectId) return
      queryClient.setQueryData(worktreesKey(projectId), result.inventory)
      if (scope.params.observation !== target.observation) return
      if (!result.ok) setFailure(result.error ?? 'Git refused the removal.')
      else navigate(basePath(projectId))
    } catch (error) {
      if (activeNodeId() === nodeId && scope.projectId() === projectId && scope.params.observation === target.observation) {
        setFailure(error instanceof Error ? error.message : String(error))
      }
    }
    finally { setBusy(false) }
  }
  return <Stack gap="section"><Show when={entry()} fallback={<EmptyState title={scope.params.observation ? 'Worktree changed' : 'Choose a worktree'}>
    {scope.params.observation ? 'Refresh the list and select a current worktree.' : 'Select a row to inspect its checkout.'}
  </EmptyState>}>
    {(row) => <>
      <SectionHeader actions={<Button size="sm" variant="ghost" onPress={scope.refresh}>Refresh</Button>}>Worktree</SectionHeader>
      <Facts grouping="rows" items={[
        { label: 'Path', value: row().path, mono: true },
        { label: 'Branch', value: row().branch ?? 'Detached HEAD' },
        { label: 'HEAD', value: row().head ?? 'Unborn', mono: true },
        { label: 'State', value: row().missing ? 'Missing' : row().locked ? 'Locked' : row().dirty === null ? 'Unknown' : row().dirty ? 'Changed' : 'Clean' },
        { label: 'Last commit', value: row().lastCommit?.subject ?? 'No commit' },
      ]} />
      <Show when={row().error}><Alert>{row().error}</Alert></Show>
      <Show when={row().filesTruncated}><Alert tone="warn">Showing the first 100 changed files.</Alert></Show>
      <Show when={row().changedFiles.length}><SectionHeader>Changed files</SectionHeader><For each={row().changedFiles}>{(path) => <Text>{path}</Text>}</For></Show>
      <Show when={row().owners.length} fallback={<Text emphasis="muted">No Acorn task owns this worktree.</Text>}>
        <SectionHeader>Tasks</SectionHeader>
        <For each={row().owners}>{(owner) => <Button variant="ghost" onPress={() => openTask(owner.id)}>{owner.title} · Open task</Button>}</For>
        <Text emphasis="muted">Archive the owning task through Acorn to remove its checkout.</Text>
      </Show>
      <Show when={failure()}><Alert>{failure()}</Alert></Show>
      <Show when={!row().main && !row().locked && !row().owners.length && (row().prunable || row().dirty === false)}>
        <ConfirmButton tone="danger" confirmLabel={row().prunable ? 'Prune missing registrations?' : 'Remove this worktree?'} disabled={busy()}
          onConfirm={() => void remove(row())}>{row().prunable ? 'Prune missing registrations' : 'Remove worktree'}</ConfirmButton>
      </Show>
    </>}
  </Show></Stack>
}
