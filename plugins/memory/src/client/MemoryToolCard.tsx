import { useNavigate } from '@solidjs/router'
import { createMemo, createSignal, Show } from 'solid-js'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import { Alert, Button, Card, CodeBlock, Inline, Stack, Text } from '@acorn/plugin-api/ui'
import { memoryApi } from './memoryClient'
import { openMemory } from './memorySelection'

// Providers can return plain JSON or the MCP content envelope around it.
function result(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (Array.isArray(parsed.content)) {
        for (const part of parsed.content) {
          const nested = result(part.text)
          if (nested) return nested
        }
      }
      return parsed
    }
  } catch { /* Pending calls and failed calls can carry plain text. */ }
  return null
}

export function MemoryToolCard(props: AgentToolCardProps) {
  const navigate = useNavigate()
  const input = createMemo(() => result(props.tool.input))
  const output = createMemo(() => result(props.tool.output))
  const [busy, setBusy] = createSignal(false)
  const [undone, setUndone] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const saved = () => props.tool.status === 'completed' && typeof output()?.changeId === 'string'
  const name = () => String(output()?.name ?? input()?.name ?? 'memory')
  const scope = () => String(output()?.scope ?? input()?.scope ?? 'project')
  const label = () => undone() ? `Undid ${scope()} memory ${name()}`
    : saved() ? `${props.tool.name === 'memory_delete' ? 'Deleted' : 'Saved'} ${scope()} memory ${name()}`
      : `${props.tool.status === 'failed' ? "Couldn't change" : 'Saving'} ${scope()} memory ${name()}`
  async function undo() {
    setBusy(true)
    setError(undefined)
    try { await memoryApi().undo(String(output()!.changeId)); setUndone(true) }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't undo the change.") }
    finally { setBusy(false) }
  }
  return <Card><Stack gap="row">
    <Text emphasis="strong">{label()}</Text>
    <Show when={output()?.description ?? input()?.description}>{(description) => <Text wrap>{String(description())}</Text>}</Show>
    <Show when={saved()} fallback={<Show when={props.tool.output}><CodeBlock wrap maxHeight="block">{props.tool.output}</CodeBlock></Show>}>
      <Inline>
        <Button size="sm" onPress={() => openMemory(name(), scope(), typeof output()?.projectId === 'string' ? output()!.projectId as string : undefined, navigate)}>Open</Button>
        <Button size="sm" disabled={busy() || undone()} onPress={() => void undo()}>{undone() ? 'Undone' : 'Undo'}</Button>
      </Inline>
    </Show>
    <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
  </Stack></Card>
}
