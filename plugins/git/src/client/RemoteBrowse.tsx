import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import { useMatch, useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activeNodeId, latestSignal } from '@acorn/plugin-api/client'
import { Alert, Button, ConfirmButton, EmptyState, Facts, IconButton, Input, Modal, Row, Rows, SectionHeader, Stack, Text } from '@acorn/plugin-api/ui'
import type { GitRemote, RemoteChange } from '../shared/api'
import { sameGitActionScope } from './launchWorkflow'
import { changeRemote, remotesKey, remotesOptions } from './remotesClient'
import { TaskRemoteActions } from './TaskRemoteActions'

const base = (projectId: string) => `/p/${encodeURIComponent(projectId)}/x/git/remotes`
type Action = RemoteChange['action']

function RemoteList(props: { projectId: string; selected: string | null; onSelect: (name: string) => void }) {
  const query = createQuery(() => remotesOptions(props.projectId))
  const cache = useQueryClient()
  const rows = () => query.data?.remotes ?? []
  return <Stack gap="none">
    <SectionHeader count={rows().length} actions={<IconButton icon="refresh-cw" label="Refresh remotes" spin={query.isFetching} onPress={() => void cache.invalidateQueries({ queryKey: remotesKey(props.projectId) })} />}>Remotes</SectionHeader>
    <Show when={query.isLoading}><EmptyState title="Loading remotes" /></Show>
    <Show when={query.error}><Alert tone="warn">{String(query.error)}</Alert></Show>
    <Show when={!query.isLoading && !rows().length}><EmptyState title="No remotes">Add a remote to fetch repository refs.</EmptyState></Show>
    <Rows id={`git-remotes:${activeNodeId()}:${props.projectId}`} ariaLabel="Git remotes" items={rows().map((remote) => ({ key: remote.name, label: remote.name }))}
      selected={props.selected} onSelect={props.onSelect} onActivate={props.onSelect}>
      {(item, itemProps, selected) => <Row item={itemProps} selected={selected()} onPress={() => props.onSelect(item.key)}>
        <Text>{item.label}</Text><Text emphasis="muted"> · {rows().find((remote) => remote.name === item.key)?.fetchUrl}</Text>
      </Row>}
    </Rows>
  </Stack>
}

