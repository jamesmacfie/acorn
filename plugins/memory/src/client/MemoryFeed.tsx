import { createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Alert, Button, Fold, Inline, Stack, Text } from '@acorn/plugin-api/ui'
import { createMemoryResource } from './memoryResource'
import { memoryApi } from './memoryClient'
import { selectMemory } from './memorySelection'

export default function MemoryFeed(props: { projectId?: string; revision: number; onChanged: () => void }) {
  const navigate = useNavigate()
  const { value: changes, error: loadError } = createMemoryResource(() => [props.projectId, props.revision] as const, ([projectId]) => memoryApi().changes(projectId), [])
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  async function undo(id: string) {
    setError(''); setBusy(true)
    try { await memoryApi().undo(id); props.onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not undo change.') }
    finally { setBusy(false) }
  }
  return <Fold label="Recent changes" count={changes()?.length} defaultOpen>
    <Stack gap="row">
      <Show when={error() || loadError()}><Alert>{error() || String(loadError())}</Alert></Show>
      <Show when={changes()?.length} fallback={<Text tone="muted">No recent memory changes.</Text>}>
        <For each={changes()}>{(change) => <Inline gap="row">
          <Button variant="bare" onPress={() => selectMemory({ name: change.name, scope: change.scope })}>{change.name}</Button>
          <Text>{change.action} · {change.scope} · {change.by} · {new Date(change.at).toLocaleString()}</Text>
          <Show when={change.taskId}><Button variant="bare" onPress={() => navigate(`/t/${encodeURIComponent(change.taskId!)}`)}>Task</Button></Show>
          <Show when={change.sessionId && change.taskId}><Button variant="bare" onPress={() => navigate(`/t/${encodeURIComponent(change.taskId!)}?pane=agents&item=${encodeURIComponent(change.sessionId!)}`)}>Session</Button></Show>
          <Show when={change.canUndo}><Button size="sm" disabled={busy()} onPress={() => void undo(change.id)}>Undo</Button></Show>
        </Inline>}</For>
      </Show>
    </Stack>
  </Fold>
}
