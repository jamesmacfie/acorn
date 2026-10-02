import { createSignal, For, Show } from 'solid-js'
import { Alert, Badge, Button, Checkbox, CodeBlock, Field, Fold, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { createMemoryResource } from './memoryResource'
import { memoryApi, memoryTypeLabel } from './memoryClient'
import { memoriesChanged } from './memorySelection'
import type { MemoryImportFile, MemoryImportResult } from '../shared/api'

// A new file is the ordinary case, so only a file that needs a decision carries a badge.
const fileBadge = (file: MemoryImportFile) => file.error
  ? <Badge tone="danger" size="xs" tip={file.error}>Can't import</Badge>
  : file.collision ? <Badge tone="warn" size="xs">Name taken</Badge> : undefined

// Mounted per project (the overview passes it only with one), so a choice never carries across.
export default function MemoryImport(props: { projectId: string }) {
  const { value: sources, error: sourcesError, loaded } = createMemoryResource(() => props.projectId, (id) => memoryApi().sources(id), [])
  const [source, setSource] = createSignal('')
  const { value: files, refetch, error: filesError } = createMemoryResource(() => source() ? [props.projectId, source()] as const : false, ([id, source]) => memoryApi().importPreview(id, source), [])
  const [overwrite, setOverwrite] = createSignal<string[]>([])
  const [result, setResult] = createSignal<MemoryImportResult>()
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const importable = () => files().filter((file) => !file.error)
  async function run() {
    setBusy(true); setError('')
    try {
      setResult(await memoryApi().import(props.projectId, source(), importable().map((file) => ({ name: file.name, sourceHash: file.sourceHash, destinationHash: file.destinationHash, overwrite: overwrite().includes(file.name) }))))
      setOverwrite([]); memoriesChanged(); await refetch()
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't import the memories.") }
    finally { setBusy(false) }
  }
  return <Fold level="sub" label="Import memory">
    <Stack gap="stack">
      <Text emphasis="muted">Copy memories written elsewhere into this project. The original files stay as they are.</Text>
      <Show when={sourcesError() || filesError()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show when={!loaded() || sources().length} fallback={<Text emphasis="muted">No memory folders found. acorn looks for Claude Code's memory for this project and a .acorn/memory folder in its checkout.</Text>}>
        <Field label="Source">
          <Select
            value={source()}
            options={[{ value: '', label: 'Choose a source' }, ...sources().map((source) => ({ value: source.id, label: source.label, description: source.path }))]}
            onChange={(value) => { setSource(value); setResult(undefined); setOverwrite([]) }}
          />
        </Field>
        <For each={files()}>{(file) => (
          <Fold level="sub" label={file.file} meta={fileBadge(file)}>
            <Stack gap="row">
              <Text emphasis="muted">{memoryTypeLabel(file.type)} · {file.description}</Text>
              <CodeBlock wrap maxHeight="block">{file.body}</CodeBlock>
              <Show when={file.collision && !file.error}>
                <Checkbox label={`Overwrite ${file.name}`} checked={overwrite().includes(file.name)} onChange={(checked) => setOverwrite((names) => checked ? [...names, file.name] : names.filter((name) => name !== file.name))} />
              </Show>
            </Stack>
          </Fold>
        )}</For>
        <Show when={source() && importable().length}>
          <Text emphasis="muted">A name that's taken is skipped unless you choose Overwrite.</Text>
        </Show>
        <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
        <Show when={source()}>
          <Button variant="solid" disabled={busy() || files.loading || !importable().length} onPress={() => void run()}>
            Import {importable().length} {importable().length === 1 ? 'memory' : 'memories'}
          </Button>
        </Show>
      </Show>
      <Show when={result()}>{(value) => <>
        <Text>{value().imported.length} imported, {value().skipped.length} skipped, {value().errors.length} failed.</Text>
        <For each={value().errors}>{(failure) => <Alert>{failure.name}: {failure.error}</Alert>}</For>
      </>}</Show>
    </Stack>
  </Fold>
}
