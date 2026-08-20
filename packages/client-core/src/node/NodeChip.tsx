import { Show } from 'solid-js'
import { nodeState, nodeStatus } from './fleet'
import { formatLastSeen, freshnessOf, FRESHNESS_LABELS, type FreshnessQuery } from './freshness'
import { StatusDot } from '../ui/primitives'
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
  error: 'bad',
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
  const detail = () =>
    hard()?.detail ??
    (freshness() === 'stale' || freshness() === 'offline' ? formatLastSeen(status()?.lastSeenAt) : '')

  return (
    <span
      class="node-chip"
      classList={{ compact: props.compact }}
      data-freshness={hard() ? 'error' : freshness()}
      data-tip={`${props.label ?? props.nodeId}: ${nodeState(props.nodeId)}`}
      data-tip-sub={detail() || undefined}
    >
      <StatusDot class="node-chip-dot" tone={FRESHNESS_TONE[hard() ? 'error' : freshness()]} />
      <Show when={props.label}>{(label) => <span class="node-chip-label">{label()}</span>}</Show>
      <span class="node-chip-state">{hard()?.label ?? FRESHNESS_LABELS[freshness()]}</span>
      <Show when={detail() && !hard()}>
        <span class="node-chip-age">{detail()}</span>
      </Show>
    </span>
  )
}
