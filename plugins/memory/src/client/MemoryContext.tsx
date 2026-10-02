import { createEffect, createSignal, Show } from 'solid-js'
import { Alert, Button, CodeBlock, Field, Fold, Inline, Input, Stack, Text } from '@acorn/plugin-api/ui'
import type { MemoryPreview } from '../shared/api'
import { createMemoryResource } from './memoryResource'
import { memoryApi } from './memoryClient'

export default function MemoryContext(props: { projectId?: string; revision: number; onChanged: () => void }) {
  const { value: preview, error: loadError } = createMemoryResource(() => [props.projectId, props.revision] as const, ([projectId]) => memoryApi().preview(projectId) as Promise<MemoryPreview | undefined>, undefined)
  const [privateCap, setPrivateCap] = createSignal('4000')
  const [projectCap, setProjectCap] = createSignal('12000')
  const [error, setError] = createSignal('')
  const [saving, setSaving] = createSignal(false)
  createEffect(() => { const value = preview(); if (value) { setPrivateCap(String(value.caps.private)); setProjectCap(String(value.caps.project)) } })
  const valid = () => [privateCap(), projectCap()].every((value) => Number.isInteger(Number(value)) && Number(value) >= 200 && Number(value) <= 32000)
  async function save() {
    setError(''); setSaving(true)
    try { await memoryApi().caps({ private: Number(privateCap()), project: Number(projectCap()) }, props.projectId); props.onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save caps.') }
    finally { setSaving(false) }
  }
  return <Fold label="What agents see">
    <Stack gap="row">
      <Show when={error() || loadError()}><Alert>{error() || String(loadError())}</Alert></Show>
      <Show when={preview()}>{(value) => <>
        <Text>Private index: {value().counts.private} characters, {value().shown.private} shown / {value().caps.private} cap.</Text>
        <Show when={props.projectId}><Text>Project index: {value().counts.project} characters, {value().shown.project} shown / {value().caps.project} cap.</Text></Show>
        <CodeBlock wrap maxHeight="block">{value().text}</CodeBlock>
        <Inline even>
          <Field label="Private index cap"><Input value={privateCap()} onInput={setPrivateCap} /></Field>
          <Field label="Project index cap"><Input value={projectCap()} onInput={setProjectCap} /></Field>
        </Inline>
        <Text tone="muted">200–32,000 characters per index. Changes apply to new sessions.</Text>
        <Button disabled={saving() || !valid()} onPress={() => void save()}>Save index caps</Button>
      </>}</Show>
    </Stack>
  </Fold>
}
