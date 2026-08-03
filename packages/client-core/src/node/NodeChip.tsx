import { Show } from 'solid-js'
import { nodeState, nodeStatus } from './fleet'
import { formatLastSeen, freshnessOf, FRESHNESS_LABELS, type FreshnessQuery } from './freshness'
import './nodes.css'

// The one node-freshness badge (docs/vNext/ui.md § Connection and staleness vocabulary), rendered in
// exactly TWO places: the topbar and the Settings → Nodes rows. Threading freshness into the 13 panes
// is Phase 4 (plan.md § 116) — see freshness.ts.
//
// `data-freshness` rather than a class per state so the stylesheet owns the colour mapping and this
// component owns only the derivation.
export default function NodeChip(props: { nodeId: string; label?: string; query?: FreshnessQuery; compact?: boolean }) {
  const status = () => nodeStatus(props.nodeId)
  const freshness = () => freshnessOf(nodeState(props.nodeId), props.query)
  // The one error code the badge must not flatten into "offline": a changed fingerprint is a security
  // stop, not a connectivity blip (docs/vNext/security.md).
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
      title={`${props.label ?? props.nodeId}: ${nodeState(props.nodeId)}${detail() ? ` · ${detail()}` : ''}`}
    >
      <span class="node-chip-dot" aria-hidden="true" />
      <Show when={props.label}>{(label) => <span class="node-chip-label">{label()}</span>}</Show>
      <span class="node-chip-state">{mismatch() ? 'Identity changed' : FRESHNESS_LABELS[freshness()]}</span>
      <Show when={detail() && !mismatch()}>
        <span class="node-chip-age">{detail()}</span>
      </Show>
    </span>
  )
}
