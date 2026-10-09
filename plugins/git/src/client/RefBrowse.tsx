import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import { useMatch, useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activeNodeId, requestTaskLaunch } from '@acorn/plugin-api/client'
import { Alert, Button, ConfirmButton, EmptyState, Facts, Input, Modal, Row, Rows, SectionHeader, Select, Stack, Text } from '@acorn/plugin-api/ui'
import type { GitRef, RefChange } from '../shared/api'
import { launchWorkflowAtCommit, sameGitActionScope } from './launchWorkflow'
import { changeRef, refsKey, refsOptions } from './refsClient'

type Action = RefChange['action']
const base = (projectId: string) => `/p/${encodeURIComponent(projectId)}/x/git/refs`
const refKey = (ref: GitRef) => `${ref.kind}:${ref.name}`

function RefList(props: { projectId: string; selected: string | null; onSelect: (id: string) => void }) {
  const query = createQuery(() => refsOptions(props.projectId))
  const cache = useQueryClient()
  const rows = () => query.data?.refs ?? []
  return <Stack gap="section">
    <SectionHeader count={rows().length} actions={<Button size="sm" variant="ghost" onPress={() => void cache.invalidateQueries({ queryKey: refsKey(props.projectId) })}>Refresh</Button>}>Branches and tags</SectionHeader>
    <Show when={query.isLoading}><EmptyState title="Loading refs" /></Show>
    <Show when={query.error}><Alert tone="warn">{String(query.error)}</Alert></Show>
    <Show when={!query.isLoading && !rows().length}><EmptyState title="No refs">This repository may have an unborn HEAD.</EmptyState></Show>
    <Rows id={`git-refs:${activeNodeId()}:${props.projectId}`} ariaLabel="Branches and tags"
      items={rows().map((ref) => ({ key: refKey(ref), label: `${ref.kind} ${ref.name}` }))}
      selected={props.selected} onSelect={props.onSelect} onActivate={props.onSelect}>
      {(item, itemProps, selected) => {
        const ref = () => rows().find((candidate) => refKey(candidate) === item.key)
        return <Row item={itemProps} selected={selected()} onPress={() => props.onSelect(item.key)}>
          <Text>{ref()?.name ?? item.label}</Text>
          <Text emphasis="muted"> · {ref()?.kind} · {ref()?.commitId?.slice(0, 8) ?? 'non-commit'}{ref()?.checkedOut ? ' · checked out' : ''}{ref()?.reservedBy.length ? ' · task reserved' : ''}</Text>
        </Row>
      }}
    </Rows>
  </Stack>
}

