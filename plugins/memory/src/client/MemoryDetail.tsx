import { createSignal, onCleanup, For, Match, Show, Switch } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Alert, Button, CodeBlock, ConfirmButton, EmptyState, Facts, Field, Fold, Heading, IconButton, Inline, Input, Markdown, Only, Select, Stack, Text, Textarea, Toolbar } from '@acorn/plugin-api/ui'
import { createMemoryResource } from './memoryResource'
import { memoryApi, memoryAuthorLabel, memoryDate, memoryTypeLabel, MEMORY_SCOPE_LABEL, MEMORY_TYPE_OPTIONS } from './memoryClient'
import { memoriesChanged, memoryRevision, selectMemory } from './memorySelection'
import type { MemoryAddress } from '../shared/api'
import MemoryTerminal from './MemoryTerminal'

// Mounted per memory (MemoryCenter.tsx keys it on the address), so a draft never outlives its memory.
export default function MemoryDetail(props: { address: MemoryAddress; projectId: string }) {
  let active = true
  onCleanup(() => { active = false })
  const navigate = useNavigate()
  const { value: document, error: documentError, loaded } = createMemoryResource(memoryRevision, () => memoryApi().get(props.address, props.projectId), null)
  const { value: history, error: historyError, loaded: historyLoaded } = createMemoryResource(memoryRevision, () => memoryApi().history(props.address, props.projectId), [])
  const [editing, setEditing] = createSignal(false)
  const [terminal, setTerminal] = createSignal(false)
  const [name, setName] = createSignal('')
  const [description, setDescription] = createSignal('')
  const [type, setType] = createSignal('project')
  const [body, setBody] = createSignal('')
  const [hash, setHash] = createSignal('')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  // A draft owns its original hash, including after an event refetches the other writer's version.
  function begin() {
    const current = document()
    if (!current) return
    setName(current.name); setDescription(current.description); setType(current.type)
    setBody(current.body); setHash(current.hash); setError(''); setEditing(true)
  }
  async function run(operation: () => Promise<unknown>, next?: MemoryAddress) {
    setBusy(true); setError('')
    try { await operation(); setEditing(false); if (active && next) selectMemory(next) }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't change this memory.") }
    finally { setBusy(false); memoriesChanged() }
  }
  const save = () => run(
    () => memoryApi().edit(props.address, { name: name(), description: description(), type: type(), body: body(), hash: hash() }, 'project', props.projectId),
    { name: name(), scope: 'project', projectId: props.projectId },
  )
  const sessionPath = () => {
    const current = document()
    return current?.taskId && current.sessionId
      ? `/t/${encodeURIComponent(current.taskId)}?pane=agents&item=${encodeURIComponent(current.sessionId)}` : undefined
  }
  return <>
    <Toolbar ariaLabel="Memory">
      <Heading level={2}>{props.address.name}</Heading>
      <Toolbar.Spacer />
      <Show when={document() && !editing()}>
        <Button size="sm" onPress={begin}>Edit</Button>
        <ConfirmButton size="sm" tone="danger" label="Delete" confirmLabel="Delete memory?" disabled={busy()} onConfirm={() => void run(() => memoryApi().delete(props.address, document()!.hash, props.projectId))}>Delete</ConfirmButton>
      </Show>
      <IconButton icon="x" label="Close" onPress={() => selectMemory(undefined)} />
    </Toolbar>
    <Stack gap="section">
      <Show when={documentError() || historyError() || (!editing() && error())}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Switch>
        <Match when={!loaded()}><EmptyState busy align="start" size="sm">Loading…</EmptyState></Match>
        <Match when={!document()}><Text emphasis="muted">This memory was deleted. Its earlier versions are under History.</Text></Match>
        {/* A page form: the fields, any error, then the solid primary and a ghost Cancel on the left. */}
        <Match when={editing() && document()}>{(current) => (
          <Stack gap="stack">
            <Field label="Name"><Input value={name()} onInput={setName} /></Field>
            <Field label="Description"><Input value={description()} onInput={setDescription} /></Field>
            <Field label="Type"><Select value={type()} onChange={setType} options={MEMORY_TYPE_OPTIONS} /></Field>
            <Only hosts={['dom']}><Field label="Body"><Textarea mono rows={12} value={body()} onInput={setBody} /></Field></Only>
            <Only hosts={['tui']}><CodeBlock wrap maxHeight="block">{body()}</CodeBlock><Button onPress={() => setTerminal(true)}>Edit body in $EDITOR</Button></Only>
            <Show when={terminal()}><MemoryTerminal body={body()} onExit={(body) => { setTerminal(false); if (body !== undefined) setBody(body); else setError("The editor closed without a body, so the draft didn't change.") }} /></Show>
            <Show when={current().hash !== hash()}>
              <Alert tone="warn" title="This memory changed while you were editing" actions={<Button size="sm" onPress={begin}>Reload current version</Button>}>
                Your draft is kept. The current text is below. Reload it to start again from there.
              </Alert>
              <CodeBlock wrap maxHeight="block">{current().body}</CodeBlock>
            </Show>
            <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
            <Inline gap="row">
              <Button variant="solid" disabled={busy() || terminal() || current().hash !== hash()} onPress={() => void save()}>Save memory</Button>
              <Button variant="ghost" onPress={() => { setEditing(false); setError('') }}>Cancel</Button>
            </Inline>
          </Stack>
        )}</Match>
        <Match when={document()}>{(current) => (
          <Stack gap="stack">
            <Text>{current().description}</Text>
            <Facts size="sm" grouping="rows" items={[
              { label: 'Type', value: memoryTypeLabel(current().type) },
              { label: 'Scope', value: MEMORY_SCOPE_LABEL[current().scope] },
              { label: 'Updated', value: memoryDate(current().updatedAt ?? 0) },
              {
                label: 'By',
                value: <Inline gap="inline">
                  <Text>{memoryAuthorLabel(current().updatedBy)}</Text>
                  <Show when={sessionPath()}>{(path) => <Button size="xs" variant="ghost" onPress={() => navigate(path())}>Open session</Button>}</Show>
                </Inline>,
              },
            ]} />
            <Markdown text={current().body} />
          </Stack>
        )}</Match>
      </Switch>
      <Fold level="sub" label="History" count={historyLoaded() ? history().length : undefined}>
        <Stack gap="row">
          <Show when={!history().length}><Text emphasis="muted">No earlier versions.</Text></Show>
          <For each={history()}>{(version) => (
            <Fold level="sub" label={memoryDate(version.at)} meta={<Text emphasis="muted">{memoryAuthorLabel(version.updatedBy)}</Text>}>
              <Stack gap="row">
                <Text emphasis="muted">{memoryTypeLabel(version.type)} · {version.description}</Text>
                <CodeBlock wrap maxHeight="block">{version.body}</CodeBlock>
                <ConfirmButton size="sm" label="Restore" confirmLabel="Restore version?" disabled={busy()} onConfirm={() => void run(() => memoryApi().restore(props.address, version.version, document()?.hash, props.projectId))}>Restore</ConfirmButton>
              </Stack>
            </Fold>
          )}</For>
        </Stack>
      </Fold>
    </Stack>
  </>
}