export function RemoteDetail(props: { projectId: string; selected: string | null }) {
  const query = createQuery(() => remotesOptions(props.projectId))
  const cache = useQueryClient()
  const remote = createMemo(() => query.data?.remotes.find((entry) => entry.name === props.selected) ?? null)
  const [action, setAction] = createSignal<Action | null>(null)
  const [name, setName] = createSignal('')
  const [url, setUrl] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [feedback, setFeedback] = createSignal('')
  const [captured, setCaptured] = createSignal<{ nodeId: string | null; projectId: string; remote: GitRemote | null } | null>(null)
  const remoteChange = latestSignal()
  const open = (next: Action) => {
    remoteChange.abort()
    setBusy(false)
    setCaptured({ nodeId: activeNodeId(), projectId: props.projectId, remote: remote() })
    setAction(next); setName(remote()?.name ?? ''); setUrl(remote()?.fetchUrl ?? ''); setError(''); setFeedback('')
  }
  const close = () => { remoteChange.abort(); setAction(null); setBusy(false) }
  const submit = async () => {
    const target = captured(), kind = action()
    if (!target || !kind) return
    if (!sameGitActionScope(target.nodeId, target.projectId, props.projectId)) { setError('Reopen this action for the selected Node and project.'); return }
    const request: RemoteChange | null = kind === 'add' ? { action: kind, name: name(), url: url() }
      : kind === 'remove' && target.remote ? { action: kind, name: target.remote.name, expectedUrl: target.remote.fetchUrl }
      : kind === 'set-url' && target.remote ? { action: kind, name: target.remote.name, expectedUrl: target.remote.fetchUrl, url: url() }
      : kind === 'fetch' && target.remote ? { action: kind, name: target.remote.name, expectedUrl: target.remote.fetchUrl } : null
    if (!request) return
    const queryKey = remotesKey(target.projectId)
    const signal = remoteChange.next()
    const current = () => !signal.aborted && target.nodeId === activeNodeId() && target.projectId === props.projectId && action() === kind
    setBusy(true); setError('')
    try {
      const result = await changeRemote(target.projectId, request)
      if (result.postState === 'fresh') cache.setQueryData(queryKey, result.roster)
      else void cache.invalidateQueries({ queryKey })
      if (current()) { if (result.ok && result.postState === 'fresh') { close(); setFeedback(`${kind === 'fetch' ? 'Fetched' : 'Updated'} ${request.name}.`) }
        else setError(result.reason ?? 'Git refused the remote operation.') }
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (current()) setBusy(false) }
  }
  createEffect(on(() => `${activeNodeId()}:${props.projectId}:${props.selected}`, () => { close(); setFeedback('') }, { defer: true }))
  onCleanup(() => remoteChange.abort())
  return <Stack gap="section">
    <SectionHeader>Repository remotes</SectionHeader>
    <Button onPress={() => open('add')}>Add remote</Button>
    <TaskRemoteActions projectId={props.projectId} />
    <Show when={feedback()}><Alert tone="ok">{feedback()}</Alert></Show>
    <Show when={remote()} fallback={<EmptyState title="Select a remote">Select a remote to inspect or fetch it.</EmptyState>}>
      {(selected) => <>
        <Facts grouping="rows" items={[{ label: 'Name', value: selected().name }, { label: 'Fetch URL', value: `${selected().fetchUrl}${selected().fetchUrlCount > 1 ? ` (${selected().fetchUrlCount} configured)` : ''}` },
          { label: 'Push URL', value: `${selected().pushUrl}${selected().pushUrlCount > 1 ? ` (${selected().pushUrlCount} configured)` : ''}` },
          { label: 'Last successful fetch', value: query.data?.lastFetch[selected().name]?.successAt ? new Date(query.data!.lastFetch[selected().name]!.successAt!).toLocaleString() : 'Never' },
          { label: 'Last failure', value: query.data?.lastFetch[selected().name]?.error ?? 'None' }]} />
        <Button onPress={() => open('fetch')}>Fetch this remote</Button>
        <Button onPress={() => open('set-url')}>Edit fetch URL</Button>
        <Button onPress={() => open('remove')}>Remove remote</Button>
      </>}
    </Show>
    <Show when={action()}>{(kind) => <Modal title={`${kind()} remote`} size="md" onDismiss={close}>
      <Modal.Body><Stack gap="section">
        <Text>Node {captured()?.nodeId ?? 'unavailable'} · Project {captured()?.projectId}</Text>
        <Show when={captured()?.remote}>{(selected) => <Text>Remote {selected().name} · {selected().fetchUrl}</Text>}</Show>
        <Show when={kind() === 'add'}><Input label="Remote name" value={name()} onInput={setName} /></Show>
        <Show when={kind() === 'add' || kind() === 'set-url'}><Input label="URL" value={url()} onInput={setUrl} /></Show>
        <Show when={error()}><Alert tone="warn">{error()}</Alert></Show>
      </Stack></Modal.Body>
      <Modal.Actions><Button variant="ghost" onPress={close}>Cancel</Button>
        <Show when={kind() === 'remove'} fallback={<Button busy={busy()} disabled={busy()} onPress={() => void submit()}>{kind() === 'fetch' ? 'Fetch' : 'Save'}</Button>}>
          <ConfirmButton tone="danger" confirmLabel="Remove this remote?" disabled={busy()} onConfirm={() => void submit()}>Remove</ConfirmButton>
        </Show>
      </Modal.Actions>
    </Modal>}</Show>
  </Stack>
}

export function RemoteSourceList() {
  const params = useParams<{ projectId: string }>()
  const entry = useMatch(() => '/p/:projectId/x/git/remotes/:remoteName')
  const navigate = useNavigate()
  return <RemoteList projectId={params.projectId} selected={entry()?.params.remoteName ?? null} onSelect={(name) => navigate(`${base(params.projectId)}/${encodeURIComponent(name)}`)} />
}
export function RemoteSourceDetail() {
  const params = useParams<{ projectId: string }>()
  const entry = useMatch(() => '/p/:projectId/x/git/remotes/:remoteName')
  return <RemoteDetail projectId={params.projectId} selected={entry()?.params.remoteName ?? null} />
}