export function RefDetail(props: { projectId: string; selected: string | null }) {
  const query = createQuery(() => refsOptions(props.projectId))
  const cache = useQueryClient()
  const [action, setAction] = createSignal<Action | null>(null)
  const [name, setName] = createSignal('')
  const [startId, setStartId] = createSignal('')
  const [message, setMessage] = createSignal('')
  const [upstream, setUpstream] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [captured, setCaptured] = createSignal<{ nodeId: string | null; projectId: string; ref: GitRef | null } | null>(null)
  let generation = 0
  const ref = createMemo(() => query.data?.refs.find((item) => refKey(item) === props.selected) ?? null)
  const open = (next: Action) => {
    generation++
    setBusy(false)
    setCaptured({ nodeId: activeNodeId(), projectId: props.projectId, ref: ref() })
    setName(ref()?.name ?? '')
    setStartId(ref()?.commitId ?? query.data?.refs.find((item) => item.checkedOut)?.commitId ?? '')
    setMessage('')
    setUpstream(ref()?.upstream ?? '')
    setError('')
    setAction(next)
  }
  const close = () => { generation++; setAction(null); setBusy(false) }
  const submit = async () => {
    const target = captured(), kind = action()
    if (!target || !kind) return
    if (!sameGitActionScope(target.nodeId, target.projectId, props.projectId)) { setError('Reopen this action for the selected Node and project.'); return }
    const selected = target.ref
    const request: RefChange | null = kind === 'create-branch' ? { action: kind, name: name(), startId: startId() }
      : kind === 'create-tag' ? { action: kind, name: name(), startId: startId(), message: message().trim() || null }
      : kind === 'rename-branch' && selected ? { action: kind, name: selected.name, expectedId: selected.objectId, nextName: name() }
      : kind === 'delete-branch' && selected ? { action: kind, name: selected.name, expectedId: selected.objectId }
      : kind === 'delete-tag' && selected ? { action: kind, name: selected.name, expectedId: selected.objectId }
      : kind === 'set-upstream' && selected ? { action: kind, name: selected.name, expectedId: selected.objectId, upstream: upstream() || null }
      : null
    if (!request) return
    const queryKey = refsKey(target.projectId)
    const own = ++generation
    const current = () => own === generation && target.nodeId === activeNodeId() && target.projectId === props.projectId && action() === kind
    setBusy(true); setError('')
    try {
      const response = await changeRef(target.projectId, request)
      cache.setQueryData(queryKey, response.roster)
      if (current()) { if (response.ok) close(); else setError(response.reason ?? 'Git refused the ref change.') }
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (current()) setBusy(false) }
  }
  const launch = (workflow: boolean) => {
    const selected = ref(), nodeId = activeNodeId(), projectId = props.projectId
    if (!selected?.commitId || !sameGitActionScope(nodeId, projectId, props.projectId)) return
    if (workflow) launchWorkflowAtCommit(nodeId, projectId, selected.commitId, selected.name)
    else requestTaskLaunch({ nodeId, projectId, title: selected.name, baseCommit: selected.commitId })
  }
  createEffect(on(() => `${activeNodeId()}:${props.projectId}:${props.selected}`, () => { close(); setError('') }, { defer: true }))
  onCleanup(() => { generation++ })
  return <Stack gap="section">
    <SectionHeader>Refs</SectionHeader>
    <Button onPress={() => open('create-branch')}>Create branch</Button>
    <Button onPress={() => open('create-tag')}>Create tag</Button>
    <Show when={ref()} fallback={<EmptyState title="Select a branch or tag">Select a ref to inspect it.</EmptyState>}>
      {(selected) => <>
        <Facts grouping="rows" items={[{ label: 'Name', value: selected().name }, { label: 'Kind', value: selected().kind },
          { label: 'Object', value: selected().objectId, mono: true }, { label: 'Commit', value: selected().commitId ?? 'Not a commit', mono: true },
          { label: 'Upstream', value: selected().upstream ?? 'None' }, { label: 'Checkout', value: selected().checkedOut ? 'Checked out' : 'Free' },
          { label: 'Tasks', value: selected().reservedBy.map((owner) => owner.title).join(', ') || 'None' }]} />
        <Show when={selected().commitId}><Button onPress={() => launch(false)}>Start task here</Button><Button onPress={() => launch(true)}>Start workflow here</Button></Show>
        <Show when={selected().kind === 'local'}>
          <Button disabled={selected().checkedOut || !!selected().reservedBy.length} onPress={() => open('rename-branch')}>Rename branch</Button>
          <Button disabled={selected().checkedOut || !!selected().reservedBy.length} onPress={() => open('set-upstream')}>Set upstream</Button>
          <Button disabled={selected().checkedOut || !!selected().reservedBy.length} onPress={() => open('delete-branch')}>Delete branch</Button>
        </Show>
        <Show when={selected().kind === 'tag'}><Button onPress={() => open('delete-tag')}>Delete tag</Button></Show>
      </>}
    </Show>
    <Show when={action()}>{(kind) => <Modal title={kind().replace('-', ' ')} size="md" onDismiss={close}>
      <Modal.Body><Stack gap="section">
        <Text>Node {captured()?.nodeId ?? 'unavailable'} · Project {captured()?.projectId}</Text>
        <Show when={captured()?.ref}>{(selected) => <Text>{selected().kind} {selected().name} · {selected().objectId.slice(0, 12)}</Text>}</Show>
        <Show when={kind() === 'create-branch' || kind() === 'create-tag' || kind() === 'rename-branch'}>
          <Input label={kind() === 'rename-branch' ? 'New branch name' : 'Name'} value={name()} onInput={setName} maxLength={240} />
        </Show>
        <Show when={kind() === 'create-branch' || kind() === 'create-tag'}><Input label="Starting commit ID" value={startId()} onInput={setStartId} /></Show>
        <Show when={kind() === 'create-tag'}><Input label="Annotation message (optional)" value={message()} onInput={setMessage} /></Show>
        <Show when={kind() === 'set-upstream'}><Select label="Remote branch" value={upstream()} options={[{ value: '', label: 'No upstream' },
          ...(query.data?.refs.filter((candidate) => candidate.kind === 'remote').map((candidate) => ({ value: `refs/remotes/${candidate.name}`, label: candidate.name })) ?? [])]} onChange={setUpstream} /></Show>
        <Show when={error()}><Alert tone="warn">{error()}</Alert></Show>
      </Stack></Modal.Body>
      <Modal.Actions><Button variant="ghost" onPress={close}>Cancel</Button>
        <Show when={kind() === 'delete-branch' || kind() === 'delete-tag'} fallback={<Button busy={busy()} disabled={busy()} onPress={() => void submit()}>Save</Button>}>
          <ConfirmButton tone="danger" confirmLabel="Delete this ref?" disabled={busy()} onConfirm={() => void submit()}>Delete</ConfirmButton>
        </Show>
      </Modal.Actions>
    </Modal>}</Show>
  </Stack>
}

export function RefSourceList() {
  const params = useParams<{ projectId: string }>()
  const entry = useMatch(() => '/p/:projectId/x/git/refs/:refId')
  const navigate = useNavigate()
  return <RefList projectId={params.projectId} selected={entry()?.params.refId ? decodeURIComponent(entry()!.params.refId!) : null} onSelect={(id) => navigate(`${base(params.projectId)}/${encodeURIComponent(id)}`)} />
}
export function RefSourceDetail() {
  const params = useParams<{ projectId: string }>()
  const entry = useMatch(() => '/p/:projectId/x/git/refs/:refId')
  return <RefDetail projectId={params.projectId} selected={entry()?.params.refId ? decodeURIComponent(entry()!.params.refId!) : null} />
}
