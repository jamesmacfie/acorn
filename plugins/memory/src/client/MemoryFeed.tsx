import { createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { formatRelativeTime } from '@acorn/plugin-api/client'
import { Alert, Button, EmptyState, Fold, Row, Stack, Text } from '@acorn/plugin-api/ui'
import { createMemoryResource } from './memoryResource'
import { MEMORY_ACTION_LABEL, MEMORY_SCOPE_LABEL, memoryApi, memoryAuthorLabel, memoryDate } from './memoryClient'
import { memoriesChanged, memoryRevision, selectMemory } from './memorySelection'
import type { MemoryChange } from '../shared/api'

// "Saved by an agent · This project". An import is its own verb.
const changeLine = (change: MemoryChange) => [
  change.by === 'import' ? 'Imported' : `${MEMORY_ACTION_LABEL[change.action]} by ${memoryAuthorLabel(change.by).toLowerCase()}`,
  MEMORY_SCOPE_LABEL[change.scope],
].join(' · ')

// Where an agent made the change. The session's address opens its task as well, so one link serves.
const originPath = (change: MemoryChange) => change.taskId
  ? `/t/${encodeURIComponent(change.taskId)}${change.sessionId ? `?pane=agents&item=${encodeURIComponent(change.sessionId)}` : ''}` : undefined

export default function MemoryFeed(props: { projectId: string }) {
  const navigate = useNavigate()
  const { value: changes, error: loadError, loaded } = createMemoryResource(() => [props.projectId, memoryRevision()] as const, async ([projectId]) => (await memoryApi().changes(projectId)).filter((change) => change.scope === 'project' && change.projectId === projectId), [])
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  async function undo(id: string) {
    setError(''); setBusy(true)
    try { await memoryApi().undo(id) }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't undo the change.") }
    finally { setBusy(false); memoriesChanged() }
  }
  return <Fold level="sub" label="Recent changes" count={loaded() ? changes().length : undefined} defaultOpen>
    <Stack gap="row">
      <Show when={error() || loadError()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show when={loaded()} fallback={<EmptyState busy align="start" size="sm">Loading…</EmptyState>}>
        <Show when={changes().length} fallback={<Text emphasis="muted">No changes yet.</Text>}>
          <Stack gap="none">
            <For each={changes()}>{(change) => (
              <Row
                variant="stacked"
                title={`${change.name}, ${memoryDate(change.at)}`}
                onPress={() => selectMemory({ name: change.name, scope: change.scope, projectId: change.projectId })}
                meta={<Text emphasis="muted">{formatRelativeTime(Date.parse(change.at))}</Text>}
                trailing={<>
                  <Show when={originPath(change)}>{(path) => <Button size="xs" variant="ghost" onPress={() => navigate(path())}>{change.sessionId ? 'Session' : 'Task'}</Button>}</Show>
                  <Show when={change.canUndo}><Button size="xs" disabled={busy()} onPress={() => void undo(change.id)}>Undo</Button></Show>
                </>}
              >
                <Text emphasis="strong">{change.name}</Text>
                <Text emphasis="muted">{changeLine(change)}</Text>
              </Row>
            )}</For>
          </Stack>
        </Show>
      </Show>
    </Stack>
  </Fold>
}
