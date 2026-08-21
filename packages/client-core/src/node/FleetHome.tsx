import { For, Show } from 'solid-js'
import { tasksKey, tasksRoute, type Task } from '@acorn/protocol/api.ts'
import { readJson } from '../apiClient'
import { formatNodeStat, nodeStatContributions } from '../registries/nodeStats'
import { createAttentionInbox } from '../notifications/attentionInbox'
import { createFleetQuery } from './fanout'
import { activeNodeId, setActiveNode } from './activeNode'
import { nodes, nodeStatus } from './fleet'
import { reconnectNode } from './fleetActions'
import { formatLastSeen } from './freshness'
import NodeChip from './NodeChip'
import './nodes.css'
import { Alert, Button } from '../ui/primitives'

// Fleet home: the landing view once more than one node is paired, a card per node with connection
// state, counts, last-refresh, and the two actions that matter from here.
//
// It is a rail source rather than a route, registered by core with `order: 0` and
// `when: () => nodes().length > 1`. Two consequences worth stating:
//
//   - With only the bundled local node the rail button does not exist at all, so "first-run never
//     mentions nodes" is structural rather than a paragraph in a component nobody reaches.
//   - Every number on a card comes through `createFleetQuery`, so a node that is down contributes an
//     "unavailable" line and its neighbours still render (docs/architecture-overview.md § Client
//     state and fleet behavior).
//
// The card holds no per-node settings. Rename, unpair, revoke and the identity-change hard stop live
// in Settings → Nodes, which already does all four properly; duplicating them here would mean two
// places to keep in step on a screen whose job is an overview.
export default function FleetHome() {
  // The task list under `tasksKey`, counted in the component, not a count fetched under that key.
  // `fetchQuery` writes through the node's own cache, so this fetch returns the task list itself and
  // the component derives the count (docs/caching.md § Fan-out cache safety).
  const [tasksPerNode] = createFleetQuery(
    () => tasksKey,
    (nodeId, _dep, signal) => readJson<Task[]>(tasksRoute, { nodeId, signal }),
  )
  // One fan-out per contributed stat rather than one combined call: each plugin's fetch is
  // independent, and a plugin disabled on one node should leave that number off that card without
  // affecting the rest.
  const stats = nodeStatContributions().map((stat) => {
    const [values] = createFleetQuery(
      () => ['node-stat', stat.id] as const,
      (nodeId, _dep, signal) => stat.fetch(nodeId, signal),
    )
    return { stat, values }
  })

  // The bell's "Needs you" count, on the card. Same source of truth as the bell, so the two cannot
  // disagree about how many things are waiting on a node.
  const inbox = createAttentionInbox()
  const attentionFor = (nodeId: string) => inbox().rows.filter((row) => row.nodeId === nodeId).length

  const countFor = (nodeId: string) => tasksPerNode().rows.find((row) => row.nodeId === nodeId)?.data.length
  const unavailable = () => tasksPerNode().unavailable

  return (
    <main class="panes fleet-home">
      <header class="fleet-home-head">
        <h1>Fleet</h1>
        <p class="muted">
          {nodes().length} node{nodes().length === 1 ? '' : 's'} paired. A workspace belongs to exactly one node.
        </p>
      </header>

      {/* Partial results are a banner, never a failed page (docs/architecture-overview.md § Fleet). */}
      <Show when={unavailable().length}>
        <For each={unavailable()}>
          {(entry) => <Alert tone="warn" variant="banner">{entry.label} unavailable — {entry.reason}</Alert>}
        </For>
      </Show>

      <ul class="fleet-cards">
        <For each={nodes()}>
          {(node) => {
            const status = () => nodeStatus(node.nodeId)
            const active = () => node.nodeId === activeNodeId()
            return (
              <li class="fleet-card" classList={{ active: active() }} data-node-id={node.nodeId}>
                <div class="fleet-card-head">
                  <span class="fleet-card-label">{node.label}</span>
                  <Show when={node.local}><span class="fleet-card-badge">This computer</span></Show>
                  <Show when={active()}><span class="fleet-card-badge fleet-card-badge-active">Active</span></Show>
                </div>
                <NodeChip nodeId={node.nodeId} query={{}} />
                <div class="fleet-card-endpoint">{node.endpoint}</div>
                <dl class="fleet-card-stats">
                  <div>
                    <dt>Tasks</dt>
                    {/* An em dash, not 0: "no answer yet" and "no tasks" are different, and the chip
                        above already says which. */}
                    <dd>{countFor(node.nodeId) ?? '—'}</dd>
                  </div>
                  <For each={stats}>
                    {({ stat, values }) => {
                      const count = () => values().rows.find((row) => row.nodeId === node.nodeId)?.data
                      return (
                        <Show when={count()}>
                          {(value) => (
                            <div>
                              <dt>{stat.label[1]}</dt>
                              <dd>{formatNodeStat(stat, value())}</dd>
                            </div>
                          )}
                        </Show>
                      )
                    }}
                  </For>
                  <Show when={attentionFor(node.nodeId)}>
                    {(count) => (
                      <div>
                        <dt>Needs you</dt>
                        <dd class="fleet-card-attention">{count()}</dd>
                      </div>
                    )}
                  </Show>
                  <div>
                    <dt>Last seen</dt>
                    <dd>{formatLastSeen(status()?.lastSeenAt)}</dd>
                  </div>
                </dl>
                <div class="fleet-card-actions">
                  <Button
                    disabled={active()}
                    onClick={() => setActiveNode(node.nodeId)}
                  >
                    {active() ? 'Active' : 'Make active'}
                  </Button>
                  <Button onClick={() => void reconnectNode(node.nodeId)}>Reconnect</Button>
                </div>
              </li>
            )
          }}
        </For>
      </ul>
    </main>
  )
}
