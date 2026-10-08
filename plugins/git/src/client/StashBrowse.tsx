import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activateTaskSignals, activeNodeId, nodeReady, pathForTask, projectsOptions, tasksOptions, type Task } from '@acorn/plugin-api/client'
import { Alert, Button, Checkbox, ConfirmButton, EmptyState, Facts, IconButton, Input, Modal, Row, Rows, SectionHeader, Select, Stack, Text } from '@acorn/plugin-api/ui'
import type { Stash, StashResult } from '../shared/api'
import { stashActions, stashesKey, stashesOptions } from './stashClient'
import { worktreesKey } from './worktreeClient'
import { RevisionView } from './RevisionView'
import { watchWorktreeInventory } from './worktreeInvalidation'

const base = (projectId: string) => `/p/${encodeURIComponent(projectId)}/x/git/stashes`
type Action = 'create' | 'apply' | 'pop' | 'drop'

function useStashes(projectId: () => string) {
  const queryClient = useQueryClient()
  const roster = createQuery(() => stashesOptions(projectId()))
  const refresh = () => void queryClient.invalidateQueries({ queryKey: stashesKey(projectId()) })
  watchWorktreeInventory(refresh)
  return { roster, refresh }
}

export function StashList(props: { projectId: string; selected: string | null; onSelect: (id: string) => void }) {
  const state = useStashes(() => props.projectId)
  const entries = () => state.roster.data?.stashes ?? []
  const items = () => entries().map((stash) => ({ key: stash.id, label: stash.message }))
  return <Stack gap="section">
    <SectionHeader count={entries().length} actions={<IconButton icon="refresh-cw" label="Refresh stashes" onPress={state.refresh} />}>Stashes</SectionHeader>
    <Show when={!nodeReady()}><EmptyState title="Node unavailable">Reconnect to inspect stashes.</EmptyState></Show>
    <Show when={state.roster.isLoading}><EmptyState title="Loading stashes" /></Show>
    <Show when={state.roster.error}><Alert tone="warn">{String(state.roster.error)}{state.roster.data ? ' Showing the last available roster.' : ''}</Alert></Show>
    <Show when={!entries().length && !state.roster.isLoading && !state.roster.error}><EmptyState title="No stashes" /></Show>
    <Rows id={`git-stashes:${activeNodeId()}:${props.projectId}`} ariaLabel="Repository stashes" items={items()}
      selected={props.selected} onSelect={props.onSelect} onActivate={props.onSelect}>
      {(item, itemProps, selected) => {
        const stash = () => entries().find((entry) => entry.id === item.key)
        return <Row item={itemProps} selected={selected()} onPress={() => props.onSelect(item.key)}>
          <Text>{stash()?.message ?? item.label}</Text>
          <Text emphasis="muted"> · {stash()?.originBranch ?? 'Unknown branch'} · {stash()?.selector}</Text>
        </Row>
      }}
    </Rows>
  </Stack>
}

