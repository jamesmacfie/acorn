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

// Fleet home (docs/vNext/ui.md § New surfaces): the landing view once more than one node is paired — a
// card per node with connection state, counts, last-refresh and the two actions that matter from here.
//
// It is a rail SOURCE rather than a route, registered by core with `order: 0` and
// `when: () => nodes().length > 1`. Two consequences worth stating:
//
//   - With only the bundled local node the rail button does not exist at all, so "first-run never
//     mentions nodes" is structural rather than a paragraph in a component nobody reaches.
//   - Every number on a card comes through `createFleetQuery`, so a node that is down contributes a
//     "node unavailable" line and its neighbours still render. That is the whole reason the fan-out
//     exists as a primitive.
//
// The card holds no per-node settings. Rename, unpair, revoke and the identity-change hard stop live in
// Settings → Nodes, which already does all four properly; duplicating them here would mean two places to
// keep in step on a screen whose job is an overview.
export default function FleetHome() {
  const [taskCounts] = createFleetQuery(
    () => tasksKey,
    async (nodeId, _dep, signal) => (await readJson<Task[]>(tasksRoute, { nodeId, signal })).length,
  )
  // One fan-out per contributed stat rather than one combined call: each plugin's fetch is independent,
  // and a plugin disabled on one node should leave that number off THAT card without affecting the rest.
  const stats = nodeStatContributions().map((stat) => {
    const [values] = createFleetQuery(
      () => ['node-stat', stat.id] as const,
      (nodeId, _dep, signal) => stat.fetch(nodeId, signal),
    )
    return { stat, values }
  })

  // ui.md's "attention count" on the card. Same source of truth as the bell's "Needs you" section, so the
  // two cannot disagree about how many things are waiting on a node.
  const inbox = createAttentionInbox()
  const attentionFor = (nodeId: string) => inbox().rows.filter((row) => row.nodeId === nodeId).length

  const countFor = (nodeId: string) => taskCounts().rows.find((row) => row.nodeId === nodeId)?.data
  const unavailable = () => taskCounts().unavailable

  return (
    <main class="panes fleet-home">
      <header class="fleet-home-head">
        <h1>Fleet</h1>
        <p class="muted">
          {nodes().length} node{nodes().length === 1 ? '' : 's'} paired. A workspace belongs to exactly one node.
        </p>
      </header>

      {/* Partial results are a banner, never a failed page (architecture.md § Fleet semantics). */}
      <Show when={unavailable().length}>
        <div class="fleet-banner" role="status">
          <For each={unavailable()}>
            {(entry) => <span>{entry.label} unavailable — {entry.reason}</span>}
          </For>
        </div>
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
                  <button
                    type="button"
                    class="ui-btn"
                    disabled={active()}
                    onClick={() => setActiveNode(node.nodeId)}
                  >
                    {active() ? 'Active' : 'Make active'}
                  </button>
                  <button type="button" class="ui-btn" onClick={() => void reconnectNode(node.nodeId)}>Reconnect</button>
                </div>
              </li>
            )
          }}
        </For>
      </ul>
    </main>
  )
}
