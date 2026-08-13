import { Show } from 'solid-js'
import { nodeState, nodeStatus } from './fleet'
import { formatLastSeen, freshnessOf, FRESHNESS_LABELS, type FreshnessQuery } from './freshness'
import { StatusDot } from '../ui/primitives'
import './nodes.css'

// The chip's six-value freshness vocabulary, in StatusDot's terms. NodeChip was the one *designed*
// status indicator in the codebase, so it keeps its chip shape and its vocabulary; only the dot
// itself is now the shared primitive.
const FRESHNESS_TONE = {
  live: 'ok',
  refreshing: 'accent',
  stale: 'warn',
  offline: 'muted',
  disabled: 'muted',
  error: 'bad',
} as const

export default function NodeChip(props: { nodeId: string; label?: string; query?: FreshnessQuery; compact?: boolean }) {
  const status = () => nodeStatus(props.nodeId)
  const freshness = () => freshnessOf(nodeState(props.nodeId), props.query)
  // The one error code the badge must not flatten into "offline": a changed fingerprint is a security
  // stop, not a connectivity blip (docs/security.md).
  const mismatch = () => status()?.error?.code === 'identity_mismatch'
  const detail = () =>
    mismatch()
      ? 'identity changed'
      : freshness() === 'stale' || freshness() === 'offline'
        ? formatLastSeen(status()?.lastSeenAt)
        : ''

  return (
    <span
      class="node-chip"
      classList={{ compact: props.compact }}
      data-freshness={mismatch() ? 'error' : freshness()}
      data-tip={`${props.label ?? props.nodeId}: ${nodeState(props.nodeId)}`}
      data-tip-sub={detail() || undefined}
    >
      <StatusDot class="node-chip-dot" tone={FRESHNESS_TONE[mismatch() ? 'error' : freshness()]} />
      <Show when={props.label}>{(label) => <span class="node-chip-label">{label()}</span>}</Show>
      <span class="node-chip-state">{mismatch() ? 'Identity changed' : FRESHNESS_LABELS[freshness()]}</span>
      <Show when={detail() && !mismatch()}>
        <span class="node-chip-age">{detail()}</span>
      </Show>
    </span>
  )
}
