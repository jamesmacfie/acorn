import { createEffect, on, createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Alert, Badge, Button, CodeBlock, Field, Fold, Heading, Inline, Input, Only, Select, Stack, Text, Textarea } from '@acorn/plugin-api/ui'
import { createMemoryResource } from './memoryResource'
import { memoryApi, MEMORY_SCOPE_LABEL, MEMORY_TYPE_LABEL, MEMORY_SCOPE_OPTIONS, MEMORY_TYPE_OPTIONS } from './memoryClient'
import type { MemoryAddress } from '../shared/api'
import type { MemoryRow } from '../contract/library'
import MemoryTerminal from './MemoryTerminal'

const authorLabel = (author: string) => author.startsWith('agent:') ? 'agent' : author

export default function MemoryDetail(props: { address: MemoryAddress; row?: MemoryRow; projectId?: string; revision: number; onChanged: (address?: MemoryAddress) => void }) {
  const navigate = useNavigate()
  const key = () => [props.address.scope, props.address.name, props.projectId, props.revision] as const
  const { value: document, refetch, error: documentError } = createMemoryResource(key, () => memoryApi().get(props.address, props.projectId), null)
  const { value: history, refetch: refreshHistory, error: historyError } = createMemoryResource(key, () => memoryApi().history(props.address, props.projectId), [])
  const [editing, setEditing] = createSignal(false)
  const [terminal, setTerminal] = createSignal(false)
  const [name, setName] = createSignal('')
  const [description, setDescription] = createSignal('')
  const [type, setType] = createSignal('project')
  const [scope, setScope] = createSignal<'project' | 'private'>('project')
  const [body, setBody] = createSignal('')
  const [hash, setHash] = createSignal('')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  // A draft owns its original hash, including after an event refetches the other writer's version.
  function begin() {
    const current = document()
    if (!current) return
    setName(current.name); setDescription(current.description); setType(current.type); setScope(current.scope)
    setBody(current.body); setHash(current.hash); setError(''); setEditing(true)
  }
  createEffect(on(() => [props.address.name, props.address.scope, props.projectId], () => { setEditing(false); setTerminal(false); setError('') }))
  async function run(operation: () => Promise<unknown>, next?: MemoryAddress) {
    setBusy(true); setError('')
    try { await operation(); setEditing(false); props.onChanged(next); await refetch(); await refreshHistory() }
    catch (e) { setError(e instanceof Error ? e.message : 'Memory operation failed.'); await refetch(); await refreshHistory() }
    finally { setBusy(false) }
  }
  const lastWriter = () => document()?.updatedBy ?? props.row?.updatedBy ?? 'owner'
  return <Stack gap="row">
    <Heading level={2}>{props.address.name}</Heading>
    <Show when={error() || documentError() || historyError()}><Alert>{error() || String(documentError() || historyError())}</Alert></Show>
    <Show when={document()} fallback={<Text tone="muted">This memory was deleted. Its retained versions are available below.</Text>}>{(current) => <>
      <Inline gap="inline">
        <Badge>{MEMORY_TYPE_LABEL[current().type as keyof typeof MEMORY_TYPE_LABEL]}</Badge><Badge>{MEMORY_SCOPE_LABEL[current().scope]}</Badge>
        <Text tone="muted">Updated {new Date(current().updatedAt || props.row?.updatedAt || 0).toLocaleString()} · {authorLabel(lastWriter())}</Text>
        <Show when={current().sessionId && current().taskId}><Button variant="bare" onPress={() => navigate(`/t/${encodeURIComponent(current().taskId!)}?pane=agents&item=${encodeURIComponent(current().sessionId!)}`)}>Session</Button></Show>
      </Inline>
      <Show when={!editing()} fallback={<Stack gap="row">
        <Field label="Name"><Input value={name()} onInput={setName} /></Field>
        <Field label="Description"><Input value={description()} onInput={setDescription} /></Field>
        <Inline even>
          <Field label="Type"><Select value={type()} onChange={setType} options={MEMORY_TYPE_OPTIONS} /></Field>
          <Field label="Scope"><Select value={scope()} onChange={(scope) => setScope(scope as 'project' | 'private')} options={MEMORY_SCOPE_OPTIONS.filter((option) => option.value === 'private' || props.projectId)} /></Field>
        </Inline>
        <Only hosts={['dom']}><Field label="Body"><Textarea mono rows={10} value={body()} onInput={setBody} /></Field></Only>
        <Only hosts={['tui']}><CodeBlock wrap maxHeight="block">{body()}</CodeBlock><Button onPress={() => setTerminal(true)}>Edit body in $EDITOR</Button></Only>
        <Show when={terminal()}><MemoryTerminal body={body()} onExit={(body) => { setTerminal(false); if (body !== undefined) setBody(body); else setError('Editor exited without a usable body.') }} /></Show>
        <Show when={current().hash !== hash()}><Alert>Another writer changed this memory. Your draft is preserved; reload the current version to start a new edit.</Alert><CodeBlock wrap maxHeight="block">{current().body}</CodeBlock><Button onPress={begin}>Reload current version</Button></Show>
        <Inline gap="row"><Button variant="solid" disabled={busy() || terminal() || current().hash !== hash()} onPress={() => void run(() => memoryApi().edit(props.address, { name: name(), description: description(), type: type(), body: body(), hash: hash() }, scope(), props.projectId), { name: name(), scope: scope(), projectId: scope() === 'project' ? props.projectId! : null })}>Save memory</Button><Button onPress={() => { setEditing(false); setError('') }}>Cancel</Button></Inline>
      </Stack>}>
        <Text>{current().description}</Text><CodeBlock wrap maxHeight="block">{current().body}</CodeBlock>
        <Inline gap="row"><Button onPress={begin}>Edit</Button><Button disabled={busy()} onPress={() => void run(() => memoryApi().delete(props.address, current().hash, props.projectId))}>Delete</Button></Inline>
      </Show>
    </>}</Show>
    <Fold label="History" count={history()?.length}>
      <Stack gap="row">
        <Show when={!history()?.length}><Text tone="muted">No earlier versions.</Text></Show>
        <For each={history()}>{(version) => <Fold label={new Date(version.at).toLocaleString()} meta={<Text>{authorLabel(version.updatedBy)}</Text>}>
          <Stack gap="row"><Text>{version.description} · {version.type}</Text><CodeBlock wrap maxHeight="block">{version.body}</CodeBlock><Button disabled={busy()} onPress={() => void run(() => memoryApi().restore(props.address, version.version, document()?.hash, props.projectId))}>Restore</Button></Stack>
        </Fold>}</For>
      </Stack>
    </Fold>
  </Stack>
}
