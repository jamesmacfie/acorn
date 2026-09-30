import { createEffect, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import { clientEvents, formatBytes } from '@acorn/plugin-api/client'
import { Alert, Button, Facts, Link, SettingsSection, Stack, Text } from '@acorn/plugin-api/ui'
import type { AgentFootprint } from '../../contract/wire.ts'
import { managedAgentApi } from '../sessions/managedClient'

// This plugin's section of Settings > Storage and memory, drawn in core's `core:storage` point
// (docs/managed-agents.md § Operations and failure). The page is core's; these numbers and the stop
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
      actions={
        <Button size="sm" busy={stopping()} disabled={!footprint()?.idle} onPress={() => void stopIdle()}>
          Stop idle agents now
        </Button>
      }
    >
      <Stack gap="row">
        <Show when={error()}>
          <Alert>{error()}</Alert>
        </Show>
        <Show when={footprint()} fallback={<Text emphasis="muted">Loading</Text>}>
          {(value) => <Facts grouping="rows" items={facts(value())} />}
        </Show>
        <Text emphasis="muted" wrap>
          Each running agent keeps its CLI and MCP servers in memory between prompts. Memory counts
          those processes. An idle agent has no turn running or queued and no question waiting for you.
          Stopping one frees its memory, and your next prompt starts it again on the same conversation.
        </Text>
        <Show when={stopped()}>
          <Text emphasis="muted" wrap>{stopped()}</Text>
        </Show>
        <Text emphasis="muted" wrap>
          When idle agents stop on their own, and how long archived tasks keep agent history, are set
          in Harnesses and defaults.
        </Text>
        <Link onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'agent-defaults#idle' })}>
          Open Harnesses and defaults
        </Link>
      </Stack>
    </SettingsSection>
  )
}
