import { createEffect, createSignal, Show } from 'solid-js'
import { Alert, Button, CodeBlock, Facts, Field, Fold, Input, Stack, Text } from '@acorn/plugin-api/ui'
import type { MemoryPreview } from '../shared/api'
import { createMemoryResource } from './memoryResource'
import { memoryApi } from './memoryClient'
import { memoryRevision } from './memorySelection'

const indexSize = (preview: MemoryPreview, scope: 'private' | 'project') =>
  `${preview.counts[scope].toLocaleString()} characters, ${preview.shown[scope].toLocaleString()} shown`

export default function MemoryContext(props: { projectId: string }) {
  const { value: preview, error: loadError, refetch } = createMemoryResource(() => [props.projectId, memoryRevision()] as const, ([projectId]) => memoryApi().preview(projectId) as Promise<MemoryPreview | undefined>, undefined)
  const [privateCap, setPrivateCap] = createSignal('4000')
  const [projectCap, setProjectCap] = createSignal('12000')
  const [error, setError] = createSignal('')
  const [saving, setSaving] = createSignal(false)
  createEffect(() => { const value = preview(); if (value) { setPrivateCap(String(value.caps.private)); setProjectCap(String(value.caps.project)) } })
  const valid = () => [privateCap(), projectCap()].every((value) => Number.isInteger(Number(value)) && Number(value) >= 200 && Number(value) <= 32000)
  async function save() {
    setError(''); setSaving(true)
    try { await memoryApi().caps({ private: Number(privateCap()), project: Number(projectCap()) }, props.projectId); await refetch() }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't save the caps.") }
    finally { setSaving(false) }
  }
  return <Fold level="sub" label="Project context">
    <Stack gap="stack">
      <Show when={loadError()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show when={preview()}>{(value) => <>
        <Text emphasis="muted">Agents receive this project index alongside their shared private memory.</Text>
        <Facts size="sm" grouping="rows" items={[
          { label: 'Project index', value: indexSize(value(), 'project') },
        ]} />
        <CodeBlock wrap maxHeight="block">{value().text}</CodeBlock>
        <Field label="Project index cap" hint="200 to 32,000 characters"><Input type="number" width="narrow" min={200} max={32000} value={projectCap()} onInput={setProjectCap} /></Field>
        <Text emphasis="muted">Sessions you start after saving get the new caps.</Text>
        <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
        <Button variant="solid" disabled={saving() || !valid()} onPress={() => void save()}>Save caps</Button>
      </>}</Show>
    </Stack>
  </Fold>
}
