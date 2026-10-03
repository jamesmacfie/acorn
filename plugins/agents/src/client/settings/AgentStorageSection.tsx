import { createEffect, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import { clientEvents, formatBytes } from '@acorn/plugin-api/client'
import { Alert, Button, EmptyState, Facts, SettingsSection, Stack, Text } from '@acorn/plugin-api/ui'
import type { AgentFootprint } from '../../contract/wire.ts'
import { managedAgentApi } from '../sessions/managedClient'

// This plugin's section of Settings > Storage and memory, drawn in core's `core:storage` point
// (docs/managed-agents/operations.md § Operations and failure). The page is core's; these numbers and the stop
// are this plugin's route.

// The page's own rhythm, and no faster. The section lives only while the page is open.
const POLL_MS = 5_000

export default function AgentStorageSection(props: { nodeId?: string | null }) {
  const [footprint, setFootprint] = createSignal<AgentFootprint | null>(null)
  const [error, setError] = createSignal('')
  const [stopping, setStopping] = createSignal(false)
  const [stopped, setStopped] = createSignal('')
  const at = () => (props.nodeId ? { nodeId: props.nodeId } : {})

  let generation = 0
  const read = async () => {
    const mine = ++generation
    try {
      const next = await managedAgentApi.footprint(at())
      if (mine !== generation) return
      setFootprint(next)
      setError('')
    } catch (failure) {
      if (mine === generation) setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  onMount(() => {
    void read()
    const timer = setInterval(() => void read(), POLL_MS)
    onCleanup(() => clearInterval(timer))
  })
  createEffect(on(() => props.nodeId, () => {
    setFootprint(null)
    setStopped('')
    void read()
  }, { defer: true }))

  const stopIdle = async () => {
    setStopping(true)
    setStopped('')
    try {
      const { stopped: count } = await managedAgentApi.stopIdle(at())
      setStopped(count === 1 ? 'Stopped 1 idle agent.' : `Stopped ${count} idle agents.`)
      await read()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setStopping(false)
    }
  }

  const facts = (value: AgentFootprint) => [
    { label: 'Running agents', value: String(value.live) },
    { label: 'Idle', value: String(value.idle) },
    // Absent where the node cannot list processes, and with nothing running, where it would read as
    // a measurement of zero.
    ...(value.memoryBytes == null || !value.live ? [] : [{ label: 'Memory', value: `about ${formatBytes(value.memoryBytes)}` }]),
    { label: 'Attachments', value: formatBytes(value.attachmentsBytes) },
    { label: 'Artifacts', value: formatBytes(value.artifactsBytes) },
  ]

  return (
    <SettingsSection
      id="agents"
      label="Agents"
      help="Running agents keep their tools in memory between messages. Stopping an idle one frees that memory, and your next message starts it again in the same conversation."
      // Only while there is something to stop: a disabled button says nothing the Idle count doesn't.
      actions={
        <Show when={footprint()?.idle || stopping()}>
          <Button size="sm" busy={stopping()} onPress={() => void stopIdle()}>
            Stop idle agents now
          </Button>
        </Show>
      }
    >
      <Stack gap="row">
        <Show when={error()}>
          <Alert>{error()}</Alert>
        </Show>
        <Show when={footprint()} fallback={<EmptyState busy align="start" size="sm">Loading…</EmptyState>}>
          {(value) => <Facts grouping="rows" items={facts(value())} />}
        </Show>
        <Show when={stopped()}>
          <Text emphasis="muted" wrap>{stopped()}</Text>
        </Show>
        {/* When idle agents stop on their own, and how long history is kept, live on that page. A
            button named after the page it opens, as every settings link to another page is. */}
        <Button size="sm" variant="ghost" onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'agent-defaults#idle' })}>
          Harnesses and defaults
        </Button>
      </Stack>
    </SettingsSection>
  )
}
