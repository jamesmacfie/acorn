import { createEffect, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import { CORE_STORAGE_POINT } from '@acorn/protocol/extensionPoints.ts'
import type { NodeStorageReport } from '@acorn/protocol/api.ts'
import { activeCacheId, activeNodeId } from '../../infra/node/activeNode'
import { clearNodeCache, nodes, persistedCacheSize } from '../../infra/node/fleet'
import { nodeStorageReport } from '../../infra/node/nodeStorage'
import { extensionPointRegistry } from '../../host/registries/extensionPoints/extensionPoints'
import { Slot } from '../../host/tree/Slot'
import { formatBytes } from '../../kit/lib/rendering/formatSize'
import { Facts } from '../../kit/components/content/Facts'
import { Text } from '../../kit/components/content/Text'
import { Section } from '../../kit/components/layout/Section'
import { Stack } from '../../kit/components/layout/Stack'
import { Alert, Button } from '../../kit/components/primitives'

// Settings > Storage and memory: what the node holds in memory and on disk, and what this device keeps
// for it (docs/data-layer.md § What the node reports, docs/caching.md § Renderer query cache).
//
// Core draws its own numbers. A plugin that holds memory or disk on the node draws its own section
// through CORE_STORAGE_POINT, so core never calls a plugin's route. Agents is the one that does today.
//
// The node is the active one. Every read below names it, so the page can follow a node picker later
// by changing `nodeId` alone.

// Registered with the page, like `core:task` is with the rail: the point exists where it is drawn.
extensionPointRegistry.register({
  id: CORE_STORAGE_POINT,
  ownerId: 'core',
  label: 'Storage and memory',
  kind: 'remote',
  mode: 'stack',
  max: 4,
})

// No faster than this, and only while the page is mounted.
const POLL_MS = 5_000

type SavedCache = { bytes: number; entries: number } | null

export default function StorageSettings() {
  const nodeId = () => activeNodeId()
  const nodeLabel = () => nodes().find((node) => node.nodeId === nodeId())?.label ?? 'This node'
  const [report, setReport] = createSignal<NodeStorageReport | null>(null)
  const [saved, setSaved] = createSignal<SavedCache | undefined>(undefined)
  const [error, setError] = createSignal('')
  const [clearing, setClearing] = createSignal(false)
  const [cleared, setCleared] = createSignal('')

  // Only the newest read lands, so a slow answer from the previous node cannot overwrite this one's.
  let generation = 0
  const read = async () => {
    const mine = ++generation
    try {
      const [next, snapshot] = await Promise.all([
        nodeStorageReport(nodeId() ?? undefined),
        persistedCacheSize(activeCacheId()),
      ])
      if (mine !== generation) return
      setReport(next)
      setSaved(snapshot)
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
  createEffect(on(nodeId, () => {
    setReport(null)
    setSaved(undefined)
    setCleared('')
    void read()
  }, { defer: true }))

  const clear = async () => {
    setClearing(true)
    setCleared('')
    try {
      await clearNodeCache(activeCacheId())
      setCleared('Cleared. What is on screen is loading again.')
      await read()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setClearing(false)
    }
  }

  const diskFacts = (value: NodeStorageReport) => [
    { label: 'Core database', value: formatBytes(value.coreDatabaseBytes) },
    ...value.pluginDatabases.map((entry) => ({ label: `${entry.plugin} plugin`, value: formatBytes(entry.bytes) })),
    { label: 'Blob cache', value: formatBytes(value.blobCacheBytes) },
  ]

  return (
    <Stack gap="section">
      <Text emphasis="muted" wrap>
        {nodeLabel()}: what the node holds in memory and on disk, and what this device keeps for it.
        The numbers refresh every five seconds while this page is open. Memory is resident memory, so
        treat it as an estimate.
      </Text>

      <Show when={error()}>
        <Alert>{error()}</Alert>
      </Show>

      <Slot point={CORE_STORAGE_POINT} props={() => ({ nodeId: nodeId() })} />

      <Section label="Node process">
        <Show when={report()} fallback={<Text emphasis="muted">Loading</Text>}>
          {(value) => <Facts grouping="rows" items={[{ label: 'Memory', value: `about ${formatBytes(value().rssBytes)}` }]} />}
        </Show>
      </Section>

      <Section label="Disk">
        <Stack gap="row">
          <Show when={report()} fallback={<Text emphasis="muted">Loading</Text>}>
            {(value) => <Facts grouping="rows" items={diskFacts(value())} />}
          </Show>
          <Text emphasis="muted" wrap>
            Each database includes its write-ahead log. Worktrees are not counted. Sizes are measured at
            most every 30 seconds.
          </Text>
        </Stack>
      </Section>

      <Section
        label="Saved cache on this device"
        actions={<Button size="sm" busy={clearing()} onPress={() => void clear()}>Clear cache</Button>}
      >
        <Stack gap="row">
          <Show when={saved() !== undefined}>
            <Show when={saved()} fallback={<Text emphasis="muted">Nothing is saved for this node.</Text>}>
              {(value) => (
                <Facts grouping="rows" items={[
                  { label: 'Size', value: formatBytes(value().bytes) },
                  { label: 'Entries', value: String(value().entries) },
                ]} />
              )}
            </Show>
          </Show>
          <Text emphasis="muted" wrap>
            Last-known data this device saves so the app opens without waiting for the node. Clearing it
            drops that copy and fetches what is on screen again.
          </Text>
          <Show when={cleared()}>
            <Text emphasis="muted" wrap>{cleared()}</Text>
          </Show>
        </Stack>
      </Section>
    </Stack>
  )
}
