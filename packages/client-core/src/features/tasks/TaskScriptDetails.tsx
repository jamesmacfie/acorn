import { createResource, createSignal, For, Show, onCleanup } from 'solid-js'
import { taskScriptLogsSchema, taskScriptsRoute, type TaskScriptSnapshot } from '@acorn/protocol/taskScripts.ts'
import { readJson } from '../../infra/node/apiClient'
import { Button, CodeBlock, Alert } from '../../kit/components/primitives'
import { Modal } from '../../kit/components/overlays/Modal'
import { Stack } from '../../kit/components/layout/Stack'
import { Text } from '../../kit/components/content/Text'
import { focusSession, sessionSummaries } from './agentSessions'
import { createTaskScripts, scriptLabel } from './taskScripts'
import { RailTab } from '../tabs/RailTab'

/** Compact task chrome, with diagnostics fetched only when the owner opens a phase. */
export function TaskScriptDetails(props: { taskId: string }) {
  const scripts = createTaskScripts(() => props.taskId)
  const [selected, setSelected] = createSignal<TaskScriptSnapshot | null>(null)
  const [now, setNow] = createSignal(Date.now())
  const clock = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(clock))
  const currentSelection = () => {
    const chosen = selected()
    if (!chosen) return null
    const status = scripts.query.data
    return status?.attempts.find(row => row.attemptId === chosen.attemptId)
      ?? (status?.[chosen.phase].attemptId === chosen.attemptId ? status[chosen.phase] : chosen)
  }
  const [logs, { refetch }] = createResource(currentSelection, async snapshot => {
    const query = new URLSearchParams({ phase: snapshot.phase, ...(snapshot.attemptId ? { attemptId: snapshot.attemptId } : {}), tailLines: '100' })
    return taskScriptLogsSchema.parse(await readJson(`${taskScriptsRoute(props.taskId)}/logs?${query}`))
  })
  const snapshots = () => scripts.query.data ? [scripts.query.data.setup, scripts.query.data.teardown] : []
  const stale = () => scripts.freshness() !== 'live' && scripts.freshness() !== 'refreshing'
  return <>
    <Show when={scripts.query.data?.archiveInProgress}><RailTab glyph="archive" label={`Archive in progress${stale() ? ` · ${scripts.freshness()} snapshot` : ''}`} busy={!stale()} /></Show>
    <For each={snapshots()}>{snapshot => <RailTab
      glyph={snapshot.phase === 'setup' ? 'wrench' : 'unplug'}
      label={`${scriptLabel(snapshot, now())}${stale() ? ` · ${scripts.freshness()} snapshot` : ''}`}
      tone={snapshot.state === 'failed' ? 'danger' : undefined}
      sublabel={snapshot.phase === 'setup' ? 'Setup' : 'Down'}
      onClick={() => setSelected(snapshot)}
    />}</For>
    <Show when={currentSelection()}>{snapshot => <Modal title={scriptLabel(snapshot(), now())} onDismiss={() => setSelected(null)}>
      <Modal.Body><Stack gap="stack">
        <Text>Generation {snapshot().generation} · attempt {snapshot().attemptId ?? 'none'}</Text>
        <Show when={stale()}><Alert tone="warn">{scripts.freshness()} snapshot; cached running state does not confirm a live process.</Alert></Show>
        <Show when={sessionSummaries().find(row => row.sessionId === snapshot().terminalSessionId && row.taskId === props.taskId)}>{session => <Button onPress={() => { focusSession(session()); setSelected(null) }}>Open terminal</Button>}</Show>
        <Button onPress={() => void refetch()}>Refresh logs</Button>
        <Show when={logs.error}><Alert tone="warn">Diagnostics unavailable</Alert></Show>
        <Show when={logs()}>{tail => <>
          <Show when={!tail().available}><Text>Output unavailable for this attempt.</Text></Show>
          <Show when={tail().truncated}><Text>Earlier output omitted; showing a bounded tail.</Text></Show>
          <CodeBlock wrap maxHeight="block">{tail().output || (tail().available ? 'No captured output.' : '')}</CodeBlock>
        </>}</Show>
      </Stack></Modal.Body>
    </Modal>}</Show>
  </>
}
