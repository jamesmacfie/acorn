import { Show } from 'solid-js'
import { nodeIsStarting, nodes, nodeState, nodeStatus } from '../../infra/node/fleet'
import { formatLastSeen, freshnessOf, FRESHNESS_LABELS, type FreshnessQuery } from '../../infra/node/freshness'
import { StatusDot } from '../../kit/components/primitives'
import './nodes.css'

// The chip's six-value freshness vocabulary, in StatusDot's terms. NodeChip was the one designed status
// indicator in the codebase, so it keeps its chip shape and its vocabulary; only the dot is the shared
// primitive.
const FRESHNESS_TONE = {
  live: 'ok',
  refreshing: 'accent',
  stale: 'warn',
  offline: 'muted',
  disabled: 'muted',
  error: 'danger',
} as const

// The two error codes the badge must not flatten into "offline". Both describe a node that's reachable
// and answering, and neither is fixed by waiting, which is exactly what "Offline" tells the owner to do.
//
//   identity_mismatch  a changed fingerprint is a security stop, not a connectivity blip
//                      (docs/security.md).
//   protocol_mismatch  the node speaks a major this app doesn't (docs/api-reference.md § Versioning).
//                      The actionable half is the sub-line: one of the two has to be upgraded.
const HARD_ERRORS = {
  identity_mismatch: { label: 'Identity changed', detail: 'identity changed' },
  protocol_mismatch: { label: 'Version mismatch', detail: 'upgrade the app or the node' },
} as const

export default function NodeChip(props: { nodeId: string; label?: string; query?: FreshnessQuery; compact?: boolean }) {
  const status = () => nodeStatus(props.nodeId)
  const freshness = () => freshnessOf(nodeState(props.nodeId), props.query)
  const hard = () => {
    const code = status()?.error?.code
    return code === 'identity_mismatch' || code === 'protocol_mismatch' ? HARD_ERRORS[code] : undefined
  }
  // The supervised local node before the broker has reported on it at all. The startup gate normally
  // covers this interval (docs/frontend.md § Startup readiness), but the chip can also draw in host
  // chrome outside that gate. "Offline" is the wrong word for a process that is coming up. Only the
  // wording changes: the freshness value stays `offline`, because nothing on screen is live yet, and
  // the six-value vocabulary in node/freshness.ts is not the place to say "not yet".
  //
  // A REMOTE node with no status is genuinely offline — nothing has tried to reach it, and only the
  // Reconnect button will.
  const starting = () => nodeIsStarting(props.nodeId)
  // The fleet record's label, so a caller that only knows the id (the pane strip) still tips a name.
  // The id is the fallback for a node the fleet has not listed, which is also the case where "Offline"
  // is the state.
  const label = () => props.label ?? nodes().find((node) => node.nodeId === props.nodeId)?.label ?? props.nodeId
  const detail = () =>
    hard()?.detail ??
    // "never" is true of a node that is still starting and reads as an accusation. Nothing to add.
    (starting() ? '' : freshness() === 'stale' || freshness() === 'offline' ? formatLastSeen(status()?.lastSeenAt) : '')

  return (
    <span
      class="node-chip"
      classList={{ compact: props.compact }}
      data-freshness={hard() ? 'error' : freshness()}
      data-tip={`${label()}: ${starting() ? 'starting' : nodeState(props.nodeId)}`}
      data-tip-sub={detail() || undefined}
    >
      <StatusDot tone={FRESHNESS_TONE[hard() ? 'error' : freshness()]} />
      <Show when={props.label}>{(label) => <span class="node-chip-label">{label()}</span>}</Show>
      <span class="node-chip-state">{hard()?.label ?? (starting() ? 'Starting' : FRESHNESS_LABELS[freshness()])}</span>
      <Show when={detail() && !hard()}>
        <span class="node-chip-age">{detail()}</span>
      </Show>
    </span>
  )
}
