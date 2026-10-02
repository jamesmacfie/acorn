import { createEffect, on, createSignal, For, Show } from 'solid-js'
import { Alert, Button, Checkbox, CodeBlock, Fold, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { createMemoryResource } from './memoryResource'
import { memoryApi } from './memoryClient'
import type { MemoryImportResult } from '../shared/api'

export default function MemoryImport(props: { projectId: string; onChanged: () => void }) {
  const { value: sources, error: sourcesError } = createMemoryResource(() => props.projectId, (id) => memoryApi().sources(id), [])
  const [source, setSource] = createSignal('')
  const { value: files, refetch, error: filesError } = createMemoryResource(() => source() ? [props.projectId, source()] as const : false, ([id, source]) => memoryApi().importPreview(id, source), [])
  const [overwrite, setOverwrite] = createSignal<string[]>([])
  const [result, setResult] = createSignal<MemoryImportResult>()
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  createEffect(on(() => props.projectId, () => { setSource(''); setOverwrite([]); setResult(undefined); setError('') }))
  async function run() {
    setBusy(true); setError('')
    try {
      setResult(await memoryApi().import(props.projectId, source(), (files() ?? []).filter((file) => !file.error).map((file) => ({ name: file.name, sourceHash: file.sourceHash, destinationHash: file.destinationHash, overwrite: overwrite().includes(file.name) }))))
      setOverwrite([]); props.onChanged(); await refetch()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not import memory.') }
    finally { setBusy(false) }
  }
  return <Fold label="Import memory">
    <Stack gap="row">
      <Show when={error() || sourcesError() || filesError()}><Alert>{error() || String(sourcesError() || filesError())}</Alert></Show>
      <Show when={sources()?.length} fallback={<Text tone="muted">No Claude Code or repository memory folder found on this Node.</Text>}>
        <Select label="Import source" value={source()} options={[{ value: '', label: 'Choose a source' }, ...(sources() ?? []).map((source) => ({ value: source.id, label: `${source.label} — ${source.path}` }))]} onChange={(value) => { setSource(value); setResult(undefined); setOverwrite([]) }} />
        <For each={files()}>{(file) => <Fold label={file.file} meta={<Text>{file.collision ? 'Name collision' : 'New memory'}{file.error ? ` · ${file.error}` : ''}</Text>}>
          <Stack gap="row">
            <Text>{file.type} · {file.description}</Text>
            <CodeBlock wrap maxHeight="block">{file.body}</CodeBlock>
            <Show when={file.collision && !file.error}><Checkbox label={`Overwrite ${file.name}`} checked={overwrite().includes(file.name)} onChange={(checked) => setOverwrite((names) => checked ? [...names, file.name] : names.filter((name) => name !== file.name))} /></Show>
          </Stack>
        </Fold>}</For>
        <Show when={source()}><Button disabled={busy() || files.loading || !files()?.some((file) => !file.error)} onPress={() => void run()}>Import memories</Button></Show>
        <Text tone="muted">Copies into this project. Existing names are skipped unless you select Overwrite. Source files remain unchanged.</Text>
      </Show>
      <Show when={result()}>{(value) => <Stack gap="row"><Text>{value().imported.length} imported · {value().skipped.length} skipped · {value().errors.length} failed</Text><For each={value().errors}>{(error) => <Alert>{error.name}: {error.error}</Alert>}</For></Stack>}</Show>
    </Stack>
  </Fold>
}