export function StashDetail(props: { projectId: string; task?: Task; selected: string | null; onSelect: (id: string) => void }) {
  const state = useStashes(() => props.projectId)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  const [action, setAction] = createSignal<Action | null>(null)
  const [message, setMessage] = createSignal('')
  const [includeUntracked, setIncludeUntracked] = createSignal(false)
  const [keepIndex, setKeepIndex] = createSignal(false)
  const [restoreIndex, setRestoreIndex] = createSignal(false)
  const [contentView, setContentView] = createSignal<'tracked' | 'untracked'>('tracked')
  const [taskId, setTaskId] = createSignal('')
  const [targetPath, setTargetPath] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [result, setResult] = createSignal<StashResult | null>(null)
  const [captured, setCaptured] = createSignal<{ nodeId: string | null; projectId: string; selection: Stash | null } | null>(null)
  const stash = createMemo(() => state.roster.data?.stashes.find((item) => item.id === props.selected) ?? null)
  const availableTasks = () => (tasks.data ?? []).filter((task) => task.status === 'active')
  const pathOf = (task: Task | undefined) => task?.worktreePath ?? projects.data?.find((project) => project.id === task?.projectId)?.path ?? ''
  const selectTask = (id: string) => { setTaskId(id); setTargetPath(pathOf((tasks.data ?? []).find((item) => item.id === id))) }
  const open = (next: Action) => {
    if (next === 'create') { setMessage(''); setIncludeUntracked(false); setKeepIndex(false) }
    if (next === 'apply' || next === 'pop') setRestoreIndex(false)
    setAction(next); setError(''); setResult(null)
    setCaptured({ nodeId: activeNodeId(), projectId: props.projectId, selection: stash() })
    selectTask(props.task?.id ?? availableTasks()[0]?.id ?? '')
  }
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: stashesKey(props.projectId) })
    void queryClient.invalidateQueries({ queryKey: worktreesKey(props.projectId) })
  }
  const run = async () => {
    const snapshot = captured(), operation = action()
    if (!snapshot || !operation) return
    if (snapshot.nodeId !== activeNodeId() || snapshot.projectId !== props.projectId) {
      setError('Node or project changed. Close and reopen this action.'); return
    }
    const task = props.task ?? availableTasks().find((item) => item.id === taskId())
    if (operation !== 'drop' && (!task || task.id !== taskId())) {
      setError('Target task moved or is unavailable. Close and reopen this action.'); return
    }
    if (operation !== 'create' && !snapshot.selection) { setError('Stash selection is unavailable. Refresh and reopen.'); return }
    const expectedPath = targetPath()
    const selection = snapshot.selection && {
      objectId: snapshot.selection.objectId,
      selector: snapshot.selection.selector,
      fingerprint: snapshot.selection.fingerprint,
    }
    if (operation !== 'drop' && (!expectedPath || pathOf(task) !== expectedPath)) { setError('Target checkout moved or is unavailable. Close and reopen this action.'); return }
    setBusy(true); setError('')
    try {
      const response = operation === 'create'
        ? await stashActions.create(snapshot.projectId, { taskId: taskId(), expectedPath, message: message(), includeUntracked: includeUntracked(), keepIndex: keepIndex() })
        : operation === 'drop'
          ? await stashActions.drop(snapshot.projectId, { selection: selection!, confirm: true })
          : await stashActions[operation](snapshot.projectId, { taskId: taskId(), expectedPath, selection: selection!, restoreIndex: restoreIndex() })
      setResult(response)
      refresh()
      if (response.ok) setAction(null)
      else setError(response.error ?? 'Git refused the stash operation.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      refresh()
    } finally { setBusy(false) }
  }
  const openChanges = (targetId: string) => {
    const target = (tasks.data ?? []).find((item) => item.id === targetId)
    if (target) { activateTaskSignals(target, { pane: 'changes' }); navigate(pathForTask(target)) }
  }
  createEffect(on(() => `${activeNodeId()}:${props.projectId}`, () => { setAction(null); setResult(null); setError('') }, { defer: true }))
  createEffect(on(() => props.selected, () => setContentView('tracked'), { defer: true }))
  return <Stack gap="section">
    <SectionHeader>Repository stashes</SectionHeader>
    <Button onPress={() => open('create')}>Create stash</Button>
    <Show when={state.roster.error}><Alert tone="warn">{String(state.roster.error)}</Alert></Show>
    <Show when={!action() ? result() : null}>{(feedback) => <Alert tone={feedback().ok ? 'ok' : 'warn'}>{feedback().ok ? 'Stash operation completed.' : feedback().error}</Alert>}</Show>
    <Show when={result()?.conflicts.length}><Alert tone="warn">Conflicts: {result()!.conflicts.join(', ')}. Resolve them in Changes or Editor.</Alert>
      <Button onPress={() => openChanges(taskId())}>Open Changes</Button></Show>
    <Show when={stash()} fallback={<EmptyState title="Select a stash">Select a stash to inspect or apply it.</EmptyState>}>
      {(selected) => <>
        <Facts grouping="rows" items={[
          { label: 'Message', value: selected().message },
          { label: 'Origin branch', value: selected().originBranch ?? 'Unknown' },
          { label: 'Created', value: new Date(selected().createdAt).toLocaleString() },
          { label: 'Selector', value: selected().selector },
          { label: 'Object ID', value: selected().objectId, mono: true },
          { label: 'Base', value: selected().base, mono: true },
        ]} />
        <Button onPress={() => open('apply')}>Apply to task</Button>
        <Button onPress={() => open('pop')}>Pop to task</Button>
        <Button variant="ghost" onPress={() => open('drop')}>Drop stash</Button>
        <Show when={selected().untrackedFiles.length}><SectionHeader>Captured untracked files</SectionHeader>
          <For each={selected().untrackedFiles}>{(path) => <Text>{path}</Text>}</For></Show>
        <Show when={selected().untrackedParent}>
          <Button variant={contentView() === 'tracked' ? 'solid' : 'ghost'} onPress={() => setContentView('tracked')}>Tracked changes</Button>
          <Button variant={contentView() === 'untracked' ? 'solid' : 'ghost'} onPress={() => setContentView('untracked')}>Captured untracked content</Button>
        </Show>
        <Show when={contentView() === 'tracked'} fallback={<RevisionView projectId={props.projectId} taskId={props.task?.id}
          id={selected().untrackedParent} onCommit={props.onSelect} />}>
          <RevisionView projectId={props.projectId} taskId={props.task?.id} id={selected().objectId}
            stashBase={selected().base} onCommit={props.onSelect} />
        </Show>
      </>}
    </Show>
    <Show when={action()}>{(kind) => <Modal title={`${kind().charAt(0).toUpperCase()}${kind().slice(1)} stash`} size="md" onDismiss={() => setAction(null)}>
      <Modal.Body><Stack gap="section">
        <Text>Node {captured()?.nodeId ?? 'unavailable'} · Project {captured()?.projectId}</Text>
        <Show when={captured()?.selection}>{(item) => <Text>Stash {item().selector} · {item().objectId.slice(0, 12)}</Text>}</Show>
        <Show when={kind() !== 'drop'}>
          <Show when={!props.task} fallback={<Text>Target task: {props.task?.title} · {props.task?.id}</Text>}>
            <Select label="Target task" value={taskId()} options={availableTasks().map((item) => ({ value: item.id, label: `${item.title} · ${item.id}` }))} onChange={selectTask} />
          </Show>
          <Show when={kind() === 'create'} fallback={<Checkbox label="Restore staged changes" checked={restoreIndex()} onChange={setRestoreIndex} />}>
            <Input label="Message" placeholder="Stash message" value={message()} onInput={setMessage} maxLength={512} />
            <Checkbox label="Include untracked files" checked={includeUntracked()} onChange={setIncludeUntracked} />
            <Checkbox label="Keep staged changes" checked={keepIndex()} onChange={setKeepIndex} />
          </Show>
        </Show>
        <Show when={error()}><Alert tone="warn">{error()}</Alert></Show>
        <Show when={result()?.conflicts.length}><Alert tone="warn">Conflicted files: {result()!.conflicts.join(', ')}. The stash was retained.</Alert>
          <Button onPress={() => { setAction(null); openChanges(taskId()) }}>Open Changes</Button></Show>
      </Stack></Modal.Body>
      <Modal.Actions>
        <Button variant="ghost" onPress={() => setAction(null)}>Cancel</Button>
        <Show when={kind() === 'drop'} fallback={<Button busy={busy()} disabled={busy() || kind() === 'create' && !message().trim() || !taskId()} onPress={() => void run()}>{kind() === 'create' ? 'Create stash' : kind() === 'pop' ? 'Pop stash' : 'Apply stash'}</Button>}>
          <ConfirmButton tone="danger" confirmLabel="Drop this stash?" disabled={busy()} onConfirm={() => void run()}>Drop stash</ConfirmButton>
        </Show>
      </Modal.Actions>
    </Modal>}</Show>
  </Stack>
}

export function StashSourceList() {
  const params = useParams<{ projectId: string; stashId?: string }>()
  const navigate = useNavigate()
  return <StashList projectId={params.projectId} selected={params.stashId ?? null} onSelect={(id) => navigate(`${base(params.projectId)}/${encodeURIComponent(id)}`)} />
}
export function StashSourceDetail() {
  const params = useParams<{ projectId: string; stashId?: string }>()
  const navigate = useNavigate()
  return <StashDetail projectId={params.projectId} selected={params.stashId ?? null} onSelect={(id) => navigate(`${base(params.projectId)}/${encodeURIComponent(id)}`)} />
}
